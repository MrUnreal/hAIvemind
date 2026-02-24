<template>
  <div class="template-gallery" v-if="templates.length">
    <div class="template-header" @click="expanded = !expanded">
      <span class="template-icon">📋</span>
      <span>Templates</span>
      <span class="expand-arrow">{{ expanded ? '▾' : '▸' }}</span>
    </div>

    <div v-if="expanded" class="template-list">
      <div
        v-for="tpl in templates"
        :key="tpl.id"
        class="template-card"
        :class="{ active: selected?.id === tpl.id }"
        @click="select(tpl)"
      >
        <div class="template-name">{{ tpl.name }}</div>
        <div class="template-desc">{{ tpl.description }}</div>
        <span class="template-stack">{{ Array.isArray(tpl.stack) ? tpl.stack.join(' · ') : tpl.stack }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const emit = defineEmits(['select']);
const templates = ref([]);
const expanded = ref(false);
const selected = ref(null);

onMounted(async () => {
  try {
    const res = await fetch('/api/project-templates');
    if (res.ok) templates.value = await res.json();
  } catch { /* ignore */ }
});

function select(tpl) {
  if (selected.value?.id === tpl.id) {
    selected.value = null;
    emit('select', null);
  } else {
    selected.value = tpl;
    emit('select', tpl);
  }
}
</script>

<style scoped>
.template-gallery {
  margin-bottom: 16px;
}

.template-header {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 10px 14px;
  background: var(--bg-primary);
  border: 1px solid var(--bg-card);
  border-radius: 10px;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
  user-select: none;
  transition: border-color 0.2s, color 0.2s;
}
.template-header:hover {
  border-color: #f5c54266;
  color: var(--btn-text);
}

.expand-arrow {
  margin-left: auto;
  font-size: 12px;
}

.template-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.template-card {
  padding: 14px;
  background: var(--bg-primary);
  border: 1px solid var(--bg-card);
  border-radius: 12px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s, transform 0.15s;
}
.template-card:hover {
  border-color: var(--border-secondary);
  transform: translateY(-1px);
}
.template-card.active {
  border-color: #f5c542;
  background: var(--bg-tertiary);
}

.template-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.template-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 8px;
  line-height: 1.4;
}
.template-stack {
  display: inline-block;
  padding: 2px 8px;
  background: #1a2a3a;
  color: #6aacf5;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}
</style>
