<template>
  <div v-if="visible" class="analytics-panel">
    <h3>📈 Session Analytics</h3>

    <!-- Overview Stats -->
    <div class="analytics-stats-grid">
      <div class="analytics-stat-card">
        <span class="analytics-stat-value">{{ stats.total }}</span>
        <span class="analytics-stat-label">Total Sessions</span>
      </div>
      <div class="analytics-stat-card success">
        <span class="analytics-stat-value">{{ stats.successRate }}%</span>
        <span class="analytics-stat-label">Success Rate</span>
      </div>
      <div class="analytics-stat-card">
        <span class="analytics-stat-value">{{ stats.avgDurationHuman || '—' }}</span>
        <span class="analytics-stat-label">Avg Duration</span>
      </div>
      <div class="analytics-stat-card">
        <span class="analytics-stat-value">{{ stats.totalCost }}</span>
        <span class="analytics-stat-label">Total Cost</span>
      </div>
    </div>

    <!-- Status Breakdown -->
    <div class="analytics-breakdown">
      <div class="analytics-bar-row">
        <span class="analytics-bar-label">Completed</span>
        <div class="analytics-bar-track">
          <div
            class="analytics-bar-fill bar-success"
            :style="{ width: barPercent(stats.completed) }"
          ></div>
        </div>
        <span class="analytics-bar-count">{{ stats.completed }}</span>
      </div>
      <div class="analytics-bar-row">
        <span class="analytics-bar-label">Failed</span>
        <div class="analytics-bar-track">
          <div
            class="analytics-bar-fill bar-danger"
            :style="{ width: barPercent(stats.failed) }"
          ></div>
        </div>
        <span class="analytics-bar-count">{{ stats.failed }}</span>
      </div>
      <div class="analytics-bar-row">
        <span class="analytics-bar-label">Running</span>
        <div class="analytics-bar-track">
          <div
            class="analytics-bar-fill bar-info"
            :style="{ width: barPercent(stats.inProgress) }"
          ></div>
        </div>
        <span class="analytics-bar-count">{{ stats.inProgress }}</span>
      </div>
    </div>

    <!-- Weekly Digest -->
    <div v-if="digest" class="analytics-digest">
      <h4>Weekly Digest</h4>
      <div class="analytics-digest-trends">
        <span :class="['trend', digest.trends.sessionsDelta >= 0 ? 'up' : 'down']">
          {{ digest.trends.sessionsDelta >= 0 ? '↑' : '↓' }}
          {{ Math.abs(digest.trends.sessionsDelta) }} {{ Math.abs(digest.trends.sessionsDelta) === 1 ? 'session' : 'sessions' }}
        </span>
        <span :class="['trend', digest.trends.successRateDelta >= 0 ? 'up' : 'down']">
          {{ digest.trends.successRateDelta >= 0 ? '↑' : '↓' }}
          {{ Math.abs(digest.trends.successRateDelta) }}% success
        </span>
        <span :class="['trend', digest.trends.costDelta <= 0 ? 'up' : 'down']">
          {{ digest.trends.costDelta <= 0 ? '↓' : '↑' }}
          {{ Math.abs(digest.trends.costDelta) }} cost
        </span>
      </div>
    </div>

    <!-- Model Breakdown -->
    <div v-if="models.length" class="analytics-models">
      <h4>Model Usage</h4>
      <div v-for="m in models" :key="m.model" class="analytics-model-row">
        <span class="analytics-model-name">{{ m.model }}</span>
        <span class="analytics-model-count">{{ m.count }} {{ m.count === 1 ? 'session' : 'sessions' }}</span>
        <span class="analytics-model-cost">cost: {{ m.totalCost }}</span>
      </div>
    </div>

    <!-- Time Series (simple table) -->
    <div v-if="timeseries.length" class="analytics-timeseries">
      <h4>Daily Trend ({{ timeseries.length }}d)</h4>
      <div class="analytics-sparkline">
        <div
          v-for="(b, i) in timeseries"
          :key="i"
          class="analytics-spark-bar"
          :style="{ height: sparkHeight(b.sessions) }"
          :title="`${b.period}: ${b.sessions} sessions`"
        ></div>
      </div>
    </div>

    <!-- Export Button -->
    <div class="analytics-actions">
      <button class="analytics-export-btn" @click="exportCsv">📥 Export CSV</button>
      <button class="analytics-refresh-btn" @click="loadAll">🔄 Refresh</button>
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

