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
  const m1File = getArchiveDataFile(source, symbol);
  const h1File = getArchiveHtf1hFile(source, symbol);
  const stitchedFile = getArchiveStitched1hBinFile(source, symbol);
  for (const f of [
    m1File,
    h1File,
    binPathForJson(m1File),
    metaPathForJson(m1File),
    binPathForJson(h1File),
    metaPathForJson(h1File),
    stitchedFile,
    stitchedFile.replace(/\.bin$/, '.meta.json'),
  ]) {
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
  const m1Path = getArchiveDataFile(src, symbol);
  fs.writeFileSync(m1Path, JSON.stringify(payload), 'utf8');
  try {
    const stat = fs.statSync(m1Path);
    writeBinaryBars(
      binPathForJson(m1Path),
      metaPathForJson(m1Path),
      {
        source: src,
        symbol,
        display: finalDisplay,
        precision: finalPrecision,
        srcMtimeMs: stat.mtimeMs,
      },
      merged
    );
    invalidateStitched1hBin(src, symbol);
  } catch {
    // non-fatal sidecar cache refresh
  }

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
  const h1Path = getArchiveHtf1hFile(src, symbol);
  fs.writeFileSync(h1Path, JSON.stringify(payload), 'utf8');
  try {
    const stat = fs.statSync(h1Path);
    writeBinaryBars(
      binPathForJson(h1Path),
      metaPathForJson(h1Path),
      {
        source: src,
        symbol,
        display: finalDisplay,
        precision: finalPrecision,
        resolution: '1h',
        srcMtimeMs: stat.mtimeMs,
      },
      merged
    );
    invalidateStitched1hBin(src, symbol);
  } catch {
    // non-fatal sidecar cache refresh
  }

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
  const maxChunkSec = schema === 'ohlcv-1h' ? 5 * 365 * 86400 : 90 * 86400;
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

  const existingTimesBefore = new Set((existing?.bars || []).map((b) => b.time));
  const trulyNewBars = downloaded.filter((b) => !existingTimesBefore.has(b.time));

  const saved = mergeAndSaveArchive({
    source: src,
    symbol: sym,
    display,
    incomingBars: downloaded,
  });

  let deltaZipName = null;
  let deltaZipPath = null;
  if (saved.addedBars > 0 && trulyNewBars.length > 0) {
    try {
      const dz = saveDeltaZipForBars({
        source: src,
        symbol: sym,
        display: saved.entry?.display || display || sym,
        precision: saved.entry?.precision ?? 2,
        bars: trulyNewBars,
      });
      deltaZipName = dz.fileName;
      deltaZipPath = dz.filePath;
    } catch (err) {
      console.error('[Archive Delta ZIP] Failed to write delta zip:', err.message);
    }
  }

  return {
    ...saved,
    fetchedRanges: rangesToFetch,
    deltaZipName,
    deltaZipPath,
    message:
      saved.addedBars > 0
        ? `Saved +${saved.addedBars.toLocaleString()} new 1m bars (total: ${saved.entry.barCount.toLocaleString()}).${
            deltaZipName ? ` Delta ZIP ready: ${deltaZipName}` : ''
          }`
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
// 5b. Pure-JS Streaming .ZIP Data Pack Importer (Smart Non-Overwriting Merge!)
//     & Pure-JS Delta .ZIP Exporter (Shareable Weekly / 14-Day Update Packs)
// ============================================================================
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32Buf(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function buildZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const crc = crc32Buf(dataBuf);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); // STORE (already gzipped .json.gz!)
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(dataBuf.length, 18);
    lh.writeUInt32LE(dataBuf.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    localParts.push(lh, nameBuf, dataBuf);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(dataBuf.length, 20);
    cd.writeUInt32LE(dataBuf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    centralParts.push(cd, nameBuf);

    offset += lh.length + nameBuf.length + dataBuf.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

export function getExportsDir() {
  const dir = path.join(getDataDir(), 'exports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveDeltaZipForBars({ source, symbol, display, precision = 2, bars = [] }) {
  const cleanBars = [...bars].sort((a, b) => a.time - b.time);
  const safeSym = String(symbol).replace(/[^a-zA-Z0-9._-]/g, '_');
  const dayStr = new Date().toISOString().slice(0, 10);
  const payload = JSON.stringify({
    source: String(source).toLowerCase(),
    symbol,
    display: display || symbol,
    precision,
    resolution: '1m',
    bars: cleanBars,
  });
  const gz = zlib.gzipSync(Buffer.from(payload, 'utf8'));
  const zipBuf = buildZipBuffer([
    { name: `${String(source).toLowerCase()}__${safeSym}.json.gz`, data: gz },
  ]);
  const fileName = `VeloxCharts-Delta-${String(source).toLowerCase()}-${safeSym}-${dayStr}.zip`;
  const filePath = path.join(getExportsDir(), fileName);
  fs.writeFileSync(filePath, zipBuf);
  return { fileName, filePath, barCount: cleanBars.length, sizeBytes: zipBuf.length };
}

export function buildDeltaExportZip({ sinceSec = 0 } = {}) {
  const entries = readIndex();
  const zipFiles = [];
  let totalBars = 0;

  for (const e of entries) {
    const raw = loadRawArchive(e.source, e.symbol);
    if (!raw?.bars?.length) continue;
    const filtered = sinceSec > 0 ? raw.bars.filter((b) => b.time >= sinceSec) : raw.bars;
    if (!filtered.length) continue;
    const safeSym = String(e.symbol).replace(/[^a-zA-Z0-9._-]/g, '_');
    const payload = JSON.stringify({
      source: e.source,
      symbol: e.symbol,
      display: e.display || e.symbol,
      precision: e.precision ?? 2,
      resolution: '1m',
      bars: filtered,
    });
    const gz = zlib.gzipSync(Buffer.from(payload, 'utf8'));
    zipFiles.push({ name: `${e.source}__${safeSym}.json.gz`, data: gz });
    totalBars += filtered.length;
  }

  if (zipFiles.length === 0) {
    throw new Error('No archive bars found in the selected time window.');
  }

  return {
    buffer: buildZipBuffer(zipFiles),
    instrumentCount: zipFiles.length,
    totalBars,
  };
}

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

    const indexFile = getIndexFile();
    const existing = readIndex();
    const byKey = new Map(existing.map((e) => [e.key, e]));

    let importedFiles = 0;
    let totalAddedBars = 0;
    let skippedDuplicates = 0;
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

      // SMART NON-OVERWRITING MERGE:
      // - If symbol doesn't exist locally -> write full incoming dataset cleanly!
      // - If symbol ALREADY exists locally -> ONLY add missing timestamps, NEVER overwrite colliding existing bars!
      let finalBars;
      let addedHere = 0;
      if (fs.existsSync(outFile)) {
        let localParsed = null;
        try {
          localParsed = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        } catch {
          localParsed = null;
        }
        const existingBars = Array.isArray(localParsed?.bars) ? localParsed.bars : [];
        if (existingBars.length > 0) {
          const existingTimes = new Set(existingBars.map((b) => b.time));
          const merged = [...existingBars];
          for (const b of parsed.bars) {
            if (!Number.isFinite(b?.time)) continue;
            if (existingTimes.has(b.time)) {
              skippedDuplicates += 1;
              continue;
            }
            existingTimes.add(b.time);
            merged.push(b);
            addedHere += 1;
          }
          if (addedHere > 0) {
            merged.sort((a, b) => a.time - b.time);
            const mergedPayload = {
              ...(localParsed || parsed),
              source: src,
              symbol: sym,
              display: localParsed?.display || parsed.display || sym,
              precision: localParsed?.precision ?? parsed.precision ?? 2,
              resolution: isH1 ? '1h' : '1m',
              bars: merged,
            };
            fs.writeFileSync(outFile, JSON.stringify(mergedPayload), 'utf8');
          }
          finalBars = merged;
        } else {
          finalBars = parsed.bars;
          addedHere = parsed.bars.length;
          fs.writeFileSync(outFile, jsonBuf);
        }
      } else {
        finalBars = parsed.bars;
        addedHere = parsed.bars.length;
        fs.writeFileSync(outFile, jsonBuf);
      }

      totalAddedBars += addedHere;
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
      if (isH1) {
        cur.htf1hFirstTime = finalBars.length ? finalBars[0].time : null;
        cur.htf1hLastTime = finalBars.length ? finalBars[finalBars.length - 1].time : null;
        cur.htf1hBarCount = finalBars.length;
      } else {
        cur.firstTime = finalBars.length ? finalBars[0].time : null;
        cur.lastTime = finalBars.length ? finalBars[finalBars.length - 1].time : null;
        cur.barCount = finalBars.length;
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
      throw new Error('No Velox Charts / LinePulse archive (.json / .json.gz) files were found inside this .zip.');
    }

    const entries = Array.from(byKey.values());
    fs.writeFileSync(indexFile, JSON.stringify({ entries }, null, 2), 'utf8');
    return {
      importedFiles,
      instrumentCount: touchedKeys.size,
      totalAddedBars,
      skippedDuplicates,
      entries: listArchiveEntries(),
      message: `Merged ${touchedKeys.size} instruments (+${totalAddedBars.toLocaleString()} new bars, ${skippedDuplicates.toLocaleString()} existing bars preserved)!`,
    };
  } finally {
    fs.closeSync(fd);
  }
}

// ============================================================================
// 6. Zero-RAM Binary Sidecar (.bin) & O(log N) Disk-Seek Replay Slice Reader
//    Each bar = 40 bytes (5 × Float64LE: time, open, high, low, close).
//    Serves 2,500 bars from a 2,000,000-bar dataset in < 2ms & < 1 MB RAM!
// ============================================================================
const BIN_RECORD_BYTES = 40;

function binPathForJson(jsonPath) {
  return jsonPath.replace(/\.json$/, '.bin');
}

function metaPathForJson(jsonPath) {
  return jsonPath.replace(/\.json$/, '.meta.json');
}

function getArchiveStitched1hBinFile(source, symbol) {
  return path.join(getArchiveDir(), `${safeFileKey(source, symbol)}__stitched1h.bin`);
}

function invalidateStitched1hBin(source, symbol) {
  const sBin = getArchiveStitched1hBinFile(source, symbol);
  for (const f of [sBin, sBin.replace(/\.bin$/, '.meta.json')]) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      // ignore
    }
  }
}

function writeBinaryBars(binPath, metaPath, baseMeta, bars) {
  const count = Array.isArray(bars) ? bars.length : 0;
  const buf = Buffer.allocUnsafe(count * BIN_RECORD_BYTES);
  for (let i = 0; i < count; i += 1) {
    const b = bars[i];
    const off = i * BIN_RECORD_BYTES;
    buf.writeDoubleLE(b.time, off);
    buf.writeDoubleLE(b.open, off + 8);
    buf.writeDoubleLE(b.high, off + 16);
    buf.writeDoubleLE(b.low, off + 24);
    buf.writeDoubleLE(b.close, off + 32);
  }
  const tmpBin = `${binPath}.tmp`;
  fs.writeFileSync(tmpBin, buf);
  fs.renameSync(tmpBin, binPath);

  const meta = {
    ...baseMeta,
    count,
    firstTime: count ? bars[0].time : null,
    lastTime: count ? bars[count - 1].time : null,
  };
  const tmpMeta = `${metaPath}.tmp`;
  fs.writeFileSync(tmpMeta, JSON.stringify(meta), 'utf8');
  fs.renameSync(tmpMeta, metaPath);
  return meta;
}

function readMetaJson(metaPath) {
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return null;
  }
}

