import EventEmitter from 'node:events';
import { getConfig } from './env.js';
import { findCuratedSymbol } from './symbols.js';
import { parseTimeframe, resampleOhlc } from './timeframes.js';

const NATIVE_OANDA_MAP = {
  '5s': 'S5',
  '10s': 'S10',
  '15s': 'S15',
  '30s': 'S30',
  '1m': 'M1',
  '2m': 'M2',
  '3m': 'M3',
  '4m': 'M4',
  '5m': 'M5',
  '10m': 'M10',
  '15m': 'M15',
  '30m': 'M30',
  '1h': 'H1',
  '2h': 'H2',
  '3h': 'H3',
  '4h': 'H4',
  '6h': 'H6',
  '8h': 'H8',
  '12h': 'H12',
  '1d': 'D',
  '1w': 'W',
  '1M': 'M',
};

function pickOandaGranularity(parsed) {
  if (NATIVE_OANDA_MAP[parsed.label]) {
    return { granularity: NATIVE_OANDA_MAP[parsed.label], needsResample: false };
  }
  // Sub-5s (e.g. 1s): seed from S5, live stream builds exact 1s bars
  if (parsed.seconds < 5) {
    return { granularity: 'S5', needsResample: false, countOverride: 150 };
  }
  if (parsed.seconds < 60) {
    return { granularity: 'S5', needsResample: true, countOverride: 800 };
  }
  if (parsed.seconds < 3600) {
    return { granularity: 'M1', needsResample: true, countOverride: 1200 };
  }
  if (parsed.seconds < 86400) {
    return { granularity: 'H1', needsResample: true, countOverride: 1200 };
  }
  return { granularity: 'D', needsResample: true, countOverride: 1200 };
}

function getOandaHosts() {
  const cfg = getConfig();
  const isLive = cfg.OANDA_ENV === 'live';
  return {
    apiBase: isLive
      ? 'https://api-fxtrade.oanda.com'
      : 'https://api-fxpractice.oanda.com',
    streamBase: isLive
      ? 'https://stream-fxtrade.oanda.com'
      : 'https://stream-fxpractice.oanda.com',
    apiKey: cfg.OANDA_API_KEY,
    accountId: cfg.OANDA_ACCOUNT_ID,
    env: cfg.OANDA_ENV,
  };
}

let cachedInstruments = null;
let instrumentsFetchedAt = 0;

export function getCachedOandaInstruments() {
  return cachedInstruments || [];
}

export async function fetchOandaInstruments() {
  const { apiBase, apiKey, accountId } = getOandaHosts();
  if (!apiKey || !accountId) return [];

  const now = Date.now();
  if (cachedInstruments && now - instrumentsFetchedAt < 10 * 60 * 1000) {
    return cachedInstruments;
  }

  try {
    const res = await fetch(`${apiBase}/v3/accounts/${accountId}/instruments`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Accept-Datetime-Format': 'UNIX',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new Error(`OANDA instruments HTTP ${res.status}`);
    }
    const data = await res.json();
    cachedInstruments = (data.instruments || []).map((inst) => ({
      symbol: inst.name,
      display: inst.displayName || inst.name.replace('_', '/'),
      name: `${inst.displayName || inst.name} (${inst.type})`,
      source: 'oanda',
      exchange: 'OANDA',
      category: inst.type === 'CURRENCY' ? 'Forex' : inst.type === 'METAL' ? 'Metal' : 'CFD',
      precision: Number.isFinite(inst.displayPrecision) ? inst.displayPrecision : 4,
    }));
    instrumentsFetchedAt = now;
    return cachedInstruments;
  } catch (err) {
    console.warn('[OANDA] Could not fetch instrument list:', err.message);
    return cachedInstruments || [];
  }
}

