import { createChart, CrosshairMode, LineStyle, PriceScaleMode } from '/vendor/lightweight-charts.mjs';
import { DrawingsPrimitive, computePositionToolMetrics } from './drawings-primitive.js';

let colorProbeEl = null;

function resolveCssColor(varName, fallback) {
  if (!colorProbeEl) {
    colorProbeEl = document.createElement('span');
    colorProbeEl.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden;';
    document.body.appendChild(colorProbeEl);
  }
  colorProbeEl.style.color = `var(${varName})`;
  const computed = getComputedStyle(colorProbeEl).color;
  return computed && computed.startsWith('rgb') ? computed : fallback;
}

function getEffectiveStyle(prefs, override) {
  const c = prefs.colors || {};
  const ov = override || {};
  return {
    bg: ov.chartBg || c.chartBg || resolveCssColor('--bg-surface', '#131722'),
    text: ov.textColor || c.textColor || resolveCssColor('--text-secondary', '#8b95ad'),
    grid: ov.gridColor || c.gridColor || resolveCssColor('--border', '#262c3f'),
    border: resolveCssColor('--border', '#262c3f'),
    accent: resolveCssColor('--accent', '#2962ff'),
    lineColor: ov.lineColor || c.lineColor || '#2962ff',
    upColor: ov.upColor || c.upColor || '#26a69a',
    downColor: ov.downColor || c.downColor || '#ef5350',
    lineWidth: Number(ov.lineWidth ?? prefs.lineWidth ?? 2),
    showGrid: typeof ov.showGrid === 'boolean' ? ov.showGrid : Boolean(prefs.showGrid),
  };
}

function formatAxisTime(unixSec, timezone, tf) {
  try {
    const d = new Date(unixSec * 1000);
    const isSubMin = tf === '1s' || tf === '5s' || tf === '15s' || tf === '30s';
    const isMultiDay =
      tf === '1d' ||
      tf === '1w' ||
      tf === '1M' ||
      tf.endsWith('d') ||
      tf.endsWith('w') ||
      tf.endsWith('M');

    if (isMultiDay) {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone || 'Europe/Istanbul',
        day: '2-digit',
        month: 'short',
      }).format(d);
    }

    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'Europe/Istanbul',
      hour: '2-digit',
      minute: '2-digit',
      ...(isSubMin ? { second: '2-digit' } : {}),
      hour12: false,
    }).format(d);
  } catch {
    return '';
  }
}

function formatTooltipTime(unixSec, timezone) {
  try {
    const d = new Date(unixSec * 1000);
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'Europe/Istanbul',
      day: '2-digit',
      month: 'short',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return String(unixSec);
  }
}

function getBucketTime(unixSec, tf, bucketSec) {
  if (tf.endsWith('M')) {
    const count = Number.parseInt(tf, 10) || 1;
    const d = new Date(unixSec * 1000);
    const mIdx = Math.floor(d.getUTCMonth() / count) * count;
    return Math.floor(Date.UTC(d.getUTCFullYear(), mIdx, 1) / 1000);
  }
  if (tf.endsWith('w')) {
    const weekOffset = 345600;
    const span = bucketSec || 604800;
    return Math.floor((unixSec - weekOffset) / span) * span + weekOffset;
  }
  const sec = bucketSec || 60;
  return Math.floor(unixSec / sec) * sec;
}

