/**
 * Free Zero-API-Key Economic Calendar (TradingView Public Calendar + ForexFactory Fallback)
 * Supports Actual / Forecast / Previous values, High/Medium impact, and arbitrary date ranges
 * (1D, This Week, 1W, This Month, and custom historical ranges for Backtest/Replay).
 */

const TV_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json',
  Origin: 'https://www.tradingview.com',
  Referer: 'https://www.tradingview.com/',
};

const ALL_TV_COUNTRIES = ['US', 'EU', 'GB', 'JP', 'CA', 'AU', 'CH', 'NZ', 'CN'];

const TV_COUNTRY_TO_CURRENCY = {
  US: 'USD',
  EU: 'EUR',
  DE: 'EUR',
  FR: 'EUR',
  GB: 'GBP',
  JP: 'JPY',
  CA: 'CAD',
  AU: 'AUD',
  CH: 'CHF',
  NZ: 'NZD',
  CN: 'CNY',
};

const cache = new Map(); // cacheKey -> { at, events }
const CACHE_TTL_MS = 10 * 60 * 1000;

function formatVal(num, scale, unit) {
  if (num === null || num === undefined || num === '' || !Number.isFinite(Number(num))) {
    return '';
  }
  const n = Number(num);
  const str = Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
  const sc = scale ? String(scale).trim() : '';
  const un = unit ? String(unit).trim() : '';
  return `${str}${sc}${un}`;
}

function trimSummary(comment) {
  if (!comment || typeof comment !== 'string') return '';
  const clean = comment.replace(/\s+/g, ' ').trim();
  const firstSentence = clean.match(/^[^.!?]+[.!?]/)?.[0] || clean;
  return firstSentence.length > 180 ? `${firstSentence.slice(0, 177)}...` : firstSentence;
}

export function resolveNewsDateRange(range = 'this_week', fromParam = null, toParam = null) {
  const now = new Date();
  if (fromParam && toParam) {
    const fMs = Number.isFinite(Number(fromParam)) ? Number(fromParam) * 1000 : Date.parse(fromParam);
    const tMs = Number.isFinite(Number(toParam)) ? Number(toParam) * 1000 : Date.parse(toParam);
    if (Number.isFinite(fMs) && Number.isFinite(tMs) && tMs > fMs) {
      return { fromIso: new Date(fMs).toISOString(), toIso: new Date(tMs).toISOString() };
    }
  }

  const dayMs = 86400 * 1000;
  if (range === '1d') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const end = new Date(start.getTime() + dayMs * 2 - 1000); // today + tomorrow preview
    return { fromIso: start.toISOString(), toIso: end.toISOString() };
  }
  if (range === '1w') {
    const start = new Date(now.getTime() - dayMs * 7);
    const end = new Date(now.getTime() + dayMs * 2);
    return { fromIso: start.toISOString(), toIso: end.toISOString() };
  }
  if (range === 'this_month' || range === '1m') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
    return { fromIso: start.toISOString(), toIso: end.toISOString() };
  }

  // Default: 'this_week' (Monday 00:00 UTC -> Sunday 23:59 UTC)
  const dow = (now.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow, 0, 0, 0));
  const sun = new Date(mon.getTime() + dayMs * 7 - 1000);
  return { fromIso: mon.toISOString(), toIso: sun.toISOString() };
}

async function fetchFromTradingView(fromIso, toIso, countryCodes) {
  const url =
    `https://economic-calendar.tradingview.com/events?from=${encodeURIComponent(fromIso)}` +
    `&to=${encodeURIComponent(toIso)}&countries=${encodeURIComponent(countryCodes.join(','))}`;

  const res = await fetch(url, {
    headers: TV_HEADERS,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`TV calendar HTTP ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json?.result) ? json.result : [];

  const events = [];
  const seen = new Set();
  for (const r of rows) {
    if (!r || !r.title || !r.date) continue;
    const ms = Date.parse(r.date);
    if (!Number.isFinite(ms)) continue;
    const time = Math.floor(ms / 1000);
    const impact = r.importance >= 1 ? 'High' : r.importance === 0 ? 'Medium' : 'Low';
    if (impact === 'Low') continue; // keep payload sleek: High + Medium only

    const currency =
      String(r.currency || TV_COUNTRY_TO_CURRENCY[r.country] || r.country || '').toUpperCase();
    const id = String(r.id || `${currency}:${time}:${r.title}`);
    if (seen.has(id)) continue;
    seen.add(id);

    const actualNum = r.actual !== null && r.actual !== undefined && Number.isFinite(Number(r.actual)) ? Number(r.actual) : null;
    const forecastNum = r.forecast !== null && r.forecast !== undefined && Number.isFinite(Number(r.forecast)) ? Number(r.forecast) : null;
    const previousNum = r.previous !== null && r.previous !== undefined && Number.isFinite(Number(r.previous)) ? Number(r.previous) : null;

    events.push({
      id,
      title: String(r.title).trim(),
      country: currency,
      countryCode: String(r.country || '').toUpperCase(),
      time,
      impact,
      actual: formatVal(actualNum, r.scale, r.unit),
      forecast: formatVal(forecastNum, r.scale, r.unit),
      previous: formatVal(previousNum, r.scale, r.unit),
      actualNum,
      forecastNum,
      previousNum,
      period: String(r.period || '').trim(),
      summary: trimSummary(r.comment),
      source: String(r.source || '').trim(),
    });
  }

  events.sort((a, b) => a.time - b.time);
  return events;
}

async function fetchFallbackForexFactory() {
  const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
    headers: { 'User-Agent': TV_HEADERS['User-Agent'], Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const raw = await res.json();
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((ev) => ev && ev.title && ev.date && (ev.impact === 'High' || ev.impact === 'Medium'))
    .map((ev) => {
      const time = Math.floor(Date.parse(ev.date) / 1000);
      const country = String(ev.country || '').toUpperCase();
      return {
        id: `ff:${country}:${time}:${ev.title}`,
        title: String(ev.title).trim(),
        country,
        countryCode: country.slice(0, 2),
        time,
        impact: ev.impact,
        actual: '',
        forecast: String(ev.forecast || '').trim(),
        previous: String(ev.previous || '').trim(),
        actualNum: null,
        forecastNum: null,
        previousNum: null,
        period: '',
        summary: '',
        source: 'ForexFactory',
      };
    })
    .filter((e) => Number.isFinite(e.time))
    .sort((a, b) => a.time - b.time);
}

export async function fetchEconomicNews({
  range = 'this_week',
  from = null,
  to = null,
  region = 'us_eu',
} = {}) {
  const { fromIso, toIso } = resolveNewsDateRange(range, from, to);
  const countryCodes = region === 'all' ? ALL_TV_COUNTRIES : ['US', 'EU'];
  const cacheKey = `${region}|${fromIso.slice(0, 13)}|${toIso.slice(0, 13)}`;

  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { events: hit.events, from: fromIso, to: toIso };
  }

  let events = [];
  try {
    events = await fetchFromTradingView(fromIso, toIso, countryCodes);
  } catch {
    events = await fetchFallbackForexFactory().catch(() => []);
    if (region !== 'all') {
      events = events.filter((e) => e.country === 'USD' || e.country === 'EUR');
    }
  }

  if (events.length > 0 || !hit) {
    cache.set(cacheKey, { at: Date.now(), events });
    if (cache.size > 40) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }
  }

  return { events: events.length ? events : hit?.events || [], from: fromIso, to: toIso };
}
