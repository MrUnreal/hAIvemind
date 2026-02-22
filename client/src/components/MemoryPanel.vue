<template>
  <div v-if="visible" class="memory-panel">
    <h3>🧠 Agent Memory</h3>

    <!-- Stats Bar -->
    <div class="memory-stats">
      <span class="memory-stat">{{ memStats.total }} memories</span>
      <span class="memory-stat">{{ memStats.totalTags }} tags</span>
      <span class="memory-stat">{{ memStats.totalAccesses }} accesses</span>
    </div>

    <!-- Filters -->
    <div class="memory-filters">
      <select v-model="filterType" class="memory-select" @change="load">
        <option value="">All Types</option>
        <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
      </select>
      <input
        v-model="searchQuery"
        class="memory-search"
        placeholder="Search memories..."
        @input="debouncedLoad"
      />
    </div>

    <!-- Add Form -->
    <div v-if="showForm" class="memory-form">
      <select v-model="form.type" class="memory-select">
        <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
      </select>
      <input v-model="form.key" class="memory-input" placeholder="Key / title" />
      <textarea v-model="form.content" class="memory-textarea" placeholder="Content..." rows="3"></textarea>
      <input v-model="form.tagsStr" class="memory-input" placeholder="Tags (comma separated)" />
      <div class="memory-form-actions">
        <button class="memory-primary-btn" @click="saveMemory">{{ editing ? 'Update' : 'Add' }}</button>
        <button class="memory-secondary-btn" @click="cancelForm">Cancel</button>
      </div>
    </div>
    <button v-else class="memory-add-btn" @click="showForm = true">+ Add Memory</button>

    <!-- Recall Search -->
    <div class="memory-recall">
      <input
        v-model="recallQuery"
        class="memory-search"
        placeholder="Recall relevant memories..."
        @keydown.enter="doRecall"
      />
      <button class="memory-recall-btn" @click="doRecall" :disabled="!recallQuery">🔍</button>
    </div>

    <!-- Memory List -->
    <div v-if="recalled.length" class="memory-recalled">
      <h4>Recalled ({{ recalled.length }})</h4>
      <div v-for="m in recalled" :key="m.id" class="memory-card recalled">
        <div class="memory-card-header">
          <span class="memory-type-badge" :class="m.type">{{ m.type }}</span>
          <strong class="memory-key">{{ m.key || '(no key)' }}</strong>
        </div>
        <p class="memory-content">{{ m.content }}</p>
      </div>
    </div>

    <div v-if="!entries.length && !recalled.length" class="memory-empty">
      No memories stored yet. Add patterns, conventions, or error resolutions.
    </div>

    <div v-for="m in entries" :key="m.id" class="memory-card">
      <div class="memory-card-header">
        <span class="memory-type-badge" :class="m.type">{{ m.type }}</span>
        <strong class="memory-key">{{ m.key || '(no key)' }}</strong>
        <span class="memory-access">{{ m.accessCount }}×</span>
      </div>
      <p class="memory-content">{{ truncate(m.content, 150) }}</p>
      <div v-if="m.tags?.length" class="memory-tags">
        <span v-for="t in m.tags" :key="t" class="memory-tag">{{ t }}</span>
      </div>
      <div class="memory-card-actions">
        <button class="memory-action-btn" @click="startEdit(m)">✏️</button>
        <button class="memory-action-btn" @click="deleteMemory(m.id)">🗑️</button>
      </div>
    </div>

    <!-- Clear Button -->
    <div v-if="entries.length" class="memory-clear-wrap">
      <button class="memory-clear-btn" @click="clearAll">Clear All Memories</button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';

const props = defineProps({
  visible: Boolean,
  projectSlug: String,
});

const emit = defineEmits(['close']);

const types = ['pattern', 'error', 'preference', 'convention', 'context', 'note'];
const entries = ref([]);
const memStats = ref({ total: 0, totalTags: 0, totalAccesses: 0 });
const filterType = ref('');
const searchQuery = ref('');
const recallQuery = ref('');
const recalled = ref([]);

const showForm = ref(false);
const editing = ref(null);
const form = ref({ type: 'note', key: '', content: '', tagsStr: '' });

let debounceTimer;
function debouncedLoad() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(load, 300);
}

function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return text.slice(0, max) + '…';
}

async function load() {
  if (!props.projectSlug) return;
  const params = new URLSearchParams();
  if (filterType.value) params.set('type', filterType.value);
  if (searchQuery.value) params.set('search', searchQuery.value);
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/memory?${params}`);
    if (res.ok) {
      const data = await res.json();
      entries.value = data.entries || [];
    }
  } catch { /* ignore */ }
}

async function loadStats() {
  if (!props.projectSlug) return;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/memory/stats`);
    if (res.ok) memStats.value = await res.json();
  } catch { /* ignore */ }
}

