import EventEmitter from 'node:events';
import { getConfig } from './env.js';
import { findCuratedSymbol, resolveCmeSymbol } from './symbols.js';
import { parseTimeframe, resampleOhlc } from './timeframes.js';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

function pickCnbcSpec(parsed) {
  if (parsed.unit === 'M') {
    return { period: '5Y', needsResample: true };
  }
  if (parsed.unit === 'w') {
    return { period: '5Y', needsResample: parsed.count > 1 };
  }
  if (parsed.unit === 'd') {
    return { period: '1Y', needsResample: parsed.count > 1 };
  }
  if (parsed.seconds >= 12 * 3600) {
    // 12h: use 5D intraday bars (1660 bars -> covers ~5 days cleanly)
    return { period: '5D', needsResample: true };
  }
  if (parsed.seconds >= 300) {
    return { period: '5D', needsResample: true };
  }
  if (parsed.seconds > 60) {
    return { period: '1D', needsResample: true };
  }
  // 1m or sub-1m (1s/5s/15s): seed with 1D 1m bars, live polling appends ticks
  return { period: '1D', needsResample: false };
}

const TWELVEDATA_TF_MAP = {
  '1s': '1min',
  '5s': '1min',
  '15s': '1min',
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '30m': '30min',
  '1h': '1h',
  '4h': '4h',
  '12h': '4h',
  '1d': '1day',
  '1w': '1week',
  '1M': '1month',
};

const historyCache = new Map();

function parseNum(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  if (typeof raw !== 'string') return NaN;
  const cleaned = raw.replace(/,/g, '').trim();
  return Number.parseFloat(cleaned);
}

function inferPrecision(price) {
  if (!Number.isFinite(price)) return 2;
  if (price >= 1000) return 2;
  if (price >= 20) return 2;
  if (price >= 2) return 3;
  return 5;
}

function computeCnbcFeedMeta(quote, effectiveTs, isStaleMidnightReset, sourceOverride = 'cme') {
  const mktStatus = String(quote?.curmktstatus || '').toUpperCase();
  if (mktStatus.includes('CLOSED') || isStaleMidnightReset) {
    return { feedMode: 'closed', delayMinutes: null };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const isRealTime = String(quote?.realTime || '').toLowerCase() === 'true';
  if (isRealTime && mktStatus === 'REG_MKT') {
    return { feedMode: 'live', delayMinutes: 0 };
  }
  if (Number.isFinite(effectiveTs) && effectiveTs <= nowSec + 60) {
    const diffMin = Math.max(1, Math.round((nowSec - effectiveTs) / 60));
    if (diffMin <= 60) {
      return { feedMode: 'delayed', delayMinutes: diffMin };
    }
  }
  return { feedMode: 'delayed', delayMinutes: sourceOverride === 'stocks' ? 15 : 10 };
}

async function fetchCnbcBars(cnbcSymbol, period) {
  const url = `https://ts-api.cnbc.com/harmony/app/charts/${period}.json?symbol=${encodeURIComponent(cnbcSymbol)}`;
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`CME chart HTTP ${res.status}`);
  }
  const json = await res.json();
  const barsRaw = json?.barData?.priceBars;
  if (!Array.isArray(barsRaw) || barsRaw.length === 0) {
    throw new Error(`${cnbcSymbol} için grafik verisi bulunamadı`);
  }

  const bars = [];
  let prevT = -1;
  const maxAllowedTs = Math.floor(Date.now() / 1000) + 120;
  for (const b of barsRaw) {
    const t = Math.floor(Number(b.tradeTimeinMills) / 1000);
    const c = parseNum(b.close);
    if (!Number.isFinite(t) || !Number.isFinite(c)) continue;
    if (t <= prevT || t > maxAllowedTs) continue;
    prevT = t;
    const o = parseNum(b.open);
    const h = parseNum(b.high);
    const l = parseNum(b.low);
    const open = Number.isFinite(o) ? o : c;
    const high = Number.isFinite(h) ? Math.max(h, open, c) : Math.max(open, c);
    const low = Number.isFinite(l) ? Math.min(l, open, c) : Math.min(open, c);
    bars.push({ time: t, open, high, low, close: c });
  }
  return bars;
}

