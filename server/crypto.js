import EventEmitter from 'node:events';
import { findCuratedSymbol } from './symbols.js';
import { parseTimeframe, resampleOhlc } from './timeframes.js';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

export const CRYPTO_SOURCES = new Set(['binance', 'coinbase', 'bybit', 'kraken']);

function inferPrecision(price) {
  if (!Number.isFinite(price)) return 2;
  if (price >= 1000) return 2;
  if (price >= 10) return 3;
  if (price >= 1) return 4;
  if (price >= 0.01) return 5;
  return 8;
}

// ============================================================================
// Historical OHLC Fetchers (Zero API Key, Supports Pagination where available)
// ============================================================================
const BINANCE_NATIVE = new Set([
  '1s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w', '1M',
]);

async function fetchBinanceHistory(symbol, parsed, count = 1000, toUnixSec = null) {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let interval = parsed.label;
  let needsResample = false;

  if (!BINANCE_NATIVE.has(interval)) {
    needsResample = true;
    if (parsed.seconds < 60) interval = '1s';
    else if (parsed.seconds < 3600) interval = '1m';
    else if (parsed.seconds < 86400) interval = '1h';
    else interval = '1d';
  }

  const limit = Math.min(Math.max(Number(count) || 1000, 50), 1000);
  let url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=${interval}&limit=${limit}`;
  if (Number.isFinite(toUnixSec) && toUnixSec > 0) {
    url += `&endTime=${Math.floor(toUnixSec * 1000)}`;
  }

  const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Binance HTTP ${res.status}: ${txt.slice(0, 100)}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('Invalid Binance kline response');

  let bars = [];
  let prevT = -1;
  for (const r of rows) {
    const t = Math.floor(Number(r[0]) / 1000);
    const open = Number.parseFloat(r[1]);
    const high = Number.parseFloat(r[2]);
    const low = Number.parseFloat(r[3]);
    const close = Number.parseFloat(r[4]);
    if (!Number.isFinite(t) || !Number.isFinite(close) || t <= prevT) continue;
    prevT = t;
    bars.push({ time: t, open, high, low, close });
  }
  if (needsResample && bars.length) {
    bars = resampleOhlc(bars, parsed);
  }
  return bars;
}

const COINBASE_GRANULARITIES = [60, 300, 900, 3600, 21600, 86400];

async function fetchCoinbaseHistory(symbol, parsed, count = 300, toUnixSec = null) {
  const sym = symbol.toUpperCase().replace('/', '-');
  let gran = 60;
  for (const g of COINBASE_GRANULARITIES) {
    if (g <= parsed.seconds) gran = g;
  }
  const needsResample = gran !== parsed.seconds && parsed.seconds > gran;
  const limitBars = Math.min(Math.max(Number(count) || 300, 60), 300);

  let url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(sym)}/candles?granularity=${gran}`;
  if (Number.isFinite(toUnixSec) && toUnixSec > 0) {
    const endIso = new Date(toUnixSec * 1000).toISOString();
    const startIso = new Date((toUnixSec - limitBars * gran) * 1000).toISOString();
    url += `&start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`;
  }

  const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Coinbase HTTP ${res.status}: ${txt.slice(0, 100)}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('Invalid Coinbase candle response');

  // Coinbase returns descending [time, low, high, open, close, volume]
  let bars = rows
    .map((r) => ({
      time: Math.floor(Number(r[0])),
      low: Number(r[1]),
      high: Number(r[2]),
      open: Number(r[3]),
      close: Number(r[4]),
    }))
    .filter((b) => Number.isFinite(b.time) && Number.isFinite(b.close))
    .sort((a, b) => a.time - b.time);

  // Deduplicate ascending timestamps
  const dedup = [];
  let prevT = -1;
  for (const b of bars) {
    if (b.time > prevT) {
      dedup.push(b);
      prevT = b.time;
    }
  }
  bars = dedup;

  if (needsResample && bars.length) {
    bars = resampleOhlc(bars, parsed);
  }
  return bars;
}

