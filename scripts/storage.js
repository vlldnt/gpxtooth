/* ════════════════════════════════════════════════
   GPXtooth — storage.js
   Activities CRUD (localStorage, per-browser)
   ════════════════════════════════════════════════ */

'use strict';

// ── Activities CRUD ─────────────────────────────
function loadActivities() {
  const json = localStorage.getItem('gpxtooth_activities');
  return json ? JSON.parse(json) : [];
}

function saveActivities(activities) {
  localStorage.setItem('gpxtooth_activities', JSON.stringify(activities));
}

function saveActivity(name, date, type, stats, gpxContent, filename) {
  const activities = loadActivities();
  activities.unshift({
    id: Date.now().toString(),
    name,
    date: date ? date.toISOString() : new Date().toISOString(),
    type: type || 'other',
    stats,
    gpxContent,
    filename,
    savedAt: new Date().toISOString(),
  });
  saveActivities(activities);
  renderSidebar();
}

function deleteActivity(id) {
  let activities = loadActivities();
  activities = activities.filter((a) => a.id !== id);
  saveActivities(activities);
  renderSidebar();
}
