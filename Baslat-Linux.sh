#!/usr/bin/env bash
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js bulunamadi! Lutfen https://nodejs.org adresinden Node.js 18+ kurun."
  exit 1
fi

PORT="${PORT:-3456}"
echo "LinePulse baslatiliyor: http://127.0.0.1:${PORT}"
(sleep 1 && xdg-open "http://127.0.0.1:${PORT}" >/dev/null 2>&1) &
node server/index.js