const BYBIT_MAP = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '6h': '360',
  '12h': '720',
  '1d': 'D',
  '1w': 'W',
  '1M': 'M',
};

async function fetchBybitHistory(symbol, parsed, count = 1000, toUnixSec = null) {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let interval = BYBIT_MAP[parsed.label];
  let needsResample = false;
  if (!interval) {
    needsResample = parsed.seconds > 60;
    if (parsed.seconds < 3600) interval = '1';
    else if (parsed.seconds < 86400) interval = '60';
    else interval = 'D';
  }

  const limit = Math.min(Math.max(Number(count) || 1000, 50), 1000);
  let url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${encodeURIComponent(sym)}&interval=${interval}&limit=${limit}`;
  if (Number.isFinite(toUnixSec) && toUnixSec > 0) {
    url += `&end=${Math.floor(toUnixSec * 1000)}`;
  }

  const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Bybit HTTP ${res.status}`);
  const json = await res.json();
  if (json.retCode !== 0 || !Array.isArray(json.result?.list)) {
    throw new Error(json.retMsg || 'Invalid Bybit response');
  }

  // Bybit returns descending [startTimeMs, open, high, low, close, volume, turnover]
  let bars = json.result.list
    .map((r) => ({
      time: Math.floor(Number(r[0]) / 1000),
      open: Number.parseFloat(r[1]),
      high: Number.parseFloat(r[2]),
      low: Number.parseFloat(r[3]),
      close: Number.parseFloat(r[4]),
    }))
    .filter((b) => Number.isFinite(b.time) && Number.isFinite(b.close))
    .sort((a, b) => a.time - b.time);

  const dedup = [];
  let prevT = -1;
  for (const b of bars) {
    if (b.time > prevT) {
      dedup.push(b);
      prevT = b.time;
    }
  }
  bars = dedup;
  if (needsResample && bars.length) {
    bars = resampleOhlc(bars, parsed);
  }
  return bars;
}

const KRAKEN_INTERVALS = [1, 5, 15, 30, 60, 240, 1440, 10080];

async function fetchKrakenHistory(symbol, parsed) {
  // Kraken REST expects pair like BTCUSD / ETHUSD (or XBTUSD)
  const pair = symbol.toUpperCase().replace('/', '').replace('BTC', 'XBT');
  const mins = Math.max(1, Math.floor(parsed.seconds / 60));
  let interval = 1;
  for (const k of KRAKEN_INTERVALS) {
    if (k <= mins) interval = k;
  }
  const needsResample = interval * 60 !== parsed.seconds && parsed.seconds > interval * 60;

  const url = `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=${interval}`;
  const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
  const json = await res.json();
  if (Array.isArray(json.error) && json.error.length > 0) {
    throw new Error(json.error[0]);
  }
  const resultKey = Object.keys(json.result || {}).find((k) => k !== 'last');
  const rows = resultKey ? json.result[resultKey] : [];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`No Kraken data for ${symbol}`);
  }

  let bars = [];
  let prevT = -1;
  for (const r of rows) {
    const t = Math.floor(Number(r[0]));
    const open = Number.parseFloat(r[1]);
    const high = Number.parseFloat(r[2]);
    const low = Number.parseFloat(r[3]);
    const close = Number.parseFloat(r[4]);
    if (!Number.isFinite(t) || !Number.isFinite(close) || t <= prevT) continue;
    prevT = t;
    bars.push({ time: t, open, high, low, close });
  }
  if (needsResample && bars.length) {
    bars = resampleOhlc(bars, parsed);
  }
  return bars;
}

