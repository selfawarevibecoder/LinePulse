/**
 * Native Lightweight Charts v4 Series Primitive for interactive drawings & text annotations.
 * Renders directly inside Lightweight Charts' HiDPI canvas loop at 60fps with zero pan/zoom drift.
 *
 * Drawing types:
 *  - trend: { id, type:'trend', p1:{time,price}, p2:{time,price}, color, width, dashed, text }
 *  - ray:   { id, type:'ray',   p1:{time,price}, p2:{time,price}, color, width, dashed, text }
 *  - hline: { id, type:'hline', p1:{time,price}, color, width, dashed, text }
 *  - vline: { id, type:'vline', p1:{time,price}, color, width, dashed, text }
 *  - rect:     { id, type:'rect',     p1:{time,price}, p2:{time,price}, color, width, dashed, text }
 *  - text:     { id, type:'text',     p1:{time,price}, color, text }
 *  - freehand: { id, type:'freehand', points:[{time,price},...], color, width, dashed, text }
 */

function getPosInstrumentSpec(symbol, price = 1) {
  const s = String(symbol || '').toUpperCase();
  if (s.includes('XAU')) return { pipSize: 0.1, pipValuePerLot: 10 };
  if (s.includes('XAG')) return { pipSize: 0.01, pipValuePerLot: 50 };
  if (s.includes('DXY') || s.includes('DX')) return { pipSize: 0.01, pipValuePerLot: 10 };
  if (s.includes('NAS100') || s.includes('SPX500') || s.includes('US30') || s.startsWith('@')) {
    return { pipSize: 1.0, pipValuePerLot: 1 };
  }
  if (s.includes('BTC') || s.includes('ETH') || s.includes('SOL') || s.includes('BNB')) {
    const pipSize = price >= 500 ? 1.0 : price >= 10 ? 0.1 : 0.01;
    return { pipSize, pipValuePerLot: pipSize };
  }
  if (s.includes('JPY')) {
    const px = Number.isFinite(price) && price > 10 ? price : 150;
    return { pipSize: 0.01, pipValuePerLot: 1000 / px };
  }
  const isUsdBase = s.startsWith('USD_') || s.startsWith('USD/');
  const px = Number.isFinite(price) && price > 0 ? price : 1;
  return { pipSize: 0.0001, pipValuePerLot: isUsdBase ? 10 / px : 10 };
}

