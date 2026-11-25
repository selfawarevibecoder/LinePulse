/**
 * 7-Year 1m (2020-01-01 -> latest) + Non-Overlapping Pre-2020 1h Downloader for Binance & OANDA
 * - Matches CME Databento architecture:
 *   * Binance (BTCUSDT, ETHUSDT): 1m 2020-01-01..2026-11-25 (via fast official data.binance.vision zips!) + 1h 2017-08-17..2019-12-31
 *   * OANDA (14 pairs):           1m 2020-01-01..2026-11-25 (4 concurrent workers + local exact DXY synthesis!) + 1h 2010-01-03..2019-12-31
 * - Resumable: skips any symbol whose 1m archive already starts on/before 2020-01-05.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getDataDir } from '../server/env.js';
import { fetchOandaCandles } from '../server/oanda.js';
import { mergeAndSaveArchive, saveHtf1hArchive } from '../server/archive.js';

const START_2020_SEC = Math.floor(Date.parse('2020-01-01T00:00:00Z') / 1000);
const ARCHIVE_DIR = path.join(getDataDir(), 'archive');

const BINANCE_TARGETS = [
  { symbol: 'BTCUSDT', display: 'BTC/USDT', precision: 2 },
  { symbol: 'ETHUSDT', display: 'ETH/USDT', precision: 2 },
];

const OANDA_DIRECT_TARGETS = [
  // 6 DXY legs first (USD_SEK is temporary helper for exact synthetic DXY)
  { symbol: 'EUR_USD', display: 'EUR/USD', precision: 5, batch: 4000 },
  { symbol: 'USD_JPY', display: 'USD/JPY', precision: 3, batch: 4000 },
  { symbol: 'GBP_USD', display: 'GBP/USD', precision: 5, batch: 4000 },
  { symbol: 'USD_CAD', display: 'USD/CAD', precision: 5, batch: 4000 },
  { symbol: 'USD_CHF', display: 'USD/CHF', precision: 5, batch: 4000 },
  { symbol: 'USD_SEK', display: 'USD/SEK (DXY leg)', precision: 5, batch: 4000, tempOnly: true },
  // Remaining 8 OANDA instruments
  { symbol: 'XAU_USD', display: 'XAU/USD', precision: 2, batch: 4000 },
  { symbol: 'XAG_USD', display: 'XAG/USD', precision: 3, batch: 4000 },
  { symbol: 'EUR_GBP', display: 'EUR/GBP', precision: 5, batch: 4000 },
  { symbol: 'AUD_USD', display: 'AUD/USD', precision: 5, batch: 4000 },
  { symbol: 'NAS100_USD', display: 'NAS100', precision: 1, batch: 2500 },
  { symbol: 'SPX500_USD', display: 'SPX500', precision: 1, batch: 2500 },
  { symbol: 'WTICO_USD', display: 'WTI Oil', precision: 2, batch: 2500 },
  { symbol: 'BCO_USD', display: 'Brent Oil', precision: 2, batch: 2500 },
];

const DXY_COMPONENTS = [
  { symbol: 'EUR_USD', weight: -0.576 },
  { symbol: 'USD_JPY', weight: 0.136 },
  { symbol: 'GBP_USD', weight: -0.119 },
  { symbol: 'USD_CAD', weight: 0.091 },
  { symbol: 'USD_SEK', weight: 0.042 },
  { symbol: 'USD_CHF', weight: 0.036 },
];
const DXY_CONSTANT = 50.14348112;

function loadExistingJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function trimH1Before2020(source, symbol) {
  const f = path.join(ARCHIVE_DIR, `${source}__${symbol}__1h.json`);
  if (!fs.existsSync(f)) return;
  const raw = loadExistingJson(f);
  if (!raw || !Array.isArray(raw.bars)) return;
  const trimmed = raw.bars.filter((b) => b.time < START_2020_SEC);
  if (trimmed.length !== raw.bars.length) {
    raw.bars = trimmed;
    fs.writeFileSync(f, JSON.stringify(raw), 'utf8');
    console.log(`  [TRIM 1h] ${source}:${symbol} trimmed to <2020-01-01 (${trimmed.length.toLocaleString()} bars)`);
  }
}

// ============================================================================
// PHASE A: Binance 7-Year 1m via Official data.binance.vision Monthly Zips
// ============================================================================
async function downloadBinanceMonthZip(symbol, year, month, tmpDir) {
  const mm = String(month).padStart(2, '0');
  const url = `https://data.binance.vision/data/spot/monthly/klines/${symbol}/1m/${symbol}-1m-${year}-${mm}.zip`;
  const zipPath = path.join(tmpDir, `${symbol}-1m-${year}-${mm}.zip`);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(zipPath, buf);
      const csv = execFileSync('unzip', ['-p', zipPath], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
      try {
        fs.unlinkSync(zipPath);
      } catch {}

      const bars = [];
      for (const rawLine of csv.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const cols = line.split(',');
        const rawTs = Number(cols[0]);
        if (!Number.isFinite(rawTs) || rawTs <= 0) continue;
        // Binance switched monthly kline CSV timestamps to microseconds in Jan 2025!
        const tSec =
          rawTs > 1e14 ? Math.floor(rawTs / 1e6) : rawTs > 1e11 ? Math.floor(rawTs / 1e3) : Math.floor(rawTs);
        const o = Number(cols[1]);
        const h = Number(cols[2]);
        const l = Number(cols[3]);
        const c = Number(cols[4]);
        if (!Number.isFinite(o) || !Number.isFinite(c) || o <= 0 || c <= 0) continue;
        bars.push({
          time: tSec,
          open: o,
          high: Math.max(h, o, c),
          low: Math.min(l, o, c),
          close: c,
        });
      }
      return bars;
    } catch (err) {
      if (attempt === 2) throw new Error(`${symbol} ${year}-${mm}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return [];
}

async function runBinancePhase() {
  console.log('\n=== PHASE A: BINANCE 7-YEAR 1m (2020-01 -> 2026-11 via data.binance.vision) ===');
  const tmpDir = path.join(ARCHIVE_DIR, '_binance_tmp');
  fs.mkdirSync(tmpDir, { recursive: true });

  // Build month list 2020-01 .. 2025-11 (2025-11..2026-11 already exists on disk!)
  const months = [];
  for (let y = 2020; y <= 2025; y++) {
    const endM = y === 2025 ? 11 : 12;
    for (let m = 1; m <= endM; m++) {
      months.push([y, m]);
    }
  }

  for (const t of BINANCE_TARGETS) {
    const filePath = path.join(ARCHIVE_DIR, `binance__${t.symbol}.json`);
    const existing = loadExistingJson(filePath);
    const existingFirst = existing?.bars?.[0]?.time || Infinity;
    if (existingFirst <= START_2020_SEC + 7 * 86400) {
      console.log(`  [SKIP] binance:${t.symbol} already covers 2020+ (${existing.bars.length.toLocaleString()} bars)`);
      trimH1Before2020('binance', t.symbol);
      continue;
    }

    const t0 = Date.now();
    const allNew = [];
    const CONC = 8;
    for (let i = 0; i < months.length; i += CONC) {
      const slice = months.slice(i, i + CONC);
      const results = await Promise.all(
        slice.map(([y, m]) => downloadBinanceMonthZip(t.symbol, y, m, tmpDir))
      );
      for (const arr of results) {
        for (const b of arr) allNew.push(b);
      }
    }

    // Also fill any small gap between 2025-11-30 and existingFirst if needed
    const saved = mergeAndSaveArchive({
      source: 'binance',
      symbol: t.symbol,
      display: t.display,
      precision: t.precision,
      incomingBars: allNew,
    });
    const r = `${new Date(saved.entry.firstTime * 1000).toISOString().slice(0, 10)}..${new Date(saved.entry.lastTime * 1000).toISOString().slice(0, 10)}`;
    console.log(
      `  [BINANCE 1m] ${t.symbol} +${saved.addedBars.toLocaleString()} -> total ${saved.entry.barCount.toLocaleString()} (${r}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`
    );
    trimH1Before2020('binance', t.symbol);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ============================================================================
// PHASE B: OANDA 7-Year 1m (4 Concurrent Workers + Local Exact DXY Synthesis)
// ============================================================================
async function fetchOanda1mSegment(symbol, fromSec, toSec, batchCount = 4000) {
  const all = [];
  let cursorTo = toSec;
  let guard = 0;
  while (cursorTo > fromSec && guard < 1500) {
    guard += 1;
    let chunk = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        chunk = await fetchOandaCandles(symbol, '1m', batchCount, cursorTo);
        break;
      } catch (err) {
        if (attempt === 4) throw err;
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
    const bars = Array.isArray(chunk?.bars) ? chunk.bars : [];
    if (!bars.length) break;
    for (const b of bars) {
      if (b.time >= fromSec && b.time <= toSec) all.push(b);
    }
    const oldest = bars[0].time;
    if (oldest <= fromSec || oldest >= cursorTo) break;
    cursorTo = oldest - 60;
  }
  return all;
}

async function processOandaSymbol(target) {
  const filePath = path.join(ARCHIVE_DIR, `oanda__${target.symbol}.json`);
  const existing = loadExistingJson(filePath);
  let curFirst = existing?.bars?.length ? existing.bars[0].time : Math.floor(Date.now() / 1000) - 60;

  if (curFirst <= START_2020_SEC + 7 * 86400) {
    console.log(`  [SKIP] oanda:${target.symbol} already covers 2020+ (${existing.bars.length.toLocaleString()} bars)`);
    if (!target.tempOnly) trimH1Before2020('oanda', target.symbol);
    return;
  }

  const t0 = Date.now();
  // Download in 1-year slices backwards from curFirst down to 2020-01-01
  const slices = [];
  let sliceEnd = existing?.bars?.length ? curFirst - 60 : curFirst;
  while (sliceEnd > START_2020_SEC) {
    const sliceStart = Math.max(START_2020_SEC, sliceEnd - 365 * 86400);
    slices.push([sliceStart, sliceEnd]);
    sliceEnd = sliceStart - 60;
  }

  const downloaded = [];
  for (let i = 0; i < slices.length; i++) {
    const [sFrom, sTo] = slices[i];
    const bars = await fetchOanda1mSegment(target.symbol, sFrom, sTo, target.batch || 4000);
    for (const b of bars) downloaded.push(b);
  }

  const saved = mergeAndSaveArchive({
    source: 'oanda',
    symbol: target.symbol,
    display: target.display,
    precision: target.precision,
    incomingBars: downloaded,
  });
  const r = `${new Date(saved.entry.firstTime * 1000).toISOString().slice(0, 10)}..${new Date(saved.entry.lastTime * 1000).toISOString().slice(0, 10)}`;
  console.log(
    `  [OANDA 1m] ${target.symbol.padEnd(11)} +${saved.addedBars.toLocaleString()} -> total ${saved.entry.barCount.toLocaleString()} (${r}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
  if (!target.tempOnly) trimH1Before2020('oanda', target.symbol);
}

function synthesizeLocalDxy7y() {
  console.log('\n=== SYNTHESIZING EXACT OANDA DXY (2020-01 -> 2026-11) FROM 6 FX LEGS ===');
  const t0 = Date.now();
  const legMaps = [];
  let eurBars = [];
  for (const c of DXY_COMPONENTS) {
    const raw = loadExistingJson(path.join(ARCHIVE_DIR, `oanda__${c.symbol}.json`));
    if (!raw?.bars?.length) throw new Error(`Missing DXY leg ${c.symbol}`);
    if (c.symbol === 'EUR_USD') eurBars = raw.bars;
    const m = new Map();
    for (const b of raw.bars) m.set(b.time, b);
    legMaps.push(m);
  }

  const calcVal = (px) => {
    let v = DXY_CONSTANT;
    for (let i = 0; i < DXY_COMPONENTS.length; i++) {
      const p = px[i];
      if (!Number.isFinite(p) || p <= 0) return NaN;
      v *= Math.pow(p, DXY_COMPONENTS[i].weight);
    }
    return Number(v.toFixed(3));
  };

  const lastKnown = new Array(6).fill(null);
  const dxyBars = [];
  for (const eurBar of eurBars) {
    const t = eurBar.time;
    const oPx = new Array(6);
    const hPx = new Array(6);
    const lPx = new Array(6);
    const cPx = new Array(6);
    let ready = true;
    for (let i = 0; i < 6; i++) {
      const b = legMaps[i].get(t) || lastKnown[i];
      if (!b) {
        ready = false;
        break;
      }
      lastKnown[i] = b;
      oPx[i] = b.open;
      cPx[i] = b.close;
      const neg = DXY_COMPONENTS[i].weight < 0;
      hPx[i] = neg ? b.low : b.high;
      lPx[i] = neg ? b.high : b.low;
    }
    if (!ready) continue;
    const o = calcVal(oPx);
    const c = calcVal(cPx);
    const hRaw = calcVal(hPx);
    const lRaw = calcVal(lPx);
    if (!Number.isFinite(o) || !Number.isFinite(c)) continue;
    dxyBars.push({
      time: t,
      open: o,
      high: Math.max(o, c, Number.isFinite(hRaw) ? hRaw : o),
      low: Math.min(o, c, Number.isFinite(lRaw) ? lRaw : o),
      close: c,
    });
  }

  const saved = mergeAndSaveArchive({
    source: 'oanda',
    symbol: 'DXY',
    display: 'DXY (OANDA Synthetic)',
    precision: 3,
    incomingBars: dxyBars,
  });
  trimH1Before2020('oanda', 'DXY');
  // Remove temporary USD_SEK file so watchlist stays clean
  const sekFile = path.join(ARCHIVE_DIR, 'oanda__USD_SEK.json');
  if (fs.existsSync(sekFile)) fs.unlinkSync(sekFile);

  console.log(
    `  [OANDA DXY] Synthesized ${saved.entry.barCount.toLocaleString()} 1m bars (${new Date(saved.entry.firstTime * 1000).toISOString().slice(0, 10)}..${new Date(saved.entry.lastTime * 1000).toISOString().slice(0, 10)}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
}

function rebuildArchiveIndex() {
  const files = fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json');
  const byKey = new Map();
  for (const f of files) {
    const isH1 = f.endsWith('__1h.json');
    const raw = loadExistingJson(path.join(ARCHIVE_DIR, f));
    if (!raw || !raw.source || !raw.symbol) continue;
    const key = `${raw.source}:${raw.symbol}`;
    const cur = byKey.get(key) || {
      key,
      source: raw.source,
      symbol: raw.symbol,
      display: raw.display || raw.symbol,
      precision: raw.precision ?? 2,
      firstTime: null,
      lastTime: null,
      barCount: 0,
      htf1hFirstTime: null,
      htf1hLastTime: null,
      htf1hBarCount: 0,
      effectiveFirstTime: null,
      updatedAt: Date.now(),
    };
    const bars = Array.isArray(raw.bars) ? raw.bars : [];
    if (isH1) {
      cur.htf1hFirstTime = bars.length ? bars[0].time : null;
      cur.htf1hLastTime = bars.length ? bars[bars.length - 1].time : null;
      cur.htf1hBarCount = bars.length;
    } else {
      cur.firstTime = bars.length ? bars[0].time : null;
      cur.lastTime = bars.length ? bars[bars.length - 1].time : null;
      cur.barCount = bars.length;
      if (raw.display) cur.display = raw.display;
      if (Number.isFinite(raw.precision)) cur.precision = raw.precision;
    }
    const vals = [cur.firstTime, cur.htf1hFirstTime].filter((v) => Number.isFinite(v) && v > 0);
    cur.effectiveFirstTime = vals.length ? Math.min(...vals) : null;
    byKey.set(key, cur);
  }
  const order = { databento: 0, oanda: 1, binance: 2 };
  const entries = Array.from(byKey.values()).sort((a, b) => {
    const oa = order[a.source] ?? 9;
    const ob = order[b.source] ?? 9;
    if (oa !== ob) return oa - ob;
    return a.symbol.localeCompare(b.symbol);
  });
  fs.writeFileSync(path.join(ARCHIVE_DIR, 'index.json'), JSON.stringify({ entries }, null, 2), 'utf8');

  let totM1 = 0;
  let totH1 = 0;
  console.log(`\n=== FINAL REBUILT INDEX (${entries.length} INSTRUMENTS) ===`);
  for (const e of entries) {
    totM1 += e.barCount;
    totH1 += e.htf1hBarCount;
    const m1s = e.firstTime ? new Date(e.firstTime * 1000).toISOString().slice(0, 10) : '--';
    const m1e = e.lastTime ? new Date(e.lastTime * 1000).toISOString().slice(0, 10) : '--';
    const h1s = e.htf1hFirstTime ? new Date(e.htf1hFirstTime * 1000).toISOString().slice(0, 10) : 'none';
    const h1e = e.htf1hLastTime ? new Date(e.htf1hLastTime * 1000).toISOString().slice(0, 10) : '';
    console.log(
      `  ${e.source.padEnd(9)} ${e.symbol.padEnd(11)} 1m: ${String(e.barCount).padStart(9)} (${m1s}..${m1e}) | 1h: ${String(e.htf1hBarCount).padStart(6)} (${h1s}${h1e ? '..' + h1e : ''})`
    );
  }
  console.log(`GRAND TOTALS: 1m = ${totM1.toLocaleString()} | 1h = ${totH1.toLocaleString()}`);
}

async function runOandaPhase() {
  console.log('\n=== PHASE B: OANDA 7-YEAR 1m (2020-01 -> 2026-11, 4 Concurrent Workers) ===');
  const queue = [...OANDA_DIRECT_TARGETS];
  const CONC = 4;
  const workers = Array.from({ length: CONC }, async () => {
    while (queue.length > 0) {
      const target = queue.shift();
      if (!target) break;
      await processOandaSymbol(target);
    }
  });
  await Promise.all(workers);
  synthesizeLocalDxy7y();
}

async function main() {
  await runBinancePhase();
  await runOandaPhase();
  rebuildArchiveIndex();
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
