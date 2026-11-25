/**
 * Deep Offline OANDA + Binance Archive Downloader (Personal Full Archive + Full Data Pack)
 * - Extends all 14 OANDA watchlist pairs to:
 *   * 1m: 1 full year (2025-11-25 -> latest) offline (and user can click "⏪ -6M" anytime for older 1m)
 *   * 1h: Full deep history (2010-01-01 -> m1Start) offline so 1h/4h/12h/1D/1W run 100% offline back to 2010+!
 * - Extends Binance BTCUSDT & ETHUSDT to:
 *   * 1m: 1 full year offline
 *   * 1h: Full 2017-08-17 -> m1Start offline!
 * - Resumable & non-overlapping: skips ranges already present in data/archive/.
 */

import {
  fetchOandaRange,
  fetchCryptoRange,
  mergeAndSaveArchive,
  saveHtf1hArchive,
  listArchiveEntries,
} from '../server/archive.js';
import { fetchOandaCandles } from '../server/oanda.js';

const OANDA_TARGETS = [
  { symbol: 'XAU_USD', display: 'XAU/USD', precision: 2 },
  { symbol: 'XAG_USD', display: 'XAG/USD', precision: 3 },
  { symbol: 'EUR_USD', display: 'EUR/USD', precision: 5 },
  { symbol: 'GBP_USD', display: 'GBP/USD', precision: 5 },
  { symbol: 'EUR_GBP', display: 'EUR/GBP', precision: 5 },
  { symbol: 'USD_JPY', display: 'USD/JPY', precision: 3 },
  { symbol: 'USD_CAD', display: 'USD/CAD', precision: 5 },
  { symbol: 'AUD_USD', display: 'AUD/USD', precision: 5 },
  { symbol: 'USD_CHF', display: 'USD/CHF', precision: 5 },
  { symbol: 'DXY', display: 'DXY (OANDA Synthetic)', precision: 3 },
  { symbol: 'NAS100_USD', display: 'NAS100', precision: 1 },
  { symbol: 'SPX500_USD', display: 'SPX500', precision: 1 },
  { symbol: 'WTICO_USD', display: 'WTI Oil', precision: 2 },
  { symbol: 'BCO_USD', display: 'Brent Oil', precision: 2 },
];

const BINANCE_TARGETS = [
  { symbol: 'BTCUSDT', display: 'BTC/USDT', precision: 2 },
  { symbol: 'ETHUSDT', display: 'ETH/USDT', precision: 2 },
];

async function probeOandaEarliest() {
  try {
    const probes = [
      ['EUR_USD', '1m', Date.parse('2006-01-05T00:00:00Z') / 1000],
      ['XAU_USD', '1m', Date.parse('2006-01-05T00:00:00Z') / 1000],
      ['EUR_USD', '5s', Date.parse('2006-01-05T00:00:00Z') / 1000],
    ];
    console.log('=== OANDA GRANULARITY & DEPTH PROBE ===');
    for (const [sym, tf, ts] of probes) {
      try {
        const res = await fetchOandaCandles(sym, tf, 5, ts);
        const first = res.bars?.[0]?.time ? new Date(res.bars[0].time * 1000).toISOString().slice(0, 10) : 'none';
        console.log(`  ${sym} ${tf} (probe <=2006): ${res.bars?.length || 0} bars, first=${first}`);
      } catch (e) {
        console.log(`  ${sym} ${tf} probe error: ${e.message}`);
      }
    }
  } catch {
    // ignore
  }
}