async function saveMemory() {
  if (!props.projectSlug) return;
  const body = {
    type: form.value.type,
    key: form.value.key,
    content: form.value.content,
    tags: form.value.tagsStr.split(',').map(t => t.trim()).filter(Boolean),
  };

  try {
    if (editing.value) {
      await fetch(`/api/projects/${props.projectSlug}/memory/${editing.value}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      await fetch(`/api/projects/${props.projectSlug}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    cancelForm();
    load();
    loadStats();
  } catch { /* ignore */ }
}

function startEdit(m) {
  editing.value = m.id;
  form.value = {
    type: m.type,
    key: m.key || '',
    content: m.content || '',
    tagsStr: (m.tags || []).join(', '),
  };
  showForm.value = true;
}

function cancelForm() {
  showForm.value = false;
  editing.value = null;
  form.value = { type: 'note', key: '', content: '', tagsStr: '' };
}

async function deleteMemory(id) {
  if (!props.projectSlug) return;
  try {
    await fetch(`/api/projects/${props.projectSlug}/memory/${id}`, { method: 'DELETE' });
    load();
    loadStats();
  } catch { /* ignore */ }
}

async function doRecall() {
  if (!props.projectSlug || !recallQuery.value) return;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/memory/recall?q=${encodeURIComponent(recallQuery.value)}`);
    if (res.ok) recalled.value = await res.json();
  } catch { /* ignore */ }
}

async function clearAll() {
  if (!props.projectSlug) return;
  try {
    await fetch(`/api/projects/${props.projectSlug}/memory`, { method: 'DELETE' });
    entries.value = [];
    loadStats();
  } catch { /* ignore */ }
}

watch(() => props.visible, (v) => { if (v) { load(); loadStats(); } });
watch(() => props.projectSlug, () => { if (props.visible) { load(); loadStats(); } });
onMounted(() => { if (props.visible) { load(); loadStats(); } });
</script>

<style scoped>
.memory-panel { padding: 1rem; }
.memory-panel h3 { margin: 0 0 0.75rem; color: var(--text-primary); }
.memory-panel h4 { margin: 0.5rem 0; font-size: 0.85rem; color: var(--text-secondary); }
.memory-stats {
  display: flex; gap: 0.75rem; margin-bottom: 0.75rem;
  padding: 0.4rem 0.75rem; background: var(--bg-secondary); border-radius: 6px;
}
.memory-stat { font-size: 0.75rem; color: var(--text-secondary); }
.memory-filters { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
.memory-select, .memory-search, .memory-input {
  padding: 6px 8px; font-size: 0.8rem;
  background: var(--input-bg, #1f2937); color: var(--text-primary);
  border: 1px solid var(--border-color, #4b5563); border-radius: 4px; outline: none;
}
.memory-select { width: 120px; }
.memory-search { flex: 1; }
.memory-input { width: 100%; box-sizing: border-box; }
.memory-textarea {
  width: 100%; box-sizing: border-box; padding: 6px 8px; font-size: 0.8rem;
  background: var(--input-bg, #1f2937); color: var(--text-primary);
  border: 1px solid var(--border-color, #4b5563); border-radius: 4px;
  resize: vertical; font-family: inherit; outline: none;
}
.memory-form { display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 0.75rem;
  padding: 0.75rem; background: var(--bg-secondary); border-radius: 6px; }
.memory-form-actions { display: flex; gap: 0.5rem; }
.memory-primary-btn, .memory-secondary-btn, .memory-add-btn {
  padding: 6px 12px; font-size: 0.8rem; border-radius: 4px; cursor: pointer; border: none;
}
.memory-primary-btn { background: var(--accent-color, #3b82f6); color: #fff; }
.memory-secondary-btn { background: var(--bg-tertiary, #374151); color: var(--text-primary); }
.memory-add-btn {
  width: 100%; margin-bottom: 0.75rem; padding: 8px;
  background: var(--bg-secondary); color: var(--accent-color, #3b82f6);
  border: 1px dashed var(--border-color, #4b5563); border-radius: 6px; cursor: pointer;
}
.memory-recall { display: flex; gap: 0.4rem; margin-bottom: 0.75rem; }
.memory-recall-btn {
  padding: 6px 10px; background: var(--bg-secondary);
  border: 1px solid var(--border-color, #4b5563); border-radius: 4px; cursor: pointer;
}
.memory-recall-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.memory-empty {
  padding: 1.5rem; text-align: center; color: var(--text-secondary);
  font-size: 0.85rem; font-style: italic;
}
.memory-card {
  padding: 0.6rem 0.75rem; margin-bottom: 0.5rem;
  background: var(--bg-secondary); border-radius: 6px;
  border-left: 3px solid var(--border-color, #4b5563);
}
.memory-card.recalled { border-left-color: #f59e0b; }
.memory-card-header { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.3rem; }
.memory-type-badge {
  font-size: 0.65rem; font-weight: 600; padding: 1px 6px;
  border-radius: 8px; text-transform: uppercase;
}
.memory-type-badge.pattern { background: #3b82f633; color: #60a5fa; }
.memory-type-badge.error { background: #ef444433; color: #ef4444; }
.memory-type-badge.preference { background: #a855f733; color: #a855f7; }
.memory-type-badge.convention { background: #22c55e33; color: #22c55e; }
.memory-type-badge.context { background: #f59e0b33; color: #f59e0b; }
.memory-type-badge.note { background: #64748b33; color: #94a3b8; }
.memory-key { color: var(--text-primary); font-size: 0.85rem; flex: 1; }
.memory-access { font-size: 0.7rem; color: var(--text-secondary); }
.memory-content {
  margin: 0; font-size: 0.8rem; color: var(--text-secondary);
  line-height: 1.4; white-space: pre-wrap;
}
.memory-tags { display: flex; gap: 4px; margin-top: 0.3rem; flex-wrap: wrap; }
.memory-tag {
  font-size: 0.65rem; padding: 1px 6px;
  background: var(--bg-tertiary, #374151); color: var(--text-secondary);
  border-radius: 8px;
}
.memory-card-actions { display: flex; gap: 0.3rem; margin-top: 0.3rem; }
.memory-action-btn {
  background: none; border: none; cursor: pointer; font-size: 0.75rem; padding: 2px;
}
.memory-clear-wrap { margin-top: 0.75rem; text-align: center; }
.memory-clear-btn {
  padding: 6px 14px; font-size: 0.75rem;
  background: #ef444422; color: #ef4444;
  border: 1px solid #ef444444; border-radius: 4px; cursor: pointer;
}
</style>
