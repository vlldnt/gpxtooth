/* ════════════════════════════════════════════════
   GPXtooth — map.js
   Leaflet map · Track drawing · Tooltip · Hover
   ════════════════════════════════════════════════ */

'use strict';

// ── Map state ─────────────────────────────────────
let map = null;
let trackLayers = [];
let backgroundLayers = new Map(); // activity id → polyline (traces non sélectionnées)
let currentTileLayer = null;
let tooltipEl = null;
let snapMarker = null;

// ── Fonds de carte et surcouches ──────────────────
// IGN Géoplateforme en WMTS, sans clé (SCAN 25 : clé publique ign_scan_ws).
// maxNativeZoom = dernier zoom où le serveur a des tuiles (vérifié) ; au-delà Leaflet agrandit.
function ignWmts(layer, { format = 'image/png', style = 'normal', key } = {}) {
  const base = key ? `https://data.geopf.fr/private/wmts?apikey=${key}&` : 'https://data.geopf.fr/wmts?';
  return `${base}SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=${style}&TILEMATRIXSET=PM&FORMAT=${format}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
}

const BASE_LAYERS = {
  osm: {
    label: 'OpenStreetMap',
    short: 'OSM',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr: '© OpenStreetMap',
  },
  osmfr: {
    label: 'OSM France',
    url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
    attr: '© OpenStreetMap France',
  },
  ignPlan: {
    label: 'Plan IGN',
    url: ignWmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2'),
    attr: '© IGN',
  },
  // Carte topographique IGN multi-échelles (TOP 25 aux zooms rando), clé publique ign_scan_ws
  ignTopo: {
    label: 'IGN Topo (France)',
    short: 'IGN Topo',
    url: ignWmts('GEOGRAPHICALGRIDSYSTEMS.MAPS', { format: 'image/jpeg', key: 'ign_scan_ws' }),
    attr: '© IGN',
    options: { maxNativeZoom: 18 },
  },
  topo: {
    label: 'OpenTopoMap',
    short: 'Topo',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attr: '© OpenTopoMap',
  },
  cyclosm: {
    label: 'CyclOSM (vélo / VTT)',
    short: 'CyclOSM',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    attr: '© CyclOSM · © OpenStreetMap',
  },
  ignOrtho: {
    label: 'Photo aérienne IGN',
    short: 'Photo IGN',
    url: ignWmts('ORTHOIMAGERY.ORTHOPHOTOS', { format: 'image/jpeg' }),
    attr: '© IGN',
  },
  satellite: {
    label: 'Satellite Esri',
    short: 'Sat',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: '© Esri World Imagery',
  },
};

// Surcouches transparentes, cumulables par-dessus n'importe quel fond
const OVERLAY_LAYERS = {
  hiking: {
    label: 'Sentiers de rando balisés',
    url: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
    attr: '© Waymarked Trails',
    options: { maxNativeZoom: 18 },
  },
  mtb: {
    label: 'Circuits VTT balisés',
    url: 'https://tile.waymarkedtrails.org/mtb/{z}/{x}/{y}.png',
    attr: '© Waymarked Trails',
    options: { maxNativeZoom: 18 },
  },
  slopes: {
    label: 'Pentes en montagne (IGN)',
    url: ignWmts('GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN'),
    attr: '© IGN',
    options: { maxNativeZoom: 17, opacity: 0.6 },
  },
};

const overlayLayers = new Map(); // clé → surcouche affichée

// ── Init map ─────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: [46.5, 2.5],
    zoom: 5,
    zoomControl: false,
    attributionControl: false, // pas de crédit en bas à droite de la carte
  });

  // Zoom rangé sous les contrôles de la carte (haut droite) ; le panneau traces occupe le coin haut-gauche
  const zoom = L.control.zoom({ position: 'topright' }).addTo(map);
  document.getElementById('mapControls')?.appendChild(zoom.getContainer());

  // Fond de carte : posé par bindLayerMenu (choix mémorisé)

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

function createTileLayer(cfg, zIndex) {
  return L.tileLayer(cfg.url, { maxZoom: 19, ...cfg.options, zIndex, crossOrigin: 'anonymous' });
}

let currentTileName = null;

function setTileLayer(name) {
  if (currentTileLayer && currentTileName === name) return; // déjà affiché : pas de rechargement des tuiles
  if (currentTileLayer) map.removeLayer(currentTileLayer);
  currentTileName = name;
  currentTileLayer = createTileLayer(BASE_LAYERS[name] ?? BASE_LAYERS.osm, 1).addTo(map);
}

function setOverlay(name, visible) {
  const current = overlayLayers.get(name);
  if (visible && !current) {
    overlayLayers.set(name, createTileLayer(OVERLAY_LAYERS[name], 2).addTo(map));
  } else if (!visible && current) {
    map.removeLayer(current);
    overlayLayers.delete(name);
  }
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
  minEl.textContent = min.toFixed(0) + ' ' + (units[metric] ?? '');
  maxEl.textContent = max.toFixed(0) + ' ' + (units[metric] ?? '');
}

// ── Vivid color palette for traces ───────────────
const TRACE_COLORS = [
  '#ff2d95', // Rose
  '#00e5ff', // Cyan
  '#ffd600', // Jaune
  '#00e676', // Vert
  '#ff6d00', // Orange
  '#2979ff', // Bleu
  '#d500f9', // Violet
  '#aeea00', // Lime
  '#ff1744', // Rouge
  '#1de9b6', // Turquoise
];

function getTraceColor(index) {
  return TRACE_COLORS[index % TRACE_COLORS.length];
}

// ── Layer helpers ─────────────────────────────────
function clearTrackLayers() {
  trackLayers.forEach((l) => map.removeLayer(l));
  trackLayers = [];
  backgroundLayers.clear();
  snapMarker = null;
}

function setMapEmpty(isEmpty) {
  const empty = document.getElementById('mapEmpty');
  if (empty) empty.style.display = isEmpty ? '' : 'none';
  if (isEmpty) document.getElementById('legend').setAttribute('hidden', '');
}

function fitToPoints(pointLists) {
  const latlngs = pointLists.flat().map((p) => [p.lat, p.lon]);
  if (latlngs.length > 0) {
    map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
  }
}

// ── Non-selected traces ───────────────────────────
// Sans sélection : couleurs vives. Avec une trace sélectionnée : les autres en clair.
// Survol (carte ou liste) : vive et plus épaisse, pour viser la bonne trace.
const BG_STYLE_DIMMED = { opacity: 0.6, weight: 3 };
const BG_STYLE_VIVID = { opacity: 1, weight: 4 };
const BG_STYLE_HOVER = { opacity: 1, weight: 6 };

// tracks : [{ id, points, color }] — clic sur une trace = sélection
function drawBackgroundTracks(tracks, onSelect, { dimmed = true } = {}) {
  const base = dimmed ? BG_STYLE_DIMMED : BG_STYLE_VIVID;
  for (const { id, points, color } of tracks) {
    if (points.length < 2) continue;
    const latlngs = points.map((p) => [p.lat, p.lon]);
    const line = L.polyline(latlngs, {
      color,
      ...base,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
    }).addTo(map);
    // Zone de clic large et invisible : la trace reste facile à viser
    const hit = L.polyline(latlngs, { color, weight: 16, opacity: 0.001 }).addTo(map);
    hit.on('click', () => onSelect(id));
    hit.on('mouseover', () => previewTrack(id, true));
    hit.on('mouseout', () => previewTrack(id, false));
    trackLayers.push(line, hit);
    backgroundLayers.set(id, { line, base });
  }
}

function previewTrack(id, active) {
  const layer = backgroundLayers.get(id);
  if (!layer) return;
  layer.line.setStyle(active ? BG_STYLE_HOVER : layer.base);
  if (active) layer.line.bringToFront();
  else layer.line.bringToBack();
}

// ── Draw selected track (opaque) ──────────────────
function drawTrack(points, metric, color = '#00e578') {
  if (points.length < 2) return;

  // Get metric values for normalization
  let vals = [];
  if (metric === 'speed') vals = points.map((p) => p._speed ?? 0);
  else if (metric === 'elevation') vals = points.map((p) => p.ele ?? 0);
  else if (metric === 'hr') vals = points.map((p) => p.hr ?? 0);

  // Boucle plutôt que Math.min(...vals) : pas de dépassement de pile sur les très gros GPX
  const positive = vals.filter((v) => v > 0);
  const hasValues = metric !== 'none' && positive.length > 0;
  const min = hasValues ? positive.reduce((a, b) => (b < a ? b : a)) : 0;
  const max = hasValues ? vals.reduce((a, b) => (b > a ? b : a)) : 1;
  const range = max - min || 1;

  updateLegend(metric, min, max);

  const latlngs = points.map((p) => [p.lat, p.lon]);
  // Mobile : trait plus fin (÷ 1,5), couleur seule sans contour
  const mobile = MOBILE_QUERY.matches;
  const weight = mobile ? 4 / 1.5 : 4;

  // Contour sombre sous la trace (desktop) : lisible sur tous les fonds de carte
  if (!mobile) {
    const casing = L.polyline(latlngs, {
      color: '#000000',
      weight: 8,
      opacity: 0.35,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
    }).addTo(map);
    trackLayers.push(casing);
  }

  // Draw colored segments
  if (metric !== 'none') {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const ratio = (vals[i] - min) / range;
      const segColor = getGradientColor(Math.max(0, Math.min(1, ratio)));

      const seg = L.polyline(
        [
          [a.lat, a.lon],
          [b.lat, b.lon],
        ],
        {
          color: segColor,
          weight,
          opacity: 1,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        },
      ).addTo(map);

      trackLayers.push(seg);
    }
  } else {
    const line = L.polyline(latlngs, {
      color,
      weight,
      opacity: 1,
      lineCap: 'round',
      interactive: false,
    }).addTo(map);
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

  setMapEmpty(false);

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
