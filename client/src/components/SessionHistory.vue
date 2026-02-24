<template>
  <div class="session-history">
    <div class="history-header">
      <div>
        <h2>📁 {{ activeProject?.name }}</h2>
        <p class="subtitle">
          {{ sessions.length }} previous session{{ sessions.length !== 1 ? 's' : '' }}
        </p>
      </div>
      <div class="header-actions">
        <button class="webhook-toggle-btn" @click="showWebhooks = !showWebhooks" title="Manage webhooks">
          🔔
        </button>
        <button class="scheduler-toggle-btn" @click="showScheduler = !showScheduler" title="Session scheduler">
          📅
        </button>
        <button class="benchmark-toggle-btn" @click="showBenchmarks = !showBenchmarks" title="Performance benchmarks">
          📊
        </button>
        <button v-if="sessions.length > 0" class="bulk-toggle-btn" @click="toggleBulkMode">
          {{ bulkMode ? '✕ Cancel' : '☑ Select' }}
        </button>
        <button class="new-session-btn" @click="$emit('newSession')">
          + New Session
        </button>
      </div>
    </div>

    <!-- Phase 8.6: Webhook Panel -->
    <WebhookPanel
      :visible="showWebhooks"
      :projectSlug="activeProject?.slug || ''"
      @close="showWebhooks = false"
    />

    <!-- Phase 8.7: Scheduler Panel -->
    <SchedulerPanel
      :visible="showScheduler"
      :projectSlug="activeProject?.slug || ''"
      @close="showScheduler = false"
    />

    <!-- Phase 8.8: Benchmark Panel -->
    <BenchmarkPanel
      :visible="showBenchmarks"
      :projectSlug="activeProject?.slug || ''"
      @close="showBenchmarks = false"
    />

    <!-- Phase 7.3: Session Search -->
    <SessionSearch
      :projectSlug="activeProject?.slug"
      :projectName="activeProject?.name"
      @select="onSearchSelect"
    />

    <!-- Phase 8.5: Filter Bar -->
    <div class="filter-bar" v-if="sessions.length > 0">
      <select v-model="filterStatus" class="filter-select">
        <option value="">All statuses</option>
        <option value="completed">✅ Completed</option>
        <option value="failed">❌ Failed</option>
        <option value="running">⏳ Running</option>
        <option value="cancelled">🚫 Cancelled</option>
      </select>
      <select v-model="filterTag" class="filter-select" v-if="allTags.length > 0">
        <option value="">All tags</option>
        <option v-for="t in allTags" :key="t" :value="t">🏷 {{ t }}</option>
      </select>
      <button v-if="filterStatus || filterTag" class="clear-filters" @click="filterStatus = ''; filterTag = ''">
        ✕ Clear
      </button>
    </div>

    <!-- Phase 8.0: Compare Mode Banner -->
    <div v-if="compareMode" class="compare-banner">
      <span v-if="!compareA">Select first session to compare</span>
      <span v-else-if="!compareB">Select second session (A: {{ truncate(compareA.prompt, 40) }})</span>
      <button class="compare-cancel" @click="exitCompare">✕ Cancel</button>
    </div>

    <!-- Phase 8.1: Bulk Action Bar -->
    <div v-if="bulkMode && bulkSelected.size > 0" class="bulk-bar">
      <span>{{ bulkSelected.size }} selected</span>
      <div class="bulk-actions">
        <button class="bulk-action-btn bulk-export" @click="bulkExport('json')">📥 Export JSON</button>
        <button class="bulk-action-btn bulk-export" @click="bulkExport('markdown')">📝 Export MD</button>
        <button class="bulk-action-btn bulk-delete" @click="bulkDelete">🗑 Delete</button>
        <button class="bulk-action-btn bulk-select-all" @click="bulkSelectAll">Select All</button>
      </div>
    </div>

    <div v-if="sessionsLoading" class="loading">Loading sessions...</div>

    <!-- Phase 6.4: Workspace Intelligence -->
    <WorkspaceOverview
      v-if="activeProject?.slug && !sessionsLoading"
      :projectSlug="activeProject.slug"
    />

    <div v-else-if="sessions.length === 0" class="empty">
      <p>No sessions yet. Start your first one!</p>
      <button class="new-session-btn" @click="$emit('newSession')">
        + Start Session
      </button>
    </div>

    <div v-else class="session-list">
      <div
        v-for="session in sortedSessions"
        :key="session.id"
        class="session-card"
        :class="{ 'bulk-selected': bulkMode && bulkSelected.has(session.id) }"
        @click="bulkMode ? toggleBulkSelect(session.id) : onLoadSession(session.id)"
      >
        <!-- Phase 8.1: Bulk checkbox -->
        <div v-if="bulkMode" class="bulk-checkbox" @click.stop="toggleBulkSelect(session.id)">
          <span>{{ bulkSelected.has(session.id) ? '☑' : '☐' }}</span>
        </div>
        <div class="session-top">
          <span :class="['status-pill', `pill-${session.status}`]">
            {{ statusLabel(session.status) }}
          </span>
          <span class="session-time">{{ formatTime(session.startedAt) }}</span>
        </div>

        <div class="session-prompt">
          {{ truncate(session.prompt, 160) }}
        </div>

        <div class="session-meta">
          <span class="meta-item" v-if="session.taskCount">
            📋 {{ session.taskCount }} {{ session.taskCount === 1 ? 'task' : 'tasks' }}
          </span>
          <span class="meta-item" v-if="session.agentCount">
            🤖 {{ session.agentCount }} {{ session.agentCount === 1 ? 'agent' : 'agents' }}
          </span>
          <span class="meta-item cost" v-if="session.totalCost > 0">
            💰 {{ session.totalCost.toFixed(1) }}× premium
          </span>
          <span class="meta-item cost free" v-else>
            💰 Free (T0 only)
          </span>
        </div>

        <!-- Quick task summary -->
        <div class="task-summary" v-if="session.taskSummary && session.taskSummary.length > 0">
          <div
            v-for="(task, i) in session.taskSummary.slice(0, 5)"
            :key="i"
            class="task-chip"
          >
            <span class="task-icon">{{ task.status === 'success' ? '✅' : task.status === 'failed' ? '❌' : '⬜' }}</span>
            {{ truncate(task.label, 40) }}
          </div>
          <span v-if="session.taskSummary.length > 5" class="more">
            +{{ session.taskSummary.length - 5 }} more
          </span>
        </div>

        <!-- Phase 8.5: Session Tags -->
        <div class="session-tags">
          <span
            v-for="tag in (session.tags || [])"
            :key="tag"
            class="tag-chip"
            @click.stop="filterTag = tag"
          >
            🏷 {{ tag }}
            <button class="tag-remove" @click.stop="removeTag(session.id, tag)" title="Remove tag">×</button>
          </span>
          <button class="tag-add-btn" @click.stop="startAddTag(session.id)" v-if="editingTagSession !== session.id">+ tag</button>
          <span v-if="editingTagSession === session.id" class="tag-input-wrap">
            <input
              class="tag-input"
              v-model="newTagText"
              @keydown.enter.stop="addTag(session.id)"
              @keydown.escape.stop="editingTagSession = null"
              placeholder="tag name"
              maxlength="50"
              ref="tagInputRef"
            />
            <button class="tag-save" @click.stop="addTag(session.id)">✓</button>
          </span>
        </div>

        <!-- Cancel button for stuck/active sessions -->
        <div class="session-actions" v-if="session.status === 'planning' || session.status === 'running'">
          <button
            class="cancel-session-btn"
            @click.stop="onCancelSession(session.id)"
          >
            🚫 Cancel Session
          </button>
        </div>

        <!-- Phase 5.2: Rollback button + Phase 6.4: View Diff + Phase 7.7: Export -->
        <div class="session-actions" v-if="session.status === 'completed' || session.status === 'failed'">
          <button
            class="diff-btn"
            @click.stop="viewingDiff = viewingDiff === session.id ? null : session.id"
          >
            {{ viewingDiff === session.id ? '✕ Close Diff' : '📊 View Diff' }}
          </button>
          <button
            class="rollback-btn"
            @click.stop="onRollback(session.id)"
            :disabled="rollingBack === session.id"
          >
            {{ rollingBack === session.id ? '↩ Rolling back...' : '↩ Rollback' }}
          </button>
          <button
            class="export-btn"
            @click.stop="onExport(session.id, 'json')"
            title="Export as JSON"
          >
            📥 JSON
          </button>
          <button
            class="export-btn"
            @click.stop="onExport(session.id, 'markdown')"
            title="Export as Markdown"
          >
            📝 MD
          </button>
          <button
            class="compare-btn"
            @click.stop="onCompareSelect(session)"
            :title="compareMode ? 'Select for comparison' : 'Compare with another session'"
          >
            📊 Compare
          </button>
          <button
            class="dep-btn"
            @click.stop="showDepGraph = showDepGraph === session.id ? null : session.id"
            title="View dependency graph"
          >
            🔗 Deps
          </button>
        </div>

        <!-- Phase 6.4: Inline Diff Viewer -->
        <DiffViewer
          v-if="viewingDiff === session.id"
          :projectSlug="activeProject?.slug"
          :sessionId="session.id"
          @close="viewingDiff = null"
        />
      </div>
    </div>

    <!-- Phase 8.4: Dependency Graph -->
    <DependencyGraph
      :visible="!!showDepGraph"
      :projectSlug="activeProject?.slug || ''"
      :sessionId="showDepGraph || ''"
      @close="showDepGraph = null"
    />

    <!-- Phase 8.0: Session Comparison -->
    <SessionCompare
      :visible="showCompare"
      :sessionA="compareA"
      :sessionB="compareB"
      :projectA="activeProject?.slug"
      :projectB="activeProject?.slug"
      @close="exitCompare"
    />
  </div>
