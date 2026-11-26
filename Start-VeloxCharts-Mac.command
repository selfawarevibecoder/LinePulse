#!/usr/bin/env bash
# Velox Charts — 1-Click macOS Launcher (Double-click to start & open browser)
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "============================================================"
  echo "  Node.js 20+ bulunamadi / Node.js 20+ not found!"
  echo "  Lutfen kurun: https://nodejs.org"
  echo "============================================================"
  open "https://nodejs.org" >/dev/null 2>&1 || true
  read -r -p "Kapatmak icin Enter'a basin..."
  exit 1
fi

echo "Starting Velox Charts at http://localhost:3456 ..."
(sleep 1.5 && open "http://localhost:3456") &
node server/index.js
