/* ════════════════════════════════════════════════
   GPXtooth — dev.js
   Lancement local sans Docker :  node dev.js
   - API (server/server.js) avec le .env, traces dans .data/
   - site statique + relais /api/ (même origine, comme nginx en prod)
   ════════════════════════════════════════════════ */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const WEB_PORT = Number(process.env.WEB_PORT) || 8787;
const API_PORT = Number(process.env.API_PORT) || 3787;
const DATA_DIR = process.env.DEV_DATA_DIR || path.join(ROOT, '.data');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.gpx': 'application/gpx+xml',
};

// ── API ──────────────────────────────────────────
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch (e) {
  console.error('.env introuvable : copie .env.example en .env et remplis-le (node server/hash-password.js)');
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });

const api = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: String(API_PORT),
    DATA_DIR,
    COOKIE_SECURE: 'false', // HTTP en local (iPhone sur le Wi-Fi compris)
  },
});
api.on('exit', (code) => {
  console.error(`API arrêtée (code ${code})`);
  process.exit(code ?? 1);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    api.kill();
    process.exit(0);
  });
}

// ── Site + relais /api/ ──────────────────────────
function proxyToApi(req, res) {
  const upstream = http.request(
    { host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'API locale indisponible' }));
  });
  req.pipe(upstream);
}

// Seuls les fichiers du site, comme en prod (COPY du Dockerfile) : ni .env, ni server/, ni .data/
const PUBLIC_FILES = new Set(['index.html', 'style.css', 'manifest.webmanifest']);
const PUBLIC_DIRS = ['scripts', 'assets', 'data'];

function isPublic(relative) {
  const [first, ...rest] = relative.split(path.sep);
  return rest.length ? PUBLIC_DIRS.includes(first) : PUBLIC_FILES.has(first);
}

function serveStatic(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  let relative;
  try {
    relative = path.relative(ROOT, path.join(ROOT, decodeURIComponent(pathname)));
  } catch (e) {
    return send404(res); // encodage invalide
  }
  if (relative.startsWith('..') || relative.split(path.sep).some((part) => part.startsWith('.'))) {
    return send404(res);
  }

  // Page d'accueil pour « / » et les chemins inconnus (comme try_files en prod)
  let file = path.join(ROOT, relative);
  if (!relative || !isPublic(relative) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (relative && !isPublic(relative) && fs.existsSync(file)) return send404(res); // fichier réel non public
    file = path.join(ROOT, 'index.html');
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Introuvable');
}

http
  .createServer((req, res) => (req.url.startsWith('/api/') ? proxyToApi(req, res) : serveStatic(req, res)))
  .listen(WEB_PORT, '0.0.0.0', () => {
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i?.family === 'IPv4' && !i.internal)?.address;
    console.log(`\nGPXtooth en local : http://localhost:${WEB_PORT}`);
    if (lan) console.log(`Sur l'iPhone (même Wi-Fi) : http://${lan}:${WEB_PORT}`);
    console.log('Traces du compte stockées dans .data/ — Ctrl+C pour arrêter\n');
  });
