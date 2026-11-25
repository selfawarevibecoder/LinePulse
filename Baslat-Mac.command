#!/bin/bash
cd "$(dirname "$0")"

# Ensure Homebrew paths are visible when launched from Finder
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "============================================================"
  echo "  Node.js bulunamadi! / Node.js is not installed."
  echo "============================================================"
  read -p "Resmi Node.js LTS otomatik indirilsin / kurulsun mu? [E/h]: " ans
  case "$ans" in
    [nNhH]*)
      echo "Kurulum iptal edildi. Manuel kurulum: https://nodejs.org"
      read -p "Kapatmak icin Enter'a basin..."
      exit 1
      ;;
  esac

  if command -v brew >/dev/null 2>&1; then
    echo "Homebrew ile Node.js kuruluyor..."
    brew install node
  else
    NODE_VER="v22.14.0"
    PKG_FILE="/tmp/nodejs-${NODE_VER}.pkg"
    echo "Resmi Node.js LTS (${NODE_VER}) indiriliyor..."
    curl -fL "https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}.pkg" -o "$PKG_FILE"
    if [ -f "$PKG_FILE" ]; then
      echo "Kurulum sihirbazi aciliyor — kurulum bitince bu pencereye donup Enter'a basin..."
      open -W "$PKG_FILE"
      export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
    else
      echo "Indirme basarisiz oldu. Tarayicida https://nodejs.org aciliyor..."
      open "https://nodejs.org"
      read -p "Kurulumdan sonra Enter'a basin..."
    fi
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js henuz aktif gorunmuyor. Lutfen pencereyi kapatip tekrar cift tiklayin."
    read -p "Kapatmak icin Enter'a basin..."
    exit 1
  fi
fi

PORT="${PORT:-3456}"
echo "LinePulse baslatiliyor: http://127.0.0.1:${PORT}"
echo "Kapatmak icin bu pencereyi kapatabilir veya Ctrl+C yapabilirsiniz."

(sleep 1.2 && open "http://127.0.0.1:${PORT}" >/dev/null 2>&1 || true) &
node server/index.js
