/**
 * Builds:
 * 1. desktop/seed-archive-full/  (gzipped full offline archive for Personal macOS .dmg — ZERO API keys!)
 * 2. dist-desktop/LinePulse-1.3.0-Full-Data-Pack.zip  (shareable full offline dataset — ZERO API keys!)
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARCHIVE_DIR = path.join(ROOT, 'data', 'archive');
const FULL_SEED_DIR = path.join(__dirname, 'seed-archive-full');
const DIST_DIR = path.join(ROOT, 'dist-desktop');
const PACK_STAGING = path.join(DIST_DIR, '_full-data-pack-staging');
const PACK_ZIP = path.join(DIST_DIR, 'LinePulse-1.3.0-Full-Data-Pack.zip');

if (!fs.existsSync(path.join(ARCHIVE_DIR, 'index.json'))) {
  console.error('ERROR: data/archive/index.json not found');
  process.exit(1);
}

fs.rmSync(FULL_SEED_DIR, { recursive: true, force: true });
fs.mkdirSync(FULL_SEED_DIR, { recursive: true });

const indexData = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, 'index.json'), 'utf8'));
fs.writeFileSync(path.join(FULL_SEED_DIR, 'index.json'), JSON.stringify(indexData, null, 2), 'utf8');

let totalRawBytes = 0;
let totalGzBytes = 0;
let fileCount = 0;

for (const name of fs.readdirSync(ARCHIVE_DIR)) {
  if (!name.endsWith('.json') || name === 'index.json') continue;
  const fullPath = path.join(ARCHIVE_DIR, name);
  if (!fs.statSync(fullPath).isFile()) continue;
  const raw = fs.readFileSync(fullPath);
  const gz = zlib.gzipSync(raw, { level: 6 });
  fs.writeFileSync(path.join(FULL_SEED_DIR, `${name}.gz`), gz);
  totalRawBytes += raw.length;
  totalGzBytes += gz.length;
  fileCount += 1;
}

console.log(
  `[Full Data Pack] Compressed ${fileCount} archive files: ${(totalRawBytes / 1048576).toFixed(1)} MB raw -> ${(totalGzBytes / 1048576).toFixed(1)} MB gzipped`
);

// Build standalone shareable ZIP (ZERO secrets!)
fs.mkdirSync(DIST_DIR, { recursive: true });
fs.rmSync(PACK_STAGING, { recursive: true, force: true });
fs.mkdirSync(path.join(PACK_STAGING, 'LinePulse-Full-Data-Pack', 'archive-files'), { recursive: true });

for (const name of fs.readdirSync(FULL_SEED_DIR)) {
  fs.copyFileSync(
    path.join(FULL_SEED_DIR, name),
    path.join(PACK_STAGING, 'LinePulse-Full-Data-Pack', 'archive-files', name)
  );
}

const readmeLines = [
  'LinePulse v1.3.0 — Full Offline Market Data Pack (ZERO API Keys)',
  '================================================================',
  '',
  'Includes offline historical OHLC data (Hybrid 1h 2010-2019 + 1m 2020-2026 for CME Futures,',
  'plus OANDA FX/Metals/DXY/Indices/Oil and Binance Crypto):',
  '',
  ...(indexData.entries || []).map((e) => {
    const m1Start = e.firstTime ? new Date(e.firstTime * 1000).toISOString().slice(0, 10) : '--';
    const m1End = e.lastTime ? new Date(e.lastTime * 1000).toISOString().slice(0, 10) : '--';
    const h1Part = e.htf1hFirstTime
      ? ` | 1h: ${new Date(e.htf1hFirstTime * 1000).toISOString().slice(0, 10)}..${new Date(e.htf1hLastTime * 1000).toISOString().slice(0, 10)} (${Number(e.htf1hBarCount || 0).toLocaleString()} bars)`
      : '';
    return ` - [${String(e.source).toUpperCase()}] ${e.display}: 1m ${m1Start}..${m1End} (${Number(e.barCount || 0).toLocaleString()} bars)${h1Part}`;
  }),
  '',
  'HOW TO IMPORT INTO LINEPULSE (2 Easy Ways):',
  '-------------------------------------------',
  'Method 1 (Easiest — 1-Click Direct .ZIP Import Inside LinePulse! No Unzip Needed):',
  '  1. Open LinePulse -> Backtest / Replay -> "📦 Data" (Offline Archive).',
  '  2. Click "📦 Import .ZIP Pack / Files" and select this .zip file directly!',
  '  3. All instruments are automatically extracted & indexed in one click.',
  '',
  'Method 2 (Bulk Drop-In — Auto-Unpacks on Launch! No Terminal Needed):',
  '  Unzip this file and copy all .json.gz files from archive-files/ directly into:',
  '  - Local Web Package: LinePulse/data/archive/',
  '  - macOS Desktop App: ~/Library/Application Support/LinePulse/linepulse-data/archive/',
  '  - Windows Desktop App: %APPDATA%\\LinePulse\\linepulse-data\\archive\\',
  '  Then restart LinePulse — it automatically unpacks & indexes all pairs on startup!',
  '',
  'Note: This Data Pack contains ONLY market OHLC bars and ZERO API keys or personal data.',
];

fs.writeFileSync(
  path.join(PACK_STAGING, 'LinePulse-Full-Data-Pack', 'README.txt'),
  readmeLines.join('\n'),
  'utf8'
);

if (fs.existsSync(PACK_ZIP)) fs.unlinkSync(PACK_ZIP);
// Store already-gzipped files quickly (-0) so zip creation is instant and compact
execFileSync('zip', ['-r', '-0', PACK_ZIP, 'LinePulse-Full-Data-Pack'], {
  cwd: PACK_STAGING,
  stdio: 'inherit',
});
fs.rmSync(PACK_STAGING, { recursive: true, force: true });

const zipMb = (fs.statSync(PACK_ZIP).size / 1048576).toFixed(1);
console.log(`[Full Data Pack] Built ${PACK_ZIP} (${zipMb} MB)`);
