<template>
  <div v-if="visible" class="live-dashboard">
    <div class="dash-header">
      <h3 class="dash-title">📊 Live Dashboard</h3>
      <button class="dash-close-btn" @click="$emit('close')">✕</button>
    </div>

    <div v-if="loading" class="dash-loading">Loading system metrics…</div>
    <div v-else-if="error" class="dash-error">⚠️ {{ error }}</div>

    <div v-else-if="health" class="dash-content">
      <!-- System metrics row -->
      <div class="metrics-grid">
        <div class="metric-card">
          <span class="metric-label">Uptime</span>
          <span class="metric-value">{{ formatUptime(health.uptime) }}</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Sessions</span>
          <span class="metric-value">{{ health.runtime?.sessions ?? 0 }}</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Clients</span>
          <span class="metric-value">{{ health.runtime?.clients ?? 0 }}</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Projects</span>
          <span class="metric-value">{{ health.runtime?.projectCount ?? 0 }}</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Active Locks</span>
          <span class="metric-value">{{ health.runtime?.activeLocks ?? 0 }}</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Node</span>
          <span class="metric-value small">{{ health.node?.version ?? '—' }}</span>
        </div>
      </div>

      <!-- Memory usage -->
      <div class="dash-section">
        <h4 class="section-title">Memory Usage</h4>
        <div class="memory-bars">
          <div class="memory-row">
            <span class="memory-label">Heap Used</span>
            <div class="memory-bar-track">
              <div class="memory-bar-fill" :style="{ width: heapPercent + '%' }"></div>
            </div>
            <span class="memory-val">{{ health.memory?.heapUsed?.toFixed(1) }} / {{ health.memory?.heapTotal?.toFixed(1) }} MB</span>
          </div>
          <div class="memory-row">
            <span class="memory-label">RSS</span>
            <span class="memory-val">{{ health.memory?.rss?.toFixed(1) }} MB</span>
          </div>
        </div>
      </div>

      <!-- Agent activity feed -->
      <div class="dash-section">
        <h4 class="section-title">Agent Activity <span class="feed-count">{{ agentActivity.length }}</span></h4>
        <div v-if="agentActivity.length === 0" class="feed-empty">No agent events yet</div>
        <div v-else class="activity-feed">
          <div v-for="(evt, i) in agentActivity.slice(0, 15)" :key="i" class="feed-item">
            <span class="feed-icon">{{ statusIcon(evt.status) }}</span>
            <span class="feed-text">{{ evt.taskLabel || evt.agentId }} — {{ evt.status }}</span>
            <span v-if="evt.modelTier" class="feed-tier">{{ evt.modelTier }}</span>
          </div>
        </div>
      </div>

      <!-- Session events feed -->
      <div class="dash-section">
        <h4 class="section-title">Session Events <span class="feed-count">{{ sessionEvents.length }}</span></h4>
        <div v-if="sessionEvents.length === 0" class="feed-empty">No session events yet</div>
        <div v-else class="activity-feed">
          <div v-for="(evt, i) in sessionEvents.slice(0, 10)" :key="i" class="feed-item">
            <span class="feed-icon">{{ sessionIcon(evt.type) }}</span>
            <span class="feed-text">{{ evt.type }} {{ evt.sessionId ? `(${evt.sessionId.slice(0, 8)}…)` : '' }}</span>
          </div>
        </div>
      </div>

      <!-- Project breakdown -->
      <div v-if="health.projects?.length > 0" class="dash-section">
        <h4 class="section-title">Projects</h4>
        <div class="project-table">
          <div v-for="p in health.projects" :key="p.slug" class="project-row">
            <span class="proj-name">{{ p.name || p.slug }}</span>
            <span class="proj-stat">{{ p.sessions ?? 0 }} sessions</span>
            <span v-if="p.linked" class="proj-linked">linked</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useDashboard } from '../composables/useDashboard.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
});

defineEmits(['close']);

const { health, loading, error, agentActivity, sessionEvents } = useDashboard();

const heapPercent = computed(() => {
  if (!health.value?.memory) return 0;
  const { heapUsed, heapTotal } = health.value.memory;
  if (!heapTotal) return 0;
  return Math.min(100, (heapUsed / heapTotal) * 100);
});

function formatUptime(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function statusIcon(status) {
  const icons = { running: '🔄', success: '✅', failed: '❌', blocked: '⏸️', pending: '⏳' };
  return icons[status] || '📌';
}

function sessionIcon(type) {
  if (type?.includes('complete')) return '✅';
  if (type?.includes('error') || type?.includes('failed')) return '❌';
  if (type?.includes('start')) return '🚀';
  if (type?.includes('warning')) return '⚠️';
  return '📋';
}
</script>

<style scoped>
.live-dashboard {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding: 0 16px 16px;
}

.dash-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-secondary);
  margin-bottom: 12px;
}

.dash-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.dash-close-btn {
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  font-size: 14px;
  cursor: pointer;
}
.dash-close-btn:hover {
  color: var(--text-primary);
}

.dash-loading, .dash-error {
  text-align: center;
  padding: 32px;
  color: var(--text-secondary);
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 16px;
}

.metric-card {
  background: var(--bg-input);
  border: 1px solid var(--border-secondary);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-label {
  font-size: 11px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.metric-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}
.metric-value.small {
  font-size: 13px;
}

.dash-section {
  margin-bottom: 16px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.feed-count {
  background: var(--badge-bg);
  border: 1px solid var(--badge-border);
  border-radius: 99px;
  padding: 1px 7px;
  font-size: 10px;
  color: var(--text-tertiary);
}

.memory-bars {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.memory-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.memory-label {
  font-size: 12px;
  color: var(--text-secondary);
  width: 70px;
  flex-shrink: 0;
}

.memory-bar-track {
  flex: 1;
  height: 8px;
  background: var(--bg-input);
  border-radius: 4px;
  overflow: hidden;
}

.memory-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-green), var(--accent-gold));
  border-radius: 4px;
  transition: width 0.5s ease;
}

.memory-val {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.activity-feed {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.feed-empty {
  padding: 12px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
}

.feed-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg-input);
  border-radius: 6px;
  font-size: 12px;
}

.feed-icon {
  flex-shrink: 0;
}

.feed-text {
  flex: 1;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.feed-tier {
  background: var(--accent-gold-dim);
  color: var(--accent-gold);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
}

.project-table {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.project-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: var(--bg-input);
  border-radius: 6px;
  font-size: 12px;
}

.proj-name {
  flex: 1;
  color: var(--text-primary);
  font-weight: 500;
}

.proj-stat {
  color: var(--text-secondary);
}

.proj-linked {
  background: var(--accent-blue-dim);
  color: var(--accent-blue);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
}
</style>