const DXY_COMPONENTS = [
  { symbol: 'EUR_USD', weight: -0.576 },
  { symbol: 'USD_JPY', weight: 0.136 },
  { symbol: 'GBP_USD', weight: -0.119 },
  { symbol: 'USD_CAD', weight: 0.091 },
  { symbol: 'USD_SEK', weight: 0.042 },
  { symbol: 'USD_CHF', weight: 0.036 },
];
const DXY_CONSTANT = 50.14348112;

function calcDxyValue(pricesBySym) {
  let val = DXY_CONSTANT;
  for (const c of DXY_COMPONENTS) {
    const p = pricesBySym[c.symbol];
    if (!Number.isFinite(p) || p <= 0) return NaN;
    val *= Math.pow(p, c.weight);
  }
  return Number(val.toFixed(3));
}

async function fetchSyntheticDxyCandles(tf = '1m', count = 1200, toUnixSec = null) {
  const parsed = parseTimeframe(tf);
  const safeDxyCount = Math.min(Number(count) || 1200, 2200);
  // Fetch 6 ICE DXY component pairs in 2 gentle batches of 3 to avoid OANDA 504 rate bursts
  const firstHalf = await Promise.all(
    DXY_COMPONENTS.slice(0, 3).map((c) => fetchOandaCandles(c.symbol, tf, safeDxyCount, toUnixSec))
  );
  const secondHalf = await Promise.all(
    DXY_COMPONENTS.slice(3).map((c) => fetchOandaCandles(c.symbol, tf, safeDxyCount, toUnixSec))
  );
  const results = [...firstHalf, ...secondHalf];

  // Align timestamps across the 6 component pairs using carry-forward of most recent known price
  const maps = results.map((r) => {
    const m = new Map();
    for (const b of r.bars || []) m.set(b.time, b);
    return m;
  });

  const allTimes = new Set();
  for (const b of results[0].bars || []) allTimes.add(b.time);
  const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);

  const lastKnown = {};
  const bars = [];
  for (const t of sortedTimes) {
    const oMap = {};
    const hMap = {};
    const lMap = {};
    const cMap = {};
    let ready = true;
    for (let i = 0; i < DXY_COMPONENTS.length; i++) {
      const comp = DXY_COMPONENTS[i];
      const bar = maps[i].get(t) || lastKnown[comp.symbol];
      if (!bar) {
        ready = false;
        break;
      }
      lastKnown[comp.symbol] = bar;
      oMap[comp.symbol] = bar.open;
      cMap[comp.symbol] = bar.close;
      // For negative-weight pairs (EUR_USD, GBP_USD), pair low drives DXY high and vice versa!
      hMap[comp.symbol] = comp.weight < 0 ? bar.low : bar.high;
      lMap[comp.symbol] = comp.weight < 0 ? bar.high : bar.low;
    }
    if (!ready) continue;
    const o = calcDxyValue(oMap);
    const c = calcDxyValue(cMap);
    const hRaw = calcDxyValue(hMap);
    const lRaw = calcDxyValue(lMap);
    if (!Number.isFinite(o) || !Number.isFinite(c)) continue;
    bars.push({
      time: t,
      open: o,
      high: Math.max(o, c, Number.isFinite(hRaw) ? hRaw : o),
      low: Math.min(o, c, Number.isFinite(lRaw) ? lRaw : o),
      close: c,
    });
  }

  const lastPrice = bars.length ? bars[bars.length - 1].close : null;
  const firstPrice = bars.length ? bars[0].open : null;
  return {
    source: 'oanda',
    symbol: 'DXY',
    display: 'DXY',
    exchange: 'OANDA',
    tf: parsed.label,
    bucketSec: parsed.seconds,
    precision: 3,
    feedMode: 'live',
    bars,
    lastPrice,
    referencePrice: firstPrice,
  };
}

