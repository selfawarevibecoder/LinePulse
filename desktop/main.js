import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, Menu, shell } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_PERSONAL_DEV = process.env.LINEPULSE_PERSONAL_DEV === '1' && !app.isPackaged;

let serverUrl = null;
let serverHandle = null;
let screenCounter = 1;

function resolveServerEntry() {
  if (IS_PERSONAL_DEV) {
    // Personal dev run uses workspace server/ directly
    return path.resolve(__dirname, '..', 'server', 'index.js');
  }
  const bundled = path.join(__dirname, 'app-bundle', 'server', 'index.js');
  if (fs.existsSync(bundled)) return bundled;
  return path.resolve(__dirname, '..', 'server', 'index.js');
}

function createChartWindow(targetUrl, options = {}) {
  const win = new BrowserWindow({
    width: options.width || 1440,
    height: options.height || 900,
    minWidth: 640,
    minHeight: 420,
    backgroundColor: '#0b0e14',
    title: 'Velox Charts',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Intercept "+ New Screen" and Pop-out `window.open` calls to create clean native multi-monitor windows
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (serverUrl && url.startsWith(serverUrl)) {
      const isPop = url.includes('mode=popout');
      createChartWindow(url, {
        width: isPop ? 860 : 1360,
        height: isPop ? 600 : 860,
      });
      return { action: 'deny' };
    }
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  win.loadURL(targetUrl);
  return win;
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Monitor Screen',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            if (!serverUrl) return;
            screenCounter += 1;
            createChartWindow(`${serverUrl}/?screen=${screenCounter}`);
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ role: 'front' }] : [])],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function hydratePersonalSeed(targetDataDir) {
  const seedPersonalDir = path.join(__dirname, 'app-bundle', 'seed-personal');
  if (!fs.existsSync(seedPersonalDir)) return;
  if (!fs.existsSync(targetDataDir)) fs.mkdirSync(targetDataDir, { recursive: true });
  try {
    for (const name of fs.readdirSync(seedPersonalDir)) {
      const src = path.join(seedPersonalDir, name);
      const dest = path.join(targetDataDir, name);
      if (fs.statSync(src).isFile() && !fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
      }
    }
  } catch {
    // non-fatal personal seed copy error
  }
}

function readRemoteServerUrl(userDataDir) {
  if (process.env.VELOX_SERVER_URL) {
    return String(process.env.VELOX_SERVER_URL).trim().replace(/\/+$/, '');
  }
  const candidates = [
    path.join(userDataDir, 'remote-server.json'),
    path.join(path.dirname(path.dirname(userDataDir)), 'linepulse-desktop', 'linepulse-data', 'remote-server.json'),
  ];
  for (const cfgPath of candidates) {
    if (!fs.existsSync(cfgPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (parsed && parsed.enabled !== false && typeof parsed.url === 'string' && parsed.url.trim()) {
        return parsed.url.trim().replace(/\/+$/, '');
      }
    } catch {
      // ignore malformed remote config
    }
  }
  return null;
}

async function isRemoteServerReachable(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const resp = await fetch(`${baseUrl}/api/config`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function bootDesktop() {
  const userDataDir = path.join(app.getPath('userData'), 'linepulse-data');
  const remoteUrl = !IS_PERSONAL_DEV ? readRemoteServerUrl(userDataDir) : null;

  if (remoteUrl) {
    const reachable = await isRemoteServerReachable(remoteUrl);
    if (reachable) {
      // Connect Mac Desktop directly to your private 24/7 Oracle Cloud + Tailscale Velox Charts server!
      serverUrl = remoteUrl;
      buildAppMenu();
      createChartWindow(`${serverUrl}/?screen=1`);
      return;
    }
    console.warn(`[Velox Charts] Remote server unreachable (${remoteUrl}) — falling back to built-in local server.`);
  }

  const entryPath = resolveServerEntry();
  const { startServer } = await import(pathToFileURL(entryPath).href);

  // Use a stable localhost port so Electron localStorage persists across restarts (falls back to random port if busy)
  const preferredPort = IS_PERSONAL_DEV ? 3458 : 3460;
  if (!IS_PERSONAL_DEV) {
    hydratePersonalSeed(userDataDir);
  }
  const baseOpts = IS_PERSONAL_DEV
    ? {
        envPath: path.resolve(__dirname, '..', '.env'),
        dataDir: path.resolve(__dirname, '..', 'data'),
      }
    : {
        dataDir: userDataDir,
      };

  let started;
  try {
    started = await startServer({ ...baseOpts, port: preferredPort });
  } catch {
    started = await startServer({ ...baseOpts, port: 0 });
  }
  serverUrl = started.url;
  serverHandle = started.server;

  buildAppMenu();
  createChartWindow(`${serverUrl}/?screen=1`);
}

app.whenReady().then(() => {
  bootDesktop().catch((err) => {
    console.error('[LinePulse Desktop] Failed to start:', err);
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverUrl) {
      createChartWindow(`${serverUrl}/?screen=1`);
    }
  });
});

app.on('window-all-closed', () => {
  if (serverHandle) {
    try {
      serverHandle.close();
    } catch {
      // ignore
    }
  }
  app.quit();
});
