import { ref, computed } from 'vue';

/**
 * Command palette state & registry.
 * Ctrl+K opens it; typing filters commands; Enter/click executes.
 */

export const paletteOpen = ref(false);
export const paletteQuery = ref('');

/** @type {import('vue').Ref<Array<{id: string, label: string, hint?: string, icon?: string, section?: string, action: () => void}>>} */
const commands = ref([]);

export const filteredCommands = computed(() => {
  const q = paletteQuery.value.trim().toLowerCase();
  const all = commands.value;
  if (!q) return all;
  return all.filter(c =>
    c.label.toLowerCase().includes(q) ||
    (c.hint && c.hint.toLowerCase().includes(q)) ||
    (c.section && c.section.toLowerCase().includes(q))
  );
});

/**
 * Register commands (replaces all). Call whenever navigation context changes.
 * @param {Array<{id: string, label: string, hint?: string, icon?: string, section?: string, action: () => void}>} cmds
 */
export function setCommands(cmds) {
  commands.value = cmds;
}

export function openPalette() {
  paletteQuery.value = '';
  paletteOpen.value = true;
}

export function closePalette() {
  paletteOpen.value = false;
  paletteQuery.value = '';
}

export function togglePalette() {
  if (paletteOpen.value) closePalette();
  else openPalette();
}