async function fetchCnbcQuotes(cnbcSymbols) {
  if (!cnbcSymbols.length) return [];
  const joined = cnbcSymbols.join('|');
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(joined)}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`;
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`CME quote HTTP ${res.status}`);
  }
  const json = await res.json();
  const raw = json?.FormattedQuoteResult?.FormattedQuote;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

async function fetchTwelveDataHistory(symbol, parsed) {
  const cfg = getConfig();
  if (!cfg.TWELVEDATA_API_KEY) return null;
  const tdInterval = TWELVEDATA_TF_MAP[parsed.label] || '1min';
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${tdInterval}&outputsize=350&apikey=${encodeURIComponent(cfg.TWELVEDATA_API_KEY)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status === 'error' || !Array.isArray(data.values)) return null;

  const bars = data.values
    .map((v) => {
      const c = parseNum(v.close);
      const o = parseNum(v.open);
      const h = parseNum(v.high);
      const l = parseNum(v.low);
      return {
        time: Math.floor(new Date(v.datetime.replace(' ', 'T') + 'Z').getTime() / 1000),
        open: Number.isFinite(o) ? o : c,
        high: Number.isFinite(h) ? h : c,
        low: Number.isFinite(l) ? l : c,
        close: c,
      };
    })
    .filter((b) => Number.isFinite(b.time) && Number.isFinite(b.close))
    .reverse();

  const dedup = [];
  let prevT = -1;
  for (const b of bars) {
    if (b.time > prevT) {
      dedup.push(b);
      prevT = b.time;
    }
  }
  return dedup.length ? dedup : null;
}

export async function fetchCmeHistory(rawSymbol, tf = '1m', sourceOverride = 'cme') {
  const parsed = parseTimeframe(tf);
  const resolved = sourceOverride === 'stocks' ? String(rawSymbol || '').trim().toUpperCase() : resolveCmeSymbol(rawSymbol);
  const cacheKey = `${sourceOverride}:${resolved}:${parsed.label}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 8000) {
    return cached.data;
  }

  const curated = findCuratedSymbol(sourceOverride, resolved) || findCuratedSymbol('cme', resolved);

  const cfg = getConfig();
  if (cfg.TWELVEDATA_API_KEY && !resolved.startsWith('@') && !resolved.startsWith('.')) {
    const tdBars = await fetchTwelveDataHistory(resolved, parsed).catch(() => null);
    if (tdBars) {
      const lastPrice = tdBars[tdBars.length - 1].close;
      const result = {
        source: 'cme',
        symbol: rawSymbol,
        display: curated?.display || rawSymbol,
        exchange: curated?.exchange || 'CME',
        tf: parsed.label,
        bucketSec: parsed.seconds,
        precision: curated?.precision ?? inferPrecision(lastPrice),
        feedMode: 'live',
        bars: tdBars,
        lastPrice,
        referencePrice: tdBars[0].open,
      };
      historyCache.set(cacheKey, { at: Date.now(), data: result });
      return result;
    }
  }

  const spec = pickCnbcSpec(parsed);
  const [rawBars, quotes] = await Promise.all([
    fetchCnbcBars(resolved, spec.period),
    fetchCnbcQuotes([resolved]).catch(() => []),
  ]);

  let bars = spec.needsResample ? resampleOhlc(rawBars, parsed) : rawBars;

  const nowSec = Math.floor(Date.now() / 1000);
  const quote = quotes[0] || null;
  const quotePrice = quote ? parseNum(quote.last) : NaN;
  const quotePrevClose = quote ? parseNum(quote.previous_day_closing) : NaN;
  const isStaleMidnightReset =
    typeof quote?.last_time === 'string' && quote.last_time.includes('T00:00:00');
  const rawQuoteTs = quote?.last_time_msec
    ? Math.floor(Number(quote.last_time_msec) / 1000)
    : quote?.last_time && !isStaleMidnightReset
    ? Math.floor(Date.parse(quote.last_time) / 1000)
    : NaN;
  // Reject future or bogus timestamps so a glitchy CDN quote can NEVER jump the chart to 16:29
  const quoteTs = Number.isFinite(rawQuoteTs) && rawQuoteTs <= nowSec + 120 ? rawQuoteTs : NaN;

  if (Number.isFinite(quotePrice) && Number.isFinite(quoteTs) && bars.length > 0) {
    const lastBar = bars[bars.length - 1];
    const sanePrice = lastBar.close > 0 && Math.abs(quotePrice - lastBar.close) / lastBar.close < 0.035;
    if (sanePrice && quoteTs > lastBar.time) {
      bars.push({
        time: quoteTs,
        open: lastBar.close,
        high: Math.max(lastBar.close, quotePrice),
        low: Math.min(lastBar.close, quotePrice),
        close: quotePrice,
      });
    } else if (sanePrice && quoteTs === lastBar.time) {
      lastBar.high = Math.max(lastBar.high, quotePrice);
      lastBar.low = Math.min(lastBar.low, quotePrice);
      lastBar.close = quotePrice;
    }
  }

  const lastBar = bars[bars.length - 1] || null;
  const lastBarPrice = lastBar?.close ?? null;
  const quoteIsFresher =
    Number.isFinite(quotePrice) &&
    Number.isFinite(quoteTs) &&
    (!lastBar || quoteTs >= lastBar.time) &&
    (!lastBarPrice || Math.abs(quotePrice - lastBarPrice) / lastBarPrice < 0.035);
  const lastPrice = quoteIsFresher ? quotePrice : lastBarPrice;
  const effectiveTs = quoteIsFresher ? quoteTs : lastBar?.time ?? quoteTs;

  const precision = curated?.precision ?? inferPrecision(lastPrice);
  const { feedMode, delayMinutes } = computeCnbcFeedMeta(
    quote,
    effectiveTs,
    isStaleMidnightReset,
    sourceOverride
  );

  const payload = {
    source: sourceOverride,
    symbol: rawSymbol,
    display: curated?.display || quote?.shortName || quote?.name || rawSymbol,
    exchange: curated?.exchange || quote?.exchange || (sourceOverride === 'stocks' ? 'US' : 'CME'),
    tf: parsed.label,
    bucketSec: parsed.seconds,
    precision,
    feedMode,
    delayMinutes,
    bars,
    lastPrice,
    referencePrice: Number.isFinite(quotePrevClose)
      ? quotePrevClose
      : bars[0]?.open ?? lastPrice,
  };

  historyCache.set(cacheKey, { at: Date.now(), data: payload });
  return payload;
}

