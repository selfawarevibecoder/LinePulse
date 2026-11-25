import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDataDir } from './env.js';

function getLayoutsFile() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'layouts.json');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ layouts: [] }, null, 2), 'utf8');
  }
  return file;
}

function readAll() {
  const file = getLayoutsFile();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.layouts) ? parsed.layouts : [];
  } catch {
    return [];
  }
}

function writeAll(layouts) {
  const file = getLayoutsFile();
  fs.writeFileSync(file, JSON.stringify({ layouts }, null, 2), 'utf8');
}

export function listLayouts() {
  return readAll().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function saveLayout({ id, name, snapshot }) {
  const cleanName = String(name || '').trim().slice(0, 80);
  if (!cleanName) {
    throw new Error('Kayıt adı boş olamaz.');
  }
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Geçersiz ekran verisi.');
  }

  const layouts = readAll();
  const now = Date.now();
  const existingIdx = id
    ? layouts.findIndex((l) => l.id === id)
    : layouts.findIndex((l) => l.name.toLowerCase() === cleanName.toLowerCase());

  const panesCount = Array.isArray(snapshot.panes) ? snapshot.panes.length : 0;
  let drawingsCount = 0;
  if (snapshot.drawings && typeof snapshot.drawings === 'object') {
    for (const list of Object.values(snapshot.drawings)) {
      if (Array.isArray(list)) drawingsCount += list.length;
    }
  }

  const entry = {
    id: existingIdx >= 0 ? layouts[existingIdx].id : crypto.randomUUID(),
    name: cleanName,
    updatedAt: now,
    meta: {
      layout: snapshot.layout || '4',
      panesCount,
      drawingsCount,
      symbols: (snapshot.panes || []).slice(0, 6).map((p) => p.display || p.symbol),
    },
    snapshot,
  };

  if (existingIdx >= 0) {
    layouts[existingIdx] = entry;
  } else {
    layouts.unshift(entry);
  }

  writeAll(layouts);
  return entry;
}

export function deleteLayout(id) {
  const layouts = readAll();
  const next = layouts.filter((l) => l.id !== id);
  if (next.length === layouts.length) return false;
  writeAll(next);
  return true;
}
