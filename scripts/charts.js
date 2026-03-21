/* ════════════════════════════════════════════════
   GPXtooth — charts.js
   Canvas charts · Crosshairs · Hover values
   ════════════════════════════════════════════════ */

'use strict';

// Chart crosshair state
let chartMeta = {};

// ── Canvas chart ──────────────────────────────────
function drawChart(canvasId, data, color, fillColor, chartKey = '') {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !data.length) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  // Reset inline height so CSS controls the layout size
  canvas.style.height = '';
  const rect = canvas.getBoundingClientRect();
  const W = rect.width || canvas.parentElement.clientWidth;
  const H = rect.height || 90;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);

  const pad = { top: 12, right: 12, bottom: 28, left: 40 };

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

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (i / 4) * cH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + cW, y);
    ctx.stroke();
  }

  // Y labels
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = max - (i / 4) * range;
    const y = pad.top + (i / 4) * cH;
    ctx.fillText(v.toFixed(0), pad.left - 6, y + 3);
  }

  // Fill gradient
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
  grad.addColorStop(0, fillColor + '60');
  grad.addColorStop(1, fillColor + '00');

  ctx.beginPath();
  ctx.moveTo(toX(0), toY(data[0]));
  for (let i = 1; i < data.length; i++) {
    const x0 = toX(i - 1),
      y0 = toY(data[i - 1]);
    const x1 = toX(i),
      y1 = toY(data[i]);
    const mx = (x0 + x1) / 2;
    ctx.bezierCurveTo(mx, y0, mx, y1, x1, y1);
  }
  ctx.lineTo(toX(data.length - 1), pad.top + cH);
  ctx.lineTo(toX(0), pad.top + cH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(data[0]));
  for (let i = 1; i < data.length; i++) {
    const x0 = toX(i - 1),
      y0 = toY(data[i - 1]);
    const x1 = toX(i),
      y1 = toY(data[i]);
    const mx = (x0 + x1) / 2;
    ctx.bezierCurveTo(mx, y0, mx, y1, x1, y1);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// ── Chart crosshair helpers ───────────────────────
function showAllCrosshairs(ratio) {
  for (const key of ['hr', 'speed', 'elev']) {
    const meta = chartMeta[key];
    const el = document.getElementById('crosshair-' + key);
    if (!meta || !el) continue;
    const cW = meta.W - meta.pad.left - meta.pad.right;
    const x = meta.pad.left + ratio * cW;
    el.style.left = x + 'px';
    el.style.opacity = '1';
  }
}

function hideAllCrosshairs() {
  for (const key of ['hr', 'speed', 'elev']) {
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
}

function initChartHover() {
  for (const key of ['hr', 'speed', 'elev']) {
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
