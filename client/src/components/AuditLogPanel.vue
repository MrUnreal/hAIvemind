<template>
  <div v-if="visible" class="audit-panel">
    <div class="audit-header">
      <h3>📜 Audit Log</h3>
      <button class="audit-close-btn" @click="$emit('close')">✕</button>
    </div>

    <!-- Filters -->
    <div class="audit-filters">
      <select v-model="filterAction" class="audit-input audit-select" @change="fetchLog">
        <option value="">All actions</option>
        <option v-for="a in actions" :key="a" :value="a">{{ a }}</option>
      </select>
      <select v-model="filterActor" class="audit-input audit-select" @change="fetchLog">
        <option value="">All actors</option>
        <option v-for="a in actors" :key="a" :value="a">{{ a }}</option>
      </select>
      <button class="audit-btn audit-clear-btn" @click="clearLog">Clear All</button>
    </div>

    <!-- Entries -->
    <div v-if="entries.length === 0" class="audit-empty">
      No audit entries{{ filterAction || filterActor ? ' matching filters' : '' }}.
    </div>

    <div v-for="entry in entries" :key="entry.id" class="audit-entry">
      <div class="audit-entry-header">
        <span class="audit-action-badge" :class="actionClass(entry.action)">
          {{ actionIcon(entry.action) }} {{ entry.action }}
        </span>
        <span class="audit-actor">{{ entry.actor }}</span>
        <span class="audit-time" :title="new Date(entry.timestamp).toISOString()">
          {{ timeAgo(entry.timestamp) }}
        </span>
      </div>
      <div v-if="Object.keys(entry.details || {}).length" class="audit-details">
        <code>{{ JSON.stringify(entry.details, null, 0) }}</code>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="total > entries.length || offset > 0" class="audit-pagination">
      <button class="audit-btn" :disabled="offset === 0" @click="prevPage">← Prev</button>
      <span class="audit-page-info">{{ offset + 1 }}–{{ offset + entries.length }} of {{ total }}</span>
      <button class="audit-btn" :disabled="offset + entries.length >= total" @click="nextPage">Next →</button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  visible: Boolean,
  projectSlug: String,
});
const emit = defineEmits(['close']);

const PAGE_SIZE = 30;
const entries = ref([]);
const total = ref(0);
const offset = ref(0);
const actors = ref([]);
const filterAction = ref('');
const filterActor = ref('');

const actions = [
  'session.start', 'session.complete', 'session.fail',
  'settings.update', 'project.create', 'project.delete',
  'key.add', 'key.remove', 'key.rotate',
  'template.create', 'template.delete', 'template.use',
  'webhook.create', 'webhook.delete', 'webhook.toggle',
  'schedule.create', 'schedule.delete',
  'autopilot.start', 'autopilot.stop',
  'plugin.install', 'plugin.remove',
  'custom',
];

watch(() => props.projectSlug, () => { offset.value = 0; fetchLog(); fetchActors(); }, { immediate: true });
watch(() => props.visible, (v) => { if (v) { fetchLog(); fetchActors(); } });

async function fetchLog() {
  if (!props.projectSlug) return;
  try {
    const params = new URLSearchParams();
    params.set('limit', PAGE_SIZE);
    params.set('offset', offset.value);
    if (filterAction.value) params.set('action', filterAction.value);
    if (filterActor.value) params.set('actor', filterActor.value);
    const res = await fetch(`/api/projects/${props.projectSlug}/audit-log?${params}`);
    if (res.ok) {
      const data = await res.json();
      entries.value = data.entries;
      total.value = data.total;
    }
  } catch { /* ignore */ }
}

async function fetchActors() {
  if (!props.projectSlug) return;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/audit-log/actors`);
    if (res.ok) actors.value = await res.json();
  } catch { /* ignore */ }
}

async function clearLog() {
  if (!props.projectSlug) return;
  await fetch(`/api/projects/${props.projectSlug}/audit-log`, { method: 'DELETE' });
  offset.value = 0;
  await fetchLog();
}

function prevPage() {
  offset.value = Math.max(0, offset.value - PAGE_SIZE);
  fetchLog();
}

function nextPage() {
  offset.value += PAGE_SIZE;
  fetchLog();
}

function actionIcon(action) {
  const icons = {
    'session.start': '▶',
    'session.complete': '✅',
    'session.fail': '❌',
    'settings.update': '⚙️',
    'key.add': '🔑',
    'key.remove': '🗑️',
    'key.rotate': '🔄',
    'template.create': '📋',
    'template.use': '🚀',
    'autopilot.start': '🤖',
    'autopilot.stop': '⏹️',
  };
  return icons[action] || '📝';
}

function actionClass(action) {
  if (action.includes('fail') || action.includes('delete') || action.includes('remove')) return 'danger';
  if (action.includes('complete') || action.includes('create') || action.includes('add')) return 'success';
  return 'neutral';
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
</script>

<style scoped>
.audit-panel {
  padding: 1rem;
  max-height: 100%;
  overflow-y: auto;
}
.audit-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}
.audit-header h3 {
  color: var(--text-primary);
  margin: 0;
  font-size: 1rem;
}
.audit-close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 1rem;
}
.audit-filters {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.audit-input {
  background: var(--bg-input);
  border: 1px solid var(--border-input);
  border-radius: 6px;
  color: var(--text-primary);
  padding: 0.35rem 0.5rem;
  font-size: 0.8rem;
}
.audit-select {
  flex: 1;
  max-width: 180px;
}
.audit-btn {
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  color: var(--btn-text);
  border-radius: 6px;
  padding: 0.35rem 0.6rem;
  cursor: pointer;
  font-size: 0.8rem;
  white-space: nowrap;
}
.audit-btn:hover {
  background: var(--btn-hover-bg);
}
.audit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.audit-clear-btn {
  color: var(--accent-red);
  border-color: var(--accent-red-dim);
  margin-left: auto;
}
.audit-empty {
  text-align: center;
  color: var(--text-muted);
  padding: 2rem;
  font-size: 0.85rem;
}
.audit-entry {
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.4rem;
}
.audit-entry-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.audit-action-badge {
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-weight: 600;
}
.audit-action-badge.success {
  background: var(--accent-green-dim);
  color: var(--accent-green);
}
.audit-action-badge.danger {
  background: var(--accent-red-dim);
  color: var(--accent-red);
}
.audit-action-badge.neutral {
  background: var(--accent-blue-dim);
  color: var(--accent-blue);
}
.audit-actor {
  color: var(--text-secondary);
  font-size: 0.75rem;
}
.audit-time {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 0.7rem;
}
.audit-details {
  margin-top: 0.3rem;
}
.audit-details code {
  font-size: 0.7rem;
  color: var(--text-tertiary);
  background: var(--bg-input);
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  word-break: break-all;
  display: block;
}
.audit-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-subtle);
}
.audit-page-info {
  color: var(--text-muted);
  font-size: 0.75rem;
}
</style>
