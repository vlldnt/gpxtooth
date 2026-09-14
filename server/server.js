/* ════════════════════════════════════════════════
   GPXtooth — server/server.js
   API minimale (Node, sans dépendance) :
   connexion du propriétaire + stockage des traces
   ════════════════════════════════════════════════ */

'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

// ── Config (variables d'environnement, voir .env.example) ──
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data';
const DATA_FILE = path.join(DATA_DIR, 'activities.json');
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const COOKIE_SECURE = process.env.COOKIE_SECURE !== 'false';

const COOKIE_NAME = 'gpxtooth_session';
const SESSION_TTL_S = 7 * 24 * 3600; // 7 jours
const MAX_BODY_BYTES = 20 * 1024 * 1024; // 20 Mo
const LOGIN_MAX_FAILS = 5; // tentatives ratées…
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // …par IP sur 15 min
const ACTIVITY_TYPES = new Set(['vtt', 'running', 'hiking', 'cycling', 'other']);

if (!ADMIN_EMAIL || !/^[0-9a-f]+:[0-9a-f]+$/.test(ADMIN_PASSWORD_HASH) || SESSION_SECRET.length < 32) {
  console.error(
    'Config invalide : ADMIN_EMAIL, ADMIN_PASSWORD_HASH (node hash-password.js) et SESSION_SECRET (≥ 32 caractères) sont requis',
  );
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

// Comparaison en temps constant (évite les attaques temporelles)
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) {
      req.resume();
      return reject(httpError(415, 'JSON attendu'));
    }
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return reject(httpError(413, 'Fichier trop volumineux (20 Mo max)'));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(httpError(400, 'JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

// ── Password (scrypt, format "saltHex:hashHex") ──
async function verifyPassword(password) {
  const [saltHex, hashHex] = ADMIN_PASSWORD_HASH.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// ── Session (jeton signé HMAC : "expiration.signature") ──
// Changer SESSION_SECRET invalide toutes les sessions existantes.
function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function createSessionToken() {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_TTL_S);
  return `${exp}.${sign(exp)}`;
}

function isValidSession(token) {
  const [exp, sig] = (token || '').split('.');
  if (!exp || !sig) return false;
  return safeEqual(sig, sign(exp)) && Number(exp) > Date.now() / 1000;
}

// Pas d'attribut Path : le cookie est limité au dossier /…/api de la requête
function sessionCookie(value, maxAge) {
  return [
    `${COOKIE_NAME}=${value}`,
    'HttpOnly', // inaccessible au JavaScript de la page
    'SameSite=Strict', // jamais envoyé depuis un autre site (CSRF)
    `Max-Age=${maxAge}`,
    COOKIE_SECURE && 'Secure', // HTTPS uniquement
  ]
    .filter(Boolean)
    .join('; ');
}

function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

// ── Login rate limiting (par IP) ─────────────────
const loginFails = new Map(); // ip → { count, resetAt }

// nginx ajoute l'IP du proxy en fin de X-Forwarded-For : l'entrée précédente est
// celle vue par le reverse proxy du VPS (les entrées envoyées par le client sont avant).
function clientIp(req) {
  const chain = (req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (chain.length >= 2) return chain[chain.length - 2];
  return chain[0] || req.socket.remoteAddress;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginFails) if (entry.resetAt <= now) loginFails.delete(ip);
}, LOGIN_WINDOW_MS).unref();

async function handleLogin(req, res) {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = loginFails.get(ip);

  if (entry && entry.resetAt > now && entry.count >= LOGIN_MAX_FAILS) {
    res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
    return send(res, 429, { error: 'Trop de tentatives, réessaie dans quelques minutes' });
  }

  const { email, password } = await readJson(req);
  const emailOk = typeof email === 'string' && safeEqual(email.trim().toLowerCase(), ADMIN_EMAIL);
  // Le hash est toujours vérifié, même si l'email est faux (temps de réponse identique)
  const passwordOk =
    typeof password === 'string' && password.length <= 1024 && (await verifyPassword(password));

  if (!emailOk || !passwordOk) {
    const fails = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    fails.count++;
    loginFails.set(ip, fails);
    return send(res, 401, { error: 'Email ou mot de passe incorrect' });
  }

  loginFails.delete(ip);
  res.setHeader('Set-Cookie', sessionCookie(createSessionToken(), SESSION_TTL_S));
  send(res, 200, { email: ADMIN_EMAIL });
}

// ── Storage (fichier JSON, écritures sérialisées) ──
let writeQueue = Promise.resolve();

async function readActivities() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

function updateActivities(mutate) {
  const run = writeQueue.then(async () => {
    const activities = await readActivities();
    const result = mutate(activities);
    const tmp = `${DATA_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(activities));
    await fs.rename(tmp, DATA_FILE); // remplacement atomique
    return result;
  });
  writeQueue = run.catch(() => {});
  return run;
}

function validateActivity(body) {
  const isStr = (v, max) => typeof v === 'string' && v.length <= max;
  if (!body || typeof body !== 'object') throw httpError(400, 'Trace invalide');
  if (!isStr(body.name, 200) || !body.name.trim()) throw httpError(400, 'Nom de trace invalide');
  if (!isStr(body.gpxContent, MAX_BODY_BYTES) || !body.gpxContent.includes('<gpx')) {
    throw httpError(400, 'Contenu GPX invalide');
  }
  if (body.date != null && (!isStr(body.date, 40) || Number.isNaN(Date.parse(body.date)))) {
    throw httpError(400, 'Date invalide');
  }
  if (!body.stats || typeof body.stats !== 'object' || JSON.stringify(body.stats).length > 10000) {
    throw httpError(400, 'Statistiques invalides');
  }

  return {
    id: crypto.randomUUID(),
    name: body.name.trim(),
    date: body.date || new Date().toISOString(),
    type: ACTIVITY_TYPES.has(body.type) ? body.type : 'other',
    stats: body.stats,
    gpxContent: body.gpxContent,
    filename: isStr(body.filename, 255) ? body.filename : null,
    savedAt: new Date().toISOString(),
  };
}

// ── Router ───────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${pathname}`;

    if (route === 'GET /api/health') return send(res, 200, { ok: true });
    if (route === 'POST /api/login') return await handleLogin(req, res);
    if (route === 'POST /api/logout') {
      res.setHeader('Set-Cookie', sessionCookie('', 0));
      return send(res, 204);
    }

    // Toutes les autres routes exigent une session valide
    if (!isValidSession(getCookie(req, COOKIE_NAME))) {
      return send(res, 401, { error: 'Session expirée, reconnecte-toi' });
    }

    if (route === 'GET /api/me') return send(res, 200, { email: ADMIN_EMAIL });

    if (route === 'GET /api/activities') return send(res, 200, await readActivities());

    if (route === 'POST /api/activities') {
      const activity = validateActivity(await readJson(req));
      await updateActivities((activities) => activities.unshift(activity));
      const { gpxContent, ...meta } = activity; // inutile de renvoyer le GPX
      return send(res, 201, meta);
    }

    const match = pathname.match(/^\/api\/activities\/([\w-]{1,64})$/);
    if (req.method === 'DELETE' && match) {
      const removed = await updateActivities((activities) => {
        const idx = activities.findIndex((a) => a.id === match[1]);
        if (idx !== -1) activities.splice(idx, 1);
        return idx !== -1;
      });
      return removed ? send(res, 204) : send(res, 404, { error: 'Trace introuvable' });
    }

    send(res, 404, { error: 'Route inconnue' });
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Erreur serveur' : e.message });
  }
});

server.listen(PORT, () => console.log(`GPXtooth API sur le port ${PORT}`));