function ensureBinaryForJson(jsonPath) {
  const binPath = binPathForJson(jsonPath);
  const metaPath = metaPathForJson(jsonPath);
  const hasJson = fs.existsSync(jsonPath);
  const hasBin = fs.existsSync(binPath);
  const meta = readMetaJson(metaPath);

  if (hasBin && meta && Number.isFinite(meta.count)) {
    if (!hasJson) return { binPath, meta };
    const srcMtimeMs = fs.statSync(jsonPath).mtimeMs;
    if (meta.srcMtimeMs === srcMtimeMs) {
      return { binPath, meta };
    }
  }

  if (!hasJson) return null;
  const srcMtimeMs = fs.statSync(jsonPath).mtimeMs;
  const parsed = loadRawArchiveFile(jsonPath);
  if (!parsed || !Array.isArray(parsed.bars)) return null;
  const builtMeta = writeBinaryBars(
    binPath,
    metaPath,
    {
      source: parsed.source || '',
      symbol: parsed.symbol || '',
      display: parsed.display || parsed.symbol || '',
      precision: parsed.precision ?? 2,
      resolution: parsed.resolution || '1m',
      srcMtimeMs,
    },
    parsed.bars
  );
  return { binPath, meta: builtMeta };
}

function binarySearchTimeFd(fd, count, targetTime, mode) {
  if (count <= 0) return -1;
  const tBuf = Buffer.allocUnsafe(8);
  const readTimeAt = (idx) => {
    fs.readSync(fd, tBuf, 0, 8, idx * BIN_RECORD_BYTES);
    return tBuf.readDoubleLE(0);
  };

  if (mode === 'ge') {
    let lo = 0;
    let hi = count - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const t = readTimeAt(mid);
      if (t >= targetTime) {
        ans = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return ans;
  }

  // mode === 'le': largest index with time <= targetTime
  let lo = 0;
  let hi = count - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const t = readTimeAt(mid);
    if (t <= targetTime) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function readBinaryRange(binPath, count, startIdx, endIdx) {
  if (count <= 0) return [];
  const s = Math.max(0, startIdx);
  const e = Math.min(count - 1, endIdx);
  if (s > e) return [];
  const n = e - s + 1;
  const buf = Buffer.allocUnsafe(n * BIN_RECORD_BYTES);
  const fd = fs.openSync(binPath, 'r');
  try {
    let bytesRead = 0;
    const totalBytes = n * BIN_RECORD_BYTES;
    while (bytesRead < totalBytes) {
      const r = fs.readSync(fd, buf, bytesRead, totalBytes - bytesRead, s * BIN_RECORD_BYTES + bytesRead);
      if (r <= 0) break;
      bytesRead += r;
    }
    const actualN = Math.floor(bytesRead / BIN_RECORD_BYTES);
    const out = new Array(actualN);
    for (let i = 0; i < actualN; i += 1) {
      const off = i * BIN_RECORD_BYTES;
      out[i] = {
        time: buf.readDoubleLE(off),
        open: buf.readDoubleLE(off + 8),
        high: buf.readDoubleLE(off + 16),
        low: buf.readDoubleLE(off + 24),
        close: buf.readDoubleLE(off + 32),
      };
    }
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

function queryBinarySlice(binPath, count, { from, to, maxBars, padFrom = null }) {
  if (count <= 0) return [];
  const hasFrom = Number.isFinite(from);
  const hasTo = Number.isFinite(to);
  const effectiveFrom = Number.isFinite(padFrom) ? padFrom : from;

  const fd = fs.openSync(binPath, 'r');
  let startIdx = 0;
  let endIdx = count - 1;
  try {
    if (hasFrom && hasTo) {
      startIdx = binarySearchTimeFd(fd, count, effectiveFrom, 'ge');
      endIdx = binarySearchTimeFd(fd, count, to, 'le');
      if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return [];
      // Keep the latest `maxBars` within [startIdx, endIdx] since response trims tail to `count`
      if (endIdx - startIdx + 1 > maxBars) {
        startIdx = endIdx - maxBars + 1;
      }
    } else if (hasFrom) {
      startIdx = binarySearchTimeFd(fd, count, effectiveFrom, 'ge');
      if (startIdx === -1) return [];
      endIdx = Math.min(count - 1, startIdx + maxBars - 1);
    } else if (hasTo) {
      endIdx = binarySearchTimeFd(fd, count, to, 'le');
      if (endIdx === -1) return [];
      startIdx = Math.max(0, endIdx - maxBars + 1);
    } else {
      startIdx = Math.max(0, count - maxBars);
      endIdx = count - 1;
    }
  } finally {
    fs.closeSync(fd);
  }

  return readBinaryRange(binPath, count, startIdx, endIdx);
}

function streamRollupM1BinTo1h(m1BinPath, m1Count) {
  if (!m1BinPath || m1Count <= 0) return [];
  const CHUNK = 50000;
  const out = [];
  let cur = null;
  let curBucket = -1;
  for (let start = 0; start < m1Count; start += CHUNK) {
    const batch = readBinaryRange(m1BinPath, m1Count, start, Math.min(m1Count - 1, start + CHUNK - 1));
    for (let i = 0; i < batch.length; i += 1) {
      const b = batch[i];
      const bucket = Math.floor(b.time / 3600) * 3600;
      if (bucket !== curBucket) {
        if (cur) out.push(cur);
        curBucket = bucket;
        cur = { time: bucket, open: b.open, high: b.high, low: b.low, close: b.close };
      } else {
        if (b.high > cur.high) cur.high = b.high;
        if (b.low < cur.low) cur.low = b.low;
        cur.close = b.close;
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}

function ensureStitched1hBin(src, symbol, m1Info, h1Info) {
  const sBin = getArchiveStitched1hBinFile(src, symbol);
  const sMetaPath = sBin.replace(/\.bin$/, '.meta.json');
  const stamp = `${m1Info?.meta?.srcMtimeMs || 0}:${m1Info?.meta?.count || 0}:${h1Info?.meta?.srcMtimeMs || 0}:${h1Info?.meta?.count || 0}`;

  const existing = readMetaJson(sMetaPath);
  if (fs.existsSync(sBin) && existing && existing.stamp === stamp && Number.isFinite(existing.count)) {
    return { binPath: sBin, meta: existing };
  }

  const m1First = m1Info?.meta?.firstTime ?? Infinity;
  const h1Bars = h1Info?.meta?.count ? readBinaryRange(h1Info.binPath, h1Info.meta.count, 0, h1Info.meta.count - 1) : [];
  const m1As1h = m1Info?.meta?.count ? streamRollupM1BinTo1h(m1Info.binPath, m1Info.meta.count) : [];

  const stitched = [];
  for (const b of h1Bars) {
    if (b.time < m1First) stitched.push(b);
  }
  const lastPreTime = stitched.length ? stitched[stitched.length - 1].time : -Infinity;
  for (const b of m1As1h) {
    if (b.time > lastPreTime) stitched.push(b);
  }

  const built = writeBinaryBars(
    sBin,
    sMetaPath,
    {
      source: src,
      symbol,
      display: m1Info?.meta?.display || h1Info?.meta?.display || symbol,
      precision: m1Info?.meta?.precision ?? h1Info?.meta?.precision ?? 2,
      stamp,
    },
    stitched
  );
  return { binPath: sBin, meta: built };
}

export function buildAllBinaryCaches() {
  const entries = readIndex();
  let built = 0;
  for (const e of entries) {
    const m1Info = ensureBinaryForJson(getArchiveDataFile(e.source, e.symbol));
    const h1Info = ensureBinaryForJson(getArchiveHtf1hFile(e.source, e.symbol));
    if (m1Info || h1Info) {
      ensureStitched1hBin(e.source, e.symbol, m1Info, h1Info);
      built += 1;
    }
  }
  return { total: entries.length, built };
}

export function readArchiveSlice({ source, symbol, tf = '1m', from = null, to = null, count = 2500 }) {
  const src = String(source || '').toLowerCase();
  const m1Info = ensureBinaryForJson(getArchiveDataFile(src, symbol));
  const h1Info = ensureBinaryForJson(getArchiveHtf1hFile(src, symbol));

  const hasM1 = Boolean(m1Info && m1Info.meta.count > 0);
  const hasH1 = Boolean(h1Info && h1Info.meta.count > 0);
  if (!hasM1 && !hasH1) return null;

  const parsed = parseTimeframe(tf);
  const m1First = hasM1 ? m1Info.meta.firstTime : null;
  const m1Last = hasM1 ? m1Info.meta.lastTime : null;
  const h1First = hasH1 ? h1Info.meta.firstTime : null;
  const h1Last = hasH1 ? h1Info.meta.lastTime : null;
  const effFirst = computeEffectiveFirstTime(m1First, h1First);
  const effLast = Math.max(m1Last || 0, h1Last || 0);
  const display = m1Info?.meta?.display || h1Info?.meta?.display || symbol;
  const precision = m1Info?.meta?.precision ?? h1Info?.meta?.precision ?? 2;

  const hasFrom = Number.isFinite(from);
  const hasTo = Number.isFinite(to);

  // HTF path (>= 1h): O(log N) binary seek directly on stitched 1h .bin file (< 1ms, < 1 MB RAM!)
  if (parsed.seconds >= 3600 && (hasH1 || hasM1)) {
    if (hasFrom && from > effLast) return null;
    if (hasTo && to < effFirst) return null;

    const stitchedInfo = ensureStitched1hBin(src, symbol, m1Info, h1Info);
    if (!stitchedInfo.meta.count) return null;

    const h1PerBar = Math.max(1, Math.ceil(parsed.seconds / 3600));
    const maxRawH1 = Math.max(count + 4, (count + 6) * h1PerBar);
    const filtered = queryBinarySlice(stitchedInfo.binPath, stitchedInfo.meta.count, {
      from,
      to,
      maxBars: maxRawH1,
      padFrom: hasFrom ? from - parsed.seconds : null,
    });

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

  // Sub-1h path (< 1h: 1m, 3m, 5m, 15m, 30m): O(log N) binary seek directly on 1m .bin file (< 2ms, < 1 MB RAM!)
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

  if (hasFrom && from > m1Last) return null;
  if (hasTo && to < m1First) return null;

  const m1PerBar = Math.max(1, Math.ceil(parsed.seconds / 60));
  const maxRawM1 = Math.max(count + 4, (count + 6) * m1PerBar);
  const filtered = queryBinarySlice(m1Info.binPath, m1Info.meta.count, {
    from,
    to,
    maxBars: maxRawM1,
  });

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
