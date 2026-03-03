/* ════════════════════════════════════════════════
   GPXtooth — app.js
   GPX parsing · Leaflet map · Stats · Charts
   ════════════════════════════════════════════════ */

'use strict';

// ── State ────────────────────────────────────────
let map = null;
let trackData = null;          // { points, stats, name, date }
let trackLayers = [];          // Leaflet polylines
let currentMetric = 'speed';
let currentTileLayer = null;
let tooltipEl = null;          // hover tooltip DOM node
let snapMarker = null;         // circle that snaps to nearest point

// Chart crosshair state
let chartMeta = {};            // { hr: { data, pad, canvasW, canvasH }, speed: {...}, elev: {...} }

// Auth & storage
const AUTH_HASH = '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918'; // SHA-256 of "admin"
let currentActivityFilter = 'all';
let heroShown = true;

const TILE_LAYERS = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr: '© OpenStreetMap contributors',
    options: { maxZoom: 19 }
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attr: '© OpenTopoMap contributors',
    options: { maxZoom: 19 }
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: '© ESRI World Imagery',
    options: { maxZoom: 19 }
  }
};

// ── Authentication ──────────────────────────────
async function hashPassword(password) {
  const enc = new TextEncoder();
  const data = enc.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function isAuthenticated() {
  return sessionStorage.getItem('gpxtooth_auth') === 'true';
}

async function login(password) {
  const hash = await hashPassword(password);
  const modal = document.getElementById('authModal');
  const errorEl = document.getElementById('authError');

  if (hash === AUTH_HASH) {
    sessionStorage.setItem('gpxtooth_auth', 'true');
    modal.classList.remove('show');
    updateImportButtonVisibility();
    showToast('Connecté avec succès');
    document.getElementById('authPassword').value = '';
    errorEl.classList.remove('show');
  } else {
    errorEl.textContent = 'Mot de passe incorrect';
    errorEl.classList.add('show');
  }
}

function logout() {
  sessionStorage.removeItem('gpxtooth_auth');
  updateImportButtonVisibility();
  showToast('Déconnecté');
}

function updateImportButtonVisibility() {
  const importBtn = document.querySelector('label[for="fileInput"]');
  if (importBtn) {
    importBtn.style.display = isAuthenticated() ? '' : 'none';
  }
}

function bindAuthModal() {
  const modal = document.getElementById('authModal');
  const input = document.getElementById('authPassword');
  const submitBtn = document.getElementById('authSubmit');
  const cancelBtn = document.getElementById('authCancel');
  const loginBtn = document.getElementById('btnLogin');

  loginBtn.addEventListener('click', () => {
    modal.classList.add('show');
    input.focus();
    input.value = '';
    document.getElementById('authError').classList.remove('show');
  });

  submitBtn.addEventListener('click', async () => {
    if (input.value) await login(input.value);
  });

  cancelBtn.addEventListener('click', () => {
    modal.classList.remove('show');
  });

  input.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter' && input.value) await login(input.value);
  });

  modal.querySelector('.auth-modal__backdrop').addEventListener('click', () => {
    modal.classList.remove('show');
  });
}

// ── Storage ──────────────────────────────────────
function loadActivities() {
  const json = localStorage.getItem('gpxtooth_activities');
  return json ? JSON.parse(json) : [];
}

function saveActivities(activities) {
  localStorage.setItem('gpxtooth_activities', JSON.stringify(activities));
}

function saveActivity(name, date, type, stats, gpxContent, filename) {
  if (!isAuthenticated()) return;
  const activities = loadActivities();
  activities.unshift({
    id: Date.now().toString(),
    name,
    date: date ? date.toISOString() : new Date().toISOString(),
    type: type || 'other',
    stats,
    gpxContent,
    filename,
    savedAt: new Date().toISOString()
  });
  saveActivities(activities);
  renderActivities();
}

function deleteActivity(id) {
  let activities = loadActivities();
  activities = activities.filter(a => a.id !== id);
  saveActivities(activities);
  renderActivities();
}

// ── Hide hero on first load ─────────────────────
function hideHero() {
  if (!heroShown) return;
  const hero = document.querySelector('.hero');
  if (hero) {
    hero.classList.add('hidden');
    heroShown = false;
  }
}

