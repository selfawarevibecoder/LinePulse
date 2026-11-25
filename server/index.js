import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import { getConfig, getPublicConfig, loadConfig, ROOT_DIR, saveConfig } from './env.js';
import { CURATED_SYMBOLS } from './symbols.js';
import {
  fetchOandaCandles,
  fetchOandaInstruments,
  getCachedOandaInstruments,
  OandaStreamManager,
} from './oanda.js';
import { CmePollerManager, fetchCmeHistory } from './cme.js';
import { CRYPTO_SOURCES, CryptoStreamManager, fetchCryptoHistory } from './crypto.js';
import { deleteLayout, listLayouts, saveLayout } from './layouts.js';
import { deleteTemplate, listTemplates, saveTemplate } from './templates.js';
import { AlertManager } from './alerts.js';
import { readDrawings, saveAllDrawings, saveSymbolDrawings } from './drawings.js';
import { fetchEconomicNews } from './news.js';
import {
  deleteCustomPropRule,
  deleteReplaySession,
  fetchReplayBars,
  listPropRules,
  listReplaySessions,
  saveCustomPropRule,
  saveReplaySession,
} from './replay.js';
import {
  DATABENTO_SPECS,
  DUKASCOPY_SPECS,
  deleteArchiveEntry,
  downloadToArchive,
  importCsvToArchive,
  listArchiveEntries,
} from './archive.js';

loadConfig();

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const BUNDLED_LWC = path.join(PUBLIC_DIR, 'vendor', 'lightweight-charts.mjs');
const NODE_MOD_LWC = path.join(
  ROOT_DIR,
  'node_modules',
  'lightweight-charts',
  'dist',
  'lightweight-charts.standalone.production.mjs'
);
const LWC_FILE = fs.existsSync(BUNDLED_LWC) ? BUNDLED_LWC : NODE_MOD_LWC;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const ALL_SOURCES = ['oanda', 'cme', 'stocks', 'binance', 'coinbase', 'bybit', 'kraken'];

const oandaStream = new OandaStreamManager();
const cmePoller = new CmePollerManager();
const cryptoStream = new CryptoStreamManager();
const alertManager = new AlertManager();

// Active SSE clients: Map<clientId, { res, subs: Record<source, Set<string>> }>
const clients = new Map();
let nextClientId = 1;

function recomputeSubscriptions() {
  const bySource = {};
  for (const s of ALL_SOURCES) bySource[s] = new Set();

  for (const client of clients.values()) {
    for (const src of ALL_SOURCES) {
      for (const sym of client.subs[src]) bySource[src].add(sym);
    }
  }
  const alertSyms = alertManager.getActiveSymbols();
  for (const src of ALL_SOURCES) {
    for (const sym of alertSyms[src] || []) bySource[src].add(sym);
  }

  oandaStream.setSymbols(bySource.oanda);
  // Both CME futures & US Stocks share the zero-key CNBC poller
  cmePoller.setSymbols([...bySource.cme, ...bySource.stocks]);
  cryptoStream.setSymbolsBySource({
    binance: bySource.binance,
    coinbase: bySource.coinbase,
    bybit: bySource.bybit,
    kraken: bySource.kraken,
  });
}

alertManager.on('changed', (list) => {
  recomputeSubscriptions();
  for (const client of clients.values()) {
    sendSse(client.res, 'alerts_sync', { alerts: list });
  }
});

alertManager.on('triggered', (event) => {
  for (const client of clients.values()) {
    sendSse(client.res, 'alert_triggered', event);
  }
});

function sendSse(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Client disconnected
  }
}

function broadcastStatus() {
  const payload = {
    oanda: oandaStream.getStatus(),
    cme: cmePoller.getStatus(),
    crypto: cryptoStream.getStatus(),
    connectedScreens: clients.size,
  };
  for (const client of clients.values()) {
    sendSse(client.res, 'status', payload);
  }
}

oandaStream.on('tick', (tick) => {
  alertManager.evaluateTick(tick);
  for (const client of clients.values()) {
    if (client.subs.oanda.has(tick.symbol)) {
      sendSse(client.res, 'tick', tick);
    }
  }
});

