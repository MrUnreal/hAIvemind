<template>
  <div v-if="visible" class="suggestions-panel">
    <h3>💡 Prompt Suggestions</h3>

    <!-- Category Filter -->
    <div class="suggestions-filters">
      <select v-model="filterCategory" class="suggestions-select" @change="load">
        <option value="">All Categories</option>
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>
      <input
        v-model="searchQuery"
        class="suggestions-search"
        placeholder="Search suggestions..."
        @input="debouncedLoad"
      />
    </div>

    <!-- Source Summary -->
    <div v-if="sources" class="suggestions-sources">
      <span class="source-chip builtin">📦 {{ sources.builtin }}</span>
      <span class="source-chip sessions">📜 {{ sources.sessions }}</span>
      <span class="source-chip memory">🧠 {{ sources.memory }}</span>
    </div>

    <!-- Suggestion Cards -->
    <div v-if="!suggestions.length" class="suggestions-empty">
      No suggestions match your filters.
    </div>

    <div
      v-for="(s, i) in suggestions"
      :key="i"
      class="suggestion-card"
      @click="useSuggestion(s)"
    >
      <div class="suggestion-header">
        <span class="suggestion-category" :class="s.category">{{ s.category }}</span>
        <span class="suggestion-source">{{ s.source }}</span>
      </div>
      <p class="suggestion-text">{{ s.text }}</p>
      <div v-if="s.tags?.length" class="suggestion-tags">
        <span v-for="t in s.tags" :key="t" class="suggestion-tag">{{ t }}</span>
      </div>
    </div>

    <!-- Prompt History -->
    <div class="suggestions-history-header">
      <h4>📜 Recent Prompts</h4>
      <button v-if="history.length" class="suggestions-clear-btn" @click="clearPromptHistory">
        Clear
      </button>
    </div>

    <div v-if="!history.length" class="suggestions-empty">
      No prompt history yet.
    </div>

    <div
      v-for="(h, i) in history"
      :key="i"
      class="history-card"
      @click="useSuggestion({ text: h.text })"
    >
      <p class="history-text">{{ truncate(h.text, 120) }}</p>
      <span class="history-time">{{ formatTime(h.timestamp) }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';

const props = defineProps({
  visible: Boolean,
  projectSlug: String,
});

const emit = defineEmits(['close', 'usePrompt']);

const categories = ref([]);
const suggestions = ref([]);
const sources = ref(null);
const history = ref([]);
const filterCategory = ref('');
const searchQuery = ref('');

let debounceTimer;
function debouncedLoad() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(load, 300);
}

function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return text.slice(0, max) + '…';
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

async function load() {
  if (!props.projectSlug) return;
  const params = new URLSearchParams();
  if (filterCategory.value) params.set('category', filterCategory.value);
  if (searchQuery.value) params.set('query', searchQuery.value);
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/suggestions?${params}`);
    if (res.ok) {
      const data = await res.json();
      suggestions.value = data.suggestions || [];
      sources.value = data.sources || null;
    }
  } catch { /* ignore */ }
}

async function loadCategories() {
  if (!props.projectSlug) return;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/suggestions/categories`);
    if (res.ok) categories.value = await res.json();
  } catch { /* ignore */ }
}

