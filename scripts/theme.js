/* ════════════════════════════════════════════════
   GPXtooth — theme.js
   Thème clair / sombre (chargé dans <head> pour
   appliquer le thème avant l'affichage, sans flash)
   ════════════════════════════════════════════════ */

'use strict';

const THEME_KEY = 'gpxtooth_theme';

// ── Apply saved theme (or system preference) ─────
(function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch (e) {
    // localStorage indisponible (navigation privée…)
  }
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  document.documentElement.dataset.theme = saved || (prefersLight ? 'light' : 'dark');
})();

// ── Toggle ───────────────────────────────────────
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (e) {
    // Thème non mémorisé, mais appliqué
  }
  document.dispatchEvent(new CustomEvent('themechange', { detail: next }));
}
