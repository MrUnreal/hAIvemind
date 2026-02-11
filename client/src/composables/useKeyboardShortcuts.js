import { ref, onMounted, onUnmounted } from 'vue';

/**
 * Global keyboard shortcuts composable.
 *
 * All shortcuts are suppressed when focus is in an input, textarea, or [contenteditable].
 * The help dialog is opened with `?` and closed with `Escape`.
 */

export const shortcutsHelpOpen = ref(false);

/** @type {Array<{key: string, label: string, description: string, group: string, action: () => void, ctrlKey?: boolean, metaKey?: boolean}>} */
const shortcuts = ref([]);

/**
 * Register all shortcuts. Call once from App.vue setup.
 * @param {Array<{key: string, label: string, description: string, group: string, action: () => void, ctrlKey?: boolean, metaKey?: boolean}>} defs
 */
export function registerShortcuts(defs) {
  shortcuts.value = defs;
}

/** Read-only access to registered shortcuts for the help dialog */
export function getShortcuts() {
  return shortcuts.value;
}

export function openShortcutsHelp() {
  shortcutsHelpOpen.value = true;
}

export function closeShortcutsHelp() {
  shortcutsHelpOpen.value = false;
}

/**
 * Returns true if the active element is an input / textarea / editable,
 * meaning single-key shortcuts should be suppressed.
 */
function isTyping() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * Install global keydown listener. Returns cleanup function.
 */
export function installShortcutListener() {
  function handler(e) {
    // ? → help dialog (shift+/ on most keyboards, or literal ?)
    if (e.key === '?' && !isTyping()) {
      e.preventDefault();
      shortcutsHelpOpen.value = !shortcutsHelpOpen.value;
      return;
    }

    // Escape closes any open overlay
    if (e.key === 'Escape') {
      if (shortcutsHelpOpen.value) {
        shortcutsHelpOpen.value = false;
        return;
      }
      // Don't prevent default — let other components (CommandPalette) handle too
    }

    // Match registered shortcuts
    for (const s of shortcuts.value) {
      const needCtrl = s.ctrlKey || s.metaKey || false;

      if (needCtrl) {
        // Ctrl/Cmd shortcuts work even when typing
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === s.key.toLowerCase()) {
          e.preventDefault();
          s.action();
          return;
        }
      } else {
        // Single-key shortcuts suppressed when typing.
        // Match on e.key directly — don't restrict shiftKey since keys like
        // ? [ ] naturally require Shift on many keyboard layouts.
        if (!isTyping() && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === s.key) {
          e.preventDefault();
          s.action();
          return;
        }
      }
    }
  }

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
