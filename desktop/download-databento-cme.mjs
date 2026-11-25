/**
 * Fast, Resumable, Zero-Overlap Databento Official CME Futures Batch Downloader (Option 1)
 * - Uses Databento Batch API (batch.submit_job -> poll -> batch.list_files -> zstd decompress)
 *   so Databento extracts all 7–10 years server-side in parallel with ZERO timeouts!
 * - Persists submitted job IDs in data/archive/_databento_jobs.json so jobs are NEVER
 *   double-submitted (zero wasted credits!).
 * - Option 1 (Strictly Non-Overlapping):
 *   * 11 main symbols: ohlcv-1m (2020-01-01 -> latest) + ohlcv-1h (2010-06-06 -> 2020-01-01 exclusive)
 *   * BTC.v.0:         ohlcv-1m (2020-01-01 -> latest) + ohlcv-1h (2017-12-17 -> 2020-01-01 exclusive)
 *   * ETH.v.0:         ohlcv-1m (2021-01-01 -> latest) + NO 1h (1m already covers 100% since launch!)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getConfig, getDataDir } from '../server/env.js';
import {
  DATABENTO_SPECS,
  mergeAndSaveArchive,
  saveHtf1hArchive,
} from '../server/archive.js';

const PLAN = [
  { symbol: '6E.v.0', m1Start: '2020-01-01T00:00:00Z', h1Start: '2010-06-06T00:00:00Z', h1End: '2020-01-01T00:00:00Z' },
  { symbol: '6B.v.0', m1Start: '2020-01-01T00:00:00Z', h1Start: '2010-06-06T00:00:00Z', h1End: '2020-01-01T00:00:00Z' },
  { symbol: 'GC.v.0', m1Start: '2020-01-01T00:00:00Z', h1Start: '2010-06-06T00:00:00Z', h1End: '2020-01-01T00:00:00Z' },
  { symbol: 'SI.v.0', m1Start: '2020-01-01T00:00:00Z', h1Start: '2010-06-06T00:00:00Z', h1End: '2020-01-01T00:00:00Z' },
  { symbol: 'ES.v.0', m1Start: '2020-01-01T00:00:00Z', h1Start: '2010-06-06T00:00:00Z', h1End: '2020-01-01T00:00:00Z' },
  { symbol: 'NQ.v.0', m1Start: '2020-01-01T00:00:00Z', h1Start: '2010-06-06T00:00:00Z', h1End: '2020-01-01T00:00:00Z' },
  { symbol: 'CL.v.0', m1Start: '2020-01-01T00:00:00Z', h1Start: '2010-06-06T00:00:00Z', h1End: '2020-01-01T00:00:00Z' },
  { symbol: 'BZ.v.0', m1Start: '2020-01-01T00:00:00Z', h1Start: '2010-06-06T00:00:00Z', h1End: '2020-01-01T00:00:00Z' },
  { symbol: '6C.v.0', m1Start: '2020-01-01T00:00:00Z', h1Start: '2010-06-06T00:00:00Z', h1End: '2020-01-01T00:00:00Z' },
  { symbol: '6S.v.0', m1Start: '2020-01-01T00:00:00Z', h1Start: '2010-06-06T00:00:00Z', h1End: '2020-01-01T00:00:00Z' },
  { symbol: '6A.v.0', m1Start: '2020-01-01T00:00:00Z', h1Start: '2010-06-06T00:00:00Z', h1End: '2020-01-01T00:00:00Z' },
  { symbol: 'BTC.v.0', m1Start: '2020-01-01T00:00:00Z', h1Start: '2017-12-17T00:00:00Z', h1End: '2020-01-01T00:00:00Z' },
  { symbol: 'ETH.v.0', m1Start: '2021-01-01T00:00:00Z', h1Start: null, h1End: null },
];

function authHeader(apiKey) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
}

async function getDatasetEndIso(apiKey) {
  const res = await fetch('https://hist.databento.com/v0/metadata.get_dataset_range?dataset=GLBX.MDP3', {
    headers: { Authorization: authHeader(apiKey) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`get_dataset_range HTTP ${res.status}`);
  const data = await res.json();
  const endMs = Date.parse(data.end) - 5 * 60 * 1000;
  return new Date(endMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function submitBatchJob(apiKey, { symbol, schema, start, end }) {
  const form = new URLSearchParams({
    dataset: 'GLBX.MDP3',
    schema,
    symbols: symbol,
    stype_in: 'continuous',
    start,
    end,
    encoding: 'csv',
    compression: 'zstd',
    pretty_px: 'true',
    pretty_ts: 'false',
    split_symbols: 'false',
    split_duration: 'none',
    delivery: 'download',
  });

  const res = await fetch('https://hist.databento.com/v0/batch.submit_job', {
    method: 'POST',
    headers: {
      Authorization: authHeader(apiKey),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`batch.submit_job HTTP ${res.status}: ${text.slice(0, 240)}`);
  return JSON.parse(text);
}

async function listAllBatchJobs(apiKey) {
  const res = await fetch('https://hist.databento.com/v0/batch.list_jobs', {
    headers: { Authorization: authHeader(apiKey) },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`batch.list_jobs HTTP ${res.status}`);
  return res.json();
}

async function listJobFiles(apiKey, jobId) {
  const res = await fetch(`https://hist.databento.com/v0/batch.list_files?job_id=${encodeURIComponent(jobId)}`, {
    headers: { Authorization: authHeader(apiKey) },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`batch.list_files HTTP ${res.status}`);
  return res.json();
}

function parseDatabentoCsvFile(csvText) {
  const lines = csvText.split(/\r?\n/);
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

async function downloadAndIngestJob(apiKey, tmpDir, task, jobId) {
  const files = await listJobFiles(apiKey, jobId);
  const csvFiles = files.filter((f) => /\.csv(\.zst)?$/i.test(f.filename));
  if (!csvFiles.length) {
    throw new Error(`No CSV files found in job ${jobId}: ${files.map((f) => f.filename).join(', ')}`);
  }

  const allBars = [];
  for (const f of csvFiles) {
    const dlUrl = f.urls?.https;
    if (!dlUrl) continue;
    const localPath = path.join(tmpDir, `${jobId}__${path.basename(f.filename)}`);
    if (!fs.existsSync(localPath)) {
      const res = await fetch(dlUrl, {
        headers: { Authorization: authHeader(apiKey) },
        signal: AbortSignal.timeout(180000),
      });
      if (!res.ok) throw new Error(`Download ${f.filename} HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(localPath, buf);
    }
    let csvText;
    if (localPath.endsWith('.zst')) {
      csvText = execFileSync('zstd', ['-dc', localPath], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8');
    } else {
      csvText = fs.readFileSync(localPath, 'utf8');
    }
    const bars = parseDatabentoCsvFile(csvText);
    for (const b of bars) allBars.push(b);
  }

  const spec = DATABENTO_SPECS[task.symbol] || { display: task.symbol, precision: 2 };
  if (task.schema === 'ohlcv-1m') {
    const saved = mergeAndSaveArchive({
      source: 'databento',
      symbol: task.symbol,
      display: spec.display,
      precision: spec.precision,
      incomingBars: allBars,
    });
    const r = saved.entry.firstTime
      ? `${new Date(saved.entry.firstTime * 1000).toISOString().slice(0, 10)}..${new Date(saved.entry.lastTime * 1000).toISOString().slice(0, 10)}`
      : 'empty';
    console.log(`  [INGESTED 1m] ${task.symbol.padEnd(8)} ${saved.entry.barCount.toLocaleString()} bars (${r})`);
    return saved.entry.barCount;
  } else {
    const saved = saveHtf1hArchive({
      source: 'databento',
      symbol: task.symbol,
      display: spec.display,
      precision: spec.precision,
      incomingBars: allBars,
    });
    const r = saved.entry.htf1hFirstTime
      ? `${new Date(saved.entry.htf1hFirstTime * 1000).toISOString().slice(0, 10)}..${new Date(saved.entry.htf1hLastTime * 1000).toISOString().slice(0, 10)}`
      : 'empty';
    console.log(`  [INGESTED 1h] ${task.symbol.padEnd(8)} ${saved.entry.htf1hBarCount.toLocaleString()} bars (${r})`);
    return saved.entry.htf1hBarCount;
  }
}

async function main() {
  const cfg = getConfig();
  if (!cfg.DATABENTO_API_KEY) {
    console.error('ERROR: DATABENTO_API_KEY is not set in .env');
    process.exit(1);
  }
  const apiKey = cfg.DATABENTO_API_KEY;
  const endIso = await getDatasetEndIso(apiKey);
  console.log(`[Databento Batch] GLBX.MDP3 end: ${endIso}`);

  const archiveDir = path.join(getDataDir(), 'archive');
  const tmpDir = path.join(archiveDir, '_databento_batch');
  fs.mkdirSync(tmpDir, { recursive: true });
  const stateFile = path.join(tmpDir, 'jobs.json');

  let state = {};
  if (fs.existsSync(stateFile)) {
    try {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch {
      state = {};
    }
  }
  const saveState = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');

  const filterSymbols = process.argv.slice(2);
  const targets = filterSymbols.length ? PLAN.filter((p) => filterSymbols.includes(p.symbol)) : PLAN;

  // Build ordered list of non-overlapping tasks
  const tasks = [];
  for (const item of targets) {
    tasks.push({
      taskKey: `${item.symbol}__ohlcv-1m`,
      symbol: item.symbol,
      schema: 'ohlcv-1m',
      start: item.m1Start,
      end: endIso,
    });
    if (item.h1Start && item.h1End) {
      tasks.push({
        taskKey: `${item.symbol}__ohlcv-1h`,
        symbol: item.symbol,
        schema: 'ohlcv-1h',
        start: item.h1Start,
        end: item.h1End,
      });
    }
  }

  // 1. Submit any tasks not yet submitted (never double-submit!)
  let totalSubmittedCost = 0;
  for (const t of tasks) {
    if (state[t.taskKey]?.jobId) {
      console.log(`  [EXISTS]  ${t.taskKey.padEnd(20)} job=${state[t.taskKey].jobId} cost=$${Number(state[t.taskKey].costUsd || 0).toFixed(2)} ingested=${Boolean(state[t.taskKey].ingested)}`);
      totalSubmittedCost += Number(state[t.taskKey].costUsd || 0);
      continue;
    }
    const knownIds = new Set(Object.values(state).map((v) => v.jobId));
    let job = null;
    try {
      job = await submitBatchJob(apiKey, t);
    } catch (submitErr) {
      // If 504 / timeout, check if Databento actually created the job server-side before retrying!
      console.log(`  [SUBMIT WARN] ${t.taskKey}: ${submitErr.message} — checking server jobs...`);
      await new Promise((r) => setTimeout(r, 3000));
      const srvJobs = await listAllBatchJobs(apiKey);
      const newlyCreated = srvJobs.find((j) => j.id.startsWith('GLBX-') && !knownIds.has(j.id));
      if (newlyCreated) {
        console.log(`  [RECOVERED] ${t.taskKey} -> ${newlyCreated.id} (prevented duplicate submit!)`);
        job = newlyCreated;
      } else {
        // Safe to retry once
        job = await submitBatchJob(apiKey, t);
      }
    }
    const costUsd = Number(job.cost_usd || 0);
    totalSubmittedCost += costUsd;
    state[t.taskKey] = {
      jobId: job.id,
      symbol: t.symbol,
      schema: t.schema,
      start: t.start,
      end: t.end,
      costUsd,
      ingested: false,
    };
    saveState();
    console.log(`  [SUBMIT]  ${t.taskKey.padEnd(20)} job=${job.id} cost=$${costUsd.toFixed(2)} (${t.start.slice(0, 10)}..${t.end.slice(0, 10)})`);
  }
  console.log(`\nTotal batch cost for this run: $${totalSubmittedCost.toFixed(2)}\n`);

  // 2. Poll until all target jobs reach state === 'done'
  const pending = new Set(tasks.filter((t) => !state[t.taskKey]?.ingested).map((t) => t.taskKey));
  while (pending.size > 0) {
    let allJobs;
    try {
      allJobs = await listAllBatchJobs(apiKey);
    } catch (err) {
      console.log(`  [POLL WARN] ${err.message} — retrying in 10s...`);
      await new Promise((r) => setTimeout(r, 10000));
      continue;
    }
    const byId = new Map(allJobs.map((j) => [j.id, j]));
    let readyCount = 0;
    const stateCounts = {};

    for (const taskKey of Array.from(pending)) {
      const rec = state[taskKey];
      const info = byId.get(rec.jobId);
      const st = info?.state || 'unknown';
      if (st === 'done') {
        readyCount += 1;
        const taskObj = tasks.find((t) => t.taskKey === taskKey);
        try {
          await downloadAndIngestJob(apiKey, tmpDir, taskObj, rec.jobId);
          rec.ingested = true;
          saveState();
          pending.delete(taskKey);
        } catch (dlErr) {
          console.log(`  [DL WARN] ${taskKey}: ${dlErr.message} — will retry next pass`);
        }
      } else if (st === 'expired' || st === 'error' || st === 'failed') {
        throw new Error(`Batch job ${rec.jobId} (${taskKey}) ended in state: ${st}`);
      } else {
        stateCounts[st] = (stateCounts[st] || 0) + 1;
      }
    }

    if (pending.size > 0) {
      const stSummary = Object.entries(stateCounts)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      console.log(`  ... ${pending.size} pending (${stSummary}) | ${readyCount} ingested this pass ...`);
      await new Promise((r) => setTimeout(r, 12000));
    }
  }

  console.log('\n=== ALL REQUESTED DATABENTO CME BATCH JOBS DOWNLOADED & INGESTED! ===');
  let grandCost = 0;
  for (const [k, v] of Object.entries(state)) {
    grandCost += Number(v.costUsd || 0);
  }
  console.log(`Cumulative recorded Databento batch cost: $${grandCost.toFixed(2)}`);
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
