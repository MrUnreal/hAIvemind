<template>
  <div v-if="visible" class="diff-review-panel">
    <h3>📝 Diff Review</h3>

    <!-- Stats -->
    <div class="diff-stats">
      <span class="diff-stat pending">{{ stats.byStatus?.pending || 0 }} pending</span>
      <span class="diff-stat approved">{{ stats.byStatus?.approved || 0 }} approved</span>
      <span class="diff-stat rejected">{{ stats.byStatus?.rejected || 0 }} rejected</span>
      <span class="diff-stat">{{ stats.filesChanged || 0 }} {{ (stats.filesChanged || 0) === 1 ? 'file' : 'files' }}</span>
    </div>

    <!-- Filter -->
    <div class="diff-filters">
      <select v-model="filterStatus" class="diff-select" @change="load">
        <option value="">All Statuses</option>
        <option v-for="s in statuses" :key="s" :value="s">{{ s }}</option>
      </select>
    </div>

    <!-- Diff List -->
    <div v-if="!diffs.length" class="diff-empty">
      No diffs to review.
    </div>

    <div v-for="d in diffs" :key="d.id" class="diff-card" :class="d.status">
      <div class="diff-header">
        <span class="diff-file">{{ d.file }}</span>
        <span class="diff-status-badge" :class="d.status">{{ d.status }}</span>
      </div>

      <!-- Before / After preview -->
      <div v-if="expandedDiff === d.id" class="diff-content">
        <div class="diff-sides">
          <div class="diff-side">
            <h5>Before</h5>
            <pre class="diff-code">{{ d.before || '(empty)' }}</pre>
          </div>
          <div class="diff-side">
            <h5>After</h5>
            <pre class="diff-code">{{ d.after || '(empty)' }}</pre>
          </div>
        </div>

        <!-- Hunks -->
        <div v-for="h in d.hunks" :key="h.id" class="hunk-card" :class="h.status">
          <div class="hunk-header">
            <code class="hunk-range">{{ h.header }}</code>
            <span class="hunk-status" :class="h.status">{{ h.status }}</span>
          </div>
          <pre v-if="h.lines?.length" class="hunk-lines">{{ h.lines.join('\n') }}</pre>
          <div v-if="h.status === 'pending'" class="hunk-actions">
            <button class="hunk-approve" @click="doReviewHunk(d.id, h.id, 'approved')">✅ Approve</button>
            <button class="hunk-reject" @click="doReviewHunk(d.id, h.id, 'rejected')">❌ Reject</button>
          </div>
        </div>

        <!-- Bulk Actions -->
        <div class="diff-bulk-actions">
          <button class="bulk-btn approve" @click="doBulkReview(d.id, 'approved')">✅ Approve All</button>
          <button class="bulk-btn reject" @click="doBulkReview(d.id, 'rejected')">❌ Reject All</button>
          <button class="bulk-btn revert" @click="doRevert(d.id)">↩️ Revert</button>
          <button class="bulk-btn delete" @click="doDelete(d.id)">🗑️ Delete</button>
        </div>
      </div>

      <button class="diff-toggle" @click="expandedDiff = expandedDiff === d.id ? null : d.id">
        {{ expandedDiff === d.id ? '▲ Collapse' : '▼ Expand' }}
      </button>
    </div>

    <!-- Clear -->
    <div v-if="diffs.length" class="diff-clear-wrap">
      <button class="diff-clear-btn" @click="clearAll">Clear All Diffs</button>
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

const statuses = ['pending', 'approved', 'rejected', 'reverted'];
const diffs = ref([]);
const stats = ref({});
const filterStatus = ref('');
const expandedDiff = ref(null);

async function load() {
  if (!props.projectSlug) return;
  const params = new URLSearchParams();
  if (filterStatus.value) params.set('status', filterStatus.value);
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/diffs?${params}`);
    if (res.ok) {
      const data = await res.json();
      diffs.value = data.diffs || [];
    }
  } catch { /* ignore */ }
}

async function loadStats() {
  if (!props.projectSlug) return;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/diffs/stats`);
    if (res.ok) stats.value = await res.json();
  } catch { /* ignore */ }
}