export async function fetchCryptoHistory(source, symbol, tf = '1m', count = 1000, toUnixSec = null) {
  const parsed = parseTimeframe(tf);
  const curated = findCuratedSymbol(source, symbol);

  let bars = [];
  if (source === 'binance') {
    bars = await fetchBinanceHistory(symbol, parsed, count, toUnixSec);
  } else if (source === 'coinbase') {
    bars = await fetchCoinbaseHistory(symbol, parsed, Math.min(count, 300), toUnixSec);
  } else if (source === 'bybit') {
    bars = await fetchBybitHistory(symbol, parsed, count, toUnixSec);
  } else if (source === 'kraken') {
    bars = await fetchKrakenHistory(symbol, parsed);
  } else {
    throw new Error(`Unsupported crypto source: ${source}`);
  }

  const lastPrice = bars.length ? bars[bars.length - 1].close : null;
  const firstPrice = bars.length ? bars[0].open : null;
  const precision = curated?.precision ?? inferPrecision(lastPrice);
  const exchangeLabel = source.toUpperCase();

  return {
    source,
    symbol,
    display: curated?.display || symbol,
    exchange: exchangeLabel,
    tf: parsed.label,
    bucketSec: parsed.seconds,
    precision,
    feedMode: 'live',
    bars,
    lastPrice,
    referencePrice: firstPrice,
  };
}

// ============================================================================
// Real-Time Multi-Exchange WebSocket Stream Manager (Zero API Keys!)
// ============================================================================
class SingleExchangeWs extends EventEmitter {
  constructor(source) {
    super();
    this.source = source;
    this.subscribed = new Set();
    this.ws = null;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.backoffMs = 1500;
    this.status = 'idle';
    this.latestTicks = new Map();
    this.connId = 0;
  }

  setSymbols(symbolsIterable) {
    const next = new Set(Array.from(symbolsIterable).filter(Boolean));
    const same =
      next.size === this.subscribed.size &&
      Array.from(next).every((s) => this.subscribed.has(s));
    if (same) return;
    this.subscribed = next;
    this.restart();
  }

  restart() {
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    if (this.subscribed.size === 0) {
      this.status = 'idle';
      this.emit('status', this.status);
      return;
    }
    this.backoffMs = 1500;
    this._connect();
  }

  _buildUrl() {
    if (this.source === 'binance') {
      const streams = Array.from(this.subscribed)
        .map((s) => `${s.toLowerCase().replace(/[^a-z0-9]/g, '')}@miniTicker`)
        .join('/');
      return `wss://data-stream.binance.vision/stream?streams=${streams}`;
    }
    if (this.source === 'coinbase') return 'wss://ws-feed.exchange.coinbase.com';
    if (this.source === 'bybit') return 'wss://stream.bybit.com/v5/public/spot';
    if (this.source === 'kraken') return 'wss://ws.kraken.com/v2';
    return null;
  }

