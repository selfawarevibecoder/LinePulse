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

// ============================================================================
// Major Market Holidays Calendar (US / EU / UK — Computed accurately for ANY year)
// ============================================================================
function computeEasterUtc(year) {
  // Anonymous Gregorian (Meeus/Jones/Butcher) algorithm
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=Mar, 4=Apr
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

function nthWeekdayUtc(year, monthZero, weekday, nth) {
  const firstDow = new Date(Date.UTC(year, monthZero, 1)).getUTCDay();
  const offset = (weekday - firstDow + 7) % 7;
  return Date.UTC(year, monthZero, 1 + offset + (nth - 1) * 7);
}

function lastWeekdayUtc(year, monthZero, weekday) {
  const lastDate = new Date(Date.UTC(year, monthZero + 1, 0));
  const diff = (lastDate.getUTCDay() - weekday + 7) % 7;
  return Date.UTC(year, monthZero, lastDate.getUTCDate() - diff);
}

function observedFixedUtc(year, monthZero, day) {
  const dt = new Date(Date.UTC(year, monthZero, day));
  const dow = dt.getUTCDay();
  if (dow === 6) return Date.UTC(year, monthZero, day - 1); // Sat -> Fri
  if (dow === 0) return Date.UTC(year, monthZero, day + 1); // Sun -> Mon
  return dt.getTime();
}

function buildMarketHolidaysForYear(year) {
  const DAY = 86400 * 1000;
  const easter = computeEasterUtc(year);
  const thanksgiving = nthWeekdayUtc(year, 10, 4, 4); // 4th Thu of Nov
  const blackFriday = thanksgiving + DAY;
  const xmasEve = Date.UTC(year, 11, 24);
  const xmasEveDow = new Date(xmasEve).getUTCDay();

  const raw = [
    {
      ms: observedFixedUtc(year, 0, 1),
      country: 'USD',
      countryCode: 'US',
      title: "New Year's Day",
      titleTr: 'Yılbaşı Tatili (Küresel)',
      holidayStatus: 'closed',
      noteEn: 'US, EU, UK & CME Markets Closed',
      noteTr: 'ABD, Avrupa, İngiltere ve CME Piyasaları Kapalı',
    },
    {
      ms: nthWeekdayUtc(year, 0, 1, 3),
      country: 'USD',
      countryCode: 'US',
      title: 'Martin Luther King Jr. Day',
      titleTr: 'ABD — Martin Luther King Günü',
      holidayStatus: 'closed',
      noteEn: 'NYSE/NASDAQ Closed · CME Early Close (13:00 ET)',
      noteTr: 'ABD Borsaları Kapalı · CME Vadeli Erken Kapanış',
    },
    {
      ms: nthWeekdayUtc(year, 1, 1, 3),
      country: 'USD',
      countryCode: 'US',
      title: "US Presidents' Day",
      titleTr: 'ABD — Başkanlar Günü',
      holidayStatus: 'closed',
      noteEn: 'NYSE/NASDAQ Closed · CME Early Close (13:00 ET)',
      noteTr: 'ABD Borsaları Kapalı · CME Vadeli Erken Kapanış',
    },
    {
      ms: easter - 2 * DAY,
      country: 'USD',
      countryCode: 'US',
      title: 'Good Friday',
      titleTr: 'Kutsal Cuma (Good Friday)',
      holidayStatus: 'closed',
      noteEn: 'US, EU, UK & CME Markets Closed',
      noteTr: 'ABD, Avrupa, İngiltere ve CME Piyasaları Kapalı',
    },
    {
      ms: easter + DAY,
      country: 'EUR',
      countryCode: 'EU',
      title: 'Easter Monday (EU / UK Bank Holiday)',
      titleTr: 'Paskalya Pazartesisi (Avrupa / Londra)',
      holidayStatus: 'closed',
      noteEn: 'EU & UK Banks/Equities Closed · US Open',
      noteTr: 'Avrupa & Londra Kapalı · ABD Açık (Düşük Likidite)',
    },
    {
      ms: Date.UTC(year, 4, 1),
      country: 'EUR',
      countryCode: 'EU',
      title: 'Europe Labour Day (May 1)',
      titleTr: 'Avrupa İşçi Bayramı (1 Mayıs)',
      holidayStatus: 'closed',
      noteEn: 'Major EU Markets Closed · US & UK Open',
      noteTr: 'Avrupa Borsaları Kapalı · ABD ve Londra Açık',
    },
    {
      ms: lastWeekdayUtc(year, 4, 1),
      country: 'USD',
      countryCode: 'US',
      title: 'US Memorial Day',
      titleTr: 'ABD — Anma Günü (Memorial Day)',
      holidayStatus: 'closed',
      noteEn: 'NYSE/NASDAQ Closed · CME Early Close (13:00 ET)',
      noteTr: 'ABD Borsaları Kapalı · CME Vadeli Erken Kapanış',
    },
    {
      ms: lastWeekdayUtc(year, 4, 1),
      country: 'GBP',
      countryCode: 'GB',
      title: 'UK Spring Bank Holiday',
      titleTr: 'İngiltere Bahar Banka Tatili',
      holidayStatus: 'closed',
      noteEn: 'London Banks & LSE Closed',
      noteTr: 'Londra Bankaları & LSE Kapalı',
    },
    {
      ms: observedFixedUtc(year, 5, 19),
      country: 'USD',
      countryCode: 'US',
      title: 'US Juneteenth National Independence Day',
      titleTr: 'ABD — Juneteenth Tatili',
      holidayStatus: 'closed',
      noteEn: 'NYSE/NASDAQ Closed · CME Early Close (13:00 ET)',
      noteTr: 'ABD Borsaları Kapalı · CME Vadeli Erken Kapanış',
    },
    {
      ms: observedFixedUtc(year, 6, 4),
      country: 'USD',
      countryCode: 'US',
      title: 'US Independence Day (July 4th)',
      titleTr: 'ABD — Bağımsızlık Günü (4 Temmuz)',
      holidayStatus: 'closed',
      noteEn: 'NYSE/NASDAQ Closed · CME Early Close (13:00 ET)',
      noteTr: 'ABD Borsaları Kapalı · CME Vadeli Erken Kapanış',
    },
    {
      ms: lastWeekdayUtc(year, 7, 1),
      country: 'GBP',
      countryCode: 'GB',
      title: 'UK Summer Bank Holiday',
      titleTr: 'İngiltere Yaz Banka Tatili',
      holidayStatus: 'closed',
      noteEn: 'London Banks & LSE Closed',
      noteTr: 'Londra Bankaları & LSE Kapalı',
    },
    {
      ms: nthWeekdayUtc(year, 8, 1, 1),
      country: 'USD',
      countryCode: 'US',
      title: 'US Labor Day',
      titleTr: 'ABD — İşçi Bayramı (Labor Day)',
      holidayStatus: 'closed',
      noteEn: 'NYSE/NASDAQ Closed · CME Early Close (13:00 ET)',
      noteTr: 'ABD Borsaları Kapalı · CME Vadeli Erken Kapanış',
    },
    {
      ms: thanksgiving,
      country: 'USD',
      countryCode: 'US',
      title: 'US Thanksgiving Day',
      titleTr: 'ABD — Şükran Günü (Thanksgiving)',
      holidayStatus: 'closed',
      noteEn: 'NYSE/NASDAQ Closed · CME Early Close (13:00 ET) — Low Liquidity',
      noteTr: 'ABD Borsaları Kapalı · CME Erken Kapanış — Düşük Likidite',
    },
    {
      ms: blackFriday,
      country: 'USD',
      countryCode: 'US',
      title: 'US Day After Thanksgiving (Black Friday)',
      titleTr: 'ABD — Şükran Günü Ertesi (Erken Kapanış)',
      holidayStatus: 'early_close',
      noteEn: 'NYSE/NASDAQ & CME Early Close (13:00–13:15 ET) — Thin Liquidity',
      noteTr: 'ABD & CME Erken Kapanış (TR 21:00) — Sığ Piyasa',
    },
    ...(xmasEveDow >= 1 && xmasEveDow <= 5
      ? [
          {
            ms: xmasEve,
            country: 'USD',
            countryCode: 'US',
            title: 'Christmas Eve (Early Close)',
            titleTr: 'Noel Arifesi (Erken Kapanış)',
            holidayStatus: 'early_close',
            noteEn: 'US / UK / EU Markets Early Close — Very Low Liquidity',
            noteTr: 'ABD / Avrupa / Londra Erken Kapanış — Çok Düşük Likidite',
          },
        ]
      : []),
    {
      ms: observedFixedUtc(year, 11, 25),
      country: 'USD',
      countryCode: 'US',
      title: 'Christmas Day',
      titleTr: 'Noel Tatili (Christmas Day)',
      holidayStatus: 'closed',
      noteEn: 'Global Markets Closed (US / EU / UK / CME)',
      noteTr: 'Küresel Piyasalar Kapalı (ABD / Avrupa / İngiltere / CME)',
    },
    {
      ms: observedFixedUtc(year, 11, 26),
      country: 'EUR',
      countryCode: 'EU',
      title: 'Boxing Day / St. Stephen Day (EU / UK)',
      titleTr: 'Boxing Day (Avrupa / Londra Kapalı)',
      holidayStatus: 'closed',
      noteEn: 'EU & UK Markets Closed · US Open with Holiday Liquidity',
      noteTr: 'Avrupa & Londra Kapalı · ABD Düşük Likiditeyle Açık',
    },
  ];

  return raw.map((h) => {
    const startSec = Math.floor(h.ms / 1000);
    return {
      id: `hol:${h.country}:${startSec}:${h.title}`,
      isHoliday: true,
      holidayStatus: h.holidayStatus,
      title: h.title,
      titleTr: h.titleTr,
      country: h.country,
      countryCode: h.countryCode,
      time: startSec,
      endTime: startSec + 86399,
      impact: 'Holiday',
      actual: '',
      forecast: '',
      previous: '',
      actualNum: null,
      forecastNum: null,
      previousNum: null,
      period: '',
      summary: h.noteEn,
      noteEn: h.noteEn,
      noteTr: h.noteTr,
      source: 'Market Holiday',
    };
  });
}

function getMarketHolidaysInRange(fromIso, toIso, region = 'us_eu') {
  const fromSec = Math.floor(Date.parse(fromIso) / 1000);
  const toSec = Math.floor(Date.parse(toIso) / 1000);
  if (!Number.isFinite(fromSec) || !Number.isFinite(toSec)) return [];

  const y1 = new Date(fromSec * 1000).getUTCFullYear();
  const y2 = new Date(toSec * 1000).getUTCFullYear();
  const out = [];
  for (let y = y1; y <= y2; y += 1) {
    for (const h of buildMarketHolidaysForYear(y)) {
      if (region !== 'all' && h.country !== 'USD' && h.country !== 'EUR') continue;
      if (h.endTime >= fromSec && h.time <= toSec) {
        out.push(h);
      }
    }
  }
  return out;
}

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

  const holidays = getMarketHolidaysInRange(fromIso, toIso, region);
  const combined = [...holidays, ...events].sort((a, b) => a.time - b.time);

  if (combined.length > 0 || !hit) {
    cache.set(cacheKey, { at: Date.now(), events: combined });
    if (cache.size > 40) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }
  }

  return { events: combined.length ? combined : hit?.events || [], from: fromIso, to: toIso };
}
