/**
 * LinePulse FXReplay-Style Backtest / Bar-Replay Controller
 * - Zero-lookahead Multi-Timeframe (1m, 3m, 5m, 15m, 1h, 4h, 12h, 1D, 1W) synchronized playback
 * - Paper execution (Market / Limit / Stop), % Risk auto-lot sizing, Spread & Commission simulation
 * - On-chart draggable Entry / SL / TP lines, Breakeven, Partial Close, Closed trade markers
 * - Prop Firm live rule engine: FTMO, The5ers & Custom saved rules
 * - Analytics Dashboard: KPIs, Equity Curve Canvas, Trade Journal with Tags/Notes, CSV & JSON Export
 */

import { t, onLangChange } from './i18n.js';

const TF_SECONDS = {
  '1s': 1,
  '5s': 5,
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
  '12h': 43200,
  '1d': 86400,
  '1w': 604800,
  '1M': 2592000,
};

function tfToSec(tf) {
  if (TF_SECONDS[tf]) return TF_SECONDS[tf];
  const m = String(tf || '1m').match(/^(\d+)([smhdwM])$/);
  if (!m) return 60;
  const n = Number.parseInt(m[1], 10) || 1;
  const unitMap = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, M: 2592000 };
  return n * (unitMap[m[2]] || 60);
}

function getBucketTime(unixSec, tf) {
  if (tf === '1M' || tf.endsWith('M')) {
    const count = Number.parseInt(tf, 10) || 1;
    const d = new Date(unixSec * 1000);
    const mIdx = Math.floor(d.getUTCMonth() / count) * count;
    return Math.floor(Date.UTC(d.getUTCFullYear(), mIdx, 1) / 1000);
  }
  const sec = tfToSec(tf);
  if (tf.endsWith('w')) {
    const weekOffset = 345600;
    return Math.floor((unixSec - weekOffset) / sec) * sec + weekOffset;
  }
  return Math.floor(unixSec / sec) * sec;
}