const EXPAND_SVG = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <path d="M9.5 2.5h4v4M13.5 2.5L9.5 6.5M6.5 13.5h-4v-4M2.5 13.5l4-4" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const RESTORE_SVG = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <path d="M13.5 6.5h-4v-4M9.5 6.5l4-4M2.5 9.5h4v4M6.5 9.5l-4 4" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const LINE_STYLE_SVGS = {
  solid: `<svg width="24" height="12" viewBox="0 0 24 12" fill="none" aria-hidden="true"><line x1="2" y1="6" x2="22" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  dashed: `<svg width="24" height="12" viewBox="0 0 24 12" fill="none" aria-hidden="true"><line x1="2" y1="6" x2="22" y2="6" stroke="currentColor" stroke-width="2" stroke-dasharray="5 3"/></svg>`,
  dotted: `<svg width="24" height="12" viewBox="0 0 24 12" fill="none" aria-hidden="true"><circle cx="4" cy="6" r="1.4" fill="currentColor"/><circle cx="9.3" cy="6" r="1.4" fill="currentColor"/><circle cx="14.7" cy="6" r="1.4" fill="currentColor"/><circle cx="20" cy="6" r="1.4" fill="currentColor"/></svg>`,
};

const LINE_STYLE_TITLES = {
  solid: 'Line style: Solid (click for Dashed)',
  dashed: 'Line style: Dashed (click for Dotted)',
  dotted: 'Line style: Dotted (click for Solid)',
};

function getDrawingLineStyle(d) {
  if (!d) return 'solid';
  if (d.lineStyle === 'dotted' || d.lineStyle === 'dashed' || d.lineStyle === 'solid') {
    return d.lineStyle;
  }
  return d.dashed ? 'dashed' : 'solid';
}

export class ChartPane {
  constructor(options) {
    this.id = options.id;
    this.state = {
      source: options.source || 'oanda',
      symbol: options.symbol || 'XAU_USD',
      display: options.display || options.symbol || 'XAU/USD',
      tf: options.tf || '1m',
      chartType: options.chartType || 'candle',
      logScale: Boolean(options.logScale),
      styleOverride: options.styleOverride || null,
    };
    this.autoScaleEnabled = true;
    this.prefs = options.prefs;
    this.timeframesList = options.timeframesList || [];
    this.callbacks = options.callbacks;
    this.isPopout = Boolean(options.isPopout);

    this.bars = [];
    this.bucketSec = 60;
    this.precision = 2;
    this.referencePrice = null;
    this.lastPrice = null;
    this.feedMode = 'live';
    this.isMaximized = false;
    this.needsOandaKey = false;
    this.flashTimer = null;
    this.abortFetch = null;
    this.loadingOlder = false;
    this.reachedHistoryStart = false;
    this.pendingOlderBars = null;
    this.suppressCrosshairEmit = false;
    this.lastSyncedTime = undefined;
    this.isPanningChart = false;
    this.replayMode = false;
    this.replayClock = null;
    this.replayLineDrag = null;

    // Drawing state
    this.activeTool = options.activeTool || 'cursor';
    this.drawingColor = options.drawingColor || '#f59e0b';
    this.magnetEnabled = Boolean(options.magnetEnabled);
    this.hideAllDrawings = Boolean(options.hideAllDrawings);
    this.drawings = [];
    this.draftDrawing = null;
    this.selectedDrawingIds = new Set();
    this.dragInfo = null;
    this.marqueeInfo = null;

    this._buildDom();
    this._initChart();
    this._bindDrawingEvents();
    this._applyPaneBgStyle();
  }

  get symbolKey() {
    return `${this.state.source}:${this.state.symbol}`;
  }

  getResolvedStyle() {
    return getEffectiveStyle(this.prefs, this.state.styleOverride);
  }

  _applyPaneBgStyle() {
    if (this.state.styleOverride?.chartBg) {
      this.el.style.background = this.state.styleOverride.chartBg;
      this.headerEl.style.background = this.state.styleOverride.chartBg;
    } else {
      this.el.style.removeProperty('background');
      this.headerEl.style.removeProperty('background');
    }
  }

  _buildDom() {
    const el = document.createElement('section');
    el.className = 'chart-pane';
    el.dataset.paneId = this.id;

    el.innerHTML = `
      <div class="pane-header" title="Double-click header to expand / restore pane">
        <div class="pane-left">
          <button type="button" class="pane-sym-btn" title="Change symbol">
            <span class="source-pill ${this.state.source}">${this.state.source.toUpperCase()}</span>
            <span class="pane-sym-text">${this.state.display}</span>
          </button>
          <span class="pane-feed-badge live" title="Feed status">LIVE</span>
          <div class="pane-price-wrap">
            <span class="pane-price">--</span>
            <span class="pane-change flat">0.00%</span>
          </div>
        </div>
        <div class="pane-controls">
          <select class="pane-type-select" aria-label="Chart type" title="Chart type (Candles / Bars / Line)">
            <option value="candle" ${this.state.chartType === 'candle' ? 'selected' : ''}>Candles</option>
            <option value="bar" ${this.state.chartType === 'bar' ? 'selected' : ''}>Bars</option>
            <option value="line" ${this.state.chartType === 'line' ? 'selected' : ''}>Line</option>
          </select>
          <select class="pane-tf-select" aria-label="Chart timeframe"></select>
          <button type="button" class="icon-btn pane-style-btn" title="Customize this chart's background, candles, grid &amp; templates">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="5.8" stroke="currentColor" stroke-width="1.35"/>
              <circle cx="6.2" cy="6.4" r="1" fill="currentColor"/>
              <circle cx="9.8" cy="6.2" r="1" fill="currentColor"/>
              <circle cx="10" cy="9.6" r="1" fill="currentColor"/>
              <circle cx="6.3" cy="9.8" r="1" fill="currentColor"/>
            </svg>
          </button>
          <button type="button" class="icon-btn pane-fit-btn" title="Auto-fit chart">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </button>
          ${
            this.isPopout
              ? ''
              : `
          <button type="button" class="icon-btn pane-popout-btn" title="Pop out this chart to another monitor">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M9.5 2.5h4v4M13.5 2.5l-5.5 5.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M12 9v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </button>
          <button type="button" class="icon-btn pane-max-btn" title="Expand pane inside window (F)">
            ${EXPAND_SVG}
          </button>`
          }
        </div>
      </div>
      <div class="pane-canvas-host">
        <div class="drawing-edit-bar" hidden>
          <span class="dbar-count" hidden></span>
          <button type="button" class="dbar-btn dbar-label-btn" title="Add / edit label on drawing">T Label</button>
          <div class="dbar-text-align" hidden>
            <div class="dbar-align-grp" role="group" aria-label="Label horizontal position">
              <button type="button" class="dbar-align-btn" data-halign="left" title="Label Left">L</button>
              <button type="button" class="dbar-align-btn" data-halign="center" title="Label Center">C</button>
              <button type="button" class="dbar-align-btn" data-halign="right" title="Label Right">R</button>
            </div>
            <div class="dbar-align-grp" role="group" aria-label="Label vertical position">
              <button type="button" class="dbar-align-btn" data-valign="top" title="Label Above (Top)">↑</button>
              <button type="button" class="dbar-align-btn" data-valign="middle" title="Label Middle">–</button>
              <button type="button" class="dbar-align-btn" data-valign="bottom" title="Label Below (Bottom)">↓</button>
            </div>
          </div>
          <div class="dbar-swatches" role="group" aria-label="Quick colors">
            <button type="button" class="dbar-swatch" data-color="#f59e0b" style="--sw:#f59e0b" title="Gold"></button>
            <button type="button" class="dbar-swatch" data-color="#38bdf8" style="--sw:#38bdf8" title="Sky Blue"></button>
            <button type="button" class="dbar-swatch" data-color="#22c55e" style="--sw:#22c55e" title="Green"></button>
            <button type="button" class="dbar-swatch" data-color="#ef4444" style="--sw:#ef4444" title="Red"></button>
            <button type="button" class="dbar-swatch" data-color="#ffffff" style="--sw:#ffffff" title="White"></button>
            <button type="button" class="dbar-swatch" data-color="#a855f7" style="--sw:#a855f7" title="Purple"></button>
          </div>
          <label class="dbar-color-wrap" title="Pick custom color">
            <span class="dbar-color-dot" aria-hidden="true"></span>
            <input type="color" class="dbar-color" aria-label="Custom drawing color">
          </label>
          <select class="dbar-width" title="Line width" aria-label="Line width">
            <option value="1">1px</option>
            <option value="2">2px</option>
            <option value="3">3px</option>
            <option value="4">4px</option>
          </select>
          <button type="button" class="dbar-btn dbar-dash-btn" title="Line style: Solid (click for Dashed)">${LINE_STYLE_SVGS.solid}</button>
          <button type="button" class="dbar-btn dbar-arrow-btn" title="Arrowhead style (None / Single / Double)" hidden>—</button>
          <div class="dbar-rect-cfg" hidden>
            <label class="dbar-opacity-label" title="Box interior opacity">
              <span>Fill</span>
              <input type="range" class="dbar-rect-opacity" min="0" max="85" step="5" value="14">
              <span class="dbar-rect-opacity-val">14%</span>
            </label>
            <button type="button" class="dbar-btn dbar-border-btn active" title="Toggle box outline border">Border</button>
          </div>
          <div class="dbar-pos-cfg" hidden>
            <label title="Account Capital ($)">$ <input type="number" class="dbar-pos-cap" value="100000" min="10" step="100"></label>
            <label title="Risk per trade (%)">Risk% <input type="number" class="dbar-pos-risk" value="1" min="0.1" max="100" step="0.25"></label>
          </div>
          <button type="button" class="dbar-btn dbar-hide-btn" title="Hide selected drawing(s)">Hide</button>
          <button type="button" class="dbar-btn dbar-alert-btn" title="Create price alert at this line" hidden>🔔 Alert</button>
          <button type="button" class="dbar-btn dbar-del-btn" title="Delete selected drawing(s) (Delete)">Delete</button>
        </div>
        <div class="pane-scale-pills" role="group" aria-label="Price scale mode">
          <button type="button" class="scale-pill-btn pane-log-btn ${this.state.logScale ? 'active' : ''}" aria-pressed="${this.state.logScale ? 'true' : 'false'}" title="Toggle Logarithmic price scale">log</button>
          <button type="button" class="scale-pill-btn pane-auto-btn active" aria-pressed="true" title="Toggle Auto price scaling (fits candles vertically)">auto</button>
        </div>
        <div class="pane-pos-tooltip" hidden></div>
        <div class="pane-context-menu" hidden></div>
        <div class="pane-news-card" hidden></div>
        <div class="pane-overlay-msg" hidden>
          <span class="pane-overlay-text">Loading...</span>
          <button type="button" class="pane-retry-btn" hidden>Retry</button>
        </div>
      </div>
    `;

    this.el = el;
    this.headerEl = el.querySelector('.pane-header');
    this.symBtn = el.querySelector('.pane-sym-btn');
    this.sourcePill = el.querySelector('.source-pill');
    this.symText = el.querySelector('.pane-sym-text');
    this.feedBadge = el.querySelector('.pane-feed-badge');
    this.priceEl = el.querySelector('.pane-price');
    this.changeEl = el.querySelector('.pane-change');
    this.typeSelect = el.querySelector('.pane-type-select');
    this.tfSelect = el.querySelector('.pane-tf-select');
    this.styleBtn = el.querySelector('.pane-style-btn');
    this.fitBtn = el.querySelector('.pane-fit-btn');
    this.popoutBtn = el.querySelector('.pane-popout-btn');
    this.maxBtn = el.querySelector('.pane-max-btn');
    this.hostEl = el.querySelector('.pane-canvas-host');
    this.editBarEl = el.querySelector('.drawing-edit-bar');
    this.dbarCountEl = el.querySelector('.dbar-count');
    this.dbarLabelBtn = el.querySelector('.dbar-label-btn');
    this.dbarTextAlignEl = el.querySelector('.dbar-text-align');
    this.dbarSwatchesEl = el.querySelector('.dbar-swatches');
    this.dbarColorWrap = el.querySelector('.dbar-color-wrap');
    this.dbarColorDot = el.querySelector('.dbar-color-dot');
    this.dbarColorInput = el.querySelector('.dbar-color');
    this.dbarWidthSelect = el.querySelector('.dbar-width');
    this.dbarDashBtn = el.querySelector('.dbar-dash-btn');
    this.dbarArrowBtn = el.querySelector('.dbar-arrow-btn');
    this.dbarRectCfgEl = el.querySelector('.dbar-rect-cfg');
    this.dbarRectOpacityInput = el.querySelector('.dbar-rect-opacity');
    this.dbarRectOpacityVal = el.querySelector('.dbar-rect-opacity-val');
    this.dbarBorderBtn = el.querySelector('.dbar-border-btn');
    this.dbarPosCfgEl = el.querySelector('.dbar-pos-cfg');
    this.dbarPosCapInput = el.querySelector('.dbar-pos-cap');
    this.dbarPosRiskInput = el.querySelector('.dbar-pos-risk');
    this.dbarHideBtn = el.querySelector('.dbar-hide-btn');
    this.dbarAlertBtn = el.querySelector('.dbar-alert-btn');
    this.dbarDelBtn = el.querySelector('.dbar-del-btn');
    this.logScaleBtn = el.querySelector('.pane-log-btn');
    this.autoScaleBtn = el.querySelector('.pane-auto-btn');
    this.posTooltipEl = el.querySelector('.pane-pos-tooltip');
    this.ctxMenuEl = el.querySelector('.pane-context-menu');
    this.newsCardEl = el.querySelector('.pane-news-card');
    this.overlayEl = el.querySelector('.pane-overlay-msg');
    this.overlayTextEl = el.querySelector('.pane-overlay-text');
    this.retryBtn = el.querySelector('.pane-retry-btn');

    this.updateTimeframeOptions(this.timeframesList);

    el.addEventListener('pointerdown', () => this.callbacks.onActivate(this.id));
    if (!this.isPopout) {
      this.headerEl.addEventListener('dblclick', (e) => {
        if (e.target.closest('button, select, input')) return;
        this.callbacks.onToggleMaximize(this.id);
      });
    }

    this.symBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onActivate(this.id);
      this.callbacks.onOpenSymbolSearch(this.id);
    });
    this.typeSelect.addEventListener('change', () => {
      this.setChartType(this.typeSelect.value);
      this.callbacks.onPaneChanged(this.id);
    });
    this.tfSelect.addEventListener('change', () => {
      this.setTimeframe(this.tfSelect.value);
      this.callbacks.onPaneChanged(this.id);
    });
    this.styleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onActivate(this.id);
      this.callbacks.onOpenStyleDialog(this.id);
    });
    this.fitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.resetChartView();
    });
    this.logScaleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setLogScale(!this.state.logScale);
      this.callbacks.onPaneChanged(this.id);
    });
    this.autoScaleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setAutoScale(!this.autoScaleEnabled);
    });
    if (this.popoutBtn) {
      this.popoutBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onPopout(this.id);
      });
    }
    if (this.maxBtn) {
      this.maxBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onToggleMaximize(this.id);
      });
    }
    this.retryBtn.addEventListener('click', () => {
      if (this.needsOandaKey && this.callbacks.onOpenSettings) {
        this.callbacks.onOpenSettings();
      } else {
        this.loadHistory();
      }
    });

    // Floating drawing edit bar controls
    this.editBarEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.newsCardEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.ctxMenuEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.posTooltipEl.addEventListener('pointerdown', (e) => e.stopPropagation());

    const onPosCfgChange = () => {
      const selected = this._getSelectedDrawings();
      const cap = Math.max(10, Number(this.dbarPosCapInput.value) || 100000);
      const rPct = Math.max(0.05, Number(this.dbarPosRiskInput.value) || 1);
      for (const d of selected) {
        if (d.type === 'longpos' || d.type === 'shortpos') {
          d.accountSize = cap;
          d.riskPct = rPct;
        }
      }
      this._saveDrawDefault({ accountSize: cap, riskPct: rPct });
      this._commitDrawings();
      const primary = this._getPrimarySelectedDrawing();
      if (primary && (primary.type === 'longpos' || primary.type === 'shortpos')) {
        this._posTooltipDismissedId = null;
        this._renderPosInfoCard(primary);
      }
    };
    this.dbarPosCapInput.addEventListener('input', onPosCfgChange);
    this.dbarPosCapInput.addEventListener('change', onPosCfgChange);
    this.dbarPosRiskInput.addEventListener('input', onPosCfgChange);
    this.dbarPosRiskInput.addEventListener('change', onPosCfgChange);
    this.dbarLabelBtn.addEventListener('click', () => this.promptEditSelectedLabel());
    this.dbarTextAlignEl?.addEventListener('click', (e) => {
      const hBtn = e.target.closest('[data-halign]');
      const vBtn = e.target.closest('[data-valign]');
      const selected = this._getSelectedDrawings();
      if (!selected.length) return;
      if (hBtn) {
        for (const d of selected) d.textHAlign = hBtn.dataset.halign;
        this._saveDrawDefault({ textHAlign: hBtn.dataset.halign });
      } else if (vBtn) {
        for (const d of selected) d.textVAlign = vBtn.dataset.valign;
        this._saveDrawDefault({ textVAlign: vBtn.dataset.valign });
      } else {
        return;
      }
      this._commitDrawings();
      this._syncEditBar();
    });
    this.dbarSwatchesEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.dbar-swatch');
      if (!btn) return;
      this.recolorSelectedDrawing(btn.dataset.color);
      this.callbacks.onDrawingColorChanged?.(btn.dataset.color);
    });
    const onCustomColorChange = () => {
      const hex = this.dbarColorInput.value;
      if (this.dbarColorDot) this.dbarColorDot.style.background = hex;
      this.recolorSelectedDrawing(hex);
      this.callbacks.onDrawingColorChanged?.(hex);
    };
    this.dbarColorInput.addEventListener('input', onCustomColorChange);
    this.dbarColorInput.addEventListener('change', onCustomColorChange);
    this.dbarWidthSelect.addEventListener('change', () => {
      const selected = this._getSelectedDrawings();
      if (!selected.length) return;
      const w = Number(this.dbarWidthSelect.value) || 2;
      for (const d of selected) d.width = w;
      this._saveDrawDefault({ width: w });
      this._commitDrawings();
    });
    this.dbarDashBtn.addEventListener('click', () => {
      const selected = this._getSelectedDrawings();
      if (!selected.length) return;
      const order = ['solid', 'dashed', 'dotted'];
      const curStyle = getDrawingLineStyle(selected[0]);
      const nextStyle = order[(order.indexOf(curStyle) + 1) % order.length];
      for (const d of selected) {
        d.lineStyle = nextStyle;
        d.dashed = nextStyle !== 'solid';
      }
      this._saveDrawDefault({ lineStyle: nextStyle });
      this._commitDrawings();
      this._syncEditBar();
    });
    this.dbarArrowBtn.addEventListener('click', () => {
      const selected = this._getSelectedDrawings();
      if (!selected.length) return;
      const order = ['none', 'single', 'double'];
      const first = selected[0];
      const curMode =
        first.arrowMode ||
        (first.type === 'darrow' ? 'double' : first.type === 'arrow' ? 'single' : 'none');
      const nextMode = order[(order.indexOf(curMode) + 1) % order.length];
      for (const d of selected) {
        if (['trend', 'arrow', 'darrow', 'zigzag'].includes(d.type)) {
          d.arrowMode = nextMode;
        }
      }
      this._commitDrawings();
      this._syncEditBar();
    });
    const onRectOpacityChange = () => {
      const selected = this._getSelectedDrawings();
      const pct = Math.max(0, Math.min(85, Number(this.dbarRectOpacityInput.value) || 0));
      if (this.dbarRectOpacityVal) this.dbarRectOpacityVal.textContent = `${pct}%`;
      const op = Number((pct / 100).toFixed(2));
      for (const d of selected) {
        if (d.type === 'rect') {
          d.fillOpacity = op;
        }
      }
      this._saveDrawDefault({ fillOpacity: op });
      this._commitDrawings();
    };
    this.dbarRectOpacityInput.addEventListener('input', onRectOpacityChange);
    this.dbarRectOpacityInput.addEventListener('change', onRectOpacityChange);
    this.dbarBorderBtn.addEventListener('click', () => {
      const selected = this._getSelectedDrawings();
      if (!selected.length) return;
      const nextNoBorder = !Boolean(selected[0].noBorder);
      for (const d of selected) {
        if (d.type === 'rect') d.noBorder = nextNoBorder;
      }
      this._saveDrawDefault({ noBorder: nextNoBorder });
      this._commitDrawings();
      this._syncEditBar();
    });
    this.dbarHideBtn.addEventListener('click', () => this.hideSelectedDrawings());
    this.dbarAlertBtn.addEventListener('click', () => {
      const d = this._getPrimarySelectedDrawing();
      if (!d || d.type !== 'hline' || !this.callbacks.onCreateAlertFromLine) return;
      this.callbacks.onCreateAlertFromLine({
        source: this.state.source,
        symbol: this.state.symbol,
        display: this.state.display,
        price: Number(d.p1.price.toFixed(this.precision)),
        message: d.text || '',
        currentPrice: this.lastPrice,
      });
    });
    this.dbarDelBtn.addEventListener('click', () => this.deleteSelectedDrawing());
  }

  updateTimeframeOptions(list) {
    this.timeframesList = list;
    const hasCurrent = list.includes(this.state.tf);
    const all = hasCurrent ? list : [...list, this.state.tf];
    this.tfSelect.innerHTML = all
      .map((t) => {
        const label = t === '1d' ? '1D' : t === '1w' ? '1W' : t;
        return `<option value="${t}" ${t === this.state.tf ? 'selected' : ''}>${label}</option>`;
      })
      .join('');
  }

  _initChart() {
    const style = this.getResolvedStyle();
    const isSubMin = ['1s', '5s', '15s', '30s'].includes(this.state.tf);

    this.chart = createChart(this.hostEl, {
      autoSize: true,
      layout: {
        background: { color: style.bg },
        textColor: style.text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: {
          visible: style.showGrid,
          color: style.grid,
          style: LineStyle.Dotted,
        },
        horzLines: {
          visible: style.showGrid,
          color: style.grid,
          style: LineStyle.Dotted,
        },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: style.text,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: style.accent,
        },
        horzLine: {
          color: style.text,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: style.accent,
        },
      },
      rightPriceScale: {
        borderColor: style.border,
        scaleMargins: { top: 0.12, bottom: 0.12 },
        autoScale: true,
        mode: this.state.logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      },
      timeScale: {
        borderColor: style.border,
        timeVisible: true,
        secondsVisible: isSubMin,
        rightOffset: 10,
        tickMarkFormatter: (time) => formatAxisTime(time, this.prefs.timezone, this.state.tf),
      },
      localization: {
        timeFormatter: (time) => formatTooltipTime(time, this.prefs.timezone),
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    this.drawingsPrimitive = new DrawingsPrimitive(this);
    this.drawingsPrimitive.setHideAll(this.hideAllDrawings);
    this._createSeries();

    this.chart.subscribeCrosshairMove((param) => {
      if (this.suppressCrosshairEmit || this.isPanningChart || this.dragInfo) return;
      if (!param || !param.time || !param.point) {
        this.callbacks.onCrosshairMove(this.id, null);
        return;
      }
      this.callbacks.onCrosshairMove(this.id, Number(param.time));
    });

    // Infinite scroll-left history loader + keep Long/Short card anchored next to its box!
    this.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (this.posTooltipEl && !this.posTooltipEl.hidden) {
        const primary = this._getPrimarySelectedDrawing();
        if (primary && (primary.type === 'longpos' || primary.type === 'shortpos')) {
          this._positionPosInfoCard(primary);
        }
      }
      if (this.replayMode) return;
      const paginatedSources = ['oanda', 'binance', 'coinbase', 'bybit'];
      if (!range || !paginatedSources.includes(this.state.source)) return;
      if (this.loadingOlder || this.reachedHistoryStart || this.bars.length === 0) return;
      if (range.from < 30) {
        this.loadOlderHistory();
      }
    });
  }

  _createSeries() {
    if (this.series) {
      try {
        this.series.detachPrimitive(this.drawingsPrimitive);
      } catch {
        // ignore
      }
      this.chart.removeSeries(this.series);
      this.series = null;
    }

    const style = this.getResolvedStyle();
    const minMove = Number((1 / Math.pow(10, this.precision)).toFixed(this.precision));
    const priceFormat = {
      type: 'price',
      precision: this.precision,
      minMove,
    };

    if (this.state.chartType === 'candle') {
      this.series = this.chart.addCandlestickSeries({
        upColor: style.upColor,
        downColor: style.downColor,
        borderUpColor: style.upColor,
        borderDownColor: style.downColor,
        wickUpColor: style.upColor,
        wickDownColor: style.downColor,
        priceLineVisible: true,
        priceLineStyle: LineStyle.Dashed,
        priceLineWidth: 1,
        lastValueVisible: true,
        priceFormat,
      });
    } else if (this.state.chartType === 'bar') {
      this.series = this.chart.addBarSeries({
        upColor: style.upColor,
        downColor: style.downColor,
        thinBars: false,
        priceLineVisible: true,
        priceLineStyle: LineStyle.Dashed,
        priceLineWidth: 1,
        lastValueVisible: true,
        priceFormat,
      });
    } else {
      this.series = this.chart.addLineSeries({
        color: style.lineColor,
        lineWidth: style.lineWidth,
        priceLineVisible: true,
        priceLineStyle: LineStyle.Dashed,
        priceLineWidth: 1,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderWidth: 1.5,
        crosshairMarkerBorderColor: '#ffffff',
        crosshairMarkerBackgroundColor: style.lineColor,
        priceFormat,
      });
    }

    this.series.attachPrimitive(this.drawingsPrimitive);
    this._pushSeriesData();
    this.drawingsPrimitive.setData(this.drawings, this.draftDrawing, this.selectedDrawingIds);
  }

  _pushSeriesData() {
    if (!this.series) return;
    if (this.state.chartType === 'line') {
      this.series.setData(this.bars.map((b) => ({ time: b.time, value: b.close })));
    } else {
      this.series.setData(this.bars);
    }
  }

  // ==========================================================================
  // Interactive Drawing, Magnet & Shift Straight-Line Handling
  // ==========================================================================
  setDrawingTool(tool, color, magnetEnabled) {
    this.activeTool = tool || 'cursor';
    if (color) this.drawingColor = color;
    if (typeof magnetEnabled === 'boolean') this.magnetEnabled = magnetEnabled;
    this.draftDrawing = null;
    this.marqueeInfo = null;
    this.drawingsPrimitive.setMarquee(null);
    this.hostEl.classList.toggle('drawing-mode', this.activeTool !== 'cursor');
    this.drawingsPrimitive.setSnapIndicator(null);
    this.drawingsPrimitive.setData(this.drawings, this.draftDrawing, this.selectedDrawingIds);
  }

  setMagnetEnabled(enabled) {
    this.magnetEnabled = Boolean(enabled);
    if (!this.magnetEnabled) {
      this.drawingsPrimitive.setSnapIndicator(null);
    }
  }

  setHideAllDrawings(hide) {
    this.hideAllDrawings = Boolean(hide);
    this.drawingsPrimitive.setHideAll(this.hideAllDrawings);
    if (this.hideAllDrawings && this.selectedDrawingIds.size > 0) {
      this.selectedDrawingIds.clear();
      this._syncEditBar();
      this._notifySelectionChanged();
    }
  }

  setDrawings(list) {
    this.drawings = Array.isArray(list) ? list : [];
    const validIds = new Set(this.drawings.filter((d) => !d.hidden).map((d) => d.id));
    for (const id of Array.from(this.selectedDrawingIds)) {
      if (!validIds.has(id)) this.selectedDrawingIds.delete(id);
    }
    this.drawingsPrimitive.setData(this.drawings, this.draftDrawing, this.selectedDrawingIds);
    this._syncEditBar();
  }

  setSelectedDrawingIds(idsIterable) {
    this.selectedDrawingIds = new Set(idsIterable || []);
    this.drawingsPrimitive.setData(this.drawings, this.draftDrawing, this.selectedDrawingIds);
    this._syncEditBar();
  }

  selectAllDrawings() {
    if (this.hideAllDrawings) return;
    this.selectedDrawingIds = new Set(
      this.drawings.filter((d) => !d.hidden).map((d) => d.id)
    );
    this.drawingsPrimitive.setData(this.drawings, this.draftDrawing, this.selectedDrawingIds);
    this._syncEditBar();
    this._notifySelectionChanged();
  }

  setAlerts(allAlerts) {
    const mine = Array.isArray(allAlerts)
      ? allAlerts.filter(
          (a) => a.active && a.source === this.state.source && a.symbol === this.state.symbol
        )
      : [];
    this.drawingsPrimitive.setAlerts(mine);
  }

  setNewsEvents(events) {
    this.drawingsPrimitive.setNewsEvents(Array.isArray(events) ? events : []);
    this._hideNewsPopup();
  }

  _escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _hideNewsPopup() {
    if (this.newsCardEl) this.newsCardEl.hidden = true;
    this._openNewsKey = null;
    this.drawingsPrimitive?.setActiveNewsKey(null);
  }

  _showNewsPopup(hit) {
    if (!hit || !Array.isArray(hit.events) || hit.events.length === 0) {
      this._hideNewsPopup();
      return;
    }
    if (this._openNewsKey === hit.key && !this.newsCardEl.hidden) {
      this._hideNewsPopup();
      return;
    }

    this._openNewsKey = hit.key;
    this.drawingsPrimitive.setActiveNewsKey(hit.key);

    const flags = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', CAD: '🇨🇦', AUD: '🇦🇺', CHF: '🇨🇭', NZD: '🇳🇿', CNY: '🇨🇳' };
    const firstEv = hit.events[0];
    const dtStr = formatTooltipTime(firstEv.time, this.prefs.timezone);

    const rowsHtml = hit.events
      .map((ev) => {
        const isHigh = ev.impact === 'High';
        const flag = flags[ev.country] || '🌐';
        const refNowSec = this.replayMode && Number.isFinite(this.replayClock)
          ? this.replayClock
          : Math.floor(Date.now() / 1000);
        const isFutureEvent = ev.time > refNowSec;
        let actualCls = '';
        if (!isFutureEvent && ev.actualNum !== null && ev.forecastNum !== null) {
          actualCls = ev.actualNum > ev.forecastNum ? 'beat' : ev.actualNum < ev.forecastNum ? 'miss' : '';
        }
        const actualTxt = isFutureEvent ? 'Pending' : ev.actual || '—';
        return `
          <div class="pnews-item ${isHigh ? 'high' : 'med'}">
            <div class="pnews-item-top">
              <span class="pnews-badge"><span class="pnews-dot"></span>${flag} ${this._escapeHtml(ev.country)}</span>
              ${ev.period ? `<span class="pnews-period">${this._escapeHtml(ev.period)}</span>` : ''}
            </div>
            <div class="pnews-title">${this._escapeHtml(ev.title)}</div>
            <div class="pnews-grid">
              <div><span>Actual</span><b class="${actualCls}">${this._escapeHtml(actualTxt)}</b></div>
              <div><span>Forecast</span><b>${this._escapeHtml(ev.forecast || '—')}</b></div>
              <div><span>Previous</span><b>${this._escapeHtml(ev.previous || '—')}</b></div>
            </div>
            ${ev.summary ? `<div class="pnews-summary">${this._escapeHtml(ev.summary)}</div>` : ''}
          </div>
        `;
      })
      .join('');

    this.newsCardEl.innerHTML = `
      <div class="pnews-header">
        <span>${this._escapeHtml(dtStr)}</span>
        <button type="button" class="icon-btn pnews-close" aria-label="Close">✕</button>
      </div>
      <div class="pnews-body">${rowsHtml}</div>
    `;
    this.newsCardEl.querySelector('.pnews-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._hideNewsPopup();
    });

    this.newsCardEl.hidden = false;
    const hostW = this.hostEl.clientWidth || 400;
    const cardW = Math.min(280, hostW - 16);
    const left = Math.max(8, Math.min(hostW - cardW - 68, hit.x - cardW / 2));
    this.newsCardEl.style.left = `${Math.round(left)}px`;
    this.newsCardEl.style.width = `${Math.round(cardW)}px`;
  }

  focusTime(unixTime, eventToOpen = null) {
    if (!Number.isFinite(unixTime) || !this.bars.length) return;
    let lo = 0;
    let hi = this.bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.bars[mid].time < unixTime) lo = mid + 1;
      else hi = mid;
    }
    this.chart.timeScale().setVisibleLogicalRange({
      from: Math.max(-5, lo - 45),
      to: lo + 45,
    });
    this.drawingsPrimitive.requestRedraw();

    if (eventToOpen) {
      requestAnimationFrame(() => {
        const x = this.drawingsPrimitive.timeToX(eventToOpen.time);
        const key = `${eventToOpen.time}:${eventToOpen.country}`;
        const matchingBox = this.drawingsPrimitive._newsHitBoxes?.find((b) => b.key === key);
        this._showNewsPopup(
          matchingBox || {
            key,
            x: Number.isFinite(x) ? x : (this.hostEl.clientWidth || 400) / 2,
            events: [eventToOpen],
          }
        );
      });
    }
  }

  recolorSelectedDrawing(hexColor) {
    const selected = this._getSelectedDrawings();
    if (!selected.length || !hexColor) return false;
    for (const d of selected) d.color = hexColor;
    this._commitDrawings();
    this._syncEditBar();
    return true;
  }

  _getSelectedDrawings() {
    if (this.selectedDrawingIds.size === 0) return [];
    return this.drawings.filter((d) => this.selectedDrawingIds.has(d.id));
  }

  _getPrimarySelectedDrawing() {
    const selected = this._getSelectedDrawings();
    return selected.length === 1 ? selected[0] : null;
  }

  _notifySelectionChanged() {
    if (this.callbacks.onSelectionChanged) {
      this.callbacks.onSelectionChanged(this.symbolKey, Array.from(this.selectedDrawingIds));
    }
  }

  _syncEditBar() {
    const selected = this._getSelectedDrawings();
    if (selected.length === 0) {
      this.editBarEl.hidden = true;
      this._hidePosInfoCard();
      return;
    }
    this.editBarEl.hidden = false;
    const isMulti = selected.length > 1;
    const primary = selected[0];

    this.dbarCountEl.hidden = !isMulti;
    this.dbarCountEl.textContent = `${selected.length} selected`;

    this.dbarLabelBtn.hidden = isMulti;

    const normalizedColor = /^#[0-9a-f]{6}$/i.test(primary.color || '')
      ? primary.color.toLowerCase()
      : '#f59e0b';
    if (document.activeElement !== this.dbarColorInput) {
      this.dbarColorInput.value = normalizedColor;
    }
    if (this.dbarColorDot) {
      this.dbarColorDot.style.background = normalizedColor;
    }
    for (const sw of this.dbarSwatchesEl.querySelectorAll('.dbar-swatch')) {
      sw.classList.toggle('active', !isMulti && sw.dataset.color.toLowerCase() === normalizedColor);
    }

    const isPosTool = !isMulti && (primary.type === 'longpos' || primary.type === 'shortpos');
    const isRect = !isMulti && primary.type === 'rect';
    const supportsArrow =
      !isMulti && ['trend', 'arrow', 'darrow', 'zigzag'].includes(primary.type);
    const showTextAlign =
      !isMulti && !isPosTool && primary.type !== 'text' && (Boolean(primary.text) || primary.type === 'hline');

    this.dbarLabelBtn.hidden = isMulti || isPosTool;
    if (this.dbarTextAlignEl) {
      this.dbarTextAlignEl.hidden = !showTextAlign;
      if (showTextAlign) {
        const defH = primary.type === 'hline' ? 'right' : primary.type === 'rect' ? 'left' : 'center';
        const curH = primary.textHAlign || defH;
        const curV = primary.textVAlign || 'top';
        for (const b of this.dbarTextAlignEl.querySelectorAll('[data-halign]')) {
          b.classList.toggle('active', b.dataset.halign === curH);
        }
        for (const b of this.dbarTextAlignEl.querySelectorAll('[data-valign]')) {
          b.classList.toggle('active', b.dataset.valign === curV);
        }
      }
    }
    this.dbarSwatchesEl.hidden = isPosTool;
    if (this.dbarColorWrap) this.dbarColorWrap.hidden = isPosTool;
    this.dbarWidthSelect.value = String(primary.width || 2);
    this.dbarWidthSelect.hidden =
      (!isMulti && primary.type === 'text') || isPosTool || (isRect && Boolean(primary.noBorder));
    this.dbarDashBtn.hidden =
      (!isMulti && primary.type === 'text') || isPosTool || (isRect && Boolean(primary.noBorder));

    if (this.dbarArrowBtn) {
      this.dbarArrowBtn.hidden = !supportsArrow;
      if (supportsArrow) {
        const mode =
          primary.arrowMode ||
          (primary.type === 'darrow' ? 'double' : primary.type === 'arrow' ? 'single' : 'none');
        this.dbarArrowBtn.textContent = mode === 'double' ? '↔' : mode === 'single' ? '→' : '—';
        this.dbarArrowBtn.title =
          mode === 'double'
            ? 'Arrow: Double-headed (click to remove)'
            : mode === 'single'
            ? 'Arrow: Single-headed (click for Double)'
            : 'Arrow: None (click for Single arrow)';
        this.dbarArrowBtn.classList.toggle('active', mode !== 'none');
      }
    }

    if (this.dbarRectCfgEl) {
      this.dbarRectCfgEl.hidden = !isRect;
      if (isRect) {
        const pct = Math.round(
          (Number.isFinite(Number(primary.fillOpacity)) ? Number(primary.fillOpacity) : 0.14) * 100
        );
        if (document.activeElement !== this.dbarRectOpacityInput) {
          this.dbarRectOpacityInput.value = String(pct);
        }
        if (this.dbarRectOpacityVal) this.dbarRectOpacityVal.textContent = `${pct}%`;
        if (this.dbarBorderBtn) {
          const hasBorder = !Boolean(primary.noBorder);
          this.dbarBorderBtn.classList.toggle('active', hasBorder);
          this.dbarBorderBtn.textContent = hasBorder ? 'Border' : 'No Border';
        }
      }
    }

    if (this.dbarPosCfgEl) {
      this.dbarPosCfgEl.hidden = !isPosTool;
      if (isPosTool) {
        if (document.activeElement !== this.dbarPosCapInput) {
          this.dbarPosCapInput.value = String(primary.accountSize || 100000);
        }
        if (document.activeElement !== this.dbarPosRiskInput) {
          this.dbarPosRiskInput.value = String(primary.riskPct || 1);
        }
      }
    }
    if (isPosTool && this._posTooltipDismissedId !== primary.id) {
      this._renderPosInfoCard(primary);
    } else {
      this._hidePosInfoCard();
    }
    const curLineStyle = getDrawingLineStyle(primary);
    this.dbarDashBtn.innerHTML = LINE_STYLE_SVGS[curLineStyle] || LINE_STYLE_SVGS.solid;
    this.dbarDashBtn.title = LINE_STYLE_TITLES[curLineStyle] || LINE_STYLE_TITLES.solid;
    this.dbarDashBtn.classList.toggle('active', !isMulti && curLineStyle !== 'solid');
    this.dbarAlertBtn.hidden = isMulti || primary.type !== 'hline';
  }

  _getDrawDefaults() {
    const d = this.prefs?.drawingDefaults || {};
    const lineStyle = ['solid', 'dashed', 'dotted'].includes(d.lineStyle) ? d.lineStyle : 'solid';
    return {
      width: Number.isFinite(Number(d.width)) ? Number(d.width) : 2,
      lineStyle,
      dashed: lineStyle !== 'solid',
      fillOpacity: Number.isFinite(Number(d.fillOpacity))
        ? Math.max(0, Math.min(0.85, Number(d.fillOpacity)))
        : 0.14,
      noBorder: Boolean(d.noBorder),
      accountSize: Number.isFinite(Number(d.accountSize)) ? Math.max(10, Number(d.accountSize)) : 100000,
      riskPct: Number.isFinite(Number(d.riskPct)) ? Math.max(0.05, Number(d.riskPct)) : 1,
      textHAlign: ['left', 'center', 'right'].includes(d.textHAlign) ? d.textHAlign : null,
      textVAlign: ['top', 'middle', 'bottom'].includes(d.textVAlign) ? d.textVAlign : 'top',
    };
  }

  _saveDrawDefault(patch) {
    if (!patch || typeof patch !== 'object') return;
    if (this.prefs) {
      this.prefs.drawingDefaults = { ...(this.prefs.drawingDefaults || {}), ...patch };
    }
    this.callbacks.onDrawingDefaultsChanged?.(patch);
  }

  _commitDrawings() {
    this.drawingsPrimitive.setData(this.drawings, this.draftDrawing, this.selectedDrawingIds);
    this.callbacks.onDrawingsChanged(this.symbolKey, this.drawings);
  }

  hideSelectedDrawings() {
    const selected = this._getSelectedDrawings();
    if (!selected.length) return false;
    for (const d of selected) d.hidden = true;
    this.selectedDrawingIds.clear();
    this._syncEditBar();
    this._commitDrawings();
    this._notifySelectionChanged();
    return true;
  }

  deleteSelectedDrawing() {
    if (this.selectedAlertId) {
      const id = this.selectedAlertId;
      this.selectedAlertId = null;
      this.drawingsPrimitive.setSelectedAlertId(null);
      this.callbacks.onDeleteAlert?.(id);
      return true;
    }
    if (this.selectedDrawingIds.size === 0) return false;
    const before = this.drawings.length;
    this.drawings = this.drawings.filter((d) => !this.selectedDrawingIds.has(d.id));
    if (this.drawings.length !== before) {
      this.selectedDrawingIds.clear();
      this._syncEditBar();
      this._commitDrawings();
      this._notifySelectionChanged();
      return true;
    }
    return false;
  }

  undoLastDrawing() {
    if (this.drawings.length === 0) return false;
    this.drawings = this.drawings.slice(0, -1);
    this.selectedDrawingIds.clear();
    this._syncEditBar();
    this._commitDrawings();
    this._notifySelectionChanged();
    return true;
  }

  clearAllDrawings() {
    if (this.drawings.length === 0) return;
    this.drawings = [];
    this.draftDrawing = null;
    this.selectedDrawingIds.clear();
    this._syncEditBar();
    this._commitDrawings();
    this._notifySelectionChanged();
  }

  async promptEditSelectedLabel() {
    const d = this._getPrimarySelectedDrawing();
    if (!d) return;
    if (d.type === 'text') {
      const nextText = await this.callbacks.onRequestTextInput('Edit Note Text', d.text || '');
      if (nextText === null) return;
      d.text = nextText.trim();
      this._commitDrawings();
      this._syncEditBar();
      return;
    }
    const defH = d.type === 'hline' ? 'right' : d.type === 'rect' ? 'left' : 'center';
    const curH = d.textHAlign || defH;
    const curV = d.textVAlign || 'top';
    const res = this.callbacks.onRequestLabelInput
      ? await this.callbacks.onRequestLabelInput('Line Label Text', d.text || '', {
          hAlign: curH,
          vAlign: curV,
        })
      : await this.callbacks.onRequestTextInput('Line Label Text', d.text || '');
    if (res === null) return;
    if (typeof res === 'object') {
      d.text = String(res.text || '').trim();
      if (res.hAlign) d.textHAlign = res.hAlign;
      if (res.vAlign) d.textVAlign = res.vAlign;
      this._saveDrawDefault({ textHAlign: res.hAlign, textVAlign: res.vAlign });
    } else {
      d.text = String(res).trim();
    }
    this._commitDrawings();
    this._syncEditBar();
  }

  _getRelativeCoords(e) {
    const rect = this.hostEl.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, rect };
  }

  _isInsidePlotArea(x, y) {
    const rect = this.hostEl.getBoundingClientRect();
    return x >= 0 && x <= rect.width - 62 && y >= 0 && y <= rect.height - 26;
  }

  _setChartPanEnabled(enabled) {
    this.chart.applyOptions({
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: enabled,
        horzTouchDrag: enabled,
        vertTouchDrag: false,
      },
    });
  }

  _snapToBarOhlc(x, y) {
    if (!this.bars || this.bars.length === 0) return null;
    const ts = this.chart.timeScale();
    const logical = ts.coordinateToLogical(x);
    if (logical === null || !Number.isFinite(logical)) return null;

    const idx = Math.max(0, Math.min(this.bars.length - 1, Math.round(logical)));
    const bar = this.bars[idx];
    if (!bar) return null;

    const barX = this.drawingsPrimitive.timeToX(bar.time);
    if (barX === null || Math.abs(x - barX) > 42) return null;

    const candidates =
      this.state.chartType === 'line'
        ? [bar.close]
        : [bar.high, bar.low, bar.open, bar.close];

    let bestPrice = null;
    let bestY = null;
    let bestDist = Infinity;

    for (const p of candidates) {
      const cy = this.drawingsPrimitive.priceToY(p);
      if (cy === null) continue;
      const dist = Math.abs(y - cy);
      if (dist < bestDist) {
        bestDist = dist;
        bestPrice = p;
        bestY = cy;
      }
    }

    if (bestPrice === null || bestDist > 48) return null;
    return { time: bar.time, price: bestPrice, snapX: barX, snapY: bestY, snapped: true };
  }

  _resolveDrawPoint(x, y, { useMagnet = false, shiftKey = false, anchor = null, toolType = null } = {}) {
    let time = this.drawingsPrimitive.xToTime(x);
    let price = this.drawingsPrimitive.yToPrice(y);
    if (time === null || price === null) return null;

    let snapX = null;
    let snapY = null;
    let snapped = false;

    if (useMagnet) {
      const snap = this._snapToBarOhlc(x, y);
      if (snap) {
        time = snap.time;
        price = snap.price;
        snapX = snap.snapX;
        snapY = snap.snapY;
        snapped = true;
      }
    }

    if (shiftKey && anchor && (toolType === 'trend' || toolType === 'ray' || toolType === 'rect')) {
      const ax = this.drawingsPrimitive.timeToX(anchor.time);
      const ay = this.drawingsPrimitive.priceToY(anchor.price);
      const tx = snapped ? snapX : x;
      const ty = snapped ? snapY : y;

      if (ax !== null && ay !== null) {
        const dx = tx - ax;
        const dy = ty - ay;

        if (toolType === 'rect') {
          const side = Math.max(Math.abs(dx), Math.abs(dy));
          const constrainedY = ay + (dy >= 0 ? side : -side);
          const constrainedPrice = this.drawingsPrimitive.yToPrice(constrainedY);
          if (constrainedPrice !== null) {
            price = constrainedPrice;
            snapped = false;
          }
        } else {
          const TAN_22_5 = 0.41421356;
          if (Math.abs(dy) <= Math.abs(dx) * TAN_22_5) {
            price = anchor.price;
            snapY = ay;
            snapped = false;
          } else if (Math.abs(dx) <= Math.abs(dy) * TAN_22_5) {
            time = anchor.time;
            snapX = ax;
            snapped = false;
          } else {
            const diagY = ay + (dy >= 0 ? Math.abs(dx) : -Math.abs(dx));
            const diagPrice = this.drawingsPrimitive.yToPrice(diagY);
            if (diagPrice !== null) {
              price = diagPrice;
              snapped = false;
            }
          }
        }
      }
    }

    return { time, price, snapped, snapX, snapY };
  }

  _hideContextMenu() {
    if (this.ctxMenuEl) this.ctxMenuEl.hidden = true;
  }

  _showContextMenu(x, y, time, price, targetAlert = null) {
    if (!this.ctxMenuEl || !Number.isFinite(price)) return;
    const priceStr = price.toFixed(this.precision);
    const alertSection = targetAlert
      ? `
      <button type="button" class="ctx-item" data-ctx="edit-alert">✎ Edit Alert (${Number(targetAlert.price).toFixed(this.precision)})</button>
      <button type="button" class="ctx-item" data-ctx="del-alert" style="color:var(--down)">🗑 Delete Alert</button>
      <div class="ctx-sep"></div>
    `
      : '';
    this.ctxMenuEl.innerHTML = `
      ${alertSection}
      <button type="button" class="ctx-item" data-ctx="alert">🔔 Add Alert at <b>${priceStr}</b></button>
      <button type="button" class="ctx-item" data-ctx="hline">─── Add Horizontal Line at ${priceStr}</button>
      <div class="ctx-sep"></div>
      <button type="button" class="ctx-item" data-ctx="longpos">▲ Long Position Tool here</button>
      <button type="button" class="ctx-item" data-ctx="shortpos">▼ Short Position Tool here</button>
      <div class="ctx-sep"></div>
      <button type="button" class="ctx-item" data-ctx="autofit">↺ Reset Scale (Auto)</button>
    `;

    if (targetAlert) {
      this.ctxMenuEl.querySelector('[data-ctx="edit-alert"]')?.addEventListener('click', () => {
        this._hideContextMenu();
        this.callbacks.onEditAlert?.(targetAlert);
      });
      this.ctxMenuEl.querySelector('[data-ctx="del-alert"]')?.addEventListener('click', () => {
        this._hideContextMenu();
        if (this.selectedAlertId === targetAlert.id) {
          this.selectedAlertId = null;
          this.drawingsPrimitive.setSelectedAlertId(null);
        }
        this.callbacks.onDeleteAlert?.(targetAlert.id);
      });
    }

    this.ctxMenuEl.querySelector('[data-ctx="alert"]').addEventListener('click', () => {
      this._hideContextMenu();
      this.callbacks.onCreateAlertFromLine?.({
        source: this.state.source,
        symbol: this.state.symbol,
        display: this.state.display,
        price: Number(priceStr),
        message: '',
        currentPrice: this.lastPrice,
      });
    });

    this.ctxMenuEl.querySelector('[data-ctx="hline"]').addEventListener('click', () => {
      this._hideContextMenu();
      const def = this._getDrawDefaults();
      const item = {
        id: `drw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'hline',
        p1: { time, price },
        color: this.drawingColor,
        width: def.width,
        lineStyle: def.lineStyle,
        dashed: def.dashed,
        ...(def.textHAlign ? { textHAlign: def.textHAlign } : {}),
        textVAlign: def.textVAlign,
        text: '',
        hidden: false,
      };
      this.drawings = [...this.drawings, item];
      this.selectedDrawingIds = new Set([item.id]);
      this._commitDrawings();
      this._syncEditBar();
      this._notifySelectionChanged();
    });

    this.ctxMenuEl.querySelector('[data-ctx="longpos"]').addEventListener('click', () => {
      this._hideContextMenu();
      this.createPositionToolDrawing('longpos', time, price);
    });

    this.ctxMenuEl.querySelector('[data-ctx="shortpos"]').addEventListener('click', () => {
      this._hideContextMenu();
      this.createPositionToolDrawing('shortpos', time, price);
    });

    this.ctxMenuEl.querySelector('[data-ctx="autofit"]').addEventListener('click', () => {
      this._hideContextMenu();
      this.resetChartView();
    });

    this.ctxMenuEl.hidden = false;
    const hostW = this.hostEl.clientWidth || 400;
    const hostH = this.hostEl.clientHeight || 300;
    const menuW = 215;
    const menuH = 175;
    this.ctxMenuEl.style.left = `${Math.round(Math.max(6, Math.min(hostW - menuW - 8, x)))}px`;
    this.ctxMenuEl.style.top = `${Math.round(Math.max(6, Math.min(hostH - menuH - 8, y)))}px`;
  }

  createPositionToolDrawing(type, time, entryPrice) {
    // Smart default SL/TP scaled proportionally to visible chart range (~8% of visible price height for SL, 2:1 for TP)
    const hostH = this.hostEl.clientHeight || 300;
    const topPx = this.drawingsPrimitive.yToPrice(30);
    const botPx = this.drawingsPrimitive.yToPrice(hostH - 40);
    const visSpan =
      Number.isFinite(topPx) && Number.isFinite(botPx) && Math.abs(topPx - botPx) > 0
        ? Math.abs(topPx - botPx)
        : Math.max(entryPrice * 0.004, 0.001);
    const slDist = visSpan * 0.12;
    const tpDist = slDist * 2;
    const isLong = type === 'longpos';
    const widthSec = Math.max(this.bucketSec || 60, 60) * 24;

    const def = this._getDrawDefaults();
    const item = {
      id: `drw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      p1: { time, price: entryPrice },
      p2: { time: time + widthSec, price: entryPrice },
      tp: Number((isLong ? entryPrice + tpDist : entryPrice - tpDist).toFixed(this.precision)),
      sl: Number((isLong ? entryPrice - slDist : entryPrice + slDist).toFixed(this.precision)),
      accountSize: def.accountSize,
      riskPct: def.riskPct,
      color: isLong ? '#26a69a' : '#ef5350',
      hidden: false,
      text: '',
    };
    this.drawings = [...this.drawings, item];
    this.selectedDrawingIds = new Set([item.id]);
    this._posTooltipDismissedId = null;
    this.drawingsPrimitive.setSnapIndicator(null);
    this._commitDrawings();
    this._syncEditBar();
    this._notifySelectionChanged();
    return item;
  }

  _hidePosInfoCard() {
    if (this.posTooltipEl) this.posTooltipEl.hidden = true;
  }

  _positionPosInfoCard(d) {
    if (!this.posTooltipEl || !d) return;
    const hostW = this.hostEl.clientWidth || 400;
    const hostH = this.hostEl.clientHeight || 300;
    const tipW = this.posTooltipEl.offsetWidth || 224;
    const tipH = this.posTooltipEl.offsetHeight || 126;

    const x1 = this.drawingsPrimitive.timeToX(d.p1?.time);
    const x2 = this.drawingsPrimitive.timeToX(d.p2?.time);
    const yEntry = this.drawingsPrimitive.priceToY(d.p1?.price);
    const yTp = this.drawingsPrimitive.priceToY(d.tp);
    const ySl = this.drawingsPrimitive.priceToY(d.sl);

    let left = 12;
    let top = 48;
    if (x1 !== null && x2 !== null) {
      const boxLeft = Math.min(x1, x2);
      const boxRight = Math.max(boxLeft + 24, Math.max(x1, x2));
      const maxLeft = Math.max(8, hostW - tipW - 68);
      // Prefer placing immediately to the right of the box; if tight, place immediately to the left
      if (boxRight + 12 + tipW <= hostW - 64) {
        left = Math.max(8, boxRight + 12);
      } else if (boxLeft - tipW - 12 >= 8) {
        left = boxLeft - tipW - 12;
      } else {
        left = Math.max(8, Math.min(maxLeft, boxRight + 10));
      }
    }
    if (yEntry !== null && yTp !== null && ySl !== null) {
      const boxTop = Math.min(yEntry, yTp, ySl);
      const maxTop = Math.max(46, hostH - tipH - 30);
      top = Math.max(46, Math.min(maxTop, boxTop));
    }
    this.posTooltipEl.style.left = `${Math.round(left)}px`;
    this.posTooltipEl.style.top = `${Math.round(top)}px`;
  }

  _renderPosInfoCard(d) {
    if (!this.posTooltipEl) return;
    if (!d || (d.type !== 'longpos' && d.type !== 'shortpos')) {
      this.posTooltipEl.hidden = true;
      return;
    }
    const m = computePositionToolMetrics(d, this.state.symbol);
    const isLong = d.type === 'longpos';
    this.posTooltipEl.innerHTML = `
      <div class="ptip-head ${isLong ? 'up' : 'down'}">
        <span>${isLong ? '▲ LONG' : '▼ SHORT'} · <b>${m.rr.toFixed(2)}x</b></span>
        <button type="button" class="ptip-close" title="Hide card" aria-label="Hide position details">✕</button>
      </div>
      <div class="ptip-grid">
        <div><span>Capital</span><b>$${m.accountSize.toLocaleString()}</b></div>
        <div><span>Risk (${m.riskPct}%)</span><b class="down">-$${Math.round(m.riskUsd).toLocaleString()}</b></div>
        <div><span>Lot Size</span><b class="accent">${m.lots.toFixed(2)} lots</b></div>
        <div><span>Target (+${m.rewardPct.toFixed(2)}%)</span><b class="up">+$${Math.round(m.rewardUsd).toLocaleString()}</b></div>
      </div>
      <div class="ptip-foot">E ${m.entry.toFixed(this.precision)} · SL ${m.sl.toFixed(this.precision)} (${m.slPips.toFixed(1)}p) · TP ${m.tp.toFixed(this.precision)} (${m.tpPips.toFixed(1)}p)</div>
    `;
    this.posTooltipEl.querySelector('.ptip-close')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this._posTooltipDismissedId = d.id;
      this._hidePosInfoCard();
    });
    this.posTooltipEl.hidden = false;
    this._positionPosInfoCard(d);
  }

  finishActiveDraft() {
    if (!this.draftDrawing) return false;
    if (this.draftDrawing.type === 'zigzag') {
      const finished = { ...this.draftDrawing };
      delete finished.previewPoint;
      this.draftDrawing = null;
      this._setChartPanEnabled(true);
      this.drawingsPrimitive.setSnapIndicator(null);
      if (Array.isArray(finished.points) && finished.points.length >= 2) {
        this.drawings = [...this.drawings, finished];
        this.selectedDrawingIds = new Set([finished.id]);
        this._commitDrawings();
        this._syncEditBar();
        this._notifySelectionChanged();
      } else {
        this.drawingsPrimitive.setData(this.drawings, null, this.selectedDrawingIds);
      }
      this.callbacks.onDrawingFinished();
      return true;
    }
    this.draftDrawing = null;
    this._setChartPanEnabled(true);
    this.drawingsPrimitive.setSnapIndicator(null);
    this.drawingsPrimitive.setData(this.drawings, null, this.selectedDrawingIds);
    return true;
  }

  _bindDrawingEvents() {
    const host = this.hostEl;

    // Right-click context menu on chart -> finish ZigZag draft if active, else open Add Alert / Tools menu
    host.addEventListener('contextmenu', (e) => {
      if (this.draftDrawing && this.draftDrawing.type === 'zigzag') {
        e.preventDefault();
        e.stopPropagation();
        this.finishActiveDraft();
        return;
      }
      if (e.target.closest('.drawing-edit-bar, .pane-news-card, .pane-scale-pills, .pane-overlay-msg, .pane-pos-tooltip')) {
        return;
      }
      const { x, y } = this._getRelativeCoords(e);
      if (!this._isInsidePlotArea(x, y)) return;
      const price = this.drawingsPrimitive.yToPrice(y);
      const time = this.drawingsPrimitive.xToTime(x);
      if (price === null || time === null) return;
      e.preventDefault();
      e.stopPropagation();
      this.callbacks.onActivate(this.id);
      const alertHit = this.drawingsPrimitive.hitTestAlert(x, y);
      this._showContextMenu(x, y, time, price, alertHit?.alert || null);
    });

    host.addEventListener('pointerdown', async (e) => {
      if (e.button !== 0) return;
      if (
        e.target.closest('.drawing-edit-bar') ||
        e.target.closest('.pane-overlay-msg') ||
        e.target.closest('.pane-scale-pills') ||
        e.target.closest('.pane-news-card') ||
        e.target.closest('.pane-context-menu') ||
        e.target.closest('.pane-pos-tooltip')
      ) {
        return;
      }
      this._hideContextMenu();

      const { x, y, rect } = this._getRelativeCoords(e);

      // Click on a bottom-axis Economic News circular icon -> open/toggle its detail card!
      if (this.activeTool === 'cursor') {
        const newsHit = this.drawingsPrimitive.hitTestNews(x, y);
        if (newsHit) {
          e.preventDefault();
          e.stopPropagation();
          this._showNewsPopup(newsHit);
          return;
        }
        if (this.newsCardEl && !this.newsCardEl.hidden) {
          this._hideNewsPopup();
        }

        // In Replay mode, allow dragging open Position / Pending Order SL, TP, or Entry lines directly!
        if (this.replayMode) {
          const lineHit = this.drawingsPrimitive.hitTestReplayLine(x, y);
          if (lineHit) {
            e.preventDefault();
            e.stopPropagation();
            this.replayLineDrag = { ...lineHit };
            this._setChartPanEnabled(false);
            host.style.cursor = 'ns-resize';
            return;
          }
        }

        // Interactive Price Alert lines: click ✕ on pill to delete, or click & drag line/pill up/down!
        const alertHit = this.drawingsPrimitive.hitTestAlert(x, y);
        if (alertHit) {
          e.preventDefault();
          e.stopPropagation();
          if (alertHit.onDelete) {
            if (this.selectedAlertId === alertHit.alert.id) {
              this.selectedAlertId = null;
              this.drawingsPrimitive.setSelectedAlertId(null);
            }
            this.callbacks.onDeleteAlert?.(alertHit.alert.id);
            return;
          }
          if (this.selectedDrawingIds.size > 0) {
            this.selectedDrawingIds.clear();
            this._syncEditBar();
            this.drawingsPrimitive.setData(this.drawings, null, this.selectedDrawingIds);
            this._notifySelectionChanged();
          }
          this.selectedAlertId = alertHit.alert.id;
          this.drawingsPrimitive.setSelectedAlertId(alertHit.alert.id);
          this.alertDrag = {
            alert: alertHit.alert,
            origPrice: alertHit.alert.price,
            origCondition: alertHit.alert.condition,
            startY: y,
            moved: false,
          };
          this._setChartPanEnabled(false);
          host.style.cursor = 'ns-resize';
          return;
        }
        if (this.selectedAlertId) {
          this.selectedAlertId = null;
          this.drawingsPrimitive.setSelectedAlertId(null);
        }
      }

      // Detect manual vertical drag on the right price axis -> reflect Auto scale turning OFF
      if (x > rect.width - 65 && y < rect.height - 26) {
        this._syncAutoScaleUi(false);
        return;
      }
      if (!this._isInsidePlotArea(x, y)) return;

      const useMagnet = e.altKey ? !this.magnetEnabled : this.magnetEnabled;

      if (this.activeTool !== 'cursor') {
        e.preventDefault();
        e.stopPropagation();

        const draftAnchor =
          this.draftDrawing?.type === 'zigzag' && this.draftDrawing.points?.length
            ? this.draftDrawing.points[this.draftDrawing.points.length - 1]
            : this.draftDrawing
            ? this.draftDrawing.p1
            : null;
        const resolved = this._resolveDrawPoint(x, y, {
          useMagnet: useMagnet && this.activeTool !== 'text',
          shiftKey: e.shiftKey,
          anchor: draftAnchor,
          toolType: this.activeTool,
        });
        if (!resolved) return;
        const { time, price } = resolved;

        if (this.activeTool === 'hline' || this.activeTool === 'vline') {
          const def = this._getDrawDefaults();
          const item = {
            id: `drw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: this.activeTool,
            p1: { time, price },
            color: this.drawingColor,
            width: def.width,
            lineStyle: def.lineStyle,
            dashed: def.dashed,
            ...(def.textHAlign ? { textHAlign: def.textHAlign } : {}),
            textVAlign: def.textVAlign,
            text: '',
            hidden: false,
          };
          this.drawings = [...this.drawings, item];
          this.selectedDrawingIds = new Set([item.id]);
          this.drawingsPrimitive.setSnapIndicator(null);
          this._commitDrawings();
          this._syncEditBar();
          this._notifySelectionChanged();
          this.callbacks.onDrawingFinished();
          return;
        }

        if (this.activeTool === 'longpos' || this.activeTool === 'shortpos') {
          this.createPositionToolDrawing(this.activeTool, time, price);
          this.callbacks.onDrawingFinished();
          return;
        }

        if (this.activeTool === 'text') {
          this.callbacks.onDrawingFinished();
          setTimeout(async () => {
            const entered = await this.callbacks.onRequestTextInput('Add Chart Note', '');
            if (entered && entered.trim()) {
              const item = {
                id: `drw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                type: 'text',
                p1: { time, price },
                color: this.drawingColor,
                text: entered.trim(),
                hidden: false,
              };
              this.drawings = [...this.drawings, item];
              this.selectedDrawingIds = new Set([item.id]);
              this._commitDrawings();
              this._syncEditBar();
              this._notifySelectionChanged();
            }
          }, 0);
          return;
        }

        if (this.activeTool === 'freehand') {
          const def = this._getDrawDefaults();
          this.draftDrawing = {
            id: `drw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'freehand',
            points: [{ time, price }],
            color: this.drawingColor,
            width: def.width,
            lineStyle: def.lineStyle,
            dashed: def.dashed,
            text: '',
            hidden: false,
          };
          this._freehandLastPx = { x, y };
          this._setChartPanEnabled(false);
          this.drawingsPrimitive.setData(this.drawings, this.draftDrawing, null);
          return;
        }

        if (this.activeTool === 'zigzag') {
          if (!this.draftDrawing) {
            const def = this._getDrawDefaults();
            this.draftDrawing = {
              id: `drw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              type: 'zigzag',
              points: [{ time, price }],
              previewPoint: { time, price },
              color: this.drawingColor,
              width: def.width,
              lineStyle: def.lineStyle,
              dashed: def.dashed,
              arrowMode: 'none',
              ...(def.textHAlign ? { textHAlign: def.textHAlign } : {}),
              textVAlign: def.textVAlign,
              text: '',
              hidden: false,
            };
            this._setChartPanEnabled(false);
            this.drawingsPrimitive.setData(this.drawings, this.draftDrawing, null);
          } else {
            const pts = this.draftDrawing.points;
            const prev = pts[pts.length - 1];
            const prevX = prev ? this.drawingsPrimitive.timeToX(prev.time) : null;
            const prevY = prev ? this.drawingsPrimitive.priceToY(prev.price) : null;
            // Clicking directly on the previous point (e.g. second click of a double-click) finishes cleanly!
            if (prevX !== null && prevY !== null && Math.hypot(x - prevX, y - prevY) <= 6) {
              this.finishActiveDraft();
              return;
            }
            pts.push({ time, price });
            this.draftDrawing.previewPoint = { time, price };
            this.drawingsPrimitive.setData(this.drawings, this.draftDrawing, null);
          }
          return;
        }

        if (!this.draftDrawing) {
          const def = this._getDrawDefaults();
          this.draftDrawing = {
            id: `drw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: this.activeTool,
            p1: { time, price },
            p2: { time, price },
            color: this.drawingColor,
            width: def.width,
            lineStyle: def.lineStyle,
            dashed: def.dashed,
            arrowMode:
              this.activeTool === 'darrow'
                ? 'double'
                : this.activeTool === 'arrow'
                ? 'single'
                : 'none',
            fillOpacity: this.activeTool === 'rect' ? def.fillOpacity : undefined,
            noBorder: this.activeTool === 'rect' ? def.noBorder : false,
            ...(def.textHAlign ? { textHAlign: def.textHAlign } : {}),
            textVAlign: def.textVAlign,
            text: '',
            hidden: false,
          };
          this._setChartPanEnabled(false);
          this.drawingsPrimitive.setData(this.drawings, this.draftDrawing, null);
        } else {
          this.draftDrawing.p2 = { time, price };
          const finished = this.draftDrawing;
          this.draftDrawing = null;
          this._setChartPanEnabled(true);
          this.drawingsPrimitive.setSnapIndicator(null);
          this.drawings = [...this.drawings, finished];
          this.selectedDrawingIds = new Set([finished.id]);
          this._commitDrawings();
          this._syncEditBar();
          this._notifySelectionChanged();
          this.callbacks.onDrawingFinished();
        }
        return;
      }

      const time = this.drawingsPrimitive.xToTime(x);
      const price = this.drawingsPrimitive.yToPrice(y);
      if (time === null || price === null) return;

      const hit = this.drawingsPrimitive.hitTest(x, y);
      if (hit) {
        e.stopPropagation();
        if (e.shiftKey) {
          // Shift+Click toggles this drawing in the multi-selection
          if (this.selectedDrawingIds.has(hit.drawing.id)) {
            this.selectedDrawingIds.delete(hit.drawing.id);
          } else {
            this.selectedDrawingIds.add(hit.drawing.id);
          }
          this._syncEditBar();
          this.drawingsPrimitive.setData(this.drawings, null, this.selectedDrawingIds);
          this._notifySelectionChanged();
          return;
        }

        if (!this.selectedDrawingIds.has(hit.drawing.id)) {
          this.selectedDrawingIds = new Set([hit.drawing.id]);
        }
        if (hit.drawing.type === 'longpos' || hit.drawing.type === 'shortpos') {
          this._posTooltipDismissedId = null;
        }
        this._syncEditBar();
        this.drawingsPrimitive.setData(this.drawings, null, this.selectedDrawingIds);
        this._notifySelectionChanged();

        // Prepare single-handle drag OR multi-drawing body drag
        const isBulkMove = this.selectedDrawingIds.size > 1 && hit.handle === 'body';
        const bulkSnapshots = isBulkMove
          ? this._getSelectedDrawings().map((d) => ({
              drawing: d,
              origP1: d.p1 ? { ...d.p1 } : null,
              origP2: d.p2 ? { ...d.p2 } : null,
              origPoints: Array.isArray(d.points) ? d.points.map((pt) => ({ ...pt })) : null,
            }))
          : null;

        this.dragInfo = {
          drawing: hit.drawing,
          handle: isBulkMove ? 'bulk' : hit.handle,
          startTime: time,
          startPrice: price,
          origP1: hit.drawing.p1 ? { ...hit.drawing.p1 } : null,
          origP2: hit.drawing.p2 ? { ...hit.drawing.p2 } : null,
          origTp: Number.isFinite(hit.drawing.tp) ? hit.drawing.tp : null,
          origSl: Number.isFinite(hit.drawing.sl) ? hit.drawing.sl : null,
          origPoints: Array.isArray(hit.drawing.points)
            ? hit.drawing.points.map((pt) => ({ ...pt }))
            : null,
          bulkSnapshots,
        };
        this._setChartPanEnabled(false);
      } else if (e.shiftKey) {
        // Shift + Drag on empty canvas starts Marquee Box Multi-Select!
        e.preventDefault();
        e.stopPropagation();
        this.marqueeInfo = { x1: x, y1: y, x2: x, y2: y };
        this._setChartPanEnabled(false);
        this.drawingsPrimitive.setMarquee(this.marqueeInfo);
      } else {
        this.isPanningChart = true;
        if (this.selectedDrawingIds.size > 0) {
          this.selectedDrawingIds.clear();
          this._syncEditBar();
          this.drawingsPrimitive.setData(this.drawings, null, this.selectedDrawingIds);
          this._notifySelectionChanged();
        }
      }
    });

    host.addEventListener('pointermove', (e) => {
      const { x, y } = this._getRelativeCoords(e);
      const useMagnet = e.altKey ? !this.magnetEnabled : this.magnetEnabled;

      if (this.activeTool !== 'cursor' && !this.draftDrawing) {
        if (useMagnet && this.activeTool !== 'text' && this._isInsidePlotArea(x, y)) {
          const snap = this._snapToBarOhlc(x, y);
          this.drawingsPrimitive.setSnapIndicator(
            snap ? { x: snap.snapX, y: snap.snapY, color: this.drawingColor } : null
          );
        } else {
          this.drawingsPrimitive.setSnapIndicator(null);
        }
        return;
      }

      if (this.marqueeInfo) {
        this.marqueeInfo.x2 = x;
        this.marqueeInfo.y2 = y;
        this.drawingsPrimitive.setMarquee(this.marqueeInfo);
        return;
      }

      if (this.replayLineDrag) {
        const newPrice = this.drawingsPrimitive.yToPrice(y);
        if (Number.isFinite(newPrice) && this.callbacks.onReplayModifyOrder) {
          this.callbacks.onReplayModifyOrder(
            this.replayLineDrag.kind,
            this.replayLineDrag.id,
            this.replayLineDrag.field,
            Number(newPrice.toFixed(this.precision))
          );
        }
        return;
      }

      if (this.alertDrag) {
        if (Math.abs(y - this.alertDrag.startY) >= 2) {
          this.alertDrag.moved = true;
        }
        const newPrice = this.drawingsPrimitive.yToPrice(y);
        if (Number.isFinite(newPrice)) {
          const rounded = Number(newPrice.toFixed(this.precision));
          this.alertDrag.alert.price = rounded;
          if (this.alertDrag.origCondition !== 'crossing' && Number.isFinite(this.lastPrice)) {
            this.alertDrag.alert.condition =
              rounded >= this.lastPrice ? 'crossing_up' : 'crossing_down';
          }
          this.drawingsPrimitive.requestRedraw();
        }
        return;
      }

      if (!this.draftDrawing && !this.dragInfo) {
        if (this.activeTool === 'cursor') {
          const hoveredNews = this.drawingsPrimitive.hitTestNews(x, y);
          if (hoveredNews) {
            this.drawingsPrimitive.setHoveredAlertId(null);
            host.style.cursor = 'pointer';
          } else if (this.replayMode && this.drawingsPrimitive.hitTestReplayLine(x, y)) {
            this.drawingsPrimitive.setHoveredAlertId(null);
            host.style.cursor = 'ns-resize';
          } else {
            const hoveredAlert = this.drawingsPrimitive.hitTestAlert(x, y);
            if (hoveredAlert) {
              this.drawingsPrimitive.setHoveredAlertId(hoveredAlert.alert.id);
              host.style.cursor = hoveredAlert.onDelete ? 'pointer' : 'ns-resize';
            } else {
              this.drawingsPrimitive.setHoveredAlertId(null);
              const drawHit = this.drawingsPrimitive.hitTest(x, y);
              if (drawHit && (drawHit.drawing.type === 'longpos' || drawHit.drawing.type === 'shortpos')) {
                host.style.cursor =
                  drawHit.handle === 'tp' || drawHit.handle === 'sl'
                    ? 'ns-resize'
                    : drawHit.handle === 'right'
                    ? 'ew-resize'
                    : 'move';
              } else {
                host.style.cursor = '';
              }
            }
          }
        }
        return;
      }

      if (this.draftDrawing) {
        if (this.draftDrawing.type === 'zigzag') {
          const pts = this.draftDrawing.points || [];
          const anchor = pts.length ? pts[pts.length - 1] : null;
          const resolved = this._resolveDrawPoint(x, y, {
            useMagnet,
            shiftKey: e.shiftKey,
            anchor,
            toolType: 'trend',
          });
          if (!resolved) return;
          this.draftDrawing.previewPoint = { time: resolved.time, price: resolved.price };
          this.drawingsPrimitive.setSnapIndicator(
            resolved.snapped ? { x: resolved.snapX, y: resolved.snapY, color: this.drawingColor } : null
          );
          this.drawingsPrimitive.requestRedraw();
          return;
        }
        if (this.draftDrawing.type === 'freehand') {
          if (this._freehandLastPx && Math.hypot(x - this._freehandLastPx.x, y - this._freehandLastPx.y) < 3) {
            return;
          }
          const time = this.drawingsPrimitive.xToTime(x);
          const price = this.drawingsPrimitive.yToPrice(y);
          if (time === null || price === null) return;
          this.draftDrawing.points.push({ time, price });
          this._freehandLastPx = { x, y };
          this.drawingsPrimitive.requestRedraw();
          return;
        }

        const resolved = this._resolveDrawPoint(x, y, {
          useMagnet,
          shiftKey: e.shiftKey,
          anchor: this.draftDrawing.p1,
          toolType: this.draftDrawing.type,
        });
        if (!resolved) return;
        this.draftDrawing.p2 = { time: resolved.time, price: resolved.price };
        this.drawingsPrimitive.setSnapIndicator(
          resolved.snapped ? { x: resolved.snapX, y: resolved.snapY, color: this.drawingColor } : null
        );
        this.drawingsPrimitive.requestRedraw();
      } else if (this.dragInfo) {
        const { drawing, handle, startTime, startPrice, origP1, origP2, origTp, origSl, origPoints, bulkSnapshots } = this.dragInfo;
        if (handle === 'tp' || handle === 'sl' || handle === 'right') {
          if (handle === 'right') {
            const nextT = this.drawingsPrimitive.xToTime(x);
            if (nextT !== null && drawing.p2 && drawing.p1) {
              drawing.p2 = { ...drawing.p2, time: Math.max(drawing.p1.time + (this.bucketSec || 60) * 3, nextT) };
            }
          } else {
            const nextP = this.drawingsPrimitive.yToPrice(y);
            if (nextP !== null) {
              drawing[handle] = Number(nextP.toFixed(this.precision));
            }
          }
          if (
            (drawing.type === 'longpos' || drawing.type === 'shortpos') &&
            this._posTooltipDismissedId !== drawing.id
          ) {
            this._renderPosInfoCard(drawing);
          }
          this.drawingsPrimitive.requestRedraw();
          return;
        }
        if (handle === 'bulk' && Array.isArray(bulkSnapshots)) {
          const time = this.drawingsPrimitive.xToTime(x);
          const price = this.drawingsPrimitive.yToPrice(y);
          if (time === null || price === null) return;
          const dt = time - startTime;
          const dp = price - startPrice;
          for (const snap of bulkSnapshots) {
            if ((snap.drawing.type === 'freehand' || snap.drawing.type === 'zigzag') && snap.origPoints) {
              snap.drawing.points = snap.origPoints.map((pt) => ({
                time: pt.time + dt,
                price: pt.price + dp,
              }));
            } else {
              if (snap.origP1) {
                snap.drawing.p1 = { time: snap.origP1.time + dt, price: snap.origP1.price + dp };
              }
              if (snap.origP2) {
                snap.drawing.p2 = { time: snap.origP2.time + dt, price: snap.origP2.price + dp };
              }
            }
          }
          this.drawingsPrimitive.requestRedraw();
          return;
        }
        if (typeof handle === 'string' && handle.startsWith('pt:') && Array.isArray(drawing.points)) {
          const ptIdx = Number.parseInt(handle.slice(3), 10);
          if (Number.isInteger(ptIdx) && ptIdx >= 0 && ptIdx < drawing.points.length) {
            const anchor = ptIdx > 0 ? drawing.points[ptIdx - 1] : drawing.points[ptIdx + 1] || null;
            const resolved = this._resolveDrawPoint(x, y, {
              useMagnet,
              shiftKey: e.shiftKey,
              anchor,
              toolType: 'trend',
            });
            if (!resolved) return;
            drawing.points[ptIdx] = { time: resolved.time, price: resolved.price };
            this.drawingsPrimitive.setSnapIndicator(
              resolved.snapped ? { x: resolved.snapX, y: resolved.snapY, color: drawing.color } : null
            );
            this.drawingsPrimitive.requestRedraw();
            return;
          }
        }
        if (handle === 'p1' || handle === 'p2') {
          const otherAnchor = handle === 'p1' ? drawing.p2 : drawing.p1;
          const resolved = this._resolveDrawPoint(x, y, {
            useMagnet,
            shiftKey: e.shiftKey,
            anchor: otherAnchor,
            toolType: drawing.type,
          });
          if (!resolved) return;
          if (handle === 'p1') drawing.p1 = { time: resolved.time, price: resolved.price };
          else if (drawing.p2) drawing.p2 = { time: resolved.time, price: resolved.price };
          this.drawingsPrimitive.setSnapIndicator(
            resolved.snapped ? { x: resolved.snapX, y: resolved.snapY, color: drawing.color } : null
          );
        } else if (handle === 'body') {
          const time = this.drawingsPrimitive.xToTime(x);
          const price = this.drawingsPrimitive.yToPrice(y);
          if (time === null || price === null) return;
          if (drawing.type === 'hline' && useMagnet) {
            const snap = this._snapToBarOhlc(x, y);
            if (snap) {
              drawing.p1 = { time: snap.time, price: snap.price };
              this.drawingsPrimitive.setSnapIndicator({
                x: snap.snapX,
                y: snap.snapY,
                color: drawing.color,
              });
              this.drawingsPrimitive.requestRedraw();
              return;
            }
          }
          const dt = time - startTime;
          const dp = price - startPrice;
          if ((drawing.type === 'freehand' || drawing.type === 'zigzag') && origPoints) {
            drawing.points = origPoints.map((pt) => ({
              time: pt.time + dt,
              price: pt.price + dp,
            }));
          } else {
            if (origP1) drawing.p1 = { time: origP1.time + dt, price: origP1.price + dp };
            if (origP2) drawing.p2 = { time: origP2.time + dt, price: origP2.price + dp };
            if (Number.isFinite(origTp)) drawing.tp = Number((origTp + dp).toFixed(this.precision));
            if (Number.isFinite(origSl)) drawing.sl = Number((origSl + dp).toFixed(this.precision));
          }
          if (
            (drawing.type === 'longpos' || drawing.type === 'shortpos') &&
            this._posTooltipDismissedId !== drawing.id
          ) {
            this._renderPosInfoCard(drawing);
          }
          this.drawingsPrimitive.setSnapIndicator(null);
        }
        this.drawingsPrimitive.requestRedraw();
      }
    });

    host.addEventListener('pointerleave', () => {
      this.drawingsPrimitive.setSnapIndicator(null);
      this.drawingsPrimitive.setHoveredAlertId(null);
    });

    const finishPointer = () => {
      if (this.alertDrag) {
        const drag = this.alertDrag;
        this.alertDrag = null;
        this._setChartPanEnabled(true);
        host.style.cursor = '';
        if (drag.moved && drag.alert.price !== drag.origPrice) {
          this.callbacks.onUpdateAlert?.(drag.alert.id, {
            price: drag.alert.price,
            condition: drag.alert.condition,
          });
        }
        return;
      }
      if (this.replayLineDrag) {
        this.replayLineDrag = null;
        this._setChartPanEnabled(true);
        host.style.cursor = '';
        return;
      }
      const wasPanning = this.isPanningChart;
      this.isPanningChart = false;
      if (wasPanning && this.pendingOlderBars) {
        this._flushPendingOlderBars();
      }
      if (this.marqueeInfo) {
        const m = this.marqueeInfo;
        this.marqueeInfo = null;
        this._setChartPanEnabled(true);
        this.drawingsPrimitive.setMarquee(null);
        const ids = this.drawingsPrimitive.hitTestRect(m.x1, m.y1, m.x2, m.y2);
        this.selectedDrawingIds = new Set(ids);
        this.drawingsPrimitive.setData(this.drawings, null, this.selectedDrawingIds);
        this._syncEditBar();
        this._notifySelectionChanged();
      }
      if (this.draftDrawing && this.draftDrawing.type === 'freehand') {
        const finished = this.draftDrawing;
        this.draftDrawing = null;
        this._freehandLastPx = null;
        this._setChartPanEnabled(true);
        if (finished.points.length >= 2) {
          this.drawings = [...this.drawings, finished];
          this.selectedDrawingIds = new Set([finished.id]);
          this._commitDrawings();
          this._syncEditBar();
          this._notifySelectionChanged();
        } else {
          this.drawingsPrimitive.setData(this.drawings, null, this.selectedDrawingIds);
        }
        this.callbacks.onDrawingFinished();
      }
      if (this.dragInfo) {
        this.dragInfo = null;
        this._setChartPanEnabled(true);
        this.drawingsPrimitive.setSnapIndicator(null);
        this._commitDrawings();
      }
    };
    window.addEventListener('pointerup', finishPointer);

    host.addEventListener('dblclick', (e) => {
      if (this.draftDrawing && this.draftDrawing.type === 'zigzag') {
        e.preventDefault();
        e.stopPropagation();
        this.finishActiveDraft();
        return;
      }
      if (e.target.closest('.drawing-edit-bar') || e.target.closest('.pane-scale-pills')) return;
      const { x, y, rect } = this._getRelativeCoords(e);

      // Double-click right price axis -> immediately re-enable Auto scale (just like TradingView!)
      if (x > rect.width - 65 && y < rect.height - 26) {
        e.stopPropagation();
        this.setAutoScale(true);
        return;
      }

      // Double-click bottom time axis -> open Timezone Picker!
      if (y >= rect.height - 30 && x <= rect.width - 55) {
        e.stopPropagation();
        if (this.callbacks.onOpenTimezonePicker) {
          this.callbacks.onOpenTimezonePicker();
        }
        return;
      }

      const alertHit = this.drawingsPrimitive.hitTestAlert(x, y);
      if (alertHit && !alertHit.onDelete) {
        e.stopPropagation();
        this.selectedAlertId = alertHit.alert.id;
        this.drawingsPrimitive.setSelectedAlertId(alertHit.alert.id);
        this.callbacks.onEditAlert?.(alertHit.alert);
        return;
      }

      const hit = this.drawingsPrimitive.hitTest(x, y);
      if (hit) {
        e.stopPropagation();
        this.selectedDrawingIds = new Set([hit.drawing.id]);
        this._syncEditBar();
        this._notifySelectionChanged();
        this.promptEditSelectedLabel();
      } else {
        this.resetChartView();
      }
    });
  }

  // ==========================================================================
  // Appearance (Global + Per-Pane Override), Chart Type, Timeframe & Data
  // ==========================================================================
  setStyleOverride(override) {
    this.state.styleOverride = override ? { ...override } : null;
    this.applyAppearance(this.prefs);
  }

  applyAppearance(prefs) {
    this.prefs = prefs;
    this._applyPaneBgStyle();
    const style = this.getResolvedStyle();
    const isSubMin = ['1s', '5s', '15s', '30s'].includes(this.state.tf);

    this.chart.applyOptions({
      layout: {
        background: { color: style.bg },
        textColor: style.text,
      },
      grid: {
        vertLines: { visible: style.showGrid, color: style.grid },
        horzLines: { visible: style.showGrid, color: style.grid },
      },
      rightPriceScale: { borderColor: style.border },
      timeScale: {
        borderColor: style.border,
        secondsVisible: isSubMin,
        tickMarkFormatter: (time) => formatAxisTime(time, prefs.timezone, this.state.tf),
      },
      localization: {
        timeFormatter: (time) => formatTooltipTime(time, prefs.timezone),
      },
      crosshair: {
        vertLine: { color: style.text, labelBackgroundColor: style.accent },
        horzLine: { color: style.text, labelBackgroundColor: style.accent },
      },
    });

    if (this.state.chartType === 'candle') {
      this.series.applyOptions({
        upColor: style.upColor,
        downColor: style.downColor,
        borderUpColor: style.upColor,
        borderDownColor: style.downColor,
        wickUpColor: style.upColor,
        wickDownColor: style.downColor,
      });
    } else if (this.state.chartType === 'bar') {
      this.series.applyOptions({
        upColor: style.upColor,
        downColor: style.downColor,
      });
    } else {
      this.series.applyOptions({
        color: style.lineColor,
        lineWidth: style.lineWidth,
        crosshairMarkerBackgroundColor: style.lineColor,
      });
    }
  }

  setChartType(chartType) {
    if (!['candle', 'bar', 'line'].includes(chartType)) return;
    if (this.state.chartType === chartType) return;
    this.state.chartType = chartType;
    this.typeSelect.value = chartType;
    this._createSeries();
  }

  setActive(active) {
    this.el.classList.toggle('active', active);
  }

  setMaximized(max) {
    this.isMaximized = max;
    this.el.classList.toggle('maximized', max);
    if (this.maxBtn) {
      this.maxBtn.classList.toggle('is-maximized', max);
      this.maxBtn.innerHTML = max ? RESTORE_SVG : EXPAND_SVG;
      this.maxBtn.title = max ? 'Restore previous grid layout (F / Esc)' : 'Expand pane inside window (F)';
    }
  }

  setSymbol(source, symbol, display) {
    this.state.source = source;
    this.state.symbol = symbol;
    this.state.display = display || symbol;
    const tfCheck = this._validateTimeframeSupport(this.state.tf, source);
    if (!tfCheck.ok) {
      const fallbackTf = String(source || '').toLowerCase() === 'oanda' ? '5s' : '1m';
      this.state.tf = fallbackTf;
      this.updateTimeframeOptions(this.timeframesList);
      this.callbacks.onNotify?.(
        tfCheck.title,
        `Switched ${this.state.display} to ${fallbackTf} (${tfCheck.body})`
      );
    }
    this.selectedDrawingIds.clear();
    this.draftDrawing = null;
    this._syncEditBar();
    this._syncHeaderLabels();
    return this.loadHistory();
  }

  _validateTimeframeSupport(tf, source = this.state.source) {
    const clean = String(tf || '1m').trim();
    const m = clean.match(/^(\d+)s$/i);
    if (!m) return { ok: true };
    const secs = Number.parseInt(m[1], 10);
    if (this.replayMode) {
      return {
        ok: false,
        title: '1m Minimum in Replay Mode',
        body: `Offline backtest archives are stored at 1m resolution — "${clean}" is not available in Replay Mode.`,
      };
    }
    const src = String(source || '').toLowerCase();
    if (src === 'cme' || src === 'stocks' || src === 'databento' || src === 'dukascopy') {
      return {
        ok: false,
        title: `${clean} Data Not Available`,
        body: `${src.toUpperCase()} feed does not provide sub-minute (${clean}) candles — minimum timeframe is 1m.`,
      };
    }
    if (src === 'oanda' && secs < 5) {
      return {
        ok: false,
        title: 'OANDA Minimum is 5s',
        body: `OANDA does not provide ${clean} candles — the lowest live timeframe on OANDA is 5s.`,
      };
    }
    if (src === 'coinbase' || src === 'bybit' || src === 'kraken') {
      return {
        ok: false,
        title: `1m Minimum on ${src.toUpperCase()}`,
        body: `${src.toUpperCase()} starts at 1m — use Binance for live 1s crypto candles.`,
      };
    }
    return { ok: true };
  }

  setTimeframe(tf) {
    const check = this._validateTimeframeSupport(tf, this.state.source);
    if (!check.ok) {
      // Revert select UI to current valid timeframe & notify user cleanly
      this.updateTimeframeOptions(this.timeframesList);
      this.callbacks.onNotify?.(check.title, check.body);
      return Promise.resolve();
    }
    this.state.tf = tf;
    this.updateTimeframeOptions(this.timeframesList);
    const isSubMin = ['1s', '5s', '15s', '30s'].includes(tf);
    this.chart.applyOptions({
      timeScale: {
        secondsVisible: isSubMin,
        tickMarkFormatter: (time) => formatAxisTime(time, this.prefs.timezone, tf),
      },
    });
    return this.loadHistory();
  }

  _syncHeaderLabels() {
    this.sourcePill.textContent = this.state.source.toUpperCase();
    this.sourcePill.className = `source-pill ${this.state.source}`;
    this.symText.textContent = this.state.display;
  }

  _setFeedBadge(mode, delayMinutes = null) {
    this.feedMode = mode;
    if (Number.isFinite(delayMinutes)) {
      this.delayMinutes = delayMinutes;
    }
    if (mode === 'replay') {
      this.feedBadge.textContent = 'REPLAY';
      this.feedBadge.className = 'pane-feed-badge replay';
      this.feedBadge.title = 'Backtest / Bar-Replay simulation mode';
    } else if (mode === 'live') {
      this.feedBadge.textContent = 'LIVE';
      this.feedBadge.className = 'pane-feed-badge live';
      this.feedBadge.title = 'Real-time live stream (0 delay)';
    } else if (mode === 'delayed') {
      const mins =
        Number.isFinite(delayMinutes) && delayMinutes > 0
          ? delayMinutes
          : Number.isFinite(this.delayMinutes) && this.delayMinutes > 0
          ? this.delayMinutes
          : this.state.source === 'stocks'
          ? 15
          : 10;
      this.feedBadge.textContent = `DELAYED ${mins}m`;
      this.feedBadge.className = 'pane-feed-badge delayed';
      this.feedBadge.title = `Free ${this.state.source.toUpperCase()} feed — delayed by ~${mins} min`;
    } else {
      this.feedBadge.textContent = 'CLOSED';
      this.feedBadge.className = 'pane-feed-badge closed';
      this.feedBadge.title = 'Market currently closed (showing latest close)';
    }
  }

  _showOverlay(msg, showRetry = false, btnLabel = 'Retry') {
    this.overlayTextEl.textContent = msg;
    this.retryBtn.textContent = btnLabel;
    this.retryBtn.hidden = !showRetry;
    this.overlayEl.hidden = false;
  }

  _hideOverlay() {
    this.overlayEl.hidden = true;
  }

  setReplayMode(enabled) {
    this.replayMode = Boolean(enabled);
    if (!this.replayMode) {
      this.replayClock = null;
      this.replayLineDrag = null;
      this.drawingsPrimitive.setReplayOverlays({});
    } else {
      // Offline replay archives are 1m minimum — auto-upgrade any pane that was on 1s/5s
      if (/^\d+s$/i.test(String(this.state.tf || ''))) {
        this.state.tf = '1m';
        this.updateTimeframeOptions(this.timeframesList);
        this.chart.applyOptions({
          timeScale: {
            secondsVisible: false,
            tickMarkFormatter: (time) => formatAxisTime(time, this.prefs.timezone, '1m'),
          },
        });
      }
      this._setFeedBadge('replay');
    }
  }

  setReplayClock(clockSec) {
    this.replayClock = Number.isFinite(clockSec) ? clockSec : null;
  }

  setReplayOverlays(overlays) {
    this.drawingsPrimitive.setReplayOverlays(overlays || {});
  }

  setReplayBars(bars, meta = {}, { fitView = false } = {}) {
    if (!this.replayMode) return;
    if (meta.symbolKey && meta.symbolKey !== this.symbolKey) return;
    if (this.abortFetch) this.abortFetch.abort();
    this.isLoadingHistory = false;
    this.needsOandaKey = false;
    if (Number.isFinite(meta.precision)) {
      this.precision = meta.precision;
      const minMove = Number((1 / Math.pow(10, this.precision)).toFixed(this.precision));
      this.series.applyOptions({
        priceFormat: { type: 'price', precision: this.precision, minMove },
      });
    }
    if (Number.isFinite(meta.bucketSec)) this.bucketSec = meta.bucketSec;
    if (meta.display) this.state.display = meta.display;
    this._syncHeaderLabels();
    this._setFeedBadge('replay');

    this.bars = Array.isArray(bars) ? bars : [];
    this.referencePrice = Number.isFinite(meta.referencePrice)
      ? meta.referencePrice
      : this.bars[0]?.open ?? null;
    this.lastPrice = this.bars.length ? this.bars[this.bars.length - 1].close : null;

    this._pushSeriesData();
    if (fitView && this.bars.length > 0) {
      // Force Y-axis Auto Scale ON so switching e.g. XAU/USD (3800) -> EUR/USD (1.09) rescales cleanly!
      this.chart.priceScale('right').applyOptions({ autoScale: true });
      this._syncAutoScaleUi(true);
      if (this.bars.length > 130) {
        this.chart.timeScale().setVisibleLogicalRange({
          from: this.bars.length - 110,
          to: this.bars.length + 14,
        });
      } else {
        this.chart.timeScale().fitContent();
      }
    }
    this._updatePriceDisplay(this.lastPrice, false);
    this._hideOverlay();
    this.drawingsPrimitive.requestRedraw();
  }

  updateReplayLastBar(bar, referencePrice = null) {
    if (!bar || !Number.isFinite(bar.time) || !Number.isFinite(bar.close)) return;
    const prevPrice = this.lastPrice;
    const lastBar = this.bars[this.bars.length - 1];
    if (lastBar && lastBar.time === bar.time) {
      lastBar.open = bar.open;
      lastBar.high = bar.high;
      lastBar.low = bar.low;
      lastBar.close = bar.close;
    } else if (!lastBar || bar.time > lastBar.time) {
      this.bars.push({ ...bar });
    } else {
      return;
    }
    if (Number.isFinite(referencePrice)) this.referencePrice = referencePrice;

    try {
      if (this.state.chartType === 'line') {
        this.series.update({ time: bar.time, value: bar.close });
      } else {
        this.series.update(bar);
      }
    } catch {
      this._pushSeriesData();
    }

    this.lastPrice = bar.close;
    this._updatePriceDisplay(bar.close, prevPrice !== null && prevPrice !== bar.close, prevPrice);
    this.drawingsPrimitive.requestRedraw();
  }

  async loadHistory() {
    if (this.replayMode) {
      if (this.callbacks.onReplayLoadPane) {
        return this.callbacks.onReplayLoadPane(this);
      }
      return;
    }
    if (this.abortFetch) this.abortFetch.abort();
    const controller = new AbortController();
    this.abortFetch = controller;

    this.needsOandaKey = false;
    this.isLoadingHistory = true;
    this.loadingOlder = false;
    this.reachedHistoryStart = false;
    this.pendingOlderBars = null;
    this.bars = [];
    this.referencePrice = null;
    this.lastPrice = null;
    this._pushSeriesData();
    this.priceEl.textContent = '--';
    this.changeEl.textContent = '';
    this._syncHeaderLabels();
    this._showOverlay(`Loading ${this.state.display}...`, false);

    const reqKey = `${this.state.source}:${this.state.symbol}:${this.state.tf}`;
    try {
      const qs = new URLSearchParams({
        source: this.state.source,
        symbol: this.state.symbol,
        tf: this.state.tf,
      });
      const res = await fetch(`/api/history?${qs}`, { signal: controller.signal });
      const data = await res.json();
      if (this.replayMode || reqKey !== `${this.state.source}:${this.state.symbol}:${this.state.tf}`) {
        return;
      }
      if (!res.ok) {
        const err = new Error(data.error || `HTTP ${res.status}`);
        err.code = data.code;
        throw err;
      }

      this.precision = Number.isFinite(data.precision) ? data.precision : 2;
      this.bucketSec = Number.isFinite(data.bucketSec) ? data.bucketSec : 60;
      this.state.display = data.display || this.state.display;
      this._syncHeaderLabels();
      this._setFeedBadge(
        data.feedMode || (this.state.source === 'oanda' ? 'live' : 'delayed'),
        data.delayMinutes ?? null
      );

      const minMove = Number((1 / Math.pow(10, this.precision)).toFixed(this.precision));
      this.series.applyOptions({
        priceFormat: {
          type: 'price',
          precision: this.precision,
          minMove,
        },
      });

      this.bars = Array.isArray(data.bars) ? data.bars : [];
      this.referencePrice = Number.isFinite(data.referencePrice)
        ? data.referencePrice
        : this.bars[0]?.open ?? null;
      this.lastPrice = Number.isFinite(data.lastPrice)
        ? data.lastPrice
        : this.bars[this.bars.length - 1]?.close ?? null;

      if (this.bars.length === 0) {
        this._pushSeriesData();
        this._showOverlay('No data available for this timeframe.', true, 'Retry');
        return;
      }

      this._pushSeriesData();
      this.chart.priceScale('right').applyOptions({ autoScale: true });
      this._syncAutoScaleUi(true);
      // Show a crisp recent window (~140 bars) while keeping all 1200+ older bars ready to scroll left!
      if (this.bars.length > 160) {
        this.chart.timeScale().setVisibleLogicalRange({
          from: this.bars.length - 140,
          to: this.bars.length + 10,
        });
      } else {
        this.chart.timeScale().fitContent();
      }
      this.isLoadingHistory = false;
      this._updatePriceDisplay(this.lastPrice, false);
      this._hideOverlay();
      this.drawingsPrimitive.requestRedraw();
    } catch (err) {
      if (err.name === 'AbortError') return;
      this.isLoadingHistory = false;
      if (err.code === 'NO_OANDA_KEY') {
        this.needsOandaKey = true;
        this._showOverlay(
          'Add your free OANDA Practice API key in Settings to stream live OANDA feeds.',
          true,
          'Enter OANDA API Key'
        );
      } else {
        this._showOverlay(`Failed to load data: ${err.message}`, true, 'Retry');
      }
    }
  }

  _flushPendingOlderBars() {
    const older = this.pendingOlderBars;
    this.pendingOlderBars = null;
    if (!Array.isArray(older) || older.length === 0 || this.bars.length === 0) return;

    const oldestTime = this.bars[0].time;
    const validOlder = [];
    let prevT = -1;
    for (const b of older) {
      if (
        !b ||
        !Number.isFinite(b.time) ||
        !Number.isFinite(b.open) ||
        !Number.isFinite(b.high) ||
        !Number.isFinite(b.low) ||
        !Number.isFinite(b.close)
      ) {
        continue;
      }
      if (b.time >= oldestTime || b.time <= prevT) continue;
      prevT = b.time;
      validOlder.push(b);
    }
    if (validOlder.length === 0) return;

    try {
      const prevRange = this.chart.timeScale().getVisibleLogicalRange();
      this.bars = [...validOlder, ...this.bars];
      this._pushSeriesData();

      if (prevRange && Number.isFinite(prevRange.from) && Number.isFinite(prevRange.to)) {
        const nextFrom = Math.max(-10, prevRange.from + validOlder.length);
        const nextTo = Math.max(nextFrom + 5, prevRange.to + validOlder.length);
        this.chart.timeScale().setVisibleLogicalRange({
          from: nextFrom,
          to: nextTo,
        });
      }
      this.drawingsPrimitive.requestRedraw();
    } catch {
      // Fallback: clean redraw without shifting range
      this._pushSeriesData();
    }
  }

  async loadOlderHistory() {
    const paginatedSources = ['oanda', 'binance', 'coinbase', 'bybit'];
    if (this.loadingOlder || this.reachedHistoryStart || !paginatedSources.includes(this.state.source) || this.bars.length === 0) {
      return;
    }
    this.loadingOlder = true;
    const oldestTime = this.bars[0].time;
    const symSnapshot = `${this.state.source}:${this.state.symbol}:${this.state.tf}`;

    try {
      const qs = new URLSearchParams({
        source: this.state.source,
        symbol: this.state.symbol,
        tf: this.state.tf,
        count: '1000',
        to: String(oldestTime - 1),
      });
      const res = await fetch(`/api/history?${qs}`);
      const data = await res.json();
      if (symSnapshot !== `${this.state.source}:${this.state.symbol}:${this.state.tf}`) {
        return;
      }
      const older = Array.isArray(data.bars)
        ? data.bars.filter((b) => b && Number.isFinite(b.time) && b.time < oldestTime)
        : [];

      if (older.length === 0) {
        this.reachedHistoryStart = true;
        return;
      }

      this.pendingOlderBars = older;
      // Defer setData until mouse drag ends so Lightweight Charts never hits mid-drag null range
      if (!this.isPanningChart) {
        requestAnimationFrame(() => {
          if (!this.isPanningChart) this._flushPendingOlderBars();
        });
      }
    } catch {
      // ignore transient pagination error
    } finally {
      this.loadingOlder = false;
    }
  }

  applyTick(tick) {
    if (this.replayMode) return;
    if (tick.source !== this.state.source || tick.symbol !== this.state.symbol) return;
    if (!Number.isFinite(tick.price)) return;
    if (this.isLoadingHistory || this.bars.length === 0) return;

    if (tick.feedMode) {
      this._setFeedBadge(tick.feedMode, tick.delayMinutes ?? null);
    }

    if (tick.quoteOnly) return;

    const nowSec = Math.floor(Date.now() / 1000);
    const rawTime = Number.isFinite(tick.time) ? tick.time : nowSec;
    // Never accept future timestamps (>2 min ahead) — prevents 16:29-style phantom spikes
    if (rawTime > nowSec + 120) return;

    const bucketTime = getBucketTime(rawTime, this.state.tf, this.bucketSec);
    const lastBar = this.bars[this.bars.length - 1];
    // Never overwrite a newer candle with an older/delayed tick
    if (lastBar && bucketTime < lastBar.time) return;
    // Self-heal guard: if incoming tick deviates >50% from loaded bars (stale cross-symbol bars), reload cleanly
    if (lastBar && lastBar.close > 0 && Math.abs(tick.price - lastBar.close) / lastBar.close > 0.5) {
      this.loadHistory();
      return;
    }

    const barTime = bucketTime;
    const tb = tick.bar;
    const hiVal = tb && Number.isFinite(tb.high) ? tb.high : tick.price;
    const loVal = tb && Number.isFinite(tb.low) ? tb.low : tick.price;
    const opVal = tb && Number.isFinite(tb.open) ? tb.open : lastBar ? lastBar.close : tick.price;

    let updatedBar;
    if (lastBar && lastBar.time === barTime) {
      if (tb && this.state.tf === '1m') {
        lastBar.open = opVal;
        lastBar.high = Math.max(hiVal, opVal, tick.price);
        lastBar.low = Math.min(loVal, opVal, tick.price);
        lastBar.close = tick.price;
      } else {
        lastBar.high = Math.max(lastBar.high, hiVal, tick.price);
        lastBar.low = Math.min(lastBar.low, loVal, tick.price);
        lastBar.close = tick.price;
      }
      updatedBar = lastBar;
    } else {
      updatedBar = {
        time: barTime,
        open: opVal,
        high: Math.max(opVal, hiVal, tick.price),
        low: Math.min(opVal, loVal, tick.price),
        close: tick.price,
      };
      this.bars.push(updatedBar);
    }

    try {
      if (this.state.chartType === 'line') {
        this.series.update({ time: updatedBar.time, value: updatedBar.close });
      } else {
        this.series.update(updatedBar);
      }
    } catch {
      this._pushSeriesData();
    }

    const prevPrice = this.lastPrice;
    this.lastPrice = tick.price;
    this._updatePriceDisplay(tick.price, prevPrice !== null && prevPrice !== tick.price, prevPrice);
  }

  _updatePriceDisplay(price, shouldFlash, prevPrice = null) {
    if (!Number.isFinite(price)) {
      this.priceEl.textContent = '--';
      this.changeEl.textContent = '';
      return;
    }

    this.priceEl.textContent = price.toFixed(this.precision);

    if (shouldFlash && Number.isFinite(prevPrice)) {
      const dir = price > prevPrice ? 'flash-up' : 'flash-down';
      this.priceEl.classList.remove('flash-up', 'flash-down');
      if (this.flashTimer) clearTimeout(this.flashTimer);
      this.priceEl.classList.add(dir);
      this.flashTimer = setTimeout(() => {
        this.priceEl.classList.remove('flash-up', 'flash-down');
      }, 280);
    }

    if (Number.isFinite(this.referencePrice) && this.referencePrice !== 0) {
      const pct = ((price - this.referencePrice) / this.referencePrice) * 100;
      const sign = pct > 0 ? '+' : '';
      this.changeEl.textContent = `${sign}${pct.toFixed(2)}%`;
      this.changeEl.className = `pane-change ${pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'}`;
    } else {
      this.changeEl.textContent = '';
    }
  }

  setExternalCrosshair(unixTime) {
    if (this.lastSyncedTime === unixTime) return;
    this.lastSyncedTime = unixTime;

    this.suppressCrosshairEmit = true;
    try {
      if (unixTime === null || this.bars.length === 0) {
        this.chart.clearCrosshairPosition();
        return;
      }
      let lo = 0;
      let hi = this.bars.length - 1;
      let matchIdx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (this.bars[mid].time <= unixTime) {
          matchIdx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (matchIdx >= 0) {
        const bar = this.bars[matchIdx];
        this.chart.setCrosshairPosition(bar.close, bar.time, this.series);
      } else {
        this.chart.clearCrosshairPosition();
      }
    } finally {
      this.suppressCrosshairEmit = false;
    }
  }

  _syncAutoScaleUi(enabled) {
    this.autoScaleEnabled = Boolean(enabled);
    if (this.autoScaleBtn) {
      this.autoScaleBtn.classList.toggle('active', this.autoScaleEnabled);
      this.autoScaleBtn.setAttribute('aria-pressed', String(this.autoScaleEnabled));
    }
  }

  setAutoScale(enabled) {
    this._syncAutoScaleUi(enabled);
    this.chart.priceScale('right').applyOptions({ autoScale: this.autoScaleEnabled });
    this.drawingsPrimitive.requestRedraw();
  }

  setLogScale(enabled) {
    this.state.logScale = Boolean(enabled);
    if (this.logScaleBtn) {
      this.logScaleBtn.classList.toggle('active', this.state.logScale);
      this.logScaleBtn.setAttribute('aria-pressed', String(this.state.logScale));
    }
    this.chart.priceScale('right').applyOptions({
      mode: this.state.logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
    this.drawingsPrimitive.requestRedraw();
  }

  resetChartView() {
    // Re-enable vertical Auto scale AND fit/center recent candles cleanly
    this.setAutoScale(true);
    if (this.bars.length > 160) {
      this.chart.timeScale().setVisibleLogicalRange({
        from: this.bars.length - 140,
        to: this.bars.length + 10,
      });
    } else {
      this.chart.timeScale().fitContent();
    }
    this.drawingsPrimitive.requestRedraw();
  }

  fitContent() {
    this.setAutoScale(true);
    this.chart.timeScale().fitContent();
    this.drawingsPrimitive.requestRedraw();
  }

  /**
   * Jump/scroll chart directly to a drawing's timestamp & price (auto-loading older OANDA bars if needed!).
   */
  async focusDrawing(drawing) {
    if (!drawing || this.bars.length === 0) return;

    // Extract time span of this drawing
    let tStart = null;
    let tEnd = null;
    if (
      (drawing.type === 'freehand' || drawing.type === 'zigzag') &&
      Array.isArray(drawing.points) &&
      drawing.points.length > 0
    ) {
      tStart = drawing.points[0].time;
      tEnd = drawing.points[drawing.points.length - 1].time;
      for (const pt of drawing.points) {
        if (pt.time < tStart) tStart = pt.time;
        if (pt.time > tEnd) tEnd = pt.time;
      }
    } else if (drawing.p1) {
      tStart = drawing.p1.time;
      tEnd = drawing.p2 ? drawing.p2.time : drawing.p1.time;
      if (tEnd < tStart) [tStart, tEnd] = [tEnd, tStart];
    }

    // For hline (spans all time), just ensure auto-scale & select it
    if (drawing.type === 'hline' || !Number.isFinite(tStart)) {
      this.setAutoScale(true);
      this.setSelectedDrawingIds([drawing.id]);
      return;
    }

    // If drawing is older than currently loaded bars, automatically fetch older history chunks!
    const paginatedSources = ['oanda', 'binance', 'coinbase', 'bybit'];
    let safety = 0;
    while (
      paginatedSources.includes(this.state.source) &&
      !this.reachedHistoryStart &&
      this.bars.length > 0 &&
      tStart < this.bars[0].time &&
      safety < 5
    ) {
      safety++;
      await this.loadOlderHistory();
      if (this.pendingOlderBars) this._flushPendingOlderBars();
    }

    // Find bar indices closest to tStart and tEnd
    const findIdx = (unixTime) => {
      let lo = 0;
      let hi = this.bars.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.bars[mid].time < unixTime) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };

    const i1 = findIdx(tStart);
    const i2 = findIdx(tEnd);
    const span = Math.max(20, i2 - i1);
    const pad = Math.max(25, Math.round(span * 0.6));

    // Re-enable vertical Auto scale so the price axis jumps straight to the drawing's candles!
    this.setAutoScale(true);
    this.chart.timeScale().setVisibleLogicalRange({
      from: Math.max(-5, i1 - pad),
      to: i2 + pad,
    });
    this.setSelectedDrawingIds([drawing.id]);
    this.drawingsPrimitive.requestRedraw();
  }

  destroy() {
    if (this.abortFetch) this.abortFetch.abort();
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.chart.remove();
    this.el.remove();
  }
}
