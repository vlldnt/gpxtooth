/* ════════════════════════════════════════════════
   GPXtooth — ui.js
   DOM rendering: stats, overlay, activities, toast,
   hero, scroll-reveal
   ════════════════════════════════════════════════ */

'use strict';

let heroShown = true;

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

// ── Hide hero ────────────────────────────────────
function hideHero() {
  if (!heroShown) return;
  const hero = document.querySelector('.hero');
  if (hero) {
    hero.classList.add('hidden');
    heroShown = false;
  }
}

// ── Scroll-reveal observer ───────────────────────
function initReveal() {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('revealed');
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12 },
  );

  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}

// ── Render stats (mini cards + track header) ─────
function updateStats(stats, name, date) {
  const fmt = (v, d = 1) => (v != null ? v.toFixed(d) : '—');
  const dur = stats.durationMs;
  const h = Math.floor(dur / 3600000);
  const m = Math.floor((dur % 3600000) / 60000);
  const durStr = dur > 0 ? `${h}h${String(m).padStart(2, '0')}` : '—';

  const miniDist = document.getElementById('mini-dist-val');
  if (miniDist) miniDist.textContent = fmt(stats.dist);
  const miniElev = document.getElementById('mini-elev-val');
  if (miniElev) miniElev.textContent = Math.round(stats.elevUp);
  const miniDur = document.getElementById('mini-dur-val');
  if (miniDur) miniDur.textContent = durStr;
  const miniHR = document.getElementById('mini-hr-val');
  if (miniHR) miniHR.textContent = stats.hrAvg ?? '—';

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

// ── Sidebar trace list ───────────────────────────
let sidebarFilter = 'all';

function renderSidebar(filter) {
  if (filter !== undefined) sidebarFilter = filter;

  const list = document.getElementById('sidebarList');
  const count = document.getElementById('sidebarCount');
  const filtersEl = document.getElementById('sidebarFilters');
  if (!list || !count) return;

  const activities = loadActivities();
  count.textContent = activities.length;

  // Build filter pills from actual types
  if (filtersEl) {
    const types = ['all', ...new Set(activities.map((a) => a.type))];
    filtersEl.innerHTML = types
      .map((t) => {
        const label =
          t === 'all' ? 'Tout' : t.charAt(0).toUpperCase() + t.slice(1);
        return `<button class="sidebar__filter-btn ${sidebarFilter === t ? 'active' : ''}" data-type="${t}">${label}</button>`;
      })
      .join('');

    filtersEl.querySelectorAll('.sidebar__filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const filterType = btn.dataset.type;
        renderSidebar(filterType);
        // Show all traces of the selected type
        const activities = filterType === 'all'
          ? loadActivities()
          : loadActivities().filter((a) => a.type === filterType);
        displayMultipleActivities(activities);
      });
    });
  }

  // Filter
  const filtered =
    sidebarFilter === 'all'
      ? activities
      : activities.filter((a) => a.type === sidebarFilter);

  if (filtered.length === 0) {
    list.innerHTML = '<li class="sidebar__empty">Aucune trace</li>';
    return;
  }

  list.innerHTML = filtered
    .map((a) => {
      const date = new Date(a.date);
      const dateStr = date.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });

      // Allure (min/km) et temps
      let paceStr = '—';
      let durStr = '—';
      if (a.stats) {
        if (a.stats.dist > 0 && a.stats.durationMs > 0) {
          const totalMin = a.stats.durationMs / 60000;
          const paceMin = totalMin / a.stats.dist;
          const pM = Math.floor(paceMin);
          const pS = Math.round((paceMin - pM) * 60);
          paceStr = `${pM}'${String(pS).padStart(2, '0')}`;
        }
        if (a.stats.durationMs > 0) {
          const h = Math.floor(a.stats.durationMs / 3600000);
          const m = Math.floor((a.stats.durationMs % 3600000) / 60000);
          durStr = `${h}h${String(m).padStart(2, '0')}`;
        }
      }

      return `
      <li class="sidebar__item" data-id="${a.id}">
        <div class="sidebar__item-top">
          <span class="sidebar__item-name">${a.name}</span>
          <span class="sidebar__item-type ${a.type}">${a.type}</span>
        </div>
        <div class="sidebar__item-meta">
          <span>${dateStr}</span>
          <span>${paceStr}/km</span>
          <span>${durStr}</span>
        </div>
      </li>`;
    })
    .join('');

  list.querySelectorAll('.sidebar__item').forEach((item) => {
    const id = item.dataset.id;
    const activity = filtered.find((a) => a.id === id);

    item.addEventListener('click', () => {
      // Toggle selection: if clicking the same item, show all; otherwise show only this one
      if (selectedActivityId === id) {
        // Clicking same item again → show all
        selectedActivityId = null;
        const allActivities = sidebarFilter === 'all'
          ? loadActivities()
          : loadActivities().filter((a) => a.type === sidebarFilter);
        displayMultipleActivities(allActivities);
        highlightSidebarItem(null);
      } else {
        // Clicking different item → show only this one
        highlightSidebarItem(id);
        displayGPX(activity.gpxContent, activity.name, id);
      }
    });
  });
}

function highlightSidebarItem(id) {
  const list = document.getElementById('sidebarList');
  if (!list) return;
  list
    .querySelectorAll('.sidebar__item')
    .forEach((i) => i.classList.remove('active'));
  if (id) {
    const item = list.querySelector(`[data-id="${id}"]`);
    if (item) item.classList.add('active');
  } else {
    // Highlight the first item (just imported)
    const first = list.querySelector('.sidebar__item');
    if (first) first.classList.add('active');
  }
}
