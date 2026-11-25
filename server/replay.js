/**
 * LinePulse Backtest / Bar-Replay Backend Engine
 * - Paginated historical OHLC fetcher with local disk cache (data/replay-cache/)
 * - Supports OANDA (2015+ on 1m & 5s), Binance (2017+ on 1m), Bybit, Coinbase, Kraken
 * - Persistent Backtest Sessions (data/backtest-sessions.json)
 * - Persistent Prop Firm Rule Presets: FTMO, The5ers + Custom User Rules (data/prop-rules.json)
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './env.js';
import { fetchOandaCandles } from './oanda.js';
import { fetchCryptoHistory, CRYPTO_SOURCES } from './crypto.js';
import { fetchCmeHistory } from './cme.js';
import { fetchDukascopyRange, readArchiveSlice, DUKASCOPY_SPECS } from './archive.js';
import { parseTimeframe, resampleOhlc } from './timeframes.js';

export const BUILTIN_PROP_RULES = [
  {
    id: 'ftmo_2step',
    name: 'FTMO Challenge (Step 1)',
    builtin: true,
    dailyMaxLossPct: 5,
    totalMaxLossPct: 10,
    profitTargetPct: 10,
    trailingDrawdown: false,
    minTradingDays: 4,
    defaultSpreadPips: 0.8,
    defaultCommissionPerLot: 5,
    notes: 'FTMO Standard Challenge: 5% daily loss limit, 10% max overall loss (static), 10% profit target, min 4 trading days.',
  },
  {
    id: 'ftmo_verify',
    name: 'FTMO Verification (Step 2)',
    builtin: true,
    dailyMaxLossPct: 5,
    totalMaxLossPct: 10,
    profitTargetPct: 5,
    trailingDrawdown: false,
    minTradingDays: 4,
    defaultSpreadPips: 0.8,
    defaultCommissionPerLot: 5,
    notes: 'FTMO Phase 2 Verification: 5% daily loss limit, 10% max overall loss, 5% profit target, min 4 trading days.',
  },
  {
    id: 'the5ers_highstakes',
    name: 'The5ers High Stakes (Step 1)',
    builtin: true,
    dailyMaxLossPct: 5,
    totalMaxLossPct: 10,
    profitTargetPct: 8,
    trailingDrawdown: false,
    minTradingDays: 3,
    defaultSpreadPips: 0.6,
    defaultCommissionPerLot: 4,
    notes: 'The5ers High Stakes Step 1: 5% daily drawdown, 10% max stop-out, 8% profit target, min 3 profitable days.',
  },
  {
    id: 'the5ers_bootcamp',
    name: 'The5ers Bootcamp / Hyper',
    builtin: true,
    dailyMaxLossPct: 3,
    totalMaxLossPct: 5,
    profitTargetPct: 6,
    trailingDrawdown: false,
    minTradingDays: 0,
    defaultSpreadPips: 0.6,
    defaultCommissionPerLot: 4,
    notes: 'The5ers Bootcamp / Hyper Growth: 3% daily pause, 5% max loss, 6% profit target.',
  },
  {
    id: 'free_practice',
    name: 'Free Practice (No Rules)',
    builtin: true,
    dailyMaxLossPct: 0,
    totalMaxLossPct: 0,
    profitTargetPct: 0,
    trailingDrawdown: false,
    minTradingDays: 0,
    defaultSpreadPips: 0.5,
    defaultCommissionPerLot: 3,
    notes: 'No drawdown or profit target limits — pure strategy testing.',
  },
];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getCacheDir() {
  const d = path.join(getDataDir(), 'replay-cache');
  ensureDir(d);
  return d;
}

function getSessionsFile() {
  const dir = getDataDir();
  ensureDir(dir);
  return path.join(dir, 'backtest-sessions.json');
}

function getPropRulesFile() {
  const dir = getDataDir();
  ensureDir(dir);
  return path.join(dir, 'prop-rules.json');
}

// ============================================================================
// Prop Firm Rule Presets (Built-in FTMO / The5ers + User Custom Saved Rules)
// ============================================================================
function readCustomPropRules() {
  const f = getPropRulesFile();
  if (!fs.existsSync(f)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(parsed.rules) ? parsed.rules : [];
  } catch {
    return [];
  }
}

function writeCustomPropRules(rules) {
  fs.writeFileSync(getPropRulesFile(), JSON.stringify({ rules }, null, 2), 'utf8');
}

export function listPropRules() {
  return [...BUILTIN_PROP_RULES, ...readCustomPropRules()];
}

export function saveCustomPropRule(rule) {
  const name = String(rule?.name || '').trim().slice(0, 48);
  if (!name) throw new Error('Rule name is required.');
  const custom = readCustomPropRules();
  const id =
    rule.id && !BUILTIN_PROP_RULES.some((b) => b.id === rule.id)
      ? String(rule.id)
      : `prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const entry = {
    id,
    name,
    builtin: false,
    dailyMaxLossPct: Math.max(0, Math.min(100, Number(rule.dailyMaxLossPct) || 0)),
    totalMaxLossPct: Math.max(0, Math.min(100, Number(rule.totalMaxLossPct) || 0)),
    profitTargetPct: Math.max(0, Math.min(500, Number(rule.profitTargetPct) || 0)),
    trailingDrawdown: Boolean(rule.trailingDrawdown),
    minTradingDays: Math.max(0, Math.min(365, Math.round(Number(rule.minTradingDays) || 0))),
    defaultSpreadPips: Math.max(0, Math.min(500, Number(rule.defaultSpreadPips) || 0)),
    defaultCommissionPerLot: Math.max(0, Math.min(500, Number(rule.defaultCommissionPerLot) || 0)),
    notes: String(rule.notes || '').trim().slice(0, 240),
  };

  const next = [entry, ...custom.filter((r) => r.id !== id)];
  writeCustomPropRules(next);
  return { rule: entry, rules: listPropRules() };
}

export function deleteCustomPropRule(id) {
  const custom = readCustomPropRules().filter((r) => r.id !== id);
  writeCustomPropRules(custom);
  return listPropRules();
}

// ============================================================================
// Persistent Backtest Sessions (data/backtest-sessions.json)
// ============================================================================
function readAllSessions() {
  const f = getSessionsFile();
  if (!fs.existsSync(f)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(parsed.sessions) ? parsed.sessions : [];
  } catch {
    return [];
  }
}

function writeAllSessions(sessions) {
  fs.writeFileSync(getSessionsFile(), JSON.stringify({ sessions }, null, 2), 'utf8');
}

export function listReplaySessions() {
  return readAllSessions().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function saveReplaySession(session) {
  if (!session || typeof session !== 'object') {
    throw new Error('Invalid session payload.');
  }
  const all = readAllSessions();
  const id = session.id ? String(session.id) : `bt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  const existing = all.find((s) => s.id === id);
  const entry = {
    ...session,
    id,
    name: String(session.name || `${session.display || session.symbol || 'Replay'} Session`).trim().slice(0, 64),
    createdAt: existing?.createdAt || session.createdAt || now,
    updatedAt: now,
  };
  const next = [entry, ...all.filter((s) => s.id !== id)];
  writeAllSessions(next);
  return { session: entry, sessions: listReplaySessions() };
}

export function deleteReplaySession(id) {
  const next = readAllSessions().filter((s) => s.id !== id);
  writeAllSessions(next);
  return listReplaySessions();
}

// ============================================================================
// Historical Paginated Bar Fetcher + Disk Cache (Zero Look-Ahead Replay Data)
// ============================================================================
function safeFileKey(str) {
  return String(str || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function dedupeSortBars(bars) {
  const sorted = bars
    .filter(
      (b) =>
        b &&
        Number.isFinite(b.time) &&
        Number.isFinite(b.open) &&
        Number.isFinite(b.high) &&
        Number.isFinite(b.low) &&
        Number.isFinite(b.close)
    )
    .sort((a, b) => a.time - b.time);
  const out = [];
  let prev = -1;
  for (const b of sorted) {
    if (b.time > prev) {
      out.push(b);
      prev = b.time;
    }
  }
  return out;
}

const CME_BACKTEST_SUGGESTIONS = {
  '@ND.1': { source: 'oanda', symbol: 'NAS100_USD', display: 'NAS100' },
  '@SP.1': { source: 'oanda', symbol: 'SPX500_USD', display: 'SPX500' },
  '@GC.1': { source: 'oanda', symbol: 'XAU_USD', display: 'XAU/USD' },
  '@URO.1': { source: 'oanda', symbol: 'EUR_USD', display: 'EUR/USD' },
  '@BP.1': { source: 'oanda', symbol: 'GBP_USD', display: 'GBP/USD' },
  '@DJ.1': { source: 'oanda', symbol: 'US30_USD', display: 'US30' },
};

async function fetchSingleHistoricalBatch(source, symbol, tf, count, toSec) {
  if (source === 'oanda') {
    return fetchOandaCandles(symbol, tf, count, toSec);
  }
  if (CRYPTO_SOURCES.has(source)) {
    return fetchCryptoHistory(source, symbol, tf, count, toSec);
  }
  // Free CME / Stocks via CNBC — only recent intraday history (~2-5 days on 1m)
  const parsed = parseTimeframe(tf);
  const nowSec = Math.floor(Date.now() / 1000);
  if (parsed.seconds < 86400 && toSec && nowSec - toSec > 5 * 86400) {
    const sug = CME_BACKTEST_SUGGESTIONS[symbol] || {
      source: 'oanda',
      symbol: 'XAU_USD',
      display: 'XAU/USD',
    };
    const err = new Error(
      `Free ${source.toUpperCase()} intraday (1m) data only covers the last ~2–5 days. For multi-year 1m backtesting back to 2015, use OANDA (${sug.display}) or Binance Crypto.`
    );
    err.code = 'LIMITED_FREE_HISTORY';
    err.suggestion = sug;
    throw err;
  }
  return fetchCmeHistory(symbol, tf, source);
}

/**
 * Fetches historical bars covering [fromSec .. toSec] (or `count` bars ending at `toSec`).
 * Automatically paginates backwards across API chunk limits and caches completed historical blocks on disk!
 */
