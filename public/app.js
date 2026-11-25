import { ChartPane } from './chart-pane.js';
import { ReplayController } from './replay-controller.js';
import { applyDomTranslations, getLang, setLang, t } from './i18n.js';

const ALL_SOURCES = ['oanda', 'cme', 'stocks', 'binance', 'coinbase', 'bybit', 'kraken'];
const CRYPTO_SOURCES = new Set(['binance', 'coinbase', 'bybit', 'kraken']);

const LAYOUT_COUNTS = {
  '1': 1,
  '2h': 2,
  '2v': 2,
  '3': 3,
  '4': 4,
  '6': 6,
  '9': 9,
};

const LAYOUT_LABELS = {
  '1': '1×1',
  '2h': '1×2',
  '2v': '2×1',
  '3': '3',
  '4': '2×2',
  '6': '3×2',
  '9': '3×3',
};

const DEFAULT_PINNED_TFS = ['1m', '3m', '5m', '15m', '1h', '4h'];

const DEFAULT_GRID_SIZES = {
  '1': { cols: [100], rows: [100] },
  '2h': { cols: [50, 50], rows: [100] },
  '2v': { cols: [100], rows: [50, 50] },
  '3': { cols: [57, 43], rows: [50, 50] },
  '4': { cols: [50, 50], rows: [50, 50] },
  '6': { cols: [33.33, 33.33, 33.34], rows: [50, 50] },
  '9': { cols: [33.33, 33.33, 33.34], rows: [33.33, 33.33, 33.34] },
};

const BUILTIN_TIMEFRAMES = ['1s', '5s', '1m', '5m', '15m', '1h', '4h', '12h', '1d', '1w', '1M'];

const TF_UNIT_SEC = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
  M: 2592000,
};

function parseTfString(raw) {
  const cleaned = String(raw || '').trim();
  const match = cleaned.match(/^(\d+)\s*([smhdwMHDWS])$/);
  if (!match) return null;
  const num = Math.max(1, Math.min(Number.parseInt(match[1], 10), 1000));
  const unit = match[2] === 'M' ? 'M' : match[2].toLowerCase();
  return { label: `${num}${unit}`, seconds: num * (TF_UNIT_SEC[unit] || 60) };
}

function tfToSeconds(tf) {
  return parseTfString(tf)?.seconds ?? Number.MAX_SAFE_INTEGER;
}

function sortTimeframes(list) {
  const unique = Array.from(new Set(list.filter((t) => parseTfString(t))));
  return unique.sort((a, b) => tfToSeconds(a) - tfToSeconds(b));
}

const TIMEZONE_OPTIONS = [
  { id: 'Europe/Istanbul', label: 'Istanbul (UTC+3)', short: 'IST (UTC+3)' },
  { id: 'America/New_York', label: 'New York (ET)', short: 'NY (ET)' },
  { id: 'America/Chicago', label: 'Chicago (CME CT)', short: 'CHI (CME)' },
  { id: 'Europe/London', label: 'London (UK)', short: 'LON' },
  { id: 'Europe/Berlin', label: 'Frankfurt (CET)', short: 'FRA' },
  { id: 'Asia/Dubai', label: 'Dubai (GST)', short: 'DXB' },
  { id: 'Asia/Singapore', label: 'Singapore (SGT)', short: 'SGP' },
  { id: 'Asia/Tokyo', label: 'Tokyo (JST)', short: 'TYO' },
  { id: 'Australia/Sydney', label: 'Sydney (AET)', short: 'SYD' },
  { id: 'UTC', label: 'UTC (Coordinated)', short: 'UTC' },
];

const COLOR_PRESETS = {
  'tv-dark': {
    theme: 'dark',
    showGrid: true,
    lineWidth: 2,
    colors: {
      chartBg: '#131722',
      appBg: '#0b0e14',
      gridColor: '#222738',
      textColor: '#8b95ad',
      lineColor: '#2962ff',
      upColor: '#26a69a',
      downColor: '#ef5350',
      drawColor: '#f59e0b',
    },
  },
  'oled-black': {
    theme: 'dark',
    showGrid: true,
    lineWidth: 2,
    colors: {
      chartBg: '#000000',
      appBg: '#000000',
      gridColor: '#1a1d26',
      textColor: '#9ca3af',
      lineColor: '#38bdf8',
      upColor: '#10b981',
      downColor: '#f43f5e',
      drawColor: '#fbbf24',
    },
  },
  midnight: {
    theme: 'dark',
    showGrid: true,
    lineWidth: 2,
    colors: {
      chartBg: '#0f172a',
      appBg: '#090d1a',
      gridColor: '#1e293b',
      textColor: '#94a3b8',
      lineColor: '#60a5fa',
      upColor: '#22c55e',
      downColor: '#ef4444',
      drawColor: '#f97316',
    },
  },
  'classic-light': {
    theme: 'light',
    showGrid: true,
    lineWidth: 2,
    colors: {
      chartBg: '#ffffff',
      appBg: '#e2e8f0',
      gridColor: '#e2e8f0',
      textColor: '#475569',
      lineColor: '#1d4ed8',
      upColor: '#0d9488',
      downColor: '#dc2626',
      drawColor: '#d97706',
    },
  },
  'clean-nogrid': {
    theme: 'dark',
    showGrid: false,
    lineWidth: 2,
    colors: {
      chartBg: '#10141d',
      appBg: '#090c12',
      gridColor: '#1e2433',
      textColor: '#8b95ad',
      lineColor: '#38bdf8',
      upColor: '#22c55e',
      downColor: '#f43f5e',
      drawColor: '#f59e0b',
    },
  },
};

const DEFAULT_PANES = [
  { source: 'oanda', symbol: 'XAU_USD', display: 'XAU/USD', tf: '1m', chartType: 'candle' },
  { source: 'cme', symbol: '@ND.1', display: 'NQ1!', tf: '1m', chartType: 'candle' },
  { source: 'oanda', symbol: 'EUR_USD', display: 'EUR/USD', tf: '1m', chartType: 'candle' },
  { source: 'cme', symbol: '@SP.1', display: 'ES1!', tf: '1m', chartType: 'candle' },
  { source: 'oanda', symbol: 'GBP_USD', display: 'GBP/USD', tf: '5m', chartType: 'candle' },
  { source: 'cme', symbol: '@GC.1', display: 'GC1!', tf: '5m', chartType: 'candle' },
  { source: 'oanda', symbol: 'NAS100_USD', display: 'NAS100', tf: '1m', chartType: 'candle' },
  { source: 'cme', symbol: '@URO.1', display: '6E1!', tf: '5m', chartType: 'candle' },
  { source: 'oanda', symbol: 'USD_CAD', display: 'USD/CAD', tf: '5m', chartType: 'candle' },
];

const DEFAULT_WATCHLIST = [
  { source: 'oanda', symbol: 'XAU_USD', display: 'XAU/USD', name: 'Gold / US Dollar', precision: 2 },
  { source: 'cme', symbol: '.DXY', display: 'DXY', name: 'US Dollar Index Spot (ICE)', precision: 3 },
  { source: 'oanda', symbol: 'EUR_USD', display: 'EUR/USD', name: 'Euro / US Dollar', precision: 5 },
  { source: 'oanda', symbol: 'GBP_USD', display: 'GBP/USD', name: 'British Pound / USD', precision: 5 },
  { source: 'oanda', symbol: 'USD_CAD', display: 'USD/CAD', name: 'US Dollar / CAD', precision: 5 },
  { source: 'oanda', symbol: 'NAS100_USD', display: 'NAS100', name: 'US Nasdaq 100 CFD', precision: 1 },
  { source: 'oanda', symbol: 'EUR_GBP', display: 'EUR/GBP', name: 'Euro / British Pound', precision: 5 },
  { source: 'cme', symbol: '@ND.1', display: 'NQ1!', name: 'E-mini Nasdaq-100 Futures', precision: 2 },
  { source: 'cme', symbol: '@SP.1', display: 'ES1!', name: 'E-mini S&P 500 Futures', precision: 2 },
  { source: 'cme', symbol: '@GC.1', display: 'GC1!', name: 'COMEX Gold Futures', precision: 2 },
  { source: 'cme', symbol: '@URO.1', display: '6E1!', name: 'CME Euro FX Futures', precision: 5 },
  { source: 'cme', symbol: '@CL.1', display: 'CL1!', name: 'NYMEX Crude Oil Futures', precision: 2 },
  { source: 'cme', symbol: '@DJ.1', display: 'YM1!', name: 'CBOT Mini Dow Futures', precision: 1 },
  { source: 'binance', symbol: 'BTCUSDT', display: 'BTC/USDT', name: 'Bitcoin / Tether (Binance)', precision: 2 },
  { source: 'coinbase', symbol: 'ETH-USD', display: 'ETH/USD', name: 'Ethereum / USD (Coinbase)', precision: 2 },
  { source: 'stocks', symbol: 'NVDA', display: 'NVDA', name: 'NVIDIA Corporation', precision: 2 },
];

const DEFAULT_PREFS = {
  theme: 'dark',
  timezone: 'Europe/Istanbul',
  lineWidth: 2,
  showGrid: true,
  syncCrosshair: false,
  magnetMode: false,
  hideAllDrawings: false,
  showNewsOnChart: true,
  colors: { ...COLOR_PRESETS['tv-dark'].colors },
};

// Parse URL params for multi-monitor support
const urlParams = new URLSearchParams(window.location.search);
const isPopout = urlParams.get('mode') === 'popout';
const screenId = urlParams.get('screen') || (isPopout ? `popout-${Date.now()}` : '1');
const storageKey = `linepulse_screen_v2_${screenId}`;

if (isPopout) {
  document.body.classList.add('popout-mode');
}

const syncChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('linepulse-sync') : null;
const windowInstanceId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// App State
let prefs = loadPrefs();
let activeTimeframes = loadTimeframesList();
let pinnedTimeframes = loadPinnedTimeframes();
let watchlist = loadWatchlist();
let watchlistCategories = loadWatchlistCategories();
let activeWatchlistTab = 'all';
let drawingsBySymbol = loadDrawingsStore();
let styleTemplates = loadLocalTemplates();
let alertsList = [];
let newsEvents = [];
let newsRange = 'this_week'; // '1d' | 'this_week' | '1w' | 'this_month'
let newsRegion = 'us_eu'; // 'us_eu' | 'all'
let newsRedOnly = true;
let alertModalContext = null; // { source, symbol, display }
let editingAlertId = null;
let sidebarMode = 'watchlist'; // 'watchlist' | 'layers' | 'news'
let layersScope = 'active'; // 'active' | 'all'
let layerSelection = new Set(); // Set of `${symbolKey}::${drawingId}`
let screenState = loadScreenState();
let panes = new Map();
let activePaneId = null;
let maximizedPaneId = null;
let activeDrawingTool = 'cursor';
let activeDrawingColor = prefs.colors?.drawColor || '#f59e0b';
let latestQuotes = new Map();
let symbolDialogMode = 'pane';
let symbolDialogTargetPaneId = null;
let styleDialogTargetPaneId = null;
let symbolSourceFilter = 'all';
let cachedCatalog = [];
let currentSavedLayoutName = '';
let hasOandaKeyOnServer = true;
let hasSavedScreenInStorage = Boolean(localStorage.getItem(storageKey));

// Stream transport
let sharedWorkerPort = null;
let fallbackEventSource = null;
let lastStreamKey = '';

// Crosshair RAF throttle
let pendingCrosshairTime = undefined;
let crosshairRafId = 0;

// Drag-and-drop watchlist reorder tracking
let draggedWatchlistKey = null;

// DOM References
const screenBadgeEl = document.getElementById('screen-badge');
const chartsGridEl = document.getElementById('charts-grid');
const activeSymbolBtn = document.getElementById('active-symbol-btn');
const activeSourcePill = document.getElementById('active-source-pill');
const activeSymbolLabel = document.getElementById('active-symbol-label');
const topbarCtypeSelect = document.getElementById('topbar-ctype-select');
const globalTfGroup = document.getElementById('global-tf-group');
const tfPopover = document.getElementById('tf-popover');
const tfPopoverGrid = document.getElementById('tf-popover-grid');
const addTfBtn = document.getElementById('add-tf-btn');
const layoutPopover = document.getElementById('layout-popover');
const layoutPickerLabel = document.getElementById('layout-picker-label');
const layoutControls = document.getElementById('layout-controls');
const alertsBtn = document.getElementById('alerts-btn');
const alertCountBadge = document.getElementById('alert-count-badge');
const templatesBtn = document.getElementById('templates-btn');
const layoutsBtn = document.getElementById('layouts-btn');
const toastContainer = document.getElementById('toast-container');
const syncCrosshairBtn = document.getElementById('sync-crosshair-btn');
const newScreenBtn = document.getElementById('new-screen-btn');
const screensPopover = document.getElementById('screens-popover');
const screensPopoverList = document.getElementById('screens-popover-list');
const openNextScreenBtn = document.getElementById('open-next-screen-btn');
const watchlistToggleBtn = document.getElementById('watchlist-toggle-btn');
const watchlistPanel = document.getElementById('watchlist-panel');
const sidebarTabWatchlist = document.getElementById('sidebar-tab-watchlist');
const sidebarTabTrade = document.getElementById('sidebar-tab-trade');
const sidebarTabLayers = document.getElementById('sidebar-tab-layers');
const sidebarTabNews = document.getElementById('sidebar-tab-news');
const sidebarViewWatchlist = document.getElementById('sidebar-view-watchlist');
const sidebarViewTrade = document.getElementById('sidebar-view-trade');
const sidebarViewLayers = document.getElementById('sidebar-view-layers');
const sidebarViewNews = document.getElementById('sidebar-view-news');
const layersCountPill = document.getElementById('layers-count-pill');
const newsCountPill = document.getElementById('news-count-pill');
const newsListEl = document.getElementById('news-list');
const newsRedOnlyBtn = document.getElementById('news-red-only-btn');
const newsOnChartBtn = document.getElementById('news-on-chart-btn');
const layersSelectAllCb = document.getElementById('layers-select-all-cb');
const layersSelectedLabel = document.getElementById('layers-selected-label');
const layersBulkHideBtn = document.getElementById('layers-bulk-hide-btn');
const layersBulkDelBtn = document.getElementById('layers-bulk-del-btn');
const layersListEl = document.getElementById('layers-list');
const watchlistTabsEl = document.getElementById('watchlist-tabs');
const watchlistListEl = document.getElementById('watchlist-list');
const watchlistAddBtn = document.getElementById('watchlist-add-btn');
const watchlistNewCatBtn = document.getElementById('watchlist-new-cat-btn');
const screensCountLabel = document.getElementById('screens-count-label');
const clockTzBtn = document.getElementById('clock-tz-btn');
const liveClockTextEl = document.getElementById('live-clock-text');
const tzBadgeEl = document.getElementById('tz-badge');
const feedStatusBtn = document.getElementById('feed-status-btn');
const oandaDotEl = document.getElementById('oanda-dot');
const cmeDotEl = document.getElementById('cme-dot');
const oandaStatusTextEl = document.getElementById('oanda-status-text');
const cmeStatusTextEl = document.getElementById('cme-status-text');
const settingsBtn = document.getElementById('settings-btn');

// Drawing Toolbar
const drawToolbar = document.getElementById('draw-toolbar');
const drawMagnetBtn = document.getElementById('draw-magnet-btn');
const drawHideAllBtn = document.getElementById('draw-hide-all-btn');
const drawLayersBtn = document.getElementById('draw-layers-btn');
const drawColorInput = document.getElementById('draw-color-input');
const drawColorDot = document.getElementById('draw-color-dot');
const drawUndoBtn = document.getElementById('draw-undo-btn');
const drawClearBtn = document.getElementById('draw-clear-btn');

// Dialogs
const tfDialog = document.getElementById('tf-dialog');
const addTfForm = document.getElementById('add-tf-form');
const tfNewInput = document.getElementById('tf-new-input');
const tfManageChipsEl = document.getElementById('tf-manage-chips');
const tfFeedbackEl = document.getElementById('tf-feedback');
const tfResetBtn = document.getElementById('tf-reset-btn');

const alertsDialog = document.getElementById('alerts-dialog');
const createAlertForm = document.getElementById('create-alert-form');
const alSymbolDisplayEl = document.getElementById('al-symbol-display');
const alConditionEl = document.getElementById('al-condition');
const alPriceEl = document.getElementById('al-price');
const alSubmitBtn = document.getElementById('al-submit-btn');
const alDeleteEditBtn = document.getElementById('al-delete-edit-btn');
const alCancelEditBtn = document.getElementById('al-cancel-edit-btn');
const alMessageEl = document.getElementById('al-message');
const alOnceEl = document.getElementById('al-once');
const alSoundEl = document.getElementById('al-sound');
const alTestSoundBtn = document.getElementById('al-test-sound-btn');
const alEnableNotifyBtn = document.getElementById('al-enable-notify-btn');
const alertsListEl = document.getElementById('alerts-list');

const symbolDialog = document.getElementById('symbol-dialog');
const symbolSearchInput = document.getElementById('symbol-search-input');
const symbolResultsEl = document.getElementById('symbol-results');
const customSourceSelect = document.getElementById('custom-source-select');
const useCustomOpenBtn = document.getElementById('use-custom-open-btn');

const styleDialog = document.getElementById('style-dialog');
const styleTargetLabelEl = document.getElementById('style-target-label');
const styleClearDrawingsBtn = document.getElementById('style-clear-drawings-btn');
const saveTemplateForm = document.getElementById('save-template-form');
const templateNameInput = document.getElementById('template-name-input');
const customTemplatesListEl = document.getElementById('custom-templates-list');
const styleFeedbackEl = document.getElementById('style-feedback');
const styleResetPaneBtn = document.getElementById('style-reset-pane-btn');
const styleApplyOneBtn = document.getElementById('style-apply-one-btn');
const styleApplyAllBtn = document.getElementById('style-apply-all-btn');

const timezoneDialog = document.getElementById('timezone-dialog');
const tzPickerListEl = document.getElementById('tz-picker-list');

const layoutsDialog = document.getElementById('layouts-dialog');
const saveLayoutForm = document.getElementById('save-layout-form');
const layoutNameInput = document.getElementById('layout-name-input');
const savedLayoutsListEl = document.getElementById('saved-layouts-list');
const layoutsFeedbackEl = document.getElementById('layouts-feedback');
const exportJsonBtn = document.getElementById('export-json-btn');
const importJsonInput = document.getElementById('import-json-input');