export class CmePollerManager extends EventEmitter {
  constructor() {
    super();
    this.subscribed = new Set();
    this.timer = null;
    this.barTimer = null;
    this.polling = false;
    this.pollingBars = false;
    this.status = 'idle';
    this.lastError = null;
    this.lastUpdate = null;
    this.latestTicks = new Map();
    this.latestBarTsByResolved = new Map();
  }

  getStatus() {
    return {
      status: this.status,
      lastError: this.lastError,
      lastUpdate: this.lastUpdate,
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
    if (this.subscribed.size === 0) {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      if (this.barTimer) {
        clearInterval(this.barTimer);
        this.barTimer = null;
      }
      this.status = 'idle';
      this.lastError = null;
      this.emit('status', this.getStatus());
      return;
    }

    if (!this.timer) {
      this.timer = setInterval(() => this._pollAll(), 4000);
    }
    if (!this.barTimer) {
      // Poll fresh 1m exchange bars (~1-2 min delay) every 10s so CME charts stay accurate & spike-free
      this.barTimer = setInterval(() => this._pollFreshBars(), 10000);
    }
    this._pollFreshBars();
    this._pollAll();
  }

  async _pollFreshBars() {
    if (this.pollingBars || this.subscribed.size === 0) return;
    this.pollingBars = true;
    try {
      const rawSymbols = Array.from(this.subscribed);
      const resolvedToRaws = new Map();
      for (const raw of rawSymbols) {
        const res = resolveCmeSymbol(raw);
        // Only poll 1D.json chart bars for CME futures (@* / .*) — quotes cover US stocks cleanly
        if (!res.startsWith('@') && !res.startsWith('.')) continue;
        if (!resolvedToRaws.has(res)) resolvedToRaws.set(res, []);
        resolvedToRaws.get(res).push(raw);
      }

      const nowSec = Math.floor(Date.now() / 1000);
      await Promise.all(
        Array.from(resolvedToRaws.entries()).map(async ([resolved, raws]) => {
          try {
            const bars = await fetchCnbcBars(resolved, '1D');
            if (!bars.length) return;
            const b = bars[bars.length - 1];
            if (b.time > nowSec + 120) return;
            this.latestBarTsByResolved.set(resolved, b.time);

            const diffMin = Math.max(1, Math.round((nowSec - b.time) / 60));
            const feedMode = diffMin > 90 ? 'closed' : 'delayed';
            const delayMinutes = feedMode === 'delayed' ? Math.min(diffMin, 60) : null;

            for (const rawSym of raws) {
              const prev = this.latestTicks.get(rawSym);
              const tick = {
                source: 'cme',
                symbol: rawSym,
                price: b.close,
                time: b.time,
                bar: b,
                prevClose: prev?.prevClose ?? null,
                feedMode,
                delayMinutes,
                quoteOnly: false,
              };
              const changed =
                !prev ||
                prev.price !== tick.price ||
                prev.time !== tick.time ||
                prev.feedMode !== tick.feedMode ||
                prev.delayMinutes !== tick.delayMinutes;
              this.latestTicks.set(rawSym, tick);
              if (changed) {
                this.emit('tick', tick);
              }
            }
          } catch {
            // ignore transient single-symbol poll error
          }
        })
      );
    } finally {
      this.pollingBars = false;
    }
  }

  async _pollAll() {
    if (this.polling || this.subscribed.size === 0) return;
    this.polling = true;

    try {
      const rawSymbols = Array.from(this.subscribed);
      const resolvedToRaws = new Map();
      for (const raw of rawSymbols) {
        const res = resolveCmeSymbol(raw);
        if (!resolvedToRaws.has(res)) resolvedToRaws.set(res, []);
        resolvedToRaws.get(res).push(raw);
      }

      const uniqueResolved = Array.from(resolvedToRaws.keys());
      const quotes = await fetchCnbcQuotes(uniqueResolved);

      let anyOk = false;
      const nowSec = Math.floor(Date.now() / 1000);

      for (const q of quotes) {
        const price = parseNum(q.last);
        if (!Number.isFinite(price)) continue;
        anyOk = true;

        const isStaleMidnightReset =
          typeof q.last_time === 'string' && q.last_time.includes('T00:00:00');

        const raws = resolvedToRaws.get(q.symbol) || [q.symbol];
        const prevClose = parseNum(q.previous_day_closing);
        const rawQuoteTs = q.last_time_msec
          ? Math.floor(Number(q.last_time_msec) / 1000)
          : q.last_time && !isStaleMidnightReset
          ? Math.floor(Date.parse(q.last_time) / 1000)
          : NaN;

        // Guard against future timestamps or missing timestamps
        if (!Number.isFinite(rawQuoteTs) || rawQuoteTs > nowSec + 120) continue;

        // If fresh 1m bars from ts-api.cnbc.com are newer than this 10-min-delayed quote, do NOT overwrite!
        const latestBarTs = this.latestBarTsByResolved.get(q.symbol);
        if (Number.isFinite(latestBarTs) && rawQuoteTs < latestBarTs) {
          continue;
        }

        const isCmeSym = q.symbol?.startsWith('@') || q.symbol?.startsWith('.');
        const { feedMode, delayMinutes } = computeCnbcFeedMeta(
          q,
          rawQuoteTs,
          isStaleMidnightReset,
          isCmeSym ? 'cme' : 'stocks'
        );

        for (const rawSym of raws) {
          const prev = this.latestTicks.get(rawSym);
          // Reject single-tick glitch spikes (> 3.5% instantaneous jump on futures/stocks)
          if (prev && prev.price > 0 && Math.abs(price - prev.price) / prev.price > 0.035) {
            continue;
          }
          const tick = {
            source: 'cme',
            symbol: rawSym,
            price,
            time: rawQuoteTs,
            prevClose: Number.isFinite(prevClose) ? prevClose : null,
            feedMode,
            delayMinutes,
            quoteOnly: isStaleMidnightReset,
          };
          this.latestTicks.set(rawSym, tick);
          if (!prev || prev.price !== tick.price || prev.feedMode !== tick.feedMode) {
            this.emit('tick', tick);
          }
        }
      }

      if (anyOk) {
        this.status = 'delayed';
        this.lastError = null;
        this.lastUpdate = Date.now();
      } else {
        this.status = 'error';
        this.lastError = 'CME fiyat yanıtı boş';
      }
    } catch (err) {
      this.status = 'error';
      this.lastError = err.message;
    }

    this.emit('status', this.getStatus());
    this.polling = false;
  }
}
