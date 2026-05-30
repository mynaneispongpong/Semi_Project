require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
// Try to use better-sqlite3 for persistent storage; fall back to in-memory store if it fails
let db = null;
let DB = null;
let useInMemoryDB = false;
try {
    const Database = require("better-sqlite3");
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, "dev.db");
    db = new Database(DB_PATH);
    DB = {
        ensureSchema: () =>
            db
                .prepare(
                    `CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                content TEXT,
                userId INTEGER,
                tags TEXT,
                inTrash INTEGER DEFAULT 0,
                createdAt INTEGER,
                updatedAt INTEGER
            )`,
                )
                .run(),
        allNotes: () => db.prepare("SELECT * FROM notes WHERE inTrash = 0 ORDER BY updatedAt DESC").all(),
        getNote: (id) => db.prepare("SELECT * FROM notes WHERE id = ?").get(id),
        insertNote: (title, content) => {
            const now = Date.now();
            const stmt = db.prepare(
                "INSERT INTO notes (title, content, userId, tags, inTrash, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
            );
            const info = stmt.run(title, content, 1, JSON.stringify([]), 0, now, now);
            return db.prepare("SELECT * FROM notes WHERE id = ?").get(info.lastInsertRowid);
        },
        updateNote: (id, title, content) => {
            const now = Date.now();
            db.prepare("UPDATE notes SET title = ?, content = ?, updatedAt = ? WHERE id = ?").run(
                title,
                content,
                now,
                id,
            );
            return db.prepare("SELECT * FROM notes WHERE id = ?").get(id);
        },
        trashNote: (id) => db.prepare("UPDATE notes SET inTrash = 1, updatedAt = ? WHERE id = ?").run(Date.now(), id),
    };
    DB.ensureSchema();
} catch (e) {
    console.error("better-sqlite3 로드 실패, 인메모리 DB로 폴백합니다:", e && e.message ? e.message : e);
    useInMemoryDB = true;
    const notes = [];
    let nextId = 1;
    DB = {
        allNotes: () => notes.filter((n) => !n.inTrash).sort((a, b) => b.updatedAt - a.updatedAt),
        getNote: (id) => notes.find((n) => n.id === id),
        insertNote: (title, content) => {
            const now = Date.now();
            const note = {
                id: nextId++,
                title: title || "제목 없는 노트",
                content: content || "",
                userId: 1,
                tags: [],
                inTrash: 0,
                createdAt: now,
                updatedAt: now,
            };
            notes.push(note);
            return note;
        },
        updateNote: (id, title, content) => {
            const note = notes.find((n) => n.id === id);
            if (!note) return null;
            note.title = typeof title === "string" ? title : note.title;
            note.content = typeof content === "string" ? content : note.content;
            note.updatedAt = Date.now();
            return note;
        },
        trashNote: (id) => {
            const note = notes.find((n) => n.id === id);
            if (!note) return null;
            note.inTrash = 1;
            note.updatedAt = Date.now();
            return note;
        },
    };
}

const app = express();

// Runtime Gemini key (in-memory). Initialized from env but can be updated via API for local use.
let runtimeGeminiKey = process.env.GEMINI_API_KEY || "";

// (스키마는 sqlite 사용 시 이미 DB.ensureSchema()에서 생성됩니다)

// helper to map row -> object
function rowToNote(r) {
    if (!r) return null;
    return {
        id: r.id,
        title: r.title,
        content: r.content,
        userId: r.userId,
        tags: Array.isArray(r.tags) ? r.tags : r.tags ? JSON.parse(r.tags) : [],
        inTrash: !!r.inTrash,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
    };
}

// 미들웨어 설정
app.use(cors()); // 프론트엔드와 백엔드 포트가 다를 때 발생할 수 있는 CORS 문제 해결
app.use(express.json()); // JSON 형태의 요청 본문(body)을 파싱
// Serve static files (allow serving app.html from project root)
app.use(express.static(path.join(__dirname)));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "app.html")));

// 1. 모든 노트 가져오기 (목록 렌더링)
app.get("/api/notes", (req, res) => {
    try {
        const rows = DB.allNotes();
        const list = rows.map(rowToNote);
        res.json(list);
    } catch (error) {
        res.status(500).json({ error: "노트 목록을 불러오지 못했습니다.", detail: String(error) });
    }
});

