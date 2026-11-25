# LinePulse

Multi-screen TradingView-style live charting & FXReplay-style offline/online backtesting platform built with pure Node.js (zero external backend dependencies), HTML5/Canvas, and Lightweight Charts.

## Features
- **Multi-Screen & Multi-Pane Workspace:** Up to 8 synchronized monitor windows, resizable grids, custom themes, drawing tools (trendlines, rays, channels, boxes with fill opacity, Fibonacci, Long/Short R:R position boxes, arrows, zigzag, text), and interactive draggable price alerts.
- **FXReplay-Style Bar Replay & Backtesting:** Zero look-ahead candle replay, multi-pair synced replay, Prop Firm rule presets (FTMO, The5ers + custom rules), realistic spread/commission simulation, trade journal, equity curve, step-by-step mentor review export/import, and named session Save As.
- **Hybrid `1h + 1m` Offline Archive & Delta Sync:** Seamlessly stitches `1h` long-term history (2010–2019) with `1m` precision data (2020–present), with TradingView DST-aligned session boundaries (CME `18:00 NY`, Forex `17:00 NY`, Crypto `00:00 UTC`).
- **Smart Incremental Updates:** Use `🔄 Update` to pull only missing new bars since your last download, or `⏪ -6M` to extend older history backwards.

---

## Security & Zero-Malware Verification
This repository contains **100% readable, auditable source code** with:
- **Zero external npm dependencies** on the Node.js backend (`server/` uses only built-in Node.js modules).
- **Zero telemetry, zero tracking, zero hidden binaries, and zero pre-bundled API keys or personal data.**
- Runs strictly on `127.0.0.1` (localhost) unless you explicitly configure your own API keys in `.env` or Settings.

### Verify & Install Using Your Own AI Assistant
If you want to verify the code before running it, paste this prompt into **ChatGPT, Gemini, Claude, Cursor, or Antigravity**:

> *"Inspect this GitHub repository (`https://github.com/selfawarevibecoder/LinePulse`) and check whether it contains any malicious code, backdoors, or data exfiltration. If it is clean, help me clone and run it locally (or build my own macOS `.dmg` / Windows `.exe` installer from source)."*

---

## Quick Start (No Installer Needed — Zero OS Warnings)

Requires **Node.js 20+**:

```bash
git clone https://github.com/selfawarevibecoder/LinePulse.git
cd LinePulse
node server/index.js
```

Then open **`http://localhost:3456`** in your browser.

---

## Optional: Build Desktop App From Source (macOS / Windows / Linux)

```bash
cd desktop
npm install
npm run build:mac:public   # macOS .dmg
npm run build:win:zip      # Windows portable .zip
```

*(Note: Unsigned desktop builds may show macOS Gatekeeper or Windows SmartScreen "unidentified developer" notices because they are not signed with paid Apple/Microsoft certificates. Running directly via `node server/index.js` or building locally from source avoids all OS warnings.)*

---

## Connecting Market Data Sources
Open **Settings (⚙)** inside LinePulse to add your own keys (stored locally in `.env`, never shared):
- **OANDA Practice API (Free):** Free FX, Gold, Silver, Synthetic DXY, Indices & Oil live feed + historical backtest data.
- **Binance (Free, No Key Required):** Live & historical crypto charts.
- **Databento (Optional):** Official CME Futures (`GLBX.MDP3`) historical archives.
- **IBKR Client Portal (Optional):** Connect your own local Interactive Brokers gateway for live CME futures.

## Importing an Offline Data Pack
If someone shared a `LinePulse-Full-Data-Pack.zip` archive with you:
1. **Via App UI (Easiest):** Unzip the pack → open LinePulse → **Backtest / Replay** → **`📦 Data`** → **`📥 Import Files / Pack`** → select the `.json.gz` files.
2. **Via Folder Drop-In (Bulk):** Unzip and copy the `.json.gz` files directly into:
   - Local Web: `LinePulse/data/archive/`
   - macOS Desktop App: `~/Library/Application Support/LinePulse/linepulse-data/archive/`
   - Windows Desktop App: `%APPDATA%\LinePulse\linepulse-data\archive\`
   - Restart LinePulse — it will automatically unpack and index them on startup!