  _sendSubscribe(ws) {
    const syms = Array.from(this.subscribed);
    if (this.source === 'coinbase') {
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          product_ids: syms.map((s) => s.toUpperCase().replace('/', '-')),
          channels: ['ticker'],
        })
      );
    } else if (this.source === 'bybit') {
      ws.send(
        JSON.stringify({
          op: 'subscribe',
          args: syms.map((s) => `tickers.${s.toUpperCase().replace(/[^A-Z0-9]/g, '')}`),
        })
      );
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ op: 'ping' }));
        }
      }, 20000);
    } else if (this.source === 'kraken') {
      ws.send(
        JSON.stringify({
          method: 'subscribe',
          params: {
            channel: 'ticker',
            symbol: syms.map((s) => (s.includes('/') ? s.toUpperCase() : s.toUpperCase().replace('-', '/'))),
          },
        })
      );
    }
  }

  _parseMessage(rawText) {
    let msg;
    try {
      msg = JSON.parse(rawText);
    } catch {
      return;
    }
    const nowSec = Math.floor(Date.now() / 1000);

    if (this.source === 'binance' && msg.data?.s && msg.data?.c) {
      const sym = String(msg.data.s).toUpperCase();
      const price = Number.parseFloat(msg.data.c);
      const time = Math.floor(Number(msg.data.E) / 1000) || nowSec;
      this._emitTick(sym, price, time);
      return;
    }

    if (this.source === 'coinbase' && msg.type === 'ticker' && msg.product_id && msg.price) {
      const sym = String(msg.product_id).toUpperCase();
      const price = Number.parseFloat(msg.price);
      const time = msg.time ? Math.floor(Date.parse(msg.time) / 1000) || nowSec : nowSec;
      this._emitTick(sym, price, time);
      return;
    }

    if (this.source === 'bybit' && msg.topic?.startsWith('tickers.') && msg.data?.lastPrice) {
      const sym = String(msg.data.symbol || msg.topic.slice(8)).toUpperCase();
      const price = Number.parseFloat(msg.data.lastPrice);
      const time = Math.floor(Number(msg.ts) / 1000) || nowSec;
      this._emitTick(sym, price, time);
      return;
    }

    if (this.source === 'kraken' && msg.channel === 'ticker' && Array.isArray(msg.data)) {
      for (const item of msg.data) {
        if (item.symbol && Number.isFinite(Number(item.last))) {
          this._emitTick(String(item.symbol).toUpperCase(), Number(item.last), nowSec);
        }
      }
    }
  }

  _emitTick(sym, price, time) {
    if (!Number.isFinite(price)) return;
    // Match exact subscribed symbol string (handles case/format normalization)
    let matched = sym;
    for (const s of this.subscribed) {
      if (s.toUpperCase() === sym || s.toUpperCase().replace(/[^A-Z0-9]/g, '') === sym.replace(/[^A-Z0-9]/g, '')) {
        matched = s;
        break;
      }
    }
    const tick = {
      source: this.source,
      symbol: matched,
      price,
      time,
      feedMode: 'live',
    };
    const prev = this.latestTicks.get(matched);
    this.latestTicks.set(matched, tick);
    if (!prev || prev.price !== tick.price || tick.time - prev.time >= 1) {
      this.emit('tick', tick);
    }
  }

  _connect() {
    const myId = ++this.connId;
    const url = this._buildUrl();
    if (!url || typeof WebSocket === 'undefined') return;

    this.status = 'connecting';
    this.emit('status', this.status);

    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.addEventListener('open', () => {
        if (myId !== this.connId) return;
        this.status = 'live';
        this.backoffMs = 1500;
        this.emit('status', this.status);
        try {
          this._sendSubscribe(ws);
        } catch {
          // ignore
        }
      });

      ws.addEventListener('message', (ev) => {
        if (myId !== this.connId) return;
        this._parseMessage(String(ev.data));
      });

      ws.addEventListener('close', () => {
        if (myId !== this.connId) return;
        this._scheduleReconnect();
      });

      ws.addEventListener('error', () => {
        if (myId !== this.connId) return;
        try {
          ws.close();
        } catch {
          // ignore
        }
      });
    } catch {
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.subscribed.size === 0) return;
    this.status = 'error';
    this.emit('status', this.status);
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.8, 20000);
    this.reconnectTimer = setTimeout(() => {
      if (this.subscribed.size > 0) this._connect();
    }, delay);
  }
}

export class CryptoStreamManager extends EventEmitter {
  constructor() {
    super();
    this.exchanges = {
      binance: new SingleExchangeWs('binance'),
      coinbase: new SingleExchangeWs('coinbase'),
      bybit: new SingleExchangeWs('bybit'),
      kraken: new SingleExchangeWs('kraken'),
    };
    for (const ex of Object.values(this.exchanges)) {
      ex.on('tick', (tick) => this.emit('tick', tick));
      ex.on('status', () => this.emit('status', this.getStatus()));
    }
  }

  setSymbolsBySource(mapBySource) {
    for (const [src, ex] of Object.entries(this.exchanges)) {
      ex.setSymbols(mapBySource[src] || []);
    }
  }

  getLatestTick(source, symbol) {
    return this.exchanges[source]?.latestTicks.get(symbol) || null;
  }

  getStatus() {
    const statuses = Object.values(this.exchanges).map((e) => e.status);
    const activeCount = Object.values(this.exchanges).reduce((acc, e) => acc + e.subscribed.size, 0);
    if (activeCount === 0) return { status: 'idle', activeCount: 0 };
    if (statuses.includes('live')) return { status: 'live', activeCount };
    if (statuses.includes('connecting')) return { status: 'connecting', activeCount };
    return { status: 'error', activeCount };
  }
}
