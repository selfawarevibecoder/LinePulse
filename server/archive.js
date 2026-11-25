/**
 * LinePulse Offline Backtest Data Archive & Incremental Delta Sync Engine
 * - Stores local 1m historical candles per symbol in data/archive/<src>__<sym>.json
 * - Supports optional pre-1m HTF 1h archives in data/archive/<src>__<sym>__1h.json
 *   for seamless 2010–2026 1h/4h/12h/1D/1W backtesting + 2020–2026 1m precision!
 * - Supports:
 *   1. Dukascopy Bank (100% Free, 2003+ FX, Gold, Silver, DXY & Indices — pure-JS LZMA .bi5)
 *   2. OANDA v20 (Free Practice API, 2005+/2015+ 1m & 1h FX, Gold, Indices & Synthetic DXY)
 *   3. Databento GLBX.MDP3 (Official CME Futures 2010+ via user's API key / $125 free credit)
 *   4. Binance / Coinbase / Bybit (Free 2017+ 1m & 1h Crypto)
 *   5. CSV / JSON / .json.gz Data Pack Import
 * - Smart Incremental Delta Sync ("Update Missing" & "Extend Older"): fetches ONLY missing bars!
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { getConfig, getDataDir, ROOT_DIR } from './env.js';
import { decompressLzma } from './lzma-mini.js';
import { fetchOandaCandles } from './oanda.js';
import { fetchCryptoHistory, CRYPTO_SOURCES } from './crypto.js';
import { parseTimeframe, resampleOhlc } from './timeframes.js';

export const DUKASCOPY_SPECS = {
  EURUSD: { display: 'EUR/USD', divisor: 100000, precision: 5 },
  GBPUSD: { display: 'GBP/USD', divisor: 100000, precision: 5 },
  USDCAD: { display: 'USD/CAD', divisor: 100000, precision: 5 },
  AUDUSD: { display: 'AUD/USD', divisor: 100000, precision: 5 },
  NZDUSD: { display: 'NZD/USD', divisor: 100000, precision: 5 },
  USDCHF: { display: 'USD/CHF', divisor: 100000, precision: 5 },
  EURGBP: { display: 'EUR/GBP', divisor: 100000, precision: 5 },
  USDJPY: { display: 'USD/JPY', divisor: 1000, precision: 3 },
  EURJPY: { display: 'EUR/JPY', divisor: 1000, precision: 3 },
  GBPJPY: { display: 'GBP/JPY', divisor: 1000, precision: 3 },
  XAUUSD: { display: 'XAU/USD', divisor: 1000, precision: 2 },
  XAGUSD: { display: 'XAG/USD', divisor: 1000, precision: 3 },
  DOLLARIDXUSD: { display: 'DXY (Dukascopy)', divisor: 1000, precision: 3 },
  USATECHIDXUSD: { display: 'NAS100 (Dukascopy)', divisor: 1000, precision: 1 },
  USA500IDXUSD: { display: 'SPX500 (Dukascopy)', divisor: 1000, precision: 1 },
  USA30IDXUSD: { display: 'US30 (Dukascopy)', divisor: 1000, precision: 1 },
  LIGHTCMDUSD: { display: 'WTI Oil (Dukascopy)', divisor: 1000, precision: 2 },
  BRENTCMDUSD: { display: 'Brent Oil (Dukascopy)', divisor: 1000, precision: 2 },
  BTCUSD: { display: 'BTC/USD (Dukascopy)', divisor: 10, precision: 1 },
  ETHUSD: { display: 'ETH/USD (Dukascopy)', divisor: 10, precision: 2 },
};

export const DATABENTO_SPECS = {
  '6E.v.0': { display: '6E1! (CME Euro FX)', precision: 5 },
  '6B.v.0': { display: '6B1! (CME British Pound)', precision: 5 },
  'GC.v.0': { display: 'GC1! (COMEX Gold)', precision: 2 },
  'SI.v.0': { display: 'SI1! (COMEX Silver)', precision: 3 },
  'ES.v.0': { display: 'ES1! (CME S&P 500)', precision: 2 },
  'NQ.v.0': { display: 'NQ1! (CME Nasdaq-100)', precision: 2 },
  'CL.v.0': { display: 'CL1! (NYMEX WTI Oil)', precision: 2 },
  'BZ.v.0': { display: 'BZ1! (NYMEX Brent Oil)', precision: 2 },
  '6C.v.0': { display: '6C1! (CME Canadian Dollar)', precision: 5 },
  '6S.v.0': { display: '6S1! (CME Swiss Franc)', precision: 5 },
  '6A.v.0': { display: '6A1! (CME Australian Dollar)', precision: 5 },
  '6J.v.0': { display: '6J1! (CME Japanese Yen)', precision: 6 },
  'BTC.v.0': { display: 'BTC1! (CME Bitcoin)', precision: 1 },
  'ETH.v.0': { display: 'ETH1! (CME Ether)', precision: 2 },
  'YM.v.0': { display: 'YM1! (CBOT Dow)', precision: 1 },
};

let seedHydrated = false;
let dropinChecked = false;

// Automatically unpack any .json.gz Data Pack files dropped directly into data/archive/
function unpackDropInGzFiles(targetDir) {
  if (dropinChecked) return;
  dropinChecked = true;
  if (!fs.existsSync(targetDir)) return;
  try {
    const gzFiles = fs.readdirSync(targetDir).filter((f) => f.endsWith('.json.gz'));
    if (!gzFiles.length) return;
    const indexFile = path.join(targetDir, 'index.json');
    let existing = [];
    if (fs.existsSync(indexFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
        existing = Array.isArray(parsed.entries) ? parsed.entries : [];
      } catch {
        existing = [];
      }
    }
    const byKey = new Map(existing.map((e) => [e.key, e]));
    let changed = false;

    for (const gzName of gzFiles) {
      const gzPath = path.join(targetDir, gzName);
      const jsonName = gzName.slice(0, -3); // remove .gz
      const jsonPath = path.join(targetDir, jsonName);
      const rawBuf = zlib.gunzipSync(fs.readFileSync(gzPath));
      fs.writeFileSync(jsonPath, rawBuf);
      try {
        const parsed = JSON.parse(rawBuf.toString('utf8'));
        if (parsed && parsed.source && parsed.symbol && Array.isArray(parsed.bars)) {
          const src = String(parsed.source).toLowerCase();
          const key = `${src}:${parsed.symbol}`;
          const cur = byKey.get(key) || {
            key,
            source: src,
            symbol: parsed.symbol,
            display: parsed.display || parsed.symbol,
            precision: parsed.precision ?? 2,
            firstTime: null,
            lastTime: null,
            barCount: 0,
            htf1hFirstTime: null,
            htf1hLastTime: null,
            htf1hBarCount: 0,
            effectiveFirstTime: null,
            updatedAt: Date.now(),
          };
          const bars = parsed.bars;
          if (parsed.resolution === '1h' || jsonName.endsWith('__1h.json')) {
            cur.htf1hFirstTime = bars.length ? bars[0].time : null;
            cur.htf1hLastTime = bars.length ? bars[bars.length - 1].time : null;
            cur.htf1hBarCount = bars.length;
          } else {
            cur.firstTime = bars.length ? bars[0].time : null;
            cur.lastTime = bars.length ? bars[bars.length - 1].time : null;
            cur.barCount = bars.length;
            if (parsed.display) cur.display = parsed.display;
            if (Number.isFinite(parsed.precision)) cur.precision = parsed.precision;
          }
          cur.effectiveFirstTime = computeEffectiveFirstTime(cur.firstTime, cur.htf1hFirstTime);
          cur.updatedAt = Date.now();
          byKey.set(key, cur);
          changed = true;
        }
      } catch {
        // ignore malformed json
      }
      // Remove consumed .json.gz so startup doesn't re-unpack it on next launch
      try {
        fs.unlinkSync(gzPath);
      } catch {
        // ignore
      }
    }

    if (changed) {
      fs.writeFileSync(indexFile, JSON.stringify({ entries: Array.from(byKey.values()) }, null, 2), 'utf8');
    }
  } catch {
    // non-fatal drop-in unpack error
  }
}

// Small LRU cache of 1h rollups computed from large 1m files so 1h/4h/1D/1W switches are <5ms
const HTF_ROLLUP_CACHE = new Map();
const HTF_ROLLUP_MAX = 8;

function copyOrGunzip(seedDir, targetDir, baseName) {
  const gzSrc = path.join(seedDir, `${baseName}.json.gz`);
  const jsonSrc = path.join(seedDir, `${baseName}.json`);
  const destFile = path.join(targetDir, `${baseName}.json`);
  if (fs.existsSync(gzSrc)) {
    const inflated = zlib.gunzipSync(fs.readFileSync(gzSrc));
    fs.writeFileSync(destFile, inflated);
    return true;
  }
  if (fs.existsSync(jsonSrc)) {
    fs.copyFileSync(jsonSrc, destFile);
    return true;
  }
  return false;
}

function hydrateSeedArchiveOnce() {
  if (seedHydrated) return;
  seedHydrated = true;
  const seedDir = path.join(ROOT_DIR, 'seed-archive');
  if (!fs.existsSync(seedDir)) return;
  const seedIndexFile = path.join(seedDir, 'index.json');
  if (!fs.existsSync(seedIndexFile)) return;
  try {
    const seedParsed = JSON.parse(fs.readFileSync(seedIndexFile, 'utf8'));
    const seedEntries = Array.isArray(seedParsed.entries) ? seedParsed.entries : [];
    if (!seedEntries.length) return;

    const targetDir = path.join(getDataDir(), 'archive');
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const targetIndexFile = path.join(targetDir, 'index.json');
    let existingEntries = [];
    if (fs.existsSync(targetIndexFile)) {
      try {
        const cur = JSON.parse(fs.readFileSync(targetIndexFile, 'utf8'));
        existingEntries = Array.isArray(cur.entries) ? cur.entries : [];
      } catch {
        existingEntries = [];
      }
    }
    const existingByKey = new Map(existingEntries.map((e) => [e.key, e]));
    let changed = false;

    for (const entry of seedEntries) {
      if (!entry?.key) continue;
      const cur = existingByKey.get(entry.key);
      const base = safeFileKey(entry.source, entry.symbol);
      const needM1 = !cur || (Number(entry.barCount || 0) > Number(cur.barCount || 0));
      const needH1 =
        Number(entry.htf1hBarCount || 0) > 0 &&
        (!cur || Number(entry.htf1hBarCount || 0) > Number(cur.htf1hBarCount || 0));

      if (!needM1 && !needH1) continue;

      let hydratedAny = false;
      if (needM1 && copyOrGunzip(seedDir, targetDir, base)) {
        hydratedAny = true;
      }
      if (needH1 && copyOrGunzip(seedDir, targetDir, `${base}__1h`)) {
        hydratedAny = true;
      }

      if (hydratedAny) {
        const mergedEntry = {
          ...(cur || {}),
          ...entry,
          // Preserve existing m1 fields if we only upgraded h1
          ...(needM1
            ? {}
            : {
                firstTime: cur.firstTime,
                lastTime: cur.lastTime,
                barCount: cur.barCount,
              }),
          effectiveFirstTime: computeEffectiveFirstTime(
            needM1 ? entry.firstTime : cur?.firstTime,
            needH1 ? entry.htf1hFirstTime : cur?.htf1hFirstTime
          ),
        };
        existingByKey.set(entry.key, mergedEntry);
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(
        targetIndexFile,
        JSON.stringify({ entries: Array.from(existingByKey.values()) }, null, 2),
        'utf8'
      );
    }
  } catch {
    // non-fatal seed hydration error
  }
}

function computeEffectiveFirstTime(m1First, h1First) {
  const vals = [m1First, h1First].filter((v) => Number.isFinite(v) && v > 0);
  return vals.length ? Math.min(...vals) : null;
}

export function getArchiveDir() {
  hydrateSeedArchiveOnce();
  const dir = path.join(getDataDir(), 'archive');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  unpackDropInGzFiles(dir);
  return dir;
}

function getIndexFile() {
  return path.join(getArchiveDir(), 'index.json');
}

export function safeFileKey(source, symbol) {
  const cleanSrc = String(source || 'custom').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const cleanSym = String(symbol || 'SYM').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${cleanSrc}__${cleanSym}`;
}

function getArchiveDataFile(source, symbol) {
  return path.join(getArchiveDir(), `${safeFileKey(source, symbol)}.json`);
}

function getArchiveHtf1hFile(source, symbol) {
  return path.join(getArchiveDir(), `${safeFileKey(source, symbol)}__1h.json`);
}

function readIndex() {
  const f = getIndexFile();
  if (!fs.existsSync(f)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

function writeIndex(entries) {
  fs.writeFileSync(getIndexFile(), JSON.stringify({ entries }, null, 2), 'utf8');
}

export function listArchiveEntries() {
  return readIndex().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function deleteArchiveEntry(source, symbol) {
  const key = `${String(source).toLowerCase()}:${symbol}`;
  for (const f of [getArchiveDataFile(source, symbol), getArchiveHtf1hFile(source, symbol)]) {
    if (fs.existsSync(f)) {
      try {
        fs.unlinkSync(f);
      } catch {
        // ignore
      }
    }
  }
  HTF_ROLLUP_CACHE.delete(key);
  const next = readIndex().filter((e) => e.key !== key);
  writeIndex(next);
  return next;
}

function inferPrecisionFromSymbol(source, symbol, samplePrice = 1) {
  const s = String(symbol || '').toUpperCase();
  if (source === 'dukascopy' && DUKASCOPY_SPECS[s]) return DUKASCOPY_SPECS[s].precision;
  if (source === 'databento' && DATABENTO_SPECS[symbol]) return DATABENTO_SPECS[symbol].precision;
  if (s.includes('XAU') || s.includes('GC')) return 2;
  if (s.includes('XAG') || s.includes('SI.')) return 3;
  if (s.includes('DXY') || s.includes('DOLLARIDX') || s.includes('JPY')) return 3;
  if (s.includes('NAS100') || s.includes('SPX500') || s.includes('US30') || s.includes('IDX')) return 1;
  if (s.includes('NQ') || s.includes('ES') || s.includes('ETH') || s.includes('CL.') || s.includes('BZ.')) return 2;
  if (s.includes('BTC')) return 1;
  if (samplePrice >= 100) return 2;
  if (samplePrice >= 10) return 3;
  return 5;
}

function loadRawArchiveFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(parsed.bars)) return parsed;
  } catch {
    // ignore
  }
  return null;
}

function loadRawArchive(source, symbol) {
  return loadRawArchiveFile(getArchiveDataFile(source, symbol));
}

function loadRawHtf1hArchive(source, symbol) {
  return loadRawArchiveFile(getArchiveHtf1hFile(source, symbol));
}

function normalizeBarMap(existingBars, incomingBars) {
  const byTime = new Map();
  if (Array.isArray(existingBars)) {
    for (const b of existingBars) {
      if (b && Number.isFinite(b.time) && Number.isFinite(b.close)) {
        byTime.set(b.time, b);
      }
    }
  }
  const beforeCount = byTime.size;
  for (const b of incomingBars || []) {
    if (
      b &&
      Number.isFinite(b.time) &&
      Number.isFinite(b.open) &&
      Number.isFinite(b.high) &&
      Number.isFinite(b.low) &&
      Number.isFinite(b.close) &&
      b.open > 0 &&
      b.close > 0
    ) {
      const t = Math.floor(b.time);
      byTime.set(t, {
        time: t,
        open: b.open,
        high: Math.max(b.high, b.open, b.close),
        low: Math.min(b.low, b.open, b.close),
        close: b.close,
      });
    }
  }
  const merged = Array.from(byTime.values()).sort((a, b) => a.time - b.time);
  const addedBars = Math.max(0, merged.length - beforeCount);
  return { merged, addedBars };
}

export function mergeAndSaveArchive({ source, symbol, display, precision, incomingBars }) {
  const src = String(source || 'custom').toLowerCase();
  const existing = loadRawArchive(src, symbol);
  const { merged, addedBars } = normalizeBarMap(existing?.bars, incomingBars);

  const samplePx = merged.length ? merged[merged.length - 1].close : 1;
  const finalPrecision =
    Number.isFinite(precision) ? precision : existing?.precision ?? inferPrecisionFromSymbol(src, symbol, samplePx);
  const finalDisplay =
    display ||
    existing?.display ||
    DUKASCOPY_SPECS[String(symbol).toUpperCase()]?.display ||
    DATABENTO_SPECS[symbol]?.display ||
    symbol;

  const payload = {
    source: src,
    symbol,
    display: finalDisplay,
    precision: finalPrecision,
    bars: merged,
  };
  fs.writeFileSync(getArchiveDataFile(src, symbol), JSON.stringify(payload), 'utf8');

  const key = `${src}:${symbol}`;
  HTF_ROLLUP_CACHE.delete(key);

  const allEntries = readIndex();
  const prevEntry = allEntries.find((e) => e.key === key) || {};
  const m1First = merged.length ? merged[0].time : null;
  const m1Last = merged.length ? merged[merged.length - 1].time : null;

  const entry = {
    ...prevEntry,
    key,
    source: src,
    symbol,
    display: finalDisplay,
    precision: finalPrecision,
    firstTime: m1First,
    lastTime: m1Last,
    barCount: merged.length,
    effectiveFirstTime: computeEffectiveFirstTime(m1First, prevEntry.htf1hFirstTime),
    updatedAt: Date.now(),
  };

  const entries = allEntries.filter((e) => e.key !== key);
  entries.unshift(entry);
  writeIndex(entries);

  return { entry, addedBars, entries };
}

export function saveHtf1hArchive({ source, symbol, display, precision, incomingBars }) {
  const src = String(source || 'custom').toLowerCase();
  const existing = loadRawHtf1hArchive(src, symbol);
  const { merged, addedBars } = normalizeBarMap(existing?.bars, incomingBars);

  const samplePx = merged.length ? merged[merged.length - 1].close : 1;
  const finalPrecision =
    Number.isFinite(precision) ? precision : existing?.precision ?? inferPrecisionFromSymbol(src, symbol, samplePx);
  const finalDisplay =
    display ||
    existing?.display ||
    DUKASCOPY_SPECS[String(symbol).toUpperCase()]?.display ||
    DATABENTO_SPECS[symbol]?.display ||
    symbol;

  const payload = {
    source: src,
    symbol,
    display: finalDisplay,
    precision: finalPrecision,
    resolution: '1h',
    bars: merged,
  };
  fs.writeFileSync(getArchiveHtf1hFile(src, symbol), JSON.stringify(payload), 'utf8');

  const key = `${src}:${symbol}`;
  const allEntries = readIndex();
  const prevEntry = allEntries.find((e) => e.key === key) || {};
  const h1First = merged.length ? merged[0].time : null;
  const h1Last = merged.length ? merged[merged.length - 1].time : null;

  const entry = {
    ...prevEntry,
    key,
    source: src,
    symbol,
    display: prevEntry.display || finalDisplay,
    precision: prevEntry.precision ?? finalPrecision,
    firstTime: prevEntry.firstTime ?? null,
    lastTime: prevEntry.lastTime ?? null,
    barCount: prevEntry.barCount ?? 0,
    htf1hFirstTime: h1First,
    htf1hLastTime: h1Last,
    htf1hBarCount: merged.length,
    effectiveFirstTime: computeEffectiveFirstTime(prevEntry.firstTime, h1First),
    updatedAt: Date.now(),
  };

  const entries = allEntries.filter((e) => e.key !== key);
  entries.unshift(entry);
  writeIndex(entries);

  return { entry, addedBars, entries };
}

// ============================================================================
// 1. Dukascopy Bank Native Pure-JS Downloader (100% Free, 2003+ 1m)
// ============================================================================
function getDukascopyDivisor(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (DUKASCOPY_SPECS[s]) return DUKASCOPY_SPECS[s].divisor;
  if (s.includes('JPY') || s.includes('XAU') || s.includes('XAG') || s.includes('IDX')) return 1000;
  return 100000;
}

async function fetchDukascopyDayM1(symbol, year, month0, day) {
  const sym = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const mm = String(month0).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const url = `http://datafeed.dukascopy.com/datafeed/${encodeURIComponent(sym)}/${year}/${mm}/${dd}/BID_candles_min_1.bi5`;
  let res = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (res.status === 429 || res.status === 503) {
      await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
      continue;
    }
    break;
  }
  if (!res || res.status === 404 || res.status === 403) return [];
  if (!res.ok) throw new Error(`Dukascopy HTTP ${res.status}`);
  const ab = new Uint8Array(await res.arrayBuffer());
  if (ab.length < 13) return [];

  const raw = decompressLzma(ab);
  if (raw.length < 24) return [];

  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const divisor = getDukascopyDivisor(sym);
  const dayStartSec = Math.floor(Date.UTC(year, month0, day) / 1000);
  const count = Math.floor(raw.length / 24);
  const out = [];

  for (let i = 0; i < count; i++) {
    const off = i * 24;
    const secOff = dv.getUint32(off, false);
    const open = dv.getUint32(off + 4, false) / divisor;
    const close = dv.getUint32(off + 8, false) / divisor;
    const low = dv.getUint32(off + 12, false) / divisor;
    const high = dv.getUint32(off + 16, false) / divisor;
    const vol = dv.getFloat32(off + 20, false);
    if (open <= 0 || close <= 0) continue;
    if (vol === 0 && open === high && high === low && low === close) continue;
    out.push({
      time: dayStartSec + secOff,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
    });
  }
  return out;
}

export async function fetchDukascopyRange(symbol, fromSec, toSec) {
  const startDayMs = Math.floor(fromSec / 86400) * 86400 * 1000;
  const endDayMs = Math.floor(toSec / 86400) * 86400 * 1000;
  const days = [];
  for (let ms = startDayMs; ms <= endDayMs; ms += 86400 * 1000) {
    const d = new Date(ms);
    if (d.getUTCDay() === 6) continue;
    days.push({ y: d.getUTCFullYear(), m0: d.getUTCMonth(), d: d.getUTCDate() });
  }
  if (days.length > 400) {
    throw new Error('Please download at most ~1 year (400 days) per request — you can extend older ranges in chunks.');
  }

  const allBars = [];
  const CONCURRENCY = 2;
  for (let i = 0; i < days.length; i += CONCURRENCY) {
    const chunk = days.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map((dt) => fetchDukascopyDayM1(symbol, dt.y, dt.m0, dt.d).catch(() => []))
    );
    for (const arr of results) {
      for (const b of arr) {
        if (b.time >= fromSec && b.time <= toSec) allBars.push(b);
      }
    }
    if (i + CONCURRENCY < days.length) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  return allBars;
}

// ============================================================================
// 2. Databento Official CME GLBX.MDP3 Historical Downloader (Chunked CSV)
// ============================================================================
function parseDatabentoCsv(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const tsIdx = headers.indexOf('ts_event');
  const oIdx = headers.indexOf('open');
  const hIdx = headers.indexOf('high');
  const lIdx = headers.indexOf('low');
  const cIdx = headers.indexOf('close');
  if (tsIdx < 0 || oIdx < 0 || cIdx < 0) return [];

  const normPx = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return NaN;
    return Math.abs(n) > 1e8 ? n / 1e9 : n;
  };

  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',');
    const rawTs = (cols[tsIdx] || '').trim();
    let tSec = NaN;
    if (/^\d+$/.test(rawTs)) {
      tSec =
        rawTs.length >= 18
          ? Math.floor(Number(BigInt(rawTs) / 1000000000n))
          : Math.floor(Number(rawTs) > 1e12 ? Number(rawTs) / 1000 : Number(rawTs));
    } else if (rawTs) {
      const ms = Date.parse(rawTs);
      if (Number.isFinite(ms)) tSec = Math.floor(ms / 1000);
    }
    if (!Number.isFinite(tSec)) continue;

    const open = normPx(cols[oIdx]);
    const high = normPx(cols[hIdx]);
    const low = normPx(cols[lIdx]);
    const close = normPx(cols[cIdx]);
    if (!Number.isFinite(open) || !Number.isFinite(close) || open <= 0 || close <= 0) continue;
    bars.push({
      time: tSec,
      open,
      high: Number.isFinite(high) ? Math.max(high, open, close) : Math.max(open, close),
      low: Number.isFinite(low) ? Math.min(low, open, close) : Math.min(open, close),
      close,
    });
  }
  return bars;
}

export async function fetchDatabentoChunk(symbol, fromSec, toSec, schema = 'ohlcv-1m') {
  const cfg = getConfig();
  if (!cfg.DATABENTO_API_KEY) {
    throw new Error('Databento API key not configured. Add your db-... key in Settings.');
  }
  const startIso = new Date(fromSec * 1000).toISOString();
  const endIso = new Date(toSec * 1000).toISOString();
  const isContinuous = symbol.includes('.c.') || symbol.includes('.v.');
  const stypeIn = isContinuous ? 'continuous' : 'raw_symbol';

  const qs = new URLSearchParams({
    dataset: 'GLBX.MDP3',
    schema,
    symbols: symbol,
    stype_in: stypeIn,
    start: startIso,
    end: endIso,
    encoding: 'csv',
    pretty_px: 'true',
    pretty_ts: 'false',
  });

  const auth = Buffer.from(`${cfg.DATABENTO_API_KEY}:`).toString('base64');
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`https://hist.databento.com/v0/timeseries.get_range?${qs.toString()}`, {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'text/csv',
        },
        signal: AbortSignal.timeout(120000),
      });
      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
        lastErr = new Error(`Databento HTTP ${res.status} (retry ${attempt + 1})`);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        // Databento returns 422 if symbol didn't exist in that window (e.g. before launch)
        if (res.status === 422 && /no data|not found|empty/i.test(text)) return [];
        throw new Error(`Databento HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      if (!text.trim()) return [];
      return parseDatabentoCsv(text);
    } catch (err) {
      lastErr = err;
      if (attempt < 3 && /timeout|504|503|502|429|fetch failed/i.test(String(err.message))) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Databento request failed after retries.');
}

async function fetchDatabentoRange(symbol, fromSec, toSec, schema = 'ohlcv-1m') {
  const maxChunkSec = schema === 'ohlcv-1h' ? 5 * 365 * 86400 : 365 * 86400;
  const all = [];
  let cursor = fromSec;
  while (cursor < toSec) {
    const chunkEnd = Math.min(toSec, cursor + maxChunkSec);
    const bars = await fetchDatabentoChunk(symbol, cursor, chunkEnd, schema);
    for (const b of bars) all.push(b);
    cursor = chunkEnd;
  }
  return all;
}

// ============================================================================
// 3. OANDA & Crypto Paginated Range Fetcher
// ============================================================================
export async function fetchOandaRange(symbol, fromSec, toSec, tf = '1m') {
  const parsed = parseTimeframe(tf);
  const all = [];
  let cursorTo = toSec;
  let guard = 0;
  const batchCount = symbol === 'DXY' ? 1800 : 2500;
  const maxGuards = parsed.seconds >= 3600 ? 60 : 500;
  while (cursorTo > fromSec && guard < maxGuards) {
    guard += 1;
    let chunk = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        chunk = await fetchOandaCandles(symbol, parsed.label, batchCount, cursorTo);
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    const bars = Array.isArray(chunk?.bars) ? chunk.bars : [];
    if (!bars.length) break;
    for (const b of bars) {
      if (b.time >= fromSec && b.time <= toSec) all.push(b);
    }
    const oldest = bars[0].time;
    if (oldest <= fromSec || oldest >= cursorTo) break;
    cursorTo = oldest - parsed.seconds;
  }
  return all;
}

export async function fetchCryptoRange(source, symbol, fromSec, toSec, tf = '1m') {
  const parsed = parseTimeframe(tf);
  const all = [];
  let cursorTo = toSec;
  let guard = 0;
  const maxGuards = parsed.seconds >= 3600 ? 120 : 1200;
  while (cursorTo > fromSec && guard < maxGuards) {
    guard += 1;
    let chunk = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        chunk = await fetchCryptoHistory(source, symbol, parsed.label, 1000, cursorTo);
        break;
      } catch (err) {
        if (attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    const bars = Array.isArray(chunk?.bars) ? chunk.bars : [];
    if (!bars.length) break;
    for (const b of bars) {
      if (b.time >= fromSec && b.time <= toSec) all.push(b);
    }
    const oldest = bars[0].time;
    if (oldest <= fromSec || oldest >= cursorTo) break;
    cursorTo = oldest - parsed.seconds;
  }
  return all;
}

async function fetchProviderRange(source, symbol, fromSec, toSec) {
  if (source === 'dukascopy') return fetchDukascopyRange(symbol, fromSec, toSec);
  if (source === 'databento') return fetchDatabentoRange(symbol, fromSec, toSec, 'ohlcv-1m');
  if (source === 'oanda') return fetchOandaRange(symbol, fromSec, toSec, '1m');
  if (CRYPTO_SOURCES.has(source)) return fetchCryptoRange(source, symbol, fromSec, toSec, '1m');
  throw new Error(`Direct archive download not supported for source "${source}". Use CSV import instead.`);
}

// ============================================================================
// 4. Smart Incremental Download, Delta Update & 1-Click Extend Older
// ============================================================================
export async function downloadToArchive({
  source,
  symbol,
  display,
  fromSec,
  toSec,
  mode = 'range',
  extendDays = 180,
}) {
  const src = String(source || 'dukascopy').toLowerCase();
  const sym = String(symbol || '').trim();
  if (!sym) throw new Error('Symbol is required.');

  const nowSec = Math.floor(Date.now() / 1000) - 60;
  const existing = loadRawArchive(src, sym);
  const existingFirst = existing?.bars?.length ? existing.bars[0].time : null;
  const existingLast = existing?.bars?.length ? existing.bars[existing.bars.length - 1].time : null;

  const rangesToFetch = [];

  if (mode === 'missing') {
    if (!existingLast) {
      throw new Error('No local archive exists yet for this symbol. Download an initial date range first.');
    }
    if (existingLast >= nowSec - 120) {
      return {
        entry: listArchiveEntries().find((e) => e.key === `${src}:${sym}`) || null,
        addedBars: 0,
        fetchedRanges: [],
        message: 'Archive is already up to date — no missing bars!',
        entries: listArchiveEntries(),
      };
    }
    rangesToFetch.push([existingLast + 60, nowSec]);
  } else if (mode === 'extend_older') {
    if (!existingFirst) {
      throw new Error('No local archive exists yet for this symbol. Download an initial date range first.');
    }
    const spanDays = Math.max(7, Math.min(365, Number(extendDays) || 180));
    const olderFrom = Math.max(946684800, existingFirst - spanDays * 86400);
    const olderTo = existingFirst - 60;
    if (olderFrom >= olderTo) {
      return {
        entry: listArchiveEntries().find((e) => e.key === `${src}:${sym}`) || null,
        addedBars: 0,
        fetchedRanges: [],
        message: 'Archive already reaches the earliest supported date.',
        entries: listArchiveEntries(),
      };
    }
    rangesToFetch.push([olderFrom, olderTo]);
  } else {
    const reqFrom = Number(fromSec);
    const reqTo = Math.min(nowSec, Number(toSec) || nowSec);
    if (!Number.isFinite(reqFrom) || !Number.isFinite(reqTo) || reqFrom >= reqTo) {
      throw new Error('Please choose a valid From / To date range.');
    }

    if (existingFirst !== null && existingLast !== null) {
      if (reqFrom < existingFirst - 60) {
        rangesToFetch.push([reqFrom, Math.min(reqTo, existingFirst - 60)]);
      }
      if (reqTo > existingLast + 60) {
        rangesToFetch.push([Math.max(reqFrom, existingLast + 60), reqTo]);
      }
      if (rangesToFetch.length === 0) {
        return {
          entry: listArchiveEntries().find((e) => e.key === `${src}:${sym}`) || null,
          addedBars: 0,
          fetchedRanges: [],
          message: 'Requested date range is already cached locally — 0 extra API calls made!',
          entries: listArchiveEntries(),
        };
      }
    } else {
      rangesToFetch.push([reqFrom, reqTo]);
    }
  }

  const downloaded = [];
  for (const [rFrom, rTo] of rangesToFetch) {
    const bars = await fetchProviderRange(src, sym, rFrom, rTo);
    for (const b of bars) downloaded.push(b);
  }

  const saved = mergeAndSaveArchive({
    source: src,
    symbol: sym,
    display,
    incomingBars: downloaded,
  });

  return {
    ...saved,
    fetchedRanges: rangesToFetch,
    message:
      saved.addedBars > 0
        ? `Saved +${saved.addedBars.toLocaleString()} new 1m bars (total: ${saved.entry.barCount.toLocaleString()}).`
        : 'No new trading bars found in that window (weekend/holiday or earliest available date reached).',
  };
}

// ============================================================================
// 5. Generic CSV / JSON / LinePulse Data Pack Importer
// ============================================================================
function parseTimestampCell(raw) {
  const s = String(raw || '').trim().replace(/^"|"$/g, '');
  if (!s) return NaN;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (s.length >= 18) return Math.floor(Number(BigInt(s) / 1000000000n));
    if (n > 1e12) return Math.floor(n / 1000);
    return Math.floor(n);
  }
  const norm = s.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3').replace(' ', 'T');
  const ms = Date.parse(norm.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(norm) ? norm : `${norm}Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
}

export function importCsvToArchive({ source = 'custom', symbol, display, csvText, isGzipBase64 = false }) {
  let text = String(csvText || '');
  if (isGzipBase64) {
    const buf = Buffer.from(text, 'base64');
    text = zlib.gunzipSync(buf).toString('utf8');
  }
  text = text.trim();
  if (!text) throw new Error('Uploaded file is empty.');

  // Detect native LinePulse Archive JSON (.json or .json.gz from Full Data Pack!)
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.bars) && parsed.source && parsed.symbol) {
        if (parsed.resolution === '1h') {
          return saveHtf1hArchive({
            source: parsed.source,
            symbol: parsed.symbol,
            display: parsed.display || display || parsed.symbol,
            precision: parsed.precision,
            incomingBars: parsed.bars,
          });
        }
        return mergeAndSaveArchive({
          source: parsed.source,
          symbol: parsed.symbol,
          display: parsed.display || display || parsed.symbol,
          precision: parsed.precision,
          incomingBars: parsed.bars,
        });
      }
    } catch {
      // fall through to generic parser
    }
  }

  const sym = String(symbol || '').trim();
  if (!sym) throw new Error('Symbol name is required for import.');

  const bars = [];
  if (text.startsWith('[') || text.startsWith('{')) {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed.bars) ? parsed.bars : [];
    for (const r of arr) {
      const t = parseTimestampCell(r.time ?? r.timestamp ?? r.ts_event ?? r.date);
      const o = Number(r.open ?? r.o);
      const h = Number(r.high ?? r.h);
      const l = Number(r.low ?? r.l);
      const c = Number(r.close ?? r.c);
      if (Number.isFinite(t) && Number.isFinite(o) && Number.isFinite(c)) {
        bars.push({
          time: t,
          open: o,
          high: Number.isFinite(h) ? h : Math.max(o, c),
          low: Number.isFinite(l) ? l : Math.min(o, c),
          close: c,
        });
      }
    }
  } else {
    const lines = text.split(/\r?\n/);
    let timeIdx = 0;
    let dateIdx = -1;
    let clockIdx = -1;
    let openIdx = 1;
    let highIdx = 2;
    let lowIdx = 3;
    let closeIdx = 4;
    let startRow = 0;

    const firstCells = lines[0].split(/[,;\t]/).map((c) => c.trim().toLowerCase().replace(/^"|"$/g, ''));
    const hasHeader = firstCells.some((c) =>
      ['open', 'close', 'time', 'timestamp', 'ts_event', 'date', 'datetime'].includes(c)
    );
    if (hasHeader) {
      startRow = 1;
      const findCol = (names) => firstCells.findIndex((c) => names.includes(c));
      const tCol = findCol(['ts_event', 'timestamp', 'datetime', 'time', 'utc']);
      const dCol = findCol(['date', 'gmttime', 'local time']);
      const tmCol = findCol(['time']);
      if (dCol >= 0 && tmCol >= 0 && dCol !== tmCol) {
        dateIdx = dCol;
        clockIdx = tmCol;
      } else if (tCol >= 0) {
        timeIdx = tCol;
      } else if (dCol >= 0) {
        timeIdx = dCol;
      }
      const oCol = findCol(['open', 'o']);
      const hCol = findCol(['high', 'h']);
      const lCol = findCol(['low', 'l']);
      const cCol = findCol(['close', 'c']);
      if (oCol >= 0) openIdx = oCol;
      if (hCol >= 0) highIdx = hCol;
      if (lCol >= 0) lowIdx = lCol;
      if (cCol >= 0) closeIdx = cCol;
    }

    for (let i = startRow; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = line.split(/[,;\t]/);
      const rawT = dateIdx >= 0 && clockIdx >= 0 ? `${cols[dateIdx]} ${cols[clockIdx]}` : cols[timeIdx];
      const t = parseTimestampCell(rawT);
      const o = Number(cols[openIdx]);
      const h = Number(cols[highIdx]);
      const l = Number(cols[lowIdx]);
      const c = Number(cols[closeIdx]);
      if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(c)) continue;
      bars.push({
        time: t,
        open: o,
        high: Number.isFinite(h) ? h : Math.max(o, c),
        low: Number.isFinite(l) ? l : Math.min(o, c),
        close: c,
      });
    }
  }

  if (!bars.length) {
    throw new Error('Could not parse any OHLC bars from this file. Expected columns: time/date, open, high, low, close.');
  }

  return mergeAndSaveArchive({
    source,
    symbol: sym,
    display: display || sym,
    incomingBars: bars,
  });
}

// ============================================================================
// 5b. Pure-JS Streaming .ZIP Data Pack Importer (Cross-Platform, Low RAM!)
// ============================================================================
export function importZipDataPackFile(zipFilePath) {
  const stat = fs.statSync(zipFilePath);
  const fileSize = stat.size;
  if (fileSize < 22) throw new Error('Invalid or empty .zip file.');

  const fd = fs.openSync(zipFilePath, 'r');
  try {
    // 1. Locate End of Central Directory (EOCD: 0x06054b50) within last 65KB
    const tailLen = Math.min(fileSize, 65557);
    const tailBuf = Buffer.alloc(tailLen);
    fs.readSync(fd, tailBuf, 0, tailLen, fileSize - tailLen);

    let eocdPos = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tailBuf.readUInt32LE(i) === 0x06054b50) {
        eocdPos = i;
        break;
      }
    }
    if (eocdPos < 0) throw new Error('Not a valid ZIP archive (EOCD header not found).');

    const totalEntries = tailBuf.readUInt16LE(eocdPos + 10);
    const cdSize = tailBuf.readUInt32LE(eocdPos + 12);
    const cdOffset = tailBuf.readUInt32LE(eocdPos + 16);

    const cdBuf = Buffer.alloc(cdSize);
    fs.readSync(fd, cdBuf, 0, cdSize, cdOffset);

    const targetDir = getArchiveDir();
    const indexFile = getIndexFile();
    const existing = readIndex();
    const byKey = new Map(existing.map((e) => [e.key, e]));

    let importedFiles = 0;
    const touchedKeys = new Set();
    let pos = 0;

    for (let idx = 0; idx < totalEntries && pos + 46 <= cdBuf.length; idx++) {
      if (cdBuf.readUInt32LE(pos) !== 0x02014b50) break;
      const method = cdBuf.readUInt16LE(pos + 10);
      const compSize = cdBuf.readUInt32LE(pos + 20);
      const nameLen = cdBuf.readUInt16LE(pos + 28);
      const extraLen = cdBuf.readUInt16LE(pos + 30);
      const commentLen = cdBuf.readUInt16LE(pos + 32);
      const localHeaderOffset = cdBuf.readUInt32LE(pos + 42);
      const rawName = cdBuf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
      pos += 46 + nameLen + extraLen + commentLen;

      if (rawName.endsWith('/') || rawName.includes('__MACOSX/')) continue;
      const baseName = path.basename(rawName);
      if (baseName.startsWith('.') || baseName === 'index.json') continue;
      const isGz = baseName.endsWith('.json.gz');
      const isJson = baseName.endsWith('.json');
      if (!isGz && !isJson) continue;

      // Read 30-byte local file header to find exact data offset
      const lh = Buffer.alloc(30);
      fs.readSync(fd, lh, 0, 30, localHeaderOffset);
      const lhNameLen = lh.readUInt16LE(26);
      const lhExtraLen = lh.readUInt16LE(28);
      const dataOffset = localHeaderOffset + 30 + lhNameLen + lhExtraLen;

      const compBuf = Buffer.alloc(compSize);
      fs.readSync(fd, compBuf, 0, compSize, dataOffset);

      let entryBuf;
      if (method === 0) {
        entryBuf = compBuf;
      } else if (method === 8) {
        entryBuf = zlib.inflateRawSync(compBuf);
      } else {
        continue;
      }

      const jsonBuf = isGz ? zlib.gunzipSync(entryBuf) : entryBuf;
      let parsed;
      try {
        parsed = JSON.parse(jsonBuf.toString('utf8'));
      } catch {
        continue;
      }
      if (!parsed || !parsed.source || !parsed.symbol || !Array.isArray(parsed.bars)) continue;

      const src = String(parsed.source).toLowerCase();
      const sym = String(parsed.symbol);
      const isH1 = parsed.resolution === '1h' || baseName.includes('__1h.json');
      const outFile = isH1 ? getArchiveHtf1hFile(src, sym) : getArchiveDataFile(src, sym);
      fs.writeFileSync(outFile, jsonBuf);

      const key = `${src}:${sym}`;
      HTF_ROLLUP_CACHE.delete(key);
      const cur = byKey.get(key) || {
        key,
        source: src,
        symbol: sym,
        display: parsed.display || sym,
        precision: parsed.precision ?? 2,
        firstTime: null,
        lastTime: null,
        barCount: 0,
        htf1hFirstTime: null,
        htf1hLastTime: null,
        htf1hBarCount: 0,
        effectiveFirstTime: null,
        updatedAt: Date.now(),
      };
      const bars = parsed.bars;
      if (isH1) {
        cur.htf1hFirstTime = bars.length ? bars[0].time : null;
        cur.htf1hLastTime = bars.length ? bars[bars.length - 1].time : null;
        cur.htf1hBarCount = bars.length;
      } else {
        cur.firstTime = bars.length ? bars[0].time : null;
        cur.lastTime = bars.length ? bars[bars.length - 1].time : null;
        cur.barCount = bars.length;
        if (parsed.display) cur.display = parsed.display;
        if (Number.isFinite(parsed.precision)) cur.precision = parsed.precision;
      }
      cur.effectiveFirstTime = computeEffectiveFirstTime(cur.firstTime, cur.htf1hFirstTime);
      cur.updatedAt = Date.now();
      byKey.set(key, cur);
      touchedKeys.add(key);
      importedFiles += 1;
    }

    if (importedFiles === 0) {
      throw new Error('No LinePulse archive (.json / .json.gz) files were found inside this .zip.');
    }

    const entries = Array.from(byKey.values());
    fs.writeFileSync(indexFile, JSON.stringify({ entries }, null, 2), 'utf8');
    return {
      importedFiles,
      instrumentCount: touchedKeys.size,
      entries: listArchiveEntries(),
      message: `Imported ${touchedKeys.size} instruments (${importedFiles} archive files) from ZIP Data Pack!`,
    };
  } finally {
    fs.closeSync(fd);
  }
}

// ============================================================================
// 6. Fast Offline Hybrid (1h + 1m) Archive Slice Reader (Used by Replay FIRST!)
// ============================================================================
function getCachedStitched1h(src, symbol, rawM1, rawH1) {
  const key = `${src}:${symbol}`;
  const m1File = getArchiveDataFile(src, symbol);
  const h1File = getArchiveHtf1hFile(src, symbol);
  const m1Mtime = fs.existsSync(m1File) ? fs.statSync(m1File).mtimeMs : 0;
  const h1Mtime = fs.existsSync(h1File) ? fs.statSync(h1File).mtimeMs : 0;
  const stamp = `${m1Mtime}:${h1Mtime}`;

  const cached = HTF_ROLLUP_CACHE.get(key);
  if (cached && cached.stamp === stamp) {
    return cached.bars;
  }

  const m1Bars = Array.isArray(rawM1?.bars) ? rawM1.bars : [];
  const h1Bars = Array.isArray(rawH1?.bars) ? rawH1.bars : [];
  const m1First = m1Bars.length ? m1Bars[0].time : Infinity;

  const h1Parsed = parseTimeframe('1h');
  const m1As1h = m1Bars.length ? resampleOhlc(m1Bars, h1Parsed, src) : [];

  const stitched = [];
  for (const b of h1Bars) {
    if (b.time < m1First) stitched.push(b);
  }
  const lastPreTime = stitched.length ? stitched[stitched.length - 1].time : -Infinity;
  for (const b of m1As1h) {
    if (b.time > lastPreTime) stitched.push(b);
  }

  if (HTF_ROLLUP_CACHE.size >= HTF_ROLLUP_MAX) {
    const oldestKey = HTF_ROLLUP_CACHE.keys().next().value;
    HTF_ROLLUP_CACHE.delete(oldestKey);
  }
  HTF_ROLLUP_CACHE.set(key, { stamp, bars: stitched });
  return stitched;
}

export function readArchiveSlice({ source, symbol, tf = '1m', from = null, to = null, count = 2500 }) {
  const src = String(source || '').toLowerCase();
  const rawM1 = loadRawArchive(src, symbol);
  const rawH1 = loadRawHtf1hArchive(src, symbol);

  const hasM1 = Boolean(rawM1 && Array.isArray(rawM1.bars) && rawM1.bars.length > 0);
  const hasH1 = Boolean(rawH1 && Array.isArray(rawH1.bars) && rawH1.bars.length > 0);
  if (!hasM1 && !hasH1) return null;

  const parsed = parseTimeframe(tf);
  const m1First = hasM1 ? rawM1.bars[0].time : null;
  const m1Last = hasM1 ? rawM1.bars[rawM1.bars.length - 1].time : null;
  const h1First = hasH1 ? rawH1.bars[0].time : null;
  const h1Last = hasH1 ? rawH1.bars[rawH1.bars.length - 1].time : null;
  const effFirst = computeEffectiveFirstTime(m1First, h1First);
  const effLast = Math.max(m1Last || 0, h1Last || 0);
  const display = rawM1?.display || rawH1?.display || symbol;
  const precision = rawM1?.precision ?? rawH1?.precision ?? 2;

  const hasFrom = Number.isFinite(from);
  const hasTo = Number.isFinite(to);

  // HTF path (>= 1h): Seamlessly stitch pre-1m 1h history + 1m-derived 1h history, then apply TradingView session resampling!
  if (parsed.seconds >= 3600 && (hasH1 || hasM1)) {
    if (hasFrom && from > effLast) return null;
    if (hasTo && to < effFirst) return null;

    const allH1 = getCachedStitched1h(src, symbol, rawM1, rawH1);
    if (!allH1.length) return null;

    const h1PerBar = Math.max(1, Math.ceil(parsed.seconds / 3600));
    let filtered;
    if (hasFrom && hasTo) {
      // Include a small padding before `from` so session-aligned daily/weekly opening candles are complete
      const padFrom = from - parsed.seconds;
      filtered = allH1.filter((b) => b.time >= padFrom && b.time <= to);
    } else if (hasFrom) {
      const startIdx = allH1.findIndex((b) => b.time >= from - parsed.seconds);
      if (startIdx === -1) return null;
      const needed = Math.min(allH1.length - startIdx, Math.max(count + 2, (count + 4) * h1PerBar));
      filtered = allH1.slice(startIdx, startIdx + needed);
    } else if (hasTo) {
      let endIdx = allH1.length - 1;
      while (endIdx >= 0 && allH1[endIdx].time > to) endIdx--;
      if (endIdx < 0) return null;
      const needed = Math.max(count + 2, (count + 4) * h1PerBar);
      const startIdx = Math.max(0, endIdx - needed + 1);
      filtered = allH1.slice(startIdx, endIdx + 1);
    } else {
      const needed = Math.max(count + 2, (count + 4) * h1PerBar);
      filtered = allH1.slice(-needed);
    }

    if (!filtered.length) return null;
    let bars = parsed.label === '1h' ? filtered : resampleOhlc(filtered, parsed, src);
    if (hasFrom) bars = bars.filter((b) => b.time >= from - parsed.seconds);
    if (hasTo) bars = bars.filter((b) => b.time <= to);
    const trimmed = bars.length > count ? (hasFrom && !hasTo ? bars.slice(0, count) : bars.slice(-count)) : bars;
    if (!trimmed.length) return null;

    return {
      source: src,
      symbol,
      display,
      tf: parsed.label,
      bucketSec: parsed.seconds,
      precision,
      bars: trimmed,
      fromArchive: true,
      archiveFirstTime: effFirst,
      archiveLastTime: effLast,
      m1FirstTime: m1First,
      htf1hFirstTime: h1First,
    };
  }

  // Sub-1h path (< 1h: 1m, 3m, 5m, 15m, 30m): requires 1m archive
  if (!hasM1 || (hasTo && to < m1First) || (hasFrom && from < m1First && (!hasTo || to < m1First))) {
    if (hasH1 && (!hasTo || to >= h1First) && (!hasFrom || from <= h1Last)) {
      const m1StartStr = m1First ? new Date(m1First * 1000).toISOString().slice(0, 10) : 'N/A';
      const h1StartStr = new Date(h1First * 1000).toISOString().slice(0, 10);
      const err = new Error(
        `1m offline archive for ${display} starts ${m1StartStr} (${h1StartStr} → ${m1StartStr} is stored as 1h). Switch timeframe to 1h, 4h, 12h, 1D, or 1W to view earlier history!`
      );
      err.code = 'ONLY_HTF_AVAILABLE';
      err.m1FirstTime = m1First;
      err.htf1hFirstTime = h1First;
      throw err;
    }
    return null;
  }

  const allM1 = rawM1.bars;
  if (hasFrom && from > m1Last) return null;
  if (hasTo && to < m1First) return null;

  let filtered;
  if (hasFrom && hasTo) {
    filtered = allM1.filter((b) => b.time >= from && b.time <= to);
  } else if (hasFrom) {
    const startIdx = allM1.findIndex((b) => b.time >= from);
    if (startIdx === -1) return null;
    const neededM1 = Math.min(allM1.length - startIdx, Math.max(count, count * Math.ceil(parsed.seconds / 60)));
    filtered = allM1.slice(startIdx, startIdx + neededM1);
  } else if (hasTo) {
    let endIdx = allM1.length - 1;
    while (endIdx >= 0 && allM1[endIdx].time > to) endIdx--;
    if (endIdx < 0) return null;
    const neededM1 = Math.max(count, count * Math.ceil(parsed.seconds / 60));
    const startIdx = Math.max(0, endIdx - neededM1 + 1);
    filtered = allM1.slice(startIdx, endIdx + 1);
  } else {
    const neededM1 = Math.max(count, count * Math.ceil(parsed.seconds / 60));
    filtered = allM1.slice(-neededM1);
  }

  if (!filtered.length) return null;
  const bars = parsed.label === '1m' ? filtered : resampleOhlc(filtered, parsed, src);
  const trimmed = bars.length > count ? (hasFrom && !hasTo ? bars.slice(0, count) : bars.slice(-count)) : bars;

  return {
    source: src,
    symbol,
    display,
    tf: parsed.label,
    bucketSec: parsed.seconds,
    precision,
    bars: trimmed,
    fromArchive: true,
    archiveFirstTime: m1First,
    archiveLastTime: m1Last,
    m1FirstTime: m1First,
    htf1hFirstTime: h1First,
  };
}