const promptDialog = document.getElementById('prompt-dialog');
const promptDialogTitle = document.getElementById('prompt-dialog-title');
const promptDialogHint = document.getElementById('prompt-dialog-hint');
const promptDialogInput = document.getElementById('prompt-dialog-input');
const promptForm = document.getElementById('prompt-form');
const promptCancelBtn = document.getElementById('prompt-cancel-btn');

const settingsDialog = document.getElementById('settings-dialog');
const settingsForm = document.getElementById('settings-form');
const settingsCancelBtn = document.getElementById('settings-cancel-btn');
const settingsFeedbackEl = document.getElementById('settings-feedback');

// ============================================================================
// Progressive Enhancement Fallback for <dialog closedby="any">
// ============================================================================
if (!('closedBy' in HTMLDialogElement.prototype)) {
  const outside = (e, dialog) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (e) => {
      pressedOutside = outside(e, dialog);
    });
    dialog.addEventListener('pointerup', (e) => {
      if (pressedOutside && outside(e, dialog)) dialog.close();
    });
  }
}

for (const dialog of [tfDialog, alertsDialog, symbolDialog, styleDialog, timezoneDialog, layoutsDialog, promptDialog, settingsDialog]) {
  dialog.addEventListener('close', () => {
    dialog.returnValue = '';
  });
}

// Reusable Native <dialog> Text Prompt
let promptResolver = null;
const promptAlignRow = document.getElementById('prompt-align-row');
let promptAlignState = null; // null or { hAlign, vAlign }

promptAlignRow?.addEventListener('click', (e) => {
  const hBtn = e.target.closest('[data-prompt-h]');
  const vBtn = e.target.closest('[data-prompt-v]');
  if (!promptAlignState) return;
  if (hBtn) {
    promptAlignState.hAlign = hBtn.dataset.promptH;
    for (const b of promptAlignRow.querySelectorAll('[data-prompt-h]')) {
      b.classList.toggle('active', b === hBtn);
    }
  } else if (vBtn) {
    promptAlignState.vAlign = vBtn.dataset.promptV;
    for (const b of promptAlignRow.querySelectorAll('[data-prompt-v]')) {
      b.classList.toggle('active', b === vBtn);
    }
  }
});

function openTextPrompt(title, defaultValue = '', hint = '', placeholder = '', alignOptions = null) {
  return new Promise((resolve) => {
    promptResolver = resolve;
    promptAlignState = alignOptions
      ? { hAlign: alignOptions.hAlign || 'center', vAlign: alignOptions.vAlign || 'top' }
      : null;
    promptDialogTitle.textContent = title;
    promptDialogHint.textContent = hint;
    promptDialogHint.hidden = !hint;
    promptDialogInput.value = defaultValue;
    promptDialogInput.placeholder = placeholder;
    if (promptAlignRow) {
      promptAlignRow.hidden = !promptAlignState;
      if (promptAlignState) {
        for (const b of promptAlignRow.querySelectorAll('[data-prompt-h]')) {
          b.classList.toggle('active', b.dataset.promptH === promptAlignState.hAlign);
        }
        for (const b of promptAlignRow.querySelectorAll('[data-prompt-v]')) {
          b.classList.toggle('active', b.dataset.promptV === promptAlignState.vAlign);
        }
      }
    }
    promptDialog.showModal();
    requestAnimationFrame(() => {
      promptDialogInput.focus();
      promptDialogInput.select();
    });
  });
}

promptForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = promptDialogInput.value;
  const align = promptAlignState ? { ...promptAlignState } : null;
  const res = promptResolver;
  promptResolver = null;
  promptAlignState = null;
  promptDialog.close('ok');
  if (res) res(align ? { text: val, hAlign: align.hAlign, vAlign: align.vAlign } : val);
});

promptCancelBtn.addEventListener('click', () => {
  const res = promptResolver;
  promptResolver = null;
  promptAlignState = null;
  promptDialog.close('cancel');
  if (res) res(null);
});

promptDialog.addEventListener('cancel', () => {
  const res = promptResolver;
  promptResolver = null;
  promptAlignState = null;
  if (res) res(null);
});

promptDialog.addEventListener('close', () => {
  if (promptResolver) {
    const res = promptResolver;
    promptResolver = null;
    promptAlignState = null;
    res(null);
  }
});

// ============================================================================
// Persistence Helpers
// ============================================================================
function loadPrefs() {
  try {
    const raw = localStorage.getItem('linepulse_prefs_v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_PREFS,
        ...parsed,
        colors: { ...DEFAULT_PREFS.colors, ...(parsed.colors || {}) },
      };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_PREFS, colors: { ...DEFAULT_PREFS.colors } };
}

function savePrefs() {
  localStorage.setItem('linepulse_prefs_v2', JSON.stringify(prefs));
}

function loadLocalTemplates() {
  try {
    const raw = localStorage.getItem('linepulse_templates_v1');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalTemplates() {
  localStorage.setItem('linepulse_templates_v1', JSON.stringify(styleTemplates));
}

function loadTimeframesList() {
  try {
    const rawV2 = localStorage.getItem('linepulse_tf_list_v2');
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return sortTimeframes(parsed);
      }
    }
    // Migrate legacy v1 custom timeframes cleanly into sorted list
    const rawV1 = localStorage.getItem('linepulse_custom_tfs_v1');
    const extra = rawV1 ? JSON.parse(rawV1) : [];
    const merged = [...BUILTIN_TIMEFRAMES, ...(Array.isArray(extra) ? extra : [])];
    return sortTimeframes(merged);
  } catch {
    return sortTimeframes(BUILTIN_TIMEFRAMES);
  }
}

function saveTimeframesList() {
  activeTimeframes = sortTimeframes(activeTimeframes);
  localStorage.setItem('linepulse_tf_list_v2', JSON.stringify(activeTimeframes));
}

function getAllTimeframes() {
  return sortTimeframes(activeTimeframes);
}

function loadPinnedTimeframes() {
  try {
    const raw = localStorage.getItem('linepulse_pinned_tfs_v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return sortTimeframes(parsed);
      }
    }
  } catch {
    // ignore
  }
  return sortTimeframes(DEFAULT_PINNED_TFS);
}

function savePinnedTimeframes() {
  pinnedTimeframes = sortTimeframes(pinnedTimeframes);
  localStorage.setItem('linepulse_pinned_tfs_v1', JSON.stringify(pinnedTimeframes));
}

function loadWatchlist() {
  try {
    const raw = localStorage.getItem('linepulse_watchlist_v1');
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : [...DEFAULT_WATCHLIST];
  } catch {
    return [...DEFAULT_WATCHLIST];
  }
}

function saveWatchlist() {
  localStorage.setItem('linepulse_watchlist_v1', JSON.stringify(watchlist));
}

function loadWatchlistCategories() {
  try {
    const raw = localStorage.getItem('linepulse_wl_cats_v1');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveWatchlistCategories() {
  localStorage.setItem('linepulse_wl_cats_v1', JSON.stringify(watchlistCategories));
}

function loadDrawingsStore() {
  try {
    const raw = localStorage.getItem('linepulse_drawings_v1');
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

let saveDrawingsTimer = null;
function saveDrawingsStore(changedSymbolKey = null) {
  localStorage.setItem('linepulse_drawings_v1', JSON.stringify(drawingsBySymbol));
  // Persist permanently on server (data/drawings.json) so drawings survive restarts/port changes!
  clearTimeout(saveDrawingsTimer);
  saveDrawingsTimer = setTimeout(() => {
    const payload =
      changedSymbolKey && Array.isArray(drawingsBySymbol[changedSymbolKey])
        ? { symbolKey: changedSymbolKey, list: drawingsBySymbol[changedSymbolKey] }
        : { drawings: drawingsBySymbol };
    fetch('/api/drawings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }, 180);
}

async function hydrateDrawingsFromServer() {
  try {
    const res = await fetch('/api/drawings');
    const data = await res.json();
    const serverMap = data?.drawings;
    if (!serverMap || typeof serverMap !== 'object') return;

    let mergedChanged = false;
    // Merge server drawings with any local drawings (union by drawing id)
    for (const [symKey, serverList] of Object.entries(serverMap)) {
      if (!Array.isArray(serverList)) continue;
      const localList = Array.isArray(drawingsBySymbol[symKey]) ? drawingsBySymbol[symKey] : [];
      const seen = new Set(localList.map((d) => d.id));
      for (const item of serverList) {
        if (item && item.id && !seen.has(item.id)) {
          localList.push(item);
          seen.add(item.id);
          mergedChanged = true;
        }
      }
      drawingsBySymbol[symKey] = localList;
    }

    // If local has drawings not yet on server, sync them to server immediately
    const hasLocalOnly = Object.keys(drawingsBySymbol).some(
      (k) => (drawingsBySymbol[k]?.length || 0) > (serverMap[k]?.length || 0)
    );
    if (mergedChanged) {
      localStorage.setItem('linepulse_drawings_v1', JSON.stringify(drawingsBySymbol));
      for (const pane of panes.values()) {
        pane.setDrawings(drawingsBySymbol[pane.symbolKey] || []);
      }
      renderLayersPanel();
    }
    if (hasLocalOnly) {
      saveDrawingsStore();
    }
  } catch {
    // keep localStorage copy
  }
}

function loadScreenState() {
  if (isPopout) {
    const source = urlParams.get('source') || 'oanda';
    const symbol = urlParams.get('symbol') || 'XAU_USD';
    const display = urlParams.get('display') || symbol;
    const tf = urlParams.get('tf') || '1m';
    const chartType = urlParams.get('ctype') || 'candle';
    return {
      layout: '1',
      watchlistOpen: false,
      panes: [{ id: 'p0', source, symbol, display, tf, chartType, styleOverride: null }],
    };
  }

  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.panes) && parsed.panes.length > 0) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }

  if (screenId === '2') {
    return {
      layout: '4',
      watchlistOpen: false,
      panes: [
        { id: 'p0', source: 'cme', symbol: '@ND.1', display: 'NQ1!', tf: '1m', chartType: 'candle' },
        { id: 'p1', source: 'cme', symbol: '@SP.1', display: 'ES1!', tf: '1m', chartType: 'candle' },
        { id: 'p2', source: 'cme', symbol: '@GC.1', display: 'GC1!', tf: '5m', chartType: 'candle' },
        { id: 'p3', source: 'cme', symbol: '@URO.1', display: '6E1!', tf: '5m', chartType: 'candle' },
      ],
    };
  }

  return {
    layout: '4',
    watchlistOpen: true,
    panes: DEFAULT_PANES.slice(0, 4).map((p, idx) => ({ id: `p${idx}`, ...p })),
  };
}

function saveScreenState() {
  if (isPopout || replayCtrl?.active) return;
  const serialized = {
    layout: screenState.layout,
    watchlistOpen: screenState.watchlistOpen,
    watchlistWidth: screenState.watchlistWidth || 248,
    gridSizes: screenState.gridSizes || {},
    panes: screenState.panes.map((p) => {
      const inst = panes.get(p.id);
      return inst ? { id: p.id, ...inst.state } : p;
    }),
  };
  screenState = serialized;
  localStorage.setItem(storageKey, JSON.stringify(serialized));
}

// ============================================================================
// Live Clock & Double-Click Timezone Picker
// ============================================================================
function formatTzShort(tz) {
  const found = TIMEZONE_OPTIONS.find((t) => t.id === tz);
  return found ? found.short : tz;
}

function formatCurrentTimeInTz(tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || 'Europe/Istanbul',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());
  } catch {
    return '--:--:--';
  }
}

function updateLiveClock() {
  if (liveClockTextEl) {
    liveClockTextEl.textContent = formatCurrentTimeInTz(prefs.timezone);
  }
  if (tzBadgeEl) {
    tzBadgeEl.textContent = formatTzShort(prefs.timezone);
  }
}

function openTimezoneDialog() {
  tzPickerListEl.innerHTML = '';
  for (const tz of TIMEZONE_OPTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tz-option-btn ${prefs.timezone === tz.id ? 'active' : ''}`;
    btn.innerHTML = `
      <span>${escapeHtml(tz.label)}</span>
      <span class="tz-option-time">${formatCurrentTimeInTz(tz.id)}</span>
    `;
    btn.addEventListener('click', () => {
      prefs.timezone = tz.id;
      savePrefs();
      applyThemeAndPrefs();
      updateLiveClock();
      if (syncChannel) {
        syncChannel.postMessage({ type: 'prefs', sender: windowInstanceId, prefs });
      }
      timezoneDialog.close();
    });
    tzPickerListEl.appendChild(btn);
  }
  timezoneDialog.showModal();
}

clockTzBtn.addEventListener('dblclick', (e) => {
  e.preventDefault();
  openTimezoneDialog();
});

// ============================================================================
// Theme, Custom Colors & System Color Scheme Listener
// ============================================================================
const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyThemeAndPrefs() {
  const root = document.documentElement;
  root.setAttribute('data-theme', prefs.theme || 'dark');

  const c = prefs.colors || {};
  if (c.appBg) root.style.setProperty('--custom-app-bg', c.appBg);
  else root.style.removeProperty('--custom-app-bg');

  if (c.chartBg) root.style.setProperty('--custom-surface-bg', c.chartBg);
  else root.style.removeProperty('--custom-surface-bg');

  if (c.drawColor) {
    activeDrawingColor = c.drawColor;
    if (drawColorInput) drawColorInput.value = c.drawColor;
    if (drawColorDot) drawColorDot.style.background = c.drawColor;
  }

  syncCrosshairBtn.setAttribute('aria-pressed', String(Boolean(prefs.syncCrosshair)));
  drawMagnetBtn.classList.toggle('active', Boolean(prefs.magnetMode));
  drawMagnetBtn.setAttribute('aria-pressed', String(Boolean(prefs.magnetMode)));
  drawHideAllBtn.classList.toggle('active', Boolean(prefs.hideAllDrawings));
  drawHideAllBtn.setAttribute('aria-pressed', String(Boolean(prefs.hideAllDrawings)));
  updateLiveClock();
  renderNewsPanel();

  requestAnimationFrame(() => {
    for (const pane of panes.values()) {
      pane.applyAppearance(prefs);
      pane.setDrawingTool(activeDrawingTool, activeDrawingColor, Boolean(prefs.magnetMode));
      pane.setHideAllDrawings(Boolean(prefs.hideAllDrawings));
    }
  });
}

darkMediaQuery.addEventListener('change', () => {
  if (prefs.theme === 'system') {
    applyThemeAndPrefs();
  }
});

// ============================================================================
// Chronological Timeframe Bar & Add/Remove Manager
// ============================================================================
function formatTfLabel(tf) {
  return tf === '1d' ? '1D' : tf === '1w' ? '1W' : tf;
}

function renderTimeframeBar() {
  const allTfs = getAllTimeframes();
  const activeTf = panes.get(activePaneId)?.state.tf;

  // Keep topbar compact: show pinned favorites (plus active pane TF if not pinned)
  const pinnedSet = new Set(pinnedTimeframes.filter((t) => allTfs.includes(t)));
  if (pinnedSet.size === 0 && allTfs.length > 0) {
    for (const t of allTfs.slice(0, 5)) pinnedSet.add(t);
  }
  const barTfs = sortTimeframes(
    activeTf && allTfs.includes(activeTf) ? [...pinnedSet, activeTf] : [...pinnedSet]
  );

  globalTfGroup.innerHTML = '';
  for (const tf of barTfs) {
    const isCustom = !BUILTIN_TIMEFRAMES.includes(tf);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tf-btn ${tf === activeTf ? 'active' : ''} ${isCustom ? 'is-custom' : ''}`;
    btn.dataset.tf = tf;
    btn.textContent = formatTfLabel(tf);
    btn.title = `${tf} timeframe (Shift+click: all panes • Right-click: unpin)`;

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (pinnedTimeframes.length <= 1) return;
      pinnedTimeframes = pinnedTimeframes.filter((x) => x !== tf);
      savePinnedTimeframes();
      renderTimeframeBar();
    });

    globalTfGroup.appendChild(btn);
  }

  // Render full timeframe grid inside #tf-popover with star pin/unpin controls
  if (tfPopoverGrid) {
    tfPopoverGrid.innerHTML = '';
    for (const tf of allTfs) {
      const isPinned = pinnedTimeframes.includes(tf);
      const row = document.createElement('div');
      row.className = `tf-pop-row ${tf === activeTf ? 'active' : ''}`;
      row.dataset.tf = tf;

      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'tf-pop-pick';
      pickBtn.textContent = formatTfLabel(tf);
      pickBtn.title = `Switch to ${tf} (Shift+click: all panes)`;
      pickBtn.addEventListener('click', (e) => {
        if (e.shiftKey) {
          for (const inst of panes.values()) inst.setTimeframe(tf);
        } else {
          panes.get(activePaneId)?.setTimeframe(tf);
        }
        saveScreenState();
        renderTimeframeBar();
        updateTopbarFromActive();
        tfPopover?.hidePopover?.();
      });

      const starBtn = document.createElement('button');
      starBtn.type = 'button';
      starBtn.className = `tf-pop-star ${isPinned ? 'pinned' : ''}`;
      starBtn.textContent = isPinned ? '★' : '☆';
      starBtn.title = isPinned ? 'Unpin from topbar' : 'Pin to topbar';
      starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (pinnedTimeframes.includes(tf)) {
          if (pinnedTimeframes.length > 1) {
            pinnedTimeframes = pinnedTimeframes.filter((x) => x !== tf);
          }
        } else {
          pinnedTimeframes.push(tf);
        }
        savePinnedTimeframes();
        renderTimeframeBar();
      });

      row.appendChild(pickBtn);
      row.appendChild(starBtn);
      tfPopoverGrid.appendChild(row);
    }
  }
}

function renderTfManageChips() {
  tfManageChipsEl.innerHTML = '';
  for (const tf of getAllTimeframes()) {
    const chip = document.createElement('span');
    chip.className = 'tf-chip';
    const label = tf === '1d' ? '1D' : tf === '1w' ? '1W' : tf;
    chip.innerHTML = `<span>${escapeHtml(label)}</span><button type="button" class="tf-chip-del" title="Remove ${escapeHtml(label)}" aria-label="Remove ${escapeHtml(label)}">×</button>`;
    chip.querySelector('.tf-chip-del').addEventListener('click', () => {
      if (activeTimeframes.length <= 1) {
        tfFeedbackEl.textContent = 'At least 1 timeframe must remain.';
        return;
      }
      activeTimeframes = activeTimeframes.filter((x) => x !== tf);
      saveTimeframesList();
      renderTimeframeBar();
      syncAllPaneTimeframeLists();
      renderTfManageChips();
      tfFeedbackEl.textContent = `Removed ${label}.`;
    });
    tfManageChipsEl.appendChild(chip);
  }
}

