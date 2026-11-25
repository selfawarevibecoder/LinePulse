/**
 * Zero-Dependency Firebase Cloud Messaging (FCM HTTP v1) Native Push Service
 * - Uses Node's built-in crypto (RS256 JWT) + native fetch — zero external packages!
 * - Reads Firebase Service Account JSON from `data/firebase-service-account.json`
 *   (or `FIREBASE_SERVICE_ACCOUNT_PATH` env var). Never committed to git.
 * - Persists registered Android/iOS device tokens in `data/push-devices.json`.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDataDir } from './env.js';

let cachedAccessToken = null;
let cachedTokenExpMs = 0;

function getDevicesFile() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'push-devices.json');
}

function getServiceAccountPath() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
  }
  return path.join(getDataDir(), 'firebase-service-account.json');
}

function readServiceAccount() {
  const filePath = getServiceAccountPath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function listPushDevices() {
  const file = getDevicesFile();
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed.devices) ? parsed.devices : [];
  } catch {
    return [];
  }
}

function savePushDevices(devices) {
  const file = getDevicesFile();
  fs.writeFileSync(file, JSON.stringify({ devices }, null, 2), 'utf8');
}

export function registerPushDevice({ token, platform = 'android', name = '' } = {}) {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) throw new Error('Device push token is required.');
  const devices = listPushDevices().filter((d) => d.token !== cleanToken);
  const entry = {
    token: cleanToken,
    platform: String(platform || 'android').toLowerCase(),
    name: String(name || '').trim().slice(0, 80) || 'Android Device',
    updatedAt: Date.now(),
  };
  devices.unshift(entry);
  savePushDevices(devices.slice(0, 20));
  return entry;
}

export function unregisterPushDevice(token) {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) return false;
  const prev = listPushDevices();
  const next = prev.filter((d) => d.token !== cleanToken);
  if (next.length === prev.length) return false;
  savePushDevices(next);
  return true;
}

export function getPushStatus() {
  const sa = readServiceAccount();
  const devices = listPushDevices();
  return {
    configured: Boolean(sa),
    projectId: sa?.project_id || null,
    deviceCount: devices.length,
    devices: devices.map((d) => ({
      platform: d.platform,
      name: d.name,
      updatedAt: d.updatedAt,
      tokenSuffix: d.token.slice(-8),
    })),
  };
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getFcmAccessToken(sa) {
  const now = Date.now();
  if (cachedAccessToken && now < cachedTokenExpMs - 60_000) {
    return cachedAccessToken;
  }

  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64Url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp,
    })
  );
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = signer
    .sign(sa.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const assertion = `${unsigned}.${signature}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`FCM OAuth error (${resp.status}): ${txt.slice(0, 180)}`);
  }
  const data = await resp.json();
  cachedAccessToken = data.access_token;
  cachedTokenExpMs = now + (Number(data.expires_in) || 3500) * 1000;
  return cachedAccessToken;
}

export async function sendPushNotification({ title, body, data = {} }) {
  const sa = readServiceAccount();
  const devices = listPushDevices();
  if (!sa || devices.length === 0) {
    return { sent: 0, skipped: true, reason: !sa ? 'fcm_not_configured' : 'no_devices' };
  }

  const accessToken = await getFcmAccessToken(sa);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const stringData = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v !== undefined && v !== null) stringData[k] = String(v);
  }

  let sent = 0;
  const invalidTokens = new Set();

  for (const dev of devices) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: dev.token,
            notification: { title, body },
            data: stringData,
            android: {
              priority: 'high',
              notification: {
                channel_id: 'velox_alerts',
                sound: 'default',
                default_vibrate_timings: true,
                notification_priority: 'PRIORITY_MAX',
              },
            },
          },
        }),
      });
      if (resp.ok) {
        sent += 1;
      } else {
        const errTxt = await resp.text().catch(() => '');
        if (resp.status === 404 || errTxt.includes('UNREGISTERED')) {
          invalidTokens.add(dev.token);
        } else {
          console.error('[FCM Push] Delivery failed:', resp.status, errTxt.slice(0, 180));
        }
      }
    } catch (err) {
      console.error('[FCM Push] Request error:', err.message);
    }
  }

  if (invalidTokens.size > 0) {
    savePushDevices(devices.filter((d) => !invalidTokens.has(d.token)));
  }

  return { sent, total: devices.length, removed: invalidTokens.size };
}

export async function sendAlertPushNotification(event) {
  const al = event?.alert;
  if (!al || al.mobilePush === false) return { sent: 0, skipped: true };
  const arrow = event.direction === 'up' ? '▲' : '▼';
  const title = `🔔 ${al.display || al.symbol} ${arrow} ${al.price}`;
  const body = al.message
    ? `${al.message} (Price: ${event.triggerPrice})`
    : `Price crossed ${al.price} (now ${event.triggerPrice})`;
  return sendPushNotification({
    title,
    body,
    data: {
      type: 'price_alert',
      alertId: al.id,
      source: al.source,
      symbol: al.symbol,
      display: al.display || al.symbol,
      price: String(event.triggerPrice ?? al.price),
    },
  });
}