</template>

<script setup>
import { computed, ref, nextTick } from 'vue';
import {
  activeProject,
  sessions,
  sessionsLoading,
} from '../composables/useProjects.js';
import { loadSession } from '../composables/useSession.js';
import DiffViewer from './DiffViewer.vue';
import WorkspaceOverview from './WorkspaceOverview.vue';
import SessionSearch from './SessionSearch.vue';
import SessionCompare from './SessionCompare.vue';
import DependencyGraph from './DependencyGraph.vue';
import WebhookPanel from './WebhookPanel.vue';
import SchedulerPanel from './SchedulerPanel.vue';
import BenchmarkPanel from './BenchmarkPanel.vue';

defineEmits(['newSession']);

const showDepGraph = ref(null);
const showWebhooks = ref(false);
const showScheduler = ref(false);
const showBenchmarks = ref(false);

const rollingBack = ref(null);
const viewingDiff = ref(null);
const compareMode = ref(false);
const compareA = ref(null);
const compareB = ref(null);
const showCompare = ref(false);
const bulkMode = ref(false);
const bulkSelected = ref(new Set());

// Phase 8.5: Tags & Filtering
const filterStatus = ref('');
const filterTag = ref('');
const editingTagSession = ref(null);
const newTagText = ref('');
const tagInputRef = ref(null);