function openTfDialog() {
  tfFeedbackEl.textContent = '';
  tfNewInput.value = '';
  renderTfManageChips();
  tfDialog.showModal();
}

addTfForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const parsed = parseTfString(tfNewInput.value);
  if (!parsed) {
    tfFeedbackEl.textContent = 'Use format like 3m, 10m, 30m, 2h, 6h, 2d.';
    return;
  }
  const normalized = parsed.label;
  if (!activeTimeframes.includes(normalized)) {
    activeTimeframes.push(normalized);
    saveTimeframesList();
  }
  tfNewInput.value = '';
  renderTimeframeBar();
  syncAllPaneTimeframeLists();
  renderTfManageChips();
  tfFeedbackEl.textContent = `Added ${normalized} in chronological order.`;

  const activeInst = panes.get(activePaneId);
  if (activeInst) {
    activeInst.setTimeframe(normalized);
    saveScreenState();
    updateTopbarFromActive();
  }
});

tfResetBtn.addEventListener('click', () => {
  activeTimeframes = sortTimeframes(BUILTIN_TIMEFRAMES);
  saveTimeframesList();
  renderTimeframeBar();
  syncAllPaneTimeframeLists();
  renderTfManageChips();
  tfFeedbackEl.textContent = 'Restored default timeframes.';
});

function syncAllPaneTimeframeLists() {
  const list = getAllTimeframes();
  for (const pane of panes.values()) {
    pane.updateTimeframeOptions(list);
  }
}

// ============================================================================
// Grid Layout, Resizable Splitters & Pane Management
// ============================================================================
function getGridSizesForLayout(layout) {
  const def = DEFAULT_GRID_SIZES[layout] || DEFAULT_GRID_SIZES['4'];
  const saved = screenState.gridSizes?.[layout];
  if (
    saved &&
    Array.isArray(saved.cols) &&
    saved.cols.length === def.cols.length &&
    Array.isArray(saved.rows) &&
    saved.rows.length === def.rows.length
  ) {
    return { cols: [...saved.cols], rows: [...saved.rows] };
  }
  return { cols: [...def.cols], rows: [...def.rows] };
}

function applyGridTrackSizes() {
  const layout = screenState.layout || '4';
  const sizes = getGridSizesForLayout(layout);

  if (maximizedPaneId) {
    chartsGridEl.style.removeProperty('grid-template-columns');
    chartsGridEl.style.removeProperty('grid-template-rows');
  } else {
    chartsGridEl.style.gridTemplateColumns = sizes.cols
      .map((v) => `minmax(0, ${v.toFixed(3)}fr)`)
      .join(' ');
    chartsGridEl.style.gridTemplateRows = sizes.rows
      .map((v) => `minmax(0, ${v.toFixed(3)}fr)`)
      .join(' ');
  }

  positionGridSplitters(layout, sizes);
}

function positionGridSplitters(layout, sizes) {
  const colSplitters = chartsGridEl.querySelectorAll('.grid-splitter-col');
  let cumX = 0;
  colSplitters.forEach((el, idx) => {
    cumX += sizes.cols[idx] || 0;
    el.style.left = `${cumX}%`;
  });

  const rowSplitters = chartsGridEl.querySelectorAll('.grid-splitter-row');
  let cumY = 0;
  rowSplitters.forEach((el, idx) => {
    cumY += sizes.rows[idx] || 0;
    el.style.top = `${cumY}%`;
    if (layout === '3') {
      el.style.left = `${sizes.cols[0]}%`;
      el.style.right = '3px';
    } else {
      el.style.left = '3px';
      el.style.right = '3px';
    }
  });
}

function renderGridSplitters() {
  for (const old of chartsGridEl.querySelectorAll('.grid-splitter')) {
    old.remove();
  }
  const layout = screenState.layout || '4';
  const sizes = getGridSizesForLayout(layout);

  const attachDrag = (el, axis, idx) => {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const cur = getGridSizesForLayout(layout);
      const rect = chartsGridEl.getBoundingClientRect();
      const totalPx = axis === 'col' ? rect.width : rect.height;
      if (totalPx <= 0) return;

      const startPos = axis === 'col' ? e.clientX : e.clientY;
      const arr = axis === 'col' ? cur.cols : cur.rows;
      const startA = arr[idx];
      const startB = arr[idx + 1];
      const pairSum = startA + startB;
      const minTrack = Math.min(14, pairSum * 0.35);

      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      document.body.classList.add(axis === 'col' ? 'resizing-col' : 'resizing-row');

      const onMove = (ev) => {
        const pos = axis === 'col' ? ev.clientX : ev.clientY;
        const deltaPct = ((pos - startPos) / totalPx) * 100;
        const nextA = Math.max(minTrack, Math.min(pairSum - minTrack, startA + deltaPct));
        const nextB = pairSum - nextA;
        arr[idx] = nextA;
        arr[idx + 1] = nextB;

        if (!screenState.gridSizes) screenState.gridSizes = {};
        screenState.gridSizes[layout] = { cols: [...cur.cols], rows: [...cur.rows] };
        applyGridTrackSizes();
      };

      const onUp = () => {
        el.classList.remove('dragging');
        document.body.classList.remove('resizing-col', 'resizing-row');
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        saveScreenState();
      };

      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });

    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (screenState.gridSizes) {
        delete screenState.gridSizes[layout];
      }
      applyGridTrackSizes();
      saveScreenState();
    });
  };

  for (let i = 0; i < sizes.cols.length - 1; i++) {
    const div = document.createElement('div');
    div.className = 'grid-splitter grid-splitter-col';
    div.title = 'Drag to resize column • Double-click to equalize';
    div.dataset.axis = 'col';
    div.dataset.index = String(i);
    attachDrag(div, 'col', i);
    chartsGridEl.appendChild(div);
  }

  for (let j = 0; j < sizes.rows.length - 1; j++) {
    const div = document.createElement('div');
    div.className = 'grid-splitter grid-splitter-row';
    div.title = 'Drag to resize row • Double-click to equalize';
    div.dataset.axis = 'row';
    div.dataset.index = String(j);
    attachDrag(div, 'row', j);
    chartsGridEl.appendChild(div);
  }

  applyGridTrackSizes();
}

function initWatchlistResizer() {
  if (watchlistPanel.querySelector('.watchlist-resizer')) return;
  const handle = document.createElement('div');
  handle.className = 'watchlist-resizer';
  handle.title = 'Drag to resize Watchlist • Double-click to reset';
  watchlistPanel.appendChild(handle);

  if (Number.isFinite(screenState.watchlistWidth) && screenState.watchlistWidth >= 170) {
    watchlistPanel.style.width = `${screenState.watchlistWidth}px`;
  }

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = watchlistPanel.getBoundingClientRect().width;

    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('resizing-col');

    const onMove = (ev) => {
      const nextW = Math.round(Math.max(170, Math.min(480, startW - (ev.clientX - startX))));
      watchlistPanel.style.width = `${nextW}px`;
      screenState.watchlistWidth = nextW;
    };

    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing-col');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      saveScreenState();
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });

  handle.addEventListener('dblclick', () => {
    screenState.watchlistWidth = 248;
    watchlistPanel.style.width = '248px';
    saveScreenState();
  });
}

function renderGrid() {
  const count = LAYOUT_COUNTS[screenState.layout] || 4;
  chartsGridEl.className = `charts-grid layout-${screenState.layout}`;
  if (maximizedPaneId) {
    chartsGridEl.classList.add('has-maximized');
  }

  while (screenState.panes.length < count) {
    const idx = screenState.panes.length;
    const preset = DEFAULT_PANES[idx % DEFAULT_PANES.length];
    screenState.panes.push({ id: `p${idx}`, ...preset });
  }

  const visibleDefs = screenState.panes.slice(0, count);
  const visibleIds = new Set(visibleDefs.map((d) => d.id));

  for (const [id, inst] of panes.entries()) {
    if (!visibleIds.has(id)) {
      inst.destroy();
      panes.delete(id);
      if (maximizedPaneId === id) maximizedPaneId = null;
    }
  }

  const allTfs = getAllTimeframes();

  for (const def of visibleDefs) {
    let inst = panes.get(def.id);
    if (!inst) {
      inst = new ChartPane({
        id: def.id,
        source: def.source,
        symbol: def.symbol,
        display: def.display,
        tf: def.tf,
        chartType: def.chartType || 'candle',
        logScale: Boolean(def.logScale),
        styleOverride: def.styleOverride || null,
        prefs,
        timeframesList: allTfs,
        activeTool: activeDrawingTool,
        drawingColor: activeDrawingColor,
        magnetEnabled: Boolean(prefs.magnetMode),
        hideAllDrawings: Boolean(prefs.hideAllDrawings),
        isPopout,
        callbacks: {
          onActivate: (id) => setActivePane(id),
          onOpenSymbolSearch: (id) => openSymbolDialog('pane', id),
          onNotify: (title, body) => showToast(title, body),
          onOpenStyleDialog: (id) => openStyleDialog(id),
          onOpenTimezonePicker: () => openTimezoneDialog(),
          onOpenSettings: () => openSettingsDialog(),
          onCreateAlertFromLine: (info) => openAlertsDialog(info),
          onUpdateAlert: (id, patch) => updateAlertById(id, patch),
          onDeleteAlert: (id) => deleteAlertById(id),
          onEditAlert: (alert) => openAlertsDialog({ editAlert: alert }),
          onPaneChanged: () => {
            saveScreenState();
            updateTopbarFromActive();
            updateStreamSubscription();
          },
          onPopout: (id) => openPopoutForPane(id),
          onToggleMaximize: (id) => toggleMaximizePane(id),
          onCrosshairMove: (id, time) => handleCrosshairMove(id, time),
          onDrawingsChanged: (symKey, list) => handleDrawingsChanged(symKey, list),
          onDrawingColorChanged: (hex) => {
            if (!hex) return;
            activeDrawingColor = hex;
            prefs.colors = { ...(prefs.colors || {}), drawColor: hex };
            savePrefs();
            for (const pane of panes.values()) {
              pane.drawingColor = hex;
            }
          },
          onDrawingDefaultsChanged: (patch) => {
            if (!patch || typeof patch !== 'object') return;
            prefs.drawingDefaults = { ...(prefs.drawingDefaults || {}), ...patch };
            savePrefs();
            for (const pane of panes.values()) {
              if (pane.prefs) pane.prefs.drawingDefaults = prefs.drawingDefaults;
            }
          },
          onSelectionChanged: (symKey, ids) => handlePaneSelectionChanged(symKey, ids),
          onDrawingFinished: () => setActiveDrawingTool('cursor'),
          onRequestTextInput: (title, current) =>
            openTextPrompt(title, current, '', 'e.g. Support, NY Open, FVG...'),
          onRequestLabelInput: (title, current, alignOpts) =>
            openTextPrompt(title, current, '', 'e.g. Support, NY Open, FVG...', alignOpts),
          onReplayLoadPane: (pane) => replayCtrl?.loadPaneReplayContext(pane, { fitView: true }),
          onReplayModifyOrder: (kind, id, field, newPrice) =>
            replayCtrl?.modifyOrderOnChart(kind, id, field, newPrice),
          onReplayCloseOrClear: (kind, id, field) =>
            replayCtrl?.closeOrClearFromChart(kind, id, field),
          getReplayAccountInfo: () => replayCtrl?.getAccountInfo() || null,
          onExecutePositionTool: (drawing, opts) =>
            replayCtrl?.placeOrderFromPositionTool(drawing, opts),
        },
      });
      panes.set(def.id, inst);
      chartsGridEl.appendChild(inst.el);
      if (replayCtrl?.active && replayCtrl.session) {
        inst.setReplayMode(true);
        inst.state.source = replayCtrl.session.source;
        inst.state.symbol = replayCtrl.session.symbol;
        inst.state.display = replayCtrl.session.display;
        inst._syncHeaderLabels();
        inst.setDrawings(replayCtrl.session.drawings?.[inst.symbolKey] || []);
        inst.loadHistory();
      } else {
        inst.setDrawings(drawingsBySymbol[inst.symbolKey] || []);
        inst.setAlerts(alertsList);
        inst.setNewsEvents(prefs.showNewsOnChart !== false ? getChartNewsEvents() : []);
        inst.loadHistory();
      }
    } else {
      chartsGridEl.appendChild(inst.el);
    }
    inst.setMaximized(maximizedPaneId === def.id);
  }

  for (const btn of layoutControls.querySelectorAll('.layout-opt-btn')) {
    btn.classList.toggle('active', btn.dataset.layout === screenState.layout);
  }
  if (layoutPickerLabel) {
    layoutPickerLabel.textContent = LAYOUT_LABELS[screenState.layout] || '2×2';
  }

  if (!activePaneId || !panes.has(activePaneId)) {
    setActivePane(visibleDefs[0]?.id || null);
  } else {
    setActivePane(activePaneId);
  }

  if (isPopout && visibleDefs[0]) {
    document.title = `${visibleDefs[0].display} — LinePulse`;
  }

  renderGridSplitters();
  renderTimeframeBar();
  updateStreamSubscription();
  saveScreenState();
}

function setActivePane(id) {
  activePaneId = id;
  for (const [paneId, inst] of panes.entries()) {
    inst.setActive(paneId === id);
  }
  updateTopbarFromActive();
  renderWatchlist();
  renderLayersPanel();
}

function updateTopbarFromActive() {
  const inst = panes.get(activePaneId);
  if (!inst) return;
  activeSourcePill.textContent = inst.state.source.toUpperCase();
  activeSourcePill.className = `source-pill ${inst.state.source}`;
  activeSymbolLabel.textContent = inst.state.display;

  if (topbarCtypeSelect) {
    topbarCtypeSelect.value = inst.state.chartType || 'candle';
  }

  // Ensure active pane's timeframe is always visible in the compact topbar strip
  const hasActiveTfOnBar = Boolean(
    globalTfGroup.querySelector(`.tf-btn[data-tf="${CSS.escape(inst.state.tf)}"]`)
  );
  if (!hasActiveTfOnBar) {
    renderTimeframeBar();
  } else {
    for (const btn of globalTfGroup.querySelectorAll('.tf-btn')) {
      btn.classList.toggle('active', btn.dataset.tf === inst.state.tf);
    }
    if (tfPopoverGrid) {
      for (const row of tfPopoverGrid.querySelectorAll('.tf-pop-row')) {
        row.classList.toggle('active', row.dataset.tf === inst.state.tf);
      }
    }
  }
}

function toggleMaximizePane(id) {
  maximizedPaneId = maximizedPaneId === id ? null : id;
  chartsGridEl.classList.toggle('has-maximized', Boolean(maximizedPaneId));
  for (const [paneId, inst] of panes.entries()) {
    inst.setMaximized(paneId === maximizedPaneId);
  }
  applyGridTrackSizes();
}

function openPopoutForPane(id) {
  const inst = panes.get(id);
  if (!inst) return;
  const qs = new URLSearchParams({
    mode: 'popout',
    source: inst.state.source,
    symbol: inst.state.symbol,
    display: inst.state.display,
    tf: inst.state.tf,
    ctype: inst.state.chartType,
  });
  const w = Math.min(960, Math.max(540, window.screen.availWidth * 0.45));
  const h = Math.min(680, Math.max(400, window.screen.availHeight * 0.5));
  window.open(
    `/?${qs.toString()}`,
    `linepulse_popout_${inst.state.symbol}_${Date.now()}`,
    `noopener,width=${Math.round(w)},height=${Math.round(h)},menubar=no,toolbar=no,location=no,status=no`
  );
}

// Live open peer screens tracked via BroadcastChannel: screenId -> { sender, lastSeen }
const openPeerScreens = new Map();

function openScreenById(targetId) {
  const idStr = String(targetId);
  const w = Math.round(Math.min(1440, window.screen.availWidth * 0.85));
  const h = Math.round(Math.min(900, window.screen.availHeight * 0.85));
  window.open(
    `/?screen=${encodeURIComponent(idStr)}`,
    `linepulse_screen_${idStr}_${Date.now()}`,
    `noopener,width=${w},height=${h},menubar=no,toolbar=no,location=no,status=no`
  );
  screensPopover?.hidePopover?.();
}

function getKnownScreens() {
  const now = Date.now();
  for (const [sid, info] of openPeerScreens.entries()) {
    if (now - info.lastSeen > 12_000) openPeerScreens.delete(sid);
  }

  const byId = new Map();
  const ensure = (idStr) => {
    if (!byId.has(idStr)) {
      byId.set(idStr, {
        id: idStr,
        isCurrent: !isPopout && String(screenId) === idStr,
        isOpen: (!isPopout && String(screenId) === idStr) || openPeerScreens.has(idStr),
        saved: false,
        layout: '4',
        symbols: [],
      });
    }
    return byId.get(idStr);
  };

  if (!isPopout) ensure(String(screenId));
  for (const sid of openPeerScreens.keys()) ensure(String(sid));

  const prefix = 'linepulse_screen_v2_';
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    const idStr = key.slice(prefix.length);
    if (!idStr || idStr.startsWith('popout')) continue;
    const entry = ensure(idStr);
    entry.saved = true;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '{}');
      if (parsed.layout) entry.layout = parsed.layout;
      if (Array.isArray(parsed.panes)) {
        const cnt = LAYOUT_COUNTS[parsed.layout] || parsed.panes.length;
        entry.symbols = parsed.panes
          .slice(0, cnt)
          .map((p) => p.display || p.symbol)
          .filter(Boolean);
      }
    } catch {
      // ignore
    }
  }

  // Always keep current window's live layout/symbols up-to-date
  if (!isPopout && byId.has(String(screenId))) {
    const cur = byId.get(String(screenId));
    cur.layout = screenState.layout || '4';
    const cnt = LAYOUT_COUNTS[cur.layout] || 4;
    cur.symbols = screenState.panes
      .slice(0, cnt)
      .map((p) => panes.get(p.id)?.state.display || p.display || p.symbol)
      .filter(Boolean);
  }

  return Array.from(byId.values()).sort((a, b) => {
    const na = Number(a.id);
    const nb = Number(b.id);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.id.localeCompare(b.id);
  });
}

function getNextAvailableScreenId() {
  const used = new Set(getKnownScreens().map((s) => s.id));
  let n = 1;
  while (used.has(String(n))) n += 1;
  return String(n);
}

