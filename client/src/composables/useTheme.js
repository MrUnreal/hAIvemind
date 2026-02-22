/**
 * Theme composable — Phase 9.0
 *
 * Manages dark/light theme toggle with localStorage persistence
 * and OS preference auto-detection via prefers-color-scheme.
 */

import { ref, watchEffect, onMounted } from 'vue';

const STORAGE_KEY = 'haivemind-theme';

/** @type {'dark'|'light'} */
const theme = ref('dark');

/** Whether theme has been initialized */
let initialized = false;

/**
 * Detect OS color scheme preference.
 * @returns {'dark'|'light'}
 */
function detectOSTheme() {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * Apply theme class to document root.
 * @param {'dark'|'light'} t
 */
function applyTheme(t) {
  const root = document.documentElement;
  root.classList.toggle('light-theme', t === 'light');
  root.classList.toggle('dark-theme', t === 'dark');
}

/**
 * Theme composable — provides reactive theme state and toggle.
 */
export function useTheme() {
  if (!initialized) {
    initialized = true;

    // Load saved preference or auto-detect
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      theme.value = saved;
    } else {
      theme.value = detectOSTheme();
    }

    // Watch for changes and apply
    watchEffect(() => {
      applyTheme(theme.value);
      localStorage.setItem(STORAGE_KEY, theme.value);
    });

    // Listen for OS theme changes (when no explicit preference saved)
    if (typeof window !== 'undefined') {
      window.matchMedia?.('(prefers-color-scheme: light)').addEventListener('change', (e) => {
        if (!localStorage.getItem(STORAGE_KEY)) {
          theme.value = e.matches ? 'light' : 'dark';
        }
      });
    }
  }

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
  }

  function setTheme(/** @type {'dark'|'light'} */ t) {
    theme.value = t;
  }

  const isDark = ref(true);
  watchEffect(() => { isDark.value = theme.value === 'dark'; });

  return {
    theme,
    isDark,
    toggleTheme,
    setTheme,
  };
}