const allTags = computed(() => {
  const tags = new Set();
  for (const s of sessions.value) {
    for (const t of (s.tags || [])) tags.add(t);
  }
  return [...tags].sort();
});

const sortedSessions = computed(() => {
  let list = [...sessions.value].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  if (filterStatus.value) list = list.filter(s => s.status === filterStatus.value);
  if (filterTag.value) list = list.filter(s => (s.tags || []).includes(filterTag.value));
  return list;
});

function statusLabel(status) {
  const labels = {
    completed: '✅ Completed',
    failed: '❌ Failed',
    running: '⏳ Running',
    planning: '🔄 Planning',
    cancelled: '🚫 Cancelled',
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

function truncate(s, len) {
  if (!s) return '';
  return s.length > len ? s.slice(0, len) + '…' : s;
}

async function onLoadSession(sessionId) {
  if (!activeProject.value) return;
  await loadSession(activeProject.value.slug, sessionId);
}

// Phase 7.3: Navigate to a session from search results
async function onSearchSelect(result) {
  if (!result?.sessionId) return;
  // If the result is in a different project, switch projects first
  if (result.projectSlug && result.projectSlug !== activeProject.value?.slug) {
    const { selectProject, projects } = await import('../composables/useProjects.js');
    const project = projects.value.find(p => p.slug === result.projectSlug);
    if (project) await selectProject(project);
  }
  await loadSession(result.projectSlug || activeProject.value?.slug, result.sessionId);
}

// Phase 5.2 + 6.4: Rollback workspace — show diff preview first
async function onRollback(sessionId) {
  if (!activeProject.value || rollingBack.value) return;

  // Phase 6.4: Show diff inline before confirming
  if (viewingDiff.value !== sessionId) {
    viewingDiff.value = sessionId;
    return; // User sees the diff first, then clicks Rollback again to confirm
  }

  if (!confirm('This will reset the workspace to its state before this session. Continue?')) return;

  rollingBack.value = sessionId;
  try {
    const res = await fetch(`/api/projects/${activeProject.value.slug}/sessions/${sessionId}/rollback`, {
      method: 'POST',
    });
    const data = await res.json();
    if (res.ok) {
      alert(`Rollback successful: ${data.message}`);
    } else {
      alert(`Rollback failed: ${data.error}`);
    }
  } catch (err) {
    alert(`Rollback error: ${err.message}`);
  } finally {
    rollingBack.value = null;
  }
}

async function onCancelSession(sessionId) {
  if (!activeProject.value) return;
  if (!confirm('Cancel this session? It will be marked as cancelled and cannot be resumed.')) return;
  try {
    const res = await fetch(`/api/projects/${activeProject.value.slug}/sessions/${sessionId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Cancelled by user from UI' })
    });
    const data = await res.json();
    if (res.ok) {
      // Refresh session list
      const { fetchSessions } = await import('../composables/useProjects.js');
      await fetchSessions(activeProject.value.slug);
    } else {
      alert(`Cancel failed: ${data.error}`);
    }
  } catch (err) {
    alert(`Cancel error: ${err.message}`);
  }
}

// Phase 7.7: Export session as JSON or Markdown
async function onExport(sessionId, format) {
  if (!activeProject.value) return;
  const url = `/api/projects/${activeProject.value.slug}/sessions/${sessionId}/export?format=${format}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      alert('Export failed');
      return;
    }
    const blob = await res.blob();
    const ext = format === 'markdown' || format === 'md' ? 'md' : 'json';
    const filename = `session-${sessionId}.${ext}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  } catch (err) {
    alert(`Export error: ${err.message}`);
  }
}

// Phase 8.0: Session comparison
function onCompareSelect(session) {
  if (!compareMode.value) {
    compareMode.value = true;
    compareA.value = session;
    compareB.value = null;
    showCompare.value = false;
  } else if (!compareA.value) {
    compareA.value = session;
  } else if (!compareB.value) {
    if (session.id === compareA.value.id) return; // Same session
    compareB.value = session;
    showCompare.value = true;
  }
}

function exitCompare() {
  compareMode.value = false;
  compareA.value = null;
  compareB.value = null;
  showCompare.value = false;
}

// Phase 8.5: Tag management
function startAddTag(sessionId) {
  editingTagSession.value = sessionId;
  newTagText.value = '';
  nextTick(() => {
    if (tagInputRef.value) tagInputRef.value.focus();
  });
}

async function addTag(sessionId) {
  const tag = newTagText.value.trim().toLowerCase();
  if (!tag || !activeProject.value) return;
  editingTagSession.value = null;
  newTagText.value = '';
  try {
    const res = await fetch(`/api/projects/${activeProject.value.slug}/sessions/${sessionId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: [tag] }),
    });
    if (res.ok) {
      const data = await res.json();
      const session = sessions.value.find(s => s.id === sessionId);
      if (session) session.tags = data.tags;
    }
  } catch { /* ignore */ }
}

