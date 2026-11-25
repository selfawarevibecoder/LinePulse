import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDataDir } from './env.js';

function getTemplatesFile() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'templates.json');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ templates: [] }, null, 2), 'utf8');
  }
  return file;
}

function readAll() {
  const file = getTemplatesFile();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.templates) ? parsed.templates : [];
  } catch {
    return [];
  }
}

function writeAll(templates) {
  const file = getTemplatesFile();
  fs.writeFileSync(file, JSON.stringify({ templates }, null, 2), 'utf8');
}

export function listTemplates() {
  return readAll().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function saveTemplate({ id, name, style }) {
  const cleanName = String(name || '').trim().slice(0, 60);
  if (!cleanName) {
    throw new Error('Template name cannot be empty.');
  }
  if (!style || typeof style !== 'object') {
    throw new Error('Invalid template style payload.');
  }

  const templates = readAll();
  const now = Date.now();
  const existingIdx = id
    ? templates.findIndex((t) => t.id === id)
    : templates.findIndex((t) => t.name.toLowerCase() === cleanName.toLowerCase());

  const entry = {
    id: existingIdx >= 0 ? templates[existingIdx].id : crypto.randomUUID(),
    name: cleanName,
    updatedAt: now,
    style,
  };

  if (existingIdx >= 0) {
    templates[existingIdx] = entry;
  } else {
    templates.unshift(entry);
  }

  writeAll(templates);
  return entry;
}

export function deleteTemplate(id) {
  const templates = readAll();
  const next = templates.filter((t) => t.id !== id);
  if (next.length === templates.length) return false;
  writeAll(next);
  return true;
}
