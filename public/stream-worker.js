/**
 * SharedWorker SSE Multiplexer (OANDA + CME + US Stocks + Binance + Coinbase + Bybit + Kraken)
 * Keeps ONE single EventSource connection shared across ALL open monitor windows.
 */

const SOURCES = ['oanda', 'cme', 'stocks', 'binance', 'coinbase', 'bybit', 'kraken'];

const ports = new Map(); // port -> Record<source, Set<string>>
let eventSource = null;
let lastStreamKey = '';
let lastStatus = null;
const latestTicks = new Map(); // `${source}:${symbol}` -> tick

function emptySubs() {
  const obj = {};
  for (const s of SOURCES) obj[s] = new Set();
  return obj;
}

function recomputeAndConnect() {
  const all = emptySubs();
  for (const sub of ports.values()) {
    for (const src of SOURCES) {
      for (const sym of sub[src] || []) all[src].add(sym);
    }
  }

  const parts = [];
  const qs = new URLSearchParams();
  let hasAny = false;
  for (const src of SOURCES) {
    const arr = Array.from(all[src]).sort();
    parts.push(`${src}:${arr.join(',')}`);
    if (arr.length) {
      qs.set(src, arr.join(','));
      hasAny = true;
    }
  }
  const key = parts.join('|');

  if (key === lastStreamKey && eventSource) {
    broadcastStatus();
    return;
  }
  lastStreamKey = key;

  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (!hasAny) return;

  eventSource = new EventSource(`/api/stream?${qs.toString()}`);

  eventSource.addEventListener('tick', (ev) => {
    let tick;
    try {
      tick = JSON.parse(ev.data);
    } catch {
      return;
    }
    latestTicks.set(`${tick.source}:${tick.symbol}`, tick);
    for (const [port, sub] of ports.entries()) {
      if (sub[tick.source]?.has(tick.symbol)) {
        try {
          port.postMessage({ type: 'tick', tick });
        } catch {
          ports.delete(port);
        }
      }
    }
  });

  eventSource.addEventListener('status', (ev) => {
    try {
      lastStatus = JSON.parse(ev.data);
      broadcastStatus();
    } catch {
      // ignore
    }
  });

  eventSource.addEventListener('alerts_sync', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      for (const port of Array.from(ports.keys())) {
        try {
          port.postMessage({ type: 'alerts_sync', alerts: data.alerts || [] });
        } catch {
          ports.delete(port);
        }
      }
    } catch {
      // ignore
    }
  });

  eventSource.addEventListener('alert_triggered', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      let isPrimary = true;
      for (const port of Array.from(ports.keys())) {
        try {
          port.postMessage({ type: 'alert_triggered', event: data, isPrimary });
          isPrimary = false;
        } catch {
          ports.delete(port);
        }
      }
    } catch {
      // ignore
    }
  });
}

function broadcastStatus() {
  const payload = lastStatus
    ? { ...lastStatus, connectedScreens: ports.size }
    : { oanda: { status: 'idle' }, cme: { status: 'idle' }, crypto: { status: 'idle' }, connectedScreens: ports.size };

  for (const port of Array.from(ports.keys())) {
    try {
      port.postMessage({ type: 'status', status: payload });
    } catch {
      ports.delete(port);
    }
  }
}

self.onconnect = (event) => {
  const port = event.ports[0];
  ports.set(port, emptySubs());

  port.onmessage = (e) => {
    const msg = e.data;
    if (!msg) return;

    if (msg.type === 'subscribe') {
      const sub = emptySubs();
      for (const src of SOURCES) {
        const list = msg.subs?.[src] ?? msg[src] ?? [];
        if (Array.isArray(list)) {
          for (const sym of list) sub[src].add(sym);
        }
      }
      ports.set(port, sub);
      recomputeAndConnect();

      for (const src of SOURCES) {
        for (const sym of sub[src]) {
          const cached = latestTicks.get(`${src}:${sym}`);
          if (cached) port.postMessage({ type: 'tick', tick: cached });
        }
      }
      broadcastStatus();
    } else if (msg.type === 'disconnect') {
      ports.delete(port);
      recomputeAndConnect();
      broadcastStatus();
    }
  };

  port.start();
  broadcastStatus();
};
