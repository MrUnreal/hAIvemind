<template>
  <div class="session-search">
    <div class="search-bar">
      <span class="search-icon">🔍</span>
      <input
        ref="searchInput"
        v-model="query"
        type="text"
        placeholder="Search sessions by prompt or task..."
        class="search-input"
        @input="onInput"
        @keydown.escape="clearSearch"
      />
      <button v-if="query" class="clear-btn" @click="clearSearch">✕</button>
    </div>

    <div v-if="searching" class="search-status">Searching...</div>

    <div v-if="hasResults" class="search-results">
      <div class="results-header">
        {{ total }} result{{ total !== 1 ? 's' : '' }}
        <span v-if="scopedToProject" class="scope-badge">in {{ scopedToProject }}</span>
        <span v-else class="scope-badge">all projects</span>
      </div>

      <div
        v-for="result in results"
        :key="result.sessionId"
        class="result-card"
        @click="onSelect(result)"
      >
        <div class="result-top">
          <span :class="['status-pill', `pill-${result.status}`]">
            {{ statusLabel(result.status) }}
          </span>
          <span class="result-project" v-if="!scopedToProject">
            📁 {{ result.projectName }}
          </span>
          <span class="result-time">{{ formatTime(result.createdAt) }}</span>
        </div>

        <div class="result-prompt" v-html="highlight(result.prompt || '', query)"></div>

        <div class="result-meta">
          <span class="meta-item">📋 {{ result.taskCount }} tasks</span>
          <span class="match-type" :class="result.matchType">
            {{ matchLabel(result.matchType) }}
          </span>
        </div>

        <div v-if="result.matchedTasks.length > 0" class="matched-tasks">
          <span
            v-for="(task, i) in result.matchedTasks.slice(0, 3)"
            :key="i"
            class="task-chip"
            v-html="'🔹 ' + highlight(task, query)"
          ></span>
          <span v-if="result.matchedTasks.length > 3" class="more">
            +{{ result.matchedTasks.length - 3 }} more
          </span>
        </div>
      </div>
    </div>

    <div v-else-if="searched && !searching" class="no-results">
      No sessions matching "{{ query }}"
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  /** When set, search only this project's sessions */
  projectSlug: { type: String, default: null },
  projectName: { type: String, default: null },
});

const emit = defineEmits(['select']);

const query = ref('');
const results = ref([]);
const total = ref(0);
const searching = ref(false);
const searched = ref(false);
const searchInput = ref(null);

let debounceTimer = null;

const hasResults = computed(() => results.value.length > 0);
const scopedToProject = computed(() => props.projectName || null);

function onInput() {
  searched.value = false;
  if (debounceTimer) clearTimeout(debounceTimer);
  const q = query.value.trim();
  if (q.length < 2) {
    results.value = [];
    total.value = 0;
    return;
  }
  searching.value = true;
  debounceTimer = setTimeout(() => doSearch(q), 300);
}

async function doSearch(q) {
  try {
    const params = new URLSearchParams({ q });
    if (props.projectSlug) params.set('project', props.projectSlug);

    const res = await fetch(`/api/sessions/search?${params}`);
    if (res.ok) {
      const data = await res.json();
      results.value = data.results;
      total.value = data.total;
    }
  } catch (err) {
    console.error('[search] Failed:', err);
  } finally {
    searching.value = false;
    searched.value = true;
  }
}

function clearSearch() {
  query.value = '';
  results.value = [];
  total.value = 0;
  searched.value = false;
  searching.value = false;
}

function onSelect(result) {
  emit('select', result);
}

function statusLabel(status) {
  const labels = {
    completed: '✅ Done',
    failed: '❌ Failed',
    running: '⏳ Running',
    planning: '🔄 Planning',
  };
  return labels[status] || status;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

function highlight(text, q) {
  if (!q || !text) return escapeHtml(text || '');
  const escaped = escapeHtml(text);
  const qEscaped = escapeRegExp(q);
  const regex = new RegExp(`(${qEscaped})`, 'gi');
  return escaped.replace(regex, '<mark>$1</mark>');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchLabel(type) {
  if (type === 'both') return 'prompt + task';
  if (type === 'task') return 'task match';
  return 'prompt match';
}

/** Focus the search input (for keyboard shortcut integration) */
function focus() {
  searchInput.value?.focus();
}

defineExpose({ focus, clearSearch });
</script>

<style scoped>
.session-search {
  width: 100%;
}

.search-bar {
  display: flex;
  align-items: center;
  background: #1e1e2e;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 0 12px;
  gap: 8px;
  transition: border-color 0.2s;
}

.search-bar:focus-within {
  border-color: #4a9eff;
}

.search-icon {
  font-size: 14px;
  opacity: 0.5;
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  color: #e0e0e0;
  font-size: 14px;
  padding: 10px 0;
  outline: none;
}

.search-input::placeholder {
  color: #666;
}

.clear-btn {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 14px;
  padding: 4px 6px;
  border-radius: 4px;
}

.clear-btn:hover {
  color: #fff;
  background: #333;
}

.search-status {
  padding: 12px 0;
  color: #888;
  font-size: 13px;
}

.results-header {
  padding: 8px 0;
  font-size: 13px;
  color: #888;
}

.scope-badge {
  color: #4a9eff;
}

.search-results {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.result-card {
  background: #1a1a2e;
  border: 1px solid #2a2a3e;
  border-radius: 8px;
  padding: 12px 16px;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.1s;
}

.result-card:hover {
  border-color: #4a9eff;
  transform: translateY(-1px);
}

.result-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.status-pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: #333;
}

.pill-completed { background: #1b4332; color: #95d5b2; }
.pill-failed { background: #3d0000; color: #ff8888; }
.pill-running { background: #2d2d00; color: #ffdd57; }
.pill-planning { background: #1a1a3e; color: #8888ff; }

.result-project {
  font-size: 12px;
  color: #aaa;
}

.result-time {
  font-size: 12px;
  color: #666;
  margin-left: auto;
}

.result-prompt {
  font-size: 14px;
  color: #ddd;
  line-height: 1.4;
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.result-prompt :deep(mark) {
  background: #4a9eff33;
  color: #4a9eff;
  padding: 0 2px;
  border-radius: 2px;
}

.result-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: #888;
}

.match-type {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.match-type.prompt { background: #1a3a1a; color: #88cc88; }
.match-type.task { background: #1a1a3a; color: #8888cc; }
.match-type.both { background: #3a2a1a; color: #ccaa88; }

.matched-tasks {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.task-chip {
  font-size: 12px;
  color: #aaa;
  background: #222;
  padding: 2px 8px;
  border-radius: 4px;
}

.task-chip :deep(mark) {
  background: #4a9eff33;
  color: #4a9eff;
  padding: 0 2px;
  border-radius: 2px;
}

.more {
  font-size: 12px;
  color: #666;
  padding: 2px 8px;
}

.no-results {
  padding: 16px 0;
  color: #666;
  font-size: 13px;
  text-align: center;
}
</style>