async function doReviewHunk(diffId, hunkId, status) {
  if (!props.projectSlug) return;
  try {
    await fetch(`/api/projects/${props.projectSlug}/diffs/${diffId}/hunks/${hunkId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    load();
    loadStats();
  } catch { /* ignore */ }
}

async function doBulkReview(diffId, status) {
  if (!props.projectSlug) return;
  try {
    await fetch(`/api/projects/${props.projectSlug}/diffs/${diffId}/bulk-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    load();
    loadStats();
  } catch { /* ignore */ }
}

async function doRevert(diffId) {
  if (!props.projectSlug) return;
  try {
    await fetch(`/api/projects/${props.projectSlug}/diffs/${diffId}/revert`, { method: 'POST' });
    load();
    loadStats();
  } catch { /* ignore */ }
}

async function doDelete(diffId) {
  if (!props.projectSlug) return;
  try {
    await fetch(`/api/projects/${props.projectSlug}/diffs/${diffId}`, { method: 'DELETE' });
    load();
    loadStats();
  } catch { /* ignore */ }
}

async function clearAll() {
  if (!props.projectSlug) return;
  try {
    await fetch(`/api/projects/${props.projectSlug}/diffs`, { method: 'DELETE' });
    diffs.value = [];
    loadStats();
  } catch { /* ignore */ }
}

watch(() => props.visible, (v) => { if (v) { load(); loadStats(); } });
watch(() => props.projectSlug, () => { if (props.visible) { load(); loadStats(); } });
onMounted(() => { if (props.visible) { load(); loadStats(); } });
</script>

<style scoped>
.diff-review-panel { padding: 1rem; }
.diff-review-panel h3 { margin: 0 0 0.75rem; color: var(--text-primary); }
.diff-review-panel h5 { margin: 0 0 0.3rem; font-size: 0.75rem; color: var(--text-secondary); }
.diff-stats {
  display: flex; gap: 0.5rem; margin-bottom: 0.75rem;
  padding: 0.4rem 0.75rem; background: var(--bg-secondary); border-radius: 6px;
}
.diff-stat { font-size: 0.75rem; color: var(--text-secondary); }
.diff-stat.pending { color: #f59e0b; }
.diff-stat.approved { color: #22c55e; }
.diff-stat.rejected { color: #ef4444; }
.diff-filters { margin-bottom: 0.75rem; }
.diff-select {
  padding: 6px 8px; font-size: 0.8rem; width: 100%;
  background: var(--input-bg, #1f2937); color: var(--text-primary);
  border: 1px solid var(--border-color, #4b5563); border-radius: 4px;
}
.diff-empty {
  padding: 1.5rem; text-align: center; color: var(--text-secondary);
  font-size: 0.85rem; font-style: italic;
}
.diff-card {
  margin-bottom: 0.5rem; background: var(--bg-secondary);
  border-radius: 6px; border-left: 3px solid var(--border-color, #4b5563);
  overflow: hidden;
}
.diff-card.approved { border-left-color: #22c55e; }
.diff-card.rejected { border-left-color: #ef4444; }
.diff-card.pending { border-left-color: #f59e0b; }
.diff-card.reverted { border-left-color: #64748b; }
.diff-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0.5rem 0.75rem;
}
.diff-file { font-size: 0.8rem; font-weight: 600; color: var(--text-primary); font-family: monospace; }
.diff-status-badge {
  font-size: 0.65rem; font-weight: 600; padding: 1px 6px;
  border-radius: 8px; text-transform: uppercase;
}
.diff-status-badge.pending { background: #f59e0b33; color: #f59e0b; }
.diff-status-badge.approved { background: #22c55e33; color: #22c55e; }
.diff-status-badge.rejected { background: #ef444433; color: #ef4444; }
.diff-status-badge.reverted { background: #64748b33; color: #94a3b8; }
.diff-content { padding: 0 0.75rem; }
.diff-sides { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
.diff-side { flex: 1; }
.diff-code {
  font-size: 0.7rem; padding: 0.5rem; margin: 0;
  background: var(--bg-tertiary, #374151); border-radius: 4px;
  overflow-x: auto; max-height: 200px; color: var(--text-secondary);
}
.hunk-card {
  margin-bottom: 0.4rem; border-radius: 4px;
  background: var(--bg-tertiary, #374151); padding: 0.4rem 0.5rem;
}
.hunk-card.approved { border-left: 2px solid #22c55e; }
.hunk-card.rejected { border-left: 2px solid #ef4444; }
.hunk-card.pending { border-left: 2px solid #f59e0b; }
.hunk-header { display: flex; justify-content: space-between; margin-bottom: 0.3rem; }
.hunk-range { font-size: 0.7rem; color: var(--text-secondary); }
.hunk-status {
  font-size: 0.6rem; font-weight: 600; text-transform: uppercase;
}
.hunk-status.pending { color: #f59e0b; }
.hunk-status.approved { color: #22c55e; }
.hunk-status.rejected { color: #ef4444; }
.hunk-lines {
  font-size: 0.7rem; margin: 0; padding: 0.3rem 0;
  color: var(--text-primary); white-space: pre; overflow-x: auto;
}
.hunk-actions { display: flex; gap: 0.3rem; margin-top: 0.3rem; }
.hunk-approve, .hunk-reject {
  font-size: 0.7rem; padding: 3px 8px; border: none; border-radius: 3px; cursor: pointer;
}
.hunk-approve { background: #22c55e33; color: #22c55e; }
.hunk-reject { background: #ef444433; color: #ef4444; }
.diff-bulk-actions {
  display: flex; gap: 0.4rem; margin: 0.5rem 0;
}
.bulk-btn {
  flex: 1; padding: 5px; font-size: 0.7rem; border: none; border-radius: 3px; cursor: pointer;
}
.bulk-btn.approve { background: #22c55e33; color: #22c55e; }
.bulk-btn.reject { background: #ef444433; color: #ef4444; }
.bulk-btn.revert { background: #f59e0b33; color: #f59e0b; }
.bulk-btn.delete { background: #64748b33; color: #94a3b8; }
.diff-toggle {
  width: 100%; padding: 4px; font-size: 0.7rem;
  background: transparent; color: var(--text-secondary);
  border: none; border-top: 1px solid var(--border-color, #4b5563);
  cursor: pointer; text-align: center;
}
.diff-clear-wrap { margin-top: 0.75rem; text-align: center; }
.diff-clear-btn {
  padding: 6px 14px; font-size: 0.75rem;
  background: #ef444422; color: #ef4444;
  border: 1px solid #ef444444; border-radius: 4px; cursor: pointer;
}
</style>
