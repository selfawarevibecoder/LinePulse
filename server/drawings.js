import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './env.js';

function getDrawingsFile() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'drawings.json');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ drawings: {} }, null, 2), 'utf8');
  }
  return file;
}

export function readDrawings() {
  const file = getDrawingsFile();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.drawings === 'object' && parsed.drawings !== null
      ? parsed.drawings
      : {};
  } catch {
    return {};
  }
}

export function saveAllDrawings(drawingsMap) {
  if (!drawingsMap || typeof drawingsMap !== 'object') return readDrawings();
  const file = getDrawingsFile();
  fs.writeFileSync(file, JSON.stringify({ drawings: drawingsMap }, null, 2), 'utf8');
  return drawingsMap;
}

export function saveSymbolDrawings(symbolKey, list) {
  const all = readDrawings();
  if (Array.isArray(list) && list.length > 0) {
    all[symbolKey] = list;
  } else {
    delete all[symbolKey];
  }
  saveAllDrawings(all);
  return all;
}