export async function fetchOandaCandles(symbol, tf = '1m', count = 1200, toUnixSec = null) {
  if (String(symbol || '').toUpperCase() === 'DXY') {
    return fetchSyntheticDxyCandles(tf, count, toUnixSec);
  }
  const { apiBase, apiKey } = getOandaHosts();
  if (!apiKey) {
    const err = new Error('OANDA API key is not configured yet. Add your free OANDA Practice key in Settings.');
    err.code = 'NO_OANDA_KEY';
    throw err;
  }

  const parsed = parseTimeframe(tf);
  const { granularity, needsResample, countOverride } = pickOandaGranularity(parsed);
  const safeCount = Math.min(Math.max(Number(countOverride || count) || 1200, 50), 4500);
  let url = `${apiBase}/v3/instruments/${encodeURIComponent(symbol)}/candles?price=M&granularity=${granularity}&count=${safeCount}`;
  if (Number.isFinite(toUnixSec) && toUnixSec > 0) {
    // Request older candles strictly before toUnixSec for infinite scroll-left history
    url += `&to=${Math.floor(toUnixSec)}`;
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Accept-Datetime-Format': 'UNIX',
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OANDA API hatası (${res.status}): ${body.slice(0, 140)}`);
  }

  const data = await res.json();
  const candles = data.candles || [];
  let bars = [];
  let lastTime = -1;

  for (const c of candles) {
    const o = Number.parseFloat(c.mid?.o);
    const h = Number.parseFloat(c.mid?.h);
    const l = Number.parseFloat(c.mid?.l);
    const cl = Number.parseFloat(c.mid?.c);
    const ts = Math.floor(Number.parseFloat(c.time));
    if (
      !Number.isFinite(o) ||
      !Number.isFinite(h) ||
      !Number.isFinite(l) ||
      !Number.isFinite(cl) ||
      !Number.isFinite(ts)
    ) {
      continue;
    }
    if (ts <= lastTime) continue;
    lastTime = ts;
    bars.push({ time: ts, open: o, high: h, low: l, close: cl });
  }

  if (needsResample && bars.length > 0) {
    bars = resampleOhlc(bars, parsed);
  }

  const curated = findCuratedSymbol('oanda', symbol);
  const fromList = cachedInstruments?.find((i) => i.symbol === symbol);
  const lastPrice = bars.length ? bars[bars.length - 1].close : null;
  const firstPrice = bars.length ? bars[0].open : null;
  const precision = curated?.precision ?? fromList?.precision ?? inferPrecision(lastPrice);

  return {
    source: 'oanda',
    symbol,
    display: curated?.display || fromList?.display || symbol.replace('_', '/'),
    exchange: 'OANDA',
    tf: parsed.label,
    bucketSec: parsed.seconds,
    precision,
    feedMode: 'live',
    bars,
    lastPrice,
    referencePrice: firstPrice,
  };
}

function inferPrecision(price) {
  if (!Number.isFinite(price)) return 4;
  if (price >= 1000) return 2;
  if (price >= 50) return 3;
  return 5;
}

export class OandaStreamManager extends EventEmitter {
  constructor() {
    super();
    this.subscribed = new Set();
    this.abortController = null;
    this.reconnectTimer = null;
    this.backoffMs = 1000;
    this.status = 'idle'; // idle | connecting | live | error | no_key
    this.lastError = null;
    this.lastHeartbeat = null;
    this.latestTicks = new Map();
    this.connectionId = 0;
  }

  getStatus() {
    return {
      status: this.status,
      lastError: this.lastError,
      lastHeartbeat: this.lastHeartbeat,
      symbols: Array.from(this.subscribed),
    };
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.subscribed.size === 0) {
      this.status = 'idle';
      this.lastError = null;
      this.emit('status', this.getStatus());
      return;
    }

    const { apiKey, accountId } = getOandaHosts();
    if (!apiKey || !accountId) {
      this.status = 'no_key';
      this.lastError = 'OANDA API anahtarı veya Account ID eksik';
      this.emit('status', this.getStatus());
      return;
    }

    this.backoffMs = 1000;
    this._connect();
  }

  async _connect() {
    const myId = ++this.connectionId;
    const { streamBase, apiKey, accountId } = getOandaHosts();
    if (!apiKey || !accountId || this.subscribed.size === 0) return;

    const rawList = new Set();
    for (const sym of this.subscribed) {
      if (sym === 'DXY') {
        for (const c of DXY_COMPONENTS) rawList.add(c.symbol);
      } else {
        rawList.add(sym);
      }
    }
    const instruments = Array.from(rawList).join(',');
    const url = `${streamBase}/v3/accounts/${encodeURIComponent(accountId)}/pricing/stream?instruments=${encodeURIComponent(instruments)}`;

    const controller = new AbortController();
    this.abortController = controller;
    this.status = 'connecting';
    this.lastError = null;
    this.emit('status', this.getStatus());

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Accept-Datetime-Format': 'UNIX',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      }

      if (!res.body) {
        throw new Error('Boş OANDA akış yanıtı');
      }

      this.status = 'live';
      this.backoffMs = 1000;
      this.lastHeartbeat = Date.now();
      this.emit('status', this.getStatus());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (myId !== this.connectionId) return;

        buffer += decoder.decode(value, { stream: true });
        let nlIdx;
        while ((nlIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nlIdx).trim();
          buffer = buffer.slice(nlIdx + 1);
          if (!line) continue;
          this._handleLine(line);
        }
      }

      if (myId === this.connectionId && this.subscribed.size > 0) {
        this._scheduleReconnect('OANDA akışı kapandı, yeniden bağlanılıyor...');
      }
    } catch (err) {
      if (err.name === 'AbortError' || myId !== this.connectionId) return;
      this._scheduleReconnect(err.message);
    }
  }

  _handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    if (msg.type === 'HEARTBEAT') {
      this.lastHeartbeat = Date.now();
      return;
    }

    if (msg.type === 'PRICE' && msg.instrument) {
      const bid = Number.parseFloat(msg.bids?.[0]?.price ?? msg.closeoutBid);
      const ask = Number.parseFloat(msg.asks?.[0]?.price ?? msg.closeoutAsk);
      const price =
        Number.isFinite(bid) && Number.isFinite(ask)
          ? (bid + ask) / 2
          : Number.isFinite(bid)
          ? bid
          : ask;
      const time = Math.floor(Number.parseFloat(msg.time)) || Math.floor(Date.now() / 1000);
      if (!Number.isFinite(price)) return;

      const tick = {
        source: 'oanda',
        symbol: msg.instrument,
        price,
        bid: Number.isFinite(bid) ? bid : price,
        ask: Number.isFinite(ask) ? ask : price,
        time,
        tradeable: msg.tradeable !== false,
        feedMode: msg.tradeable === false ? 'closed' : 'live',
      };
      this.latestTicks.set(msg.instrument, tick);
      this.lastHeartbeat = Date.now();
      this.emit('tick', tick);

      if (this.subscribed.has('DXY') && DXY_COMPONENTS.some((c) => c.symbol === msg.instrument)) {
        const prices = {};
        let allReady = true;
        for (const c of DXY_COMPONENTS) {
          const t = this.latestTicks.get(c.symbol);
          if (!t || !Number.isFinite(t.price)) {
            allReady = false;
            break;
          }
          prices[c.symbol] = t.price;
        }
        if (allReady) {
          const dxyVal = calcDxyValue(prices);
          if (Number.isFinite(dxyVal)) {
            const dxyTick = {
              source: 'oanda',
              symbol: 'DXY',
              price: dxyVal,
              bid: dxyVal,
              ask: dxyVal,
              time,
              tradeable: true,
              feedMode: 'live',
            };
            this.latestTicks.set('DXY', dxyTick);
            this.emit('tick', dxyTick);
          }
        }
      }
    }
  }

  _scheduleReconnect(reason) {
    this.status = 'error';
    this.lastError = reason;
    this.emit('status', this.getStatus());

    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.8, 15000);
    this.reconnectTimer = setTimeout(() => {
      if (this.subscribed.size > 0) {
        this._connect();
      }
    }, delay);
  }
}