function renderScreensPopover() {
  if (!screensPopoverList) return;
  const list = getKnownScreens();
  screensPopoverList.innerHTML = '';

  for (const sc of list) {
    const row = document.createElement('div');
    row.className = `screen-pop-row ${sc.isCurrent ? 'is-current' : ''}`;

    const dotClass = sc.isCurrent ? 'current' : sc.isOpen ? 'open' : '';
    const stateLabel = sc.isCurrent ? 'This' : sc.isOpen ? 'Open' : 'Saved';
    const stateClass = sc.isCurrent ? 'current' : sc.isOpen ? 'open' : '';
    const layoutLbl = LAYOUT_LABELS[sc.layout] || sc.layout;
    const symPreview = sc.symbols.length ? `${layoutLbl} · ${sc.symbols.join(', ')}` : layoutLbl;

    row.innerHTML = `
      <div class="screen-pop-info">
        <div class="screen-pop-top">
          <span class="screen-pop-dot ${dotClass}"></span>
          <span>Screen ${escapeHtml(sc.id)}</span>
          <span class="screen-pop-state ${stateClass}">${stateLabel}</span>
        </div>
        <span class="screen-pop-syms">${escapeHtml(symPreview)}</span>
      </div>
      <div class="screen-pop-actions">
        ${
          sc.isCurrent
            ? ''
            : `<button type="button" class="mini-btn screen-open-btn">${sc.isOpen ? 'Reopen' : 'Open'}</button>`
        }
        ${
          !sc.isCurrent && !sc.isOpen && sc.id !== '1'
            ? '<button type="button" class="icon-btn screen-del-btn" title="Delete saved screen" aria-label="Delete">×</button>'
            : ''
        }
      </div>
    `;

    row.querySelector('.screen-open-btn')?.addEventListener('click', () => {
      openScreenById(sc.id);
    });

    row.querySelector('.screen-del-btn')?.addEventListener('click', () => {
      localStorage.removeItem(`linepulse_screen_v2_${sc.id}`);
      renderScreensPopover();
    });

    screensPopoverList.appendChild(row);
  }
}

function openNewScreenWindow() {
  openScreenById(getNextAvailableScreenId());
}

// ============================================================================
// Per-Chart & Global Style + Templates Dialog
// ============================================================================
function readStyleDialogValues() {
  return {
    chartBg: document.getElementById('st-chartBg').value,
    gridColor: document.getElementById('st-gridColor').value,
    textColor: document.getElementById('st-textColor').value,
    lineColor: document.getElementById('st-lineColor').value,
    upColor: document.getElementById('st-upColor').value,
    downColor: document.getElementById('st-downColor').value,
    lineWidth: Number(document.getElementById('st-lineWidth').value) || 2,
    showGrid: document.getElementById('st-showGrid').checked,
  };
}

function populateStyleDialogInputs(s) {
  document.getElementById('st-chartBg').value = s.chartBg || '#131722';
  document.getElementById('st-gridColor').value = s.gridColor || '#222738';
  document.getElementById('st-textColor').value = s.textColor || '#8b95ad';
  document.getElementById('st-lineColor').value = s.lineColor || '#2962ff';
  document.getElementById('st-upColor').value = s.upColor || '#26a69a';
  document.getElementById('st-downColor').value = s.downColor || '#ef5350';
  document.getElementById('st-lineWidth').value = String(s.lineWidth || 2);
  document.getElementById('st-showGrid').checked = s.showGrid !== false;
}

async function openStyleDialog(paneId = null) {
  styleDialogTargetPaneId = paneId || activePaneId;
  const targetPane = panes.get(styleDialogTargetPaneId);
  styleFeedbackEl.textContent = '';
  templateNameInput.value = '';

  styleTargetLabelEl.textContent = targetPane
    ? `Target Chart: ${targetPane.state.display} (${targetPane.state.source.toUpperCase()})`
    : 'Target: Active Chart';

  const cur = targetPane
    ? {
        chartBg: targetPane.state.styleOverride?.chartBg || prefs.colors?.chartBg || '#131722',
        gridColor: targetPane.state.styleOverride?.gridColor || prefs.colors?.gridColor || '#222738',
        textColor: targetPane.state.styleOverride?.textColor || prefs.colors?.textColor || '#8b95ad',
        lineColor: targetPane.state.styleOverride?.lineColor || prefs.colors?.lineColor || '#2962ff',
        upColor: targetPane.state.styleOverride?.upColor || prefs.colors?.upColor || '#26a69a',
        downColor: targetPane.state.styleOverride?.downColor || prefs.colors?.downColor || '#ef5350',
        lineWidth: targetPane.state.styleOverride?.lineWidth ?? prefs.lineWidth ?? 2,
        showGrid:
          typeof targetPane.state.styleOverride?.showGrid === 'boolean'
            ? targetPane.state.styleOverride.showGrid
            : prefs.showGrid !== false,
      }
    : { ...prefs.colors, lineWidth: prefs.lineWidth, showGrid: prefs.showGrid };

  populateStyleDialogInputs(cur);
  renderCustomTemplatesList();
  styleDialog.showModal();

  // Sync latest templates from server
  try {
    const res = await fetch('/api/templates');
    const data = await res.json();
    if (Array.isArray(data.templates)) {
      styleTemplates = data.templates;
      saveLocalTemplates();
      renderCustomTemplatesList();
    }
  } catch {
    // keep local cache
  }
}

function renderCustomTemplatesList() {
  customTemplatesListEl.innerHTML = '';
  if (!styleTemplates.length) {
    customTemplatesListEl.innerHTML =
      '<span class="settings-note">No saved custom templates yet. Pick your colors above and save a template.</span>';
    return;
  }

  for (const tpl of styleTemplates) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tpl-chip';
    chip.title = `Load "${tpl.name}" into editor`;
    chip.innerHTML = `
      <span class="tpl-swatch" style="background:${escapeHtml(tpl.style?.chartBg || '#131722')}"></span>
      <span class="tpl-swatch" style="background:${escapeHtml(tpl.style?.upColor || '#26a69a')}"></span>
      <span class="tpl-swatch" style="background:${escapeHtml(tpl.style?.downColor || '#ef5350')}"></span>
      <span>${escapeHtml(tpl.name)}</span>
      <span class="tpl-del" title="Delete template" aria-label="Delete">×</span>
    `;
    chip.addEventListener('click', async (e) => {
      if (e.target.closest('.tpl-del')) {
        e.stopPropagation();
        styleTemplates = styleTemplates.filter((t) => t.id !== tpl.id);
        saveLocalTemplates();
        renderCustomTemplatesList();
        try {
          await fetch(`/api/templates/${encodeURIComponent(tpl.id)}`, { method: 'DELETE' });
        } catch {
          // ignore
        }
        styleFeedbackEl.textContent = `Deleted "${tpl.name}".`;
        return;
      }
      if (tpl.style) {
        populateStyleDialogInputs(tpl.style);
        styleFeedbackEl.textContent = `Loaded "${tpl.name}" — choose This Chart or All Charts.`;
      }
    });
    customTemplatesListEl.appendChild(chip);
  }
}

for (const btn of styleDialog.querySelectorAll('[data-style-preset]')) {
  btn.addEventListener('click', () => {
    const preset = COLOR_PRESETS[btn.dataset.stylePreset];
    if (!preset) return;
    populateStyleDialogInputs({
      ...preset.colors,
      lineWidth: preset.lineWidth,
      showGrid: preset.showGrid,
    });
    styleFeedbackEl.textContent = `Preset loaded — click Apply to This Chart or All Charts.`;
  });
}

saveTemplateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = templateNameInput.value.trim();
  if (!name) return;
  const style = readStyleDialogValues();

  try {
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, style }),
    });
    const data = await res.json();
    if (res.ok && Array.isArray(data.templates)) {
      styleTemplates = data.templates;
    } else {
      throw new Error('fallback');
    }
  } catch {
    styleTemplates = [
      { id: `tpl-${Date.now()}`, name, updatedAt: Date.now(), style },
      ...styleTemplates.filter((t) => t.name.toLowerCase() !== name.toLowerCase()),
    ];
  }

  saveLocalTemplates();
  renderCustomTemplatesList();
  templateNameInput.value = '';
  styleFeedbackEl.textContent = `Template "${name}" saved!`;
});

styleApplyOneBtn.addEventListener('click', () => {
  const target = panes.get(styleDialogTargetPaneId || activePaneId);
  if (!target) return;
  target.setStyleOverride(readStyleDialogValues());
  saveScreenState();
  styleFeedbackEl.textContent = `Applied to ${target.state.display}.`;
  setTimeout(() => styleDialog.close(), 250);
});

styleApplyAllBtn.addEventListener('click', () => {
  const s = readStyleDialogValues();
  prefs.colors = {
    ...(prefs.colors || {}),
    chartBg: s.chartBg,
    gridColor: s.gridColor,
    textColor: s.textColor,
    lineColor: s.lineColor,
    upColor: s.upColor,
    downColor: s.downColor,
  };
  prefs.lineWidth = s.lineWidth;
  prefs.showGrid = s.showGrid;
  savePrefs();

  // Clear per-pane overrides so ALL charts adopt the unified style cleanly
  for (const pane of panes.values()) {
    pane.setStyleOverride(null);
  }
  applyThemeAndPrefs();
  saveScreenState();
  if (syncChannel) {
    syncChannel.postMessage({ type: 'prefs', sender: windowInstanceId, prefs });
  }
  styleFeedbackEl.textContent = 'Applied to all charts!';
  setTimeout(() => styleDialog.close(), 250);
});

styleResetPaneBtn.addEventListener('click', () => {
  const target = panes.get(styleDialogTargetPaneId || activePaneId);
  if (!target) return;
  target.setStyleOverride(null);
  saveScreenState();
  populateStyleDialogInputs({
    ...prefs.colors,
    lineWidth: prefs.lineWidth,
    showGrid: prefs.showGrid,
  });
  styleFeedbackEl.textContent = 'Chart reset to global style.';
});

styleClearDrawingsBtn.addEventListener('click', () => {
  const target = panes.get(styleDialogTargetPaneId || activePaneId);
  if (!target) return;
  target.clearAllDrawings();
  styleFeedbackEl.textContent = `Cleared drawings on ${target.state.display}.`;
});

// ============================================================================
// Drawing Tools & Cross-Window Drawing Sync
// ============================================================================
function setActiveDrawingTool(tool) {
  activeDrawingTool = tool || 'cursor';
  for (const btn of drawToolbar.querySelectorAll('.draw-btn[data-tool]')) {
    btn.classList.toggle('active', btn.dataset.tool === activeDrawingTool);
  }
  for (const pane of panes.values()) {
    pane.setDrawingTool(activeDrawingTool, activeDrawingColor, Boolean(prefs.magnetMode));
  }
}

function toggleMagnetMode() {
  prefs.magnetMode = !prefs.magnetMode;
  savePrefs();
  drawMagnetBtn.classList.toggle('active', Boolean(prefs.magnetMode));
  drawMagnetBtn.setAttribute('aria-pressed', String(Boolean(prefs.magnetMode)));
  for (const pane of panes.values()) {
    pane.setMagnetEnabled(Boolean(prefs.magnetMode));
  }
  if (syncChannel) {
    syncChannel.postMessage({ type: 'prefs', sender: windowInstanceId, prefs });
  }
}

function toggleHideAllDrawings() {
  prefs.hideAllDrawings = !prefs.hideAllDrawings;
  savePrefs();
  drawHideAllBtn.classList.toggle('active', Boolean(prefs.hideAllDrawings));
  drawHideAllBtn.setAttribute('aria-pressed', String(Boolean(prefs.hideAllDrawings)));
  for (const pane of panes.values()) {
    pane.setHideAllDrawings(Boolean(prefs.hideAllDrawings));
  }
  if (syncChannel) {
    syncChannel.postMessage({ type: 'prefs', sender: windowInstanceId, prefs });
  }
}

function handlePaneSelectionChanged(symbolKey, selectedIds) {
  // Replace selections belonging to this symbolKey with the pane's active selection
  for (const k of Array.from(layerSelection)) {
    if (k.startsWith(`${symbolKey}::`)) layerSelection.delete(k);
  }
  for (const id of selectedIds) {
    layerSelection.add(`${symbolKey}::${id}`);
  }
  renderLayersPanel();
}

function handleDrawingsChanged(symbolKey, list) {
  if (replayCtrl?.active) {
    replayCtrl.handleReplayDrawingsChanged(symbolKey, list);
    renderLayersPanel();
    return;
  }
  drawingsBySymbol[symbolKey] = list;
  saveDrawingsStore(symbolKey);

  for (const pane of panes.values()) {
    if (pane.symbolKey === symbolKey) {
      pane.setDrawings(list);
    }
  }
  if (syncChannel) {
    syncChannel.postMessage({
      type: 'drawings',
      sender: windowInstanceId,
      symbolKey,
      list,
    });
  }
  renderLayersPanel();
}

// ============================================================================
// Layers (Object Tree) Panel — View, Multi-Select, Hide/Show & Bulk Delete
// ============================================================================
const DRAWING_TYPE_LABELS = {
  trend: 'Trend Line',
  arrow: 'Arrow',
  darrow: 'Double Arrow',
  zigzag: 'ZigZag',
  hline: 'Horizontal Line',
  ray: 'Ray',
  vline: 'Vertical Line',
  rect: 'Box / Zone',
  longpos: 'Long Position',
  shortpos: 'Short Position',
  freehand: 'Freehand Brush',
  text: 'Text Note',
};

function setSidebarMode(mode) {
  sidebarMode =
    mode === 'layers'
      ? 'layers'
      : mode === 'news'
      ? 'news'
      : mode === 'trade' && replayCtrl?.active
      ? 'trade'
      : 'watchlist';
  if (!isPopout && !screenState.watchlistOpen && sidebarMode !== 'watchlist') {
    screenState.watchlistOpen = true;
    saveScreenState();
    watchlistPanel.classList.remove('collapsed');
    watchlistToggleBtn.setAttribute('aria-pressed', 'true');
  }
  const isWl = sidebarMode === 'watchlist';
  const isTrade = sidebarMode === 'trade';
  const isLayers = sidebarMode === 'layers';
  const isNews = sidebarMode === 'news';
  sidebarTabWatchlist.classList.toggle('active', isWl);
  sidebarTabWatchlist.setAttribute('aria-selected', String(isWl));
  sidebarTabTrade?.classList.toggle('active', isTrade);
  sidebarTabTrade?.setAttribute('aria-selected', String(isTrade));
  sidebarTabLayers.classList.toggle('active', isLayers);
  sidebarTabLayers.setAttribute('aria-selected', String(isLayers));
  sidebarTabNews?.classList.toggle('active', isNews);
  sidebarTabNews?.setAttribute('aria-selected', String(isNews));
  sidebarViewWatchlist.hidden = !isWl;
  if (sidebarViewTrade) sidebarViewTrade.hidden = !isTrade;
  sidebarViewLayers.hidden = !isLayers;
  if (sidebarViewNews) sidebarViewNews.hidden = !isNews;
  drawLayersBtn.classList.toggle('active', isLayers && screenState.watchlistOpen);
  drawLayersBtn.setAttribute('aria-pressed', String(isLayers && screenState.watchlistOpen));
  if (isLayers) renderLayersPanel();
  if (isNews) renderNewsPanel();
}

function getActiveDrawingsMap() {
  return replayCtrl?.active && replayCtrl.session?.drawings
    ? replayCtrl.session.drawings
    : drawingsBySymbol;
}

function getListedLayerEntries() {
  const entries = [];
  const activePane = panes.get(activePaneId);
  const activeKey = activePane?.symbolKey;
  const store = getActiveDrawingsMap();

  const keys =
    layersScope === 'active'
      ? activeKey
        ? [activeKey]
        : []
      : Object.keys(store);

  for (const symKey of keys) {
    const list = Array.isArray(store[symKey]) ? store[symKey] : [];
    const [src, sym] = symKey.split(':');
    const disp = sym?.replace('_', '/') || symKey;
    for (let i = list.length - 1; i >= 0; i--) {
      entries.push({
        symKey,
        source: src || 'oanda',
        display: disp,
        drawing: list[i],
        compositeKey: `${symKey}::${list[i].id}`,
      });
    }
  }
  return entries;
}

function getTotalDrawingsCount() {
  let total = 0;
  for (const list of Object.values(getActiveDrawingsMap())) {
    if (Array.isArray(list)) total += list.length;
  }
  return total;
}

function syncCanvasSelectionFromLayers(symKey) {
  const idsForSym = [];
  for (const ck of layerSelection) {
    if (ck.startsWith(`${symKey}::`)) {
      idsForSym.push(ck.slice(symKey.length + 2));
    }
  }
  for (const pane of panes.values()) {
    if (pane.symbolKey === symKey) {
      pane.setSelectedDrawingIds(idsForSym);
    }
  }
}

