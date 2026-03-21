/* ════════════════════════════════════════════════
   GPXtooth — map.js
   Leaflet map · Track drawing · Tooltip · Hover
   ════════════════════════════════════════════════ */

'use strict';

// ── Map state ─────────────────────────────────────
let map = null;
let trackLayers = [];
let currentTileLayer = null;
let tooltipEl = null;
let snapMarker = null;

const TILE_LAYERS = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr: '© OpenStreetMap contributors',
    options: { maxZoom: 19 },
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attr: '© OpenTopoMap contributors',
    options: { maxZoom: 19 },
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: '© ESRI World Imagery',
    options: { maxZoom: 19 },
  },
};

// ── Init map ─────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: [46.5, 2.5],
    zoom: 5,
    zoomControl: true,
    attributionControl: true,
  });

  setTileLayer('osm');

  // Empty state overlay
  document.getElementById('map').insertAdjacentHTML(
    'afterbegin',
    `
    <div class="map-empty" id="mapEmpty">
      <svg width="56" height="56" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1"
          d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
      </svg>
      <p>Importe un fichier GPX pour afficher la trace</p>
    </div>
  `,
  );
}

function setTileLayer(name) {
  if (currentTileLayer) map.removeLayer(currentTileLayer);
  const cfg = TILE_LAYERS[name];
  const opts = {
    attribution: cfg.attr,
    ...cfg.options,
    crossOrigin: 'anonymous',
  };
  currentTileLayer = L.tileLayer(cfg.url, opts);
  currentTileLayer.addTo(map);
}

// ── Color helpers ─────────────────────────────────
function getGradientColor(ratio) {
  // Blue → Cyan → Green → Yellow → Red
  const stops = [
    [0, [59, 130, 246]],
    [0.25, [34, 211, 238]],
    [0.5, [34, 197, 94]],
    [0.75, [234, 179, 8]],
    [1, [239, 68, 68]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (ratio >= t0 && ratio <= t1) {
      const f = (ratio - t0) / (t1 - t0);
      const r = Math.round(c0[0] + f * (c1[0] - c0[0]));
      const g = Math.round(c0[1] + f * (c1[1] - c0[1]));
      const b = Math.round(c0[2] + f * (c1[2] - c0[2]));
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'rgb(239,68,68)';
}

function updateLegend(metric, min, max) {
  const legend = document.getElementById('legend');
  const bar = document.getElementById('legend-bar');
  const minEl = document.getElementById('legend-min');
  const maxEl = document.getElementById('legend-max');

  if (metric === 'none') {
    legend.setAttribute('hidden', '');
    return;
  }
  legend.removeAttribute('hidden');

  bar.style.background =
    'linear-gradient(90deg, #3b82f6, #22d3ee, #00e578, #fbbf24, #f87171)';

  const units = { speed: 'km/h', elevation: 'm', hr: 'bpm' };
  minEl.textContent = min.toFixed(0) + '\u202f' + (units[metric] ?? '');
  maxEl.textContent = max.toFixed(0) + '\u202f' + (units[metric] ?? '');
}

// ── Draw map track ────────────────────────────────
function drawTrack(points, metric) {
  // Clear old layers
  trackLayers.forEach((l) => map.removeLayer(l));
  trackLayers = [];

  if (points.length < 2) return;

  // Get metric values for normalization
  let vals = [];
  if (metric === 'speed') vals = points.map((p) => p._speed ?? 0);
  else if (metric === 'elevation') vals = points.map((p) => p.ele ?? 0);
  else if (metric === 'hr') vals = points.map((p) => p.hr ?? 0);

  const min = metric !== 'none' ? Math.min(...vals.filter((v) => v > 0)) : 0;
  const max = metric !== 'none' ? Math.max(...vals) : 1;
  const range = max - min || 1;

  updateLegend(metric, min, max);

  // Draw colored segments
  if (metric !== 'none') {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const ratio = (vals[i] - min) / range;
      const color = getGradientColor(Math.max(0, Math.min(1, ratio)));

      const seg = L.polyline(
        [
          [a.lat, a.lon],
          [b.lat, b.lon],
        ],
        {
          color,
          weight: 4,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        },
      ).addTo(map);

      trackLayers.push(seg);
    }
  } else {
    const line = L.polyline(
      points.map((p) => [p.lat, p.lon]),
      {
        color: '#00e578',
        weight: 4,
        opacity: 0.9,
        lineCap: 'round',
      },
    ).addTo(map);
    trackLayers.push(line);
  }

  // Start marker
  const startIcon = L.divIcon({
    html: `<div style="
      width:14px;height:14px;border-radius:50%;
      background:#00e578;border:2.5px solid rgba(255,255,255,.9);
      box-shadow:0 2px 12px rgba(0,229,120,.6)
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    className: '',
  });

  const endIcon = L.divIcon({
    html: `<div style="
      width:14px;height:14px;border-radius:50%;
      background:#f87171;border:2.5px solid rgba(255,255,255,.9);
      box-shadow:0 2px 12px rgba(248,113,113,.6)
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    className: '',
  });

  const start = points[0];
  const end = points[points.length - 1];

  const mStart = L.marker([start.lat, start.lon], { icon: startIcon })
    .bindPopup(
      `<div style="font-family:Inter,sans-serif;line-height:1.5">
      <strong style="color:#00e578">Départ</strong><br/>
      <span style="color:#8892a8;font-size:12px">Alt. ${start.ele.toFixed(0)} m</span>
    </div>`,
    )
    .addTo(map);

  const mEnd = L.marker([end.lat, end.lon], { icon: endIcon })
    .bindPopup(
      `<div style="font-family:Inter,sans-serif;line-height:1.5">
      <strong style="color:#f87171">Arrivée</strong><br/>
      <span style="color:#8892a8;font-size:12px">Alt. ${end.ele.toFixed(0)} m</span>
    </div>`,
    )
    .addTo(map);

  trackLayers.push(mStart, mEnd);

  // Fit bounds
  const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon]));
  map.fitBounds(bounds, { padding: [40, 40] });

  // Hide empty state
  const empty = document.getElementById('mapEmpty');
  if (empty) empty.style.display = 'none';

  // Interactive hover tooltip
  addHoverLayer(points);
}

