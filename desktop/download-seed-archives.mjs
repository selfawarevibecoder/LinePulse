/**
 * Downloads 90 days of 1m historical candles for all 16 core Watchlist instruments
 * (Gold, Silver, EUR/USD, GBP/USD, EUR/GBP, USD/JPY, USD/CAD, AUD/USD, USD/CHF,
 * DXY, NAS100, SPX500, WTI Oil, Brent Oil, BTC/USDT, ETH/USDT) into data/archive/
 * AND builds compact gzip-compressed desktop/seed-archive/ for bundling into macOS/Win apps.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadConfig, getDataDir } from '../server/env.js';
import { downloadToArchive, listArchiveEntries } from '../server/archive.js';

loadConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, 'seed-archive');
const DAYS = Number(process.env.SEED_DAYS || 90);

const TARGETS = [
  { source: 'oanda', symbol: 'XAU_USD', display: 'XAU/USD' },
  { source: 'oanda', symbol: 'XAG_USD', display: 'XAG/USD' },
  { source: 'oanda', symbol: 'EUR_USD', display: 'EUR/USD' },
  { source: 'oanda', symbol: 'GBP_USD', display: 'GBP/USD' },
  { source: 'oanda', symbol: 'EUR_GBP', display: 'EUR/GBP' },
  { source: 'oanda', symbol: 'USD_JPY', display: 'USD/JPY' },
  { source: 'oanda', symbol: 'USD_CAD', display: 'USD/CAD' },
  { source: 'oanda', symbol: 'AUD_USD', display: 'AUD/USD' },
  { source: 'oanda', symbol: 'USD_CHF', display: 'USD/CHF' },
  { source: 'oanda', symbol: 'DXY', display: 'DXY' },
  { source: 'oanda', symbol: 'NAS100_USD', display: 'NAS100' },
  { source: 'oanda', symbol: 'SPX500_USD', display: 'SPX500' },
  { source: 'oanda', symbol: 'WTICO_USD', display: 'WTI Oil' },
  { source: 'oanda', symbol: 'BCO_USD', display: 'Brent Oil' },
  { source: 'binance', symbol: 'BTCUSDT', display: 'BTC/USDT' },
  { source: 'binance', symbol: 'ETHUSDT', display: 'ETH/USDT' },
];

const nowSec = Math.floor(Date.now() / 1000) - 60;
const fromSec = nowSec - DAYS * 86400;

console.log(`[Seed] Downloading ${DAYS} days of 1m history for ${TARGETS.length} pairs...`);

for (const t of TARGETS) {
  try {
    const res = await downloadToArchive({
      source: t.source,
      symbol: t.symbol,
      display: t.display,
      fromSec,
      toSec: nowSec,
      mode: 'range',
    });
    console.log(
      `  ✓ ${t.source.toUpperCase()} ${t.display}: +${res.addedBars} bars (total ${res.entry?.barCount || 0})`
    );
  } catch (err) {
    console.error(`  ✗ ${t.source.toUpperCase()} ${t.display}: ${err.message}`);
  }
}

// Package compressed .json.gz seed-archive/ for fast compact app bundling
fs.rmSync(SEED_DIR, { recursive: true, force: true });
fs.mkdirSync(SEED_DIR, { recursive: true });

const archiveDir = path.join(getDataDir(), 'archive');
const entries = listArchiveEntries().filter((e) =>
  TARGETS.some((t) => t.source === e.source && t.symbol === e.symbol)
);

let totalGzBytes = 0;
for (const e of entries) {
  const safeKey = `${e.source}__${String(e.symbol).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const srcJson = path.join(archiveDir, `${safeKey}.json`);
  if (!fs.existsSync(srcJson)) continue;
  const gz = zlib.gzipSync(fs.readFileSync(srcJson), { level: 9 });
  fs.writeFileSync(path.join(SEED_DIR, `${safeKey}.json.gz`), gz);
  totalGzBytes += gz.length;
}
fs.writeFileSync(path.join(SEED_DIR, 'index.json'), JSON.stringify({ entries }, null, 2), 'utf8');

console.log(
  `[Seed] Built desktop/seed-archive/ with ${entries.length} pairs (${(totalGzBytes / (1024 * 1024)).toFixed(2)} MB compressed)`
);
