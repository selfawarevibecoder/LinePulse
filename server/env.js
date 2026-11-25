import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');

export function getDataDir() {
  return process.env.LINEPULSE_DATA_DIR
    ? path.resolve(process.env.LINEPULSE_DATA_DIR)
    : path.join(ROOT_DIR, 'data');
}

export function getEnvPath() {
  if (process.env.LINEPULSE_ENV_PATH) {
    return path.resolve(process.env.LINEPULSE_ENV_PATH);
  }
  if (process.env.LINEPULSE_DATA_DIR) {
    return path.join(getDataDir(), '.env');
  }
  return path.join(ROOT_DIR, '.env');
}

const DEFAULT_CONFIG = {
  PORT: '3456',
  OANDA_API_KEY: '',
  OANDA_ACCOUNT_ID: '',
  OANDA_ENV: 'practice',
  TWELVEDATA_API_KEY: '',
  DATABENTO_API_KEY: '',
  IBKR_GATEWAY_URL: 'https://127.0.0.1:5000',
  IBKR_ENABLED: 'false',
  DEFAULT_TIMEZONE: 'Europe/Istanbul',
};

let cachedConfig = null;

function parseEnvFile(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

export function loadConfig() {
  const envPath = getEnvPath();
  let fileValues = {};
  if (fs.existsSync(envPath)) {
    fileValues = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
  }
  cachedConfig = {
    ...DEFAULT_CONFIG,
    ...fileValues,
  };
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (process.env[key]) {
      cachedConfig[key] = process.env[key];
    }
  }
  return cachedConfig;
}

export function getConfig() {
  if (!cachedConfig) return loadConfig();
  return cachedConfig;
}

export function saveConfig(updates) {
  const current = { ...getConfig() };
  const allowed = [
    'OANDA_API_KEY',
    'OANDA_ACCOUNT_ID',
    'OANDA_ENV',
    'TWELVEDATA_API_KEY',
    'DATABENTO_API_KEY',
    'IBKR_GATEWAY_URL',
    'IBKR_ENABLED',
    'DEFAULT_TIMEZONE',
  ];

  for (const key of allowed) {
    if (typeof updates[key] === 'string') {
      const trimmed = updates[key].trim();
      // Preserve existing secret if user leaves secret input blank unless explicitly clearing
      if (
        (key === 'OANDA_API_KEY' || key === 'TWELVEDATA_API_KEY' || key === 'DATABENTO_API_KEY') &&
        trimmed === '__KEEP__'
      ) {
        continue;
      }
      current[key] = trimmed;
    }
  }

  if (current.OANDA_ENV !== 'live' && current.OANDA_ENV !== 'practice') {
    current.OANDA_ENV = 'practice';
  }

  const lines = [
    `PORT=${current.PORT}`,
    `OANDA_API_KEY=${current.OANDA_API_KEY}`,
    `OANDA_ACCOUNT_ID=${current.OANDA_ACCOUNT_ID}`,
    `OANDA_ENV=${current.OANDA_ENV}`,
    `TWELVEDATA_API_KEY=${current.TWELVEDATA_API_KEY}`,
    `DATABENTO_API_KEY=${current.DATABENTO_API_KEY}`,
    `IBKR_GATEWAY_URL=${current.IBKR_GATEWAY_URL}`,
    `IBKR_ENABLED=${current.IBKR_ENABLED}`,
    `DEFAULT_TIMEZONE=${current.DEFAULT_TIMEZONE}`,
    '',
  ];
  const envPath = getEnvPath();
  const envDir = path.dirname(envPath);
  if (!fs.existsSync(envDir)) {
    fs.mkdirSync(envDir, { recursive: true });
  }
  fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
  cachedConfig = current;
  return current;
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export function getPublicConfig() {
  const cfg = getConfig();
  return {
    port: Number(cfg.PORT) || 3456,
    hasOandaKey: Boolean(cfg.OANDA_API_KEY && cfg.OANDA_ACCOUNT_ID),
    oandaKeyPreview: maskKey(cfg.OANDA_API_KEY),
    oandaAccountId: cfg.OANDA_ACCOUNT_ID,
    oandaEnv: cfg.OANDA_ENV,
    hasTwelveDataKey: Boolean(cfg.TWELVEDATA_API_KEY),
    twelveDataKeyPreview: maskKey(cfg.TWELVEDATA_API_KEY),
    hasDatabentoKey: Boolean(cfg.DATABENTO_API_KEY),
    databentoKeyPreview: maskKey(cfg.DATABENTO_API_KEY),
    ibkrGatewayUrl: cfg.IBKR_GATEWAY_URL || 'https://127.0.0.1:5000',
    ibkrEnabled: String(cfg.IBKR_ENABLED).toLowerCase() === 'true',
    defaultTimezone: cfg.DEFAULT_TIMEZONE || 'Europe/Istanbul',
  };
}
