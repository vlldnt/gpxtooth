/* ════════════════════════════════════════════════
   GPXtooth — app.js
   Orchestration: loadGPX, bindings, fullscreen, boot
   ════════════════════════════════════════════════ */

'use strict';

// ── State ────────────────────────────────────────
let trackData = null;
let currentMetric = 'speed';

// ── Display a GPX trace (view only, no save) ─────
function displayGPX(xmlString, displayName) {
  try {
    const parsed = parseGPX(xmlString);

    if (parsed.points.length < 2) {
      showToast('Fichier GPX vide ou invalide');
      return;
    }

    const stats = calcStats(parsed.points);
    if (!stats) return;

    trackData = { ...parsed, stats };

    hideHero();
    document
      .querySelector('.panel--map')
      .scrollIntoView({ behavior: 'smooth', block: 'start' });

    updateStats(stats, displayName || parsed.name, parsed.date);
    updateMapOverlay(stats);
    drawTrack(parsed.points, currentMetric);
    redrawAllCharts();
    initChartHover();

    showToast(`Trace chargée : ${displayName || parsed.name}`);
  } catch (e) {
    console.error('GPX Error:', e);
    showToast('Erreur lors du parsing GPX');
  }
}

// ── Import a new GPX file (save + display) ────────
function importGPX(xmlString, filename) {
  try {
    const parsed = parseGPX(xmlString);

    if (parsed.points.length < 2) {
      showToast('Fichier GPX vide ou invalide');
      return;
    }

    // Prompt for name, prefilled with filename (sans .gpx)
    const defaultName = filename
      ? filename.replace(/\.gpx$/i, '')
      : parsed.name;
    const userName = prompt('Nom de la trace :', defaultName);
    if (userName === null) return; // cancelled
    const finalName = userName.trim() || defaultName;

    const stats = calcStats(parsed.points);
    if (!stats) return;

    const actType = parseActivityType(
      new DOMParser().parseFromString(xmlString, 'application/xml'),
    );
    saveActivity(finalName, parsed.date, actType, stats, xmlString, filename);
    showToast(`Trace sauvegardée : ${finalName}`);

    // Display it
    displayGPX(xmlString, finalName);

    // Highlight in sidebar
    highlightSidebarItem(null);
  } catch (e) {
    console.error('GPX Error:', e);
    showToast("Erreur lors de l'import GPX");
  }
}

// ── Redraw all charts helper ──────────────────────
function redrawAllCharts() {
  if (!trackData) return;
  const elevData = subsample(trackData.points.map((p) => p.ele));
  drawChart('elevChart', elevData, '#f97316', '#f97316', 'elev');
  const speedData = subsample(trackData.points.map((p) => p._speed ?? 0));
  drawChart('speedChart', speedData, '#60a5fa', '#60a5fa', 'speed');
  if (trackData.stats.hasHR) {
    const hrData = subsample(trackData.points.map((p) => p.hr ?? 0));
    drawChart('hrChart', hrData, '#ef4444', '#ef4444', 'hr');
  }
}

// ── File input handlers ───────────────────────────
function bindFileInputs() {
  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => importGPX(e.target.result, file.name);
    reader.readAsText(file);
  };

  document.getElementById('fileInput').addEventListener('change', (e) => {
    handleFile(e.target.files[0]);
    e.target.value = '';
  });

  document.getElementById('fileInput2').addEventListener('change', (e) => {
    handleFile(e.target.files[0]);
    e.target.value = '';
  });

  // Drag and drop
  const dz = document.getElementById('dropZone');
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('drag-over');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', (e) => {
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
    importGPX(txt, 'vtt.gpx');
  } catch (e) {
    showToast('Fichier démo introuvable (vtt.gpx)');
  }
}

// ── Fullscreen toggle ─────────────────────────────
function repositionOverlayStats() {
  const overlay = document.getElementById('mapOverlayStats');
  const chartsRow = document.getElementById('chartsRow');
  const panel = document.querySelector('.panel--map');
  if (!overlay || !chartsRow || !panel) return;

  if (panel.classList.contains('fullscreen')) {
    const chartsH = chartsRow.offsetHeight;
    overlay.style.bottom = chartsH + 12 + 'px';
    overlay.style.right = '1rem';
    overlay.style.left = 'auto';
  } else {
    overlay.style.bottom = '';
    overlay.style.right = '';
    overlay.style.left = '';
  }
}

function bindFullscreenButton() {
  const btn = document.getElementById('btnFullscreen');
  const panel = document.querySelector('.panel--map');
  if (!btn || !panel) return;

  const enterOrExitFullscreen = () => {
    setTimeout(() => {
      if (map) map.invalidateSize();
      redrawAllCharts();
      repositionOverlayStats();
    }, 50);
  };

  btn.addEventListener('click', () => {
    panel.classList.toggle('fullscreen');
    enterOrExitFullscreen();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('fullscreen')) {
      panel.classList.remove('fullscreen');
      enterOrExitFullscreen();
    }
  });
}

// ── Button bindings ──────────────────────────────
function bindLayerButtons() {
  const btns = { btnOSM: 'osm', btnTopo: 'topo', btnSatellite: 'satellite' };
  for (const [id, key] of Object.entries(btns)) {
    document.getElementById(id).addEventListener('click', () => {
      setTileLayer(key);
      document
        .querySelectorAll('.layer-btn')
        .forEach((b) => b.classList.remove('active'));
      document.getElementById(id).classList.add('active');
    });
  }
}

function bindMetricButtons() {
  document.querySelectorAll('.metric-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentMetric = btn.dataset.metric;
      document
        .querySelectorAll('.metric-btn')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      if (trackData) drawTrack(trackData.points, currentMetric);
    });
  });
}

function bindDemoButtons() {
  document
    .getElementById('btnDemo')
    ?.addEventListener('click', () => loadDemoFile());
  document
    .getElementById('btnLoadDemo')
    ?.addEventListener('click', () => loadDemoFile());
}

function setupImportButton() {
  const fileInput = document.getElementById('fileInput');
  const importBtnNav = document.getElementById('btnImport');
  const importBtnHero = document.getElementById('btnImportHero');

  const handleImportClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileInput.click();
  };

  if (importBtnNav) importBtnNav.addEventListener('click', handleImportClick);
  if (importBtnHero) importBtnHero.addEventListener('click', handleImportClick);
}

// ── Auto-hide nav when map section is in view ─────
function initNavAutoHide() {
  const nav = document.querySelector('.nav');
  const mapPanel = document.querySelector('.panel--map');
  if (!nav || !mapPanel) return;

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting && trackData) {
          nav.classList.add('nav--hidden');
        } else {
          nav.classList.remove('nav--hidden');
        }
      });
    },
    { threshold: 0.3 },
  );

  io.observe(mapPanel);
}

// ── Resize ────────────────────────────────────────
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    redrawAllCharts();
    repositionOverlayStats();
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
  bindFullscreenButton();
  setupImportButton();
  renderSidebar();
  initNavAutoHide();
});