async function removeTag(sessionId, tag) {
  if (!activeProject.value) return;
  try {
    const res = await fetch(`/api/projects/${activeProject.value.slug}/sessions/${sessionId}/tags/${encodeURIComponent(tag)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      const data = await res.json();
      const session = sessions.value.find(s => s.id === sessionId);
      if (session) session.tags = data.tags;
    }
  } catch { /* ignore */ }
}

// Phase 8.1: Bulk session actions
function toggleBulkMode() {
  bulkMode.value = !bulkMode.value;
  bulkSelected.value = new Set();
}

function toggleBulkSelect(sessionId) {
  const next = new Set(bulkSelected.value);
  if (next.has(sessionId)) next.delete(sessionId);
  else next.add(sessionId);
  bulkSelected.value = next;
}

function bulkSelectAll() {
  const all = new Set(sortedSessions.value.map(s => s.id));
  bulkSelected.value = all;
}

async function bulkDelete() {
  if (!activeProject.value || bulkSelected.value.size === 0) return;
  const count = bulkSelected.value.size;
  if (!confirm(`Delete ${count} session${count > 1 ? 's' : ''}? This cannot be undone.`)) return;

  try {
    const res = await fetch(`/api/projects/${activeProject.value.slug}/sessions/bulk-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds: [...bulkSelected.value] }),
    });
    const data = await res.json();
    if (res.ok) {
      alert(`Deleted ${data.deleted.length} session(s).${data.notFound.length > 0 ? ` ${data.notFound.length} not found.` : ''}`);
      // Refresh sessions list
      const { fetchSessions } = await import('../composables/useProjects.js');
      await fetchSessions(activeProject.value.slug);
      bulkSelected.value = new Set();
    } else {
      alert(`Bulk delete failed: ${data.error}`);
    }
  } catch (err) {
    alert(`Bulk delete error: ${err.message}`);
  }
}

