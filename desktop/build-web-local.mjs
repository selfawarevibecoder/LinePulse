import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist-desktop');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version || '1.2.0';

const STAGE_NAME = `LinePulse-${VERSION}-web-local`;
const STAGE_DIR = path.join(DIST, STAGE_NAME);
const ZIP_PATH = path.join(DIST, `${STAGE_NAME}.zip`);

fs.mkdirSync(DIST, { recursive: true });
fs.rmSync(STAGE_DIR, { recursive: true, force: true });
fs.rmSync(ZIP_PATH, { force: true });
fs.mkdirSync(STAGE_DIR, { recursive: true });

// 1. Copy zero-secret server/, public/ and compressed offline seed-archive/ (ZERO npm install needed!)
fs.cpSync(path.join(ROOT, 'server'), path.join(STAGE_DIR, 'server'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public'), path.join(STAGE_DIR, 'public'), { recursive: true });
const seedArchiveDir = path.join(__dirname, 'seed-archive');
if (fs.existsSync(seedArchiveDir)) {
  fs.cpSync(seedArchiveDir, path.join(STAGE_DIR, 'seed-archive'), { recursive: true });
}

// Clean standalone package.json (no external runtime dependencies required)
const webPkg = {
  name: 'linepulse-web-local',
  version: VERSION,
  description: 'LinePulse — Standalone Local Web Charting & FXReplay Backtest Server (Zero npm install)',
  type: 'module',
  scripts: {
    start: 'node server/index.js',
  },
};
fs.writeFileSync(path.join(STAGE_DIR, 'package.json'), JSON.stringify(webPkg, null, 2) + '\n', 'utf8');

// .env.example template (zero user secrets!)
const envExample = `# Optional: You can also enter these directly inside the app's Settings menu.
PORT=3456
HOST=127.0.0.1
OANDA_API_KEY=
OANDA_ACCOUNT_ID=
OANDA_ENV=practice
TWELVEDATA_API_KEY=
`;
fs.writeFileSync(path.join(STAGE_DIR, '.env.example'), envExample, 'utf8');

// 1-click macOS / Linux launcher (double-click in Finder -> starts server & opens browser!)
const macLauncher = `#!/bin/bash
cd "$(dirname "$0")"
PORT=\${PORT:-3456}
echo "Starting LinePulse Local Web Server on http://127.0.0.1:$PORT ..."
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 18+ is required. Download from https://nodejs.org"
  read -p "Press Enter to close..."
  exit 1
fi
(sleep 1.2 && open "http://127.0.0.1:$PORT" >/dev/null 2>&1 || true) &
node server/index.js
`;
const macPath = path.join(STAGE_DIR, 'Start-LinePulse-Mac.command');
fs.writeFileSync(macPath, macLauncher, 'utf8');
fs.chmodSync(macPath, 0o755);

// 1-click Windows launcher (double-click -> starts server & opens browser!)
const winLauncher = `@echo off
cd /d "%~dp0"
set PORT=3456
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js 18+ is required. Download from https://nodejs.org
  pause
  exit /b 1
)
echo Starting LinePulse Local Web Server on http://127.0.0.1:%PORT% ...
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:%PORT%"
node server/index.js
pause
`;
fs.writeFileSync(path.join(STAGE_DIR, 'Start-LinePulse-Windows.bat'), winLauncher, 'utf8');

// Clear quick-start README
const readme = `LinePulse v${VERSION} — Standalone Local Web Package
====================================================

Requirements: Node.js 18+ (https://nodejs.org)
No "npm install" required! All chart libraries are bundled offline.

How to Run:
-----------
- macOS:   Double-click "Start-LinePulse-Mac.command"
           (or run: node server/index.js)
- Windows: Double-click "Start-LinePulse-Windows.bat"
           (or run: node server/index.js)
- Browser: Opens automatically at http://127.0.0.1:3456

Features Included:
------------------
- Live OANDA (Practice/Live API key via Settings), CME Futures, Crypto (Binance/Coinbase/Bybit/Kraken), Stocks & Synthetic DXY
- FXReplay-Style Backtest Engine (1m..1W MTF, FTMO / The5ers / Custom Prop Rules, Spread & Commission)
- Shareable .linepulse.json Mentor Review Packs (export & import offline)
- Economic Calendar News with History & Actual/Forecast/Previous
- Multi-Screen / Multi-Pane Layouts, Drawings (Trend, Arrows, ZigZag, Box Opacity/Borderless, Long/Short R:R), Draggable Alerts

All your local settings, drawings, alerts, and backtest sessions are stored in the local "data/" folder inside this directory.
`;
fs.writeFileSync(path.join(STAGE_DIR, 'README.txt'), readme, 'utf8');

// Zip cleanly
execFileSync('zip', ['-r', '-q', ZIP_PATH, STAGE_NAME], { cwd: DIST });
console.log(`[LinePulse Web Local] Created ${ZIP_PATH}`);
