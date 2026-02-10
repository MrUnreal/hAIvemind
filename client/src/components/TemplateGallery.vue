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
        <span class="template-stack">{{ tpl.stack }}</span>
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
    const res = await fetch('/api/templates');
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
  padding: 8px 12px;
  background: #111118;
  border: 1px solid #333;
  border-radius: 8px;
  color: #aaa;
  font-size: 13px;
  font-weight: 500;
  user-select: none;
  transition: border-color 0.2s;
}
.template-header:hover {
  border-color: #f5c542;
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
  padding: 12px;
  background: #111118;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.template-card:hover {
  border-color: #555;
}
.template-card.active {
  border-color: #f5c542;
  background: #1a1a22;
}

.template-name {
  font-size: 14px;
  font-weight: 600;
  color: #e0e0e0;
  margin-bottom: 4px;
}
.template-desc {
  font-size: 12px;
  color: #888;
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
