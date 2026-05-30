#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

echo "This script will securely update GEMINI_API_URL and GEMINI_API_KEY in $ENV_FILE"
read -p "Enter GEMINI_API_URL: " GEMINI_API_URL
read -s -p "Enter GEMINI_API_KEY (input hidden): " GEMINI_API_KEY
echo

if [ ! -f "$ENV_FILE" ]; then
  echo "Creating $ENV_FILE"
  touch "$ENV_FILE"
fi

# Escape slashes for sed
esc_url=$(printf '%s' "$GEMINI_API_URL" | sed -e 's/[\/&]/\\&/g')
esc_key=$(printf '%s' "$GEMINI_API_KEY" | sed -e 's/[\/&]/\\&/g')

# Replace or append
if grep -q '^GEMINI_API_URL=' "$ENV_FILE"; then
  sed -i.bak "s/^GEMINI_API_URL=.*/GEMINI_API_URL=\"$esc_url\"/" "$ENV_FILE"
else
  echo "GEMINI_API_URL=\"$GEMINI_API_URL\"" >> "$ENV_FILE"
fi

if grep -q '^GEMINI_API_KEY=' "$ENV_FILE"; then
  sed -i.bak "s/^GEMINI_API_KEY=.*/GEMINI_API_KEY=\"$esc_key\"/" "$ENV_FILE"
else
  echo "GEMINI_API_KEY=\"$GEMINI_API_KEY\"" >> "$ENV_FILE"
fi

# Remove backup created by sed on macOS
if [ -f "$ENV_FILE.bak" ]; then
  rm -f "$ENV_FILE.bak"
fi

echo ".env updated. Restart the server:"
echo "  kill \\$(lsof -t -i:3000) || true && npm start"