function renderLayersPanel() {
  const totalCount = getTotalDrawingsCount();
  layersCountPill.textContent = String(totalCount);

  if (sidebarMode !== 'layers') return;

  const entries = getListedLayerEntries();
  // Prune stale selection keys
  const validKeys = new Set(entries.map((e) => e.compositeKey));
  for (const ck of Array.from(layerSelection)) {
    if (!validKeys.has(ck)) layerSelection.delete(ck);
  }

  const selectedCount = entries.filter((e) => layerSelection.has(e.compositeKey)).length;
  layersSelectAllCb.checked = entries.length > 0 && selectedCount === entries.length;
  layersSelectAllCb.indeterminate = selectedCount > 0 && selectedCount < entries.length;
  layersSelectedLabel.textContent = selectedCount > 0 ? `${selectedCount} selected` : 'Select All';

  const targetsForHide =
    selectedCount > 0
      ? entries.filter((e) => layerSelection.has(e.compositeKey))
      : entries;
  const allTargetsHidden = targetsForHide.length > 0 && targetsForHide.every((e) => Boolean(e.drawing.hidden));
  layersBulkHideBtn.textContent = allTargetsHidden ? 'Show' : 'Hide';
  layersBulkHideBtn.disabled = entries.length === 0;
  layersBulkDelBtn.disabled = selectedCount === 0;

  layersListEl.innerHTML = '';
  if (entries.length === 0) {
    layersListEl.innerHTML =
      '<div style="padding:20px 10px;text-align:center;color:var(--text-secondary);font-size:12px;">No drawings yet. Use the left toolbar to draw lines, boxes, notes, or freehand sketches.</div>';
    return;
  }

  const eyeOpenSvg = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.8 8s2.4-4 6.2-4 6.2 4 6.2 4-2.4 4-6.2 4-6.2-4-6.2-4z" stroke="currentColor" stroke-width="1.35"/><circle cx="8" cy="8" r="1.9" stroke="currentColor" stroke-width="1.35"/></svg>`;
  const eyeOffSvg = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.2 2.2l11.6 11.6M6.5 4.2A6.5 6.5 0 0 1 8 4c3.8 0 6.2 4 6.2 4a11 11 0 0 1-1.9 2.3M4.2 5.7A11 11 0 0 0 1.8 8s2.4 4 6.2 4c.9 0 1.7-.2 2.4-.6" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/></svg>`;

  for (const entry of entries) {
    const d = entry.drawing;
    const isSel = layerSelection.has(entry.compositeKey);
    const isHidden = Boolean(d.hidden);

    const typeName = DRAWING_TYPE_LABELS[d.type] || d.type;
    const title = d.text ? d.text : typeName;
    const subParts = [typeName];
    if (d.type === 'hline' && Number.isFinite(d.p1?.price)) {
      subParts.push(d.p1.price.toFixed(d.p1.price >= 100 ? 2 : 5));
    } else if ((d.type === 'freehand' || d.type === 'zigzag') && Array.isArray(d.points)) {
      subParts.push(`${d.points.length} pts`);
    }
    if (layersScope === 'all') subParts.unshift(entry.display);

    const row = document.createElement('div');
    row.className = `layer-row ${isSel ? 'selected' : ''} ${isHidden ? 'is-hidden' : ''}`;
    row.dataset.layerKey = entry.compositeKey;
    row.innerHTML = `
      <input type="checkbox" class="layer-cb" ${isSel ? 'checked' : ''} aria-label="Select ${escapeHtml(title)}">
      <span class="layer-color-dot" style="background:${escapeHtml(d.color || '#f59e0b')}"></span>
      <div class="layer-meta">
        <span class="layer-title">${escapeHtml(title)}</span>
        <span class="layer-sub">${escapeHtml(subParts.join(' · '))}</span>
      </div>
      <div class="layer-actions">
        <button type="button" class="icon-btn layer-focus-btn" title="Jump chart to this drawing" aria-label="Locate drawing">◎</button>
        <button type="button" class="icon-btn layer-eye-btn ${isHidden ? 'is-off' : ''}" title="${isHidden ? 'Show drawing' : 'Hide drawing'}" aria-label="${isHidden ? 'Show' : 'Hide'}">${isHidden ? eyeOffSvg : eyeOpenSvg}</button>
        <button type="button" class="icon-btn layer-del-btn" title="Delete drawing" aria-label="Delete">×</button>
      </div>
    `;

    const cb = row.querySelector('.layer-cb');
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      if (cb.checked) layerSelection.add(entry.compositeKey);
      else layerSelection.delete(entry.compositeKey);
      syncCanvasSelectionFromLayers(entry.symKey);
      renderLayersPanel();
    });

    row.addEventListener('click', (e) => {
      if (e.target.closest('button, input')) return;
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        if (layerSelection.has(entry.compositeKey)) layerSelection.delete(entry.compositeKey);
        else layerSelection.add(entry.compositeKey);
      } else {
        layerSelection.clear();
        layerSelection.add(entry.compositeKey);
      }
      syncCanvasSelectionFromLayers(entry.symKey);
      renderLayersPanel();
    });

    const jumpToThisDrawing = async () => {
      const store = getActiveDrawingsMap();
      // Ensure drawing is visible before focusing
      if (d.hidden) {
        d.hidden = false;
        handleDrawingsChanged(entry.symKey, store[entry.symKey] || []);
      }
      let targetPane = Array.from(panes.values()).find((p) => p.symbolKey === entry.symKey);
      if (!targetPane) {
        targetPane = panes.get(activePaneId);
        if (!targetPane) return;
        const [src, sym] = entry.symKey.split(':');
        await targetPane.setSymbol(src, sym, entry.display);
        targetPane.setDrawings(store[entry.symKey] || []);
        targetPane.setAlerts(alertsList);
        saveScreenState();
        updateTopbarFromActive();
        updateStreamSubscription();
      } else {
        setActivePane(targetPane.id);
      }
      await targetPane.focusDrawing(d);
    };

    row.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, input')) return;
      jumpToThisDrawing();
    });

    row.querySelector('.layer-focus-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      jumpToThisDrawing();
    });

    row.querySelector('.layer-eye-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const store = getActiveDrawingsMap();
      const list = store[entry.symKey] || [];
      const target = list.find((x) => x.id === d.id);
      if (!target) return;
      target.hidden = !target.hidden;
      handleDrawingsChanged(entry.symKey, list);
    });

    row.querySelector('.layer-del-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const store = getActiveDrawingsMap();
      const next = (store[entry.symKey] || []).filter((x) => x.id !== d.id);
      layerSelection.delete(entry.compositeKey);
      handleDrawingsChanged(entry.symKey, next);
    });

    layersListEl.appendChild(row);
  }
}

sidebarTabWatchlist.addEventListener('click', () => setSidebarMode('watchlist'));
sidebarTabTrade?.addEventListener('click', () => setSidebarMode('trade'));
sidebarTabLayers.addEventListener('click', () => setSidebarMode('layers'));
sidebarTabNews?.addEventListener('click', () => setSidebarMode('news'));

let livePanesBackup = null;
const replayCtrl = new ReplayController({
  getPanes: () => panes,
  getActivePane: () => panes.get(activePaneId),
  getPrefs: () => prefs,
  showToast: (t, b) => showToast(t, b),
  openTextPrompt: (title, def, hint, placeholder) => openTextPrompt(title, def, hint, placeholder),
  setSidebarMode: (m) => setSidebarMode(m),
  onReplayNewsUpdate: () => renderNewsPanel(),
  onEnterReplay: () => {
    livePanesBackup = Array.from(panes.entries()).map(([id, inst]) => ({
      id,
      source: inst.state.source,
      symbol: inst.state.symbol,
      display: inst.state.display,
      tf: inst.state.tf,
    }));
  },
  onExitReplay: () => {
    if (Array.isArray(livePanesBackup)) {
      for (const snap of livePanesBackup) {
        const inst = panes.get(snap.id);
        if (!inst) continue;
        inst.state.source = snap.source;
        inst.state.symbol = snap.symbol;
        inst.state.display = snap.display;
        inst.state.tf = snap.tf;
        inst.updateTimeframeOptions(inst.timeframesList);
        inst._syncHeaderLabels();
        inst.setDrawings(drawingsBySymbol[inst.symbolKey] || []);
        inst.setAlerts(alertsList);
        inst.setNewsEvents(prefs.showNewsOnChart !== false ? getChartNewsEvents() : []);
        inst.loadHistory();
      }
      livePanesBackup = null;
    } else {
      for (const inst of panes.values()) {
        inst.setDrawings(drawingsBySymbol[inst.symbolKey] || []);
        inst.setAlerts(alertsList);
        inst.setNewsEvents(prefs.showNewsOnChart !== false ? getChartNewsEvents() : []);
        inst.loadHistory();
      }
    }
    updateTopbarFromActive();
    updateStreamSubscription();
    renderLayersPanel();
    renderNewsPanel();
  },
});

// ============================================================================
// Free Economic Calendar News (USD & EUR High-Impact + Chart Flags)
// ============================================================================
const COUNTRY_FLAGS = {
  USD: '🇺🇸',
  EUR: '🇪🇺',
  GBP: '🇬🇧',
  JPY: '🇯🇵',
  CAD: '🇨🇦',
  AUD: '🇦🇺',
  CHF: '🇨🇭',
  NZD: '🇳🇿',
  CNY: '🇨🇳',
};

function getNewsContext() {
  const inReplay = Boolean(replayCtrl?.active && Number.isFinite(replayCtrl?.session?.cursorTime));
  const nowSec = inReplay ? replayCtrl.session.cursorTime : Math.floor(Date.now() / 1000);
  const sourceEvents = inReplay ? replayCtrl.replayNewsEvents || [] : newsEvents;
  return { inReplay, nowSec, sourceEvents };
}

function getFilteredNewsEvents() {
  const { inReplay, nowSec, sourceEvents } = getNewsContext();
  return sourceEvents.filter((ev) => {
    if (newsRegion === 'us_eu' && ev.country !== 'USD' && ev.country !== 'EUR') return false;
    if (newsRedOnly && ev.impact !== 'High') return false;
    if (!newsRedOnly && ev.impact !== 'High' && ev.impact !== 'Medium') return false;
    if (inReplay) {
      if (newsRange === '1d') {
        // Show events on the same simulated UTC day (plus 6h lookahead into next open)
        const dayStart = Math.floor(nowSec / 86400) * 86400;
        return ev.time >= dayStart && ev.time <= dayStart + 86400 + 6 * 3600;
      }
      if (newsRange === 'this_week') {
        const dow = (new Date(nowSec * 1000).getUTCDay() + 6) % 7;
        const mon = Math.floor(nowSec / 86400) * 86400 - dow * 86400;
        return ev.time >= mon && ev.time <= mon + 7 * 86400;
      }
      if (newsRange === '1w') {
        return ev.time >= nowSec - 7 * 86400 && ev.time <= nowSec + 3 * 86400;
      }
    }
    return true;
  });
}

function getChartNewsEvents() {
  const { inReplay, nowSec } = getNewsContext();
  const items = getFilteredNewsEvents();
  if (inReplay) {
    return items.filter((ev) => ev.time >= nowSec - 7 * 86400 && ev.time <= nowSec + 7 * 86400);
  }
  if (newsRange === '1d' || newsRange === 'this_week') {
    const cutoff = nowSec - 36 * 3600;
    return items.filter((ev) => ev.time >= cutoff);
  }
  return items;
}

function pushNewsToCharts() {
  const show = prefs.showNewsOnChart !== false;
  const chartEvents = show ? getChartNewsEvents() : [];
  const { inReplay, nowSec } = getNewsContext();
  for (const pane of panes.values()) {
    if (inReplay) pane.setReplayClock(nowSec);
    pane.setNewsEvents(chartEvents);
  }
}

function formatNewsDateTime(unixSec, tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || 'Europe/Istanbul',
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(unixSec * 1000));
  } catch {
    return '';
  }
}

function formatNewsCountdown(unixSec, refNowSec = Math.floor(Date.now() / 1000)) {
  const diffSec = unixSec - refNowSec;
  const isTr = getLang() === 'tr';
  if (diffSec < -60) return isTr ? 'Açıklandı' : 'Released';
  if (diffSec <= 60) return isTr ? 'ŞİMDİ' : 'LIVE NOW';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return isTr ? `${mins}dk sonra` : `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return isTr ? `${hrs}s ${mins % 60}dk` : `in ${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return isTr ? `${days}g ${hrs % 24}s` : `in ${days}d ${hrs % 24}h`;
}

function renderNewsPanel() {
  const { inReplay, nowSec, sourceEvents } = getNewsContext();
  const isTr = getLang() === 'tr';
  const upcomingRedUsEu = sourceEvents.filter(
    (e) =>
      (e.country === 'USD' || e.country === 'EUR') &&
      e.impact === 'High' &&
      e.time >= nowSec - 300 &&
      (!inReplay || e.time <= nowSec + 7 * 86400)
  ).length;
  if (newsCountPill) {
    newsCountPill.textContent = String(upcomingRedUsEu);
    newsCountPill.hidden = upcomingRedUsEu === 0;
  }

  if (newsRedOnlyBtn) {
    newsRedOnlyBtn.classList.toggle('active', newsRedOnly);
    newsRedOnlyBtn.setAttribute('aria-pressed', String(newsRedOnly));
  }
  if (newsOnChartBtn) {
    const show = prefs.showNewsOnChart !== false;
    newsOnChartBtn.classList.toggle('active', show);
    newsOnChartBtn.setAttribute('aria-pressed', String(show));
  }

  pushNewsToCharts();
  if (!newsListEl || sidebarMode !== 'news') return;

  const items = getFilteredNewsEvents();
  newsListEl.innerHTML = '';

  if (inReplay) {
    const dayStr = new Date(nowSec * 1000).toISOString().slice(0, 10);
    const banner = document.createElement('div');
    banner.style.cssText =
      'padding:6px 8px;margin-bottom:6px;border-radius:6px;background:rgba(139,92,246,0.16);border:1px solid rgba(139,92,246,0.35);color:#c4b5fd;font-size:11px;font-weight:600;text-align:center;';
    banner.textContent = isTr
      ? `📅 Replay Takvimi (${dayStr}) · Gelecek sonuçlar gizli`
      : `📅 Replay Calendar (${dayStr}) · Future actuals hidden`;
    newsListEl.appendChild(banner);
  }

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:18px 10px;text-align:center;color:var(--text-secondary);font-size:12px;';
    empty.innerHTML = isTr
      ? 'Bu aralıkta eşleşen haber yok. Orta etkili haberleri görmek için <b>🔴 Red</b> filtresini kapatabilir veya <b>This Wk</b> seçebilirsiniz.'
      : 'No matching events in this window. Try turning off <b>🔴 Red</b> or switching to <b>This Wk</b>.';
    newsListEl.appendChild(empty);
    return;
  }

  for (const ev of items) {
    const isPast = ev.time < nowSec - 60;
    const isFutureInReplay = inReplay && ev.time > nowSec;
    const isMed = ev.impact !== 'High';
    const card = document.createElement('div');
    card.className = `news-card ${isMed ? 'impact-medium' : 'impact-high'} ${isPast ? 'is-past' : ''}`;
    const flag = COUNTRY_FLAGS[ev.country] || '🌐';
    const timeStr = formatNewsDateTime(ev.time, prefs.timezone);
    const cdStr = formatNewsCountdown(ev.time, nowSec);

    let actualCls = '';
    if (!isFutureInReplay && ev.actualNum !== null && ev.forecastNum !== null) {
      actualCls = ev.actualNum > ev.forecastNum ? 'beat' : ev.actualNum < ev.forecastNum ? 'miss' : '';
    }
    const actualTxt = isFutureInReplay
      ? isTr
        ? 'Bekleniyor'
        : 'Pending'
      : ev.actual || (isPast ? '—' : isTr ? 'Bekleniyor' : 'Pending');

    card.innerHTML = `
      <div class="news-card-top">
        <span class="news-country-badge">
          <span class="news-impact-dot"></span>
          <span>${flag} ${escapeHtml(ev.country)}</span>
        </span>
        <span class="news-countdown">${escapeHtml(cdStr)}</span>
      </div>
      <div class="news-title">${escapeHtml(ev.title)}</div>
      <div class="news-time-label">${escapeHtml(timeStr)}${ev.period ? ` · ${escapeHtml(ev.period)}` : ''}</div>
      <div class="news-metrics">
        <div><span>${isTr ? 'Açıklanan' : 'Actual'}</span><b class="${actualCls}">${escapeHtml(actualTxt)}</b></div>
        <div><span>${isTr ? 'Beklenti' : 'Forecast'}</span><b>${escapeHtml(ev.forecast || '—')}</b></div>
        <div><span>${isTr ? 'Önceki' : 'Previous'}</span><b>${escapeHtml(ev.previous || '—')}</b></div>
      </div>
    `;

    card.addEventListener('click', () => {
      panes.get(activePaneId)?.focusTime(ev.time, ev);
    });

    newsListEl.appendChild(card);
  }
}

async function fetchEconomicNewsFromServer() {
  if (replayCtrl?.active) {
    renderNewsPanel();
    return;
  }
  try {
    const qs = new URLSearchParams({ range: newsRange, region: newsRegion });
    const res = await fetch(`/api/news?${qs.toString()}`);
    const data = await res.json();
    if (Array.isArray(data.events)) {
      newsEvents = data.events;
      renderNewsPanel();
    }
  } catch {
    // ignore
  }
}

for (const rangeBtn of document.querySelectorAll('[data-news-range]')) {
  rangeBtn.addEventListener('click', () => {
    newsRange = rangeBtn.dataset.newsRange;
    for (const b of document.querySelectorAll('[data-news-range]')) {
      b.classList.toggle('active', b === rangeBtn);
    }
    fetchEconomicNewsFromServer();
  });
}

for (const regBtn of document.querySelectorAll('[data-news-region]')) {
  regBtn.addEventListener('click', () => {
    newsRegion = regBtn.dataset.newsRegion;
    for (const b of document.querySelectorAll('[data-news-region]')) {
      b.classList.toggle('active', b === regBtn);
    }
    fetchEconomicNewsFromServer();
  });
}

newsRedOnlyBtn?.addEventListener('click', () => {
  newsRedOnly = !newsRedOnly;
  renderNewsPanel();
});

newsOnChartBtn?.addEventListener('click', () => {
  prefs.showNewsOnChart = prefs.showNewsOnChart === false ? true : false;
  savePrefs();
  renderNewsPanel();
});

for (const scopeBtn of document.querySelectorAll('[data-layer-scope]')) {
  scopeBtn.addEventListener('click', () => {
    layersScope = scopeBtn.dataset.layerScope;
    for (const b of document.querySelectorAll('[data-layer-scope]')) {
      b.classList.toggle('active', b === scopeBtn);
    }
    renderLayersPanel();
  });
}

layersSelectAllCb.addEventListener('change', () => {
  const entries = getListedLayerEntries();
  const touchedSyms = new Set();
  if (layersSelectAllCb.checked) {
    for (const e of entries) {
      layerSelection.add(e.compositeKey);
      touchedSyms.add(e.symKey);
    }
  } else {
    for (const e of entries) {
      layerSelection.delete(e.compositeKey);
      touchedSyms.add(e.symKey);
    }
  }
  for (const symKey of touchedSyms) syncCanvasSelectionFromLayers(symKey);
  renderLayersPanel();
});

layersBulkHideBtn.addEventListener('click', () => {
  const entries = getListedLayerEntries();
  if (!entries.length) return;
  const selected = entries.filter((e) => layerSelection.has(e.compositeKey));
  const targets = selected.length > 0 ? selected : entries;
  const shouldShow = targets.every((e) => Boolean(e.drawing.hidden));

  const store = getActiveDrawingsMap();
  const touchedSyms = new Set();
  for (const t of targets) {
    t.drawing.hidden = !shouldShow;
    touchedSyms.add(t.symKey);
  }
  for (const symKey of touchedSyms) {
    handleDrawingsChanged(symKey, store[symKey] || []);
  }
});

layersBulkDelBtn.addEventListener('click', () => {
  const entries = getListedLayerEntries();
  const selected = entries.filter((e) => layerSelection.has(e.compositeKey));
  if (!selected.length) return;

  const store = getActiveDrawingsMap();
  const bySym = new Map();
  for (const s of selected) {
    if (!bySym.has(s.symKey)) bySym.set(s.symKey, new Set());
    bySym.get(s.symKey).add(s.drawing.id);
    layerSelection.delete(s.compositeKey);
  }
  for (const [symKey, idsToRemove] of bySym.entries()) {
    const next = (store[symKey] || []).filter((d) => !idsToRemove.has(d.id));
    handleDrawingsChanged(symKey, next);
  }
});

