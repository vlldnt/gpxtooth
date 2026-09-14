/* ════════════════════════════════════════════════
   GPXtooth — app.js
   Orchestration: sélection, import, bindings, boot
   ════════════════════════════════════════════════ */

'use strict';

// ── State ────────────────────────────────────────
let trackData = null; // trace sélectionnée : points, stats, côtes
let currentMetric = 'speed';
let selectedActivityId = null;
const parsedCache = new Map(); // activity id → parseGPX (évite de re-parser à chaque rendu)

const MOBILE_QUERY = window.matchMedia('(max-width: 768px)');

function getParsedActivity(activity) {
  if (!parsedCache.has(activity.id)) {
    parsedCache.set(activity.id, parseGPX(activity.gpxContent));
  }
  return parsedCache.get(activity.id);
}

// Couleur stable par trace : attribuée par ordre d'ajout (la plus ancienne = 1re couleur)
function getActivityColors() {
  const all = loadActivities();
  return new Map(all.map((a, i) => [a.id, getTraceColor(all.length - 1 - i)]));
}

// ── Map rendering ─────────────────────────────────
// fit : 'all' (toutes les traces visibles), 'selected' ou null (ne bouge pas)
function renderMap({ fit = null } = {}) {
  clearTrackLayers();
  const visible = getVisibleActivities();
  const colors = getActivityColors();

  drawBackgroundTracks(
    visible
      .filter((a) => a.id !== selectedActivityId)
      .map((a) => ({ id: a.id, points: getParsedActivity(a).points, color: colors.get(a.id) })),
    (id) => selectActivity(id, { fit: null }),
  );

  if (trackData) drawTrack(trackData.points, currentMetric, colors.get(selectedActivityId));
  else setMapEmpty(true);

  if (fit === 'all') fitToPoints(visible.map((a) => getParsedActivity(a).points));
  else if (fit === 'selected' && trackData) fitToPoints([trackData.points]);
}

// ── Select a trace ────────────────────────────────
function selectActivity(id, { fit = 'selected' } = {}) {
  const activity = loadActivities().find((a) => a.id === id);
  if (!activity) return;

  try {
    const parsed = getParsedActivity(activity);
    if (parsed.points.length < 2) {
      showToast('Trace vide ou invalide');
      return;
    }

    const stats = calcStats(parsed.points); // renseigne aussi _cumDist / _speed
    trackData = { ...parsed, stats, climbs: calcClimbs(parsed.points) };
    selectedActivityId = id;

    updateStats(stats, activity.name, activity.date ? new Date(activity.date) : parsed.date);
    updateMapOverlay(stats);
    renderMap({ fit });
    redrawAllCharts();
    highlightSidebarItem(id);
  } catch (e) {
    console.error('GPX Error:', e);
    showToast('Erreur lors de la lecture de la trace');
  }
}

// ── Refresh list + map (données, filtre ou mode de stockage changés) ──
function refreshActivities({ selectId = null, fit = 'all' } = {}) {
  renderSidebar();
  const visible = getVisibleActivities();

  if (visible.length === 0) {
    trackData = null;
    selectedActivityId = null;
    clearTrackLayers();
    setMapEmpty(true);
    document.getElementById('mapOverlayStats').hidden = true;
    setHeroVisible(loadActivities().length === 0);
    return;
  }

  setHeroVisible(false);
  const keepId = [selectId, selectedActivityId].find(
    (id) => id && visible.some((a) => a.id === id),
  );
  selectActivity(keepId || visible[0].id, { fit });
}

// ── Import a new GPX file (save + select) ─────────
async function importGPX(xmlString, filename) {
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
    const id = await saveActivity(finalName, parsed.date, actType, stats, xmlString, filename);
    showToast(
      isServerMode()
        ? `Trace enregistrée sur le serveur : ${finalName}`
        : `Trace sauvegardée : ${finalName}`,
    );

    sidebarFilter = 'all'; // la nouvelle trace doit être visible
    refreshActivities({ selectId: id, fit: 'selected' });
  } catch (e) {
    console.error('GPX Error:', e);
    if (e.status === 401) updateAuthUI(); // session expirée → mode local
    showToast(e.status ? e.message : "Erreur lors de l'import GPX");
  }
}

// ── Redraw all charts helper ──────────────────────
function redrawAllCharts() {
  if (!trackData) return;
  const elevData = subsample(trackData.points.map((p) => p.ele));
  drawChart('elevChart', elevData, '#f97316', '#f97316', 'elev');
  const speedData = subsample(trackData.points.map((p) => p._speed ?? 0));
  drawChart('speedChart', speedData, '#60a5fa', '#60a5fa', 'speed');
  const gradeData = subsample(trackData.points.map((p) => p._grade ?? 0));
  drawChart('gradeChart', gradeData, '#c084fc', '#c084fc', 'grade');
  updateClimbStats(trackData.climbs);
  if (trackData.stats.hasHR) {
    const hrData = subsample(trackData.points.map((p) => p.hr ?? 0));
    drawChart('hrChart', hrData, '#ef4444', '#ef4444', 'hr');
  } else {
    clearChart('hrChart', 'hr');
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
}

// ── Load demo GPX file ────────────────────────────
async function loadDemoFile() {
  try {
    const res = await fetch('data/vtt.gpx');
    if (!res.ok) throw new Error('not found');
    const txt = await res.text();
    importGPX(txt, 'vtt.gpx');
  } catch (e) {
    console.error('Demo file error:', e);
    showToast('Fichier démo introuvable (data/vtt.gpx)');
  }
}

// ── Overlays position (plein écran : au-dessus des graphiques) ──
function repositionOverlays() {
  const panel = document.querySelector('.panel--map');
  const overlay = document.getElementById('mapOverlayStats');
  const traces = document.getElementById('tracesPanel');
  const chartsRow = document.getElementById('chartsRow');
  if (!panel || !overlay || !traces || !chartsRow) return;

  if (panel.classList.contains('fullscreen')) {
    const top = panel.querySelector('.panel__header').offsetHeight + 12;
    const bottom = chartsRow.offsetHeight + 12;
    overlay.style.bottom = bottom + 'px';
    traces.style.top = top + 'px';
    traces.style.maxHeight = `calc(100% - ${top + bottom}px)`;
  } else {
    overlay.style.bottom = '';
    traces.style.top = '';
    traces.style.maxHeight = '';
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
      repositionOverlays();
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
      Object.keys(btns).forEach((b) => document.getElementById(b).classList.remove('active'));
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
      if (trackData) renderMap();
    });
  });
}

