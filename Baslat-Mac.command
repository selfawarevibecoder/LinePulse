#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "============================================================"
  echo "  Node.js bulunamadi!"
  echo "  Lutfen https://nodejs.org adresinden LTS surumunu kurun."
  echo "============================================================"
  read -p "Kapatmak icin Enter'a basin..."
  exit 1
fi

PORT="${PORT:-3456}"
echo "LinePulse baslatiliyor: http://127.0.0.1:${PORT}"
echo "Kapatmak icin bu pencereyi kapatabilir veya Ctrl+C yapabilirsiniz."

(sleep 1 && open "http://127.0.0.1:${PORT}") &
node server/index.js