// ── Init map ─────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: [46.5, 2.5],
    zoom: 5,
    zoomControl: true,
    attributionControl: true
  });

  setTileLayer('osm');

  // Empty state overlay
  document.getElementById('map').insertAdjacentHTML('afterbegin', `
    <div class="map-empty" id="mapEmpty">
      <svg width="56" height="56" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1"
          d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
      </svg>
      <p>Importe un fichier GPX pour afficher la trace</p>
    </div>
  `);
}

// ── Scroll-reveal observer ────────────────────────
function initReveal() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('revealed');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
}

function setTileLayer(name) {
  if (currentTileLayer) map.removeLayer(currentTileLayer);
  const cfg = TILE_LAYERS[name];
  const opts = {
    attribution: cfg.attr,
    ...cfg.options,
    crossOrigin: 'anonymous'
  };
  currentTileLayer = L.tileLayer(cfg.url, opts);
  currentTileLayer.addTo(map);
}

// ── GPX Parser ───────────────────────────────────
function parseGPX(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  const ns = 'http://www.topografix.com/GPX/1/1';
  const nsHR = 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1';

  const name = doc.getElementsByTagName('name')[0]?.textContent ?? 'Trace GPS';
  const timeEl = doc.querySelector('metadata time');
  const date = timeEl ? new Date(timeEl.textContent) : null;

  const trkpts = doc.getElementsByTagName('trkpt');
  const points = [];

  for (const pt of trkpts) {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lon = parseFloat(pt.getAttribute('lon'));
    const ele = parseFloat(pt.getElementsByTagName('ele')[0]?.textContent ?? 0);
    const timeStr = pt.getElementsByTagName('time')[0]?.textContent ?? null;
    const t = timeStr ? new Date(timeStr) : null;

    // Heart rate from ns3:hr
    let hr = null;
    const hrEl = pt.getElementsByTagNameNS(nsHR, 'hr')[0]
               ?? pt.getElementsByTagName('ns3:hr')[0]
               ?? pt.querySelector('hr');
    if (hrEl) hr = parseInt(hrEl.textContent);

    if (!isNaN(lat) && !isNaN(lon)) {
      points.push({ lat, lon, ele, t, hr });
    }
  }

  return { name, date, points };
}

function parseActivityType(doc) {
  const typeEl = doc.querySelector('type');
  if (!typeEl) return 'other';

  const type = typeEl.textContent.toLowerCase().trim();
  if (type.includes('vtt') || type.includes('mtb') || type.includes('mountain')) return 'vtt';
  if (type.includes('running') || type.includes('run') || type.includes('course')) return 'running';
  if (type.includes('hiking') || type.includes('hike') || type.includes('rando')) return 'hiking';
  if (type.includes('cycling') || type.includes('bike') || type.includes('cycling')) return 'cycling';

  return 'other';
}

