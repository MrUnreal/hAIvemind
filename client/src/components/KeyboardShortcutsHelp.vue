<template>
  <Teleport to="body">
    <Transition name="shortcuts-fade">
      <div v-if="shortcutsHelpOpen" class="shortcuts-overlay" @click.self="closeShortcutsHelp">
        <div class="shortcuts-dialog" @keydown.esc="closeShortcutsHelp">
          <div class="shortcuts-header">
            <h2>Keyboard Shortcuts</h2>
            <button class="shortcuts-close" @click="closeShortcutsHelp">✕</button>
          </div>
          <div class="shortcuts-body">
            <div v-for="group in groupedShortcuts" :key="group.name" class="shortcut-group">
              <h3 class="group-label">{{ group.name }}</h3>
              <div v-for="s in group.items" :key="s.label" class="shortcut-row">
                <span class="shortcut-desc">{{ s.description }}</span>
                <kbd class="shortcut-key">{{ s.label }}</kbd>
              </div>
            </div>
          </div>
          <div class="shortcuts-footer">
            Press <kbd>?</kbd> to toggle this dialog
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed } from 'vue';
import { shortcutsHelpOpen, closeShortcutsHelp, getShortcuts } from '../composables/useKeyboardShortcuts.js';

const groupedShortcuts = computed(() => {
  const all = [
    // Static entries that are always shown
    { label: '?', description: 'Show keyboard shortcuts', group: 'General' },
    { label: 'Esc', description: 'Close dialog / go back', group: 'General' },
    { label: 'Ctrl+K', description: 'Open command palette', group: 'General' },
    // Dynamic entries from registered shortcuts
    ...getShortcuts().map(s => ({
      label: s.label,
      description: s.description,
      group: s.group,
    })),
  ];

  const groups = new Map();
  for (const s of all) {
    const g = s.group || 'Other';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(s);
  }
  return Array.from(groups.entries()).map(([name, items]) => ({ name, items }));
});
</script>

<style scoped>
.shortcuts-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.shortcuts-dialog {
  background: #1a1a2e;
  border: 1px solid #2a2a4a;
  border-radius: 12px;
  width: 480px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.shortcuts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #2a2a4a;
}

.shortcuts-header h2 {
  font-size: 16px;
  font-weight: 600;
  color: #e0e0e0;
  margin: 0;
}

.shortcuts-close {
  background: none;
  border: none;
  color: #888;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}
.shortcuts-close:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.shortcuts-body {
  padding: 12px 20px;
  overflow-y: auto;
  flex: 1;
}

.shortcut-group {
  margin-bottom: 16px;
}
.shortcut-group:last-child {
  margin-bottom: 4px;
}

.group-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #f5c542;
  margin: 0 0 8px 0;
}

.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
}

.shortcut-desc {
  font-size: 13px;
  color: #ccc;
}

.shortcut-key {
  display: inline-block;
  padding: 3px 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: #e0e0e0;
  background: #252540;
  border: 1px solid #3a3a5a;
  border-radius: 4px;
  min-width: 28px;
  text-align: center;
}

.shortcuts-footer {
  padding: 12px 20px;
  border-top: 1px solid #2a2a4a;
  text-align: center;
  font-size: 12px;
  color: #888;
}

.shortcuts-footer kbd {
  display: inline-block;
  padding: 1px 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: #e0e0e0;
  background: #252540;
  border: 1px solid #3a3a5a;
  border-radius: 3px;
  margin: 0 2px;
}

/* Transition */
.shortcuts-fade-enter-active,
.shortcuts-fade-leave-active {
  transition: opacity 0.15s ease;
}
.shortcuts-fade-enter-active .shortcuts-dialog,
.shortcuts-fade-leave-active .shortcuts-dialog {
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.shortcuts-fade-enter-from,
.shortcuts-fade-leave-to {
  opacity: 0;
}
.shortcuts-fade-enter-from .shortcuts-dialog {
  transform: scale(0.95);
}
.shortcuts-fade-leave-to .shortcuts-dialog {
  transform: scale(0.95);
}
</style>