async function main() {
  await probeOandaEarliest();

  const nowSec = Math.floor(Date.now() / 1000) - 60;
  const targetM1FromSec = nowSec - 365 * 86400; // 1 full year of 1m offline
  const targetH1FromSec = Math.floor(Date.parse('2010-01-01T00:00:00Z') / 1000);
  const binanceH1FromSec = Math.floor(Date.parse('2017-08-17T00:00:00Z') / 1000);

  const existingMap = new Map(listArchiveEntries().map((e) => [e.key, e]));

  console.log('\n=== OANDA DEEP OFFLINE DOWNLOAD (1y 1m + 2010..pre-1m 1h) ===');
  for (const t of OANDA_TARGETS) {
    const key = `oanda:${t.symbol}`;
    const existing = existingMap.get(key);
    let m1First = existing?.firstTime || null;
    const t0 = Date.now();

    // 1. Extend 1m backwards to 1 full year if needed
    if (!m1First || m1First > targetM1FromSec + 7 * 86400) {
      const fetchTo = m1First ? m1First - 60 : nowSec;
      const m1Bars = await fetchOandaRange(t.symbol, targetM1FromSec, fetchTo, '1m');
      const saved = mergeAndSaveArchive({
        source: 'oanda',
        symbol: t.symbol,
        display: t.display,
        precision: t.precision,
        incomingBars: m1Bars,
      });
      m1First = saved.entry.firstTime;
      console.log(
        `  [OANDA 1m] ${t.symbol.padEnd(11)} +${saved.addedBars.toLocaleString()} -> total ${saved.entry.barCount.toLocaleString()} (${new Date(saved.entry.firstTime * 1000).toISOString().slice(0, 10)}..${new Date(saved.entry.lastTime * 1000).toISOString().slice(0, 10)}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`
      );
    } else {
      console.log(`  [OANDA 1m] ${t.symbol.padEnd(11)} already covers 1y+ (${existing.barCount.toLocaleString()} bars)`);
    }

    // 2. Download non-overlapping 1h from 2010-01-01 -> m1First - 3600
    const h1To = (m1First || targetM1FromSec) - 3600;
    if (!existing?.htf1hFirstTime || existing.htf1hFirstTime > targetH1FromSec + 30 * 86400) {
      const t1 = Date.now();
      const h1Bars = await fetchOandaRange(t.symbol, targetH1FromSec, h1To, '1h');
      const savedH1 = saveHtf1hArchive({
        source: 'oanda',
        symbol: t.symbol,
        display: t.display,
        precision: t.precision,
        incomingBars: h1Bars,
      });
      const h1Start = savedH1.entry.htf1hFirstTime
        ? new Date(savedH1.entry.htf1hFirstTime * 1000).toISOString().slice(0, 10)
        : 'none';
      const h1End = savedH1.entry.htf1hLastTime
        ? new Date(savedH1.entry.htf1hLastTime * 1000).toISOString().slice(0, 10)
        : 'none';
      console.log(
        `  [OANDA 1h] ${t.symbol.padEnd(11)} ${savedH1.entry.htf1hBarCount.toLocaleString()} bars (${h1Start}..${h1End}) in ${((Date.now() - t1) / 1000).toFixed(1)}s`
      );
    } else {
      console.log(`  [OANDA 1h] ${t.symbol.padEnd(11)} already cached (${existing.htf1hBarCount.toLocaleString()} bars)`);
    }
  }

  console.log('\n=== BINANCE DEEP OFFLINE DOWNLOAD (1y 1m + 2017..pre-1m 1h) ===');
  for (const t of BINANCE_TARGETS) {
    const key = `binance:${t.symbol}`;
    const existing = existingMap.get(key);
    let m1First = existing?.firstTime || null;
    const t0 = Date.now();

    if (!m1First || m1First > targetM1FromSec + 7 * 86400) {
      const fetchTo = m1First ? m1First - 60 : nowSec;
      const m1Bars = await fetchCryptoRange('binance', t.symbol, targetM1FromSec, fetchTo, '1m');
      const saved = mergeAndSaveArchive({
        source: 'binance',
        symbol: t.symbol,
        display: t.display,
        precision: t.precision,
        incomingBars: m1Bars,
      });
      m1First = saved.entry.firstTime;
      console.log(
        `  [BINANCE 1m] ${t.symbol.padEnd(8)} +${saved.addedBars.toLocaleString()} -> total ${saved.entry.barCount.toLocaleString()} in ${((Date.now() - t0) / 1000).toFixed(1)}s`
      );
    } else {
      console.log(`  [BINANCE 1m] ${t.symbol.padEnd(8)} already covers 1y+ (${existing.barCount.toLocaleString()} bars)`);
    }

    const h1To = (m1First || targetM1FromSec) - 3600;
    if (!existing?.htf1hFirstTime || existing.htf1hFirstTime > binanceH1FromSec + 30 * 86400) {
      const t1 = Date.now();
      const h1Bars = await fetchCryptoRange('binance', t.symbol, binanceH1FromSec, h1To, '1h');
      const savedH1 = saveHtf1hArchive({
        source: 'binance',
        symbol: t.symbol,
        display: t.display,
        precision: t.precision,
        incomingBars: h1Bars,
      });
      console.log(
        `  [BINANCE 1h] ${t.symbol.padEnd(8)} ${savedH1.entry.htf1hBarCount.toLocaleString()} bars (${new Date(savedH1.entry.htf1hFirstTime * 1000).toISOString().slice(0, 10)}..${new Date(savedH1.entry.htf1hLastTime * 1000).toISOString().slice(0, 10)}) in ${((Date.now() - t1) / 1000).toFixed(1)}s`
      );
    }
  }

  console.log('\nDONE: OANDA & Binance deep offline archives complete!');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
