/* ════════════════════════════════════════════════
   GPXtooth — ui.js
   DOM rendering: stats, overlay, traces panel,
   toast, hero, auth button
   ════════════════════════════════════════════════ */

'use strict';

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

// ── Hero (écran d'accueil en overlay) ─────────────
function setHeroVisible(visible) {
  document.getElementById('hero')?.classList.toggle('hidden', !visible);
}

// ── Render stats (track header) ──────────────────
function updateStats(stats, name, date) {
  const trackName = document.getElementById('trackName');
  if (trackName) trackName.textContent = name;
  const trackDate = document.getElementById('trackDate');
  if (trackDate) {
    trackDate.textContent = date
      ? date.toLocaleDateString('fr-FR', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : '';
  }
}

// ── Map overlay stats ────────────────────────────
function updateMapOverlay(stats) {
  const overlay = document.getElementById('mapOverlayStats');
  const fmt = (v, d = 1) => (v != null ? v.toFixed(d) : '—');
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

// ── Climbs card (nombre de côtes, plus raide) ────
function updateClimbStats(climbs) {
  if (!climbs) return;
  const steepest = climbs.reduce((max, c) => Math.max(max, c.avg), 0);
  document.getElementById('cv-climb-count').textContent = climbs.length;
  document.getElementById('cv-grade-max').textContent = climbs.length
    ? steepest.toFixed(1)
    : '—';
}

// ── Auth button state ────────────────────────────
function updateAuthUI() {
  const connected = isServerMode();
  const label = connected
    ? `Connecté (${authEmail}) — traces sur le serveur. Cliquer pour se déconnecter`
    : 'Connexion';
  document.querySelectorAll('.js-auth-btn').forEach((btn) => {
    btn.classList.toggle('is-connected', connected);
    btn.title = label;
    btn.setAttribute('aria-label', label);
  });
}

// ── Escape text injected via innerHTML ───────────
function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, (c) => map[c]);
}

// ── Traces panel (liste + filtre par type) ───────
let sidebarFilter = 'all';

const TYPE_LABELS = {
  all: 'Toutes',
  vtt: 'VTT',
  running: 'Course',
  hiking: 'Rando',
  cycling: 'Vélo',
  other: 'Autre',
};

function getVisibleActivities() {
  const activities = loadActivities();
  return sidebarFilter === 'all'
    ? activities
    : activities.filter((a) => a.type === sidebarFilter);
}

function renderSidebar() {
  const list = document.getElementById('sidebarList');
  const count = document.getElementById('sidebarCount');
  const filtersEl = document.getElementById('sidebarFilters');
  if (!list || !count || !filtersEl) return;

  const activities = loadActivities();
  const types = [...new Set(activities.map((a) => a.type))];
  if (sidebarFilter !== 'all' && !types.includes(sidebarFilter)) sidebarFilter = 'all';
  count.textContent = activities.length;

  // Filtre simple par type : seulement s'il y a plusieurs types
  filtersEl.hidden = types.length < 2;
  filtersEl.innerHTML = ['all', ...types]
    .map(
      (t) =>
        `<button type="button" class="traces-filter${sidebarFilter === t ? ' active' : ''}" data-type="${escapeHtml(t)}">${escapeHtml(TYPE_LABELS[t] ?? t)}</button>`,
    )
    .join('');
  filtersEl.querySelectorAll('.traces-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      sidebarFilter = btn.dataset.type;
      refreshActivities({ fit: 'all' });
    });
  });

  const visible = getVisibleActivities();
  if (visible.length === 0) {
    list.innerHTML = '<li class="traces-panel__empty">Aucune trace enregistrée</li>';
    return;
  }

  const colors = getActivityColors();
  list.innerHTML = visible
    .map((a) => {
      const dateStr = new Date(a.date).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      const meta = [dateStr];
      if (a.stats?.dist) meta.push(`${a.stats.dist.toFixed(1)} km`);
      if (a.stats?.elevUp) meta.push(`${Math.round(a.stats.elevUp)} m D+`);

      return `
      <li class="trace-item${a.id === selectedActivityId ? ' active' : ''}" data-id="${escapeHtml(a.id)}" style="--trace-color: ${colors.get(a.id)}">
        <button type="button" class="trace-item__btn">
          <span class="trace-item__swatch" aria-hidden="true"></span>
          <span class="trace-item__main">
            <span class="trace-item__name">${escapeHtml(a.name)}</span>
            <span class="trace-item__meta">${escapeHtml(meta.join(' · '))}</span>
          </span>
          <span class="trace-item__type">${escapeHtml(TYPE_LABELS[a.type] ?? a.type)}</span>
        </button>
      </li>`;
    })
    .join('');

  list.querySelectorAll('.trace-item').forEach((item) => {
    const id = item.dataset.id;
    item.addEventListener('click', () => {
      selectActivity(id);
      if (MOBILE_QUERY.matches) setTracesPanelOpen(false);
    });
    // Survol : aperçu opaque de la trace sur la carte
    item.addEventListener('mouseenter', () => previewTrack(id, true));
    item.addEventListener('mouseleave', () => previewTrack(id, false));
  });
}

function highlightSidebarItem(id) {
  const list = document.getElementById('sidebarList');
  if (!list) return;
  list.querySelectorAll('.trace-item').forEach((item) => {
    const active = item.dataset.id === id;
    item.classList.toggle('active', active);
    if (!active) return;
    // Garde l'élément sélectionné visible dans la liste (sans scroller la page)
    if (item.offsetTop < list.scrollTop) {
      list.scrollTop = item.offsetTop;
    } else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  });
}