// ── Track hover tooltip ───────────────────────────
function initTooltip() {
  if (tooltipEl) return;
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'track-tooltip';
  tooltipEl.style.display = 'none';
  document.body.appendChild(tooltipEl);
}

function findNearestPoint(latlng, points) {
  let minD = Infinity;
  let nearest = null;
  let nearestIdx = -1;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const dLat = p.lat - latlng.lat;
    const dLon = p.lon - latlng.lng;
    const d = dLat * dLat + dLon * dLon;
    if (d < minD) {
      minD = d;
      nearest = p;
      nearestIdx = i;
    }
  }
  return { point: nearest, index: nearestIdx };
}

function showTrackTooltip(e, point) {
  if (!tooltipEl) return;
  const W = 164;
  let x = e.clientX + 18;
  let y = e.clientY - 70;
  if (x + W > window.innerWidth) x = e.clientX - W - 18;
  if (y < 8) y = e.clientY + 18;

  tooltipEl.style.left = x + 'px';
  tooltipEl.style.top = y + 'px';
  tooltipEl.style.display = 'block';

  const dist = point._cumDist != null ? point._cumDist.toFixed(2) + ' km' : '—';
  const elev = point.ele != null ? Math.round(point.ele) + ' m' : '—';
  const speed = point._speed != null ? point._speed.toFixed(1) + ' km/h' : '—';
  const hr = point.hr ? point.hr + ' bpm' : null;
  const time = point.t
    ? point.t.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

  let html = `
    <div class="tt-row"><span class="tt-label">Distance</span><span class="tt-val">${dist}</span></div>
    <div class="tt-row"><span class="tt-label">Altitude</span><span class="tt-val">${elev}</span></div>
    <div class="tt-row"><span class="tt-label">Vitesse</span><span class="tt-val">${speed}</span></div>`;
  if (hr)
    html += `<div class="tt-row"><span class="tt-label">FC</span><span class="tt-val tt-val--red">${hr}</span></div>`;
  if (time)
    html += `<div class="tt-row"><span class="tt-label">Heure</span><span class="tt-val tt-val--dim">${time}</span></div>`;

  tooltipEl.innerHTML = html;
}

function addHoverLayer(points) {
  initTooltip();
  snapMarker = null;

  // Invisible fat polyline captures all mousemove over the track
  const hoverLine = L.polyline(
    points.map((p) => [p.lat, p.lon]),
    {
      color: 'transparent',
      weight: 22,
      opacity: 0.001,
      interactive: true,
    },
  ).addTo(map);
  trackLayers.push(hoverLine);

  // Snap circle — starts invisible
  snapMarker = L.circleMarker([points[0].lat, points[0].lon], {
    radius: 5,
    color: '#ffffff',
    weight: 2.5,
    fillColor: '#00e578',
    fillOpacity: 0,
    opacity: 0,
    interactive: false,
    pane: 'markerPane',
  }).addTo(map);
  trackLayers.push(snapMarker);

  hoverLine.on('mousemove', (e) => {
    const { point: pt, index: idx } = findNearestPoint(e.latlng, points);
    if (!pt) return;
    snapMarker.setLatLng([pt.lat, pt.lon]);
    snapMarker.setStyle({ opacity: 1, fillOpacity: 1 });
    showTrackTooltip(e.originalEvent, pt);
    // Show crosshair on all charts at the proportional position
    const ratio = idx / (points.length - 1);
    showAllCrosshairs(ratio);
    // Update chart values
    updateChartValues(idx);
  });

  hoverLine.on('mouseout', () => {
    if (tooltipEl) tooltipEl.style.display = 'none';
    if (snapMarker) snapMarker.setStyle({ opacity: 0, fillOpacity: 0 });
    hideAllCrosshairs();
  });
}