// ── Stats calculator ─────────────────────────────
function calcStats(points) {
  if (points.length < 2) return null;

  let totalDist = 0;
  let elevUp = 0;
  let elevDown = 0;
  let hrSum = 0;
  let hrCount = 0;
  let hrMax = 0;
  const speeds = [];
  points[0]._cumDist = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];

    // Haversine distance (km)
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    totalDist += d;
    b._cumDist = totalDist;

    // Elevation
    const dElev = b.ele - a.ele;
    if (dElev > 0) elevUp += dElev;
    else elevDown += Math.abs(dElev);

    // Speed (km/h) if timestamps available
    if (a.t && b.t) {
      const dt = (b.t - a.t) / 3600000; // hours
      const spd = dt > 0 ? d / dt : 0;
      speeds.push(Math.min(spd, 60)); // cap outliers
      b._speed = Math.min(spd, 60);
    } else {
      speeds.push(0);
      b._speed = 0;
    }

    // HR
    if (b.hr) {
      hrSum += b.hr;
      hrCount++;
      if (b.hr > hrMax) hrMax = b.hr;
    }
  }
  points[0]._speed = speeds[0] ?? 0;

  // Duration
  const start = points.find(p => p.t)?.t;
  const end = [...points].reverse().find(p => p.t)?.t;
  const durationMs = start && end ? end - start : 0;

  const avgSpeed = durationMs > 0
    ? totalDist / (durationMs / 3600000)
    : 0;

  return {
    dist: totalDist,
    elevUp,
    elevDown,
    durationMs,
    avgSpeed,
    hrAvg: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
    hrMax: hrMax || null,
    hasHR: hrCount > 0
  };
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Render stats ─────────────────────────────────
function updateStats(stats, name, date) {
  const fmt = (v, d = 1) => v != null ? v.toFixed(d) : '—';
  const dur = stats.durationMs;
  const h = Math.floor(dur / 3600000);
  const m = Math.floor((dur % 3600000) / 60000);
  const durStr = dur > 0 ? `${h}h${String(m).padStart(2, '0')}` : '—';

  // Mini hero cards
  document.getElementById('mini-dist-val').textContent = fmt(stats.dist);
  document.getElementById('mini-elev-val').textContent = Math.round(stats.elevUp);
  document.getElementById('mini-dur-val').textContent = durStr;
  document.getElementById('mini-hr-val').textContent = stats.hrAvg ?? '—';

  // Dashboard stats
  document.getElementById('stat-dist').textContent = fmt(stats.dist);
  document.getElementById('stat-dur').textContent = durStr;
  document.getElementById('stat-elev-up').textContent = Math.round(stats.elevUp);
  document.getElementById('stat-elev-down').textContent = Math.round(stats.elevDown);
  document.getElementById('stat-speed-avg').textContent = fmt(stats.avgSpeed);
  document.getElementById('stat-hr').textContent = stats.hrAvg ?? '—';

  // Track header
  document.getElementById('trackName').textContent = name;
  document.getElementById('trackDate').textContent = date
    ? date.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  // HR badges in stats header
  if (stats.hasHR) {
    document.getElementById('hrSection').style.display = '';
    document.getElementById('hr-avg-badge').textContent = stats.hrAvg;
    document.getElementById('hr-max-badge').textContent = stats.hrMax;
  } else {
    document.getElementById('hrSection').style.display = 'none';
  }
}

// ── Map overlay stats ────────────────────────────
function updateMapOverlay(stats) {
  const overlay = document.getElementById('mapOverlayStats');
  const fmt = (v, d = 1) => v != null ? v.toFixed(d) : '—';
  const dur = stats.durationMs;
  const h = Math.floor(dur / 3600000);
  const m = Math.floor((dur % 3600000) / 60000);
  const durStr = dur > 0 ? `${h}h${String(m).padStart(2, '0')}` : '—';

  document.getElementById('mos-dist').textContent = fmt(stats.dist, 1);
  document.getElementById('mos-elev').textContent = Math.round(stats.elevUp);
  document.getElementById('mos-dur').textContent = durStr;
  document.getElementById('mos-spd').textContent = fmt(stats.avgSpeed);

  if (stats.hasHR) {
    document.getElementById('mos-hr-row').style.display = '';
    document.getElementById('mos-hr').textContent = stats.hrAvg;
  } else {
    document.getElementById('mos-hr-row').style.display = 'none';
  }

  overlay.removeAttribute('hidden');
}