drawHideAllBtn.addEventListener('click', toggleHideAllDrawings);

drawLayersBtn.addEventListener('click', () => {
  if (sidebarMode === 'layers' && screenState.watchlistOpen) {
    setSidebarMode('watchlist');
  } else {
    setSidebarMode('layers');
  }
});

drawToolbar.addEventListener('click', (e) => {
  const btn = e.target.closest('.draw-btn[data-tool]');
  if (!btn) return;
  setActiveDrawingTool(btn.dataset.tool);
});

drawMagnetBtn.addEventListener('click', toggleMagnetMode);

const onToolbarDrawColor = () => {
  if (!drawColorInput) return;
  activeDrawingColor = drawColorInput.value;
  if (drawColorDot) drawColorDot.style.background = activeDrawingColor;
  prefs.colors = { ...(prefs.colors || {}), drawColor: activeDrawingColor };
  savePrefs();
  // Also recolor currently selected drawing on active pane if one is selected!
  panes.get(activePaneId)?.recolorSelectedDrawing(activeDrawingColor);
  for (const pane of panes.values()) {
    pane.setDrawingTool(activeDrawingTool, activeDrawingColor, Boolean(prefs.magnetMode));
  }
};
drawColorInput?.addEventListener('input', onToolbarDrawColor);
drawColorInput?.addEventListener('change', onToolbarDrawColor);

drawUndoBtn.addEventListener('click', () => {
  panes.get(activePaneId)?.undoLastDrawing();
});

drawClearBtn.addEventListener('click', () => {
  panes.get(activePaneId)?.clearAllDrawings();
});

// ============================================================================
// Optimized Crosshair Sync (RAF-throttled, opt-in)
// ============================================================================
function handleCrosshairMove(sourcePaneId, unixTime) {
  if (!prefs.syncCrosshair) return;
  pendingCrosshairTime = { sourcePaneId, unixTime };
  if (crosshairRafId) return;

  crosshairRafId = requestAnimationFrame(() => {
    crosshairRafId = 0;
    const payload = pendingCrosshairTime;
    if (!payload) return;
    for (const [paneId, inst] of panes.entries()) {
      if (paneId !== payload.sourcePaneId) {
        inst.setExternalCrosshair(payload.unixTime);
      }
    }
    if (syncChannel) {
      syncChannel.postMessage({
        type: 'crosshair',
        sender: windowInstanceId,
        time: payload.unixTime,
      });
    }
  });
}

if (syncChannel) {
  syncChannel.onmessage = (event) => {
    const msg = event.data;
    if (!msg || msg.sender === windowInstanceId) return;

    if (msg.type === 'crosshair' && prefs.syncCrosshair) {
      for (const inst of panes.values()) {
        inst.setExternalCrosshair(msg.time);
      }
    } else if (msg.type === 'prefs') {
      prefs = {
        ...DEFAULT_PREFS,
        ...msg.prefs,
        colors: { ...DEFAULT_PREFS.colors, ...(msg.prefs?.colors || {}) },
      };
      applyThemeAndPrefs();
    } else if (msg.type === 'watchlist') {
      watchlist = msg.watchlist;
      if (Array.isArray(msg.categories)) watchlistCategories = msg.categories;
      renderWatchlist();
      updateStreamSubscription();
    } else if (msg.type === 'drawings' && msg.symbolKey) {
      drawingsBySymbol[msg.symbolKey] = msg.list || [];
      for (const pane of panes.values()) {
        if (pane.symbolKey === msg.symbolKey) {
          pane.setDrawings(drawingsBySymbol[msg.symbolKey]);
        }
      }
      renderLayersPanel();
    } else if (msg.type === 'screen_ping') {
      if (!isPopout) {
        syncChannel.postMessage({ type: 'screen_here', sender: windowInstanceId, screenId });
      }
    } else if (msg.type === 'screen_hello' || msg.type === 'screen_here') {
      if (msg.screenId && !String(msg.screenId).startsWith('popout')) {
        openPeerScreens.set(String(msg.screenId), { sender: msg.sender, lastSeen: Date.now() });
        if (msg.type === 'screen_hello' && !isPopout) {
          syncChannel.postMessage({ type: 'screen_here', sender: windowInstanceId, screenId });
        }
        if (screensPopover?.matches(':popover-open')) renderScreensPopover();
      }
    } else if (msg.type === 'screen_bye') {
      if (msg.screenId) {
        openPeerScreens.delete(String(msg.screenId));
        if (screensPopover?.matches(':popover-open')) renderScreensPopover();
      }
    }
  };

  if (!isPopout) {
    syncChannel.postMessage({ type: 'screen_hello', sender: windowInstanceId, screenId });
    window.addEventListener('beforeunload', () => {
      try {
        syncChannel.postMessage({ type: 'screen_bye', sender: windowInstanceId, screenId });
      } catch {
        // ignore
      }
    });
  }
}

// ============================================================================
// SharedWorker Multiplexed Live Stream
// ============================================================================
function handleIncomingTick(tick) {
  const qKey = `${tick.source}:${tick.symbol}`;
  latestQuotes.set(qKey, tick);
  for (const inst of panes.values()) {
    inst.applyTick(tick);
  }
  updateWatchlistPriceRow(tick);
}

function initSharedWorker() {
  if (typeof SharedWorker === 'undefined') return false;
  try {
    const worker = new SharedWorker('/stream-worker.js');
    sharedWorkerPort = worker.port;
    sharedWorkerPort.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'tick' && msg.tick) {
        handleIncomingTick(msg.tick);
      } else if (msg.type === 'status' && msg.status) {
        renderFeedStatus(msg.status);
      } else if (msg.type === 'alerts_sync' && Array.isArray(msg.alerts)) {
        syncAlertsState(msg.alerts);
      } else if (msg.type === 'alert_triggered' && msg.event) {
        handleAlertTriggered(msg.event, Boolean(msg.isPrimary));
      }
    };
    sharedWorkerPort.start();
    window.addEventListener('beforeunload', () => {
      try {
        sharedWorkerPort?.postMessage({ type: 'disconnect' });
      } catch {
        // ignore
      }
    });
    return true;
  } catch {
    sharedWorkerPort = null;
    return false;
  }
}

function updateStreamSubscription() {
  const buckets = {};
  for (const src of ALL_SOURCES) buckets[src] = new Set();

  for (const inst of panes.values()) {
    const src = ALL_SOURCES.includes(inst.state.source) ? inst.state.source : 'cme';
    buckets[src].add(inst.state.symbol);
  }

  if (!isPopout && screenState.watchlistOpen) {
    for (const item of getVisibleWatchlistItems()) {
      const src = ALL_SOURCES.includes(item.source) ? item.source : 'cme';
      buckets[src].add(item.symbol);
    }
  }

  const subsArrays = {};
  const keyParts = [];
  for (const src of ALL_SOURCES) {
    const arr = Array.from(buckets[src]).sort();
    subsArrays[src] = arr;
    keyParts.push(`${src}:${arr.join(',')}`);
  }
  const streamKey = keyParts.join('|');

  if (streamKey === lastStreamKey && (sharedWorkerPort || fallbackEventSource)) return;
  lastStreamKey = streamKey;

  if (sharedWorkerPort) {
    sharedWorkerPort.postMessage({
      type: 'subscribe',
      subs: subsArrays,
    });
    return;
  }

  if (fallbackEventSource) {
    fallbackEventSource.close();
    fallbackEventSource = null;
  }
  const qs = new URLSearchParams();
  for (const src of ALL_SOURCES) {
    if (subsArrays[src].length) qs.set(src, subsArrays[src].join(','));
  }

  fallbackEventSource = new EventSource(`/api/stream?${qs.toString()}`);
  fallbackEventSource.addEventListener('tick', (ev) => {
    try {
      handleIncomingTick(JSON.parse(ev.data));
    } catch {
      // ignore
    }
  });
  fallbackEventSource.addEventListener('status', (ev) => {
    try {
      renderFeedStatus(JSON.parse(ev.data));
    } catch {
      // ignore
    }
  });
  fallbackEventSource.addEventListener('alerts_sync', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (Array.isArray(data.alerts)) syncAlertsState(data.alerts);
    } catch {
      // ignore
    }
  });
  fallbackEventSource.addEventListener('alert_triggered', (ev) => {
    try {
      handleAlertTriggered(JSON.parse(ev.data), true);
    } catch {
      // ignore
    }
  });
}

// ============================================================================
// Price Alerts: Web Audio Chime, Desktop OS Notification, Toast & CRUD UI
// ============================================================================
let sharedAudioCtx = null;

function playAlertSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    const now = sharedAudioCtx.currentTime;
    const notes = [880, 1174.66, 1318.51]; // A5 -> D6 -> E6 crisp trading chime
    notes.forEach((freq, i) => {
      const osc = sharedAudioCtx.createOscillator();
      const gain = sharedAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.13);
      gain.gain.setValueAtTime(0.001, now + i * 0.13);
      gain.gain.exponentialRampToValueAtTime(0.22, now + i * 0.13 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.13 + 0.34);
      osc.connect(gain);
      gain.connect(sharedAudioCtx.destination);
      osc.start(now + i * 0.13);
      osc.stop(now + i * 0.13 + 0.36);
    });
  } catch {
    // ignore audio autoplay restriction
  }
}

function updateNotifyButtonLabel() {
  if (!('Notification' in window)) {
    alEnableNotifyBtn.textContent = 'Popups Unsupported';
    alEnableNotifyBtn.disabled = true;
    return;
  }
  if (Notification.permission === 'granted') {
    alEnableNotifyBtn.textContent = 'Desktop Popups: ON';
  } else if (Notification.permission === 'denied') {
    alEnableNotifyBtn.textContent = 'Popups Blocked in Browser';
  } else {
    alEnableNotifyBtn.textContent = 'Enable Desktop Popups';
  }
}

function showToast(title, body) {
  const card = document.createElement('div');
  card.className = 'toast-card';
  card.innerHTML = `
    <div>
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-body">${escapeHtml(body)}</div>
    </div>
    <button type="button" class="icon-btn" aria-label="Dismiss">✕</button>
  `;
  const remove = () => card.remove();
  card.querySelector('button').addEventListener('click', remove);
  toastContainer.appendChild(card);
  setTimeout(remove, 14_000);
}

function handleAlertTriggered(event, isPrimary) {
  const al = event?.alert;
  if (!al) return;
  const dirWord = event.direction === 'up' ? 'crossed UP' : 'crossed DOWN';
  const title = `🔔 Alert: ${al.display} ${dirWord} ${al.price}`;
  const body = al.message
    ? `${al.message} (Live: ${event.triggerPrice})`
    : `Triggered at ${event.triggerPrice}`;

  showToast(title, body);

  if (isPrimary) {
    if (al.sound !== false) playAlertSound();
    if (al.desktopNotify !== false && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, { body, tag: al.id });
      } catch {
        // ignore
      }
    }
  }
}

function syncAlertsState(list) {
  alertsList = Array.isArray(list) ? list : [];
  const activeCount = alertsList.filter((a) => a.active).length;
  alertCountBadge.textContent = String(activeCount);
  alertCountBadge.hidden = activeCount === 0;

  for (const pane of panes.values()) {
    pane.setAlerts(alertsList);
  }
  if (alertsDialog.open) {
    renderAlertsList();
  }
}

async function fetchAlertsFromServer() {
  try {
    const res = await fetch('/api/alerts');
    const data = await res.json();
    if (Array.isArray(data.alerts)) {
      syncAlertsState(data.alerts);
    }
  } catch {
    // ignore
  }
}

async function updateAlertById(id, patch) {
  try {
    const res = await fetch(`/api/alerts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (Array.isArray(data.alerts)) {
      syncAlertsState(data.alerts);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

async function deleteAlertById(id) {
  try {
    const res = await fetch(`/api/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (Array.isArray(data.alerts)) {
      syncAlertsState(data.alerts);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function setAlertFormMode(editAlert = null) {
  editingAlertId = editAlert ? editAlert.id : null;
  if (alSubmitBtn) alSubmitBtn.textContent = editAlert ? 'Save Alert' : 'Create Alert';
  if (alDeleteEditBtn) alDeleteEditBtn.hidden = !editAlert;
  if (alCancelEditBtn) alCancelEditBtn.hidden = !editAlert;
}

async function openAlertsDialog(prefill = null) {
  const activePane = panes.get(activePaneId);
  const editAlert = prefill?.editAlert || null;

  if (editAlert) {
    alertModalContext = {
      source: editAlert.source,
      symbol: editAlert.symbol,
      display: editAlert.display || editAlert.symbol,
    };
    alSymbolDisplayEl.value = `${editAlert.source.toUpperCase()}: ${alertModalContext.display}`;
    alPriceEl.value = Number.isFinite(Number(editAlert.price)) ? String(editAlert.price) : '';
    alConditionEl.value = editAlert.condition || 'crossing';
    alMessageEl.value = editAlert.message || '';
    alOnceEl.checked = editAlert.once !== false;
    alSoundEl.checked = editAlert.sound !== false;
    setAlertFormMode(editAlert);
  } else {
    const src = prefill?.source || activePane?.state.source || 'oanda';
    const sym = prefill?.symbol || activePane?.state.symbol || 'XAU_USD';
    const disp = prefill?.display || activePane?.state.display || sym;
    const curPrice = prefill?.currentPrice ?? activePane?.lastPrice ?? null;
    const targetPrice = prefill?.price ?? curPrice ?? '';

    alertModalContext = { source: src, symbol: sym, display: disp };
    alSymbolDisplayEl.value = `${src.toUpperCase()}: ${disp}`;
    alPriceEl.value = targetPrice !== '' && Number.isFinite(Number(targetPrice)) ? String(targetPrice) : '';
    alMessageEl.value = prefill?.message || '';

    if (Number.isFinite(curPrice) && Number.isFinite(Number(targetPrice)) && Number(targetPrice) !== curPrice) {
      alConditionEl.value = Number(targetPrice) > curPrice ? 'crossing_up' : 'crossing_down';
    } else {
      alConditionEl.value = 'crossing';
    }
    setAlertFormMode(null);
  }

  updateNotifyButtonLabel();
  renderAlertsList();
  alertsDialog.showModal();
  await fetchAlertsFromServer();
}

function renderAlertsList() {
  alertsListEl.innerHTML = '';
  if (!alertsList.length) {
    alertsListEl.innerHTML =
      '<div style="padding:18px;text-align:center;color:var(--text-secondary);font-size:12px;">No alerts yet. Create one above or click <b>🔔 Alert</b> on any horizontal line.</div>';
    return;
  }

  for (const al of alertsList) {
    const card = document.createElement('div');
    card.className = 'saved-layout-card';
    const condLabel =
      al.condition === 'crossing_up'
        ? '≥ Crossing Up'
        : al.condition === 'crossing_down'
        ? '≤ Crossing Down'
        : '◆ Crossing';
    const statusClass = al.active ? 'active' : al.triggeredAt ? 'triggered' : 'paused';
    const statusText = al.active ? 'Active' : al.triggeredAt ? 'Triggered' : 'Paused';

    card.innerHTML = `
      <div class="saved-layout-info">
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="source-pill ${escapeHtml(al.source)}">${escapeHtml(al.source.toUpperCase())}</span>
          <span class="saved-layout-name">${escapeHtml(al.display)} @ ${al.price}</span>
          <span class="alert-badge-status ${statusClass}">${statusText}</span>
        </div>
        <span class="saved-layout-meta">${condLabel} • ${al.once ? 'Once' : 'Repeating'}${al.message ? ` • ${escapeHtml(al.message)}` : ''}</span>
      </div>
      <div class="saved-layout-actions">
        <button type="button" class="btn-secondary edit-al-btn">Edit</button>
        <button type="button" class="btn-secondary toggle-al-btn">${al.active ? 'Pause' : 'Activate'}</button>
        <button type="button" class="btn-danger-sm del-al-btn">Delete</button>
      </div>
    `;

    card.querySelector('.edit-al-btn').addEventListener('click', () => {
      openAlertsDialog({ editAlert: al });
    });

    card.querySelector('.toggle-al-btn').addEventListener('click', async () => {
      await updateAlertById(al.id, { active: !al.active });
    });

    card.querySelector('.del-al-btn').addEventListener('click', async () => {
      if (editingAlertId === al.id) setAlertFormMode(null);
      await deleteAlertById(al.id);
    });

    alertsListEl.appendChild(card);
  }
}

alCancelEditBtn?.addEventListener('click', () => {
  setAlertFormMode(null);
  const activePane = panes.get(activePaneId);
  if (activePane) {
    alertModalContext = {
      source: activePane.state.source,
      symbol: activePane.state.symbol,
      display: activePane.state.display || activePane.state.symbol,
    };
    alSymbolDisplayEl.value = `${alertModalContext.source.toUpperCase()}: ${alertModalContext.display}`;
    alPriceEl.value = Number.isFinite(activePane.lastPrice) ? String(activePane.lastPrice) : '';
    alMessageEl.value = '';
  }
});

alDeleteEditBtn?.addEventListener('click', async () => {
  if (!editingAlertId) return;
  const id = editingAlertId;
  setAlertFormMode(null);
  await deleteAlertById(id);
  alertsDialog.close();
});

createAlertForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!alertModalContext) return;
  const price = Number.parseFloat(alPriceEl.value);
  if (!Number.isFinite(price)) return;

  // Request desktop notification permission on user gesture if not yet asked
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(updateNotifyButtonLabel).catch(() => {});
  }

  if (editingAlertId) {
    const ok = await updateAlertById(editingAlertId, {
      condition: alConditionEl.value,
      price,
      message: alMessageEl.value.trim(),
      once: alOnceEl.checked,
      sound: alSoundEl.checked,
      active: true,
    });
    if (ok) {
      setAlertFormMode(null);
      alertsDialog.close();
    }
    return;
  }

  try {
    const res = await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: alertModalContext.source,
        symbol: alertModalContext.symbol,
        display: alertModalContext.display,
        condition: alConditionEl.value,
        price,
        message: alMessageEl.value.trim(),
        once: alOnceEl.checked,
        sound: alSoundEl.checked,
        desktopNotify: true,
        mobilePush: true,
      }),
    });
    const data = await res.json();
    if (res.ok && Array.isArray(data.alerts)) {
      syncAlertsState(data.alerts);
      alMessageEl.value = '';
    }
  } catch {
    // ignore
  }
});

alTestSoundBtn.addEventListener('click', () => {
  playAlertSound();
  showToast('🔔 Test Alert Sound', 'Alerts will chime and notify your desktop when triggered.');
});

