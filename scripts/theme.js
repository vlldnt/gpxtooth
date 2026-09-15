/* ════════════════════════════════════════════════
   GPXtooth — theme.js
   Thème clair / sombre (chargé dans <head> pour
   appliquer le thème avant l'affichage, sans flash)
   ════════════════════════════════════════════════ */

'use strict';

const THEME_KEY = 'gpxtooth_theme';
const THEME_COLORS = { dark: '#07080f', light: '#f4f6fb' }; // = --c-bg de chaque thème

// Barre Safari / Android de la couleur du fond : elle se fond dans la page
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

// ── Apply saved theme (or system preference) ─────
(function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch (e) {
    // localStorage indisponible (navigation privée…)
  }
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  applyTheme(saved || (prefersLight ? 'light' : 'dark'));
})();

// ── Toggle ───────────────────────────────────────
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (e) {
    // Thème non mémorisé, mais appliqué
  }
  document.dispatchEvent(new CustomEvent('themechange', { detail: next }));
}