function getInstrumentSpec(symbol, price = 1) {
  const s = String(symbol || '').toUpperCase();
  if (s.includes('XAU')) {
    return { pipSize: 0.1, contractSize: 100, precision: 2, pipValuePerLot: 10 };
  }
  if (s.includes('XAG')) {
    return { pipSize: 0.01, contractSize: 5000, precision: 3, pipValuePerLot: 50 };
  }
  if (s.includes('NAS100') || s.includes('SPX500') || s.includes('US30') || s.startsWith('@')) {
    return { pipSize: 1.0, contractSize: 1, precision: 1, pipValuePerLot: 1 };
  }
  if (s.includes('BTC') || s.includes('ETH') || s.includes('SOL') || s.includes('BNB')) {
    const pipSize = price >= 500 ? 1.0 : price >= 10 ? 0.1 : 0.01;
    return {
      pipSize,
      contractSize: 1,
      precision: price >= 100 ? 2 : 4,
      pipValuePerLot: pipSize,
    };
  }
  if (s.includes('JPY')) {
    const px = Number.isFinite(price) && price > 10 ? price : 150;
    return {
      pipSize: 0.01,
      contractSize: 100000,
      precision: 3,
      pipValuePerLot: (100000 * 0.01) / px,
    };
  }
  // Standard FX (EUR_USD, GBP_USD, USD_CAD, etc.)
  const isUsdBase = s.startsWith('USD_') || s.startsWith('USD/');
  const px = Number.isFinite(price) && price > 0 ? price : 1;
  return {
    pipSize: 0.0001,
    contractSize: 100000,
    precision: 5,
    pipValuePerLot: isUsdBase ? 10 / px : 10,
  };
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtUsd(val, showPlus = false) {
  const n = Number(val) || 0;
  const sign = n < 0 ? '-' : showPlus && n > 0 ? '+' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: Math.abs(n) < 100 ? 2 : 0,
    maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0,
  })}`;
}

function fmtReplayTime(unixSec, tz) {
  if (!Number.isFinite(unixSec)) return '--';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || 'Europe/Istanbul',
      day: '2-digit',
      month: 'short',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(unixSec * 1000));
  } catch {
    return new Date(unixSec * 1000).toISOString().slice(0, 16).replace('T', ' ');
  }
}

function utcDayKey(unixSec) {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

const DEFAULT_EXTRA_PAIRS = [
  { source: 'oanda', symbol: 'DXY', display: 'DXY' },
  { source: 'oanda', symbol: 'XAU_USD', display: 'XAU/USD' },
  { source: 'oanda', symbol: 'EUR_USD', display: 'EUR/USD' },
  { source: 'oanda', symbol: 'GBP_USD', display: 'GBP/USD' },
  { source: 'oanda', symbol: 'NAS100_USD', display: 'NAS100' },
  { source: 'oanda', symbol: 'SPX500_USD', display: 'SPX500' },
  { source: 'binance', symbol: 'BTCUSDT', display: 'BTC/USDT' },
];
const CUSTOM_EXTRA_PAIRS_KEY = 'linepulse_replay_custom_pairs_v1';

export class ReplayController {
  constructor(host) {
    /**
     * host provides:
     * - getPanes() -> Map<id, ChartPane>
     * - getActivePane() -> ChartPane
     * - getPrefs() -> prefs
     * - showToast(title, body)
     * - openTextPrompt(title, def, hint, placeholder)
     * - setSidebarMode(mode)
     * - onEnterReplay() / onExitReplay()
     * - onReplayDrawingsChanged(symbolKey, list)
     */
    this.host = host;
    this.active = false;
    this.playing = false;
    this.playTimer = null;
    this.fetchingForward = false;

    this.propRules = [];
    this.sessions = [];
    this.session = null; // currently loaded backtest session
    this.symbolCatalog = [];
    this.customExtraPairs = this._loadCustomExtraPairs();

    // Core M1 stream (per symbol for true multi-pair synced backtesting!) + HTF context per pane
    this.m1Bars = [];
    this.m1Meta = { precision: 2, display: 'XAU/USD' };
    this.m1BySymbol = new Map(); // symbolKey -> { bars, meta }
    this.m1Index = -1; // index of current bar in m1Bars at session.cursorTime
    this.paneContexts = new Map(); // paneId -> { symbolKey, tf, baseBars, precision, bucketSec }
    this.replayNewsEvents = [];

    this.ticketSide = 'buy';
    this.saveDebounce = null;
    this.rpaTab = 'journal'; // 'journal' | 'timeline'
    this.activeReviewStepIdx = -1;
    this.reviewPlayTimer = null;
    this.reviewTimeFilter = null; // null = show all drawings, unixSec = show drawings <= step time

    this._bindDom();
    onLangChange(() => {
      this._syncArchiveEntriesToPrimarySelect();
      this._renderArchiveEntries();
      this._renderSavedSessionsList();
    });
  }

  _bindDom() {
    this.modeLiveBtn = document.getElementById('mode-live-btn');
    this.modeReplayBtn = document.getElementById('mode-replay-btn');
    this.replayDock = document.getElementById('replay-dock');
    this.sidebarTabTrade = document.getElementById('sidebar-tab-trade');

    // Dock controls
    this.rpSessionBtn = document.getElementById('rp-session-btn');
    this.rpSessionNameEl = document.getElementById('rp-session-name');
    this.rpRenameSessionBtn = document.getElementById('rp-rename-session-btn');
    this.rpSaveAsBtn = document.getElementById('rp-save-as-btn');
    this.rpClockEl = document.getElementById('rp-clock-display');
    this.rpStepBackBtn = document.getElementById('rp-step-back-btn');
    this.rpPlayBtn = document.getElementById('rp-play-btn');
    this.rpStepFwdBtn = document.getElementById('rp-step-fwd-btn');
    this.rpStepTfEl = document.getElementById('rp-step-tf');
    this.rpSpeedEl = document.getElementById('rp-speed-select');
    this.rpGotoDateBtn = document.getElementById('rp-goto-date-btn');
    this.rpPropGuardEl = document.getElementById('rp-prop-guard');
    this.rpPropTagEl = document.getElementById('rp-prop-tag');
    this.rpPropDailyEl = document.getElementById('rp-prop-daily');
    this.rpPropTotalEl = document.getElementById('rp-prop-total');
    this.rpPropTargetEl = document.getElementById('rp-prop-target');
    this.rpEquityValEl = document.getElementById('rp-equity-val');
    this.rpArchiveDockBtn = document.getElementById('rp-archive-dock-btn');
    this.rpShareDockBtn = document.getElementById('rp-share-dock-btn');
    this.rpAnalyticsBtn = document.getElementById('rp-analytics-btn');

    // Trade Ticket DOM
    this.rpSideBuyBtn = document.getElementById('rp-side-buy');
    this.rpSideSellBtn = document.getElementById('rp-side-sell');
    this.rpOrderTypeEl = document.getElementById('rp-order-type');
    this.rpEntryWrap = document.getElementById('rp-entry-wrap');
    this.rpEntryPriceEl = document.getElementById('rp-entry-price');
    this.rpRiskModeEl = document.getElementById('rp-risk-mode');
    this.rpRiskValLabel = document.getElementById('rp-risk-val-label');
    this.rpRiskValEl = document.getElementById('rp-risk-val');
    this.rpSlPipsEl = document.getElementById('rp-sl-pips');
    this.rpTpModeEl = document.getElementById('rp-tp-mode');
    this.rpTpValLabel = document.getElementById('rp-tp-val-label');
    this.rpTpValEl = document.getElementById('rp-tp-val');
    this.rpCalcLotsEl = document.getElementById('rp-calc-lots');
    this.rpCalcRiskEl = document.getElementById('rp-calc-risk');
    this.rpCalcRewardEl = document.getElementById('rp-calc-reward');
    this.rpPlaceOrderBtn = document.getElementById('rp-place-order-btn');
    this.rpOpenCountEl = document.getElementById('rp-open-count');
    this.rpPositionsListEl = document.getElementById('rp-positions-list');
    this.rpRecentListEl = document.getElementById('rp-recent-list');
    this.rpOpenJournalMini = document.getElementById('rp-open-journal-mini');

    // Session & Prop Rules Dialog
    this.sessionDialog = document.getElementById('replay-session-dialog');
    this.createSessionForm = document.getElementById('rp-create-session-form');
    this.rpsNameEl = document.getElementById('rps-name');
    this.rpsInstrumentEl = document.getElementById('rps-instrument');
    this.rpsExtraPairsEl = document.getElementById('rps-extra-pairs');
    this.rpsAddPairSourceEl = document.getElementById('rps-add-pair-source');
    this.rpsAddPairInputEl = document.getElementById('rps-add-pair-input');
    this.rpsPairDatalistEl = document.getElementById('rps-pair-datalist');
    this.rpsAddPairBtn = document.getElementById('rps-add-pair-btn');
    this.rpsStartDayEl = document.getElementById('rps-start-day');
    this.rpsStartTimeEl = document.getElementById('rps-start-time');
    this.rpsOpenCalBtn = document.getElementById('rps-open-cal-btn');
    this.rpsDurationEl = document.getElementById('rps-duration');
    this.rpsEndDayEl = document.getElementById('rps-end-day');
    this.rpsBalanceEl = document.getElementById('rps-balance');
    this.rpsPropRuleEl = document.getElementById('rps-prop-rule');
    this.rpsSpreadEl = document.getElementById('rps-spread');
    this.rpsCommEl = document.getElementById('rps-comm');
    this.rpsRuleSummaryEl = document.getElementById('rps-rule-summary');
    this.rpsToggleCustomRuleBtn = document.getElementById('rps-toggle-custom-rule-btn');
    this.customRuleForm = document.getElementById('rp-custom-rule-form');
    this.cprSavedListEl = document.getElementById('cpr-saved-list');
    this.rpSessionsListEl = document.getElementById('rp-sessions-list');
    this.rpImportSessionInput = document.getElementById('rp-import-session-input');
    this.rpsFeedbackEl = document.getElementById('rps-feedback');
    this.rpsOpenArchiveBtn = document.getElementById('rps-open-archive-btn');

    // Offline Data Archive & Incremental Delta Sync Dialog
    this.archiveDialog = document.getElementById('data-archive-dialog');
    this.archiveDownloadForm = document.getElementById('archive-download-form');
    this.arcSourceEl = document.getElementById('arc-source');
    this.arcSymbolEl = document.getElementById('arc-symbol');
    this.arcFromDayEl = document.getElementById('arc-from-day');
    this.arcToDayEl = document.getElementById('arc-to-day');
    this.arcDownloadBtn = document.getElementById('arc-download-btn');
    this.arcFeedbackEl = document.getElementById('arc-feedback');
    this.arcImportSymbolEl = document.getElementById('arc-import-symbol');
    this.arcImportFileEl = document.getElementById('arc-import-file');
    this.arcEntriesListEl = document.getElementById('arc-entries-list');
    this.archiveEntries = [];
    this.archivePresets = null;

    // Analytics, Journal & Mentor Step-by-Step Review Dialog
    this.analyticsDialog = document.getElementById('replay-analytics-dialog');
    this.rpaPropBarEl = document.getElementById('rpa-prop-bar');
    this.rpaKpiGridEl = document.getElementById('rpa-kpi-grid');
    this.rpaEquityCanvas = document.getElementById('rpa-equity-canvas');
    this.rpaTagFilterEl = document.getElementById('rpa-tag-filter');
    this.rpaJournalListEl = document.getElementById('rpa-journal-list');
    this.rpaTimelineListEl = document.getElementById('rpa-timeline-list');
    this.rpaTimelineCountEl = document.getElementById('rpa-timeline-count');
    this.rpaJournalControls = document.getElementById('rpa-journal-controls');
    this.rpaTimelineControls = document.getElementById('rpa-timeline-controls');
    this.rpaPrevStepBtn = document.getElementById('rpa-prev-step-btn');
    this.rpaPlayStepsBtn = document.getElementById('rpa-play-steps-btn');
    this.rpaNextStepBtn = document.getElementById('rpa-next-step-btn');
    this.rpaShowAllBtn = document.getElementById('rpa-show-all-btn');
    this.rpExportPackBtn = document.getElementById('rp-export-pack-btn');
    this.rpExportCsvBtn = document.getElementById('rp-export-csv-btn');
    this.rpExportJsonBtn = document.getElementById('rp-export-json-btn');

    // Mode toggle events
    this.modeLiveBtn?.addEventListener('click', () => this.exitReplay());
    this.modeReplayBtn?.addEventListener('click', () => this.enterReplay());

    // Transport events
    this.rpSessionBtn?.addEventListener('click', () => this.openSessionDialog());
    this.rpRenameSessionBtn?.addEventListener('click', () => this.renameActiveSession());
    this.rpSaveAsBtn?.addEventListener('click', () => this.saveSessionAs());
    this.rpArchiveDockBtn?.addEventListener('click', () => this.openArchiveDialog());
    this.rpsOpenArchiveBtn?.addEventListener('click', () => this.openArchiveDialog());
    this.rpPlayBtn?.addEventListener('click', () => this.togglePlay());
    this.rpStepFwdBtn?.addEventListener('click', () => this.stepForward());
    this.rpStepBackBtn?.addEventListener('click', () => this.stepBackward());
    this.rpSpeedEl?.addEventListener('change', () => {
      if (this.playing) {
        this.pause();
        this.play();
      }
    });
    for (const jb of document.querySelectorAll('[data-rp-jump]')) {
      jb.addEventListener('click', () => this.jumpToMarketSession(jb.dataset.rpJump));
    }
    this.rpGotoDateBtn?.addEventListener('click', () => this.promptGoToDate());
    this.rpShareDockBtn?.addEventListener('click', () => this.exportReviewPack());
    this.rpAnalyticsBtn?.addEventListener('click', () => this.openAnalyticsDialog());
    this.rpOpenJournalMini?.addEventListener('click', () => this.openAnalyticsDialog());

    // Trade ticket events
    this.rpSideBuyBtn?.addEventListener('click', () => this._setTicketSide('buy'));
    this.rpSideSellBtn?.addEventListener('click', () => this._setTicketSide('sell'));
    this.rpOrderTypeEl?.addEventListener('change', () => this._syncTicketUi());
    this.rpRiskModeEl?.addEventListener('change', () => this._syncTicketUi());
    this.rpTpModeEl?.addEventListener('change', () => this._syncTicketUi());
    for (const inp of [this.rpEntryPriceEl, this.rpRiskValEl, this.rpSlPipsEl, this.rpTpValEl]) {
      inp?.addEventListener('input', () => this._updateTicketCalc());
    }
    this.rpPlaceOrderBtn?.addEventListener('click', () => this.placeOrderFromTicket());

    // Session & Prop Rules dialog events
    this.rpsPropRuleEl?.addEventListener('change', () => this._syncPropRuleSelection());
    this.rpsToggleCustomRuleBtn?.addEventListener('click', () => {
      this.customRuleForm.hidden = !this.customRuleForm.hidden;
    });
    this.rpsAddPairSourceEl?.addEventListener('change', () => this._renderAddPairDatalist());
    this.rpsAddPairBtn?.addEventListener('click', () => this._handleAddCustomExtraPair());
    this.rpsAddPairInputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._handleAddCustomExtraPair();
      }
    });
    this._renderExtraPairsChips();
    this._syncCustomPairsToPrimarySelect();
    this.createSessionForm?.addEventListener('submit', (e) => this._handleCreateSession(e));
    this.customRuleForm?.addEventListener('submit', (e) => this._handleSaveCustomRule(e));
    this.rpImportSessionInput?.addEventListener('change', () => this._handleImportReviewPack());

    // Analytics & Mentor Review dialog events
    this.rpaTagFilterEl?.addEventListener('input', () => this.renderAnalyticsDialog());
    this.rpExportPackBtn?.addEventListener('click', () => this.exportReviewPack());
    this.rpExportCsvBtn?.addEventListener('click', () => this.exportJournalCsv());
    this.rpExportJsonBtn?.addEventListener('click', () => this.exportJournalJson());

    for (const tabBtn of document.querySelectorAll('[data-rpa-tab]')) {
      tabBtn.addEventListener('click', () => this._setAnalyticsTab(tabBtn.dataset.rpaTab));
    }
    this.rpaPrevStepBtn?.addEventListener('click', () => this.stepReviewTimeline(-1));
    this.rpaNextStepBtn?.addEventListener('click', () => this.stepReviewTimeline(1));
    this.rpaPlayStepsBtn?.addEventListener('click', () => this.toggleReviewStepsPlay());
    this.rpaShowAllBtn?.addEventListener('click', () => this.showAllReviewOverview());

    // Default start date input to 14 days ago at 08:00 UTC (London Open)
    const defStart = new Date(Date.now() - 14 * 86400 * 1000);
    if (this.rpsStartDayEl) {
      this.rpsStartDayEl.value = defStart.toISOString().slice(0, 10);
    }
    if (this.rpsStartTimeEl) {
      this.rpsStartTimeEl.value = '08:00';
    }
    this.rpsOpenCalBtn?.addEventListener('click', () => {
      if (this.rpsStartDayEl?.showPicker) this.rpsStartDayEl.showPicker();
      else this.rpsStartDayEl?.focus();
    });
    this.rpsDurationEl?.addEventListener('change', () => {
      if (this.rpsEndDayEl) {
        this.rpsEndDayEl.hidden = this.rpsDurationEl.value !== 'custom';
        if (!this.rpsEndDayEl.hidden && !this.rpsEndDayEl.value && this.rpsStartDayEl?.value) {
          const endDef = new Date(Date.parse(`${this.rpsStartDayEl.value}T00:00:00Z`) + 7 * 86400 * 1000);
          this.rpsEndDayEl.value = endDef.toISOString().slice(0, 10);
        }
      }
    });

    this.arcSourceEl?.addEventListener('change', () => this._populateArchiveSymbols());
    this.archiveDownloadForm?.addEventListener('submit', (e) => this._handleArchiveDownload(e));
    this.arcImportFileEl?.addEventListener('change', () => this._handleArchiveImportCsv());

    if (this.arcFromDayEl && this.arcToDayEl) {
      const now = new Date();
      const from30 = new Date(Date.now() - 30 * 86400 * 1000);
      this.arcFromDayEl.value = from30.toISOString().slice(0, 10);
      this.arcToDayEl.value = now.toISOString().slice(0, 10);
    }

    for (const d of [this.sessionDialog, this.analyticsDialog, this.archiveDialog]) {
      d?.addEventListener('close', () => {
        d.returnValue = '';
      });
    }
  }

  isDialogOpen() {
    return Boolean(this.sessionDialog?.open || this.analyticsDialog?.open || this.archiveDialog?.open);
  }

  handleKeyDown(e) {
    if (!this.active || this.isDialogOpen()) return false;
    if (e.code === 'Space') {
      e.preventDefault();
      this.togglePlay();
      return true;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.stepForward();
      return true;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.stepBackward();
      return true;
    }
    return false;
  }

  // ==========================================================================
  // Mode Switching: Live <-> Replay
  // ==========================================================================
  async enterReplay() {
    if (this.active) {
      this.openSessionDialog();
      return;
    }
    this.active = true;
    this.modeLiveBtn?.classList.remove('active');
    this.modeReplayBtn?.classList.add('active');
    if (this.replayDock) this.replayDock.hidden = false;
    if (this.sidebarTabTrade) this.sidebarTabTrade.hidden = false;

    this.host.onEnterReplay();
    for (const pane of this.host.getPanes().values()) {
      pane.setReplayMode(true);
    }
    this.host.setSidebarMode('trade');

    await this.refreshServerLists();
    // Always present the Date, Duration & Multi-Pair setup modal first (user can start new or Resume a saved session)
    this.openSessionDialog();
  }

  exitReplay() {
    if (!this.active) return;
    this.pause();
    this.saveSessionSoon(true);
    this.active = false;
    this.modeLiveBtn?.classList.add('active');
    this.modeReplayBtn?.classList.remove('active');
    if (this.replayDock) this.replayDock.hidden = true;
    if (this.sidebarTabTrade) this.sidebarTabTrade.hidden = true;
    this.paneContexts.clear();

    for (const pane of this.host.getPanes().values()) {
      pane.setReplayMode(false);
    }
    this.host.setSidebarMode('watchlist');
    this.host.onExitReplay();
  }

  async refreshServerLists() {
    try {
      const [sRes, pRes] = await Promise.all([
        fetch('/api/replay/sessions').then((r) => r.json()),
        fetch('/api/replay/prop-rules').then((r) => r.json()),
      ]);
      if (Array.isArray(sRes.sessions)) this.sessions = sRes.sessions;
      if (Array.isArray(pRes.rules)) this.propRules = pRes.rules;
    } catch {
      // ignore
    }
    this._renderPropRulesSelect();
    this._renderSavedSessionsList();
  }

  // ==========================================================================
  // Session & Prop Firm Rules Dialog
  // ==========================================================================
  _loadCustomExtraPairs() {
    try {
      const raw = JSON.parse(localStorage.getItem(CUSTOM_EXTRA_PAIRS_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw.filter((p) => p && p.source && p.symbol);
    } catch {
      return [];
    }
  }

  _saveCustomExtraPairs() {
    try {
      localStorage.setItem(CUSTOM_EXTRA_PAIRS_KEY, JSON.stringify(this.customExtraPairs));
    } catch {
      // ignore storage quota errors
    }
  }

  async _ensureSymbolCatalog() {
    if (this.symbolCatalog.length > 0) return;
    try {
      const res = await fetch('/api/symbols');
      const data = await res.json();
      if (Array.isArray(data.symbols)) {
        this.symbolCatalog = data.symbols;
      }
    } catch {
      // ignore
    }
    this._renderAddPairDatalist();
  }

  _renderAddPairDatalist() {
    if (!this.rpsPairDatalistEl) return;
    const src = this.rpsAddPairSourceEl?.value || 'oanda';
    const matching = this.symbolCatalog.filter((s) => s.source === src);
    this.rpsPairDatalistEl.innerHTML = matching
      .map((s) => {
        const label = s.name ? `${s.display} — ${s.name}` : s.display;
        return `<option value="${escapeHtml(s.display)}">${escapeHtml(label)}</option>`;
      })
      .join('');
  }

  _syncCustomPairsToPrimarySelect() {
    if (!this.rpsInstrumentEl) return;
    const existingVals = new Set(Array.from(this.rpsInstrumentEl.options).map((o) => o.value));
    for (const p of this.customExtraPairs) {
      const val = `${p.source}:${p.symbol}:${p.display}`;
      if (!existingVals.has(val)) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = `${p.source.toUpperCase()} · ${p.display}`;
        this.rpsInstrumentEl.appendChild(opt);
        existingVals.add(val);
      }
    }
  }

  _renderExtraPairsChips(checkedKeys = null) {
    if (!this.rpsExtraPairsEl) return;
    const prevChecked =
      checkedKeys ||
      new Set(
        Array.from(this.rpsExtraPairsEl.querySelectorAll('input[type="checkbox"]:checked')).map(
          (cb) => cb.value
        )
      );

    this.rpsExtraPairsEl.innerHTML = '';
    const seen = new Set();
    const allItems = [
      ...DEFAULT_EXTRA_PAIRS.map((p) => ({ ...p, isCustom: false })),
      ...this.customExtraPairs.map((p) => ({ ...p, isCustom: true })),
    ];

    for (const p of allItems) {
      const key = `${p.source}:${p.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const val = `${p.source}:${p.symbol}:${p.display || p.symbol}`;
      const lbl = document.createElement('label');
      lbl.className = 'pair-chip';
      const srcBadge = p.source !== 'oanda' ? `<span class="pair-chip-src">${escapeHtml(p.source)}</span>` : '';
      const delBtn = p.isCustom
        ? `<button type="button" class="pair-chip-del" title="Remove custom pair" aria-label="Remove ${escapeHtml(p.display)}">×</button>`
        : '';
      lbl.innerHTML = `
        <input type="checkbox" value="${escapeHtml(val)}" ${prevChecked.has(val) ? 'checked' : ''}>
        <span>${escapeHtml(p.display || p.symbol)}</span>
        ${srcBadge}
        ${delBtn}
      `;
      if (p.isCustom) {
        lbl.querySelector('.pair-chip-del')?.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.customExtraPairs = this.customExtraPairs.filter(
            (item) => !(item.source === p.source && item.symbol === p.symbol)
          );
          this._saveCustomExtraPairs();
          this._renderExtraPairsChips();
        });
      }
      this.rpsExtraPairsEl.appendChild(lbl);
    }
  }

  _resolveCustomPairInput(rawInput, selectedSource) {
    const cleaned = String(rawInput || '').trim();
    if (!cleaned) return null;
    const upper = cleaned.toUpperCase();
    const compact = upper.replace(/[\s/_-]/g, '');

    // 1. Try exact match in symbol catalog for selected source first
    const bySource = this.symbolCatalog.find(
      (s) =>
        s.source === selectedSource &&
        (s.display.toUpperCase() === upper ||
          s.symbol.toUpperCase() === upper ||
          s.display.toUpperCase().replace(/[\s/_-]/g, '') === compact ||
          s.symbol.toUpperCase().replace(/[\s/_-]/g, '') === compact)
    );
    if (bySource) {
      return { source: bySource.source, symbol: bySource.symbol, display: bySource.display };
    }

    // 2. Try exact match across any replay-compatible catalog source
    const replaySources = new Set(['oanda', 'binance', 'coinbase', 'bybit', 'kraken', 'cme']);
    const anyMatch = this.symbolCatalog.find(
      (s) =>
        replaySources.has(s.source) &&
        (s.display.toUpperCase() === upper ||
          s.symbol.toUpperCase() === upper ||
          s.display.toUpperCase().replace(/[\s/_-]/g, '') === compact)
    );
    if (anyMatch) {
      return { source: anyMatch.source, symbol: anyMatch.symbol, display: anyMatch.display };
    }

    // 3. Smart fallback formatting by source
    if (selectedSource === 'oanda') {
      if (upper === 'DXY') return { source: 'oanda', symbol: 'DXY', display: 'DXY' };
      const sym = upper.includes('_')
        ? upper
        : upper.includes('/')
        ? upper.replace('/', '_')
        : upper.length === 6
        ? `${upper.slice(0, 3)}_${upper.slice(3)}`
        : upper;
      const disp = sym.includes('_') ? sym.replace('_', '/') : sym;
      return { source: 'oanda', symbol: sym, display: disp };
    }
    if (selectedSource === 'binance' || selectedSource === 'bybit') {
      const sym = compact;
      const disp = sym.endsWith('USDT') ? `${sym.slice(0, -4)}/USDT` : upper;
      return { source: selectedSource, symbol: sym, display: disp };
    }
    if (selectedSource === 'coinbase') {
      const sym = upper.includes('-')
        ? upper
        : upper.includes('/')
        ? upper.replace('/', '-')
        : `${upper}-USD`;
      return { source: 'coinbase', symbol: sym, display: sym.replace('-', '/') };
    }
    if (selectedSource === 'kraken') {
      const sym = upper.includes('/') ? upper : `${upper}/USD`;
      return { source: 'kraken', symbol: sym, display: sym };
    }
    return { source: selectedSource, symbol: upper, display: upper };
  }

  _handleAddCustomExtraPair() {
    const raw = this.rpsAddPairInputEl?.value || '';
    const src = this.rpsAddPairSourceEl?.value || 'oanda';
    const pair = this._resolveCustomPairInput(raw, src);
    if (!pair) {
      if (this.rpsFeedbackEl) this.rpsFeedbackEl.textContent = 'Enter a pair symbol (e.g. USD/JPY, XAG/USD, ETHUSDT).';
      this.rpsAddPairInputEl?.focus();
      return;
    }

    const val = `${pair.source}:${pair.symbol}:${pair.display}`;
    const alreadyDefault = DEFAULT_EXTRA_PAIRS.some(
      (p) => p.source === pair.source && p.symbol === pair.symbol
    );
    const alreadyCustom = this.customExtraPairs.some(
      (p) => p.source === pair.source && p.symbol === pair.symbol
    );
    if (!alreadyDefault && !alreadyCustom) {
      this.customExtraPairs.push(pair);
      this._saveCustomExtraPairs();
    }

    const checked = new Set(
      Array.from(this.rpsExtraPairsEl?.querySelectorAll('input[type="checkbox"]:checked') || []).map(
        (cb) => cb.value
      )
    );
    checked.add(val);
    this._renderExtraPairsChips(checked);
    this._syncCustomPairsToPrimarySelect();

    if (this.rpsAddPairInputEl) this.rpsAddPairInputEl.value = '';
    if (this.rpsFeedbackEl) {
      this.rpsFeedbackEl.textContent = `Added ${pair.display} (${pair.source.toUpperCase()}) to synced pairs.`;
    }
  }

  async openSessionDialog() {
    this.pause();
    if (this.rpsFeedbackEl) this.rpsFeedbackEl.textContent = '';
    this._renderExtraPairsChips();
    await Promise.all([this.refreshServerLists(), this._ensureSymbolCatalog(), this.refreshArchiveList()]);
    this.sessionDialog?.showModal();
  }

  // ==========================================================================
  // Replay Session Rename & Save As (Named Snapshot Copy)
  // ==========================================================================
  async renameActiveSession() {
    if (!this.session) {
      this.host.showToast('No Active Session', 'Open or start a Backtest session first.');
      return;
    }
    const nextName = await this.host.openTextPrompt(
      'Rename Backtest Session',
      this.session.name || '',
      'Updates the saved name of this backtest session.',
      'e.g. XAUUSD London Sweep - FTMO'
    );
    if (!nextName || !nextName.trim()) return;
    this.session.name = nextName.trim();
    if (this.rpSessionNameEl) this.rpSessionNameEl.textContent = this.session.name;
    await this.saveSessionSoon(true);
    this.host.showToast('✎ Session Renamed', `Saved as "${this.session.name}"`);
  }

  async saveSessionAs() {
    if (!this.session) {
      this.host.showToast('No Active Session', 'Open or start a Backtest session first.');
      return;
    }
    const defaultCopyName = `${this.session.name || 'Backtest'} - Copy`;
    const chosen = await this.host.openTextPrompt(
      'Save Backtest Session As',
      defaultCopyName,
      'Saves a new named copy of your trades, drawings & replay position.',
      'e.g. XAUUSD NY Session V2'
    );
    if (!chosen || !chosen.trim()) return;

    const cloned = JSON.parse(JSON.stringify(this.session));
    cloned.id = `bt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    cloned.name = chosen.trim();

    try {
      const res = await fetch('/api/replay/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: cloned }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save session copy');
      if (Array.isArray(data.sessions)) this.sessions = data.sessions;
      this.session = data.session || cloned;
      if (this.rpSessionNameEl) this.rpSessionNameEl.textContent = this.session.name;
      this._renderSavedSessionsList();
      this.host.showToast('💾 Saved As', `Created named backtest "${this.session.name}"`);
    } catch (err) {
      this.host.showToast('Save Failed', err.message || 'Could not save session.');
    }
  }

  // ==========================================================================
  // Offline Backtest Data Archive & Incremental Delta Sync
  // ==========================================================================
  async refreshArchiveList() {
    try {
      const res = await fetch('/api/archive');
      const data = await res.json();
      if (Array.isArray(data.entries)) this.archiveEntries = data.entries;
      if (data.presets) this.archivePresets = data.presets;
      this._syncArchiveEntriesToPrimarySelect();
      this._renderArchiveEntries();
    } catch {
      // ignore
    }
  }

  async openArchiveDialog() {
    this.pause();
    if (this.arcFeedbackEl) this.arcFeedbackEl.textContent = '';
    await this.refreshArchiveList();
    this._populateArchiveSymbols();
    this.archiveDialog?.showModal();
  }

  _populateArchiveSymbols() {
    if (!this.arcSymbolEl) return;
    const src = this.arcSourceEl?.value || 'dukascopy';
    let items = [];
    if (src === 'dukascopy') {
      items = this.archivePresets?.dukascopy || [
        { symbol: 'XAUUSD', display: 'XAU/USD (Gold)' },
        { symbol: 'EURUSD', display: 'EUR/USD' },
        { symbol: 'GBPUSD', display: 'GBP/USD' },
        { symbol: 'DOLLARIDXUSD', display: 'DXY (US Dollar Index)' },
        { symbol: 'USDJPY', display: 'USD/JPY' },
        { symbol: 'USDCAD', display: 'USD/CAD' },
        { symbol: 'USATECHIDXUSD', display: 'NAS100' },
        { symbol: 'USA500IDXUSD', display: 'SPX500' },
      ];
    } else if (src === 'databento') {
      items = this.archivePresets?.databento || [
        { symbol: '6E.v.0', display: '6E1! (CME Euro FX)' },
        { symbol: '6B.v.0', display: '6B1! (CME British Pound)' },
        { symbol: 'GC.v.0', display: 'GC1! (COMEX Gold)' },
        { symbol: 'SI.v.0', display: 'SI1! (COMEX Silver)' },
        { symbol: 'ES.v.0', display: 'ES1! (CME S&P 500)' },
        { symbol: 'NQ.v.0', display: 'NQ1! (CME Nasdaq-100)' },
        { symbol: 'CL.v.0', display: 'CL1! (NYMEX WTI Oil)' },
        { symbol: 'BZ.v.0', display: 'BZ1! (NYMEX Brent Oil)' },
        { symbol: '6C.v.0', display: '6C1! (CME Canadian Dollar)' },
        { symbol: '6S.v.0', display: '6S1! (CME Swiss Franc)' },
        { symbol: '6A.v.0', display: '6A1! (CME Australian Dollar)' },
        { symbol: 'BTC.v.0', display: 'BTC1! (CME Bitcoin)' },
        { symbol: 'ETH.v.0', display: 'ETH1! (CME Ether)' },
      ];
    } else if (src === 'oanda') {
      items = [
        { symbol: 'XAU_USD', display: 'XAU/USD (Gold)' },
        { symbol: 'XAG_USD', display: 'XAG/USD (Silver)' },
        { symbol: 'EUR_USD', display: 'EUR/USD' },
        { symbol: 'GBP_USD', display: 'GBP/USD' },
        { symbol: 'EUR_GBP', display: 'EUR/GBP' },
        { symbol: 'DXY', display: 'DXY (Synthetic ICE)' },
        { symbol: 'USD_JPY', display: 'USD/JPY' },
        { symbol: 'USD_CAD', display: 'USD/CAD' },
        { symbol: 'AUD_USD', display: 'AUD/USD' },
        { symbol: 'USD_CHF', display: 'USD/CHF' },
        { symbol: 'NAS100_USD', display: 'NAS100' },
        { symbol: 'SPX500_USD', display: 'SPX500' },
        { symbol: 'WTICO_USD', display: 'WTI Oil' },
        { symbol: 'BCO_USD', display: 'Brent Oil' },
      ];
    } else {
      items = [
        { symbol: 'BTCUSDT', display: 'BTC/USDT' },
        { symbol: 'ETHUSDT', display: 'ETH/USDT' },
        { symbol: 'SOLUSDT', display: 'SOL/USDT' },
      ];
    }
    this.arcSymbolEl.innerHTML = items
      .map((i) => `<option value="${escapeHtml(i.symbol)}">${escapeHtml(i.display)}</option>`)
      .join('');
  }

  _confirmArchiveDownload({ source, display, actionLabel }) {
    const src = String(source || '').toLowerCase();
    if (src === 'databento') {
      return window.confirm(t('confirm.databento', { display, action: actionLabel }));
    }
    return window.confirm(t('confirm.free', { source: src.toUpperCase(), display, action: actionLabel }));
  }

  _syncArchiveEntriesToPrimarySelect() {
    if (!this.rpsInstrumentEl) return;
    const prevValue = this.rpsInstrumentEl.value;
    this.rpsInstrumentEl.innerHTML = '';

    const offlineKeys = new Set();
    const groups = {
      databento: [],
      oanda: [],
      binance: [],
      other: [],
    };

    const sorted = [...(this.archiveEntries || [])].sort((a, b) =>
      String(a.display || a.symbol).localeCompare(String(b.display || b.symbol))
    );

    for (const e of sorted) {
      const src = String(e.source || '').toLowerCase();
      offlineKeys.add(`${src}:${e.symbol}`);
      const bucket = groups[src] || groups.other;
      bucket.push(e);
    }

    const fmtRange = (e) => {
      const m1Start = e.firstTime ? new Date(e.firstTime * 1000).getUTCFullYear() : '';
      const m1End = e.lastTime ? new Date(e.lastTime * 1000).getUTCFullYear() : '';
      const h1Start = e.htf1hFirstTime ? new Date(e.htf1hFirstTime * 1000).getUTCFullYear() : '';
      const parts = [];
      if (m1Start && m1End) parts.push(`1m ${m1Start}–${m1End}`);
      if (h1Start) parts.push(`1h ${h1Start}+`);
      return parts.length ? ` (${parts.join(' · ')})` : ' (Offline)';
    };

    const appendOfflineGroup = (label, list) => {
      if (!list.length) return;
      const og = document.createElement('optgroup');
      og.label = label;
      for (const e of list) {
        const opt = document.createElement('option');
        opt.value = `${e.source}:${e.symbol}:${e.display}`;
        opt.textContent = `📦 ${e.display}${fmtRange(e)}`;
        og.appendChild(opt);
      }
      this.rpsInstrumentEl.appendChild(og);
    };

    appendOfflineGroup(t('grp.offlineCme'), groups.databento);
    appendOfflineGroup(t('grp.offlineOanda'), groups.oanda);
    appendOfflineGroup(t('grp.offlineBinance'), groups.binance);
    appendOfflineGroup(t('grp.offlineCustom'), groups.other);

    // Online-only fallback pairs (ONLY shown if NOT already downloaded locally!)
    const onlineDefaults = [
      { source: 'oanda', symbol: 'XAU_USD', display: 'XAU/USD (Gold)' },
      { source: 'oanda', symbol: 'EUR_USD', display: 'EUR/USD' },
      { source: 'oanda', symbol: 'GBP_USD', display: 'GBP/USD' },
      { source: 'oanda', symbol: 'DXY', display: 'DXY (US Dollar Index)' },
      { source: 'oanda', symbol: 'NAS100_USD', display: 'NAS100' },
      { source: 'oanda', symbol: 'SPX500_USD', display: 'SPX500' },
      { source: 'oanda', symbol: 'US30_USD', display: 'US30' },
      { source: 'oanda', symbol: 'USD_JPY', display: 'USD/JPY' },
      { source: 'oanda', symbol: 'USD_CAD', display: 'USD/CAD' },
      { source: 'oanda', symbol: 'AUD_USD', display: 'AUD/USD' },
      { source: 'oanda', symbol: 'USD_CHF', display: 'USD/CHF' },
      { source: 'oanda', symbol: 'EUR_GBP', display: 'EUR/GBP' },
      { source: 'oanda', symbol: 'XAG_USD', display: 'XAG/USD (Silver)' },
      { source: 'oanda', symbol: 'WTICO_USD', display: 'WTI Oil' },
      { source: 'oanda', symbol: 'BCO_USD', display: 'Brent Oil' },
      { source: 'binance', symbol: 'BTCUSDT', display: 'BTC/USDT' },
      { source: 'binance', symbol: 'ETHUSDT', display: 'ETH/USDT' },
      { source: 'binance', symbol: 'SOLUSDT', display: 'SOL/USDT' },
      { source: 'coinbase', symbol: 'BTC-USD', display: 'BTC/USD' },
      { source: 'bybit', symbol: 'BTCUSDT', display: 'BTC/USDT' },
    ];
    const remainingOnline = onlineDefaults.filter((d) => !offlineKeys.has(`${d.source}:${d.symbol}`));
    if (remainingOnline.length) {
      const og = document.createElement('optgroup');
      og.label = t('grp.online');
      for (const d of remainingOnline) {
        const opt = document.createElement('option');
        opt.value = `${d.source}:${d.symbol}:${d.display}`;
        opt.textContent = `🌐 ${d.source.toUpperCase()} · ${d.display}`;
        og.appendChild(opt);
      }
      this.rpsInstrumentEl.appendChild(og);
    }

    if (prevValue && Array.from(this.rpsInstrumentEl.options).some((o) => o.value === prevValue)) {
      this.rpsInstrumentEl.value = prevValue;
    }
  }

  _renderArchiveEntries() {
    if (!this.arcEntriesListEl) return;
    this.arcEntriesListEl.innerHTML = '';
    if (!this.archiveEntries.length) {
      this.arcEntriesListEl.innerHTML =
        `<div style="padding:14px;text-align:center;color:var(--text-secondary);font-size:12px;">${escapeHtml(t('arc.empty'))}</div>`;
      return;
    }

    for (const e of this.archiveEntries) {
      const card = document.createElement('div');
      card.className = 'saved-layout-card';
      const fromStr = e.firstTime ? new Date(e.firstTime * 1000).toISOString().slice(0, 10) : '--';
      const toStr = e.lastTime ? new Date(e.lastTime * 1000).toISOString().slice(0, 10) : '--';
      const h1Str =
        e.htf1hFirstTime && e.htf1hBarCount
          ? ` · <b>1h+</b> from ${new Date(e.htf1hFirstTime * 1000).toISOString().slice(0, 10)}`
          : '';
      const canAutoSync = ['dukascopy', 'oanda', 'databento', 'binance', 'coinbase', 'bybit'].includes(e.source);

      card.innerHTML = `
        <div class="saved-layout-info">
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="source-pill ${escapeHtml(e.source)}">${escapeHtml(e.source.toUpperCase())}</span>
            <span class="saved-layout-name">${escapeHtml(e.display)}</span>
          </div>
          <span class="saved-layout-meta"><b>1m:</b> ${fromStr} → ${toStr} (${Number(e.barCount || 0).toLocaleString()} bars)${h1Str}</span>
        </div>
        <div class="saved-layout-actions">
          ${canAutoSync ? `<button type="button" class="btn-secondary arc-older-btn" title="${escapeHtml(t('action.extend6m'))}">${escapeHtml(t('arc.olderBtn'))}</button>` : ''}
          ${canAutoSync ? `<button type="button" class="btn-secondary arc-sync-btn" title="${escapeHtml(t('action.updateMissing'))}">${escapeHtml(t('arc.updateBtn'))}</button>` : ''}
          <button type="button" class="btn-primary arc-use-btn">${escapeHtml(t('arc.backtestBtn'))}</button>
          <button type="button" class="btn-danger-sm arc-del-btn">${escapeHtml(t('arc.deleteBtn'))}</button>
        </div>
      `;

      card.querySelector('.arc-older-btn')?.addEventListener('click', async (ev) => {
        if (!this._confirmArchiveDownload({ source: e.source, display: e.display, actionLabel: t('action.extend6m') })) {
          return;
        }
        const btn = ev.currentTarget;
        btn.disabled = true;
        btn.textContent = t('arc.pulling');
        if (this.arcFeedbackEl) {
          this.arcFeedbackEl.textContent = `Downloading 6 months of older 1m bars for ${e.display}...`;
        }
        try {
          const res = await fetch('/api/archive/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source: e.source,
              symbol: e.symbol,
              display: e.display,
              mode: 'extend_older',
              extendDays: 180,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Extend older failed');
          if (Array.isArray(data.entries)) this.archiveEntries = data.entries;
          this._syncArchiveEntriesToPrimarySelect();
          this._renderArchiveEntries();
          if (this.arcFeedbackEl) this.arcFeedbackEl.textContent = data.message || 'Extended older history!';
        } catch (err) {
          if (this.arcFeedbackEl) this.arcFeedbackEl.textContent = err.message;
          btn.disabled = false;
          btn.textContent = '⏪ -6M';
        }
      });

      card.querySelector('.arc-sync-btn')?.addEventListener('click', async (ev) => {
        if (!this._confirmArchiveDownload({ source: e.source, display: e.display, actionLabel: t('action.updateMissing') })) {
          return;
        }
        const btn = ev.currentTarget;
        btn.disabled = true;
        btn.textContent = t('arc.syncing');
        if (this.arcFeedbackEl) this.arcFeedbackEl.textContent = `Fetching only missing bars for ${e.display}...`;
        try {
          const res = await fetch('/api/archive/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source: e.source,
              symbol: e.symbol,
              display: e.display,
              mode: 'missing',
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Delta sync failed');
          if (Array.isArray(data.entries)) this.archiveEntries = data.entries;
          this._syncArchiveEntriesToPrimarySelect();
          this._renderArchiveEntries();
          if (this.arcFeedbackEl) this.arcFeedbackEl.textContent = data.message || 'Updated!';
        } catch (err) {
          if (this.arcFeedbackEl) this.arcFeedbackEl.textContent = err.message;
          btn.disabled = false;
          btn.textContent = '🔄 Update';
        }
      });

      card.querySelector('.arc-use-btn')?.addEventListener('click', () => {
        this._syncArchiveEntriesToPrimarySelect();
        const val = `${e.source}:${e.symbol}:${e.display}`;
        if (this.rpsInstrumentEl) this.rpsInstrumentEl.value = val;
        if (this.rpsStartDayEl && e.firstTime) {
          this.rpsStartDayEl.value = new Date((e.firstTime + 86400) * 1000).toISOString().slice(0, 10);
        }
        this.archiveDialog?.close();
        if (!this.sessionDialog?.open) this.openSessionDialog();
      });

      card.querySelector('.arc-del-btn')?.addEventListener('click', async () => {
        const res = await fetch(
          `/api/archive?source=${encodeURIComponent(e.source)}&symbol=${encodeURIComponent(e.symbol)}`,
          { method: 'DELETE' }
        );
        const data = await res.json();
        if (Array.isArray(data.entries)) {
          this.archiveEntries = data.entries;
          this._renderArchiveEntries();
        }
      });

      this.arcEntriesListEl.appendChild(card);
    }
  }

  async _handleArchiveDownload(e) {
    e.preventDefault();
    const source = this.arcSourceEl?.value || 'oanda';
    const symbol = this.arcSymbolEl?.value || '';
    const display = this.arcSymbolEl?.selectedOptions?.[0]?.textContent || symbol;
    const fromMs = Date.parse(`${this.arcFromDayEl?.value || ''}T00:00:00Z`);
    const toMs = Date.parse(`${this.arcToDayEl?.value || ''}T23:59:00Z`);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
      if (this.arcFeedbackEl) this.arcFeedbackEl.textContent = 'Please select a valid From / To date range.';
      return;
    }
    const rangeLabel = `${this.arcFromDayEl?.value} → ${this.arcToDayEl?.value}`;
    if (!this._confirmArchiveDownload({ source, display, actionLabel: rangeLabel })) {
      return;
    }

    if (this.arcDownloadBtn) {
      this.arcDownloadBtn.disabled = true;
      this.arcDownloadBtn.textContent = 'Downloading...';
    }
    if (this.arcFeedbackEl) {
      this.arcFeedbackEl.textContent = `Downloading ${display} (${source.toUpperCase()}) 1m candles...`;
    }
    try {
      const res = await fetch('/api/archive/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          symbol,
          display,
          fromSec: Math.floor(fromMs / 1000),
          toSec: Math.floor(toMs / 1000),
          mode: 'range',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Download failed');
      if (Array.isArray(data.entries)) this.archiveEntries = data.entries;
      this._syncArchiveEntriesToPrimarySelect();
      this._renderArchiveEntries();
      if (this.arcFeedbackEl) this.arcFeedbackEl.textContent = data.message || 'Downloaded!';
    } catch (err) {
      if (this.arcFeedbackEl) this.arcFeedbackEl.textContent = err.message;
    } finally {
      if (this.arcDownloadBtn) {
        this.arcDownloadBtn.disabled = false;
        this.arcDownloadBtn.textContent = '⬇ Download Range';
      }
    }
  }

  async _handleArchiveImportCsv() {
    const files = Array.from(this.arcImportFileEl?.files || []);
    if (!files.length) return;
    let importedCount = 0;
    let lastMsg = '';
    try {
      for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx];
        const isZip = /\.zip$/i.test(file.name);
        if (isZip) {
          if (this.arcFeedbackEl) {
            const mb = (file.size / 1048576).toFixed(1);
            this.arcFeedbackEl.textContent = `Importing ${file.name} (${mb} MB)... Extracting all pairs, please wait...`;
          }
          const res = await fetch('/api/archive/import-zip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: file,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(`${file.name}: ${data.error || 'ZIP import failed'}`);
          if (Array.isArray(data.entries)) this.archiveEntries = data.entries;
          importedCount += Number(data.importedFiles || 1);
          lastMsg = data.message || `Imported ${file.name}!`;
          continue;
        }

        const isGz = /\.gz$/i.test(file.name);
        const symLabel =
          (files.length === 1 ? this.arcImportSymbolEl?.value.trim() : '') ||
          file.name.replace(/\.(csv|txt|json\.gz|json|gz)$/i, '').slice(0, 32);
        if (this.arcFeedbackEl) {
          this.arcFeedbackEl.textContent = `Importing ${file.name} (${idx + 1}/${files.length})...`;
        }
        let payloadText = '';
        if (isGz) {
          const buf = new Uint8Array(await file.arrayBuffer());
          let bin = '';
          const CHUNK = 0x8000;
          for (let i = 0; i < buf.length; i += CHUNK) {
            bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
          }
          payloadText = btoa(bin);
        } else {
          payloadText = await file.text();
        }
        const res = await fetch('/api/archive/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'custom',
            symbol: symLabel.replace(/[^a-zA-Z0-9._-]/g, '_'),
            display: symLabel,
            csvText: payloadText,
            isGzipBase64: isGz,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`${file.name}: ${data.error || 'Import failed'}`);
        if (Array.isArray(data.entries)) this.archiveEntries = data.entries;
        importedCount += 1;
      }
      this._syncArchiveEntriesToPrimarySelect();
      this._renderArchiveEntries();
      if (this.arcImportSymbolEl) this.arcImportSymbolEl.value = '';
      if (this.arcFeedbackEl) {
        this.arcFeedbackEl.textContent =
          lastMsg || `Imported ${importedCount} file${importedCount === 1 ? '' : 's'} into offline archive!`;
      }
    } catch (err) {
      if (this.arcFeedbackEl) this.arcFeedbackEl.textContent = err.message;
    } finally {
      this.arcImportFileEl.value = '';
    }
  }

  _renderPropRulesSelect() {
    if (!this.rpsPropRuleEl) return;
    const prev = this.rpsPropRuleEl.value || 'ftmo_2step';
    this.rpsPropRuleEl.innerHTML = this.propRules
      .map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`)
      .join('');
    if (this.propRules.some((r) => r.id === prev)) {
      this.rpsPropRuleEl.value = prev;
    }
    this._syncPropRuleSelection();

    // Custom saved rules chips
    if (this.cprSavedListEl) {
      const custom = this.propRules.filter((r) => !r.builtin);
      this.cprSavedListEl.innerHTML = '';
      for (const r of custom) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tpl-chip';
        chip.innerHTML = `<span>${escapeHtml(r.name)} (${r.dailyMaxLossPct}%/${r.totalMaxLossPct}% → ${r.profitTargetPct}%)</span><span class="tpl-del" title="Delete custom rule">×</span>`;
        chip.addEventListener('click', async (e) => {
          if (e.target.closest('.tpl-del')) {
            e.stopPropagation();
            const res = await fetch(`/api/replay/prop-rules/${encodeURIComponent(r.id)}`, {
              method: 'DELETE',
            });
            const data = await res.json();
            if (Array.isArray(data.rules)) {
              this.propRules = data.rules;
              this._renderPropRulesSelect();
            }
            return;
          }
          this.rpsPropRuleEl.value = r.id;
          this._syncPropRuleSelection();
        });
        this.cprSavedListEl.appendChild(chip);
      }
    }
  }

  _syncPropRuleSelection() {
    const rule = this.propRules.find((r) => r.id === this.rpsPropRuleEl?.value) || this.propRules[0];
    if (!rule) return;
    if (this.rpsSpreadEl && Number.isFinite(rule.defaultSpreadPips)) {
      this.rpsSpreadEl.value = String(rule.defaultSpreadPips);
    }
    if (this.rpsCommEl && Number.isFinite(rule.defaultCommissionPerLot)) {
      this.rpsCommEl.value = String(rule.defaultCommissionPerLot);
    }
    if (this.rpsRuleSummaryEl) {
      const parts = [];
      if (rule.dailyMaxLossPct > 0) parts.push(`Daily Max Loss: ${rule.dailyMaxLossPct}%`);
      if (rule.totalMaxLossPct > 0) {
        parts.push(`Total Max Loss: ${rule.totalMaxLossPct}%${rule.trailingDrawdown ? ' (Trailing)' : ' (Static)'}`);
      }
      if (rule.profitTargetPct > 0) parts.push(`Profit Target: ${rule.profitTargetPct}%`);
      if (rule.minTradingDays > 0) parts.push(`Min Days: ${rule.minTradingDays}`);
      this.rpsRuleSummaryEl.textContent = parts.length
        ? `${rule.name}: ${parts.join(' · ')}`
        : `${rule.name}: No drawdown or target restrictions.`;
    }
  }

  async _handleSaveCustomRule(e) {
    e.preventDefault();
    const payload = {
      name: document.getElementById('cpr-name').value.trim(),
      dailyMaxLossPct: Number(document.getElementById('cpr-daily').value) || 0,
      totalMaxLossPct: Number(document.getElementById('cpr-total').value) || 0,
      profitTargetPct: Number(document.getElementById('cpr-target').value) || 0,
      minTradingDays: Number(document.getElementById('cpr-mindays').value) || 0,
      defaultSpreadPips: Number(document.getElementById('cpr-spread').value) || 0,
      defaultCommissionPerLot: Number(document.getElementById('cpr-comm').value) || 0,
      trailingDrawdown: document.getElementById('cpr-trailing').checked,
    };
    try {
      const res = await fetch('/api/replay/prop-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save rule');
      this.propRules = data.rules || this.propRules;
      this._renderPropRulesSelect();
      if (data.rule?.id) {
        this.rpsPropRuleEl.value = data.rule.id;
        this._syncPropRuleSelection();
      }
      document.getElementById('cpr-name').value = '';
      this.customRuleForm.hidden = true;
      this.rpsFeedbackEl.textContent = `Saved custom rule "${payload.name}"!`;
    } catch (err) {
      this.rpsFeedbackEl.textContent = err.message;
    }
  }

  _renderSavedSessionsList() {
    if (!this.rpSessionsListEl) return;
    this.rpSessionsListEl.innerHTML = '';
    if (!this.sessions.length) {
      this.rpSessionsListEl.innerHTML =
        '<div style="padding:14px;text-align:center;color:var(--text-secondary);font-size:12px;">No saved backtest sessions yet. Create your first FTMO / The5ers / Custom session above!</div>';
      return;
    }

    for (const s of this.sessions) {
      const card = document.createElement('div');
      card.className = 'saved-layout-card';
      const pnl = (s.balance ?? s.initialBalance) - s.initialBalance;
      const pct = s.initialBalance ? (pnl / s.initialBalance) * 100 : 0;
      const pnlColor = pnl >= 0 ? 'var(--up)' : 'var(--down)';
      const tradesCnt = Array.isArray(s.trades) ? s.trades.length : 0;
      card.innerHTML = `
        <div class="saved-layout-info">
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="source-pill ${escapeHtml(s.source || 'oanda')}">${escapeHtml((s.source || 'oanda').toUpperCase())}</span>
            <span class="saved-layout-name">${escapeHtml(s.name)}</span>
          </div>
          <span class="saved-layout-meta">${escapeHtml(s.display || s.symbol)} · ${escapeHtml(s.propRule?.name || 'Custom')} · ${tradesCnt} trades · <b style="color:${pnlColor}">${fmtUsd(pnl, true)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)</b></span>
        </div>
        <div class="saved-layout-actions">
          <button type="button" class="btn-primary load-sess-btn">Resume</button>
          <button type="button" class="btn-danger-sm del-sess-btn">Delete</button>
        </div>
      `;

      card.querySelector('.load-sess-btn').addEventListener('click', async () => {
        this.sessionDialog?.close();
        await this.loadSession(s);
      });

      card.querySelector('.del-sess-btn').addEventListener('click', async () => {
        const res = await fetch(`/api/replay/sessions/${encodeURIComponent(s.id)}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (Array.isArray(data.sessions)) {
          this.sessions = data.sessions;
          this._renderSavedSessionsList();
        }
      });

      this.rpSessionsListEl.appendChild(card);
    }
  }

  async _handleCreateSession(e) {
    e.preventDefault();
    const [source, symbol, display] = String(this.rpsInstrumentEl.value || 'oanda:XAU_USD:XAU/USD').split(':');
    const rawDay = this.rpsStartDayEl?.value || '';
    const rawTime = this.rpsStartTimeEl?.value || '08:00';
    const startMs = Date.parse(`${rawDay}T${rawTime}:00Z`);
    if (!Number.isFinite(startMs)) {
      this.rpsFeedbackEl.textContent = 'Please select a valid start date.';
      return;
    }
    const startTime = Math.floor(startMs / 1000);

    // Optional End Date / Duration
    const dur = this.rpsDurationEl?.value || 'unlimited';
    let endTime = null;
    if (dur === '1d') endTime = startTime + 86400;
    else if (dur === '1w') endTime = startTime + 7 * 86400;
    else if (dur === '2w') endTime = startTime + 14 * 86400;
    else if (dur === '1m') endTime = startTime + 30 * 86400;
    else if (dur === 'custom' && this.rpsEndDayEl?.value) {
      const ems = Date.parse(`${this.rpsEndDayEl.value}T23:59:00Z`);
      if (Number.isFinite(ems) && ems > startMs) endTime = Math.floor(ems / 1000);
    }

    // Additional selected multi-pairs (e.g. DXY, EUR/USD, NAS100 alongside XAU/USD)
    const extraPairs = [];
    const primaryKey = `${source}:${symbol}`;
    for (const cb of this.rpsExtraPairsEl?.querySelectorAll('input[type="checkbox"]:checked') || []) {
      const [esrc, esym, edisp] = String(cb.value).split(':');
      if (esrc && esym && `${esrc}:${esym}` !== primaryKey) {
        extraPairs.push({ source: esrc, symbol: esym, display: edisp || esym });
      }
    }

    const initialBalance = Math.max(100, Number(this.rpsBalanceEl.value) || 100000);
    const rule = this.propRules.find((r) => r.id === this.rpsPropRuleEl.value) || this.propRules[0];
    const name =
      this.rpsNameEl.value.trim() ||
      `${display} · ${rule?.name?.split(' ')[0] || 'Backtest'} (${rawDay})`;

    const newSession = {
      id: `bt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name,
      source,
      symbol,
      display,
      extraPairs,
      startTime,
      endTime,
      cursorTime: startTime,
      initialBalance,
      balance: initialBalance,
      peakEquity: initialBalance,
      dailyStartEquity: initialBalance,
      dailyStartDay: utcDayKey(startTime),
      spreadPips: Math.max(0, Number(this.rpsSpreadEl.value) || 0),
      commissionPerLot: Math.max(0, Number(this.rpsCommEl.value) || 0),
      propRule: rule ? { ...rule } : null,
      positions: [],
      pendingOrders: [],
      trades: [],
      tradingDays: [],
      equityCurve: [{ time: startTime, balance: initialBalance, equity: initialBalance }],
      drawings: {},
      timeline: [
        {
          id: `st-${Date.now()}`,
          time: startTime,
          type: 'session_start',
          label: 'Session Started',
          detail: `${display} · ${fmtUsd(initialBalance)} · ${rule?.name || 'Custom'} · Spread ${Math.max(0, Number(this.rpsSpreadEl.value) || 0)}p`,
          mentorComment: '',
        },
      ],
      breachState: null, // null | 'daily_breach' | 'total_breach' | 'passed'
    };

    this.rpsFeedbackEl.textContent = `Loading historical 1m data for ${display}...`;
    try {
      const saveRes = await fetch('/api/replay/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: newSession }),
      });
      const saved = await saveRes.json();
      if (Array.isArray(saved.sessions)) this.sessions = saved.sessions;
      this.sessionDialog?.close();
      await this.loadSession(saved.session || newSession);
    } catch (err) {
      this.rpsFeedbackEl.textContent = err.message || 'Could not create session.';
    }
  }

  // ==========================================================================
  // Load Session & Zero-Lookahead MTF Hydration
  // ==========================================================================
  async loadSession(session) {
    this.pause();
    this.session = {
      ...session,
      positions: Array.isArray(session.positions) ? session.positions : [],
      pendingOrders: Array.isArray(session.pendingOrders) ? session.pendingOrders : [],
      trades: Array.isArray(session.trades) ? session.trades : [],
      tradingDays: Array.isArray(session.tradingDays) ? session.tradingDays : [],
      timeline: Array.isArray(session.timeline) ? session.timeline : [],
      equityCurve:
        Array.isArray(session.equityCurve) && session.equityCurve.length
          ? session.equityCurve
          : [{ time: session.startTime, balance: session.initialBalance, equity: session.initialBalance }],
      drawings: session.drawings && typeof session.drawings === 'object' ? session.drawings : {},
    };
    this.reviewTimeFilter = null;
    this.activeReviewStepIdx = -1;
    this._stopReviewStepsPlay();

    if (this.rpSessionNameEl) this.rpSessionNameEl.textContent = this.session.name;
    this.paneContexts.clear();
    this.m1BySymbol.clear();

    // Assign primary pair + any selected extra pairs (e.g. DXY, EUR/USD) cleanly across open panes!
    const allPanes = Array.from(this.host.getPanes().values());
    const extraPairs = Array.isArray(this.session.extraPairs) ? this.session.extraPairs : [];
    const uniqueTfs = new Set(allPanes.map((p) => p.state.tf));
    const defaultMtfOrder = ['1m', '15m', '1h', '4h', '1d', '1w'];
    allPanes.forEach((pane, idx) => {
      pane.setReplayMode(true);
      const assigned = idx > 0 && extraPairs[idx - 1] ? extraPairs[idx - 1] : this.session;
      pane.state.source = assigned.source;
      pane.state.symbol = assigned.symbol;
      pane.state.display = assigned.display;
      if (extraPairs.length === 0 && allPanes.length > 1 && uniqueTfs.size === 1) {
        pane.state.tf = defaultMtfOrder[idx % defaultMtfOrder.length];
        pane.updateTimeframeOptions(pane.timeframesList);
      }
      pane._syncHeaderLabels();
      pane._showOverlay(`Loading ${assigned.display} replay data...`, false);
    });

    // Fetch 1m replay stream covering [cursorTime - 1.5 days .. cursorTime + 4 days]
    const ok = await this._loadM1Window(this.session.cursorTime);
    if (!ok) return;

    // Load HTF context for every pane + historical economic news for this backtest window
    await Promise.all([
      ...allPanes.map((pane) => this.loadPaneReplayContext(pane, { fitView: true })),
      this._loadHistoricalReplayNews(this.session.cursorTime),
    ]);

    this._syncSessionDrawingsToPanes();
    this._syncTicketUi();
    this._updateAllUi();
  }

  async _loadM1Window(centerSec) {
    const s = this.session;
    if (!s) return false;
    const fromSec = centerSec - 2 * 86400;
    const toSec = Math.min(Math.floor(Date.now() / 1000), centerSec + 4 * 86400);

    // Helper to hydrate from embedded offline candle snapshot (e.g. when Mentor has no OANDA API key!)
    const useEmbeddedFallback = () => {
      if (!Array.isArray(s.embeddedM1Bars) || s.embeddedM1Bars.length === 0) return false;
      this.m1Bars = s.embeddedM1Bars.slice();
      this.m1Meta = {
        precision: s.embeddedPrecision ?? getInstrumentSpec(s.symbol, this.m1Bars[0]?.close || 1).precision,
        display: s.display || s.symbol,
      };
      let idx = 0;
      for (let i = 0; i < this.m1Bars.length; i++) {
        if (this.m1Bars[i].time <= centerSec) idx = i;
        else break;
      }
      this.m1Index = idx;
      this.session.cursorTime = this.m1Bars[idx].time;
      this.m1BySymbol.set(`${s.source}:${s.symbol}`, { bars: this.m1Bars, meta: this.m1Meta });
      return true;
    };

    // If this is an imported portable review pack with embedded candles covering centerSec, load instantly!
    if (
      Array.isArray(s.embeddedM1Bars) &&
      s.embeddedM1Bars.length > 0 &&
      centerSec >= s.embeddedM1Bars[0].time &&
      centerSec <= s.embeddedM1Bars[s.embeddedM1Bars.length - 1].time + 3600
    ) {
      return useEmbeddedFallback();
    }

    try {
      const qs = new URLSearchParams({
        source: s.source,
        symbol: s.symbol,
        tf: '1m',
        from: String(fromSec),
        to: String(toSec),
        count: '9000',
      });
      const res = await fetch(`/api/replay/bars?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        if (useEmbeddedFallback()) return true;
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      this.m1Bars = Array.isArray(data.bars) ? data.bars : [];
      this.m1Meta = {
        precision: data.precision ?? getInstrumentSpec(s.symbol).precision,
        display: data.display || s.display,
      };
      if (this.m1Bars.length === 0) {
        if (useEmbeddedFallback()) return true;
        this.host.showToast(
          'No Historical Data',
          `No 1m bars found around ${fmtReplayTime(centerSec, 'UTC')}. Try a weekday market date.`
        );
        return false;
      }

      // Find bar index closest to <= centerSec
      let idx = 0;
      for (let i = 0; i < this.m1Bars.length; i++) {
        if (this.m1Bars[i].time <= centerSec) idx = i;
        else break;
      }
      this.m1Index = idx;
      this.session.cursorTime = this.m1Bars[idx].time;
      this.m1BySymbol.set(`${s.source}:${s.symbol}`, { bars: this.m1Bars, meta: this.m1Meta });
      return true;
    } catch (err) {
      if (useEmbeddedFallback()) return true;
      this.host.showToast('Replay Data Error', err.message);
      for (const pane of this.host.getPanes().values()) {
        pane._showOverlay(err.message, false);
      }
      return false;
    }
  }

  async _prefetchMoreForwardM1() {
    if (this.fetchingForward || !this.session || !this.m1Bars.length) return;
    const lastLoadedTime = this.m1Bars[this.m1Bars.length - 1].time;
    const nowSec = Math.floor(Date.now() / 1000);
    if (lastLoadedTime >= nowSec - 120) return;

    this.fetchingForward = true;
    try {
      const fromSec = lastLoadedTime + 1;
      const toSec = Math.min(nowSec, lastLoadedTime + 4 * 86400);
      const qs = new URLSearchParams({
        source: this.session.source,
        symbol: this.session.symbol,
        tf: '1m',
        from: String(fromSec),
        to: String(toSec),
        count: '6000',
      });
      const res = await fetch(`/api/replay/bars?${qs.toString()}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.bars) && data.bars.length) {
        const existingLast = this.m1Bars[this.m1Bars.length - 1].time;
        for (const b of data.bars) {
          if (b.time > existingLast) this.m1Bars.push(b);
        }
      }
    } catch {
      // ignore transient prefetch error
    } finally {
      this.fetchingForward = false;
    }
  }

  async _loadHistoricalReplayNews(centerSec) {
    if (Array.isArray(this.session?.embeddedNews) && this.session.embeddedNews.length > 0) {
      this.replayNewsEvents = this.session.embeddedNews;
      this.replayNewsWindow = [centerSec - 14 * 86400, centerSec + 14 * 86400];
      for (const pane of this.host.getPanes().values()) {
        pane.setReplayClock(this.session?.cursorTime);
        pane.setNewsEvents(this.replayNewsEvents.filter((e) => e.impact === 'High'));
      }
      this.host.onReplayNewsUpdate?.();
      return;
    }
    if (this.fetchingReplayNews) return;
    this.fetchingReplayNews = true;
    try {
      const from = centerSec - 7 * 86400;
      const to = centerSec + 14 * 86400;
      const res = await fetch(`/api/news?from=${from}&to=${to}&region=all`);
      const data = await res.json();
      this.replayNewsEvents = Array.isArray(data.events) ? data.events : [];
      this.replayNewsWindow = [from, to];
      for (const pane of this.host.getPanes().values()) {
        pane.setReplayClock(this.session?.cursorTime);
      }
      this.host.onReplayNewsUpdate?.();
    } catch {
      this.replayNewsEvents = [];
      this.host.onReplayNewsUpdate?.();
    } finally {
      this.fetchingReplayNews = false;
    }
  }

  async _ensureM1ForSymbol(source, symbol, display, centerSec) {
    const symKey = `${source}:${symbol}`;
    const existing = this.m1BySymbol.get(symKey);
    if (
      existing &&
      existing.bars.length > 0 &&
      centerSec >= existing.bars[0].time - 3600 &&
      centerSec <= existing.bars[existing.bars.length - 1].time + 3600
    ) {
      return existing;
    }

    const fromSec = centerSec - 2 * 86400;
    const toSec = Math.min(Math.floor(Date.now() / 1000), centerSec + 4 * 86400);
    try {
      const qs = new URLSearchParams({
        source,
        symbol,
        tf: '1m',
        from: String(fromSec),
        to: String(toSec),
        count: '9000',
      });
      const res = await fetch(`/api/replay/bars?${qs.toString()}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.bars) && data.bars.length > 0) {
        const entry = {
          bars: data.bars,
          meta: {
            precision: data.precision ?? getInstrumentSpec(symbol, data.bars[0]?.close || 1).precision,
            display: data.display || display || symbol,
          },
        };
        this.m1BySymbol.set(symKey, entry);
        return entry;
      }
    } catch {
      // ignore
    }
    return existing || { bars: [], meta: { precision: getInstrumentSpec(symbol).precision, display: display || symbol } };
  }

  /**
   * Loads historical context bars strictly <= cursorTime for any pane & timeframe
   * (1m, 3m, 5m, 15m, 1h, 4h, 12h, 1d, 1w), using THAT pane's own symbol 1m stream
   * so switching XAU/USD -> EUR/USD or DXY NEVER mixes prices across symbols!
   */
  async loadPaneReplayContext(pane, { fitView = true } = {}) {
    if (!this.active || !this.session) return;
    const cursorTime = this.session.cursorTime;
    const tf = pane.state.tf || '1m';
    const bucketSec = tfToSec(tf);
    const symKey = `${pane.state.source}:${pane.state.symbol}`;

    // Always ensure THIS pane's own symbol has its own 1m stream loaded!
    const symEntry = await this._ensureM1ForSymbol(
      pane.state.source,
      pane.state.symbol,
      pane.state.display,
      cursorTime
    );
    if (!this.active || !this.session || `${pane.state.source}:${pane.state.symbol}` !== symKey || pane.state.tf !== tf) {
      return;
    }
    const symBars = symEntry.bars || [];
    const symMeta = symEntry.meta || { precision: getInstrumentSpec(pane.state.symbol).precision, display: pane.state.display };

    if (tf === '1m' && symBars.length > 0) {
      const visible = symBars.filter((b) => b.time <= cursorTime);
      this.paneContexts.set(pane.id, {
        symbolKey: symKey,
        tf,
        baseBars: [],
        precision: symMeta.precision,
        bucketSec: 60,
      });
      pane.setReplayClock(cursorTime);
      pane.setReplayBars(visible, { ...symMeta, bucketSec: 60, symbolKey: symKey }, { fitView });
      pane.setNewsEvents(this.replayNewsEvents);
      this._pushOverlaysToPane(pane);
      return;
    }

    // For HTF (3m, 5m, 15m, 1h, 4h, 12h, 1d, 1w), fetch ~300 historical bars strictly BEFORE current open bucket!
    const currentBucket = getBucketTime(cursorTime, tf);
    const fetchTo = currentBucket - 1;
    let baseBars = [];
    let precision = symMeta.precision;

    const isEmbeddedPrimary =
      symKey === `${this.session.source}:${this.session.symbol}` &&
      Array.isArray(this.session.embeddedM1Bars) &&
      this.session.embeddedM1Bars.length > 0;

    if (!isEmbeddedPrimary) {
      try {
        const qs = new URLSearchParams({
          source: pane.state.source,
          symbol: pane.state.symbol,
          tf,
          to: String(fetchTo),
          count: '320',
        });
        const res = await fetch(`/api/replay/bars?${qs.toString()}`);
        const data = await res.json();
        if (res.ok && Array.isArray(data.bars)) {
          baseBars = data.bars.filter((b) => b.time < currentBucket);
          precision = data.precision ?? precision;
        }
      } catch {
        // fallback to aggregating from loaded symBars
      }
    }

    if (!this.active || !this.session || `${pane.state.source}:${pane.state.symbol}` !== symKey || pane.state.tf !== tf) {
      return;
    }
    this.paneContexts.set(pane.id, {
      symbolKey: symKey,
      tf,
      baseBars,
      precision,
      bucketSec,
    });

    const merged = this._buildMtfBarsForPane(pane.id, cursorTime);
    pane.setReplayClock(cursorTime);
    pane.setReplayBars(merged, { precision, bucketSec, display: pane.state.display, symbolKey: symKey }, { fitView });
    pane.setNewsEvents(this.replayNewsEvents);
    this._pushOverlaysToPane(pane);
  }

  /**
   * Builds the exact zero-lookahead candles up to `cursorTime` for any pane & symbol:
   * completed HTF context bars + dynamically aggregated bars from THAT symbol's m1 stream <= cursorTime!
   */
  _buildMtfBarsForPane(paneId, cursorTime) {
    const ctx = this.paneContexts.get(paneId);
    if (!ctx) return [];
    const base = ctx.baseBars || [];
    const lastBaseTime = base.length ? base[base.length - 1].time : -1;
    const symM1 = this.m1BySymbol.get(ctx.symbolKey)?.bars || [];

    const out = base.slice();
    const tf = ctx.tf;
    let curBar = null;

    for (let i = 0; i < symM1.length; i++) {
      const m1 = symM1[i];
      if (m1.time > cursorTime) break;
      const bTime = getBucketTime(m1.time, tf);
      if (bTime <= lastBaseTime) continue;

      if (!curBar || curBar.time !== bTime) {
        if (curBar) out.push(curBar);
        curBar = {
          time: bTime,
          open: m1.open,
          high: m1.high,
          low: m1.low,
          close: m1.close,
        };
      } else {
        curBar.high = Math.max(curBar.high, m1.high);
        curBar.low = Math.min(curBar.low, m1.low);
        curBar.close = m1.close;
      }
    }
    if (curBar) out.push(curBar);
    return out;
  }

  // ==========================================================================
  // Playback Controls: Play, Pause, Step Forward, Step Back, Session Jump
  // ==========================================================================
  togglePlay() {
    if (this.playing) this.pause();
    else this.play();
  }

  play() {
    if (!this.active || !this.session || this.playing) return;
    this.playing = true;
    if (this.rpPlayBtn) {
      this.rpPlayBtn.textContent = '⏸ Pause';
      this.rpPlayBtn.classList.add('is-playing');
    }
    const ms = Math.max(25, Number(this.rpSpeedEl?.value) || 400);
    this.playTimer = setInterval(() => this.stepForward(), ms);
  }

  pause() {
    this.playing = false;
    if (this.playTimer) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
    if (this.rpPlayBtn) {
      this.rpPlayBtn.textContent = '▶ Play';
      this.rpPlayBtn.classList.remove('is-playing');
    }
  }

  stepForward() {
    if (!this.active || !this.session || this.m1Bars.length === 0) return;
    const stepTf = this.rpStepTfEl?.value || '1m';
    const stepSec = tfToSec(stepTf);
    const targetTime = this.session.cursorTime + stepSec;

    if (this.m1Index >= this.m1Bars.length - 1) {
      this.pause();
      this._prefetchMoreForwardM1();
      this.host.showToast('End of Loaded Buffer', 'Fetching next historical days — press Play in a moment.');
      return;
    }

    // Advance bar-by-bar through every intermediate 1m candle so Pending/SL/TP triggers are 100% exact!
    let advanced = false;
    while (this.m1Index + 1 < this.m1Bars.length) {
      const nextBar = this.m1Bars[this.m1Index + 1];
      if (advanced && nextBar.time > targetTime) break;
      this.m1Index += 1;
      this.session.cursorTime = nextBar.time;
      advanced = true;
      this._processBarExecution(nextBar);
      if (nextBar.time >= targetTime) break;
    }

    // Background prefetch next 4 days when getting close to end of buffer
    if (this.m1Bars.length - this.m1Index < 450) {
      this._prefetchMoreForwardM1();
    }

    if (Number.isFinite(this.session.endTime) && this.session.cursorTime >= this.session.endTime) {
      this.pause();
      this.host.showToast(
        '🏁 Reached Backtest End Date',
        `Completed scheduled window ending ${fmtReplayTime(this.session.endTime, this.host.getPrefs().timezone)}.`
      );
    }

    this._refreshAllPanesIncremental();
    this._updateAllUi();
    this.saveSessionSoon();
  }

  stepBackward() {
    if (!this.active || !this.session || this.m1Index <= 0) return;
    this.pause();
    const stepTf = this.rpStepTfEl?.value || '1m';
    const stepSec = tfToSec(stepTf);
    const targetTime = this.session.cursorTime - stepSec;

    while (this.m1Index > 0 && this.m1Bars[this.m1Index].time > targetTime) {
      this.m1Index -= 1;
    }
    this.session.cursorTime = this.m1Bars[this.m1Index].time;

    // Rebuild exact bars on all panes cleanly without future candles
    for (const pane of this.host.getPanes().values()) {
      const merged = this._buildMtfBarsForPane(pane.id, this.session.cursorTime);
      pane.setReplayClock(this.session.cursorTime);
      pane.setReplayBars(
        merged,
        { precision: pane.precision, bucketSec: pane.bucketSec },
        { fitView: false }
      );
    }
    this._updateAllUi();
    this.saveSessionSoon();
  }

  jumpToMarketSession(which) {
    if (!this.active || !this.session || !this.m1Bars.length) return;
    this.pause();
    // Target UTC hours: Asia = 00:00, London = 08:00, NY = 13:30
    const targetMinOfDay = which === 'asia' ? 0 : which === 'london' ? 8 * 60 : 13 * 60 + 30;
    const cur = this.session.cursorTime;

    let foundIdx = -1;
    for (let i = this.m1Index + 1; i < this.m1Bars.length; i++) {
      const d = new Date(this.m1Bars[i].time * 1000);
      const minOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
      if (minOfDay === targetMinOfDay && this.m1Bars[i].time > cur + 60) {
        foundIdx = i;
        break;
      }
    }

    if (foundIdx === -1) {
      this._prefetchMoreForwardM1();
      this.host.showToast('Jump Session', `Loading further days to reach next ${which.toUpperCase()} open...`);
      return;
    }

    // Process every intermediate bar so open SL/TP/Limit orders still trigger faithfully!
    while (this.m1Index < foundIdx) {
      this.m1Index += 1;
      const b = this.m1Bars[this.m1Index];
      this.session.cursorTime = b.time;
      this._processBarExecution(b);
    }

    for (const pane of this.host.getPanes().values()) {
      const merged = this._buildMtfBarsForPane(pane.id, this.session.cursorTime);
      pane.setReplayClock(this.session.cursorTime);
      pane.setReplayBars(merged, { precision: pane.precision, bucketSec: pane.bucketSec }, { fitView: false });
    }
    this._updateAllUi();
    this.saveSessionSoon();
  }

  async promptGoToDate() {
    if (!this.session) return;
    this.pause();
    const curIso = new Date(this.session.cursorTime * 1000).toISOString().slice(0, 16);
    const entered = await this.host.openTextPrompt(
      'Go To Replay Date (UTC)',
      curIso,
      'Format: YYYY-MM-DDTHH:MM (e.g. 2025-03-14T13:30).',
      'YYYY-MM-DDTHH:MM'
    );
    if (!entered) return;
    const ms = Date.parse(entered.endsWith('Z') ? entered : `${entered}:00Z`);
    if (!Number.isFinite(ms)) return;
    this.session.cursorTime = Math.floor(ms / 1000);
    await this.loadSession(this.session);
  }

  _refreshAllPanesIncremental() {
    const cursorTime = this.session.cursorTime;
    for (const pane of this.host.getPanes().values()) {
      pane.setReplayClock(cursorTime);
      const ctx = this.paneContexts.get(pane.id);
      if (!ctx) continue;
      const merged = this._buildMtfBarsForPane(pane.id, cursorTime);
      if (merged.length === 0) continue;

      const curLast = pane.bars[pane.bars.length - 1];
      const newLast = merged[merged.length - 1];
      if (curLast && (newLast.time === curLast.time || merged.length === pane.bars.length + 1)) {
        pane.updateReplayLastBar(newLast);
      } else {
        pane.setReplayBars(merged, { precision: ctx.precision, bucketSec: ctx.bucketSec }, { fitView: false });
      }
      this._pushOverlaysToPane(pane);
    }
  }

  // ==========================================================================
  // Paper Execution Engine (Market / Limit / Stop, Spread, Commission, SL/TP)
  // ==========================================================================
  getCurrentBar() {
    return this.m1Index >= 0 && this.m1Index < this.m1Bars.length ? this.m1Bars[this.m1Index] : null;
  }

  getSpreadPrice() {
    const bar = this.getCurrentBar();
    const spec = getInstrumentSpec(this.session?.symbol, bar?.close || 1);
    return (Number(this.session?.spreadPips) || 0) * spec.pipSize;
  }

  _setTicketSide(side) {
    this.ticketSide = side === 'sell' ? 'sell' : 'buy';
    this.rpSideBuyBtn?.classList.toggle('active', this.ticketSide === 'buy');
    this.rpSideSellBtn?.classList.toggle('active', this.ticketSide === 'sell');
    this._syncTicketUi();
  }

  _syncTicketUi() {
    const oType = this.rpOrderTypeEl?.value || 'market';
    const isPending = oType !== 'market';
    if (this.rpEntryWrap) this.rpEntryWrap.hidden = !isPending;
    if (isPending && this.rpEntryPriceEl && !this.rpEntryPriceEl.value) {
      const bar = this.getCurrentBar();
      if (bar) this.rpEntryPriceEl.value = bar.close.toFixed(this.m1Meta.precision);
    }

    const rMode = this.rpRiskModeEl?.value || 'pct';
    if (this.rpRiskValLabel) {
      this.rpRiskValLabel.textContent =
        rMode === 'pct' ? 'Risk (%)' : rMode === 'usd' ? 'Risk ($)' : 'Lots';
    }
    const tMode = this.rpTpModeEl?.value || 'rr';
    if (this.rpTpValLabel) {
      this.rpTpValLabel.textContent =
        tMode === 'rr' ? 'Target (R)' : tMode === 'pips' ? 'TP (Pips)' : 'TP Price';
    }

    if (this.rpPlaceOrderBtn) {
      const verb = oType === 'market' ? 'Market' : oType === 'limit' ? 'Limit' : 'Stop';
      this.rpPlaceOrderBtn.textContent = `Place ${verb} ${this.ticketSide.toUpperCase()}`;
      this.rpPlaceOrderBtn.className = `rp-exec-btn ${this.ticketSide}`;
    }
    this._updateTicketCalc();
  }

  _computeTicketParams() {
    const bar = this.getCurrentBar();
    if (!this.session || !bar) return null;
    const spec = getInstrumentSpec(this.session.symbol, bar.close);
    const spreadPrice = this.getSpreadPrice();
    const oType = this.rpOrderTypeEl?.value || 'market';
    const isBuy = this.ticketSide === 'buy';

    const rawEntry =
      oType === 'market'
        ? bar.close + (isBuy ? spreadPrice / 2 : -spreadPrice / 2)
        : Number.parseFloat(this.rpEntryPriceEl?.value) || bar.close;

    const slPips = Math.max(0, Number.parseFloat(this.rpSlPipsEl?.value) || 0);
    const slPrice =
      slPips > 0
        ? Number((isBuy ? rawEntry - slPips * spec.pipSize : rawEntry + slPips * spec.pipSize).toFixed(spec.precision))
        : null;

    const tpMode = this.rpTpModeEl?.value || 'rr';
    const tpInput = Number.parseFloat(this.rpTpValEl?.value) || 0;
    let tpPrice = null;
    if (tpInput > 0) {
      if (tpMode === 'rr' && slPips > 0) {
        const tpDist = slPips * tpInput * spec.pipSize;
        tpPrice = Number((isBuy ? rawEntry + tpDist : rawEntry - tpDist).toFixed(spec.precision));
      } else if (tpMode === 'pips') {
        tpPrice = Number((isBuy ? rawEntry + tpInput * spec.pipSize : rawEntry - tpInput * spec.pipSize).toFixed(spec.precision));
      } else if (tpMode === 'price') {
        tpPrice = Number(tpInput.toFixed(spec.precision));
      }
    }

    const rMode = this.rpRiskModeEl?.value || 'pct';
    const rVal = Math.max(0.01, Number.parseFloat(this.rpRiskValEl?.value) || 1);
    const baseEq = this.session.balance || this.session.initialBalance;

    let lots = 0.1;
    if (rMode === 'lots') {
      lots = Math.max(0.01, Number(rVal.toFixed(2)));
    } else {
      const targetRiskUsd = rMode === 'pct' ? (baseEq * rVal) / 100 : rVal;
      const denom = slPips > 0 ? slPips * spec.pipValuePerLot : 25 * spec.pipValuePerLot;
      lots = Math.max(0.01, Math.min(500, Number((targetRiskUsd / denom).toFixed(2))));
    }

    const riskUsd = slPrice !== null ? Math.abs(rawEntry - slPrice) / spec.pipSize * spec.pipValuePerLot * lots : 0;
    const rewardUsd = tpPrice !== null ? Math.abs(tpPrice - rawEntry) / spec.pipSize * spec.pipValuePerLot * lots : 0;

    return {
      orderType: oType,
      side: this.ticketSide,
      entryPrice: Number(rawEntry.toFixed(spec.precision)),
      sl: slPrice,
      tp: tpPrice,
      lots,
      riskUsd,
      rewardUsd,
      spec,
    };
  }

  _updateTicketCalc() {
    const p = this._computeTicketParams();
    if (!p) return;
    if (this.rpCalcLotsEl) this.rpCalcLotsEl.textContent = p.lots.toFixed(2);
    if (this.rpCalcRiskEl) this.rpCalcRiskEl.textContent = p.riskUsd > 0 ? `-${fmtUsd(p.riskUsd)}` : '—';
    if (this.rpCalcRewardEl) this.rpCalcRewardEl.textContent = p.rewardUsd > 0 ? `+${fmtUsd(p.rewardUsd)}` : '—';
  }

  _recordStep(type, label, detail, extra = {}) {
    if (!this.session) return;
    if (!Array.isArray(this.session.timeline)) this.session.timeline = [];
    this.session.timeline.push({
      id: `st-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      time: this.session.cursorTime,
      type,
      label,
      detail,
      mentorComment: '',
      ...extra,
    });
  }

  placeOrderFromTicket() {
    const p = this._computeTicketParams();
    if (!p || !this.session) return;
    const nowTime = this.session.cursorTime;

    if (p.orderType === 'market') {
      const pos = {
        id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        symbol: this.session.symbol,
        display: this.session.display,
        side: p.side,
        lots: p.lots,
        entryPrice: p.entryPrice,
        entryTime: nowTime,
        sl: p.sl,
        tp: p.tp,
        initialRiskUsd: p.riskUsd > 0 ? p.riskUsd : null,
      };
      this.session.positions.push(pos);
      this._recordTradingDay(nowTime);
      this._recordStep(
        'order_fill',
        `Market ${p.side.toUpperCase()} ${p.lots.toFixed(2)}`,
        `Entry ${p.entryPrice}${p.sl ? ` · SL ${p.sl}` : ''}${p.tp ? ` · TP ${p.tp}` : ''}`,
        { side: p.side, price: p.entryPrice, lots: p.lots, sl: p.sl, tp: p.tp }
      );
      this.host.showToast(
        `${p.side.toUpperCase()} ${p.lots.toFixed(2)} ${this.session.display}`,
        `Filled @ ${p.entryPrice}${p.sl ? ` · SL ${p.sl}` : ''}${p.tp ? ` · TP ${p.tp}` : ''}`
      );
    } else {
      const ord = {
        id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        symbol: this.session.symbol,
        display: this.session.display,
        orderType: p.orderType,
        side: p.side,
        lots: p.lots,
        price: p.entryPrice,
        createdAt: nowTime,
        sl: p.sl,
        tp: p.tp,
        initialRiskUsd: p.riskUsd > 0 ? p.riskUsd : null,
      };
      this.session.pendingOrders.push(ord);
      this._recordStep(
        'order_pending',
        `${p.side.toUpperCase()} ${p.orderType.toUpperCase()} ${p.lots.toFixed(2)}`,
        `Pending @ ${p.entryPrice}${p.sl ? ` · SL ${p.sl}` : ''}${p.tp ? ` · TP ${p.tp}` : ''}`,
        { side: p.side, price: p.entryPrice, lots: p.lots }
      );
      this.host.showToast(
        `${p.side.toUpperCase()} ${p.orderType.toUpperCase()} Placed`,
        `${p.lots.toFixed(2)} lots @ ${p.entryPrice}`
      );
    }

    this._updateAllUi();
    this.saveSessionSoon();
  }

  modifyOrderOnChart(kind, id, field, newPrice) {
    if (!this.session || !Number.isFinite(newPrice)) return;
    if (kind === 'position') {
      const pos = this.session.positions.find((p) => p.id === id);
      if (!pos) return;
      pos[field] = newPrice;
    } else if (kind === 'order') {
      const ord = this.session.pendingOrders.find((o) => o.id === id);
      if (!ord) return;
      ord[field] = newPrice;
    }
    this._updateAllUi();
    this.saveSessionSoon();
  }

  movePositionToBreakeven(posId) {
    const pos = this.session?.positions.find((p) => p.id === posId);
    if (!pos) return;
    pos.sl = pos.entryPrice;
    this._recordStep(
      'breakeven',
      `Moved SL to Breakeven`,
      `${pos.side.toUpperCase()} ${pos.lots.toFixed(2)} · SL → ${pos.entryPrice}`,
      { side: pos.side, price: pos.entryPrice }
    );
    this._updateAllUi();
    this.saveSessionSoon();
  }

  closePosition(posId, fraction = 1, exitPriceOverride = null, reason = 'Manual') {
    if (!this.session) return;
    const idx = this.session.positions.findIndex((p) => p.id === posId);
    if (idx === -1) return;
    const pos = this.session.positions[idx];
    const bar = this.getCurrentBar();
    const spec = getInstrumentSpec(this.session.symbol, bar?.close || pos.entryPrice);
    const spreadPrice = this.getSpreadPrice();
    const isBuy = pos.side === 'buy';

    const closeLots =
      fraction < 1 ? Math.max(0.01, Number((pos.lots * fraction).toFixed(2))) : pos.lots;
    const remainingLots = Number((pos.lots - closeLots).toFixed(2));

    const exitPrice = Number.isFinite(exitPriceOverride)
      ? exitPriceOverride
      : Number(((bar?.close || pos.entryPrice) + (isBuy ? -spreadPrice / 2 : spreadPrice / 2)).toFixed(spec.precision));

    const priceDiff = isBuy ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
    const grossPnl = (priceDiff / spec.pipSize) * spec.pipValuePerLot * closeLots;
    const commission = (Number(this.session.commissionPerLot) || 0) * closeLots;
    const netPnl = grossPnl - commission;
    const rMultiple =
      pos.initialRiskUsd && pos.initialRiskUsd > 0
        ? netPnl / (pos.initialRiskUsd * (closeLots / pos.lots))
        : null;

    this.session.balance = Number((this.session.balance + netPnl).toFixed(2));
    this._recordTradingDay(this.session.cursorTime);

    const trade = {
      id: `trd-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      symbol: pos.symbol,
      display: pos.display,
      side: pos.side,
      lots: closeLots,
      entryPrice: pos.entryPrice,
      exitPrice,
      entryTime: pos.entryTime,
      exitTime: this.session.cursorTime,
      grossPnl: Number(grossPnl.toFixed(2)),
      commission: Number(commission.toFixed(2)),
      pnl: Number(netPnl.toFixed(2)),
      rMultiple: rMultiple !== null ? Number(rMultiple.toFixed(2)) : null,
      reason: fraction < 1 ? `Partial (${Math.round(fraction * 100)}%)` : reason,
      tags: [],
      note: '',
    };
    this.session.trades.push(trade);
    this._recordStep(
      'trade_close',
      `${trade.reason}: ${pos.side.toUpperCase()} ${closeLots.toFixed(2)}`,
      `${pos.entryPrice} → ${exitPrice} · ${fmtUsd(netPnl, true)}${trade.rMultiple !== null ? ` (${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple}R)` : ''}`,
      { side: pos.side, price: exitPrice, pnl: trade.pnl, rMultiple: trade.rMultiple }
    );

    if (remainingLots >= 0.01 && fraction < 1) {
      pos.lots = remainingLots;
    } else {
      this.session.positions.splice(idx, 1);
    }

    const eq = this.computeAccountStats().equity;
    this.session.equityCurve.push({
      time: this.session.cursorTime,
      balance: this.session.balance,
      equity: eq,
    });

    this._evaluatePropRules();
    this._updateAllUi();
    this.saveSessionSoon();
  }

  cancelPendingOrder(orderId) {
    if (!this.session) return;
    this.session.pendingOrders = this.session.pendingOrders.filter((o) => o.id !== orderId);
    this._updateAllUi();
    this.saveSessionSoon();
  }

  _recordTradingDay(unixSec) {
    const dk = utcDayKey(unixSec);
    if (!this.session.tradingDays.includes(dk)) {
      this.session.tradingDays.push(dk);
    }
  }

  /**
   * Evaluates pending Limit/Stop triggers, SL/TP hits, and daily prop-firm reset on every 1m candle!
   */
  _processBarExecution(bar) {
    if (!this.session || !bar) return;

    // 1. Daily rollover check for Prop Firm Daily Drawdown reset (midnight UTC)
    const dayKey = utcDayKey(bar.time);
    if (this.session.dailyStartDay !== dayKey) {
      this.session.dailyStartDay = dayKey;
      this.session.dailyStartEquity = this.computeAccountStats(bar.open).equity;
    }

    const spreadHalf = this.getSpreadPrice() / 2;

    // 2. Check Pending Limit / Stop Orders
    const remainingOrders = [];
    for (const ord of this.session.pendingOrders) {
      const isBuy = ord.side === 'buy';
      const askLow = bar.low + spreadHalf;
      const askHigh = bar.high + spreadHalf;
      const bidLow = bar.low - spreadHalf;
      const bidHigh = bar.high - spreadHalf;

      let triggered = false;
      if (isBuy && ord.orderType === 'limit' && askLow <= ord.price) triggered = true;
      if (isBuy && ord.orderType === 'stop' && askHigh >= ord.price) triggered = true;
      if (!isBuy && ord.orderType === 'limit' && bidHigh >= ord.price) triggered = true;
      if (!isBuy && ord.orderType === 'stop' && bidLow <= ord.price) triggered = true;

      if (triggered) {
        this.session.positions.push({
          id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          symbol: ord.symbol,
          display: ord.display,
          side: ord.side,
          lots: ord.lots,
          entryPrice: ord.price,
          entryTime: bar.time,
          sl: ord.sl,
          tp: ord.tp,
          initialRiskUsd: ord.initialRiskUsd,
        });
        this._recordTradingDay(bar.time);
        this._recordStep(
          'order_fill',
          `Pending ${ord.side.toUpperCase()} ${ord.orderType.toUpperCase()} Triggered`,
          `${ord.lots.toFixed(2)} lots @ ${ord.price}${ord.sl ? ` · SL ${ord.sl}` : ''}${ord.tp ? ` · TP ${ord.tp}` : ''}`,
          { side: ord.side, price: ord.price, lots: ord.lots }
        );
        this.host.showToast(
          `⚡ ${ord.side.toUpperCase()} ${ord.orderType.toUpperCase()} Filled`,
          `${ord.lots.toFixed(2)} ${ord.display} @ ${ord.price}`
        );
      } else {
        remainingOrders.push(ord);
      }
    }
    this.session.pendingOrders = remainingOrders;

    // 3. Check Open Positions SL / TP hits (conservative: SL checked before TP if both touched in same 1m bar)
    for (const pos of [...this.session.positions]) {
      const isBuy = pos.side === 'buy';
      // Buy closes on Bid (bar - spreadHalf); Sell closes on Ask (bar + spreadHalf)
      const closeLow = isBuy ? bar.low - spreadHalf : bar.low + spreadHalf;
      const closeHigh = isBuy ? bar.high - spreadHalf : bar.high + spreadHalf;

      if (Number.isFinite(pos.sl)) {
        const hitSl = isBuy ? closeLow <= pos.sl : closeHigh >= pos.sl;
        if (hitSl) {
          this.closePosition(pos.id, 1, pos.sl, 'Stop Loss');
          this.host.showToast('🛑 Stop Loss Hit', `${pos.display} ${pos.side.toUpperCase()} closed @ ${pos.sl}`);
          continue;
        }
      }
      if (Number.isFinite(pos.tp)) {
        const hitTp = isBuy ? closeHigh >= pos.tp : closeLow <= pos.tp;
        if (hitTp) {
          this.closePosition(pos.id, 1, pos.tp, 'Take Profit');
          this.host.showToast('🎯 Take Profit Hit', `${pos.display} ${pos.side.toUpperCase()} closed @ ${pos.tp}`);
          continue;
        }
      }
    }

    this._evaluatePropRules(bar.close);
  }

  computePositionPnl(pos, midPrice = null) {
    const bar = this.getCurrentBar();
    const mid = Number.isFinite(midPrice) ? midPrice : bar?.close || pos.entryPrice;
    const spec = getInstrumentSpec(this.session?.symbol, mid);
    const spreadHalf = this.getSpreadPrice() / 2;
    const isBuy = pos.side === 'buy';
    const exitPrice = mid + (isBuy ? -spreadHalf : spreadHalf);
    const diff = isBuy ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
    const gross = (diff / spec.pipSize) * spec.pipValuePerLot * pos.lots;
    const comm = (Number(this.session?.commissionPerLot) || 0) * pos.lots;
    const floatingPnl = gross - comm;

    const slUsd = Number.isFinite(pos.sl)
      ? (Math.abs(pos.entryPrice - pos.sl) / spec.pipSize) * spec.pipValuePerLot * pos.lots
      : null;
    const tpUsd = Number.isFinite(pos.tp)
      ? (Math.abs(pos.tp - pos.entryPrice) / spec.pipSize) * spec.pipValuePerLot * pos.lots
      : null;
    const rr = slUsd && tpUsd ? tpUsd / slUsd : null;
    const floatingR = slUsd && slUsd > 0 ? floatingPnl / slUsd : null;

    return { floatingPnl, floatingR, slUsd, tpUsd, rr };
  }

  computeAccountStats(midPrice = null) {
    const s = this.session;
    if (!s) {
      return {
        balance: 0,
        equity: 0,
        floatingPnl: 0,
        dailyLossPct: 0,
        totalLossPct: 0,
        profitPct: 0,
      };
    }
    let floatingPnl = 0;
    for (const pos of s.positions) {
      floatingPnl += this.computePositionPnl(pos, midPrice).floatingPnl;
    }
    const equity = Number((s.balance + floatingPnl).toFixed(2));
    if (equity > (s.peakEquity || s.initialBalance)) {
      s.peakEquity = equity;
    }
    const dailyBase = s.dailyStartEquity || s.initialBalance;
    const dailyLossPct = Math.max(0, ((dailyBase - equity) / s.initialBalance) * 100);
    const trailing = Boolean(s.propRule?.trailingDrawdown);
    const totalLossPct = trailing
      ? Math.max(0, (((s.peakEquity || s.initialBalance) - equity) / (s.peakEquity || s.initialBalance)) * 100)
      : Math.max(0, ((s.initialBalance - equity) / s.initialBalance) * 100);
    const profitPct = ((equity - s.initialBalance) / s.initialBalance) * 100;

    return {
      balance: s.balance,
      equity,
      floatingPnl,
      dailyLossPct,
      totalLossPct,
      profitPct,
    };
  }

  _evaluatePropRules(midPrice = null) {
    const s = this.session;
    const rule = s?.propRule;
    if (!s || !rule) return;
    const stats = this.computeAccountStats(midPrice);

    if (rule.dailyMaxLossPct > 0 && stats.dailyLossPct >= rule.dailyMaxLossPct && s.breachState !== 'daily_breach') {
      s.breachState = 'daily_breach';
      this.pause();
      this.host.showToast(
        `🚨 ${rule.name} Daily Loss Breached!`,
        `Daily drawdown hit ${stats.dailyLossPct.toFixed(2)}% (limit ${rule.dailyMaxLossPct}%).`
      );
    } else if (rule.totalMaxLossPct > 0 && stats.totalLossPct >= rule.totalMaxLossPct && s.breachState !== 'total_breach') {
      s.breachState = 'total_breach';
      this.pause();
      this.host.showToast(
        `🚨 ${rule.name} Max Loss Breached!`,
        `Total drawdown hit ${stats.totalLossPct.toFixed(2)}% (limit ${rule.totalMaxLossPct}%).`
      );
    } else if (
      rule.profitTargetPct > 0 &&
      stats.profitPct >= rule.profitTargetPct &&
      (s.tradingDays?.length || 0) >= (rule.minTradingDays || 0) &&
      s.breachState !== 'passed'
    ) {
      s.breachState = 'passed';
      this.host.showToast(
        `🏆 ${rule.name} PASSED!`,
        `Reached +${stats.profitPct.toFixed(2)}% profit target across ${s.tradingDays.length} trading days!`
      );
    }
  }

  // ==========================================================================
  // UI Sync: Dock, Prop Guard, Trade Sidebar, Chart Overlays & Isolated Drawings
  // ==========================================================================
  _pushOverlaysToPane(pane) {
    if (!this.session || pane.state.symbol !== this.session.symbol) {
      pane.setReplayOverlays({});
      return;
    }
    const positions = this.session.positions.map((pos) => ({
      ...pos,
      ...this.computePositionPnl(pos),
    }));
    pane.setReplayOverlays({
      positions,
      orders: this.session.pendingOrders,
      markers: this.session.trades,
    });
  }

  _syncSessionDrawingsToPanes() {
    if (!this.session) return;
    const cutoff = this.reviewTimeFilter;
    for (const pane of this.host.getPanes().values()) {
      const rawList = this.session.drawings?.[pane.symbolKey] || [];
      const list =
        Number.isFinite(cutoff)
          ? rawList.filter((d) => !Number.isFinite(d.createdAtReplayTime) || d.createdAtReplayTime <= cutoff)
          : rawList;
      pane.setDrawings(list);
    }
  }

  handleReplayDrawingsChanged(symbolKey, list) {
    if (!this.session) return;
    const prevList = this.session.drawings?.[symbolKey] || [];
    const prevIds = new Set(prevList.map((d) => d.id));
    const curTime = this.session.cursorTime;

    const stamped = (Array.isArray(list) ? list : []).map((d) => {
      if (!prevIds.has(d.id) && !Number.isFinite(d.createdAtReplayTime)) {
        const typeNames = { trend: 'Trend Line', arrow: 'Arrow', darrow: 'Double Arrow', zigzag: 'ZigZag', hline: 'H-Line', ray: 'Ray', vline: 'V-Line', rect: 'Zone/Box', longpos: 'Long Position', shortpos: 'Short Position', freehand: 'Freehand', text: 'Text Note' };
        this._recordStep(
          'drawing_add',
          `Drew ${typeNames[d.type] || d.type}`,
          d.text ? `Label: "${d.text}"` : Number.isFinite(d.p1?.price) ? `@ ${d.p1.price.toFixed(this.m1Meta.precision)}` : 'Chart annotation',
          { drawingId: d.id }
        );
        return { ...d, createdAtReplayTime: curTime };
      }
      return d;
    });

    this.session.drawings[symbolKey] = stamped;
    for (const pane of this.host.getPanes().values()) {
      if (pane.symbolKey === symbolKey) pane.setDrawings(stamped);
    }
    this.saveSessionSoon();
  }

  _updateAllUi() {
    if (!this.session) return;
    const prefs = this.host.getPrefs();
    const stats = this.computeAccountStats();
    const rule = this.session.propRule;

    // Dock clock & equity
    if (this.rpClockEl) {
      this.rpClockEl.textContent = fmtReplayTime(this.session.cursorTime, prefs.timezone);
    }
    // Keep Historical Economic Calendar synced to simulated Replay date (auto-prefetch new weeks!)
    const curT = this.session.cursorTime;
    if (Number.isFinite(curT)) {
      const win = this.replayNewsWindow;
      if (!win || curT < win[0] + 86400 || curT > win[1] - 2 * 86400) {
        this._loadHistoricalReplayNews(curT);
      } else if (this._lastNewsRenderClock !== curT) {
        this._lastNewsRenderClock = curT;
        this.host.onReplayNewsUpdate?.();
      }
    }
    if (this.rpEquityValEl) {
      this.rpEquityValEl.textContent = fmtUsd(stats.equity);
      this.rpEquityValEl.className =
        stats.equity > this.session.initialBalance
          ? 'up'
          : stats.equity < this.session.initialBalance
          ? 'down'
          : '';
    }

    // Prop Firm live guard badge
    if (this.rpPropGuardEl) {
      const hasRules = rule && (rule.dailyMaxLossPct > 0 || rule.totalMaxLossPct > 0 || rule.profitTargetPct > 0);
      this.rpPropGuardEl.hidden = !hasRules;
      if (hasRules) {
        this.rpPropTagEl.textContent = rule.name.split(' ')[0].toUpperCase();
        this.rpPropDailyEl.textContent = rule.dailyMaxLossPct > 0
          ? `D: ${stats.dailyLossPct.toFixed(1)}%/${rule.dailyMaxLossPct}%`
          : '';
        this.rpPropTotalEl.textContent = rule.totalMaxLossPct > 0
          ? `M: ${stats.totalLossPct.toFixed(1)}%/${rule.totalMaxLossPct}%`
          : '';
        this.rpPropTargetEl.textContent = rule.profitTargetPct > 0
          ? `T: ${stats.profitPct >= 0 ? '+' : ''}${stats.profitPct.toFixed(1)}%/${rule.profitTargetPct}%`
          : '';

        const isBreach =
          this.session.breachState === 'daily_breach' || this.session.breachState === 'total_breach';
        const isPassed = this.session.breachState === 'passed';
        const isWarn =
          !isBreach &&
          ((rule.dailyMaxLossPct > 0 && stats.dailyLossPct >= rule.dailyMaxLossPct * 0.7) ||
            (rule.totalMaxLossPct > 0 && stats.totalLossPct >= rule.totalMaxLossPct * 0.7));
        this.rpPropGuardEl.className = `rp-prop-guard ${isBreach ? 'breach' : isPassed ? 'passed' : isWarn ? 'warn' : ''}`;
      }
    }

    // Chart overlays on all panes
    for (const pane of this.host.getPanes().values()) {
      this._pushOverlaysToPane(pane);
    }

    // Ticket calc + Open positions + Recent closed trades
    this._updateTicketCalc();
    this._renderPositionsPanel();
    this._renderRecentTrades();
  }

  _renderPositionsPanel() {
    if (!this.rpPositionsListEl || !this.session) return;
    const openTotal = this.session.positions.length + this.session.pendingOrders.length;
    if (this.rpOpenCountEl) this.rpOpenCountEl.textContent = String(openTotal);

    this.rpPositionsListEl.innerHTML = '';
    if (openTotal === 0) {
      this.rpPositionsListEl.innerHTML =
        '<div style="padding:12px 6px;text-align:center;color:var(--text-secondary);font-size:11px;">No open positions. Place an order above or drag SL/TP lines directly on the chart.</div>';
      return;
    }

    for (const pos of this.session.positions) {
      const { floatingPnl, floatingR } = this.computePositionPnl(pos);
      const card = document.createElement('div');
      card.className = `rp-pos-card ${pos.side}`;
      const pnlCol = floatingPnl >= 0 ? 'var(--up)' : 'var(--down)';
      const rTxt = Number.isFinite(floatingR)
        ? ` (${floatingR >= 0 ? '+' : ''}${floatingR.toFixed(2)}R)`
        : '';

      card.innerHTML = `
        <div class="rp-pos-top">
          <span>${pos.side.toUpperCase()} ${pos.lots.toFixed(2)} ${escapeHtml(pos.display)}</span>
          <span style="color:${pnlCol}">${fmtUsd(floatingPnl, true)}${rTxt}</span>
        </div>
        <div class="rp-pos-meta">Entry: ${pos.entryPrice}${pos.sl ? ` · SL: ${pos.sl}` : ''}${pos.tp ? ` · TP: ${pos.tp}` : ''}</div>
        <div class="rp-pos-actions">
          <button type="button" class="mini-btn pos-be-btn" title="Move Stop Loss to Breakeven">BE</button>
          <button type="button" class="mini-btn pos-half-btn" title="Close 50% partial">-50%</button>
          <button type="button" class="mini-btn pos-close-btn" style="color:var(--down);">Close</button>
        </div>
      `;
      card.querySelector('.pos-be-btn').addEventListener('click', () => this.movePositionToBreakeven(pos.id));
      card.querySelector('.pos-half-btn').addEventListener('click', () => this.closePosition(pos.id, 0.5));
      card.querySelector('.pos-close-btn').addEventListener('click', () => this.closePosition(pos.id, 1));
      this.rpPositionsListEl.appendChild(card);
    }

    for (const ord of this.session.pendingOrders) {
      const card = document.createElement('div');
      card.className = 'rp-pos-card pending';
      card.innerHTML = `
        <div class="rp-pos-top">
          <span>${ord.side.toUpperCase()} ${ord.orderType.toUpperCase()} ${ord.lots.toFixed(2)}</span>
          <span>@ ${ord.price}</span>
        </div>
        <div class="rp-pos-meta">${ord.sl ? `SL: ${ord.sl}` : 'No SL'}${ord.tp ? ` · TP: ${ord.tp}` : ''}</div>
        <div class="rp-pos-actions">
          <button type="button" class="mini-btn ord-cancel-btn" style="color:var(--down);">Cancel Order</button>
        </div>
      `;
      card.querySelector('.ord-cancel-btn').addEventListener('click', () => this.cancelPendingOrder(ord.id));
      this.rpPositionsListEl.appendChild(card);
    }
  }

  _renderRecentTrades() {
    if (!this.rpRecentListEl || !this.session) return;
    this.rpRecentListEl.innerHTML = '';
    const recent = [...this.session.trades].reverse().slice(0, 8);
    if (!recent.length) {
      this.rpRecentListEl.innerHTML =
        '<div style="padding:10px 6px;text-align:center;color:var(--text-secondary);font-size:11px;">Closed trades appear here.</div>';
      return;
    }

    for (const t of recent) {
      const row = document.createElement('div');
      row.className = 'rp-recent-row';
      const pnlCol = t.pnl >= 0 ? 'var(--up)' : 'var(--down)';
      const rTxt = t.rMultiple !== null ? ` (${t.rMultiple >= 0 ? '+' : ''}${t.rMultiple}R)` : '';
      row.innerHTML = `
        <span><b>${t.side.toUpperCase()}</b> ${t.lots.toFixed(2)} · ${escapeHtml(t.reason || '')}</span>
        <b style="color:${pnlCol}">${fmtUsd(t.pnl, true)}${rTxt}</b>
      `;
      row.addEventListener('click', () => {
        this.host.getActivePane()?.focusTime(t.entryTime);
      });
      this.rpRecentListEl.appendChild(row);
    }
  }

  // ==========================================================================
  // Phase 3: Full Analytics Dashboard, Equity Curve Canvas & Trade Journal
  // ==========================================================================
  openAnalyticsDialog() {
    if (!this.session) {
      this.openSessionDialog();
      return;
    }
    this.renderAnalyticsDialog();
    this.analyticsDialog?.showModal();
  }

  renderAnalyticsDialog() {
    const s = this.session;
    if (!s) return;
    const trades = s.trades || [];
    const stats = this.computeAccountStats();
    const rule = s.propRule;

    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl < 0);
    const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
    const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
    const netPnl = s.balance - s.initialBalance;
    const netPct = s.initialBalance ? (netPnl / s.initialBalance) * 100 : 0;
    const rList = trades.map((t) => t.rMultiple).filter((r) => Number.isFinite(r));
    const avgR = rList.length ? rList.reduce((a, b) => a + b, 0) / rList.length : 0;
    const totalComm = trades.reduce((a, t) => a + (t.commission || 0), 0);

    // Compute Max Drawdown % across equity curve
    let peak = s.initialBalance;
    let maxDdPct = 0;
    for (const pt of s.equityCurve || []) {
      const v = pt.equity ?? pt.balance ?? s.initialBalance;
      if (v > peak) peak = v;
      const dd = peak > 0 ? ((peak - v) / peak) * 100 : 0;
      if (dd > maxDdPct) maxDdPct = dd;
    }

    // Prop Firm Evaluation Bar
    if (this.rpaPropBarEl) {
      const statusText =
        s.breachState === 'passed'
          ? '🏆 PASSED'
          : s.breachState === 'daily_breach'
          ? '🚨 DAILY LOSS BREACHED'
          : s.breachState === 'total_breach'
          ? '🚨 MAX LOSS BREACHED'
          : '⏳ IN PROGRESS';
      this.rpaPropBarEl.innerHTML = `
        <div><b>${escapeHtml(rule?.name || 'Free Practice')}</b> · ${escapeHtml(s.name)}</div>
        <div>
          Days: <b>${s.tradingDays?.length || 0}${rule?.minTradingDays ? `/${rule.minTradingDays}` : ''}</b> ·
          Daily DD: <b>${stats.dailyLossPct.toFixed(2)}%${rule?.dailyMaxLossPct ? `/${rule.dailyMaxLossPct}%` : ''}</b> ·
          Max DD: <b>${maxDdPct.toFixed(2)}%${rule?.totalMaxLossPct ? `/${rule.totalMaxLossPct}%` : ''}</b> ·
          <b>${statusText}</b>
        </div>
      `;
    }

    // KPI Grid
    if (this.rpaKpiGridEl) {
      const pfStr = profitFactor === Infinity ? '∞' : profitFactor.toFixed(2);
      this.rpaKpiGridEl.innerHTML = `
        <div class="rp-kpi-card"><span>Net P&amp;L</span><b class="${netPnl >= 0 ? 'up' : 'down'}">${fmtUsd(netPnl, true)} (${netPct >= 0 ? '+' : ''}${netPct.toFixed(2)}%)</b></div>
        <div class="rp-kpi-card"><span>Win Rate</span><b>${winRate.toFixed(1)}% (${wins.length}W/${losses.length}L)</b></div>
        <div class="rp-kpi-card"><span>Profit Factor</span><b class="${profitFactor >= 1.5 ? 'up' : ''}">${pfStr}</b></div>
        <div class="rp-kpi-card"><span>Expectancy (Avg R)</span><b class="${avgR >= 0 ? 'up' : 'down'}">${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}R</b></div>
        <div class="rp-kpi-card"><span>Max Drawdown</span><b class="down">-${maxDdPct.toFixed(2)}%</b></div>
        <div class="rp-kpi-card"><span>Total Trades</span><b>${trades.length}</b></div>
        <div class="rp-kpi-card"><span>Balance / Equity</span><b>${fmtUsd(s.balance)}</b></div>
        <div class="rp-kpi-card"><span>Commissions Paid</span><b>${fmtUsd(totalComm)}</b></div>
      `;
    }

    this._drawEquityCurve();
    this._renderJournalRows();
    this._renderTimelineRows();
    this._setAnalyticsTab(this.rpaTab);
  }

  _setAnalyticsTab(tab) {
    this.rpaTab = tab === 'timeline' ? 'timeline' : 'journal';
    const isTimeline = this.rpaTab === 'timeline';
    for (const b of document.querySelectorAll('[data-rpa-tab]')) {
      b.classList.toggle('active', b.dataset.rpaTab === this.rpaTab);
    }
    if (this.rpaJournalListEl) this.rpaJournalListEl.hidden = isTimeline;
    if (this.rpaJournalControls) this.rpaJournalControls.hidden = isTimeline;
    if (this.rpaTimelineListEl) this.rpaTimelineListEl.hidden = !isTimeline;
    if (this.rpaTimelineControls) this.rpaTimelineControls.hidden = !isTimeline;
    if (isTimeline) this._renderTimelineRows();
  }

  _renderTimelineRows() {
    if (!this.rpaTimelineListEl || !this.session) return;
    const steps = Array.isArray(this.session.timeline) ? this.session.timeline : [];
    if (this.rpaTimelineCountEl) this.rpaTimelineCountEl.textContent = String(steps.length);

    this.rpaTimelineListEl.innerHTML = '';
    if (!steps.length) {
      this.rpaTimelineListEl.innerHTML =
        '<div style="padding:14px;text-align:center;color:var(--text-secondary);font-size:12px;">No recorded actions yet. Draw lines or place trades — every step is recorded automatically for Mentor Review!</div>';
      return;
    }

    const tz = this.host.getPrefs().timezone;
    const typeIcons = {
      session_start: '▶',
      drawing_add: '✏️',
      order_fill: '⚡',
      order_pending: '⏳',
      breakeven: '🛡️',
      trade_close: '🏁',
    };

    steps.forEach((st, idx) => {
      const row = document.createElement('div');
      row.className = `rp-timeline-row ${idx === this.activeReviewStepIdx ? 'is-active-step' : ''}`;
      const icon = typeIcons[st.type] || '•';
      const mentorHtml = st.mentorComment
        ? `<div class="rp-mentor-note">👨‍🏫 Mentor: ${escapeHtml(st.mentorComment)}</div>`
        : '';

      row.innerHTML = `
        <span class="rp-step-num">#${idx + 1}</span>
        <div style="min-width:0;">
          <div><b>${icon} ${escapeHtml(st.label)}</b> · <span style="color:var(--text-secondary)">${fmtReplayTime(st.time, tz)}</span></div>
          <div style="font-size:10.5px;color:var(--text-secondary);margin-top:1px;">${escapeHtml(st.detail || '')}</div>
          ${mentorHtml}
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          <button type="button" class="mini-btn tl-comment-btn" title="Add or edit Mentor feedback on this step">💬</button>
          <button type="button" class="mini-btn tl-jump-btn" title="Jump chart to this exact step">◎</button>
        </div>
      `;

      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        this.jumpToReviewStep(idx);
      });

      row.querySelector('.tl-jump-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.jumpToReviewStep(idx);
        this.analyticsDialog?.close();
      });

      row.querySelector('.tl-comment-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const entered = await this.host.openTextPrompt(
          `Mentor Feedback — Step #${idx + 1}`,
          st.mentorComment || '',
          `${st.label} (${fmtReplayTime(st.time, tz)})`,
          'Write mentor review comment...'
        );
        if (entered === null) return;
        st.mentorComment = entered.trim();
        this._renderTimelineRows();
        this.saveSessionSoon();
      });

      this.rpaTimelineListEl.appendChild(row);
    });
  }

  jumpToReviewStep(idx) {
    const steps = this.session?.timeline || [];
    if (!steps.length || idx < 0 || idx >= steps.length) return;
    this.pause();
    const step = steps[idx];
    this.activeReviewStepIdx = idx;
    this.reviewTimeFilter = step.time;

    // Move replay cursor to this exact step timestamp so candles & drawings reflect that moment!
    if (this.m1Bars.length > 0 && Number.isFinite(step.time)) {
      let bestIdx = 0;
      for (let i = 0; i < this.m1Bars.length; i++) {
        if (this.m1Bars[i].time <= step.time) bestIdx = i;
        else break;
      }
      this.m1Index = bestIdx;
      this.session.cursorTime = this.m1Bars[bestIdx].time;
      for (const pane of this.host.getPanes().values()) {
        const merged = this._buildMtfBarsForPane(pane.id, this.session.cursorTime);
        pane.setReplayClock(this.session.cursorTime);
        pane.setReplayBars(merged, { precision: pane.precision, bucketSec: pane.bucketSec }, { fitView: false });
        pane.focusTime(this.session.cursorTime);
      }
    }

    this._syncSessionDrawingsToPanes();
    this._updateAllUi();
    this._renderTimelineRows();
    this.host.showToast(`Step #${idx + 1}: ${step.label}`, step.mentorComment || step.detail || '');
  }

  stepReviewTimeline(delta) {
    const steps = this.session?.timeline || [];
    if (!steps.length) return;
    const nextIdx =
      this.activeReviewStepIdx === -1
        ? delta > 0
          ? 0
          : steps.length - 1
        : Math.max(0, Math.min(steps.length - 1, this.activeReviewStepIdx + delta));
    this.jumpToReviewStep(nextIdx);
  }

  _stopReviewStepsPlay() {
    if (this.reviewPlayTimer) {
      clearInterval(this.reviewPlayTimer);
      this.reviewPlayTimer = null;
    }
    if (this.rpaPlayStepsBtn) this.rpaPlayStepsBtn.textContent = '▶ Play Steps';
  }

  toggleReviewStepsPlay() {
    if (this.reviewPlayTimer) {
      this._stopReviewStepsPlay();
      return;
    }
    const steps = this.session?.timeline || [];
    if (!steps.length) return;
    this.analyticsDialog?.close();
    if (this.activeReviewStepIdx >= steps.length - 1 || this.activeReviewStepIdx < 0) {
      this.jumpToReviewStep(0);
    }
    if (this.rpaPlayStepsBtn) this.rpaPlayStepsBtn.textContent = '⏸ Stop';
    this.reviewPlayTimer = setInterval(() => {
      if (this.activeReviewStepIdx + 1 >= steps.length) {
        this._stopReviewStepsPlay();
        this.host.showToast('Mentor Review Complete', 'Reached the final recorded student action.');
        return;
      }
      this.jumpToReviewStep(this.activeReviewStepIdx + 1);
    }, 1800);
  }

  showAllReviewOverview() {
    this._stopReviewStepsPlay();
    this.reviewTimeFilter = null;
    this.activeReviewStepIdx = -1;
    if (this.m1Bars.length > 0 && this.session) {
      const steps = this.session.timeline || [];
      const lastActionTime = steps.length ? steps[steps.length - 1].time : this.session.cursorTime;
      const targetTime = Math.max(this.session.cursorTime, lastActionTime);
      let bestIdx = 0;
      for (let i = 0; i < this.m1Bars.length; i++) {
        if (this.m1Bars[i].time <= targetTime) bestIdx = i;
        else break;
      }
      this.m1Index = bestIdx;
      this.session.cursorTime = this.m1Bars[bestIdx].time;
      for (const pane of this.host.getPanes().values()) {
        const merged = this._buildMtfBarsForPane(pane.id, this.session.cursorTime);
        pane.setReplayClock(this.session.cursorTime);
        pane.setReplayBars(merged, { precision: pane.precision, bucketSec: pane.bucketSec }, { fitView: true });
      }
    }
    this._syncSessionDrawingsToPanes();
    this._updateAllUi();
    this._renderTimelineRows();
  }

  // ==========================================================================
  // Portable Self-Contained Review Pack (.linepulse.json) Export & Offline Import
  // ==========================================================================
  async exportReviewPack() {
    if (!this.session) {
      this.host.showToast('No Active Session', 'Open or create a Backtest session first.');
      return;
    }
    const s = this.session;
    const chosenName = await this.host.openTextPrompt(
      'Export Backtest File Name',
      s.name || 'backtest',
      'Saved as <name>.linepulse.json (shareable offline with mentor/friends).',
      'e.g. XAU_London_Sweep'
    );
    if (chosenName === null) return;
    const finalName = chosenName.trim() || s.name || 'backtest';
    const minTime = Math.min(
      s.startTime || Infinity,
      ...(s.trades || []).map((t) => t.entryTime),
      ...(s.timeline || []).map((st) => st.time)
    );
    const maxTime = Math.max(
      s.cursorTime || 0,
      ...(s.trades || []).map((t) => t.exitTime || t.entryTime),
      ...(s.timeline || []).map((st) => st.time)
    );

    // Embed compact 1m OHLC candle snapshot covering the full backtest window so Mentor needs ZERO API keys!
    const windowFrom = (Number.isFinite(minTime) ? minTime : s.startTime) - 18 * 3600;
    const windowTo = (maxTime || s.cursorTime) + 6 * 3600;
    let embeddedM1Bars = this.m1Bars.filter((b) => b.time >= windowFrom && b.time <= windowTo);
    if (embeddedM1Bars.length > 6000) {
      embeddedM1Bars = embeddedM1Bars.slice(-6000);
    }

    const pack = {
      format: 'linepulse-backtest-pack',
      version: 1,
      exportedAt: new Date().toISOString(),
      session: {
        ...s,
        name: finalName,
        embeddedM1Bars,
        embeddedPrecision: this.m1Meta.precision,
        embeddedNews: this.replayNewsEvents.slice(0, 80),
      },
    };

    const safeName = finalName.replace(/[^a-zA-Z0-9_-]/g, '_');
    this._downloadBlob(
      new Blob([JSON.stringify(pack)], { type: 'application/json' }),
      `${safeName}.linepulse.json`
    );
    this.host.showToast(
      '📤 Review Pack Exported',
      `${safeName}.linepulse.json (${embeddedM1Bars.length} candles + ${(s.timeline || []).length} steps). Share via WhatsApp/Telegram — opens with zero API keys!`
    );
  }

  async _handleImportReviewPack() {
    const file = this.rpImportSessionInput?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const importedSession = parsed?.format === 'linepulse-backtest-pack' ? parsed.session : parsed;
      if (!importedSession || !importedSession.symbol) {
        throw new Error('Invalid LinePulse backtest file.');
      }

      // Assign unique id if importing a fresh copy, or update if mentor re-imports edited review
      const sessionToSave = {
        ...importedSession,
        id: importedSession.id || `imp-${Date.now()}`,
        name: importedSession.name || file.name.replace(/\.linepulse\.json$/i, ''),
      };

      const res = await fetch('/api/replay/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: sessionToSave }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not import backtest file.');
      if (Array.isArray(data.sessions)) this.sessions = data.sessions;

      this.sessionDialog?.close();
      await this.loadSession(data.session || sessionToSave);
      this.host.showToast(
        '📥 Backtest Imported',
        `Loaded "${sessionToSave.name}" (${(sessionToSave.timeline || []).length} recorded steps). Open 📊 Stats → Step-by-Step Review to inspect!`
      );
    } catch (err) {
      if (this.rpsFeedbackEl) this.rpsFeedbackEl.textContent = err.message || 'Import failed.';
    } finally {
      if (this.rpImportSessionInput) this.rpImportSessionInput.value = '';
    }
  }

  _drawEquityCurve() {
    const canvas = this.rpaEquityCanvas;
    if (!canvas || !this.session) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const pts = this.session.equityCurve || [];
    if (pts.length < 2) {
      ctx.fillStyle = '#8b95ad';
      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Complete at least 1 trade to plot the equity curve.', w / 2, h / 2);
      return;
    }

    const vals = pts.map((p) => p.balance ?? p.equity ?? this.session.initialBalance);
    const minV = Math.min(...vals, this.session.initialBalance);
    const maxV = Math.max(...vals, this.session.initialBalance);
    const span = Math.max(1, maxV - minV);
    const padX = 16;
    const padY = 18;
    const toX = (i) => padX + (i / (vals.length - 1)) * (w - padX * 2);
    const toY = (v) => h - padY - ((v - minV) / span) * (h - padY * 2);

    // Baseline (starting balance)
    const baseY = toY(this.session.initialBalance);
    ctx.strokeStyle = 'rgba(139, 149, 173, 0.35)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padX, baseY);
    ctx.lineTo(w - padX, baseY);
    ctx.stroke();
    ctx.setLineDash([]);

    const lastVal = vals[vals.length - 1];
    const isUp = lastVal >= this.session.initialBalance;
    const strokeCol = isUp ? '#22c55e' : '#ef4444';

    // Area fill
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(vals[0]));
    for (let i = 1; i < vals.length; i++) ctx.lineTo(toX(i), toY(vals[i]));
    ctx.lineTo(toX(vals.length - 1), h - padY);
    ctx.lineTo(toX(0), h - padY);
    ctx.closePath();
    ctx.fillStyle = isUp ? 'rgba(34, 197, 94, 0.14)' : 'rgba(239, 68, 68, 0.14)';
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(vals[0]));
    for (let i = 1; i < vals.length; i++) ctx.lineTo(toX(i), toY(vals[i]));
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  _renderJournalRows() {
    if (!this.rpaJournalListEl || !this.session) return;
    const q = (this.rpaTagFilterEl?.value || '').trim().toLowerCase();
    const tz = this.host.getPrefs().timezone;
    const rows = [...(this.session.trades || [])]
      .reverse()
      .filter((t) => {
        if (!q) return true;
        const hay = `${t.side} ${t.reason} ${t.note || ''} ${(t.tags || []).join(' ')}`.toLowerCase();
        return hay.includes(q);
      });

    this.rpaJournalListEl.innerHTML = '';
    if (!rows.length) {
      this.rpaJournalListEl.innerHTML =
        '<div style="padding:14px;text-align:center;color:var(--text-secondary);font-size:12px;">No trades match this filter yet.</div>';
      return;
    }

    for (const t of rows) {
      const el = document.createElement('div');
      el.className = 'rp-journal-row';
      const pnlCol = t.pnl >= 0 ? 'var(--up)' : 'var(--down)';
      const tagsHtml = (t.tags || [])
        .map((tg) => `<span class="rp-tag-pill">${escapeHtml(tg)}</span>`)
        .join('');
      const rTxt = t.rMultiple !== null ? ` (${t.rMultiple >= 0 ? '+' : ''}${t.rMultiple}R)` : '';

      el.innerHTML = `
        <span class="source-pill ${t.side === 'buy' ? 'oanda' : 'kraken'}">${t.side.toUpperCase()}</span>
        <div style="min-width:0;">
          <div><b>${t.lots.toFixed(2)} ${escapeHtml(t.display)}</b> · ${t.entryPrice} → ${t.exitPrice} · <span style="color:var(--text-secondary)">${fmtReplayTime(t.entryTime, tz)}</span></div>
          <div style="font-size:10.5px;color:var(--text-secondary);margin-top:2px;">
            ${tagsHtml}${escapeHtml(t.note || t.reason || '')}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <b style="color:${pnlCol};font-variant-numeric:tabular-nums;">${fmtUsd(t.pnl, true)}${rTxt}</b>
          <button type="button" class="mini-btn j-note-btn" title="Edit tags &amp; note">Note</button>
          <button type="button" class="mini-btn j-jump-btn" title="Jump chart to trade">◎</button>
        </div>
      `;

      el.querySelector('.j-note-btn').addEventListener('click', async () => {
        const cur = [
          ...(t.tags || []).map((x) => `#${x}`),
          t.note || '',
        ]
          .filter(Boolean)
          .join(' ');
        const entered = await this.host.openTextPrompt(
          'Trade Tags & Note',
          cur,
          'Prefix tags with # (e.g. #FVG #London Clean sweep before entry).',
          '#FVG #BOS note...'
        );
        if (entered === null) return;
        const tags = [];
        const noteWords = [];
        for (const w of entered.trim().split(/\s+/)) {
          if (w.startsWith('#') && w.length > 1) tags.push(w.slice(1));
          else if (w) noteWords.push(w);
        }
        t.tags = tags;
        t.note = noteWords.join(' ');
        this.renderAnalyticsDialog();
        this.saveSessionSoon();
      });

      el.querySelector('.j-jump-btn').addEventListener('click', () => {
        this.analyticsDialog?.close();
        this.host.getActivePane()?.focusTime(t.entryTime);
      });

      this.rpaJournalListEl.appendChild(el);
    }
  }

  exportJournalCsv() {
    if (!this.session) return;
    const headers = ['ID', 'Symbol', 'Side', 'Lots', 'EntryTime', 'ExitTime', 'EntryPrice', 'ExitPrice', 'GrossPnL', 'Commission', 'NetPnL', 'R', 'Reason', 'Tags', 'Note'];
    const lines = [headers.join(',')];
    for (const t of this.session.trades || []) {
      const row = [
        t.id,
        t.display,
        t.side,
        t.lots,
        new Date(t.entryTime * 1000).toISOString(),
        new Date(t.exitTime * 1000).toISOString(),
        t.entryPrice,
        t.exitPrice,
        t.grossPnl,
        t.commission,
        t.pnl,
        t.rMultiple ?? '',
        `"${String(t.reason || '').replace(/"/g, '""')}"`,
        `"${(t.tags || []).join(' ')}"`,
        `"${String(t.note || '').replace(/"/g, '""')}"`,
      ];
      lines.push(row.join(','));
    }
    this._downloadBlob(
      new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }),
      `${this.session.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_journal.csv`
    );
  }

  exportJournalJson() {
    if (!this.session) return;
    this._downloadBlob(
      new Blob([JSON.stringify(this.session, null, 2)], { type: 'application/json' }),
      `${this.session.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_session.json`
    );
  }

  _downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  saveSessionSoon(immediate = false) {
    if (!this.session) return;
    clearTimeout(this.saveDebounce);
    const run = () => {
      if (!this.session) return;
      fetch('/api/replay/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: this.session }),
      }).catch(() => {});
    };
    if (immediate) run();
    else this.saveDebounce = setTimeout(run, 500);
  }
}