alEnableNotifyBtn.addEventListener('click', async () => {
  if (!('Notification' in window)) return;
  try {
    await Notification.requestPermission();
    updateNotifyButtonLabel();
  } catch {
    // ignore
  }
});

function renderFeedStatus(feeds) {
  if (!feeds) return;
  const oStatus = feeds.oanda?.status || 'idle';
  const cStatus = feeds.cme?.status || 'idle';

  oandaDotEl.className = `status-dot ${oStatus === 'live' ? 'live' : oStatus === 'error' || oStatus === 'no_key' ? 'error' : ''}`;
  oandaStatusTextEl.textContent = oStatus === 'live' ? 'OANDA LIVE' : oStatus === 'no_key' ? 'OANDA NO KEY' : 'OANDA';

  cmeDotEl.className = `status-dot ${cStatus === 'delayed' ? 'delayed' : cStatus === 'live' ? 'live' : cStatus === 'error' ? 'error' : ''}`;
  cmeStatusTextEl.textContent = cStatus === 'delayed' ? 'CME FREE' : cStatus === 'live' ? 'CME LIVE' : 'CME';

  const screens = feeds.connectedScreens || 1;
  screensCountLabel.textContent = screens === 1 ? '1 screen' : `${screens} screens`;
}

// ============================================================================
// Watchlist with Drag-to-Reorder, Scroll & Arrow-Key Stepping
// ============================================================================
function getVisibleWatchlistItems() {
  if (activeWatchlistTab === 'all') return watchlist;
  if (activeWatchlistTab === 'oanda') return watchlist.filter((w) => w.source === 'oanda');
  if (activeWatchlistTab === 'cme') return watchlist.filter((w) => w.source === 'cme');
  if (activeWatchlistTab === 'crypto') return watchlist.filter((w) => CRYPTO_SOURCES.has(w.source));
  if (activeWatchlistTab === 'stocks') return watchlist.filter((w) => w.source === 'stocks');
  const cat = watchlistCategories.find((c) => c.id === activeWatchlistTab);
  return cat ? cat.items : watchlist;
}

function reorderWatchlistArray(arr, fromKey, toKey, placeAfter) {
  const fromIdx = arr.findIndex((w) => `${w.source}:${w.symbol}` === fromKey);
  const toIdx = arr.findIndex((w) => `${w.source}:${w.symbol}` === toKey);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return false;
  const [moved] = arr.splice(fromIdx, 1);
  let insertIdx = arr.findIndex((w) => `${w.source}:${w.symbol}` === toKey);
  if (placeAfter) insertIdx += 1;
  arr.splice(insertIdx, 0, moved);
  return true;
}

function selectWatchlistItem(item) {
  const target = panes.get(activePaneId);
  if (!target || !item) return;
  target.setSymbol(item.source, item.symbol, item.display);
  target.setDrawings(drawingsBySymbol[target.symbolKey] || []);
  target.setAlerts(alertsList);
  saveScreenState();
  updateTopbarFromActive();
  updateStreamSubscription();
  renderWatchlist();

  // Keep selected row smoothly visible when stepping with ArrowUp/ArrowDown
  const key = `${item.source}:${item.symbol}`;
  const rowEl = watchlistListEl.querySelector(`[data-wkey="${CSS.escape(key)}"]`);
  rowEl?.scrollIntoView({ block: 'nearest' });
}

function stepWatchlistSelection(delta) {
  const items = getVisibleWatchlistItems();
  if (!items.length) return;
  const activeInst = panes.get(activePaneId);
  let curIdx = activeInst
    ? items.findIndex((w) => w.source === activeInst.state.source && w.symbol === activeInst.state.symbol)
    : -1;
  if (curIdx === -1) {
    curIdx = delta > 0 ? 0 : items.length - 1;
  } else {
    curIdx = (curIdx + delta + items.length) % items.length;
  }
  selectWatchlistItem(items[curIdx]);
}

function renderWatchlistTabs() {
  watchlistTabsEl.innerHTML = '';

  const builtIns = [
    { id: 'all', name: 'All' },
    { id: 'oanda', name: 'OANDA' },
    { id: 'cme', name: 'CME' },
    { id: 'crypto', name: 'Crypto' },
    { id: 'stocks', name: 'Stocks' },
  ];

  for (const tab of builtIns) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `wtab ${activeWatchlistTab === tab.id ? 'active' : ''}`;
    btn.textContent = tab.name;
    btn.addEventListener('click', () => {
      activeWatchlistTab = tab.id;
      renderWatchlist();
      updateStreamSubscription();
    });
    watchlistTabsEl.appendChild(btn);
  }

  for (const cat of watchlistCategories) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `wtab ${activeWatchlistTab === cat.id ? 'active' : ''}`;
    btn.innerHTML = `<span>${escapeHtml(cat.name)}</span><span class="wtab-del" title="Delete category" aria-label="Delete">×</span>`;
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.wtab-del')) {
        e.stopPropagation();
        watchlistCategories = watchlistCategories.filter((c) => c.id !== cat.id);
        if (activeWatchlistTab === cat.id) activeWatchlistTab = 'all';
        saveWatchlistCategories();
        broadcastWatchlist();
        renderWatchlist();
        return;
      }
      activeWatchlistTab = cat.id;
      renderWatchlist();
      updateStreamSubscription();
    });
    watchlistTabsEl.appendChild(btn);
  }
}

function renderWatchlist() {
  watchlistPanel.classList.toggle('collapsed', isPopout || !screenState.watchlistOpen);
  watchlistToggleBtn.setAttribute('aria-pressed', String(!isPopout && screenState.watchlistOpen));

  renderWatchlistTabs();

  const activeInst = panes.get(activePaneId);
  const items = getVisibleWatchlistItems();

  watchlistListEl.innerHTML = '';
  if (items.length === 0) {
    watchlistListEl.innerHTML =
      '<div style="padding:18px 10px;text-align:center;color:var(--text-secondary);font-size:12px;">No symbols in this category. Click <b>+</b> above to add symbols.</div>';
    return;
  }

  for (const item of items) {
    const key = `${item.source}:${item.symbol}`;
    const quote = latestQuotes.get(key);
    const isSelected =
      activeInst &&
      activeInst.state.source === item.source &&
      activeInst.state.symbol === item.symbol;

    const row = document.createElement('div');
    row.className = `watchlist-item ${isSelected ? 'selected' : ''}`;
    row.dataset.wkey = key;
    row.draggable = true;
    row.setAttribute('role', 'button');
    row.tabIndex = 0;

    const priceText =
      quote && Number.isFinite(quote.price) ? quote.price.toFixed(item.precision ?? 2) : '—';

    row.innerHTML = `
      <span class="wl-drag-grip" title="Drag up/down to reorder" aria-hidden="true">⋮⋮</span>
      <div class="wl-meta">
        <div class="wl-top">
          <span class="source-pill ${item.source}">${item.source.toUpperCase()}</span>
          <span class="wl-sym">${escapeHtml(item.display)}</span>
        </div>
        <span class="wl-name">${escapeHtml(item.name || item.symbol)}</span>
      </div>
      <div class="wl-price-col">
        <div class="wl-price">${priceText}</div>
      </div>
      <div class="wl-item-actions">
        <button type="button" class="icon-btn wl-pop-btn" title="Open in new window" aria-label="Pop out">↗</button>
        <button type="button" class="icon-btn wl-del-btn" title="Remove from list" aria-label="Remove">×</button>
      </div>
    `;

    row.addEventListener('click', () => selectWatchlistItem(item));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectWatchlistItem(item);
      }
    });

    // Drag-and-drop reorder up/down
    row.addEventListener('dragstart', (e) => {
      draggedWatchlistKey = key;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', key);
    });

    row.addEventListener('dragend', () => {
      draggedWatchlistKey = null;
      row.classList.remove('dragging');
      for (const el of watchlistListEl.querySelectorAll('.watchlist-item')) {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      }
    });

    row.addEventListener('dragover', (e) => {
      if (!draggedWatchlistKey || draggedWatchlistKey === key) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      row.classList.toggle('drag-over-top', !after);
      row.classList.toggle('drag-over-bottom', after);
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over-top', 'drag-over-bottom');
      if (!draggedWatchlistKey || draggedWatchlistKey === key) return;
      const rect = row.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;

      const customCat = watchlistCategories.find((c) => c.id === activeWatchlistTab);
      if (customCat) {
        if (reorderWatchlistArray(customCat.items, draggedWatchlistKey, key, after)) {
          saveWatchlistCategories();
          broadcastWatchlist();
          renderWatchlist();
        }
      } else {
        if (reorderWatchlistArray(watchlist, draggedWatchlistKey, key, after)) {
          saveWatchlist();
          broadcastWatchlist();
          renderWatchlist();
        }
      }
    });

    row.querySelector('.wl-pop-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const qs = new URLSearchParams({
        mode: 'popout',
        source: item.source,
        symbol: item.symbol,
        display: item.display,
        tf: panes.get(activePaneId)?.state.tf || '1m',
        ctype: panes.get(activePaneId)?.state.chartType || 'candle',
      });
      window.open(
        `/?${qs.toString()}`,
        `linepulse_popout_${item.symbol}_${Date.now()}`,
        'noopener,width=760,height=520,menubar=no,toolbar=no,location=no,status=no'
      );
    });

    row.querySelector('.wl-del-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const customCat = watchlistCategories.find((c) => c.id === activeWatchlistTab);
      if (customCat) {
        customCat.items = customCat.items.filter(
          (w) => !(w.source === item.source && w.symbol === item.symbol)
        );
        saveWatchlistCategories();
      } else {
        watchlist = watchlist.filter(
          (w) => !(w.source === item.source && w.symbol === item.symbol)
        );
        saveWatchlist();
      }
      broadcastWatchlist();
      renderWatchlist();
      updateStreamSubscription();
    });

    watchlistListEl.appendChild(row);
  }
}

function broadcastWatchlist() {
  if (syncChannel) {
    syncChannel.postMessage({
      type: 'watchlist',
      sender: windowInstanceId,
      watchlist,
      categories: watchlistCategories,
    });
  }
}

function updateWatchlistPriceRow(tick) {
  const key = `${tick.source}:${tick.symbol}`;
  const row = watchlistListEl.querySelector(`[data-wkey="${CSS.escape(key)}"]`);
  if (!row) return;
  const item = getVisibleWatchlistItems().find(
    (w) => w.source === tick.source && w.symbol === tick.symbol
  );
  const prec = item?.precision ?? (tick.price >= 1000 ? 2 : tick.price >= 20 ? 3 : 5);
  const el = row.querySelector('.wl-price');
  if (el) el.textContent = tick.price.toFixed(prec);
}

// ============================================================================
// Save / Load Workspace Dialog
// ============================================================================
function buildWorkspaceSnapshot() {
  return {
    version: 3,
    layout: screenState.layout,
    watchlistOpen: screenState.watchlistOpen,
    watchlistWidth: screenState.watchlistWidth || 248,
    gridSizes: screenState.gridSizes || {},
    panes: screenState.panes.map((p) => {
      const inst = panes.get(p.id);
      return inst ? { id: p.id, ...inst.state } : p;
    }),
    drawings: drawingsBySymbol,
    watchlist,
    watchlistCategories,
    timeframes: activeTimeframes,
    styleTemplates,
    prefs,
  };
}

function applyWorkspaceSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;

  if (snapshot.prefs) {
    prefs = {
      ...DEFAULT_PREFS,
      ...snapshot.prefs,
      colors: { ...DEFAULT_PREFS.colors, ...(snapshot.prefs.colors || {}) },
    };
    savePrefs();
  }

  if (Array.isArray(snapshot.timeframes) && snapshot.timeframes.length) {
    activeTimeframes = sortTimeframes(snapshot.timeframes);
    saveTimeframesList();
  } else if (Array.isArray(snapshot.customTimeframes)) {
    activeTimeframes = sortTimeframes([...BUILTIN_TIMEFRAMES, ...snapshot.customTimeframes]);
    saveTimeframesList();
  }

  if (Array.isArray(snapshot.styleTemplates)) {
    styleTemplates = snapshot.styleTemplates;
    saveLocalTemplates();
  }

  if (Array.isArray(snapshot.watchlist) && snapshot.watchlist.length) {
    watchlist = snapshot.watchlist;
    saveWatchlist();
  }

  if (Array.isArray(snapshot.watchlistCategories)) {
    watchlistCategories = snapshot.watchlistCategories;
    saveWatchlistCategories();
  }

  if (snapshot.drawings && typeof snapshot.drawings === 'object') {
    drawingsBySymbol = snapshot.drawings;
    saveDrawingsStore();
  }

  for (const inst of panes.values()) {
    inst.destroy();
  }
  panes.clear();
  maximizedPaneId = null;
  activePaneId = null;

  screenState = {
    layout: snapshot.layout || '4',
    watchlistOpen: snapshot.watchlistOpen !== false,
    watchlistWidth: snapshot.watchlistWidth || 248,
    gridSizes: snapshot.gridSizes || {},
    panes:
      Array.isArray(snapshot.panes) && snapshot.panes.length
        ? snapshot.panes
        : DEFAULT_PANES.slice(0, 4).map((p, i) => ({ id: `p${i}`, ...p })),
  };

  if (Number.isFinite(screenState.watchlistWidth)) {
    watchlistPanel.style.width = `${screenState.watchlistWidth}px`;
  }

  applyThemeAndPrefs();
  renderWatchlist();
  renderGrid();
}

async function openLayoutsDialog() {
  layoutsFeedbackEl.textContent = '';
  layoutNameInput.value = currentSavedLayoutName || `Screen ${screenId}`;
  layoutsDialog.showModal();
  await refreshSavedLayoutsList();
}

async function refreshSavedLayoutsList() {
  savedLayoutsListEl.innerHTML =
    '<div style="padding:12px;color:var(--text-secondary);font-size:12px;">Loading saved workspaces...</div>';
  try {
    const res = await fetch('/api/layouts');
    const data = await res.json();
    renderSavedLayouts(data.layouts || []);
  } catch {
    savedLayoutsListEl.innerHTML =
      '<div style="padding:12px;color:var(--down);font-size:12px;">Could not load saved workspaces.</div>';
  }
}

