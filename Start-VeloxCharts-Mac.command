#!/usr/bin/env bash
# Velox Charts — 1-Click macOS Launcher (auto-checks & offers to install Node.js LTS with user permission)
cd "$(dirname "$0")"

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/current/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "============================================================"
  echo "  Node.js bulunamadi / Node.js not found!"
  echo "============================================================"
  read -r -p "Resmi Node.js LTS otomatik kurulsun mu? (E/H) [E]: " ans
  ans="${ans:-E}"
  if [[ "$ans" =~ ^[EeYy]$ ]]; then
    if command -v brew >/dev/null 2>&1; then
      echo ">>> Homebrew ile Node.js kuruluyor..."
      brew install node
      export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
    else
      echo ">>> Resmi Node.js LTS macOS kurucusu indiriliyor (nodejs.org)..."
      PKG="/tmp/velox-nodejs-lts.pkg"
      curl -fsSL "https://nodejs.org/dist/v22.14.0/node-v22.14.0.pkg" -o "$PKG"
      if [ -f "$PKG" ]; then
        open "$PKG"
        echo ">>> Acilan kurulum penceresini tamamlayip bu dosyaya tekrar cift tiklayin."
        read -r -p "Kapatmak icin Enter'a basin..."
        exit 0
      else
        open "https://nodejs.org" >/dev/null 2>&1 || true
        read -r -p "Indirme basarisiz; nodejs.org acildi. Kapatmak icin Enter'a basin..."
        exit 1
      fi
    fi
  else
    echo "Kurulum iptal edildi. Manuel kurulum: https://nodejs.org"
    read -r -p "Kapatmak icin Enter'a basin..."
    exit 1
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js henuz aktif degil. Lutfen kurulumu tamamlayip tekrar acin."
  read -r -p "Kapatmak icin Enter'a basin..."
  exit 1
fi

echo "Starting Velox Charts at http://localhost:3456 ..."
(sleep 1.5 && open "http://localhost:3456") &
node server/index.js
