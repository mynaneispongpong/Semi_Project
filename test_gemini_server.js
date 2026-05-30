require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());

let runtimeGeminiKey = process.env.GEMINI_API_KEY || "";

app.get("/api/gemini/key", (req, res) => res.json({ hasKey: !!runtimeGeminiKey }));

app.post("/api/gemini", async (req, res) => {
    const { prompt, model } = req.body || {};
    const key = runtimeGeminiKey || process.env.GEMINI_API_KEY;

    if (!key) return res.status(500).json({ error: "GEMINI_API_KEY not set on server" });

    const targetModel = model && model !== "default" ? model : "gemini-2.5-flash";
    const url =
        process.env.GEMINI_API_URL ||
        `https://generativelanguage.googleapis.com/v1/models/${targetModel}:generateContent`;

    try {
        const body = {
            contents: [
                {
                    parts: [{ text: prompt }],
                },
            ],
        };

        const r = await fetch(`${url}?key=${key}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const data = await r.json();

        if (data.error) return res.status(500).json({ error: "Gemini API Error", detail: data.error.message });

        let textResponse = "";
        if (
            data.candidates &&
            data.candidates[0] &&
            data.candidates[0].content &&
            data.candidates[0].content.parts &&
            data.candidates[0].content.parts[0] &&
            data.candidates[0].content.parts[0].text
        ) {
            textResponse = data.candidates[0].content.parts[0].text;
        } else {
            textResponse = JSON.stringify(data);
        }

        return res.json({ ok: true, data: textResponse });
    } catch (err) {
        return res.status(500).json({ error: "Gemini request failed", detail: String(err) });
    }
});

const PORT = process.env.TEST_GEMINI_PORT || 3001;
app.listen(PORT, () => console.log(`Test Gemini server running on http://localhost:${PORT}`));