function renderSavedLayouts(list) {
  savedLayoutsListEl.innerHTML = '';
  if (!list.length) {
    savedLayoutsListEl.innerHTML =
      '<div style="padding:18px;text-align:center;color:var(--text-secondary);font-size:12px;">No saved workspaces yet. Enter a name above and click <b>Save</b>.</div>';
    return;
  }

  for (const entry of list) {
    const card = document.createElement('div');
    card.className = 'saved-layout-card';

    const dateStr = entry.updatedAt
      ? new Intl.DateTimeFormat('en-GB', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(entry.updatedAt))
      : '';

    const syms = (entry.meta?.symbols || []).join(', ');
    const drwCount = entry.meta?.drawingsCount || 0;

    card.innerHTML = `
      <div class="saved-layout-info">
        <span class="saved-layout-name">${escapeHtml(entry.name)}</span>
        <span class="saved-layout-meta">${dateStr} • ${entry.meta?.panesCount || 0} charts • ${drwCount} drawings ${syms ? `• ${escapeHtml(syms)}` : ''}</span>
      </div>
      <div class="saved-layout-actions">
        <button type="button" class="btn-primary load-btn">Load</button>
        <button type="button" class="btn-danger-sm del-btn">Delete</button>
      </div>
    `;

    card.querySelector('.load-btn').addEventListener('click', () => {
      currentSavedLayoutName = entry.name;
      applyWorkspaceSnapshot(entry.snapshot);
      layoutsFeedbackEl.textContent = `Loaded "${entry.name}"!`;
      setTimeout(() => layoutsDialog.close(), 300);
    });

    card.querySelector('.del-btn').addEventListener('click', async () => {
      try {
        const res = await fetch(`/api/layouts/${encodeURIComponent(entry.id)}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        renderSavedLayouts(data.layouts || []);
        layoutsFeedbackEl.textContent = `Deleted "${entry.name}".`;
      } catch {
        layoutsFeedbackEl.textContent = 'Delete failed.';
      }
    });

    savedLayoutsListEl.appendChild(card);
  }
}

saveLayoutForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = layoutNameInput.value.trim();
  if (!name) return;

  try {
    const res = await fetch('/api/layouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, snapshot: buildWorkspaceSnapshot() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save');
    currentSavedLayoutName = name;
    renderSavedLayouts(data.layouts || []);
    layoutsFeedbackEl.textContent = `Saved "${name}"!`;
  } catch (err) {
    layoutsFeedbackEl.textContent = err.message;
  }
});

exportJsonBtn.addEventListener('click', () => {
  const snapshot = buildWorkspaceSnapshot();
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const safeName = (currentSavedLayoutName || `linepulse-screen-${screenId}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  a.download = `${safeName}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  layoutsFeedbackEl.textContent = 'Exported JSON file.';
});

importJsonInput.addEventListener('change', async () => {
  const file = importJsonInput.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    applyWorkspaceSnapshot(parsed.snapshot || parsed);
    layoutsFeedbackEl.textContent = 'Imported JSON workspace!';
    setTimeout(() => layoutsDialog.close(), 350);
  } catch {
    layoutsFeedbackEl.textContent = 'Invalid JSON file.';
  } finally {
    importJsonInput.value = '';
  }
});

// ============================================================================
// Symbol Search Native <dialog>
// ============================================================================
async function openSymbolDialog(mode, paneId = null) {
  symbolDialogMode = mode;
  symbolDialogTargetPaneId = paneId || activePaneId;
  symbolSearchInput.value = '';
  document.getElementById('symbol-dialog-title').textContent =
    mode === 'watchlist' ? 'Add Symbol to Watchlist' : 'Select Symbol';

  symbolDialog.showModal();
  await fetchAndRenderSymbols('');
}

async function fetchAndRenderSymbols(query) {
  try {
    const qs = new URLSearchParams();
    if (query) qs.set('q', query);
    if (symbolSourceFilter !== 'all') qs.set('source', symbolSourceFilter);
    const res = await fetch(`/api/symbols?${qs.toString()}`);
    const data = await res.json();
    cachedCatalog = data.symbols || [];
    renderSymbolResults(cachedCatalog);
  } catch {
    symbolResultsEl.innerHTML =
      '<div style="padding:16px;color:var(--text-secondary)">Could not load symbol catalog.</div>';
  }
}

function renderSymbolResults(items) {
  symbolResultsEl.innerHTML = '';
  if (!items.length) {
    symbolResultsEl.innerHTML =
      '<div style="padding:18px;text-align:center;color:var(--text-secondary)">No matching symbols. Use the buttons below to open a custom ticker.</div>';
    return;
  }

  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'symbol-row';
    btn.innerHTML = `
      <span class="symbol-row-left">
        <span class="symbol-row-code">${escapeHtml(item.display)}</span>
        <span class="symbol-row-desc">${escapeHtml(item.name)}</span>
      </span>
      <span class="symbol-row-right">
        <span class="source-pill ${item.source}">${escapeHtml(item.exchange)}</span>
      </span>
    `;
    btn.addEventListener('click', () => handleSymbolChosen(item));
    symbolResultsEl.appendChild(btn);
  }
}

function handleSymbolChosen(item) {
  if (symbolDialogMode === 'watchlist') {
    const entry = {
      source: item.source,
      symbol: item.symbol,
      display: item.display || item.symbol,
      name: item.name || item.symbol,
      precision: item.precision ?? 2,
    };
    const customCat = watchlistCategories.find((c) => c.id === activeWatchlistTab);
    if (customCat) {
      if (!customCat.items.some((w) => w.source === entry.source && w.symbol === entry.symbol)) {
        customCat.items.unshift(entry);
        saveWatchlistCategories();
      }
    }
    if (!watchlist.some((w) => w.source === entry.source && w.symbol === entry.symbol)) {
      watchlist.unshift(entry);
      saveWatchlist();
    }
    broadcastWatchlist();
    renderWatchlist();
    updateStreamSubscription();
  } else {
    const target = panes.get(symbolDialogTargetPaneId || activePaneId);
    if (target) {
      target.setSymbol(item.source, item.symbol, item.display || item.symbol);
      target.setDrawings(drawingsBySymbol[target.symbolKey] || []);
      target.setAlerts(alertsList);
      if (isPopout) {
        document.title = `${item.display || item.symbol} — LinePulse`;
      }
      saveScreenState();
      updateTopbarFromActive();
      updateStreamSubscription();
      renderWatchlist();
    }
  }
  symbolDialog.close();
}

let searchDebounce = null;
symbolSearchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    fetchAndRenderSymbols(symbolSearchInput.value.trim());
  }, 110);
});

symbolSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (cachedCatalog.length > 0) handleSymbolChosen(cachedCatalog[0]);
  }
});

for (const pill of symbolDialog.querySelectorAll('.filter-pill')) {
  pill.addEventListener('click', () => {
    symbolSourceFilter = pill.dataset.sourceFilter;
    for (const p of symbolDialog.querySelectorAll('.filter-pill')) {
      p.classList.toggle('active', p === pill);
    }
    if (customSourceSelect && ALL_SOURCES.includes(symbolSourceFilter)) {
      customSourceSelect.value = symbolSourceFilter;
    }
    fetchAndRenderSymbols(symbolSearchInput.value.trim());
  });
}

useCustomOpenBtn.addEventListener('click', () => {
  const src = customSourceSelect?.value || 'binance';
  const rawInput = symbolSearchInput.value.trim().toUpperCase();
  if (!rawInput) return;

  let symbol = rawInput;
  let display = rawInput;
  let precision = 2;

  if (src === 'oanda') {
    symbol = rawInput.replace(/[/-]/g, '_');
    display = symbol.replace('_', '/');
    precision = symbol.includes('JPY') || symbol.includes('XAU') ? 2 : 5;
  } else if (src === 'binance' || src === 'bybit') {
    symbol = rawInput.replace(/[/_-]/g, '');
    if (!/(USDT|USDC|USD|BTC|ETH)$/.test(symbol)) symbol = `${symbol}USDT`;
    display = symbol.replace(/(USDT|USDC|USD)$/, '/$1');
    precision = 2;
  } else if (src === 'coinbase') {
    symbol = rawInput.replace(/[/_]/g, '-');
    if (!symbol.includes('-')) symbol = `${symbol}-USD`;
    display = symbol.replace('-', '/');
    precision = 2;
  } else if (src === 'kraken') {
    symbol = rawInput.replace(/[_-]/g, '/');
    if (!symbol.includes('/')) symbol = `${symbol}/USD`;
    display = symbol;
    precision = 2;
  } else if (src === 'stocks') {
    symbol = rawInput.replace(/[^A-Z0-9.-]/g, '');
    display = symbol;
    precision = 2;
  } else {
    symbol = rawInput;
    display = rawInput;
    precision = 2;
  }

  handleSymbolChosen({ source: src, symbol, display, name: `${display} (${src.toUpperCase()})`, precision });
});

// ============================================================================
// Global Settings & API Keys Dialog
// ============================================================================
function fillColorInputs(colors) {
  const c = { ...DEFAULT_PREFS.colors, ...(colors || {}) };
  document.getElementById('cfg-col-chartBg').value = c.chartBg;
  document.getElementById('cfg-col-appBg').value = c.appBg;
  document.getElementById('cfg-col-gridColor').value = c.gridColor;
  document.getElementById('cfg-col-textColor').value = c.textColor;
  document.getElementById('cfg-col-lineColor').value = c.lineColor;
  document.getElementById('cfg-col-upColor').value = c.upColor;
  document.getElementById('cfg-col-downColor').value = c.downColor;
  document.getElementById('cfg-col-drawColor').value = c.drawColor;
}

async function openSettingsDialog() {
  settingsFeedbackEl.textContent = '';
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    const cfg = data.config || {};
    document.getElementById('cfg-oanda-env').value = cfg.oandaEnv || 'practice';
    document.getElementById('cfg-oanda-account').value = cfg.oandaAccountId || '';
    document.getElementById('cfg-oanda-key').value = '';
    document.getElementById('cfg-td-key').value = '';
    const dbKeyEl = document.getElementById('cfg-databento-key');
    if (dbKeyEl) dbKeyEl.value = '';
    const ibkrUrlEl = document.getElementById('cfg-ibkr-url');
    if (ibkrUrlEl) ibkrUrlEl.value = cfg.ibkrGatewayUrl || 'https://127.0.0.1:5000';
    const ibkrEnEl = document.getElementById('cfg-ibkr-enabled');
    if (ibkrEnEl) ibkrEnEl.checked = Boolean(cfg.ibkrEnabled);

    document.getElementById('oanda-key-note').textContent = cfg.hasOandaKey
      ? `OANDA API key active (${cfg.oandaKeyPreview}) — ${cfg.oandaEnv.toUpperCase()}`
      : 'No OANDA API key configured yet.';
    const dbNoteEl = document.getElementById('databento-key-note');
    if (dbNoteEl) {
      dbNoteEl.textContent = cfg.hasDatabentoKey
        ? `Databento API key active (${cfg.databentoKeyPreview}) — ready for CME GLBX.MDP3 bulk 1m downloads in Data Archive.`
        : 'Optional — add your db-... API key to bulk-download official CME NQ, ES, GC, 6E, 6B 1m history inside Data Archive (card required for verification, $125 free credit).';
    }
  } catch {
    // ignore
  }

  fillColorInputs(prefs.colors);
  document.getElementById('cfg-theme').value = prefs.theme;
  document.getElementById('cfg-tz').value = prefs.timezone;
  document.getElementById('cfg-line-width').value = String(prefs.lineWidth);
  document.getElementById('cfg-show-grid').checked = Boolean(prefs.showGrid);

  settingsDialog.showModal();
}

for (const presetBtn of settingsDialog.querySelectorAll('[data-preset]')) {
  presetBtn.addEventListener('click', () => {
    const preset = COLOR_PRESETS[presetBtn.dataset.preset];
    if (!preset) return;
    document.getElementById('cfg-theme').value = preset.theme;
    fillColorInputs(preset.colors);
  });
}

settingsCancelBtn.addEventListener('click', () => settingsDialog.close());

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(settingsForm);

  prefs.theme = String(fd.get('theme') || 'dark');
  prefs.timezone = String(fd.get('timezone') || 'Europe/Istanbul');
  prefs.lineWidth = Number(fd.get('lineWidth') || 2);
  prefs.showGrid = document.getElementById('cfg-show-grid').checked;
  prefs.colors = {
    chartBg: String(fd.get('chartBg') || '#131722'),
    appBg: String(fd.get('appBg') || '#0b0e14'),
    gridColor: String(fd.get('gridColor') || '#222738'),
    textColor: String(fd.get('textColor') || '#8b95ad'),
    lineColor: String(fd.get('lineColor') || '#2962ff'),
    upColor: String(fd.get('upColor') || '#26a69a'),
    downColor: String(fd.get('downColor') || '#ef5350'),
    drawColor: String(fd.get('drawColor') || '#f59e0b'),
  };

  savePrefs();
  applyThemeAndPrefs();
  if (syncChannel) {
    syncChannel.postMessage({ type: 'prefs', sender: windowInstanceId, prefs });
  }

  const oandaApiKey = String(fd.get('oandaApiKey') || '').trim();
  const twelveDataApiKey = String(fd.get('twelveDataApiKey') || '').trim();
  const databentoApiKey = String(fd.get('databentoApiKey') || '').trim();
  const ibkrGatewayUrl = String(fd.get('ibkrGatewayUrl') || '').trim();
  const ibkrEnabled = Boolean(document.getElementById('cfg-ibkr-enabled')?.checked);
  const payload = {
    oandaEnv: String(fd.get('oandaEnv') || 'practice'),
    oandaAccountId: String(fd.get('oandaAccountId') || '').trim(),
    ibkrGatewayUrl: ibkrGatewayUrl || 'https://127.0.0.1:5000',
    ibkrEnabled,
    defaultTimezone: prefs.timezone,
  };
  if (oandaApiKey) payload.oandaApiKey = oandaApiKey;
  if (twelveDataApiKey) payload.twelveDataApiKey = twelveDataApiKey;
  if (databentoApiKey) payload.databentoApiKey = databentoApiKey;

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.feeds) renderFeedStatus(data.feeds);
    const hadOanda = hasOandaKeyOnServer;
    hasOandaKeyOnServer = Boolean(data.config?.hasOandaKey);
    if (hasOandaKeyOnServer && (!hadOanda || oandaApiKey)) {
      for (const pane of panes.values()) {
        if (pane.state.source === 'oanda') {
          pane.loadHistory();
        }
      }
    }
    settingsFeedbackEl.textContent = 'Saved!';
    setTimeout(() => settingsDialog.close(), 300);
  } catch {
    settingsFeedbackEl.textContent = 'Could not save server settings.';
  }
});

// ============================================================================
// Toolbar, Custom TF, Custom Category & Keyboard Bindings
// ============================================================================
activeSymbolBtn.addEventListener('click', () => openSymbolDialog('pane', activePaneId));

topbarCtypeSelect.addEventListener('change', () => {
  const ctype = topbarCtypeSelect.value;
  panes.get(activePaneId)?.setChartType(ctype);
  saveScreenState();
  updateTopbarFromActive();
});

globalTfGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('.tf-btn');
  if (!btn) return;
  const tf = btn.dataset.tf;
  if (e.shiftKey) {
    for (const inst of panes.values()) inst.setTimeframe(tf);
  } else {
    panes.get(activePaneId)?.setTimeframe(tf);
  }
  saveScreenState();
  updateTopbarFromActive();
});

addTfBtn.addEventListener('click', () => {
  tfPopover?.hidePopover?.();
  openTfDialog();
});
alertsBtn.addEventListener('click', () => openAlertsDialog());

layoutControls.addEventListener('click', (e) => {
  const btn = e.target.closest('.layout-opt-btn');
  if (!btn) return;
  screenState.layout = btn.dataset.layout;
  maximizedPaneId = null;
  layoutPopover?.hidePopover?.();
  renderGrid();
});

// Align native popovers cleanly under their trigger buttons
const tfMoreBtnEl = document.getElementById('tf-more-btn');
const layoutPickerBtnEl = document.getElementById('layout-picker-btn');
if (tfPopover && tfMoreBtnEl) {
  tfPopover.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    const r = tfMoreBtnEl.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - 290, r.left - 180));
    tfPopover.style.left = `${Math.round(left)}px`;
  });
}
if (layoutPopover && layoutPickerBtnEl) {
  layoutPopover.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    const r = layoutPickerBtnEl.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - 234, r.left + r.width / 2 - 112));
    layoutPopover.style.left = `${Math.round(left)}px`;
    layoutPopover.style.transform = 'none';
  });
}

if (screensPopover && newScreenBtn) {
  screensPopover.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    if (syncChannel) {
      syncChannel.postMessage({ type: 'screen_ping', sender: windowInstanceId, screenId });
    }
    const r = newScreenBtn.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - 306, r.right - 296));
    screensPopover.style.left = `${Math.round(left)}px`;
    screensPopover.style.right = 'auto';
    renderScreensPopover();
  });
}

templatesBtn.addEventListener('click', () => openStyleDialog(activePaneId));
layoutsBtn.addEventListener('click', openLayoutsDialog);

syncCrosshairBtn.addEventListener('click', () => {
  prefs.syncCrosshair = !prefs.syncCrosshair;
  savePrefs();
  applyThemeAndPrefs();
  if (syncChannel) {
    syncChannel.postMessage({ type: 'prefs', sender: windowInstanceId, prefs });
  }
});

openNextScreenBtn?.addEventListener('click', openNewScreenWindow);

watchlistToggleBtn.addEventListener('click', () => {
  screenState.watchlistOpen = !screenState.watchlistOpen;
  saveScreenState();
  renderWatchlist();
  updateStreamSubscription();
});

watchlistAddBtn.addEventListener('click', () => openSymbolDialog('watchlist'));

watchlistNewCatBtn.addEventListener('click', async () => {
  const name = await openTextPrompt(
    'New Watchlist Category',
    '',
    'Create a custom symbol group (e.g. London Session, Gold & DXY, CME).',
    'Category name...'
  );
  if (!name || !name.trim()) return;
  const cat = {
    id: `cat-${Date.now()}`,
    name: name.trim().slice(0, 24),
    items: [],
  };
  watchlistCategories.push(cat);
  activeWatchlistTab = cat.id;
  saveWatchlistCategories();
  broadcastWatchlist();
  renderWatchlist();
});

feedStatusBtn.addEventListener('click', openSettingsDialog);
settingsBtn.addEventListener('click', openSettingsDialog);

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (
    tfDialog.open ||
    alertsDialog.open ||
    symbolDialog.open ||
    styleDialog.open ||
    timezoneDialog.open ||
    settingsDialog.open ||
    layoutsDialog.open ||
    promptDialog.open ||
    replayCtrl?.isDialogOpen()
  ) {
    return;
  }
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

  if (replayCtrl?.handleKeyDown(e)) return;

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    openLayoutsDialog();
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    panes.get(activePaneId)?.selectAllDrawings();
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    panes.get(activePaneId)?.undoLastDrawing();
    return;
  }

  if (e.key === 'Enter') {
    if (panes.get(activePaneId)?.finishActiveDraft()) {
      e.preventDefault();
      return;
    }
  }

  if (e.key === 'Escape') {
    if (panes.get(activePaneId)?.finishActiveDraft()) {
      return;
    }
    if (panes.get(activePaneId)?.closeEditBar()) {
      return;
    }
    if (activeDrawingTool !== 'cursor') {
      setActiveDrawingTool('cursor');
    } else if (maximizedPaneId) {
      toggleMaximizePane(maximizedPaneId);
    }
    return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (panes.get(activePaneId)?.deleteSelectedDrawing()) {
      e.preventDefault();
    }
    return;
  }

  // Up/Down arrows step cleanly through the Watchlist!
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    stepWatchlistSelection(1);
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    stepWatchlistSelection(-1);
    return;
  }

  if (e.key === '/') {
    e.preventDefault();
    openSymbolDialog('pane', activePaneId);
  } else if (e.key.toLowerCase() === 'm') {
    e.preventDefault();
    toggleMagnetMode();
  } else if (!isPopout && ['1', '2', '3', '4', '6', '9'].includes(e.key)) {
    const map = { '1': '1', '2': '2h', '3': '3', '4': '4', '6': '6', '9': '9' };
    screenState.layout = map[e.key];
    maximizedPaneId = null;
    renderGrid();
  } else if (!isPopout && e.key.toLowerCase() === 'f' && activePaneId) {
    toggleMaximizePane(activePaneId);
  }
});

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================================
// Initialize Application
// ============================================================================
async function boot() {
  screenBadgeEl.textContent = isPopout ? 'Pop' : String(screenId);
  initSharedWorker();
  updateLiveClock();
  setInterval(updateLiveClock, 1000);

  let initialFeeds = null;
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    hasOandaKeyOnServer = Boolean(data.config?.hasOandaKey);
    initialFeeds = data.feeds || null;
  } catch {
    // ignore
  }

  if (!isPopout && !hasOandaKeyOnServer && !hasSavedScreenInStorage) {
    screenState = {
      layout: '4',
      watchlistOpen: window.innerWidth > 768,
      panes: [
        { id: 'p0', source: 'cme', symbol: '@ND.1', display: 'NQ1!', tf: '1m', chartType: 'candle' },
        { id: 'p1', source: 'cme', symbol: '@SP.1', display: 'ES1!', tf: '1m', chartType: 'candle' },
        { id: 'p2', source: 'binance', symbol: 'BTCUSDT', display: 'BTC/USDT', tf: '1m', chartType: 'candle' },
        { id: 'p3', source: 'cme', symbol: '@GC.1', display: 'GC1!', tf: '5m', chartType: 'candle' },
      ],
    };
  }

  // On mobile viewports (<= 768px), start cleanly with sidebar drawer closed so chart fills screen
  if (window.innerWidth <= 768) {
    screenState.watchlistOpen = false;
  }

  initWatchlistResizer();
  applyThemeAndPrefs();
  renderTimeframeBar();
  renderWatchlist();
  renderGrid();
  renderLayersPanel();
  hydrateDrawingsFromServer();
  fetchAlertsFromServer();
  fetchEconomicNewsFromServer();
  setInterval(fetchEconomicNewsFromServer, 10 * 60 * 1000);

  if (initialFeeds) renderFeedStatus(initialFeeds);

  // Wire EN / TR live language switcher (topbar toggle + Settings dropdown)
  applyDomTranslations(document);
  document.getElementById('lang-toggle-btn')?.addEventListener('click', () => {
    const next = getLang() === 'tr' ? 'en' : 'tr';
    setLang(next);
    renderNewsPanel();
    showToast(t('lang.switchedTitle'), t('lang.switchedBody'));
  });
  document.getElementById('cfg-lang')?.addEventListener('change', (ev) => {
    setLang(ev.target.value);
    renderNewsPanel();
    showToast(t('lang.switchedTitle'), t('lang.switchedBody'));
  });
}

boot();
