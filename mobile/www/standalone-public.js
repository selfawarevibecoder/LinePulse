/**
 * Velox Charts — Public Standalone Mobile Engine (Android & iOS Capacitor)
 * 100% Open-Source, Zero Embedded Keys, Zero Tracking, Zero External Servers Required:
 *  - Works out-of-the-box with free live Binance Crypto, CME Futures, FX Spot TRY, US Stocks & Borsa Istanbul (BIST)
 *  - Bring Your Own Key (BYOK): Enter your own free OANDA Practice API Key in Settings (saved ONLY on your device!)
 *  - Optional Self-Hosted Sync: Set `velox_server_url_v1` in localStorage to connect to your own personal server
 */
(function initVeloxPublicMobile() {
  if (typeof window === 'undefined') return;
  const origFetch = window.fetch.bind(window);
  try {
    const SB = window.Capacitor?.Plugins?.StatusBar;
    if (SB) {
      SB.setOverlaysWebView?.({ overlay: false }).catch?.(() => {});
      SB.setBackgroundColor?.({ color: '#0a0f1d' }).catch?.(() => {});
    }
  } catch {}
  if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
    return;
  }

  // Disable SharedWorker in standalone mobile WebView so live ticks flow cleanly through StandaloneEventSource
  try {
    window.SharedWorker = undefined;
  } catch {}

  const UA_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36',
    Accept: 'application/json',
  };

  const CATALOG = [
    { symbol: 'XAU_USD', display: 'XAU/USD', name: 'Gold / US Dollar (OANDA Key)', source: 'oanda', exchange: 'OANDA', category: 'Metal', precision: 2 },
    { symbol: 'DXY', display: 'DXY', name: 'US Dollar Index', source: 'oanda', exchange: 'OANDA', category: 'Index', precision: 3 },
    { symbol: 'EUR_USD', display: 'EUR/USD', name: 'Euro / US Dollar', source: 'oanda', exchange: 'OANDA', category: 'Forex', precision: 5 },
    { symbol: 'GBP_USD', display: 'GBP/USD', name: 'British Pound / US Dollar', source: 'oanda', exchange: 'OANDA', category: 'Forex', precision: 5 },
    { symbol: 'USD_CAD', display: 'USD/CAD', name: 'US Dollar / Canadian Dollar', source: 'oanda', exchange: 'OANDA', category: 'Forex', precision: 5 },
    { symbol: 'USD_JPY', display: 'USD/JPY', name: 'US Dollar / Japanese Yen', source: 'oanda', exchange: 'OANDA', category: 'Forex', precision: 3 },
    { symbol: 'EUR_GBP', display: 'EUR/GBP', name: 'Euro / British Pound', source: 'oanda', exchange: 'OANDA', category: 'Forex', precision: 5 },
    { symbol: 'AUD_USD', display: 'AUD/USD', name: 'Australian Dollar / US Dollar', source: 'oanda', exchange: 'OANDA', category: 'Forex', precision: 5 },
    { symbol: 'USD_CHF', display: 'USD/CHF', name: 'US Dollar / Swiss Franc', source: 'oanda', exchange: 'OANDA', category: 'Forex', precision: 5 },
    { symbol: 'NAS100_USD', display: 'NAS100', name: 'US Nasdaq 100 CFD', source: 'oanda', exchange: 'OANDA', category: 'Index', precision: 1 },
    { symbol: 'SPX500_USD', display: 'SPX500', name: 'US S&P 500 CFD', source: 'oanda', exchange: 'OANDA', category: 'Index', precision: 1 },
    { symbol: 'XAG_USD', display: 'XAG/USD', name: 'Silver / US Dollar', source: 'oanda', exchange: 'OANDA', category: 'Metal', precision: 4 },
    { symbol: 'WTICO_USD', display: 'WTI Oil', name: 'West Texas Oil CFD', source: 'oanda', exchange: 'OANDA', category: 'Energy', precision: 3 },
    { symbol: 'BCO_USD', display: 'Brent Oil', name: 'Brent Crude Oil CFD', source: 'oanda', exchange: 'OANDA', category: 'Energy', precision: 3 },
    { symbol: 'TRY=', display: 'USD/TRY', name: 'US Dollar / Turkish Lira (Spot)', source: 'cme', exchange: 'FX SPOT', category: 'Forex', precision: 4 },
    { symbol: 'EURTRY=', display: 'EUR/TRY', name: 'Euro / Turkish Lira (Spot)', source: 'cme', exchange: 'FX SPOT', category: 'Forex', precision: 4 },
    { symbol: 'GBPTRY=', display: 'GBP/TRY', name: 'British Pound / Turkish Lira (£/TRY Spot)', source: 'cme', exchange: 'FX SPOT', category: 'Forex', precision: 4 },
    { symbol: '@ND.1', display: 'NQ1!', name: 'E-mini Nasdaq-100 Futures', source: 'cme', exchange: 'CME', category: 'Futures', precision: 2 },
    { symbol: '@SP.1', display: 'ES1!', name: 'E-mini S&P 500 Futures', source: 'cme', exchange: 'CME', category: 'Futures', precision: 2 },
    { symbol: '@GC.1', display: 'GC1!', name: 'COMEX Gold Futures', source: 'cme', exchange: 'CME/COMEX', category: 'Futures', precision: 2 },
    { symbol: '@URO.1', display: '6E1!', name: 'CME Euro FX Futures', source: 'cme', exchange: 'CME', category: 'Futures', precision: 5 },
    { symbol: '@CL.1', display: 'CL1!', name: 'NYMEX WTI Crude Oil Futures', source: 'cme', exchange: 'CME/NYMEX', category: 'Futures', precision: 2 },
    { symbol: '@SI.1', display: 'SI1!', name: 'COMEX Silver Futures', source: 'cme', exchange: 'CME/COMEX', category: 'Futures', precision: 3 },
    { symbol: 'BTCUSDT', display: 'BTCUSDT', name: 'Bitcoin / TetherUS', source: 'binance', exchange: 'BINANCE', category: 'Crypto', precision: 2 },
    { symbol: 'ETHUSDT', display: 'ETHUSDT', name: 'Ethereum / TetherUS', source: 'binance', exchange: 'BINANCE', category: 'Crypto', precision: 2 },
    { symbol: 'SOLUSDT', display: 'SOLUSDT', name: 'Solana / TetherUS', source: 'binance', exchange: 'BINANCE', category: 'Crypto', precision: 2 },
    { symbol: 'XRPUSDT', display: 'XRPUSDT', name: 'XRP / TetherUS', source: 'binance', exchange: 'BINANCE', category: 'Crypto', precision: 4 },
    { symbol: 'XU100.IS', display: 'BIST 100', name: 'Borsa Istanbul 100 Index', source: 'stocks', exchange: 'BIST', category: 'BIST', precision: 2 },
    { symbol: 'XU030.IS', display: 'BIST 30', name: 'Borsa Istanbul 30 Index', source: 'stocks', exchange: 'BIST', category: 'BIST', precision: 2 },
    { symbol: 'XBANK.IS', display: 'XBANK', name: 'BIST Banks Index', source: 'stocks', exchange: 'BIST', category: 'BIST', precision: 2 },
    { symbol: 'THYAO.IS', display: 'THYAO', name: 'Turkish Airlines (BIST)', source: 'stocks', exchange: 'BIST', category: 'BIST', precision: 2 },
    { symbol: 'ASELS.IS', display: 'ASELS', name: 'Aselsan (BIST)', source: 'stocks', exchange: 'BIST', category: 'BIST', precision: 2 },
    { symbol: 'GARAN.IS', display: 'GARAN', name: 'Garanti BBVA (BIST)', source: 'stocks', exchange: 'BIST', category: 'BIST', precision: 2 },
    { symbol: 'AKBNK.IS', display: 'AKBNK', name: 'Akbank (BIST)', source: 'stocks', exchange: 'BIST', category: 'BIST', precision: 2 },
    { symbol: 'ISCTR.IS', display: 'ISCTR', name: 'Is Bankasi C (BIST)', source: 'stocks', exchange: 'BIST', category: 'BIST', precision: 2 },
    { symbol: 'YKBNK.IS', display: 'YKBNK', name: 'Yapi Kredi (BIST)', source: 'stocks', exchange: 'BIST', category: 'BIST', precision: 2 },
    { symbol: 'TUPRS.IS', display: 'TUPRS', name: 'Tupras (BIST)', source: 'stocks', exchange: 'BIST', category: 'BIST', precision: 2 },
    { symbol: 'EREGL.IS', display: 'EREGL', name: 'Eregli Demir Celik (BIST)', source: 'stocks', exchange: 'BIST', category: 'BIST', precision: 2 },
    { symbol: 'BIMAS.IS', display: 'BIMAS', name: 'BIM Magazalar (BIST)', source: 'stocks', exchange: 'BIST', category: 'BIST', precision: 2 },
    { symbol: 'KCHOL.IS', display: 'KCHOL', name: 'Koc Holding (BIST)', source: 'stocks', exchange: 'BIST', category: 'BIST', precision: 2 },
    { symbol: 'SAHOL.IS', display: 'SAHOL', name: 'Sabanci Holding (BIST)', source: 'stocks', exchange: 'BIST', category: 'BIST', precision: 2 },
    { symbol: 'SISE.IS', display: 'SISE', name: 'Sisecam (BIST)', source: 'stocks', exchange: 'BIST', category: 'BIST', precision: 2 },
    { symbol: 'SPY', display: 'SPY', name: 'SPDR S&P 500 ETF', source: 'stocks', exchange: 'NYSE/ETF', category: 'Stock', precision: 2 },
    { symbol: 'QQQ', display: 'QQQ', name: 'Invesco QQQ ETF', source: 'stocks', exchange: 'NASDAQ', category: 'Stock', precision: 2 },
    { symbol: 'NVDA', display: 'NVDA', name: 'NVIDIA Corporation', source: 'stocks', exchange: 'NASDAQ', category: 'Stock', precision: 2 },
    { symbol: 'AAPL', display: 'AAPL', name: 'Apple Inc.', source: 'stocks', exchange: 'NASDAQ', category: 'Stock', precision: 2 },
    { symbol: 'TSLA', display: 'TSLA', name: 'Tesla Inc.', source: 'stocks', exchange: 'NASDAQ', category: 'Stock', precision: 2 },
  ];

  const CME_TO_YAHOO = {
    '@ND.1': 'NQ=F', 'NQ1!': 'NQ=F',
    '@SP.1': 'ES=F', 'ES1!': 'ES=F',
    '@GC.1': 'GC=F', 'GC1!': 'GC=F',
    '@SI.1': 'SI=F', 'SI1!': 'SI=F',
    '@CL.1': 'CL=F', 'CL1!': 'CL=F',
    '@DJ.1': 'YM=F', 'YM1!': 'YM=F',
    '@URO.1': '6E=F', '6E1!': '6E=F',
    '@BP.1': '6B=F', '6B1!': '6B=F',
    '@JY.1': '6J=F', '6J1!': '6J=F',
    '@AD.1': '6A=F', '6A1!': '6A=F',
    '@CD.1': '6C=F', '6C1!': '6C=F',
    '@SF.1': '6S=F', '6S1!': '6S=F',
    '.DXY': 'DX-Y.NYB', 'DXY': 'DX-Y.NYB',
    'TRY=': 'TRY=X', 'USDTRY': 'TRY=X', 'USD/TRY': 'TRY=X',
    'EURTRY=': 'EURTRY=X', 'EURTRY': 'EURTRY=X', 'EUR/TRY': 'EURTRY=X',
    'GBPTRY=': 'GBPTRY=X', 'GBPTRY': 'GBPTRY=X', 'GBP/TRY': 'GBPTRY=X', '£TRY': 'GBPTRY=X',
  };

  function readLocalJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function readUserConfig() {
    return readLocalJson('velox_mobile_user_cfg_v1', {
      OANDA_API_KEY: '',
      OANDA_ACCOUNT_ID: '',
      OANDA_ENV: 'practice',
      DEFAULT_TIMEZONE: 'Europe/Istanbul',
    });
  }

  function saveUserConfig(patch) {
    const cur = readUserConfig();
    const next = { ...cur, ...patch };
    localStorage.setItem('velox_mobile_user_cfg_v1', JSON.stringify(next));
    return next;
  }

  function tfToSeconds(tf) {
    const m = String(tf || '1m').match(/^(\d+)([smhdwM])$/);
    if (!m) return 60;
    const n = Number(m[1]);
    const u = m[2];
    if (u === 's') return n;
    if (u === 'm') return n * 60;
    if (u === 'h') return n * 3600;
    if (u === 'd') return n * 86400;
    if (u === 'w') return n * 604800;
    if (u === 'M') return n * 2592000;
    return 60;
  }

  function resampleBars(bars, tf) {
    const sec = tfToSeconds(tf);
    if (sec <= 60) return bars;
    const out = [];
    let cur = null;
    let curBucket = -1;
    for (const b of bars) {
      const bucket = Math.floor(b.time / sec) * sec;
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
    if (cur) out.push(cur);
    return out;
  }

  function oandaGranularity(tf) {
    const map = {
      '5s': 'S5', '15s': 'S15', '30s': 'S30',
      '1m': 'M1', '3m': 'M3', '5m': 'M5', '15m': 'M15', '30m': 'M30',
      '1h': 'H1', '2h': 'H2', '4h': 'H4', '12h': 'H12', '1d': 'D', '1w': 'W', '1M': 'M',
    };
    return map[tf] || 'M1';
  }

  function jsonResp(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  async function nativeHttpGet(url, headers = {}) {
    const CapHttp = window.Capacitor?.Plugins?.CapacitorHttp;
    if (CapHttp) {
      const res = await CapHttp.get({ url, headers, connectTimeout: 8000, readTimeout: 8000 });
      if (res.status >= 200 && res.status < 300) {
        return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      }
      throw new Error(`HTTP ${res.status}`);
    }
    const r = await origFetch(url, { headers });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function fetchYahooDirect(yahooSym, tf) {
    const tfSec = tfToSeconds(tf);
    const interval = tfSec >= 2592000 ? '1mo' : tfSec >= 604800 ? '1wk' : tfSec >= 86400 ? '1d' : tfSec >= 3600 ? '1h' : tfSec >= 900 ? '15m' : tfSec >= 300 ? '5m' : '1m';
    const range = tfSec >= 2592000 ? 'max' : tfSec >= 604800 ? '10y' : tfSec >= 86400 ? '5y' : tfSec >= 3600 ? '2y' : tfSec >= 300 ? '60d' : '7d';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=${interval}&range=${range}&includePrePost=false`;
    const data = await nativeHttpGet(url, UA_HEADERS);
    const result = data?.chart?.result?.[0];
    if (!result || !Array.isArray(result.timestamp)) return null;
    const ts = result.timestamp;
    const q = result.indicators?.quote?.[0] || {};
    const bars = [];
    let prevT = -1;
    for (let i = 0; i < ts.length; i += 1) {
      const t = Number(ts[i]);
      const c = Number(q.close?.[i]);
      if (!Number.isFinite(t) || !Number.isFinite(c) || c <= 0 || t <= prevT) continue;
      prevT = t;
      const o = Number(q.open?.[i]);
      const h = Number(q.high?.[i]);
      const l = Number(q.low?.[i]);
      const open = Number.isFinite(o) && o > 0 ? o : c;
      bars.push({
        time: t,
        open,
        high: Number.isFinite(h) && h > 0 ? Math.max(h, open, c) : Math.max(open, c),
        low: Number.isFinite(l) && l > 0 ? Math.min(l, open, c) : Math.min(open, c),
        close: c,
      });
    }
    const finalBars = tfSec > 60 && !['1d', '1wk', '1mo'].includes(interval) && tfSec !== 300 && tfSec !== 900 && tfSec !== 3600
      ? resampleBars(bars, tf)
      : bars;
    const meta = result.meta || {};
    const lastPrice = Number(meta.regularMarketPrice) || finalBars[finalBars.length - 1]?.close || null;
    return { bars: finalBars, meta, lastPrice };
  }

  // Live Standalone EventSource polyfill (feeds Watchlist & Charts directly from phone's internet)
  const OrigEventSource = window.EventSource;
  class StandaloneEventSource {
    constructor(url) {
      this.url = String(url || '');
      this.listeners = new Map();
      this.closed = false;
      this.timer = null;
      this._start();
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) {
      this.listeners.get(type)?.delete(fn);
    }
    _emit(type, payload) {
      if (this.closed) return;
      const ev = { data: JSON.stringify(payload) };
      for (const fn of this.listeners.get(type) || []) {
        try { fn(ev); } catch {}
      }
    }
    close() {
      this.closed = true;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    }
    _start() {
      const u = new URL(this.url, window.location.origin);
      const parseList = (k) => (u.searchParams.get(k) || '').split(',').map((s) => s.trim()).filter(Boolean);
      const subs = {
        oanda: parseList('oanda'),
        cme: parseList('cme'),
        stocks: parseList('stocks'),
        binance: parseList('binance'),
      };
      const poll = async () => {
        if (this.closed) return;
        const cfg = readUserConfig();
        const hasOanda = Boolean(cfg.OANDA_API_KEY);
        this._emit('status', {
          oanda: { status: hasOanda ? 'live' : 'unconfigured' },
          cme: { status: 'delayed' },
          crypto: { status: 'live' },
          connectedScreens: 1,
        });

        if (hasOanda && subs.oanda.length && cfg.OANDA_ACCOUNT_ID) {
          const realOanda = subs.oanda.filter((s) => s !== 'DXY');
          const host = cfg.OANDA_ENV === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
          if (realOanda.length) {
            try {
              const prUrl = `${host}/v3/accounts/${encodeURIComponent(cfg.OANDA_ACCOUNT_ID)}/pricing?instruments=${encodeURIComponent(realOanda.join(','))}`;
              const data = await nativeHttpGet(prUrl, { Authorization: `Bearer ${cfg.OANDA_API_KEY}` });
              for (const p of data.prices || []) {
                const bid = Number(p.bids?.[0]?.price);
                const ask = Number(p.asks?.[0]?.price);
                const price = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : Number(p.closeoutBid || p.closeoutAsk);
                if (!Number.isFinite(price)) continue;
                this._emit('tick', {
                  source: 'oanda',
                  symbol: p.instrument,
                  price,
                  time: Math.floor(Date.parse(p.time || Date.now()) / 1000) || Math.floor(Date.now() / 1000),
                  feedMode: p.tradeable === false ? 'closed' : 'live',
                });
              }
            } catch {}
          }
        }

        if (subs.binance.length) {
          try {
            const rows = await nativeHttpGet(`https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(subs.binance))}`);
            const nowSec = Math.floor(Date.now() / 1000);
            for (const r of Array.isArray(rows) ? rows : []) {
              const px = Number(r.price);
              if (Number.isFinite(px)) this._emit('tick', { source: 'binance', symbol: r.symbol, price: px, time: nowSec, feedMode: 'live' });
            }
          } catch {}
        }

        const yhPairs = [
          ...subs.cme.map((s) => ({ source: 'cme', symbol: s, ySym: CME_TO_YAHOO[s.toUpperCase()] || s })),
          ...subs.stocks.map((s) => ({ source: 'stocks', symbol: s, ySym: CME_TO_YAHOO[s.toUpperCase()] || s })),
        ];
        await Promise.all(
          yhPairs.slice(0, 12).map(async ({ source, symbol, ySym }) => {
            try {
              const d = await nativeHttpGet(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=1m&range=1d`, UA_HEADERS);
              const meta = d?.chart?.result?.[0]?.meta;
              if (meta && Number.isFinite(Number(meta.regularMarketPrice))) {
                this._emit('tick', {
                  source,
                  symbol,
                  price: Number(meta.regularMarketPrice),
                  time: Number(meta.regularMarketTime) || Math.floor(Date.now() / 1000),
                  prevClose: Number(meta.chartPreviousClose ?? meta.previousClose) || null,
                  feedMode: 'delayed',
                });
              }
            } catch {}
          })
        );
      };
      setTimeout(poll, 150);
      this.timer = setInterval(poll, 5000);
    }
  }

  window.EventSource = function VeloxPublicEventSource(url, cfg) {
    if (String(url || '').startsWith('/api/stream')) {
      return new StandaloneEventSource(url);
    }
    return new OrigEventSource(url, cfg);
  };

  window.fetch = async function veloxPublicFetch(input, init = {}) {
    const urlStr = typeof input === 'string' ? input : input?.url || '';
    if (!urlStr.startsWith('/api/')) return origFetch(input, init);

    const u = new URL(urlStr, window.location.origin);
    const p = u.pathname;
    const method = (init.method || 'GET').toUpperCase();

    if (p === '/api/config') {
      if (method === 'POST') {
        const body = JSON.parse(init.body || '{}');
        const patch = {};
        if (body.oandaApiKey !== undefined) patch.OANDA_API_KEY = String(body.oandaApiKey || '').trim();
        if (body.oandaAccountId !== undefined) patch.OANDA_ACCOUNT_ID = String(body.oandaAccountId || '').trim();
        if (body.oandaEnv) patch.OANDA_ENV = String(body.oandaEnv);
        if (body.defaultTimezone) patch.DEFAULT_TIMEZONE = String(body.defaultTimezone);
        const saved = saveUserConfig(patch);
        return jsonResp({ ok: true, hasOandaKey: Boolean(saved.OANDA_API_KEY) });
      }
      const cfg = readUserConfig();
      const hasOanda = Boolean(cfg.OANDA_API_KEY);
      return jsonResp({
        config: {
          hasOandaKey: hasOanda,
          oandaEnv: cfg.OANDA_ENV || 'practice',
          oandaAccountId: cfg.OANDA_ACCOUNT_ID || '',
          hasDatabentoKey: false,
          defaultTimezone: cfg.DEFAULT_TIMEZONE || 'Europe/Istanbul',
        },
        feeds: {
          oanda: { status: hasOanda ? 'live' : 'unconfigured' },
          cme: { status: 'delayed' },
          crypto: { status: 'live' },
          connectedScreens: 1,
        },
      });
    }

    if (p === '/api/symbols') {
      const q = (u.searchParams.get('q') || '').trim().toLowerCase();
      const srcFilter = (u.searchParams.get('source') || '').trim().toLowerCase();
      let list = CATALOG;
      if (srcFilter && srcFilter !== 'all') list = list.filter((s) => s.source === srcFilter);
      if (q) {
        list = list.filter((s) => `${s.symbol} ${s.display} ${s.name} ${s.exchange} ${s.category}`.toLowerCase().includes(q));
      }
      return jsonResp({ symbols: list });
    }

    if (p === '/api/history') {
      const source = (u.searchParams.get('source') || 'cme').toLowerCase();
      const symbol = u.searchParams.get('symbol') || '@ND.1';
      const tf = u.searchParams.get('tf') || '1m';
      const count = Math.min(800, Number(u.searchParams.get('count')) || 350);

      if (source === 'oanda') {
        if (symbol.toUpperCase() === 'DXY') {
          const yh = await fetchYahooDirect('DX-Y.NYB', tf).catch(() => null);
          if (yh?.bars?.length) {
            return jsonResp({ source, symbol, tf, precision: 3, bucketSec: tfToSeconds(tf), feedMode: 'live', bars: yh.bars.slice(-count), lastPrice: yh.lastPrice });
          }
        }
        const cfg = readUserConfig();
        if (!cfg.OANDA_API_KEY) {
          return jsonResp({ error: 'Add your free OANDA Practice API key in Settings (⚙) to stream OANDA pairs.', code: 'NO_OANDA_KEY' }, 401);
        }
        const host = cfg.OANDA_ENV === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
        const gran = oandaGranularity(tf);
        const url = `${host}/v3/instruments/${encodeURIComponent(symbol)}/candles?granularity=${gran}&count=${count}&price=M`;
        const data = await nativeHttpGet(url, { Authorization: `Bearer ${cfg.OANDA_API_KEY}` });
        const bars = (data.candles || []).map((c) => ({
          time: Math.floor(Date.parse(c.time) / 1000),
          open: Number(c.mid.o),
          high: Number(c.mid.h),
          low: Number(c.mid.l),
          close: Number(c.mid.c),
        }));
        return jsonResp({
          source,
          symbol,
          tf,
          precision: symbol.includes('JPY') ? 3 : symbol.includes('XAU') ? 2 : symbol.includes('NAS100') || symbol.includes('SPX500') ? 1 : 5,
          bucketSec: tfToSeconds(tf),
          feedMode: 'live',
          bars,
          lastPrice: bars.length ? bars[bars.length - 1].close : null,
        });
      }

      if (source === 'binance') {
        const interval = tf === '1d' ? '1d' : tf === '1w' ? '1w' : tf;
        const rows = await nativeHttpGet(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${count}`);
        const bars = (Array.isArray(rows) ? rows : []).map((r) => ({
          time: Math.floor(r[0] / 1000),
          open: Number(r[1]),
          high: Number(r[2]),
          low: Number(r[3]),
          close: Number(r[4]),
        }));
        return jsonResp({ source, symbol, tf, precision: 2, bucketSec: tfToSeconds(tf), feedMode: 'live', bars, lastPrice: bars.length ? bars[bars.length - 1].close : null });
      }

      const ySym = CME_TO_YAHOO[String(symbol).toUpperCase()] || symbol;
      const yh = await fetchYahooDirect(ySym, tf).catch(() => null);
      if (yh?.bars?.length) {
        const lastC = yh.lastPrice ?? yh.bars[yh.bars.length - 1].close;
        const precision = ySym.endsWith('=X') ? 4 : lastC >= 20 ? 2 : lastC >= 2 ? 3 : 5;
        return jsonResp({ source, symbol, tf, precision, bucketSec: tfToSeconds(tf), feedMode: 'delayed', bars: yh.bars.slice(-count), lastPrice: lastC });
      }
      return jsonResp({ error: `Could not load ${symbol}` }, 400);
    }

    if (p === '/api/drawings') {
      if (method === 'PUT') {
        const body = JSON.parse(init.body || '{}');
        const all = readLocalJson('linepulse_drawings_v1', {});
        if (body.symbolKey && Array.isArray(body.list)) all[body.symbolKey] = body.list;
        localStorage.setItem('linepulse_drawings_v1', JSON.stringify(all));
        return jsonResp({ ok: true, drawings: all });
      }
      return jsonResp({ drawings: readLocalJson('linepulse_drawings_v1', {}) });
    }

    if (p === '/api/watchlist') {
      if (method === 'PUT') {
        const body = JSON.parse(init.body || '{}');
        if (Array.isArray(body.items)) localStorage.setItem('linepulse_watchlist_v1', JSON.stringify(body.items));
        if (Array.isArray(body.categories)) localStorage.setItem('linepulse_wl_cats_v1', JSON.stringify(body.categories));
        return jsonResp({ ok: true, watchlist: body });
      }
      return jsonResp({ watchlist: { items: readLocalJson('linepulse_watchlist_v1', null), categories: readLocalJson('linepulse_wl_cats_v1', []) } });
    }

    if (p === '/api/alerts') {
      const list = readLocalJson('velox_local_alerts_v1', []);
      if (method === 'POST') {
        const body = JSON.parse(init.body || '{}');
        const item = { id: `al-${Date.now()}`, active: true, ...body, createdAt: Date.now() };
        list.unshift(item);
        localStorage.setItem('velox_local_alerts_v1', JSON.stringify(list));
        return jsonResp({ ok: true, alert: item, alerts: list });
      }
      return jsonResp({ alerts: list });
    }

    if (p === '/api/push/status') return jsonResp({ configured: false, deviceCount: 0, devices: [] });
    if (p === '/api/archive') return jsonResp({ entries: [], presets: { databento: [], dukascopy: [] } });
    if (p === '/api/news') return jsonResp({ events: [] });
    if (p === '/api/layouts') return jsonResp({ layouts: [] });
    if (p === '/api/templates') return jsonResp({ templates: [] });
    if (p === '/api/replay/sessions') return jsonResp({ sessions: readLocalJson('velox_local_sessions_v1', []) });
    if (p === '/api/replay/prop-rules') return jsonResp({ rules: [] });

    return jsonResp({ ok: true });
  };
})();
