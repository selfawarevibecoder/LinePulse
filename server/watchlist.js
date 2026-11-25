import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './env.js';

function getWatchlistFile() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'watchlist.json');
}

export function readWatchlist() {
  const file = getWatchlistFile();
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      items: Array.isArray(parsed.items) ? parsed.items : null,
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveWatchlistData({ items, categories } = {}) {
  const file = getWatchlistFile();
  const prev = readWatchlist() || { items: null, categories: [] };
  const next = {
    items: Array.isArray(items) ? items : prev.items,
    categories: Array.isArray(categories) ? categories : prev.categories,
    updatedAt: Date.now(),
  };
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