async function bulkExport(format) {
  if (!activeProject.value || bulkSelected.value.size === 0) return;
  try {
    const res = await fetch(`/api/projects/${activeProject.value.slug}/sessions/bulk-export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds: [...bulkSelected.value], format }),
    });
    if (!res.ok) {
      alert('Bulk export failed');
      return;
    }
    const blob = await res.blob();
    const ext = format === 'markdown' || format === 'md' ? 'md' : 'json';
    const filename = `sessions-bulk-${Date.now()}.${ext}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  } catch (err) {
    alert(`Bulk export error: ${err.message}`);
  }
}
</script>

<style scoped>
.session-history {
  display: flex;
  flex-direction: column;
  max-width: 800px;
  margin: 40px auto;
  padding: 0 24px;
  gap: 24px;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.history-header h2 {
  font-size: 20px;
  color: var(--text-primary);
  margin: 0;
}

.subtitle {
  color: var(--text-tertiary);
  font-size: 13px;
  margin-top: 4px;
}

.new-session-btn {
  background: linear-gradient(135deg, #f5c542, #e6a817);
  color: var(--bg-secondary);
  border: none;
  padding: 10px 24px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.2s;
}
.new-session-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 20px rgba(245, 197, 66, 0.3);
}

.loading {
  text-align: center;
  color: var(--text-tertiary);
  padding: 40px;
}

.empty {
  text-align: center;
  color: var(--text-tertiary);
  padding: 60px 0;
}
.empty p {
  margin-bottom: 16px;
}

.session-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.session-card {
  background: var(--bg-primary);
  border: 1px solid var(--bg-card);
  border-radius: 14px;
  padding: 18px 22px;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;
}
.session-card:hover {
  border-color: #f5c54255;
  box-shadow: 0 4px 16px rgba(245, 197, 66, 0.06);
  transform: translateY(-1px);
}

.session-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.status-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 12px;
}
.pill-completed { background: #1a3a1a; color: #6ecf6e; }
.pill-failed { background: #3a1a1a; color: #f56a6a; }
.pill-running { background: #1a2a3a; color: #4a9eff; }
.pill-planning { background: #2a2a1a; color: #c5c56a; }
.pill-cancelled { background: #2a1a1a; color: var(--text-secondary); }

.session-time {
  font-size: 12px;
  color: var(--text-tertiary);
}

.session-prompt {
  font-size: 14px;
  color: #c0c0c0;
  line-height: 1.5;
  margin-bottom: 12px;
}

.session-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.meta-item {
  font-size: 12px;
  color: var(--text-muted);
}
.meta-item.cost {
  color: #f5c542;
}
.meta-item.cost.free {
  color: #6ecf6e;
}

.task-summary {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}

.task-chip {
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--bg-card);
  padding: 3px 8px;
  border-radius: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.task-icon {
  font-size: 10px;
  margin-right: 3px;
}

.more {
  font-size: 11px;
  color: var(--text-tertiary);
}

.session-actions {
  margin-top: 8px;
  display: flex;
  gap: 6px;
}

.rollback-btn {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid #f5c542;
  background: transparent;
  color: #f5c542;
  cursor: pointer;
  transition: all 0.2s;
}
.rollback-btn:hover:not(:disabled) {
  background: rgba(245, 197, 66, 0.15);
}
.rollback-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cancel-session-btn {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid #ff6b6b;
  background: transparent;
  color: #ff6b6b;
  cursor: pointer;
  transition: all 0.2s;
}
.cancel-session-btn:hover {
  background: rgba(255, 107, 107, 0.15);
}

.diff-btn {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid #60a5fa;
  background: transparent;
  color: #60a5fa;
  cursor: pointer;
  transition: all 0.2s;
}
.diff-btn:hover {
  background: rgba(96, 165, 250, 0.15);
}

.export-btn {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid #6ecf6e;
  background: transparent;
  color: #6ecf6e;
  cursor: pointer;
  transition: all 0.2s;
}
.export-btn:hover {
  background: rgba(110, 207, 110, 0.15);
}

.compare-btn {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid #ba68c8;
  background: transparent;
  color: #ba68c8;
  cursor: pointer;
  transition: all 0.2s;
}
.compare-btn:hover {
  background: rgba(186, 104, 200, 0.15);
}

.dep-btn {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid #64b5f6;
  background: transparent;
  color: #64b5f6;
  cursor: pointer;
  transition: all 0.2s;
}
.dep-btn:hover {
  background: rgba(100, 181, 246, 0.15);
}

.compare-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(186, 104, 200, 0.1);
  border: 1px solid #ba68c8;
  border-radius: 6px;
  padding: 8px 12px;
  margin: 8px 0;
  font-size: 13px;
  color: #ce93d8;
}
.compare-cancel {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid #ba68c8;
  background: transparent;
  color: #ba68c8;
  cursor: pointer;
}
.compare-cancel:hover {
  background: rgba(186, 104, 200, 0.2);
}

/* Phase 8.1: Bulk Mode */
.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.bulk-toggle-btn {
  font-size: 12px;
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--text-muted);
  background: transparent;
  color: var(--btn-text);
  cursor: pointer;
  transition: all 0.2s;
}
.bulk-toggle-btn:hover {
  border-color: var(--text-secondary);
  color: #fff;
}

.bulk-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 183, 77, 0.1);
  border: 1px solid #ffb74d;
  border-radius: 6px;
  padding: 8px 12px;
  margin: 8px 0;
  font-size: 13px;
  color: #ffcc80;
}

.bulk-actions {
  display: flex;
  gap: 6px;
}

.bulk-action-btn {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid;
  background: transparent;
  cursor: pointer;
  transition: all 0.2s;
}
.bulk-export {
  border-color: #6ecf6e;
  color: #6ecf6e;
}
.bulk-export:hover {
  background: rgba(110, 207, 110, 0.15);
}
.bulk-delete {
  border-color: #ef5350;
  color: #ef5350;
}
.bulk-delete:hover {
  background: rgba(239, 83, 80, 0.15);
}
.bulk-select-all {
  border-color: #90caf9;
  color: #90caf9;
}
.bulk-select-all:hover {
  background: rgba(144, 202, 249, 0.15);
}

.bulk-checkbox {
  font-size: 18px;
  cursor: pointer;
  margin-right: 8px;
  line-height: 1;
}

.bulk-selected {
  border-color: #ffb74d !important;
  background: rgba(255, 183, 77, 0.08) !important;
}

/* Phase 8.5: Filter Bar */
.filter-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.filter-select {
  background: var(--border-primary);
  color: var(--btn-text);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
}

.clear-filters {
  background: none;
  border: 1px solid var(--text-tertiary);
  color: var(--text-muted);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
}
.clear-filters:hover { color: #ef5350; border-color: #ef5350; }

/* Phase 8.5: Session Tags */
.session-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  margin-top: 6px;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: rgba(100, 181, 246, 0.1);
  border: 1px solid var(--border-primary);
  color: #90caf9;
  border-radius: 12px;
  padding: 1px 8px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}
.tag-chip:hover { background: rgba(100, 181, 246, 0.2); }

.tag-remove {
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 13px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
}
.tag-remove:hover { color: #ef5350; }

.tag-add-btn {
  background: none;
  border: 1px dashed var(--border-input);
  color: var(--text-tertiary);
  border-radius: 12px;
  padding: 1px 8px;
  font-size: 11px;
  cursor: pointer;
}
.tag-add-btn:hover { color: #90caf9; border-color: #90caf9; }

.tag-input-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.tag-input {
  background: var(--border-primary);
  border: 1px solid #64b5f6;
  color: var(--text-primary);
  border-radius: 6px;
  padding: 2px 6px;
  font-size: 11px;
  width: 100px;
}

.tag-save {
  background: none;
  border: none;
  color: #81c784;
  font-size: 14px;
  cursor: pointer;
}

.webhook-toggle-btn {
  background: none;
  border: 1px solid var(--border-input);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}
.webhook-toggle-btn:hover {
  border-color: #ffb74d;
  background: rgba(255, 183, 77, 0.1);
}
.scheduler-toggle-btn {
  background: none;
  border: 1px solid var(--border-input);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}
.scheduler-toggle-btn:hover {
  border-color: #4c8dff;
  background: rgba(76, 141, 255, 0.1);
}
.benchmark-toggle-btn {
  background: none;
  border: 1px solid var(--border-input);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}
.benchmark-toggle-btn:hover {
  border-color: #51cf66;
  background: rgba(81, 207, 102, 0.1);
}
</style>
