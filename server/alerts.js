import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import EventEmitter from 'node:events';
import { getDataDir } from './env.js';

function getAlertsFile() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'alerts.json');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ alerts: [] }, null, 2), 'utf8');
  }
  return file;
}

export class AlertManager extends EventEmitter {
  constructor() {
    super();
    this.alerts = [];
    this.lastPrices = new Map();
  }

  init() {
    this.alerts = this._load();
  }

  _load() {
    const file = getAlertsFile();
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.alerts) ? parsed.alerts : [];
    } catch {
      return [];
    }
  }

  _save() {
    const file = getAlertsFile();
    fs.writeFileSync(file, JSON.stringify({ alerts: this.alerts }, null, 2), 'utf8');
  }

  list() {
    return [...this.alerts].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  getActiveSymbols() {
    const bySource = {
      oanda: new Set(),
      cme: new Set(),
      stocks: new Set(),
      binance: new Set(),
      coinbase: new Set(),
      bybit: new Set(),
      kraken: new Set(),
    };
    for (const a of this.alerts) {
      if (!a.active) continue;
      if (bySource[a.source]) bySource[a.source].add(a.symbol);
    }
    return bySource;
  }

  create(payload) {
    const source = String(payload.source || 'oanda').toLowerCase();
    const symbol = String(payload.symbol || '').trim();
    const price = Number.parseFloat(payload.price);
    const condition = ['crossing_up', 'crossing_down', 'crossing'].includes(payload.condition)
      ? payload.condition
      : 'crossing';

    if (!symbol) throw new Error('Symbol is required.');
    if (!Number.isFinite(price)) throw new Error('Valid target price is required.');

    const alert = {
      id: crypto.randomUUID(),
      source,
      symbol,
      display: String(payload.display || symbol).trim(),
      condition,
      price,
      message: String(payload.message || '').trim().slice(0, 140),
      active: true,
      once: payload.once !== false,
      sound: payload.sound !== false,
      desktopNotify: payload.desktopNotify !== false,
      // Reserved for future Firebase/FCM mobile + desktop app push sync
      mobilePush: payload.mobilePush !== false,
      createdAt: Date.now(),
      triggeredAt: null,
      lastCooldownAt: 0,
    };

    this.alerts.unshift(alert);
    this._save();
    this.emit('changed', this.list());
    return alert;
  }

  update(id, patch) {
    const item = this.alerts.find((a) => a.id === id);
    if (!item) return null;

    if (typeof patch.active === 'boolean') {
      item.active = patch.active;
      if (patch.active) item.triggeredAt = null;
    }
    if (typeof patch.once === 'boolean') item.once = patch.once;
    if (typeof patch.sound === 'boolean') item.sound = patch.sound;
    if (typeof patch.desktopNotify === 'boolean') item.desktopNotify = patch.desktopNotify;
    if (typeof patch.message === 'string') item.message = patch.message.trim().slice(0, 140);
    if (Number.isFinite(Number.parseFloat(patch.price))) {
      item.price = Number.parseFloat(patch.price);
    }
    if (['crossing_up', 'crossing_down', 'crossing'].includes(patch.condition)) {
      item.condition = patch.condition;
    }

    this._save();
    this.emit('changed', this.list());
    return item;
  }

  remove(id) {
    const before = this.alerts.length;
    this.alerts = this.alerts.filter((a) => a.id !== id);
    if (this.alerts.length === before) return false;
    this._save();
    this.emit('changed', this.list());
    return true;
  }

  evaluateTick(tick) {
    if (!tick || !Number.isFinite(tick.price) || tick.quoteOnly) return;
    const key = `${tick.source}:${tick.symbol}`;
    const prev = this.lastPrices.get(key);
    this.lastPrices.set(key, tick.price);

    // Wait until we have a previous price to detect an actual crossing (prevents instant false fire on boot)
    if (!Number.isFinite(prev)) return;
    if (prev === tick.price) return;

    const now = Date.now();
    let dirty = false;

    for (const alert of this.alerts) {
      if (!alert.active) continue;
      if (alert.source !== tick.source || alert.symbol !== tick.symbol) continue;

      // Cooldown 15s for repeating alerts so choppy ticks don't spam
      if (!alert.once && now - (alert.lastCooldownAt || 0) < 15_000) continue;

      const target = alert.price;
      const crossedUp = prev < target && tick.price >= target;
      const crossedDown = prev > target && tick.price <= target;

      let matched = false;
      if (alert.condition === 'crossing_up') matched = crossedUp;
      else if (alert.condition === 'crossing_down') matched = crossedDown;
      else matched = crossedUp || crossedDown;

      if (matched) {
        alert.triggeredAt = now;
        alert.lastCooldownAt = now;
        if (alert.once) {
          alert.active = false;
        }
        dirty = true;
        this.emit('triggered', {
          alert: { ...alert },
          triggerPrice: tick.price,
          direction: crossedUp ? 'up' : 'down',
          triggeredAt: now,
        });
      }
    }

    if (dirty) {
      this._save();
      this.emit('changed', this.list());
    }
  }
}
