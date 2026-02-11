<template>
  <Teleport to="body">
    <Transition name="palette">
      <div v-if="paletteOpen" class="palette-overlay" @click.self="closePalette">
        <div class="palette-container" ref="containerRef">
          <div class="palette-input-row">
            <span class="palette-icon">⌘</span>
            <input
              ref="inputRef"
              v-model="paletteQuery"
              placeholder="Type a command..."
              class="palette-input"
              @keydown.escape="closePalette"
              @keydown.down.prevent="moveDown"
              @keydown.up.prevent="moveUp"
              @keydown.enter.prevent="executeCurrent"
            />
            <kbd class="palette-shortcut">ESC</kbd>
          </div>

          <div class="palette-results" v-if="filteredCommands.length > 0">
            <template v-for="(group, section) in groupedCommands" :key="section">
              <div class="palette-section-label">{{ section }}</div>
              <div
                v-for="(cmd, idx) in group"
                :key="cmd.id"
                :class="['palette-item', { active: flatIndex(section, idx) === activeIndex }]"
                @click="execute(cmd)"
                @mouseenter="activeIndex = flatIndex(section, idx)"
              >
                <span class="item-icon">{{ cmd.icon || '→' }}</span>
                <span class="item-label">{{ cmd.label }}</span>
                <span v-if="cmd.hint" class="item-hint">{{ cmd.hint }}</span>
              </div>
            </template>
          </div>

          <div v-else class="palette-empty">
            No matching commands
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import {
  paletteOpen,
  paletteQuery,
  filteredCommands,
  closePalette,
  togglePalette,
} from '../composables/useCommandPalette.js';

const inputRef = ref(null);
const containerRef = ref(null);
const activeIndex = ref(0);

// Group commands by section
const groupedCommands = computed(() => {
  const groups = {};
  for (const cmd of filteredCommands.value) {
    const section = cmd.section || 'Actions';
    if (!groups[section]) groups[section] = [];
    groups[section].push(cmd);
  }
  return groups;
});

// Flat list for arrow key navigation
const flatList = computed(() => {
  const list = [];
  for (const group of Object.values(groupedCommands.value)) {
    list.push(...group);
  }
  return list;
});

// Convert section+idx to flat index
function flatIndex(section, idx) {
  let offset = 0;
  for (const [key, group] of Object.entries(groupedCommands.value)) {
    if (key === section) return offset + idx;
    offset += group.length;
  }
  return 0;
}

// Reset active index when query changes
watch(paletteQuery, () => {
  activeIndex.value = 0;
});

// Auto-focus input when opened
watch(paletteOpen, async (open) => {
  if (open) {
    activeIndex.value = 0;
    await nextTick();
    inputRef.value?.focus();
  }
});

function moveDown() {
  if (activeIndex.value < flatList.value.length - 1) {
    activeIndex.value++;
    scrollToActive();
  }
}

function moveUp() {
  if (activeIndex.value > 0) {
    activeIndex.value--;
    scrollToActive();
  }
}

function scrollToActive() {
  nextTick(() => {
    const el = containerRef.value?.querySelector('.palette-item.active');
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function executeCurrent() {
  const cmd = flatList.value[activeIndex.value];
  if (cmd) execute(cmd);
}

function execute(cmd) {
  closePalette();
  cmd.action();
}

// Note: Ctrl+K is handled globally by useKeyboardShortcuts.js in App.vue
// No duplicate listener needed here.
</script>

<style scoped>
.palette-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
}

.palette-container {
  width: 540px;
  max-height: 420px;
  background: #111118;
  border: 1px solid #2a2a3e;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 16px 64px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(245, 197, 66, 0.08);
  display: flex;
  flex-direction: column;
}

.palette-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid #1e1e2e;
}

.palette-icon {
  font-size: 16px;
  color: #f5c542;
  flex-shrink: 0;
}

.palette-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: #e0e0e0;
  font-size: 15px;
  font-family: inherit;
}
.palette-input::placeholder {
  color: #444;
}

.palette-shortcut {
  background: #1a1a2e;
  border: 1px solid #2a2a3e;
  border-radius: 5px;
  padding: 2px 7px;
  font-size: 11px;
  color: #555;
  font-family: inherit;
}

.palette-results {
  overflow-y: auto;
  padding: 6px 0;
}

.palette-section-label {
  font-size: 11px;
  font-weight: 600;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 8px 18px 4px;
}

.palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 18px;
  cursor: pointer;
  transition: background 0.1s;
}
.palette-item:hover,
.palette-item.active {
  background: #1a1a2e;
}

.item-icon {
  font-size: 14px;
  width: 22px;
  text-align: center;
  flex-shrink: 0;
}

.item-label {
  flex: 1;
  font-size: 14px;
  color: #e0e0e0;
}

.item-hint {
  font-size: 12px;
  color: #555;
  flex-shrink: 0;
}

.palette-empty {
  padding: 24px 18px;
  text-align: center;
  color: #555;
  font-size: 13px;
}

/* Transition */
.palette-enter-active {
  transition: opacity 0.15s ease;
}
.palette-enter-active .palette-container {
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.palette-leave-active {
  transition: opacity 0.1s ease;
}
.palette-leave-active .palette-container {
  transition: transform 0.1s ease, opacity 0.1s ease;
}
.palette-enter-from {
  opacity: 0;
}
.palette-enter-from .palette-container {
  transform: scale(0.96) translateY(-8px);
  opacity: 0;
}
.palette-leave-to {
  opacity: 0;
}
.palette-leave-to .palette-container {
  transform: scale(0.96) translateY(-8px);
  opacity: 0;
}
</style>
