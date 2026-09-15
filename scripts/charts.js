/* ════════════════════════════════════════════════
   GPXtooth — charts.js
   Canvas charts · Crosshairs · Hover values ·
   Graphique combiné (mobile)
   ════════════════════════════════════════════════ */

'use strict';

// Chart crosshair state
let chartMeta = {};

// ── Canvas helpers ────────────────────────────────
// Dimensionne le canvas à sa taille CSS (écrans haute densité compris)
function setupCanvas(canvas, fallbackH) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  // Reset inline size so CSS controls the layout size
  canvas.style.width = '';
  canvas.style.height = '';
  const rect = canvas.getBoundingClientRect();
  const W = rect.width || canvas.parentElement.clientWidth;
  const H = rect.height || fallbackH;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);
  return { ctx, W, H };
}

function traceSmoothLine(ctx, data, toX, toY) {
  ctx.moveTo(toX(0), toY(data[0]));
  for (let i = 1; i < data.length; i++) {
    const x0 = toX(i - 1);
    const y0 = toY(data[i - 1]);
    const x1 = toX(i);
    const y1 = toY(data[i]);
    const mx = (x0 + x1) / 2;
    ctx.bezierCurveTo(mx, y0, mx, y1, x1, y1);
  }
}

// ── Canvas chart ──────────────────────────────────
// highlight : { start, end } en ratio de la trace (0..1) → bande rouge + point
// markers : [{ start, end }] → petits points rouges sur la courbe
function drawChart(canvasId, data, color, fillColor, chartKey = '', { highlight, markers = [] } = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !data.length) return;

  const { ctx, W, H } = setupCanvas(canvas, 90);
  const pad = { top: 8, right: 8, bottom: 6, left: 34 };

  // Store chart metadata for crosshair positioning
  if (chartKey) {
    chartMeta[chartKey] = { data, pad, W, H, canvasId };
  }
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const toX = (i) => pad.left + (i / (data.length - 1)) * cW;
  const toY = (v) => pad.top + cH - ((v - min) / range) * cH;

  ctx.clearRect(0, 0, W, H);

  // Couleurs de grille / labels selon le thème (variables CSS)
  const css = getComputedStyle(document.documentElement);

  // Grid lines
  ctx.strokeStyle = css.getPropertyValue('--chart-grid').trim();
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (i / 4) * cH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + cW, y);
    ctx.stroke();
  }

  // Y labels
  ctx.fillStyle = css.getPropertyValue('--chart-label').trim();
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = max - (i / 4) * range;
    const y = pad.top + (i / 4) * cH;
    ctx.fillText(v.toFixed(0), pad.left - 6, y + 3);
  }

  // Zone mise en évidence (ex. pente max), sous la courbe
  if (highlight) {
    const x0 = pad.left + highlight.start * cW;
    const x1 = Math.max(pad.left + highlight.end * cW, x0 + 4);
    ctx.fillStyle = 'rgba(239, 68, 68, .2)';
    ctx.fillRect(x0, pad.top, x1 - x0, cH);
  }

  // Fill gradient
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
  grad.addColorStop(0, fillColor + '60');
  grad.addColorStop(1, fillColor + '00');

  ctx.beginPath();
  traceSmoothLine(ctx, data, toX, toY);
  ctx.lineTo(toX(data.length - 1), pad.top + cH);
  ctx.lineTo(toX(0), pad.top + cH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  traceSmoothLine(ctx, data, toX, toY);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  for (const m of markers) {
    const mid = (m.start + m.end) / 2;
    ctx.beginPath();
    ctx.arc(pad.left + mid * cW, toY(data[Math.round(mid * (data.length - 1))]), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444';
    ctx.fill();
  }

  // Point rouge au milieu de la zone, sur la courbe
  if (highlight) {
    const mid = (highlight.start + highlight.end) / 2;
    const i = Math.round(mid * (data.length - 1));
    ctx.beginPath();
    ctx.arc(pad.left + mid * cW, toY(data[i]), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, .9)';
    ctx.stroke();
  }
}

function clearChart(canvasId, chartKey) {
  const canvas = document.getElementById(canvasId);
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  delete chartMeta[chartKey];
}

// ── Chart crosshair helpers ───────────────────────
function showAllCrosshairs(ratio) {
  for (const key of ['hr', 'speed', 'elev', 'grade']) {
    const meta = chartMeta[key];
    const el = document.getElementById('crosshair-' + key);
    if (!meta || !el) continue;
    const cW = meta.W - meta.pad.left - meta.pad.right;
    const x = meta.pad.left + ratio * cW;
    el.style.left = x + 'px';
    el.style.opacity = '1';
  }
  // Graphique combiné : le curseur suit aussi le survol de la carte
  if (combinedMeta) {
    combinedRatio = ratio;
    positionCombinedCursor();
  }
}

function hideAllCrosshairs() {
  for (const key of ['hr', 'speed', 'elev', 'grade']) {
    const el = document.getElementById('crosshair-' + key);
    if (el) el.style.opacity = '0';
  }
}

function updateChartValues(idx) {
  if (!trackData || idx < 0 || idx >= trackData.points.length) return;
  const pt = trackData.points[idx];

  // HR chart values
  document.getElementById('cv-hr-val').textContent = pt.hr ? pt.hr : '—';
  document.getElementById('cv-hr-dist').textContent = pt._cumDist
    ? pt._cumDist.toFixed(1)
    : '—';

  // Speed chart values
  document.getElementById('cv-speed-val').textContent = pt._speed
    ? pt._speed.toFixed(1)
    : '—';
  document.getElementById('cv-speed-dist').textContent = pt._cumDist
    ? pt._cumDist.toFixed(1)
    : '—';

  // Elevation chart values
  document.getElementById('cv-elev-val').textContent = pt.ele
    ? Math.round(pt.ele)
    : '—';
  document.getElementById('cv-elev-dist').textContent = pt._cumDist
    ? pt._cumDist.toFixed(1)
    : '—';

  // Climb under cursor: average grade · max grade · length · elevation gain
  const climb = pt._climb != null ? trackData.climbs?.[pt._climb] : null;
  document.getElementById('cv-grade-val').textContent = climb
    ? `${climb.avg.toFixed(1)} % · max ${climb.max.grade.toFixed(1)} % · ${climb.lengthKm.toFixed(1)} km · +${Math.round(climb.gain)} m`
    : '—';

  updateCombinedValues(idx);
}

function initChartHover() {
  for (const key of ['hr', 'speed', 'elev', 'grade']) {
    const wrapper = document.getElementById('chartWrap-' + key);
    if (!wrapper) continue;

    wrapper.addEventListener('mousemove', (e) => {
      const meta = chartMeta[key];
      if (!meta || !trackData) return;
      const rect = wrapper.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const cW = meta.W - meta.pad.left - meta.pad.right;
      const ratio = Math.max(0, Math.min(1, (mouseX - meta.pad.left) / cW));

      // Show crosshairs on all charts
      showAllCrosshairs(ratio);

      // Show snap marker on map
      const idx = Math.round(ratio * (trackData.points.length - 1));
      const pt = trackData.points[idx];
      if (pt && snapMarker) {
        snapMarker.setLatLng([pt.lat, pt.lon]);
        snapMarker.setStyle({ opacity: 1, fillOpacity: 1 });
      }

      // Update chart values
      updateChartValues(idx);
    });

    wrapper.addEventListener('mouseleave', () => {
      hideAllCrosshairs();
      if (snapMarker) snapMarker.setStyle({ opacity: 0, fillOpacity: 0 });
    });
  }
}

// ── Graphique combiné (mobile) ────────────────────
// Toutes les données superposées en trait fin, la donnée choisie au premier plan,
// curseur à glisser qui déplace le point sur la carte.
const COMBINED_SERIES = [
  { key: 'hr', color: '#ef4444', value: (p) => p.hr ?? 0 },
  { key: 'speed', color: '#60a5fa', value: (p) => p._speed ?? 0 },
  { key: 'elev', color: '#f97316', value: (p) => p.ele ?? 0 },
  { key: 'grade', color: '#c084fc', value: (p) => p._grade ?? 0 },
];
const COMBINED_PAD = { top: 10, right: 10, bottom: 10, left: 34 };

let combinedSelected = 'hr'; // FC par défaut
let combinedRatio = null; // position du curseur (0..1), null = pas encore touché
let combinedMeta = null; // { points, W } du dernier rendu

function drawCombinedChart() {
  const canvas = document.getElementById('combinedChart');
  // Masqué (desktop) : rien à dessiner
  if (!canvas || !trackData || !canvas.getClientRects().length) return;

  // Nouvelle trace : le curseur repart de zéro
  if (combinedMeta?.points !== trackData.points) combinedRatio = null;

  const series = COMBINED_SERIES.filter((s) => s.key !== 'hr' || trackData.stats.hasHR);
  const selected = series.find((s) => s.key === combinedSelected) ?? series[0];
  document.querySelectorAll('.combined-chip').forEach((btn) => {
    const active = btn.dataset.series === selected.key;
    btn.disabled = !series.some((s) => s.key === btn.dataset.series);
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  const { ctx, W, H } = setupCanvas(canvas, 110);
  const pad = COMBINED_PAD;
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;
  combinedMeta = { points: trackData.points, W };

  ctx.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);

  ctx.strokeStyle = css.getPropertyValue('--chart-grid').trim();
  ctx.lineWidth = 1;
  for (let i = 0; i <= 2; i++) {
    const y = pad.top + (i / 2) * cH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + cW, y);
    ctx.stroke();
  }

  // Chaque donnée sur sa propre échelle ; la sélectionnée en dernier (au-dessus)
  for (const s of [...series.filter((s) => s !== selected), selected]) {
    const data = subsample(trackData.points.map(s.value), 300);
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const toX = (i) => pad.left + (i / (data.length - 1)) * cW;
    const toY = (v) => pad.top + cH - ((v - min) / range) * cH;
    const isSelected = s === selected;

    if (isSelected) {
      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
      grad.addColorStop(0, s.color + '50');
      grad.addColorStop(1, s.color + '00');
      ctx.beginPath();
      traceSmoothLine(ctx, data, toX, toY);
      ctx.lineTo(toX(data.length - 1), pad.top + cH);
      ctx.lineTo(toX(0), pad.top + cH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Échelle de la donnée sélectionnée : max en haut, min en bas
      ctx.fillStyle = s.color;
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(max.toFixed(0), pad.left - 6, pad.top + 4);
      ctx.fillText(min.toFixed(0), pad.left - 6, pad.top + cH + 2);
    }

    ctx.beginPath();
    traceSmoothLine(ctx, data, toX, toY);
    ctx.globalAlpha = isSelected ? 1 : 0.35;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = isSelected ? 1.75 : 1;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Côte au premier plan : point rouge sur la pente max de chaque côte
    if (isSelected && s.key === 'grade') {
      const lastIdx = trackData.points.length - 1;
      for (const { max } of trackData.climbs) {
        const mid = (max.startIdx + max.endIdx) / 2 / lastIdx;
        ctx.beginPath();
        ctx.arc(pad.left + mid * cW, toY(data[Math.round(mid * (data.length - 1))]), 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
      }
    }
  }

  document.getElementById('combinedWrap').style.setProperty('--series', selected.color);
  positionCombinedCursor();
  if (combinedRatio == null) updateCombinedValues(-1);
}

function clearCombinedChart() {
  const canvas = document.getElementById('combinedChart');
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  combinedMeta = null;
  setCombinedCursor(null);
}

function positionCombinedCursor() {
  const el = document.getElementById('combinedCursor');
  if (!el) return;
  el.hidden = combinedRatio == null || !combinedMeta;
  if (el.hidden) return;
  const cW = combinedMeta.W - COMBINED_PAD.left - COMBINED_PAD.right;
  el.style.left = COMBINED_PAD.left + combinedRatio * cW + 'px';
}

function setCombinedCursor(ratio) {
  combinedRatio = ratio;
  positionCombinedCursor();
  if (ratio == null || !trackData) {
    updateCombinedValues(-1);
    return;
  }

  const idx = Math.round(ratio * (trackData.points.length - 1));
  updateCombinedValues(idx);
  const pt = trackData.points[idx];
  if (pt && snapMarker) {
    snapMarker.setLatLng([pt.lat, pt.lon]);
    snapMarker.setStyle({ opacity: 1, fillOpacity: 1 });
  }
}

// Libellés : valeurs sous le curseur, ou résumé de la trace tant que le curseur n'est pas posé
const COMBINED_VALUE_IDS = ['cmb-dist', 'cmb-speed', 'cmb-hr', 'cmb-elev', 'cmb-grade'];
const COMBINED_LABELS = {
  cursor: ['Dist.', 'Vit.', 'FC', 'Alt.', 'Côte'],
  summary: ['Distance', 'Vit. moy.', 'FC moy.', 'D+', 'Côte max'],
};

function updateCombinedValues(idx) {
  const pt = trackData?.points[idx];
  const summary = !pt && trackData;
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  COMBINED_VALUE_IDS.forEach((id, i) => {
    const label = document.getElementById(id)?.previousElementSibling;
    if (label) label.textContent = COMBINED_LABELS[summary ? 'summary' : 'cursor'][i];
  });

  if (summary) {
    const { stats, steepest } = trackData;
    set('cmb-dist', stats.dist.toFixed(1));
    set('cmb-speed', stats.avgSpeed.toFixed(1));
    set('cmb-hr', stats.hrAvg ?? '—');
    set('cmb-elev', Math.round(stats.elevUp));
    set('cmb-grade', steepest ? steepest.grade.toFixed(1) : '—');
    set('cmb-grade-max', steepest ? `km ${steepest.km.toFixed(1)}` : '');
    return;
  }

  set('cmb-dist', pt ? pt._cumDist.toFixed(1) : '—');
  set('cmb-speed', pt ? (pt._speed ?? 0).toFixed(1) : '—');
  set('cmb-hr', pt?.hr ?? '—');
  set('cmb-elev', pt ? Math.round(pt.ele) : '—');
  set('cmb-grade', pt ? (pt._grade ?? 0).toFixed(1) : '—');
  const climb = pt?._climb != null ? trackData.climbs[pt._climb] : null;
  set('cmb-grade-max', climb ? `max ${climb.max.grade.toFixed(1)} %` : '');
}

function initCombinedChart() {
  document.querySelectorAll('.combined-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      combinedSelected = btn.dataset.series;
      drawCombinedChart();
    });
  });

  // Glisser (doigt ou souris) : touch-action pan-y laisse le défilement vertical au navigateur
  const wrap = document.getElementById('combinedWrap');
  if (!wrap) return;
  const move = (e) => {
    if (!combinedMeta || !trackData) return;
    const rect = wrap.getBoundingClientRect();
    const cW = combinedMeta.W - COMBINED_PAD.left - COMBINED_PAD.right;
    setCombinedCursor(Math.max(0, Math.min(1, (e.clientX - rect.left - COMBINED_PAD.left) / cW)));
  };
  wrap.addEventListener('pointerdown', (e) => {
    wrap.setPointerCapture(e.pointerId);
    move(e);
  });
  wrap.addEventListener('pointermove', (e) => {
    if (wrap.hasPointerCapture(e.pointerId)) move(e);
  });
}