// 2. 새 노트 생성
app.post("/api/notes", (req, res) => {
    try {
        const now = Date.now();
        const { title, content } = req.body || {};
        const safeTitle = typeof title === "string" && title.length > 0 ? title : "제목 없는 노트";
        const safeContent = typeof content === "string" ? content : "";
        const row = DB.insertNote(safeTitle, safeContent);
        res.status(201).json(rowToNote(row));
    } catch (error) {
        res.status(500).json({ error: "노트 생성에 실패했습니다.", detail: String(error) });
    }
});

// 3. 노트 업데이트 (저장)
app.put("/api/notes/:id", (req, res) => {
    const { id } = req.params;
    const { title, content } = req.body;
    try {
        const nid = parseInt(id, 10);
        const row = DB.getNote(nid);
        if (!row) return res.status(404).json({ error: "노트를 찾을 수 없습니다." });

        const safeTitle = typeof title === "string" ? title : row.title;
        const safeContent = typeof content === "string" ? content : row.content;
        const updated = DB.updateNote(nid, safeTitle, safeContent);
        res.json(rowToNote(updated));
    } catch (error) {
        res.status(500).json({ error: "노트 저장에 실패했습니다.", detail: String(error) });
    }
});

// 4. 노트 삭제(휴지통으로 이동)
app.delete("/api/notes/:id", (req, res) => {
    try {
        const nid = parseInt(req.params.id, 10);
        const row = DB.getNote(nid);
        if (!row) return res.status(404).json({ error: "노트를 찾을 수 없습니다." });
        DB.trashNote(nid);
        return res.json({ success: true, id: nid });
    } catch (err) {
        return res.status(500).json({ error: "삭제 중 오류가 발생했습니다.", detail: String(err) });
    }
});

// Gemini endpoint
// Modified to use Google's official REST API if proxy URL is not provided.
app.post("/api/gemini", async (req, res) => {
    const { prompt, model } = req.body || {};
    const key = runtimeGeminiKey || process.env.GEMINI_API_KEY;

    if (!key) return res.status(500).json({ error: "GEMINI_API_KEY not set on server" });

    // 전달받은 모델이 없거나 default일 경우 지원되는 최신 모델(gemini-2.5-flash) 사용
    const targetModel = model && model !== "default" ? model : "gemini-2.5-flash";

    // .env에 URL이 없으면 구글의 공식 URL 자동 할당
    const url =
        process.env.GEMINI_API_URL ||
        `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent`;

    try {
        // Google 공식 API 규격에 맞는 Payload 형식으로 구성
        const body = {
            contents: [
                {
                    parts: [{ text: prompt }],
                },
            ],
        };

        const r = await fetch(`${url}?key=${key}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });

        const data = await r.json();

        // 에러 반환 처리
        if (data.error) {
            return res.status(500).json({ error: "Gemini API Error", detail: data.error.message });
        }

        // 프론트엔드에서 편하게 렌더링하도록 텍스트만 추출
        let textResponse = "";
        if (data.candidates && data.candidates[0].content.parts[0].text) {
            textResponse = data.candidates[0].content.parts[0].text;
        } else {
            textResponse = JSON.stringify(data);
        }

        return res.json({ ok: true, data: textResponse });
    } catch (err) {
        return res.status(500).json({ error: "Gemini request failed", detail: String(err) });
    }
});

// Endpoint to set runtime Gemini API key (stored in memory). Intended for local/dev use only.
app.post("/api/gemini/key", (req, res) => {
    const { key } = req.body || {};
    if (!key || typeof key !== "string") return res.status(400).json({ error: "missing key" });
    runtimeGeminiKey = key;
    console.log("Runtime GEMINI API key updated (in-memory)");
    return res.json({ ok: true });
});

// Endpoint to check whether a runtime key is present
app.get("/api/gemini/key", (req, res) => {
    return res.json({ hasKey: !!(runtimeGeminiKey || process.env.GEMINI_API_KEY) });
});

const PORT = process.env.PORT || 3000;

function start() {
    app.listen(PORT, () => {
        console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
    });
}

start();