// ── Color helpers ─────────────────────────────────
function getGradientColor(ratio) {
  // Blue → Cyan → Green → Yellow → Red
  const stops = [
    [0,   [59, 130, 246]],
    [0.25,[34, 211, 238]],
    [0.5, [34, 197, 94]],
    [0.75,[234, 179, 8]],
    [1,   [239, 68, 68]]
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

  if (metric === 'none') { legend.setAttribute('hidden', ''); return; }
  legend.removeAttribute('hidden');

  bar.style.background = 'linear-gradient(90deg, #3b82f6, #22d3ee, #00e578, #fbbf24, #f87171)';

  const units = { speed: 'km/h', elevation: 'm', hr: 'bpm' };
  minEl.textContent = min.toFixed(0) + '\u202f' + (units[metric] ?? '');
  maxEl.textContent = max.toFixed(0) + '\u202f' + (units[metric] ?? '');
}

// ── Draw map track ────────────────────────────────
function drawTrack(points, metric) {
  // Clear old layers
  trackLayers.forEach(l => map.removeLayer(l));
  trackLayers = [];

  if (points.length < 2) return;

  // Get metric values for normalization
  let vals = [];
  if (metric === 'speed') vals = points.map(p => p._speed ?? 0);
  else if (metric === 'elevation') vals = points.map(p => p.ele ?? 0);
  else if (metric === 'hr') vals = points.map(p => p.hr ?? 0);

  const min = metric !== 'none' ? Math.min(...vals.filter(v => v > 0)) : 0;
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

      const seg = L.polyline([[a.lat, a.lon], [b.lat, b.lon]], {
        color,
        weight: 4,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(map);

      trackLayers.push(seg);
    }
  } else {
    const line = L.polyline(points.map(p => [p.lat, p.lon]), {
      color: '#00e578',
      weight: 4,
      opacity: 0.9,
      lineCap: 'round'
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
    className: ''
  });

  const endIcon = L.divIcon({
    html: `<div style="
      width:14px;height:14px;border-radius:50%;
      background:#f87171;border:2.5px solid rgba(255,255,255,.9);
      box-shadow:0 2px 12px rgba(248,113,113,.6)
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    className: ''
  });

  const start = points[0];
  const end = points[points.length - 1];

  const mStart = L.marker([start.lat, start.lon], { icon: startIcon })
    .bindPopup(`<div style="font-family:Inter,sans-serif;line-height:1.5">
      <strong style="color:#00e578">Départ</strong><br/>
      <span style="color:#8892a8;font-size:12px">Alt. ${start.ele.toFixed(0)} m</span>
    </div>`).addTo(map);

  const mEnd = L.marker([end.lat, end.lon], { icon: endIcon })
    .bindPopup(`<div style="font-family:Inter,sans-serif;line-height:1.5">
      <strong style="color:#f87171">Arrivée</strong><br/>
      <span style="color:#8892a8;font-size:12px">Alt. ${end.ele.toFixed(0)} m</span>
    </div>`).addTo(map);

  trackLayers.push(mStart, mEnd);

  // Fit bounds
  const bounds = L.latLngBounds(points.map(p => [p.lat, p.lon]));
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
    if (d < minD) { minD = d; nearest = p; nearestIdx = i; }
  }
  return { point: nearest, index: nearestIdx };
}

function showTrackTooltip(e, point) {
  if (!tooltipEl) return;
  const W = 164;
  let x = e.clientX + 18;
  let y = e.clientY - 70;
  if (x + W > window.innerWidth)  x = e.clientX - W - 18;
  if (y < 8)                       y = e.clientY + 18;

  tooltipEl.style.left    = x + 'px';
  tooltipEl.style.top     = y + 'px';
  tooltipEl.style.display = 'block';

  const dist  = point._cumDist != null ? point._cumDist.toFixed(2) + ' km' : '—';
  const elev  = point.ele != null ? Math.round(point.ele) + ' m' : '—';
  const speed = point._speed != null ? point._speed.toFixed(1) + ' km/h' : '—';
  const hr    = point.hr ? point.hr + ' bpm' : null;
  const time  = point.t
    ? point.t.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  let html = `
    <div class="tt-row"><span class="tt-label">Distance</span><span class="tt-val">${dist}</span></div>
    <div class="tt-row"><span class="tt-label">Altitude</span><span class="tt-val">${elev}</span></div>
    <div class="tt-row"><span class="tt-label">Vitesse</span><span class="tt-val">${speed}</span></div>`;
  if (hr)   html += `<div class="tt-row"><span class="tt-label">FC</span><span class="tt-val tt-val--red">${hr}</span></div>`;
  if (time) html += `<div class="tt-row"><span class="tt-label">Heure</span><span class="tt-val tt-val--dim">${time}</span></div>`;

  tooltipEl.innerHTML = html;
}

function addHoverLayer(points) {
  initTooltip();
  snapMarker = null;

  // Invisible fat polyline captures all mousemove over the track
  const hoverLine = L.polyline(points.map(p => [p.lat, p.lon]), {
    color: 'transparent',
    weight: 22,
    opacity: 0.001,
    interactive: true
  }).addTo(map);
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
    pane: 'markerPane'
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

// ── Canvas chart ──────────────────────────────────
function drawChart(canvasId, data, color, fillColor, chartKey = '') {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !data.length) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = rect.width || canvas.parentElement.clientWidth;
  const H = parseInt(canvas.getAttribute('height')) || 140;

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

  const toX = i => pad.left + (i / (data.length - 1)) * cW;
  const toY = v => pad.top + cH - ((v - min) / range) * cH;

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
    const x0 = toX(i - 1), y0 = toY(data[i - 1]);
    const x1 = toX(i), y1 = toY(data[i]);
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
    const x0 = toX(i - 1), y0 = toY(data[i - 1]);
    const x1 = toX(i), y1 = toY(data[i]);
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
  document.getElementById('cv-hr-dist').textContent = pt._cumDist ? pt._cumDist.toFixed(1) : '—';

  // Speed chart values
  document.getElementById('cv-speed-val').textContent = pt._speed ? pt._speed.toFixed(1) : '—';
  document.getElementById('cv-speed-dist').textContent = pt._cumDist ? pt._cumDist.toFixed(1) : '—';

  // Elevation chart values
  document.getElementById('cv-elev-val').textContent = pt.ele ? Math.round(pt.ele) : '—';
  document.getElementById('cv-elev-dist').textContent = pt._cumDist ? pt._cumDist.toFixed(1) : '—';
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

// ── Subsample array for chart performance ─────────
function subsample(arr, maxPoints = 400) {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  return arr.filter((_, i) => i % step === 0);
}

// ── Render activities ───────────────────────────
function getActivityTypeIcon(type) {
  const icons = {
    vtt: '🚵',
    running: '🏃',
    hiking: '🥾',
    cycling: '🚴',
    other: '📍'
  };
  return icons[type] || icons.other;
}

function renderActivities(filter = 'all') {
  const activities = loadActivities();
  const grid = document.getElementById('activitiesGrid');

  // Render filter pills
  const filtersEl = document.getElementById('activityFilters');
  const types = ['all', ...new Set(activities.map(a => a.type))];
  filtersEl.innerHTML = types
    .map(type => {
      const label = type === 'all' ? 'Toutes' : type.charAt(0).toUpperCase() + type.slice(1);
      return `<button class="filter-pill ${filter === type ? 'active' : ''}" data-filter="${type}">${label}</button>`;
    })
    .join('');

  // Add filter click handlers
  filtersEl.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', () => renderActivities(btn.dataset.filter));
  });

  // Filter activities
  const filtered = filter === 'all' ? activities : activities.filter(a => a.type === filter);

  // Render activity cards
  if (filtered.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem 1rem; color: var(--c-text-3);"><p>Aucune activité pour le moment. Importez un fichier GPX pour commencer.</p></div>';
  } else {
    grid.innerHTML = filtered
      .map(activity => {
        const date = new Date(activity.date);
        const dateStr = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
        const icon = getActivityTypeIcon(activity.type);
        const stats = activity.stats;
        const dur = stats.durationMs;
        const h = Math.floor(dur / 3600000);
        const m = Math.floor((dur % 3600000) / 60000);
        const durStr = dur > 0 ? `${h}h${String(m).padStart(2, '0')}` : '—';

        return `
          <div class="activity-card glass-card" data-id="${activity.id}">
            <div class="activity-card__header">
              <span class="activity-type-badge ${activity.type}">${icon} ${activity.type.toUpperCase()}</span>
              <span class="activity-card__date">${dateStr}</span>
            </div>
            <h3 class="activity-card__name">${activity.name}</h3>
            <div class="activity-card__stats">
              <span>${stats.dist.toFixed(1)} km</span>
              <span>${Math.round(stats.elevUp)} m+</span>
              <span>${durStr}</span>
            </div>
            <div class="activity-card__actions">
              <button class="btn btn--ghost btn--sm activity-view">Voir →</button>
              <button class="btn btn--ghost btn--sm activity-delete">🗑</button>
            </div>
          </div>
        `;
      })
      .join('');

    // Add event listeners
    grid.querySelectorAll('.activity-card').forEach(card => {
      const id = card.dataset.id;
      const activity = filtered.find(a => a.id === id);

      card.querySelector('.activity-view').addEventListener('click', () => {
        loadGPX(activity.gpxContent, activity.filename);
      });

      card.querySelector('.activity-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Êtes-vous sûr ?')) {
          deleteActivity(id);
        }
      });
    });
  }

  currentActivityFilter = filter;
}

// ── Load & render GPX ─────────────────────────────
function loadGPX(xmlString, filename = null) {
  try {
    const parsed = parseGPX(xmlString);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'application/xml');

    if (parsed.points.length < 2) {
      showToast('Fichier GPX vide ou invalide');
      return;
    }

    const stats = calcStats(parsed.points);
    if (!stats) return;

    trackData = { ...parsed, stats };

    // Hide hero section and scroll to dashboard
    hideHero();
    document.getElementById('dashboard').scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Stats
    updateStats(stats, parsed.name, parsed.date);

    // Map overlay stats
    updateMapOverlay(stats);

    // Map
    drawTrack(parsed.points, currentMetric);

    // Charts — all 3 side by side
    const elevData = subsample(parsed.points.map(p => p.ele));
    drawChart('elevChart', elevData, '#f97316', '#f97316', 'elev');

    const speedData = subsample(parsed.points.map(p => p._speed ?? 0));
    drawChart('speedChart', speedData, '#60a5fa', '#60a5fa', 'speed');

    if (stats.hasHR) {
      const hrData = subsample(parsed.points.map(p => p.hr ?? 0));
      drawChart('hrChart', hrData, '#ef4444', '#ef4444', 'hr');
    }

    // Init chart hover crosshairs
    initChartHover();

    // Save activity if authenticated
    if (isAuthenticated()) {
      const actType = parseActivityType(doc);
      saveActivity(parsed.name, parsed.date, actType, stats, xmlString, filename);
      showToast(`Trace sauvegardée : ${parsed.name}`);
    }

    showToast(`Trace chargée : ${parsed.name}`);
  } catch (e) {
    console.error(e);
    showToast('Erreur lors du parsing GPX');
  }
}

// ── File input handlers ───────────────────────────
function bindFileInputs() {
  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => loadGPX(e.target.result, file.name);
    reader.readAsText(file);
  };

  document.getElementById('fileInput').addEventListener('change', e => {
    handleFile(e.target.files[0]);
    e.target.value = ''; // reset so same file can be re-loaded
  });

  document.getElementById('fileInput2').addEventListener('change', e => {
    handleFile(e.target.files[0]);
    e.target.value = '';
  });

  // Drag and drop
  const dz = document.getElementById('dropZone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    handleFile(e.dataTransfer.files[0]);
  });
}

// ── Load demo GPX file ────────────────────────────
async function loadDemoFile() {
  try {
    const res = await fetch('vtt.gpx');
    if (!res.ok) throw new Error('not found');
    const txt = await res.text();
    loadGPX(txt, 'vtt.gpx');
  } catch (e) {
    showToast('Fichier démo introuvable (vtt.gpx)');
  }
}

// ── Toast ─────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toast.offsetHeight; // reflow
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// ── Layer buttons ─────────────────────────────────
function bindLayerButtons() {
  const btns = { btnOSM: 'osm', btnTopo: 'topo', btnSatellite: 'satellite' };
  for (const [id, key] of Object.entries(btns)) {
    document.getElementById(id).addEventListener('click', () => {
      setTileLayer(key);
      document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
      document.getElementById(id).classList.add('active');
    });
  }
}

// ── Metric buttons ────────────────────────────────
function bindMetricButtons() {
  document.querySelectorAll('.metric-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentMetric = btn.dataset.metric;
      document.querySelectorAll('.metric-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (trackData) {
        drawTrack(trackData.points, currentMetric);
      }
    });
  });
}

// ── Demo / nav buttons ────────────────────────────
function bindDemoButtons() {
  document.getElementById('btnDemo')?.addEventListener('click', () => {
    loadDemoFile();
  });
  document.getElementById('btnLoadDemo')?.addEventListener('click', () => {
    loadDemoFile();
  });
}

// ── Resize charts on window resize ────────────────
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (trackData) {
      const elevData = subsample(trackData.points.map(p => p.ele));
      drawChart('elevChart', elevData, '#f97316', '#f97316', 'elev');

      const speedData = subsample(trackData.points.map(p => p._speed ?? 0));
      drawChart('speedChart', speedData, '#60a5fa', '#60a5fa', 'speed');

      if (trackData.stats.hasHR) {
        const hrData = subsample(trackData.points.map(p => p.hr ?? 0));
        drawChart('hrChart', hrData, '#ef4444', '#ef4444', 'hr');
      }
    }
  }, 200);
});

// ── Boot ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initReveal();
  bindFileInputs();
  bindLayerButtons();
  bindMetricButtons();
  bindDemoButtons();
  bindAuthModal();
  updateImportButtonVisibility();
  renderActivities();
});
