export const UNIT_SECONDS = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
  M: 2592000,
};

/**
 * Parse a timeframe string like "1s", "5s", "1m", "3m", "12h", "1d", "1w", "1M", "10m", "2h".
 * Note: lowercase "m" = minutes, uppercase "M" = months!
 */
export function parseTimeframe(raw) {
  const trimmed = String(raw || '1m').trim();
  const m = trimmed.match(/^(\d+)\s*([smhdwMHDWS])$/);
  if (!m) {
    return { label: '1m', count: 1, unit: 'm', seconds: 60 };
  }
  const count = Math.max(1, Math.min(Number.parseInt(m[1], 10), 1000));
  const rawUnit = m[2];
  const unit = rawUnit === 'M' ? 'M' : rawUnit.toLowerCase();
  const seconds = count * (UNIT_SECONDS[unit] || 60);
  const label = `${count}${unit}`;
  return { label, count, unit, seconds };
}

// Fast cached US Eastern DST transition bounds per year (2nd Sunday of March 07:00 UTC -> 1st Sunday of November 06:00 UTC)
const US_DST_CACHE = new Map();

function getUsDstBounds(year) {
  let bounds = US_DST_CACHE.get(year);
  if (bounds) return bounds;
  const mar1 = new Date(Date.UTC(year, 2, 1));
  const marFirstSun = 1 + ((7 - mar1.getUTCDay()) % 7);
  const marSecondSun = marFirstSun + 7;
  const dstStart = Math.floor(Date.UTC(year, 2, marSecondSun, 7, 0, 0) / 1000);

  const nov1 = new Date(Date.UTC(year, 10, 1));
  const novFirstSun = 1 + ((7 - nov1.getUTCDay()) % 7);
  const dstEnd = Math.floor(Date.UTC(year, 10, novFirstSun, 6, 0, 0) / 1000);

  bounds = [dstStart, dstEnd];
  US_DST_CACHE.set(year, bounds);
  return bounds;
}

/**
 * Returns America/New_York UTC offset in seconds (-14400 in EDT summer, -18000 in EST winter).
 */
export function getNyUtcOffsetSec(unixSec) {
  const year = new Date(unixSec * 1000).getUTCFullYear();
  const [dstStart, dstEnd] = getUsDstBounds(year);
  return unixSec >= dstStart && unixSec < dstEnd ? -14400 : -18000;
}

/**
 * Determine TradingView-style session open hour in America/New_York for HTF resampling:
 * - CME / Databento Futures: 18:00 NY (Globex session open -> 5 clean daily candles/week, 4h opens at 18/22/02/06/10/14 NY)
 * - Forex / OANDA / Dukascopy: 17:00 NY (NY Close -> 5 clean daily candles/week, no tiny Sunday bar, 4h opens at 17/21/01/05/09/13 NY)
 * - Crypto / others: null (00:00 UTC aligned)
 */
export function getSessionOpenHourNy(source) {
  const s = String(source || '').toLowerCase();
  if (s === 'databento' || s === 'cme') return 18;
  if (s === 'oanda' || s === 'dukascopy') return 17;
  return null;
}

function getBucketTimestamp(unixSec, parsed, openHourNy) {
  // Sub-hour and 1h candles always align cleanly to UTC clock boundaries
  if (parsed.seconds <= 3600) {
    return Math.floor(unixSec / parsed.seconds) * parsed.seconds;
  }

  // TradingView NY-session aligned bucketing for CME (18:00 NY) & Forex (17:00 NY)
  if (openHourNy !== null) {
    const shiftSec = (24 - openHourNy) * 3600;
    const nyOffset = getNyUtcOffsetSec(unixSec);
    const shiftedSec = unixSec + nyOffset + shiftSec;

    if (parsed.unit === 'M') {
      const d = new Date(shiftedSec * 1000);
      const monthIndex = Math.floor(d.getUTCMonth() / parsed.count) * parsed.count;
      return Math.floor(Date.UTC(d.getUTCFullYear(), monthIndex, 1) / 1000);
    }

    if (parsed.unit === 'w') {
      // 1970-01-05 00:00 UTC is Monday (345600) -> Sunday 17:00/18:00 NY starts the new week cleanly!
      const weekOffset = 345600;
      const span = parsed.seconds;
      const bucketShifted = Math.floor((shiftedSec - weekOffset) / span) * span + weekOffset;
      const approxUtc = bucketShifted - shiftSec - nyOffset;
      const openNyOffset = getNyUtcOffsetSec(approxUtc);
      return bucketShifted - shiftSec - openNyOffset;
    }

    // 2h, 4h, 6h, 8h, 12h, 1d, etc.
    const span = parsed.seconds;
    const bucketShifted = Math.floor(shiftedSec / span) * span;
    const approxUtc = bucketShifted - shiftSec - nyOffset;
    const openNyOffset = getNyUtcOffsetSec(approxUtc);
    return bucketShifted - shiftSec - openNyOffset;
  }

  // Default 00:00 UTC alignment (Crypto, Stocks, Custom)
  if (parsed.unit === 'M') {
    const d = new Date(unixSec * 1000);
    const monthIndex = Math.floor(d.getUTCMonth() / parsed.count) * parsed.count;
    return Math.floor(Date.UTC(d.getUTCFullYear(), monthIndex, 1) / 1000);
  }
  if (parsed.unit === 'w') {
    // Align to Monday 00:00 UTC (1970-01-05 is Monday = 345600)
    const weekOffset = 345600;
    const span = parsed.seconds;
    return Math.floor((unixSec - weekOffset) / span) * span + weekOffset;
  }
  return Math.floor(unixSec / parsed.seconds) * parsed.seconds;
}

/**
 * Resample sorted OHLC bars into larger timeframe buckets.
 * Pass `source` ('databento', 'cme', 'oanda', 'dukascopy', 'binance', ...) for TradingView session alignment.
 */
export function resampleOhlc(bars, parsed, source = null) {
  if (!Array.isArray(bars) || bars.length === 0) return [];
  const openHourNy = getSessionOpenHourNy(source);
  const buckets = new Map();
  for (const bar of bars) {
    const bucketTime = getBucketTimestamp(bar.time, parsed, openHourNy);
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, {
        time: bucketTime,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });
    } else {
      if (bar.high > existing.high) existing.high = bar.high;
      if (bar.low < existing.low) existing.low = bar.low;
      existing.close = bar.close;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}
