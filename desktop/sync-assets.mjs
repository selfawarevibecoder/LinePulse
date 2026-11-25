import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUNDLE_DIR = path.join(__dirname, 'app-bundle');
const SEED_ARCHIVE_PUBLIC = path.join(__dirname, 'seed-archive');
const SEED_ARCHIVE_FULL = path.join(__dirname, 'seed-archive-full');
const IS_PERSONAL = process.argv.includes('--personal') || process.env.LINEPULSE_PERSONAL_BUILD === '1';

fs.rmSync(BUNDLE_DIR, { recursive: true, force: true });
fs.mkdirSync(BUNDLE_DIR, { recursive: true });

fs.cpSync(path.join(ROOT, 'server'), path.join(BUNDLE_DIR, 'server'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public'), path.join(BUNDLE_DIR, 'public'), { recursive: true });

// Public build uses compact 90-day seed-archive/; Personal build uses full offline seed-archive-full/ (if generated)
const seedSrc = IS_PERSONAL && fs.existsSync(SEED_ARCHIVE_FULL) ? SEED_ARCHIVE_FULL : SEED_ARCHIVE_PUBLIC;
if (fs.existsSync(seedSrc)) {
  fs.cpSync(seedSrc, path.join(BUNDLE_DIR, 'seed-archive'), { recursive: true });
}

// Always keep root bundle clean of direct .env / data / node_modules
for (const forbidden of ['.env', 'data', 'node_modules']) {
  const target = path.join(BUNDLE_DIR, forbidden);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

if (IS_PERSONAL) {
  // Personal build ONLY (DO NOT SHARE): pre-seed user's own .env & saved drawings/alerts/sessions
  const personalDir = path.join(BUNDLE_DIR, 'seed-personal');
  fs.mkdirSync(personalDir, { recursive: true });
  const envSrc = path.join(ROOT, '.env');
  if (fs.existsSync(envSrc)) {
    fs.copyFileSync(envSrc, path.join(personalDir, '.env'));
  }
  const personalDataFiles = [
    'drawings.json',
    'alerts.json',
    'layouts.json',
    'templates.json',
    'prop-rules.json',
    'backtest-sessions.json',
  ];
  for (const fn of personalDataFiles) {
    const src = path.join(ROOT, 'data', fn);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(personalDir, fn));
    }
  }
  console.log('[LinePulse Desktop] Synced PERSONAL app-bundle/ (includes personal .env & data — DO NOT SHARE)');
} else {
  console.log('[LinePulse Desktop] Synced clean PUBLIC zero-secret app-bundle/ (with offline seed-archive)');
}