function bindDemoButtons() {
  document
    .getElementById('btnDemo')
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

// ── Traces panel (repliable) ──────────────────────
function setTracesPanelOpen(open) {
  document.getElementById('tracesPanel').classList.toggle('is-collapsed', !open);
  document.getElementById('tracesToggle').setAttribute('aria-expanded', String(open));
}

function bindTracesPanel() {
  // Replié par défaut sur mobile pour laisser la carte visible
  setTracesPanelOpen(!MOBILE_QUERY.matches);
  document.getElementById('tracesToggle').addEventListener('click', () => {
    setTracesPanelOpen(document.getElementById('tracesPanel').classList.contains('is-collapsed'));
  });
}

// ── Charts carousel dots (petit écran) ────────────
function bindChartsCarousel() {
  const row = document.getElementById('chartsRow');
  const dots = document.getElementById('chartsDots');
  const cards = [...row.children];

  dots.innerHTML = cards
    .map((card, i) => {
      const name = card.querySelector('.panel__name')?.textContent ?? `Graphique ${i + 1}`;
      return `<button type="button" class="charts-dots__dot" aria-label="${escapeHtml(name)}"></button>`;
    })
    .join('');
  const dotEls = [...dots.children];

  const updateActiveDot = () => {
    let active = 0;
    cards.forEach((card, i) => {
      if (Math.abs(card.offsetLeft - row.scrollLeft) < Math.abs(cards[active].offsetLeft - row.scrollLeft)) {
        active = i;
      }
    });
    dotEls.forEach((dot, i) => dot.classList.toggle('active', i === active));
  };

  dotEls.forEach((dot, i) => {
    dot.addEventListener('click', () => row.scrollTo({ left: cards[i].offsetLeft, behavior: 'smooth' }));
  });
  row.addEventListener('scroll', updateActiveDot, { passive: true });
  updateActiveDot();
}

// ── Theme toggle ──────────────────────────────────
function bindThemeToggle() {
  document
    .querySelectorAll('.js-theme-toggle')
    .forEach((btn) => btn.addEventListener('click', toggleTheme));
  // Les graphiques canvas relisent les couleurs du thème
  document.addEventListener('themechange', () => redrawAllCharts());
}

// ── Auth (connexion propriétaire) ─────────────────
function refreshStorageMode(message) {
  sidebarFilter = 'all';
  selectedActivityId = null;
  updateAuthUI();
  refreshActivities({ fit: 'all' });
  showToast(message);
}

function bindAuth() {
  const dialog = document.getElementById('authDialog');
  const form = document.getElementById('authForm');
  const errorEl = document.getElementById('authError');
  const submitBtn = document.getElementById('authSubmit');

  document.querySelectorAll('.js-auth-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!isServerMode()) {
        form.reset();
        errorEl.hidden = true;
        dialog.showModal();
        return;
      }
      if (!confirm(`Connecté en tant que ${authEmail}.\nSe déconnecter ?`)) return;
      await logout();
      refreshStorageMode('Déconnecté — traces du navigateur');
    });
  });

  document
    .getElementById('authCancel')
    .addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;
    try {
      await login(form.email.value, form.password.value);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      return;
    } finally {
      submitBtn.disabled = false;
    }

    form.reset();
    dialog.close();

    // Proposer de copier les traces du navigateur sur le serveur
    const localCount = loadLocalActivities().length;
    if (
      localCount > 0 &&
      confirm(`Copier tes ${localCount} trace(s) du navigateur sur le serveur ?`)
    ) {
      try {
        await uploadLocalActivities();
      } catch (err) {
        showToast(`Copie interrompue : ${err.message}`);
      }
    }
    refreshStorageMode('Connecté — traces du serveur');
  });
}

// ── Resize ────────────────────────────────────────
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (map) map.invalidateSize();
    redrawAllCharts();
    repositionOverlays();
  }, 200);
});

// ── Boot ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initMap();
  bindFileInputs();
  bindLayerButtons();
  bindMetricButtons();
  bindDemoButtons();
  bindFullscreenButton();
  setupImportButton();
  bindTracesPanel();
  bindChartsCarousel();
  bindThemeToggle();
  bindAuth();
  initChartHover();

  // Session serveur active ? (sinon mode local)
  await initAuth();
  updateAuthUI();
  refreshActivities({ fit: 'all' });
});