cmePoller.on('tick', (tick) => {
  // Emit as 'cme' and/or 'stocks' depending on what clients subscribed to
  alertManager.evaluateTick(tick);
  alertManager.evaluateTick({ ...tick, source: 'stocks' });
  for (const client of clients.values()) {
    if (client.subs.cme.has(tick.symbol)) {
      sendSse(client.res, 'tick', tick);
    }
    if (client.subs.stocks.has(tick.symbol)) {
      sendSse(client.res, 'tick', { ...tick, source: 'stocks' });
    }
  }
});

cryptoStream.on('tick', (tick) => {
  alertManager.evaluateTick(tick);
  for (const client of clients.values()) {
    if (client.subs[tick.source]?.has(tick.symbol)) {
      sendSse(client.res, 'tick', tick);
    }
  }
});

oandaStream.on('status', broadcastStatus);
cmePoller.on('status', broadcastStatus);
cryptoStream.on('status', broadcastStatus);

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

function readJsonBody(req, maxBytes = 5_000_000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Geçersiz JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.mjs' ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    // 1. Vendor lightweight-charts ESM bundle
    if (pathname === '/vendor/lightweight-charts.mjs') {
      return serveFile(res, LWC_FILE);
    }

    // 2. API: Get config & live feed status
    if (pathname === '/api/config' && req.method === 'GET') {
      return sendJson(res, 200, {
        config: getPublicConfig(),
        feeds: {
          oanda: oandaStream.getStatus(),
          cme: cmePoller.getStatus(),
          connectedScreens: clients.size,
        },
      });
    }

    // 3. API: Update config (.env)
    if (pathname === '/api/config' && req.method === 'POST') {
      const body = await readJsonBody(req);
      saveConfig({
        OANDA_API_KEY: body.oandaApiKey ?? '__KEEP__',
        OANDA_ACCOUNT_ID: body.oandaAccountId,
        OANDA_ENV: body.oandaEnv,
        TWELVEDATA_API_KEY: body.twelveDataApiKey ?? '__KEEP__',
        DATABENTO_API_KEY: body.databentoApiKey ?? '__KEEP__',
        IBKR_GATEWAY_URL: body.ibkrGatewayUrl,
        IBKR_ENABLED:
          typeof body.ibkrEnabled === 'boolean' ? String(body.ibkrEnabled) : undefined,
        DEFAULT_TIMEZONE: body.defaultTimezone,
      });
      oandaStream.restart();
      return sendJson(res, 200, {
        ok: true,
        config: getPublicConfig(),
        feeds: {
          oanda: oandaStream.getStatus(),
          cme: cmePoller.getStatus(),
          connectedScreens: clients.size,
        },
      });
    }

    // 3b. API: Free Economic Calendar News (Actual / Forecast / Previous + Historical Ranges)
    if (pathname === '/api/news' && req.method === 'GET') {
      const range = (url.searchParams.get('range') || 'this_week').trim().toLowerCase();
      const region = (url.searchParams.get('region') || 'us_eu').trim().toLowerCase();
      const from = url.searchParams.get('from') || null;
      const to = url.searchParams.get('to') || null;
      const result = await fetchEconomicNews({ range, from, to, region });
      return sendJson(res, 200, result);
    }

    // 3d. API: Offline Backtest Data Archive (Dukascopy Free, Databento CME, OANDA, Binance, CSV + Incremental Delta Sync)
    if (pathname === '/api/archive' && req.method === 'GET') {
      return sendJson(res, 200, {
        entries: listArchiveEntries(),
        presets: {
          dukascopy: Object.entries(DUKASCOPY_SPECS).map(([symbol, info]) => ({
            symbol,
            display: info.display,
          })),
          databento: Object.entries(DATABENTO_SPECS).map(([symbol, info]) => ({
            symbol,
            display: info.display,
          })),
        },
      });
    }

    if (pathname === '/api/archive/download' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const result = await downloadToArchive({
        source: body.source,
        symbol: body.symbol,
        display: body.display,
        fromSec: body.fromSec,
        toSec: body.toSec,
        mode: body.mode || 'range',
        extendDays: body.extendDays,
      });
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (pathname === '/api/archive/import' && req.method === 'POST') {
      const body = await readJsonBody(req, 45_000_000);
      const result = importCsvToArchive({
        source: body.source || 'custom',
        symbol: body.symbol,
        display: body.display,
        csvText: body.csvText,
        isGzipBase64: Boolean(body.isGzipBase64),
      });
      return sendJson(res, 200, {
        ok: true,
        ...result,
        message: `Imported +${result.addedBars.toLocaleString()} bars (${result.entry.display}).`,
      });
    }

    if (pathname === '/api/archive' && req.method === 'DELETE') {
      const source = (url.searchParams.get('source') || '').trim();
      const symbol = (url.searchParams.get('symbol') || '').trim();
      const entries = deleteArchiveEntry(source, symbol);
      return sendJson(res, 200, { ok: true, entries });
    }

    // 3c. API: Backtest / Replay Historical Bars (Disk-Cached, Paginated)
    if (pathname === '/api/replay/bars' && req.method === 'GET') {
      const source = (url.searchParams.get('source') || 'oanda').toLowerCase();
      const symbol = (url.searchParams.get('symbol') || '').trim();
      const tf = (url.searchParams.get('tf') || '1m').trim();
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const count = url.searchParams.get('count');
      if (!symbol) return sendJson(res, 400, { error: 'Symbol is required.' });
      try {
        const data = await fetchReplayBars({ source, symbol, tf, from, to, count });
        return sendJson(res, 200, data);
      } catch (err) {
        return sendJson(res, err.code === 'NO_OANDA_KEY' ? 401 : 400, {
          error: err.message,
          code: err.code || 'REPLAY_ERROR',
          suggestion: err.suggestion || null,
        });
      }
    }

    // 3d. API: Backtest Sessions CRUD
    if (pathname === '/api/replay/sessions' && req.method === 'GET') {
      return sendJson(res, 200, { sessions: listReplaySessions() });
    }
    if (pathname === '/api/replay/sessions' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const saved = saveReplaySession(body.session || body);
      return sendJson(res, 200, { ok: true, ...saved });
    }
    if (pathname.startsWith('/api/replay/sessions/') && req.method === 'DELETE') {
      const id = decodeURIComponent(pathname.slice('/api/replay/sessions/'.length));
      return sendJson(res, 200, { ok: true, sessions: deleteReplaySession(id) });
    }

    // 3e. API: Prop Firm Rule Presets (FTMO, The5ers + Custom Saved Rules)
    if (pathname === '/api/replay/prop-rules' && req.method === 'GET') {
      return sendJson(res, 200, { rules: listPropRules() });
    }
    if (pathname === '/api/replay/prop-rules' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const saved = saveCustomPropRule(body.rule || body);
      return sendJson(res, 200, { ok: true, ...saved });
    }
    if (pathname.startsWith('/api/replay/prop-rules/') && req.method === 'DELETE') {
      const id = decodeURIComponent(pathname.slice('/api/replay/prop-rules/'.length));
      return sendJson(res, 200, { ok: true, rules: deleteCustomPropRule(id) });
    }

    // 4. API: Symbol catalog (curated + cached dynamic OANDA account instruments)
    if (pathname === '/api/symbols' && req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const filterSource = (url.searchParams.get('source') || '').trim().toLowerCase();

      // Trigger background refresh without blocking UI response
      fetchOandaInstruments().catch(() => {});
      const extraOanda = getCachedOandaInstruments();
      const seen = new Set(CURATED_SYMBOLS.map((s) => `${s.source}:${s.symbol}`));
      const combined = [...CURATED_SYMBOLS];

      for (const item of extraOanda) {
        const key = `${item.source}:${item.symbol}`;
        if (!seen.has(key)) {
          seen.add(key);
          combined.push(item);
        }
      }

      const filtered = combined.filter((item) => {
        if (filterSource && filterSource !== 'all') {
          if (filterSource === 'crypto') {
            if (!CRYPTO_SOURCES.has(item.source)) return false;
          } else if (item.source !== filterSource) {
            return false;
          }
        }
        if (!q) return true;
        return (
          item.symbol.toLowerCase().includes(q) ||
          item.display.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          item.exchange.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q)
        );
      });

      return sendJson(res, 200, { symbols: filtered.slice(0, 120) });
    }

    // 5. API: Historical OHLC bars (supports &to=<unixSec> for infinite scroll-left pagination)
    if (pathname === '/api/history' && req.method === 'GET') {
      const source = (url.searchParams.get('source') || 'oanda').toLowerCase();
      const symbol = (url.searchParams.get('symbol') || '').trim();
      const tf = (url.searchParams.get('tf') || '1m').trim();
      const toParam = url.searchParams.get('to');
      const toUnixSec = toParam ? Number.parseInt(toParam, 10) : null;
      const countParam = url.searchParams.get('count');
      const count = countParam ? Number.parseInt(countParam, 10) : 1200;

      if (!symbol) {
        return sendJson(res, 400, { error: 'Symbol is required' });
      }

      let data;
      if (source === 'oanda') {
        data = await fetchOandaCandles(symbol, tf, count, Number.isFinite(toUnixSec) ? toUnixSec : null);
      } else if (CRYPTO_SOURCES.has(source)) {
        data = await fetchCryptoHistory(source, symbol, tf, count, Number.isFinite(toUnixSec) ? toUnixSec : null);
      } else if (source === 'stocks') {
        data = await fetchCmeHistory(symbol, tf, 'stocks');
      } else {
        data = await fetchCmeHistory(symbol, tf, 'cme');
      }

      return sendJson(res, 200, data);
    }

    // 5b. API: Save / Load Named Layouts (persisted to data/layouts.json)
    if (pathname === '/api/layouts' && req.method === 'GET') {
      return sendJson(res, 200, { layouts: listLayouts() });
    }

    if (pathname === '/api/layouts' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const saved = saveLayout(body);
      return sendJson(res, 200, { ok: true, layout: saved, layouts: listLayouts() });
    }

    if (pathname.startsWith('/api/layouts/') && req.method === 'DELETE') {
      const id = decodeURIComponent(pathname.slice('/api/layouts/'.length));
      const removed = deleteLayout(id);
      return sendJson(res, removed ? 200 : 404, { ok: removed, layouts: listLayouts() });
    }

    // 5c. API: Save / Load Custom Chart Style Templates (persisted to data/templates.json)
    if (pathname === '/api/templates' && req.method === 'GET') {
      return sendJson(res, 200, { templates: listTemplates() });
    }

    if (pathname === '/api/templates' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const saved = saveTemplate(body);
      return sendJson(res, 200, { ok: true, template: saved, templates: listTemplates() });
    }

    if (pathname.startsWith('/api/templates/') && req.method === 'DELETE') {
      const id = decodeURIComponent(pathname.slice('/api/templates/'.length));
      const removed = deleteTemplate(id);
      return sendJson(res, removed ? 200 : 404, { ok: removed, templates: listTemplates() });
    }

    // 5d. API: Price Alerts CRUD (persisted to data/alerts.json)
    if (pathname === '/api/alerts' && req.method === 'GET') {
      return sendJson(res, 200, { alerts: alertManager.list() });
    }

    if (pathname === '/api/alerts' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const created = alertManager.create(body);
      return sendJson(res, 200, { ok: true, alert: created, alerts: alertManager.list() });
    }

    if (pathname.startsWith('/api/alerts/') && req.method === 'PATCH') {
      const id = decodeURIComponent(pathname.slice('/api/alerts/'.length));
      const body = await readJsonBody(req);
      const updated = alertManager.update(id, body);
      return sendJson(res, updated ? 200 : 404, { ok: Boolean(updated), alert: updated, alerts: alertManager.list() });
    }

    if (pathname.startsWith('/api/alerts/') && req.method === 'DELETE') {
      const id = decodeURIComponent(pathname.slice('/api/alerts/'.length));
      const removed = alertManager.remove(id);
      return sendJson(res, removed ? 200 : 404, { ok: removed, alerts: alertManager.list() });
    }

    // 5e. API: Persistent Drawings Store (persisted to data/drawings.json across restarts)
    if (pathname === '/api/drawings' && req.method === 'GET') {
      return sendJson(res, 200, { drawings: readDrawings() });
    }

    if (pathname === '/api/drawings' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      if (typeof body.symbolKey === 'string' && Array.isArray(body.list)) {
        const all = saveSymbolDrawings(body.symbolKey, body.list);
        return sendJson(res, 200, { ok: true, drawings: all });
      }
      if (body.drawings && typeof body.drawings === 'object') {
        const all = saveAllDrawings(body.drawings);
        return sendJson(res, 200, { ok: true, drawings: all });
      }
      return sendJson(res, 400, { error: 'Invalid drawings payload' });
    }

    // 6. API: Multiplexed Server-Sent Events live stream (OANDA + CME + Stocks + Binance/Coinbase/Bybit/Kraken)
    if (pathname === '/api/stream' && req.method === 'GET') {
      const subs = {};
      for (const src of ALL_SOURCES) {
        subs[src] = new Set(
          (url.searchParams.get(src) || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        );
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');

      const clientId = nextClientId++;
      const client = { res, subs };
      clients.set(clientId, client);
      recomputeSubscriptions();

      sendSse(res, 'status', {
        oanda: oandaStream.getStatus(),
        cme: cmePoller.getStatus(),
        crypto: cryptoStream.getStatus(),
        connectedScreens: clients.size,
      });

      for (const sym of subs.oanda) {
        const cached = oandaStream.latestTicks.get(sym);
        if (cached) sendSse(res, 'tick', cached);
      }
      for (const sym of subs.cme) {
        const cached = cmePoller.latestTicks.get(sym);
        if (cached) sendSse(res, 'tick', cached);
      }
      for (const sym of subs.stocks) {
        const cached = cmePoller.latestTicks.get(sym);
        if (cached) sendSse(res, 'tick', { ...cached, source: 'stocks' });
      }
      for (const src of CRYPTO_SOURCES) {
        for (const sym of subs[src]) {
          const cached = cryptoStream.getLatestTick(src, sym);
          if (cached) sendSse(res, 'tick', cached);
        }
      }

      const keepAlive = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          clearInterval(keepAlive);
        }
      }, 20000);

      req.on('close', () => {
        clearInterval(keepAlive);
        clients.delete(clientId);
        recomputeSubscriptions();
        broadcastStatus();
      });
      return;
    }

    // 7. Static frontend files
    let relPath = pathname === '/' ? '/index.html' : pathname;
    const safePath = path.normalize(path.join(PUBLIC_DIR, relPath));
    if (!safePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    return serveFile(res, safePath);
  } catch (err) {
    console.error(`[API Error] ${pathname}:`, err.message);
    return sendJson(res, err.code === 'NO_OANDA_KEY' ? 401 : 500, {
      error: err.message || 'Sunucu hatası',
      code: err.code || 'SERVER_ERROR',
    });
  }
});

export function startServer(options = {}) {
  if (options.dataDir) {
    process.env.LINEPULSE_DATA_DIR = options.dataDir;
  }
  if (options.envPath) {
    process.env.LINEPULSE_ENV_PATH = options.envPath;
  }
  loadConfig();
  alertManager.init();

  const desiredPort =
    typeof options.port === 'number' ? options.port : Number(getConfig().PORT) || 3456;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(desiredPort, '127.0.0.1', () => {
      server.off('error', reject);
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : desiredPort;
      console.log(`LinePulse Trader running at http://127.0.0.1:${actualPort}`);
      fetchOandaInstruments().catch(() => {});
      recomputeSubscriptions();
      resolve({ server, port: actualPort, url: `http://127.0.0.1:${actualPort}` });
    });
  });
}

// Auto-start only when executed directly (`node server/index.js`)
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  startServer().catch((err) => {
    console.error('Failed to start LinePulse server:', err);
    process.exit(1);
  });
}