async function loadHistory() {
  if (!props.projectSlug) return;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/suggestions/history`);
    if (res.ok) history.value = await res.json();
  } catch { /* ignore */ }
}

async function clearPromptHistory() {
  if (!props.projectSlug) return;
  try {
    await fetch(`/api/projects/${props.projectSlug}/suggestions/history`, { method: 'DELETE' });
    history.value = [];
  } catch { /* ignore */ }
}

function useSuggestion(s) {
  emit('usePrompt', s.text);
}

function refresh() {
  load();
  loadCategories();
  loadHistory();
}

watch(() => props.visible, (v) => { if (v) refresh(); });
watch(() => props.projectSlug, () => { if (props.visible) refresh(); });
onMounted(() => { if (props.visible) refresh(); });
</script>

<style scoped>
.suggestions-panel { padding: 1rem; }
.suggestions-panel h3 { margin: 0 0 0.75rem; color: var(--text-primary); }
.suggestions-panel h4 { margin: 0; font-size: 0.85rem; color: var(--text-secondary); }
.suggestions-filters { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
.suggestions-select, .suggestions-search {
  padding: 6px 8px; font-size: 0.8rem;
  background: var(--input-bg, #1f2937); color: var(--text-primary);
  border: 1px solid var(--border-color, #4b5563); border-radius: 4px; outline: none;
}
.suggestions-select { width: 130px; }
.suggestions-search { flex: 1; }
.suggestions-sources {
  display: flex; gap: 0.5rem; margin-bottom: 0.75rem;
}
.source-chip {
  font-size: 0.7rem; padding: 2px 8px; border-radius: 10px;
}
.source-chip.builtin { background: #3b82f622; color: #60a5fa; }
.source-chip.sessions { background: #f59e0b22; color: #fbbf24; }
.source-chip.memory { background: #a855f722; color: #c084fc; }
.suggestions-empty {
  padding: 1rem; text-align: center; color: var(--text-secondary);
  font-size: 0.85rem; font-style: italic;
}
.suggestion-card {
  padding: 0.6rem 0.75rem; margin-bottom: 0.5rem;
  background: var(--bg-secondary); border-radius: 6px;
  border-left: 3px solid var(--accent-color, #3b82f6);
  cursor: pointer; transition: border-color 0.15s;
}
.suggestion-card:hover { border-left-color: #22c55e; }
.suggestion-header { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.3rem; }
.suggestion-category {
  font-size: 0.65rem; font-weight: 600; padding: 1px 6px;
  border-radius: 8px; text-transform: uppercase;
}
.suggestion-category.fix { background: #ef444433; color: #ef4444; }
.suggestion-category.feature { background: #3b82f633; color: #60a5fa; }
.suggestion-category.refactor { background: #a855f733; color: #a855f7; }
.suggestion-category.test { background: #22c55e33; color: #22c55e; }
.suggestion-category.docs { background: #64748b33; color: #94a3b8; }
.suggestion-category.performance { background: #f59e0b33; color: #f59e0b; }
.suggestion-category.security { background: #ef444433; color: #f87171; }
.suggestion-category.devops { background: #06b6d433; color: #22d3ee; }
.suggestion-category.maintenance { background: #64748b33; color: #94a3b8; }
.suggestion-category.observability { background: #8b5cf633; color: #a78bfa; }
.suggestion-source { font-size: 0.65rem; color: var(--text-secondary); margin-left: auto; }
.suggestion-text {
  margin: 0; font-size: 0.8rem; color: var(--text-primary);
  line-height: 1.4;
}
.suggestion-tags { display: flex; gap: 4px; margin-top: 0.3rem; flex-wrap: wrap; }
.suggestion-tag {
  font-size: 0.65rem; padding: 1px 6px;
  background: var(--bg-tertiary, #374151); color: var(--text-secondary);
  border-radius: 8px;
}
.suggestions-history-header {
  display: flex; align-items: center; justify-content: space-between;
  margin: 1rem 0 0.5rem;
}
.suggestions-clear-btn {
  font-size: 0.7rem; padding: 2px 8px;
  background: #ef444422; color: #ef4444;
  border: 1px solid #ef444444; border-radius: 4px; cursor: pointer;
}
.history-card {
  padding: 0.5rem 0.75rem; margin-bottom: 0.4rem;
  background: var(--bg-secondary); border-radius: 6px;
  cursor: pointer; transition: background 0.15s;
}
.history-card:hover { background: var(--bg-tertiary, #374151); }
.history-text {
  margin: 0 0 0.2rem; font-size: 0.8rem; color: var(--text-primary);
}
.history-time { font-size: 0.65rem; color: var(--text-secondary); }
</style>