export function computePositionToolMetrics(d, symbol) {
  const entry = Number(d?.p1?.price);
  const tp = Number(d?.tp);
  const sl = Number(d?.sl);
  const accountSize = Math.max(10, Number(d?.accountSize) || 100000);
  const riskPct = Math.max(0.05, Number(d?.riskPct) || 1);
  const spec = getPosInstrumentSpec(symbol, entry || 1);
  const slDist = Math.abs(entry - sl);
  const tpDist = Math.abs(tp - entry);
  const slPips = slDist / spec.pipSize;
  const tpPips = tpDist / spec.pipSize;
  const rr = slDist > 0 ? tpDist / slDist : 0;
  const riskUsd = (accountSize * riskPct) / 100;
  const rewardUsd = riskUsd * rr;
  const rewardPct = riskPct * rr;
  const lots = slPips > 0 ? riskUsd / (slPips * spec.pipValuePerLot) : 0;
  return {
    entry,
    tp,
    sl,
    accountSize,
    riskPct,
    slPips,
    tpPips,
    rr,
    riskUsd,
    rewardUsd,
    rewardPct,
    lots,
  };
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function drawCleanText(ctx, text, x, y, color, align = 'center', withPill = false) {
  if (!text) return;
  ctx.save();
  ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  if (withPill) {
    const metrics = ctx.measureText(text);
    const padX = 5;
    const boxW = metrics.width + padX * 2;
    const boxH = 18;
    const boxX = align === 'left' ? x - padX : align === 'right' ? x - boxW + padX : x - boxW / 2;
    ctx.fillStyle = 'rgba(11, 16, 28, 0.82)';
    ctx.beginPath();
    ctx.roundRect(boxX, y - boxH / 2, boxW, boxH, 4);
    ctx.fill();
  }
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = color || '#f8fafc';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawAlertPill(ctx, text, x, y, color, align = 'left') {
  if (!text) return;
  ctx.save();
  ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
  const metrics = ctx.measureText(text);
  const padX = 6;
  const boxH = 18;
  const boxW = metrics.width + padX * 2;
  const drawX = align === 'right' ? x - boxW : x;
  const drawY = y - boxH / 2;
  ctx.fillStyle = 'rgba(10, 22, 30, 0.86)';
  ctx.beginPath();
  ctx.roundRect(drawX, drawY, boxW, boxH, 4);
  ctx.fill();
  ctx.fillStyle = color || '#22d3ee';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, drawX + padX, y + 0.5);
  ctx.restore();
}

function drawHandle(ctx, x, y, color) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

function drawArrowHead(ctx, fromX, fromY, toX, toY, color, lineWidth = 2) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.hypot(dx, dy);
  if (len < 4) return;
  const angle = Math.atan2(dy, dx);
  const headLen = Math.max(10, Math.min(20, 9 + lineWidth * 2.4));
  const headAngle = Math.PI / 6.5;

  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLen * Math.cos(angle - headAngle),
    toY - headLen * Math.sin(angle - headAngle)
  );
  ctx.lineTo(
    toX - headLen * 0.72 * Math.cos(angle),
    toY - headLen * 0.72 * Math.sin(angle)
  );
  ctx.lineTo(
    toX - headLen * Math.cos(angle + headAngle),
    toY - headLen * Math.sin(angle + headAngle)
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export class DrawingsPrimitive {
  constructor(paneRef) {
    this.paneRef = paneRef;
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._drawings = [];
    this._draft = null;
    this._selectedIds = new Set();
    this._snapIndicator = null; // { x, y, color } while magnet is snapping
    this._marquee = null; // { x1, y1, x2, y2 } while Shift+dragging box select
    this._hideAll = false;
    this._alerts = []; // active alerts for this symbol
    this._alertHitBoxes = []; // rendered alert lines + pill + close button hit targets
    this._selectedAlertId = null;
    this._hoveredAlertId = null;
    this._newsEvents = []; // economic calendar events shown on chart
    this._newsHitBoxes = []; // rendered circular icon hit targets
    this._activeNewsKey = null; // highlighted news icon key when popup is open
    this._replayPositions = [];
    this._replayOrders = [];
    this._replayMarkers = [];
    this._replayLineHitBoxes = []; // draggable SL/TP/Entry lines in replay mode

    const self = this;
    this._paneView = {
      zOrder() {
        return 'top';
      },
      renderer() {
        return {
          draw(target) {
            target.useMediaCoordinateSpace(({ context, mediaSize }) => {
              self._renderAll(context, mediaSize.width, mediaSize.height);
            });
          },
        };
      },
    };
  }

  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  paneViews() {
    return [this._paneView];
  }

  setData(drawings, draft, selectedIds) {
    this._drawings = drawings || [];
    this._draft = draft || null;
    if (selectedIds instanceof Set) {
      this._selectedIds = new Set(selectedIds);
    } else if (Array.isArray(selectedIds)) {
      this._selectedIds = new Set(selectedIds);
    } else if (typeof selectedIds === 'string' && selectedIds) {
      this._selectedIds = new Set([selectedIds]);
    } else {
      this._selectedIds = new Set();
    }
    this.requestRedraw();
  }

  setHideAll(hide) {
    this._hideAll = Boolean(hide);
    this.requestRedraw();
  }

  setMarquee(rect) {
    this._marquee = rect || null;
    this.requestRedraw();
  }

  setSnapIndicator(indicator) {
    const prev = this._snapIndicator;
    const same =
      (!prev && !indicator) ||
      (prev && indicator && Math.abs(prev.x - indicator.x) < 0.5 && Math.abs(prev.y - indicator.y) < 0.5);
    if (same) return;
    this._snapIndicator = indicator || null;
    this.requestRedraw();
  }

  setAlerts(alerts) {
    this._alerts = Array.isArray(alerts) ? alerts : [];
    if (this._selectedAlertId && !this._alerts.some((a) => a.id === this._selectedAlertId)) {
      this._selectedAlertId = null;
    }
    this.requestRedraw();
  }

  setSelectedAlertId(id) {
    const next = id || null;
    if (this._selectedAlertId === next) return;
    this._selectedAlertId = next;
    this.requestRedraw();
  }

  setHoveredAlertId(id) {
    const next = id || null;
    if (this._hoveredAlertId === next) return;
    this._hoveredAlertId = next;
    this.requestRedraw();
  }

  hitTestAlert(px, py) {
    for (let i = this._alertHitBoxes.length - 1; i >= 0; i--) {
      const box = this._alertHitBoxes[i];
      const d = box.delRect;
      if (d && px >= d.x - 2 && px <= d.x + d.w + 2 && py >= d.y - 2 && py <= d.y + d.h + 2) {
        return { alert: box.alert, onDelete: true };
      }
      const p = box.pillRect;
      if (p && px >= p.x - 2 && px <= p.x + p.w + 2 && py >= p.y - 2 && py <= p.y + p.h + 2) {
        return { alert: box.alert, onDelete: false };
      }
      if (Math.abs(py - box.y) <= 7) {
        return { alert: box.alert, onDelete: false };
      }
    }
    return null;
  }

  setNewsEvents(events) {
    this._newsEvents = Array.isArray(events) ? events : [];
    this.requestRedraw();
  }

  setActiveNewsKey(key) {
    if (this._activeNewsKey === key) return;
    this._activeNewsKey = key || null;
    this.requestRedraw();
  }

  hitTestNews(px, py) {
    for (let i = this._newsHitBoxes.length - 1; i >= 0; i--) {
      const box = this._newsHitBoxes[i];
      if (Math.hypot(px - box.x, py - box.y) <= box.r + 3) {
        return box;
      }
    }
    return null;
  }

  setReplayOverlays({ positions = [], orders = [], markers = [] } = {}) {
    this._replayPositions = Array.isArray(positions) ? positions : [];
    this._replayOrders = Array.isArray(orders) ? orders : [];
    this._replayMarkers = Array.isArray(markers) ? markers : [];
    this.requestRedraw();
  }

  hitTestReplayLine(px, py) {
    for (let i = this._replayLineHitBoxes.length - 1; i >= 0; i--) {
      const b = this._replayLineHitBoxes[i];
      if (Math.abs(py - b.y) <= 7) {
        return b;
      }
    }
    return null;
  }

  requestRedraw() {
    if (this._requestUpdate) {
      this._requestUpdate();
    }
  }

  /**
   * Robust time -> X pixel conversion that handles exact bars, between-bar times,
   * and future right-offset timestamps smoothly.
   */
  timeToX(unixTime) {
    if (!this._chart || !Number.isFinite(unixTime)) return null;
    const ts = this._chart.timeScale();
    const direct = ts.timeToCoordinate(unixTime);
    if (direct !== null && Number.isFinite(direct)) return direct;

    const bars = this.paneRef.bars;
    if (!bars || bars.length === 0) return null;

    // Binary search nearest bar index
    let lo = 0;
    let hi = bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].time < unixTime) lo = mid + 1;
      else hi = mid;
    }

    const bucketSec = this.paneRef.bucketSec || 60;
    if (unixTime > bars[bars.length - 1].time) {
      const lastIdx = bars.length - 1;
      const lastX = ts.logicalToCoordinate(lastIdx);
      if (lastX === null) return null;
      const prevX = lastIdx > 0 ? ts.logicalToCoordinate(lastIdx - 1) : null;
      const barPx = prevX !== null ? lastX - prevX : 8;
      const deltaBars = (unixTime - bars[lastIdx].time) / bucketSec;
      return lastX + deltaBars * barPx;
    }
    if (unixTime < bars[0].time) {
      const firstX = ts.logicalToCoordinate(0);
      if (firstX === null) return null;
      const nextX = bars.length > 1 ? ts.logicalToCoordinate(1) : null;
      const barPx = nextX !== null ? nextX - firstX : 8;
      const deltaBars = (unixTime - bars[0].time) / bucketSec;
      return firstX + deltaBars * barPx;
    }

    // Interpolate between bars[lo-1] and bars[lo] using INTEGER logical indices
    // (Lightweight Charts v4 logicalToCoordinate() returns 0 for non-integer indices!)
    const i2 = lo;
    const i1 = Math.max(0, lo - 1);
    if (i1 === i2) return ts.logicalToCoordinate(i1);
    const t1 = bars[i1].time;
    const t2 = bars[i2].time;
    const frac = t2 > t1 ? (unixTime - t1) / (t2 - t1) : 0;
    const x1 = ts.logicalToCoordinate(i1);
    const x2 = ts.logicalToCoordinate(i2);
    if (x1 === null || x2 === null) return x1 ?? x2;
    return x1 + frac * (x2 - x1);
  }

  xToTime(x) {
    if (!this._chart) return null;
    const ts = this._chart.timeScale();
    const direct = ts.coordinateToTime(x);
    if (direct !== null && Number.isFinite(Number(direct))) return Number(direct);

    const bars = this.paneRef.bars;
    if (!bars || bars.length === 0) return Math.floor(Date.now() / 1000);
    const logical = ts.coordinateToLogical(x);
    if (logical === null || !Number.isFinite(logical)) return bars[bars.length - 1].time;

    const bucketSec = this.paneRef.bucketSec || 60;
    const lastIdx = bars.length - 1;
    if (logical >= lastIdx) {
      return Math.round(bars[lastIdx].time + (logical - lastIdx) * bucketSec);
    }
    if (logical <= 0) {
      return Math.round(bars[0].time + logical * bucketSec);
    }
    const idx = Math.floor(logical);
    const frac = logical - idx;
    const t1 = bars[idx].time;
    const t2 = bars[Math.min(lastIdx, idx + 1)].time;
    return Math.round(t1 + frac * (t2 - t1));
  }

  priceToY(price) {
    if (!this._series || !Number.isFinite(price)) return null;
    return this._series.priceToCoordinate(price);
  }

  yToPrice(y) {
    if (!this._series) return null;
    const p = this._series.coordinateToPrice(y);
    return p !== null && Number.isFinite(p) ? p : null;
  }

  _computeRayEnd(x1, y1, x2, y2, width, height) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: x2, y: y2 };
    const scale = Math.max(width, height) * 3;
    const len = Math.hypot(dx, dy);
    return { x: x1 + (dx / len) * scale, y: y1 + (dy / len) * scale };
  }

  _renderAll(ctx, width, height) {
    // 0. Clean TradingView-style circular bottom-axis Economic News icons (zero text overlap!)
    this._newsHitBoxes = [];
    if (this._newsEvents.length > 0 && this.paneRef.bars?.length > 0) {
      const grouped = new Map(); // 28px horizontal bin -> { x, events }
      for (const ev of this._newsEvents) {
        const x = this.timeToX(ev.time);
        if (x === null || x < 12 || x > width - 12) continue;
        const bin = Math.round(x / 28);
        if (!grouped.has(bin)) grouped.set(bin, { x, events: [] });
        grouped.get(bin).events.push(ev);
      }

      if (grouped.size > 0) {
        ctx.save();
        const cy = height - 15;
        const r = 9.5;
        for (const group of grouped.values()) {
          const hasHigh = group.events.some((e) => e.impact === 'High');
          const primary =
            group.events.find((e) => e.impact === 'High') || group.events[0];
          const groupKey = `${primary.time}:${primary.country}`;
          const isActive = this._activeNewsKey === groupKey;
          const color = hasHigh ? '#ef4444' : '#f59e0b';
          const gx = Math.max(r + 4, Math.min(width - r - 4, group.x));

          this._newsHitBoxes.push({ key: groupKey, x: gx, y: cy, r, events: group.events });

          // Only show vertical dashed guide line when this icon is actively selected/opened
          if (isActive) {
            ctx.strokeStyle = hasHigh ? 'rgba(239, 68, 68, 0.55)' : 'rgba(245, 158, 11, 0.5)';
            ctx.lineWidth = 1.1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(gx, 0);
            ctx.lineTo(gx, cy - r - 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // Clean compact circular badge
          ctx.beginPath();
          ctx.arc(gx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = isActive
            ? hasHigh
              ? '#991b1b'
              : '#92400e'
            : 'rgba(18, 23, 36, 0.94)';
          ctx.fill();
          ctx.lineWidth = isActive ? 2 : 1.5;
          ctx.strokeStyle = color;
          ctx.stroke();

          // Tiny crisp 2-letter currency/region glyph inside circle (US / EU / GB / JP)
          const code = (primary.countryCode || primary.country || 'N').slice(0, 2);
          ctx.font = '800 8px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
          ctx.fillStyle = isActive ? '#ffffff' : hasHigh ? '#fca5a5' : '#fcd34d';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(code, gx, cy + 0.5);

          // Tiny count dot if multiple releases share the same slot
          if (group.events.length > 1) {
            const bx = gx + r - 1;
            const by = cy - r + 1;
            ctx.beginPath();
            ctx.arc(bx, by, 5.2, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.font = '800 7.5px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(String(Math.min(group.events.length, 9)), bx, by + 0.4);
          }
        }
        ctx.restore();
      }
    }

    // 0b. Replay Positions, Pending Orders, R:R Zones & Closed Trade Markers
    this._replayLineHitBoxes = [];
    if (
      this._replayPositions.length > 0 ||
      this._replayOrders.length > 0 ||
      this._replayMarkers.length > 0
    ) {
      const precision = this.paneRef.precision ?? 2;
      ctx.save();

      // Closed trade entry/exit markers + connecting path
      for (const m of this._replayMarkers) {
        const ex = this.timeToX(m.entryTime);
        const ey = this.priceToY(m.entryPrice);
        const xx = m.exitTime ? this.timeToX(m.exitTime) : null;
        const xy = Number.isFinite(m.exitPrice) ? this.priceToY(m.exitPrice) : null;
        const isWin = (m.pnl || 0) >= 0;
        const lineCol = isWin ? 'rgba(34, 197, 94, 0.55)' : 'rgba(239, 68, 68, 0.55)';

        if (ex !== null && ey !== null && xx !== null && xy !== null) {
          ctx.strokeStyle = lineCol;
          ctx.lineWidth = 1.25;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(xx, xy);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (ex !== null && ey !== null && ex >= -10 && ex <= width + 10) {
          const isLong = m.side === 'buy';
          ctx.fillStyle = isLong ? '#22c55e' : '#ef4444';
          ctx.beginPath();
          if (isLong) {
            ctx.moveTo(ex, ey - 6);
            ctx.lineTo(ex - 5, ey + 4);
            ctx.lineTo(ex + 5, ey + 4);
          } else {
            ctx.moveTo(ex, ey + 6);
            ctx.lineTo(ex - 5, ey - 4);
            ctx.lineTo(ex + 5, ey - 4);
          }
          ctx.closePath();
          ctx.fill();
        }

        if (xx !== null && xy !== null && xx >= -10 && xx <= width + 10) {
          ctx.beginPath();
          ctx.arc(xx, xy, 4, 0, Math.PI * 2);
          ctx.fillStyle = isWin ? '#22c55e' : '#ef4444';
          ctx.fill();
          ctx.strokeStyle = '#0b0e14';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }

      // Open Positions: R:R zones + Entry / Draggable SL / Draggable TP lines
      for (const pos of this._replayPositions) {
        const yEntry = this.priceToY(pos.entryPrice);
        if (yEntry === null) continue;
        const ySl = Number.isFinite(pos.sl) ? this.priceToY(pos.sl) : null;
        const yTp = Number.isFinite(pos.tp) ? this.priceToY(pos.tp) : null;
        const xStartRaw = this.timeToX(pos.entryTime);
        const zoneLeft = xStartRaw !== null ? Math.max(0, Math.min(width - 40, xStartRaw)) : 0;
        const zoneWidth = Math.max(40, width - zoneLeft);

        if (yTp !== null) {
          ctx.fillStyle = 'rgba(34, 197, 94, 0.08)';
          ctx.fillRect(zoneLeft, Math.min(yEntry, yTp), zoneWidth, Math.abs(yTp - yEntry));
        }
        if (ySl !== null) {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
          ctx.fillRect(zoneLeft, Math.min(yEntry, ySl), zoneWidth, Math.abs(ySl - yEntry));
        }

        // Entry line
        const isLong = pos.side === 'buy';
        const entryColor = isLong ? '#38bdf8' : '#f472b6';
        ctx.strokeStyle = entryColor;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(zoneLeft, yEntry);
        ctx.lineTo(width, yEntry);
        ctx.stroke();

        const pnlVal = Number(pos.floatingPnl || 0);
        const pnlSign = pnlVal >= 0 ? '+' : '-';
        const rTxt = Number.isFinite(pos.floatingR)
          ? ` (${pos.floatingR >= 0 ? '+' : ''}${pos.floatingR.toFixed(2)}R)`
          : '';
        const entryLbl = `${isLong ? 'LONG' : 'SHORT'} ${pos.lots.toFixed(2)} · ${pnlSign}$${Math.abs(pnlVal).toFixed(0)}${rTxt}`;
        drawAlertPill(ctx, entryLbl, width - 8, yEntry - 11, pnlVal >= 0 ? '#4ade80' : '#f87171', 'right');

        // TP Line (draggable)
        if (yTp !== null) {
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 1.35;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(zoneLeft, yTp);
          ctx.lineTo(width, yTp);
          ctx.stroke();
          ctx.setLineDash([]);
          const tpTxt = Number.isFinite(pos.tpUsd)
            ? `TP  +$${Math.abs(pos.tpUsd).toFixed(0)}${Number.isFinite(pos.rr) ? ` (${pos.rr.toFixed(1)}R)` : ''} · ${pos.tp.toFixed(precision)}`
            : `TP  ${pos.tp.toFixed(precision)}`;
          drawAlertPill(ctx, tpTxt, width - 8, yTp - 11, '#4ade80', 'right');
          this._replayLineHitBoxes.push({ kind: 'position', id: pos.id, field: 'tp', y: yTp });
        }

        // SL Line (draggable)
        if (ySl !== null) {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 1.35;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(zoneLeft, ySl);
          ctx.lineTo(width, ySl);
          ctx.stroke();
          ctx.setLineDash([]);
          const slTxt = Number.isFinite(pos.slUsd)
            ? `SL  -$${Math.abs(pos.slUsd).toFixed(0)} · ${pos.sl.toFixed(precision)}`
            : `SL  ${pos.sl.toFixed(precision)}`;
          drawAlertPill(ctx, slTxt, width - 8, ySl - 11, '#f87171', 'right');
          this._replayLineHitBoxes.push({ kind: 'position', id: pos.id, field: 'sl', y: ySl });
        }
      }

      // Pending Orders (Limit / Stop) — draggable entry, SL & TP
      for (const ord of this._replayOrders) {
        const yOrd = this.priceToY(ord.price);
        if (yOrd === null) continue;
        const ordColor = ord.side === 'buy' ? '#22d3ee' : '#fb923c';
        ctx.strokeStyle = ordColor;
        ctx.lineWidth = 1.35;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(0, yOrd);
        ctx.lineTo(width, yOrd);
        ctx.stroke();
        ctx.setLineDash([]);
        const lbl = `${ord.side.toUpperCase()} ${ord.orderType.toUpperCase()} ${ord.lots.toFixed(2)} @ ${ord.price.toFixed(precision)}`;
        drawAlertPill(ctx, lbl, width - 8, yOrd - 11, ordColor, 'right');
        this._replayLineHitBoxes.push({ kind: 'order', id: ord.id, field: 'price', y: yOrd });

        if (Number.isFinite(ord.tp)) {
          const yTp = this.priceToY(ord.tp);
          if (yTp !== null) {
            ctx.strokeStyle = 'rgba(34, 197, 94, 0.7)';
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(0, yTp);
            ctx.lineTo(width, yTp);
            ctx.stroke();
            ctx.setLineDash([]);
            drawAlertPill(ctx, `TP ${ord.tp.toFixed(precision)}`, width - 8, yTp - 10, '#4ade80', 'right');
            this._replayLineHitBoxes.push({ kind: 'order', id: ord.id, field: 'tp', y: yTp });
          }
        }
        if (Number.isFinite(ord.sl)) {
          const ySl = this.priceToY(ord.sl);
          if (ySl !== null) {
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(0, ySl);
            ctx.lineTo(width, ySl);
            ctx.stroke();
            ctx.setLineDash([]);
            drawAlertPill(ctx, `SL ${ord.sl.toFixed(precision)}`, width - 8, ySl - 10, '#f87171', 'right');
            this._replayLineHitBoxes.push({ kind: 'order', id: ord.id, field: 'sl', y: ySl });
          }
        }
      }

      ctx.restore();
    }

    // 1. Active price alert lines for this symbol (draggable up/down, double-click to edit, ✕ to delete)
    this._alertHitBoxes = [];
    if (this._alerts.length > 0) {
      const precision = this.paneRef.precision ?? 2;
      ctx.save();
      for (const al of this._alerts) {
        const y = this.priceToY(al.price);
        if (y === null) continue;
        const isSel = this._selectedAlertId === al.id;
        const isHov = this._hoveredAlertId === al.id;
        const alertColor = isSel || isHov ? '#38bdf8' : '#06b6d4';

        ctx.strokeStyle = alertColor;
        ctx.lineWidth = isSel ? 2 : isHov ? 1.65 : 1.25;
        ctx.setLineDash(isSel ? [6, 3] : [4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.setLineDash([]);

        const dirIcon = al.condition === 'crossing_up' ? '▲' : al.condition === 'crossing_down' ? '▼' : '◆';
        const lbl = al.message
          ? `🔔 ${dirIcon} ${al.price.toFixed(precision)} · ${al.message}`
          : `🔔 ${dirIcon} ${al.price.toFixed(precision)}`;

        // Interactive alert pill with embedded ✕ quick-delete button
        ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
        const textW = ctx.measureText(lbl).width;
        const padX = 7;
        const delW = 18;
        const boxH = 20;
        const boxW = textW + padX * 2 + delW + 4;
        const drawX = 10;
        const drawY = y - boxH - 3;

        ctx.fillStyle = isSel ? 'rgba(12, 34, 52, 0.95)' : 'rgba(10, 22, 30, 0.88)';
        ctx.beginPath();
        ctx.roundRect(drawX, drawY, boxW, boxH, 5);
        ctx.fill();
        ctx.lineWidth = isSel ? 1.25 : 0.9;
        ctx.strokeStyle = isSel ? '#38bdf8' : 'rgba(6, 182, 212, 0.45)';
        ctx.stroke();

        ctx.fillStyle = alertColor;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(lbl, drawX + padX, drawY + boxH / 2 + 0.5);

        // Separator + ✕ delete button on right edge of pill
        const sepX = drawX + boxW - delW - 2;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sepX, drawY + 4);
        ctx.lineTo(sepX, drawY + boxH - 4);
        ctx.stroke();

        const delCenterX = sepX + delW / 2 + 1;
        ctx.fillStyle = isHov || isSel ? '#f87171' : 'rgba(203, 213, 225, 0.72)';
        ctx.font = '700 10.5px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('✕', delCenterX, drawY + boxH / 2 + 0.5);

        this._alertHitBoxes.push({
          alert: al,
          y,
          pillRect: { x: drawX, y: drawY, w: boxW, h: boxH },
          delRect: { x: sepX, y: drawY, w: delW + 2, h: boxH },
        });
      }
      ctx.restore();
    }

    // 2. User drawings (skip hidden drawings or when global hide-all is active)
    if (!this._hideAll) {
      const items = this._draft ? [...this._drawings, this._draft] : this._drawings;
      if (items.length > 0) {
        ctx.save();
        for (const d of items) {
          if (d.hidden && d !== this._draft) continue;
          const isSelected = this._selectedIds.has(d.id);
          this._renderOne(ctx, d, width, height, isSelected);
        }
        ctx.restore();
      }
    }

    // 2b. Marquee multi-select rectangle (Shift + drag on empty plot)
    if (this._marquee) {
      const mx = Math.min(this._marquee.x1, this._marquee.x2);
      const my = Math.min(this._marquee.y1, this._marquee.y2);
      const mw = Math.abs(this._marquee.x2 - this._marquee.x1);
      const mh = Math.abs(this._marquee.y2 - this._marquee.y1);
      ctx.save();
      ctx.fillStyle = 'rgba(41, 98, 255, 0.14)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 3]);
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeRect(mx, my, mw, mh);
      ctx.restore();
    }

    // 3. Magnet snap target ring (TradingView-style visual lock onto OHLC wick/body)
    if (this._snapIndicator) {
      const { x, y, color } = this._snapIndicator;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(41, 98, 255, 0.22)';
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = color || '#38bdf8';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
    }
  }

  _renderOne(ctx, d, width, height, isSelected) {
    const color = d.color || '#f59e0b';
    const lineWidth = Number(d.width) || 2;
    const precision = this.paneRef.precision ?? 2;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = isSelected ? lineWidth + 0.75 : lineWidth;
    const lineStyle = d.lineStyle || (d.dashed ? 'dashed' : 'solid');
    if (lineStyle === 'dotted') {
      ctx.lineCap = 'round';
      ctx.setLineDash([1.5, Math.max(4, lineWidth * 2.2)]);
    } else if (lineStyle === 'dashed') {
      ctx.setLineDash([7, 5]);
    } else {
      ctx.setLineDash([]);
    }

    if (d.type === 'hline') {
      const y = this.priceToY(d.p1.price);
      if (y === null) {
        ctx.restore();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Price & optional label positioned via textHAlign (left/center/right) & textVAlign (top/middle/bottom)
      const priceLabel = d.p1.price.toFixed(precision);
      const labelText = d.text ? `${d.text}  ${priceLabel}` : priceLabel;
      const hAl = d.textHAlign || 'right';
      const vAl = d.textVAlign || 'top';
      const lx = hAl === 'left' ? 10 : hAl === 'center' ? width / 2 : width - 8;
      const ly = vAl === 'bottom' ? y + 13 : vAl === 'middle' ? y : y - 11;
      drawCleanText(ctx, labelText, lx, ly, color, hAl, vAl === 'middle');

      if (isSelected) {
        drawHandle(ctx, width * 0.5, y, color);
      }
      ctx.restore();
      return;
    }

    if (d.type === 'vline') {
      const x = this.timeToX(d.p1.time);
      if (x === null) {
        ctx.restore();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);

      if (d.text) {
        const hAl = d.textHAlign || 'center';
        const vAl = d.textVAlign || 'top';
        const lx = hAl === 'left' ? x - 8 : hAl === 'right' ? x + 8 : x;
        const align = hAl === 'left' ? 'right' : hAl === 'right' ? 'left' : 'center';
        const ly = vAl === 'bottom' ? height - 18 : vAl === 'middle' ? height / 2 : 16;
        drawCleanText(ctx, d.text, lx, ly, color, align, hAl === 'center');
      }
      if (isSelected) {
        drawHandle(ctx, x, height * 0.5, color);
      }
      ctx.restore();
      return;
    }

    if (d.type === 'text') {
      const x = this.timeToX(d.p1.time);
      const y = this.priceToY(d.p1.price);
      if (x === null || y === null) {
        ctx.restore();
        return;
      }
      ctx.setLineDash([]);
      drawCleanText(ctx, d.text || 'Note', x, y, color, 'center');
      if (isSelected) {
        drawHandle(ctx, x, y + 14, color);
      }
      ctx.restore();
      return;
    }

    if (d.type === 'longpos' || d.type === 'shortpos') {
      const x1 = this.timeToX(d.p1?.time);
      const x2 = this.timeToX(d.p2?.time);
      const yEntry = this.priceToY(d.p1?.price);
      const yTp = this.priceToY(d.tp);
      const ySl = this.priceToY(d.sl);
      if (x1 === null || x2 === null || yEntry === null || yTp === null || ySl === null) {
        ctx.restore();
        return;
      }

      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      const boxW = Math.max(24, right - left);
      const m = computePositionToolMetrics(d, this.paneRef.state?.symbol);

      // Green Profit Zone (Entry <-> TP)
      const tpTop = Math.min(yEntry, yTp);
      const tpH = Math.abs(yTp - yEntry);
      ctx.fillStyle = 'rgba(38, 166, 154, 0.22)';
      ctx.fillRect(left, tpTop, boxW, tpH);
      ctx.strokeStyle = 'rgba(38, 166, 154, 0.85)';
      ctx.lineWidth = isSelected ? 1.5 : 1;
      ctx.setLineDash([]);
      ctx.strokeRect(left, tpTop, boxW, tpH);

      // Red Risk Zone (Entry <-> SL)
      const slTop = Math.min(yEntry, ySl);
      const slH = Math.abs(ySl - yEntry);
      ctx.fillStyle = 'rgba(239, 83, 80, 0.22)';
      ctx.fillRect(left, slTop, boxW, slH);
      ctx.strokeStyle = 'rgba(239, 83, 80, 0.85)';
      ctx.strokeRect(left, slTop, boxW, slH);

      // Entry middle line
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(left, yEntry);
      ctx.lineTo(left + boxW, yEntry);
      ctx.stroke();

      // Compact inline R:R & Lot labels inside/along zones
      const midX = left + boxW / 2;
      const isLong = d.type === 'longpos';
      const centerLbl = `${isLong ? 'LONG' : 'SHORT'} · ${m.rr.toFixed(2)}R · ${m.lots.toFixed(2)} lot`;
      drawAlertPill(ctx, centerLbl, midX - Math.min(boxW / 2, 70), yEntry, '#e2e8f0', 'left');
      drawCleanText(
        ctx,
        `TP +${m.tpPips.toFixed(1)}p (+$${Math.round(m.rewardUsd).toLocaleString()})`,
        midX,
        yTp + (isLong ? -9 : 10),
        '#4ade80',
        'center'
      );
      drawCleanText(
        ctx,
        `SL -${m.slPips.toFixed(1)}p (-$${Math.round(m.riskUsd).toLocaleString()})`,
        midX,
        ySl + (isLong ? 10 : -9),
        '#f87171',
        'center'
      );

      if (isSelected) {
        drawHandle(ctx, midX, yTp, '#22c55e');
        drawHandle(ctx, midX, ySl, '#ef4444');
        drawHandle(ctx, left, yEntry, '#38bdf8');
        drawHandle(ctx, left + boxW, yEntry, '#38bdf8');
      }
      ctx.restore();
      return;
    }

    if (d.type === 'freehand') {
      const pts = Array.isArray(d.points) ? d.points : [];
      if (pts.length < 2) {
        ctx.restore();
        return;
      }
      const screenPts = [];
      for (const pt of pts) {
        const sx = this.timeToX(pt.time);
        const sy = this.priceToY(pt.price);
        if (sx !== null && sy !== null) screenPts.push({ x: sx, y: sy });
      }
      if (screenPts.length < 2) {
        ctx.restore();
        return;
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(screenPts[0].x, screenPts[0].y);
      for (let i = 1; i < screenPts.length - 1; i++) {
        const mx = (screenPts[i].x + screenPts[i + 1].x) / 2;
        const my = (screenPts[i].y + screenPts[i + 1].y) / 2;
        ctx.quadraticCurveTo(screenPts[i].x, screenPts[i].y, mx, my);
      }
      const last = screenPts[screenPts.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
      ctx.setLineDash([]);

      if (d.text) {
        const hAl = d.textHAlign || 'center';
        const vAl = d.textVAlign || 'top';
        const anchor =
          hAl === 'left'
            ? screenPts[0]
            : hAl === 'right'
            ? screenPts[screenPts.length - 1]
            : screenPts[Math.floor(screenPts.length / 2)];
        const ly = vAl === 'bottom' ? anchor.y + 14 : vAl === 'middle' ? anchor.y : anchor.y - 14;
        drawCleanText(ctx, d.text, anchor.x, ly, color, hAl, vAl === 'middle');
      }
      if (isSelected) {
        drawHandle(ctx, screenPts[0].x, screenPts[0].y, color);
        drawHandle(ctx, last.x, last.y, color);
      }
      ctx.restore();
      return;
    }

    if (d.type === 'zigzag') {
      const pts = Array.isArray(d.points) ? [...d.points] : [];
      if (d.previewPoint) pts.push(d.previewPoint);
      if (pts.length < 1) {
        ctx.restore();
        return;
      }
      const screenPts = [];
      for (const pt of pts) {
        const sx = this.timeToX(pt.time);
        const sy = this.priceToY(pt.price);
        if (sx !== null && sy !== null) screenPts.push({ x: sx, y: sy });
      }
      if (screenPts.length >= 2) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(screenPts[0].x, screenPts[0].y);
        for (let i = 1; i < screenPts.length; i++) {
          ctx.lineTo(screenPts[i].x, screenPts[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        const arrowMode = d.arrowMode || 'none';
        if (arrowMode === 'single' || arrowMode === 'double') {
          const prev = screenPts[screenPts.length - 2];
          const last = screenPts[screenPts.length - 1];
          drawArrowHead(ctx, prev.x, prev.y, last.x, last.y, color, lineWidth);
        }
        if (arrowMode === 'double') {
          const second = screenPts[1];
          const first = screenPts[0];
          drawArrowHead(ctx, second.x, second.y, first.x, first.y, color, lineWidth);
        }

        if (d.text) {
          const hAl = d.textHAlign || 'center';
          const vAl = d.textVAlign || 'top';
          const anchor =
            hAl === 'left'
              ? screenPts[0]
              : hAl === 'right'
              ? screenPts[screenPts.length - 1]
              : screenPts[Math.floor(screenPts.length / 2)];
          const ly = vAl === 'bottom' ? anchor.y + 14 : vAl === 'middle' ? anchor.y : anchor.y - 14;
          drawCleanText(ctx, d.text, anchor.x, ly, color, hAl, vAl === 'middle');
        }
      }
      if (isSelected || d === this._draft) {
        const committedCount = Array.isArray(d.points) ? d.points.length : 0;
        for (let i = 0; i < Math.min(screenPts.length, committedCount); i++) {
          drawHandle(ctx, screenPts[i].x, screenPts[i].y, color);
        }
      }
      ctx.restore();
      return;
    }

    // Two-point tools: trend, arrow, darrow, ray, rect
    const x1 = this.timeToX(d.p1.time);
    const y1 = this.priceToY(d.p1.price);
    const x2 = d.p2 ? this.timeToX(d.p2.time) : x1;
    const y2 = d.p2 ? this.priceToY(d.p2.price) : y1;
    if (x1 === null || y1 === null || x2 === null || y2 === null) {
      ctx.restore();
      return;
    }

    if (d.type === 'rect') {
      const rx = Math.min(x1, x2);
      const ry = Math.min(y1, y2);
      const rw = Math.abs(x2 - x1);
      const rh = Math.abs(y2 - y1);
      const fillOpacity =
        Number.isFinite(Number(d.fillOpacity)) ? Math.max(0, Math.min(1, Number(d.fillOpacity))) : 0.14;

      if (fillOpacity > 0) {
        ctx.save();
        ctx.globalAlpha = fillOpacity;
        ctx.fillStyle = color;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.restore();
      }

      if (!d.noBorder) {
        ctx.strokeRect(rx, ry, rw, rh);
      } else if (isSelected) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.restore();
      }
      ctx.setLineDash([]);

      if (d.text) {
        const hAl = d.textHAlign || 'left';
        const vAl = d.textVAlign || 'top';
        const lx = hAl === 'center' ? rx + rw / 2 : hAl === 'right' ? rx + rw - 6 : rx + 6;
        const ly = vAl === 'bottom' ? ry + rh + 12 : vAl === 'middle' ? ry + rh / 2 : ry - 10;
        drawCleanText(ctx, d.text, lx, ly, color, hAl, false);
      }
      if (isSelected) {
        drawHandle(ctx, x1, y1, color);
        drawHandle(ctx, x2, y2, color);
      }
      ctx.restore();
      return;
    }

    if (d.type === 'trend' || d.type === 'arrow' || d.type === 'darrow' || d.type === 'ray') {
      const end =
        d.type === 'ray' ? this._computeRayEnd(x1, y1, x2, y2, width, height) : { x: x2, y: y2 };
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const arrowMode =
        d.arrowMode || (d.type === 'darrow' ? 'double' : d.type === 'arrow' ? 'single' : 'none');
      if (d.type !== 'ray') {
        if (arrowMode === 'single' || arrowMode === 'double') {
          drawArrowHead(ctx, x1, y1, x2, y2, color, lineWidth);
        }
        if (arrowMode === 'double') {
          drawArrowHead(ctx, x2, y2, x1, y1, color, lineWidth);
        }
      }

      if (d.text) {
        const hAl = d.textHAlign || 'center';
        const vAl = d.textVAlign || 'top';
        const leftPt = x1 <= x2 ? { x: x1, y: y1 } : { x: x2, y: y2 };
        const rightPt = x1 <= x2 ? { x: x2, y: y2 } : { x: x1, y: y1 };
        let lx;
        let baseY;
        if (hAl === 'left') {
          lx = leftPt.x + 6;
          baseY = leftPt.y;
        } else if (hAl === 'right') {
          lx = rightPt.x - 6;
          baseY = rightPt.y;
        } else {
          lx = (x1 + x2) / 2;
          baseY = (y1 + y2) / 2;
        }
        const ly = vAl === 'bottom' ? baseY + 14 : vAl === 'middle' ? baseY : baseY - 13;
        drawCleanText(ctx, d.text, lx, ly, color, hAl, vAl === 'middle');
      }
      if (isSelected) {
        drawHandle(ctx, x1, y1, color);
        drawHandle(ctx, x2, y2, color);
      }
      ctx.restore();
    }
  }

  /**
   * Hit test pointer coordinates (relative to chart plot canvas) against visible drawings.
   */
  hitTest(px, py) {
    if (this._hideAll) return null;
    const HIT_R = 9;
    const HANDLE_R = 11;

    for (let i = this._drawings.length - 1; i >= 0; i--) {
      const d = this._drawings[i];
      if (d.hidden) continue;

      if (d.type === 'hline') {
        const y = this.priceToY(d.p1.price);
        if (y !== null && Math.abs(py - y) <= HIT_R) {
          return { drawing: d, handle: 'body' };
        }
        continue;
      }

      if (d.type === 'vline') {
        const x = this.timeToX(d.p1.time);
        if (x !== null && Math.abs(px - x) <= HIT_R) {
          return { drawing: d, handle: 'body' };
        }
        continue;
      }

      if (d.type === 'text') {
        const x = this.timeToX(d.p1.time);
        const y = this.priceToY(d.p1.price);
        if (x !== null && y !== null && Math.abs(px - x) <= 45 && Math.abs(py - y) <= 16) {
          return { drawing: d, handle: 'body' };
        }
        continue;
      }

      if (d.type === 'longpos' || d.type === 'shortpos') {
        const x1 = this.timeToX(d.p1?.time);
        const x2 = this.timeToX(d.p2?.time);
        const yEntry = this.priceToY(d.p1?.price);
        const yTp = this.priceToY(d.tp);
        const ySl = this.priceToY(d.sl);
        if (x1 === null || x2 === null || yEntry === null || yTp === null || ySl === null) continue;
        const left = Math.min(x1, x2);
        const right = Math.max(left + 24, Math.max(x1, x2));
        const midX = (left + right) / 2;
        const top = Math.min(yTp, ySl, yEntry);
        const bottom = Math.max(yTp, ySl, yEntry);

        if (Math.hypot(px - midX, py - yTp) <= HANDLE_R + 2 || (px >= left && px <= right && Math.abs(py - yTp) <= 7)) {
          return { drawing: d, handle: 'tp' };
        }
        if (Math.hypot(px - midX, py - ySl) <= HANDLE_R + 2 || (px >= left && px <= right && Math.abs(py - ySl) <= 7)) {
          return { drawing: d, handle: 'sl' };
        }
        if (Math.hypot(px - right, py - yEntry) <= HANDLE_R + 2) {
          return { drawing: d, handle: 'right' };
        }
        if (px >= left && px <= right && py >= top && py <= bottom) {
          return { drawing: d, handle: 'body' };
        }
        continue;
      }

      if (d.type === 'freehand' || d.type === 'zigzag') {
        const pts = Array.isArray(d.points) ? d.points : [];
        if (d.type === 'zigzag') {
          for (let idx = 0; idx < pts.length; idx++) {
            const sx = this.timeToX(pts[idx].time);
            const sy = this.priceToY(pts[idx].price);
            if (sx !== null && sy !== null && Math.hypot(px - sx, py - sy) <= HANDLE_R) {
              return { drawing: d, handle: `pt:${idx}` };
            }
          }
        }
        let prevX = null;
        let prevY = null;
        for (const pt of pts) {
          const sx = this.timeToX(pt.time);
          const sy = this.priceToY(pt.price);
          if (sx === null || sy === null) continue;
          if (prevX !== null && distToSegment(px, py, prevX, prevY, sx, sy) <= HIT_R) {
            return { drawing: d, handle: 'body' };
          }
          prevX = sx;
          prevY = sy;
        }
        continue;
      }

      const x1 = this.timeToX(d.p1.time);
      const y1 = this.priceToY(d.p1.price);
      const x2 = d.p2 ? this.timeToX(d.p2.time) : null;
      const y2 = d.p2 ? this.priceToY(d.p2.price) : null;
      if (x1 === null || y1 === null || x2 === null || y2 === null) continue;

      if (Math.hypot(px - x1, py - y1) <= HANDLE_R) {
        return { drawing: d, handle: 'p1' };
      }
      if (Math.hypot(px - x2, py - y2) <= HANDLE_R) {
        return { drawing: d, handle: 'p2' };
      }

      if (d.type === 'rect') {
        const rx = Math.min(x1, x2);
        const ry = Math.min(y1, y2);
        const rw = Math.abs(x2 - x1);
        const rh = Math.abs(y2 - y1);
        if (px >= rx - 5 && px <= rx + rw + 5 && py >= ry - 5 && py <= ry + rh + 5) {
          return { drawing: d, handle: 'body' };
        }
      } else if (d.type === 'trend' || d.type === 'arrow' || d.type === 'darrow') {
        if (distToSegment(px, py, x1, y1, x2, y2) <= HIT_R) {
          return { drawing: d, handle: 'body' };
        }
      } else if (d.type === 'ray') {
        const end = this._computeRayEnd(x1, y1, x2, y2, 3000, 3000);
        if (distToSegment(px, py, x1, y1, end.x, end.y) <= HIT_R) {
          return { drawing: d, handle: 'body' };
        }
      }
    }
    return null;
  }

  /**
   * Find all visible drawings intersecting a marquee screen rectangle.
   */
  hitTestRect(x1, y1, x2, y2) {
    if (this._hideAll) return [];
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    const ptInBox = (px, py) => px >= left && px <= right && py >= top && py <= bottom;

    const matchedIds = [];
    for (const d of this._drawings) {
      if (d.hidden) continue;

      if (d.type === 'hline') {
        const y = this.priceToY(d.p1.price);
        if (y !== null && y >= top && y <= bottom) matchedIds.push(d.id);
        continue;
      }
      if (d.type === 'vline') {
        const x = this.timeToX(d.p1.time);
        if (x !== null && x >= left && x <= right) matchedIds.push(d.id);
        continue;
      }
      if (d.type === 'text') {
        const x = this.timeToX(d.p1.time);
        const y = this.priceToY(d.p1.price);
        if (x !== null && y !== null && ptInBox(x, y)) matchedIds.push(d.id);
        continue;
      }
      if (d.type === 'longpos' || d.type === 'shortpos') {
        const x1 = this.timeToX(d.p1?.time);
        const yEntry = this.priceToY(d.p1?.price);
        if (x1 !== null && yEntry !== null && ptInBox(x1, yEntry)) matchedIds.push(d.id);
        continue;
      }
      if (d.type === 'freehand' || d.type === 'zigzag') {
        const pts = Array.isArray(d.points) ? d.points : [];
        for (const pt of pts) {
          const sx = this.timeToX(pt.time);
          const sy = this.priceToY(pt.price);
          if (sx !== null && sy !== null && ptInBox(sx, sy)) {
            matchedIds.push(d.id);
            break;
          }
        }
        continue;
      }

      const px1 = this.timeToX(d.p1.time);
      const py1 = this.priceToY(d.p1.price);
      const px2 = d.p2 ? this.timeToX(d.p2.time) : px1;
      const py2 = d.p2 ? this.priceToY(d.p2.price) : py1;
      if (px1 === null || py1 === null || px2 === null || py2 === null) continue;

      const dLeft = Math.min(px1, px2);
      const dRight = Math.max(px1, px2);
      const dTop = Math.min(py1, py2);
      const dBottom = Math.max(py1, py2);
      const overlaps = dLeft <= right && dRight >= left && dTop <= bottom && dBottom >= top;
      if (overlaps) matchedIds.push(d.id);
    }
    return matchedIds;
  }
}
