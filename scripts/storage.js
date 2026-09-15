/* ════════════════════════════════════════════════
   GPXtooth — storage.js
   Activities CRUD : localStorage (visiteur) ou
   serveur (propriétaire connecté)
   ════════════════════════════════════════════════ */

'use strict';

const LOCAL_KEY = 'gpxtooth_activities';

// ── Auth state ───────────────────────────────────
let authEmail = null; // email du compte connecté, null = mode local
let serverActivities = []; // cache des traces du serveur
let localActivities = null; // cache du localStorage (lu une seule fois)
let serverPrefs = null; // préférences du compte connecté ({ map: { base, overlays } }), null = aucune

function isServerMode() {
  return authEmail !== null;
}

// ── API client ───────────────────────────────────
async function api(path, { method = 'GET', body, timeout } = {}) {
  const res = await fetch('api/' + path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: timeout ? AbortSignal.timeout(timeout) : undefined,
  });
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson && res.status !== 204 ? await res.json() : null; // 204 : corps vide

  // Session expirée : retour en mode local
  if (res.status === 401 && path !== 'login') {
    authEmail = null;
    serverActivities = [];
  }

  if (!res.ok || (res.status !== 204 && !isJson)) {
    const err = new Error(data?.error || (isJson ? `Erreur serveur (${res.status})` : 'Serveur indisponible'));
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── Auth ─────────────────────────────────────────
async function initAuth() {
  try {
    // Délai court : si l'API ne répond pas, le site démarre quand même en mode local
    const me = await api('me', { timeout: 5000 });
    authEmail = me.email;
    serverActivities = await api('activities');
    serverPrefs = await loadServerPrefs();
  } catch (e) {
    authEmail = null;
    serverActivities = [];
    serverPrefs = null;
  }
}

async function login(email, password) {
  const me = await api('login', { method: 'POST', body: { email, password } });
  authEmail = me.email;
  serverActivities = await api('activities');
  serverPrefs = await loadServerPrefs();
}

async function logout() {
  try {
    await api('logout', { method: 'POST' });
  } finally {
    authEmail = null;
    serverActivities = [];
    serverPrefs = null;
  }
}

// ── Préférences du compte (fond de carte…) ───────
// Retrouvées d'un appareil et d'une session à l'autre ; sans compte, seul le navigateur les garde.
async function loadServerPrefs() {
  try {
    return await api('prefs');
  } catch (e) {
    return null; // API sans préférences : pas bloquant
  }
}

function saveServerPrefs(prefs) {
  serverPrefs = prefs;
  if (!isServerMode()) return;
  api('prefs', { method: 'PUT', body: prefs }).catch((e) => console.warn('Préférences non enregistrées :', e.message));
}

// ── Activities CRUD ─────────────────────────────
function loadLocalActivities() {
  if (localActivities === null) {
    try {
      localActivities = JSON.parse(localStorage.getItem(LOCAL_KEY)) || [];
    } catch (e) {
      localActivities = [];
    }
  }
  return localActivities;
}

function loadActivities() {
  return isServerMode() ? serverActivities : loadLocalActivities();
}

// Écrit d'abord : si le quota (~5 Mo) est dépassé, le cache reste cohérent avec le stockage
function saveActivities(activities) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(activities));
  } catch (e) {
    if (e.name !== 'QuotaExceededError') throw e;
    const err = new Error('Stockage du navigateur plein : supprime des traces ou connecte-toi');
    err.status = 507; // Insufficient Storage
    throw err;
  }
  localActivities = activities;
}

// Retourne l'id de la trace enregistrée
async function saveActivity(name, date, type, stats, gpxContent, filename) {
  const activity = {
    name,
    date: date ? date.toISOString() : new Date().toISOString(),
    type: type || 'other',
    stats,
    gpxContent,
    filename,
  };

  if (isServerMode()) {
    const saved = await api('activities', { method: 'POST', body: activity });
    serverActivities.unshift({ ...activity, ...saved });
    return saved.id;
  }

  const id = Date.now().toString();
  saveActivities([
    { id, ...activity, savedAt: new Date().toISOString() },
    ...loadLocalActivities(),
  ]);
  return id;
}

// GPX complet d'une trace du serveur : la liste n'a qu'un aperçu, le fichier est chargé
// à la première sélection puis gardé en mémoire (et en cache navigateur)
async function loadActivityGpx(activity) {
  if (activity.gpxContent) return activity.gpxContent;
  const res = await fetch('api/activities/' + encodeURIComponent(activity.id) + '/gpx', {
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    authEmail = null;
    serverActivities = [];
  }
  if (!res.ok) {
    const err = new Error(res.status === 401 ? 'Session expirée, reconnecte-toi' : 'Trace introuvable sur le serveur');
    err.status = res.status;
    throw err;
  }
  activity.gpxContent = await res.text();
  return activity.gpxContent;
}

async function deleteActivity(id) {
  if (isServerMode()) {
    await api('activities/' + encodeURIComponent(id), { method: 'DELETE' });
    serverActivities = serverActivities.filter((a) => a.id !== id);
  } else {
    saveActivities(loadLocalActivities().filter((a) => a.id !== id));
  }
}

async function renameActivity(id, name) {
  const rename = (activities) => activities.map((a) => (a.id === id ? { ...a, name } : a));
  if (isServerMode()) {
    await api('activities/' + encodeURIComponent(id), { method: 'PATCH', body: { name } });
    serverActivities = rename(serverActivities);
  } else {
    saveActivities(rename(loadLocalActivities()));
  }
}

// Copie les traces du navigateur sur le serveur (après connexion)
async function uploadLocalActivities() {
  const local = loadLocalActivities();
  // De la plus ancienne à la plus récente pour garder l'ordre (récente en tête)
  for (const a of [...local].reverse()) {
    const activity = {
      name: a.name,
      date: a.date,
      type: a.type,
      stats: a.stats,
      gpxContent: a.gpxContent,
      filename: a.filename,
    };
    const saved = await api('activities', { method: 'POST', body: activity });
    serverActivities.unshift({ ...activity, ...saved });
  }
  return local.length;
}