export async function fetchReplayBars({
  source = 'oanda',
  symbol = 'XAU_USD',
  tf = '1m',
  from = null,
  to = null,
  count = 1500,
} = {}) {
  const src = String(source || 'oanda').toLowerCase();
  const parsed = parseTimeframe(tf);
  const nowSec = Math.floor(Date.now() / 1000);
  const toSec = Number.isFinite(Number(to)) && Number(to) > 0 ? Math.min(Number(to), nowSec) : nowSec;
  const fromSec = Number.isFinite(Number(from)) && Number(from) > 0 ? Number(from) : null;
  const desiredCount = Math.max(50, Math.min(Number(count) || 1500, 12000));

  // 0. Check Offline Local Data Archive FIRST (instant 0ms offline replay for Dukascopy, Databento, CSV, OANDA, Binance!)
  let htfOnlyErr = null;
  let archived = null;
  try {
    archived = readArchiveSlice({
      source: src,
      symbol,
      tf: parsed.label,
      from: fromSec,
      to: toSec,
      count: desiredCount,
    });
  } catch (err) {
    if (err.code === 'ONLY_HTF_AVAILABLE') {
      if (src === 'databento' || src === 'custom') throw err;
      htfOnlyErr = err;
    } else {
      throw err;
    }
  }
  if (archived && archived.bars.length > 0) {
    const coversRequested =
      src === 'dukascopy' ||
      src === 'databento' ||
      src === 'custom' ||
      ((!fromSec || archived.archiveFirstTime <= fromSec + 3600) &&
        archived.archiveLastTime >= toSec - 3600);
    if (coversRequested) {
      return { ...archived, exchange: src.toUpperCase(), fromCache: true };
    }
  }

  // 0b. On-demand Dukascopy fetch when not yet downloaded in local archive
  if (src === 'dukascopy') {
    const spanSec = Math.max(7 * 86400, Math.min(45 * 86400, desiredCount * parsed.seconds));
    const dukaFrom = fromSec || Math.max(0, toSec - spanSec);
    const m1 = await fetchDukascopyRange(symbol, dukaFrom, toSec);
    const resampled = parsed.label === '1m' ? m1 : resampleOhlc(m1, parsed, 'dukascopy');
    const spec = DUKASCOPY_SPECS[String(symbol).toUpperCase()] || {};
    return {
      source: 'dukascopy',
      symbol,
      display: spec.display || symbol,
      exchange: 'DUKASCOPY',
      tf: parsed.label,
      bucketSec: parsed.seconds,
      precision: spec.precision ?? 5,
      bars: resampled.slice(-desiredCount),
      fromCache: false,
    };
  }

  if (src === 'databento' || src === 'custom') {
    throw new Error(
      `No local archive found for ${src.toUpperCase()} ${symbol} in this date range. Open "📦 Data Archive" to download or import it first.`
    );
  }

  // Disk cache key (only cache historical segments strictly older than 5 minutes)
  const isPureHistory = nowSec - toSec > 300;
  const bucketFrom = fromSec ? Math.floor(fromSec / 3600) * 3600 : 0;
  const bucketTo = Math.floor(toSec / 3600) * 3600;
  const cacheFile = path.join(
    getCacheDir(),
    `${safeFileKey(src)}__${safeFileKey(symbol)}__${safeFileKey(parsed.label)}__${bucketFrom}__${bucketTo}__${desiredCount}.json`
  );

  if (isPureHistory && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Array.isArray(cached.bars) && cached.bars.length > 0) {
        return { ...cached, fromCache: true };
      }
    } catch {
      // rebuild cache
    }
  }

  // Paginate backwards from `toSec` until we cover `fromSec` or `desiredCount` (max 10 API calls per request)
  const maxBatchSize = src === 'oanda' ? 3500 : src === 'binance' || src === 'bybit' ? 1000 : 300;
  let cursorTo = toSec;
  let allBars = [];
  let meta = null;
  const maxPages = fromSec ? 10 : Math.min(6, Math.ceil(desiredCount / maxBatchSize) + 1);

  for (let page = 0; page < maxPages; page++) {
    const remaining = fromSec ? maxBatchSize : Math.min(maxBatchSize, desiredCount - allBars.length + 10);
    if (!fromSec && remaining <= 0) break;

    let batch;
    try {
      batch = await fetchSingleHistoricalBatch(src, symbol, parsed.label, remaining, cursorTo);
    } catch (err) {
      if (htfOnlyErr && allBars.length === 0) throw htfOnlyErr;
      throw err;
    }
    if (!meta) {
      meta = {
        source: batch.source || src,
        symbol: batch.symbol || symbol,
        display: batch.display || symbol,
        exchange: batch.exchange || src.toUpperCase(),
        tf: parsed.label,
        bucketSec: parsed.seconds,
        precision: batch.precision ?? 2,
      };
    }

    const batchBars = Array.isArray(batch.bars) ? batch.bars : [];
    if (batchBars.length === 0) break;

    allBars.push(...batchBars);
    const oldest = batchBars[0].time;
    if (oldest >= cursorTo) break;
    cursorTo = oldest - 1;

    if (fromSec && oldest <= fromSec) break;
    if (!fromSec && allBars.length >= desiredCount) break;
    // CNBC/Kraken do not support multi-page backward pagination
    if (src === 'cme' || src === 'stocks' || src === 'kraken') break;
  }

  let bars = dedupeSortBars(allBars).filter((b) => b.time <= toSec);
  if (fromSec) {
    bars = bars.filter((b) => b.time >= fromSec);
  } else if (bars.length > desiredCount) {
    bars = bars.slice(-desiredCount);
  }

  // If custom TF requested on a source that returned base TF, ensure clean TradingView session resampling
  if (bars.length > 0 && meta && meta.bucketSec !== parsed.seconds) {
    bars = resampleOhlc(bars, parsed, src);
    meta.bucketSec = parsed.seconds;
  }

  const result = {
    ...(meta || {
      source: src,
      symbol,
      display: symbol,
      exchange: src.toUpperCase(),
      tf: parsed.label,
      bucketSec: parsed.seconds,
      precision: 2,
    }),
    bars,
    fromCache: false,
  };

  if (isPureHistory && bars.length > 0) {
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(result), 'utf8');
    } catch {
      // ignore disk cache error
    }
  }

  return result;
}
