/* ════════════════════════════════════════════════
   GPXtooth — app.js
   Orchestration: sélection, import, bindings, boot
   ════════════════════════════════════════════════ */

'use strict';

// ── State ────────────────────────────────────────
let trackData = null; // trace sélectionnée : points, stats, côtes
let currentMetric = 'speed';
let selectedActivityId = null;
let heroDismissed = false; // accueil fermé (carte, démo) : ne pas le réafficher
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

// ── Hero : seulement pour un visiteur non connecté, sans trace ──
function updateHero() {
  setHeroVisible(!heroDismissed && !isServerMode() && loadActivities().length === 0);
}

function openMap() {
  heroDismissed = true;
  setHeroVisible(false);
  if (map) map.invalidateSize();
}

// ── Refresh list + map (données, filtre ou mode de stockage changés) ──
function refreshActivities({ selectId = null, fit = 'all' } = {}) {
  renderSidebar();
  updateHero();
  const visible = getVisibleActivities();

  if (visible.length === 0) {
    trackData = null;
    selectedActivityId = null;
    clearTrackLayers();
    setMapEmpty(true);
    document.getElementById('mapOverlayStats').hidden = true;
    // Filtres sans résultat : ne pas laisser l'en-tête et les graphiques de l'ancienne trace
    updateStats(null, 'Carte interactive', null);
    for (const [canvasId, key] of [['hrChart', 'hr'], ['speedChart', 'speed'], ['elevChart', 'elev'], ['gradeChart', 'grade']]) {
      clearChart(canvasId, key);
    }
    updateClimbStats([]);
    return;
  }

  const keepId = [selectId, selectedActivityId].find(
    (id) => id && visible.some((a) => a.id === id),
  );
  selectActivity(keepId || visible[0].id, { fit });
}

// ── Import GPX files (un par un, chaque trace s'affiche dès qu'elle est enregistrée) ──
const MAX_FILE_MB = 10; // le serveur accepte 20 Mo de JSON (GPX échappé compris)

function importError(message) {
  return Object.assign(new Error(message), { status: 422 });
}

// Lit et enregistre un fichier ; renvoie { id, name }, ou null si le nom est annulé
async function saveGPXFile(file, { askName }) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    throw importError(`Fichier trop volumineux (${MAX_FILE_MB} Mo max)`);
  }
  const xmlString = await file.text();
  const parsed = parseGPX(xmlString);
  const stats = calcStats(parsed.points); // null si moins de 2 points
  if (!stats) throw importError('Fichier GPX vide ou invalide');

  const defaultName = file.name.replace(/\.gpx$/i, '') || parsed.name;
  let name = defaultName;
  if (askName) {
    const input = prompt('Nom de la trace :', defaultName);
    if (input === null) return null;
    name = input.trim() || defaultName;
  }

  const actType = parseActivityType(new DOMParser().parseFromString(xmlString, 'application/xml'));
  const id = await saveActivity(name, parsed.date, actType, stats, xmlString, file.name);
  parsedCache.set(id, parsed); // évite de re-parser le fichier à l'affichage
  return { id, name };
}

// Un seul fichier : nom demandé. Plusieurs : noms des fichiers + toast de progression
async function importFiles(files) {
  if (files.length === 0) return;
  const single = files.length === 1;
  const errors = [];
  let last = null;
  let imported = 0;

  resetFilters(); // les nouvelles traces doivent être visibles
  for (const [i, file] of files.entries()) {
    if (!single) showProgressToast(`Import ${i + 1}/${files.length} · ${file.name}`, i / files.length);
    try {
      last = await saveGPXFile(file, { askName: single });
      if (!last) return; // nom annulé
      imported++;
      refreshActivities({ selectId: last.id, fit: single ? 'selected' : 'all' });
    } catch (e) {
      console.error('GPX Error:', file.name, e);
      errors.push({ file: file.name, status: e.status, message: e.status ? e.message : "Erreur lors de l'import GPX" });
      if (e.status === 401 || e.status === 507) break; // session expirée, stockage plein : inutile de continuer
    }
  }

  if (errors.some((e) => e.status === 401)) {
    updateAuthUI(); // session expirée → mode local
    refreshActivities();
  }

  if (single) {
    if (errors.length) showToast(errors[0].message);
    else showToast(isServerMode() ? `Trace enregistrée sur le serveur : ${last.name}` : `Trace sauvegardée : ${last.name}`);
    return;
  }

  showToast(importSummary(imported, errors), { duration: errors.length ? 7000 : 3200 });
}

// « 3 traces importées · 2 échecs : a.gpx, b.gpx »
function importSummary(imported, errors) {
  const s = (n) => (n > 1 ? 's' : '');
  const parts = [`${imported} trace${s(imported)} importée${s(imported)}${isServerMode() ? ' sur le serveur' : ''}`];
  const blocking = errors.find((e) => e.status === 401 || e.status === 507);
  if (blocking) parts.push(blocking.message);
  else if (errors.length) parts.push(`${errors.length} échec${s(errors.length)} : ${errors.map((e) => e.file).join(', ')}`);
  return parts.join(' · ');
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
  document.getElementById('fileInput').addEventListener('change', (e) => {
    importFiles([...e.target.files]); // copie avant de vider l'input
    e.target.value = '';
  });
}

// ── Demo (affichée sans être enregistrée) ─────────
async function loadDemoFile() {
  try {
    const res = await fetch('data/vtt.gpx');
    if (!res.ok) throw new Error('not found');
    showDemo(await res.text());
  } catch (e) {
    console.error('Demo file error:', e);
    showToast('Fichier démo introuvable (data/vtt.gpx)');
  }
}

function showDemo(xmlString) {
  const parsed = parseGPX(xmlString);
  const stats = calcStats(parsed.points);
  if (!stats) return;

  trackData = { ...parsed, stats, climbs: calcClimbs(parsed.points) };
  selectedActivityId = null;

  openMap();
  updateStats(stats, 'Démo — sortie VTT', parsed.date);
  updateMapOverlay(stats);
  renderMap({ fit: 'selected' });
  redrawAllCharts();
  highlightSidebarItem(null);
  showToast('Démo non enregistrée — importe ton fichier GPX pour le garder');
}

// ── Rename a saved trace ──────────────────────────
async function renameTrace(id) {
  const activity = loadActivities().find((a) => a.id === id);
  if (!activity) return;
  const name = prompt('Nouveau nom de la trace :', activity.name)?.trim();
  if (!name || name === activity.name) return;

  try {
    await renameActivity(id, name);
    refreshActivities({ fit: null });
    showToast(`Trace renommée : ${name}`);
  } catch (e) {
    console.error('Rename error:', e);
    if (e.status === 401) updateAuthUI(); // session expirée → mode local
    showToast(e.message || 'Erreur lors du renommage');
  }
}

// ── Delete a saved trace ──────────────────────────
async function removeActivity(id) {
  const activity = loadActivities().find((a) => a.id === id);
  if (!activity || !confirm(`Supprimer la trace « ${activity.name} » ?`)) return;

  try {
    await deleteActivity(id);
    parsedCache.delete(id);
    if (selectedActivityId === id) selectedActivityId = null;
    refreshActivities({ fit: null });
    showToast(`Trace supprimée : ${activity.name}`);
  } catch (e) {
    console.error('Delete error:', e);
    if (e.status === 401) updateAuthUI(); // session expirée → mode local
    showToast(e.message || 'Erreur lors de la suppression');
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
  document.getElementById('btnOpenMap')?.addEventListener('click', openMap);
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
  resetFilters();
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