const stats = ref({
  total: 0, completed: 0, failed: 0, inProgress: 0,
  successRate: 0, avgDurationHuman: '—', totalCost: 0, costPerSession: 0,
});
const digest = ref(null);
const models = ref([]);
const timeseries = ref([]);

function barPercent(count) {
  if (!stats.value.total) return '0%';
  return `${Math.round((count / stats.value.total) * 100)}%`;
}

function sparkHeight(count) {
  const max = Math.max(...timeseries.value.map(b => b.sessions), 1);
  return `${Math.max(4, Math.round((count / max) * 40))}px`;
}

async function loadStats() {
  if (!props.projectSlug) return;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/analytics/stats`);
    if (res.ok) stats.value = await res.json();
  } catch { /* ignore */ }
}

async function loadDigest() {
  if (!props.projectSlug) return;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/analytics/digest`);
    if (res.ok) digest.value = await res.json();
  } catch { /* ignore */ }
}

async function loadModels() {
  if (!props.projectSlug) return;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/analytics/models`);
    if (res.ok) models.value = await res.json();
  } catch { /* ignore */ }
}

async function loadTimeseries() {
  if (!props.projectSlug) return;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/analytics/timeseries?granularity=day&periods=14`);
    if (res.ok) timeseries.value = await res.json();
  } catch { /* ignore */ }
}

async function loadAll() {
  await Promise.all([loadStats(), loadDigest(), loadModels(), loadTimeseries()]);
}

function exportCsv() {
  if (!props.projectSlug) return;
  window.open(`/api/projects/${props.projectSlug}/analytics/export`, '_blank');
}

watch(() => props.visible, (v) => { if (v) loadAll(); });
watch(() => props.projectSlug, () => { if (props.visible) loadAll(); });
onMounted(() => { if (props.visible) loadAll(); });
</script>

<style scoped>
.analytics-panel {
  padding: 1rem;
}
.analytics-panel h3 {
  margin: 0 0 1rem;
  color: var(--text-primary);
}
.analytics-panel h4 {
  margin: 0.75rem 0 0.5rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}
.analytics-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.analytics-stat-card {
  background: var(--bg-secondary);
  border-radius: 6px;
  padding: 0.6rem;
  text-align: center;
}
.analytics-stat-value {
  display: block;
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--text-primary);
}
.analytics-stat-card.success .analytics-stat-value {
  color: #22c55e;
}
.analytics-stat-label {
  display: block;
  font-size: 0.7rem;
  color: var(--text-secondary);
  margin-top: 2px;
}
.analytics-breakdown {
  margin-bottom: 0.75rem;
}
.analytics-bar-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 4px;
}
.analytics-bar-label {
  width: 70px;
  font-size: 0.75rem;
  color: var(--text-secondary);
}
.analytics-bar-track {
  flex: 1;
  height: 8px;
  background: var(--bg-tertiary, #374151);
  border-radius: 4px;
  overflow: hidden;
}
.analytics-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s;
}
.bar-success { background: #22c55e; }
.bar-danger { background: #ef4444; }
.bar-info { background: #3b82f6; }
.analytics-bar-count {
  width: 28px;
  text-align: right;
  font-size: 0.75rem;
  color: var(--text-primary);
}
.analytics-digest {
  background: var(--bg-secondary);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
}
.analytics-digest-trends {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.trend {
  font-size: 0.75rem;
  font-weight: 600;
}
.trend.up { color: #22c55e; }
.trend.down { color: #ef4444; }
.analytics-model-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--border-color, #374151);
  font-size: 0.8rem;
}
.analytics-model-name {
  flex: 1;
  color: var(--text-primary);
  font-weight: 600;
}
.analytics-model-count {
  color: var(--text-secondary);
}
.analytics-model-cost {
  color: var(--text-secondary);
  font-size: 0.7rem;
}
.analytics-sparkline {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 44px;
  padding: 2px 0;
}
.analytics-spark-bar {
  flex: 1;
  background: var(--accent-color, #3b82f6);
  border-radius: 2px 2px 0 0;
  min-height: 4px;
}
.analytics-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}
.analytics-export-btn,
.analytics-refresh-btn {
  flex: 1;
  padding: 6px 10px;
  font-size: 0.8rem;
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color, #4b5563);
  border-radius: 4px;
  cursor: pointer;
}
.analytics-export-btn:hover,
.analytics-refresh-btn:hover {
  background: var(--bg-tertiary, #4b5563);
}
</style>
