<template>
  <div v-if="visible" class="resource-panel">
    <h3>📊 Resource Monitor</h3>

    <!-- System Overview -->
    <div class="resource-gauges">
      <div class="gauge">
        <div class="gauge-ring" :style="ringStyle(metrics.cpu?.percent)">
          <span class="gauge-value">{{ metrics.cpu?.percent || 0 }}%</span>
        </div>
        <span class="gauge-label">CPU</span>
      </div>
      <div class="gauge">
        <div class="gauge-ring" :style="ringStyle(metrics.memory?.percent)">
          <span class="gauge-value">{{ metrics.memory?.percent || 0 }}%</span>
        </div>
        <span class="gauge-label">Memory</span>
      </div>
      <div class="gauge">
        <div class="gauge-ring" :style="ringStyle(metrics.disk?.percent)">
          <span class="gauge-value">{{ metrics.disk?.percent || 0 }}%</span>
        </div>
        <span class="gauge-label">Disk</span>
      </div>
    </div>

    <!-- System Info -->
    <div class="resource-info">
      <div class="info-row">
        <span>CPU</span>
        <span :title="metrics.cpu?.model || ''">{{ metrics.cpu?.count || 0 }} cores · {{ shortModel(metrics.cpu?.model) }}</span>
      </div>
      <div class="info-row">
        <span>Memory</span>
        <span>{{ formatBytes(metrics.memory?.used) }} / {{ formatBytes(metrics.memory?.total) }}</span>
      </div>
      <div class="info-row">
        <span>Load Avg</span>
        <span>{{ (metrics.loadAvg?.['1m'] || 0).toFixed(2) }} · {{ (metrics.loadAvg?.['5m'] || 0).toFixed(2) }} · {{ (metrics.loadAvg?.['15m'] || 0).toFixed(2) }}</span>
      </div>
      <div class="info-row">
        <span>Node.js Heap</span>
        <span>{{ formatBytes(metrics.nodeMemory?.heapUsed) }} / {{ formatBytes(metrics.nodeMemory?.heapTotal) }}</span>
      </div>
      <div class="info-row">
        <span>Uptime</span>
        <span>{{ formatDuration(metrics.uptime) }}</span>
      </div>
    </div>

    <!-- Alerts -->
    <div v-if="alerts.length" class="resource-alerts">
      <div class="alerts-header">
        <h4>⚠️ Alerts ({{ alerts.length }})</h4>
        <button class="alerts-clear-btn" @click="doClearAlerts">Clear</button>
      </div>
      <div v-for="(a, i) in alerts" :key="i" class="alert-card" :class="a.level">
        <span class="alert-level">{{ a.level }}</span>
        <span class="alert-msg">{{ a.message }}</span>
        <span class="alert-time">{{ formatTime(a.timestamp) }}</span>
      </div>
    </div>

    <!-- Tracked Processes -->
    <div class="resource-processes">
      <h4>🔄 Tracked Processes ({{ processes.length }})</h4>
      <div v-if="!processes.length" class="resource-empty">No tracked processes.</div>
      <div v-for="p in processes" :key="p.pid" class="process-card">
        <div class="process-info">
          <strong>{{ p.label }}</strong>
          <span class="process-pid">PID {{ p.pid }}</span>
          <span class="process-runtime">{{ formatDuration(p.runtimeSec) }}</span>
        </div>
        <button class="process-kill-btn" @click="doKill(p.pid)">Kill</button>
      </div>
    </div>

    <!-- Actions -->
    <div class="resource-actions">
      <button class="resource-btn" @click="refresh">🔄 Refresh</button>
      <button class="resource-btn" @click="doSnapshot">📸 Snapshot</button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  visible: Boolean,
  projectSlug: String,
});

const emit = defineEmits(['close']);

const metrics = ref({});
const alerts = ref([]);
const processes = ref([]);
let pollTimer;

function ringStyle(percent = 0) {
  const color = percent > 90 ? '#ef4444' : percent > 70 ? '#f59e0b' : '#22c55e';
  return {
    background: `conic-gradient(${color} ${percent * 3.6}deg, var(--bg-tertiary, #374151) 0deg)`,
  };
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDuration(sec) {
  if (!sec) return '0s';
  sec = Math.round(sec);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString();
}

function shortModel(model) {
  if (!model) return 'Unknown';
  return model.replace(/\(R\)|\(TM\)|CPU|@.*$/gi, '').trim().slice(0, 48);
}

async function loadMetrics() {
  try {
    const res = await fetch('/api/resources/system');
    if (res.ok) metrics.value = await res.json();
  } catch { /* ignore */ }
}

async function loadAlerts() {
  try {
    const res = await fetch('/api/resources/alerts');
    if (res.ok) alerts.value = await res.json();
  } catch { /* ignore */ }
}

async function loadProcesses() {
  try {
    const res = await fetch('/api/resources/processes');
    if (res.ok) processes.value = await res.json();
  } catch { /* ignore */ }
}

async function doSnapshot() {
  try {
    await fetch('/api/resources/snapshots', { method: 'POST' });
    refresh();
  } catch { /* ignore */ }
}

async function doClearAlerts() {
  try {
    await fetch('/api/resources/alerts', { method: 'DELETE' });
    alerts.value = [];
  } catch { /* ignore */ }
}

async function doKill(pid) {
  try {
    await fetch(`/api/resources/processes/${pid}`, { method: 'DELETE' });
    loadProcesses();
  } catch { /* ignore */ }
}

function refresh() {
  loadMetrics();
  loadAlerts();
  loadProcesses();
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(refresh, 5000);
}

function stopPolling() {
  clearInterval(pollTimer);
}

watch(() => props.visible, (v) => {
  if (v) { refresh(); startPolling(); }
  else stopPolling();
});

onMounted(() => { if (props.visible) { refresh(); startPolling(); } });
onUnmounted(() => stopPolling());
</script>

<style scoped>
.resource-panel { padding: 1rem; }
.resource-panel h3 { margin: 0 0 0.75rem; color: var(--text-primary); }
.resource-panel h4 { margin: 0 0 0.5rem; font-size: 0.85rem; color: var(--text-secondary); }
.resource-gauges {
  display: flex; gap: 1rem; justify-content: center;
  margin-bottom: 1rem;
}
.gauge { text-align: center; }
.gauge-ring {
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.gauge-value {
  font-size: 0.85rem; font-weight: 700; color: var(--text-primary);
  background: var(--bg-primary, #111827); border-radius: 50%;
  width: 48px; height: 48px;
  display: flex; align-items: center; justify-content: center;
}
.gauge-label { font-size: 0.7rem; color: var(--text-secondary); margin-top: 4px; display: block; }
.resource-info {
  background: var(--bg-secondary); border-radius: 6px;
  padding: 0.5rem 0.75rem; margin-bottom: 0.75rem;
}
.info-row {
  display: flex; justify-content: space-between;
  font-size: 0.75rem; padding: 3px 0;
  color: var(--text-secondary); gap: 0.5rem;
}
.info-row span:first-child { font-weight: 600; color: var(--text-primary); white-space: nowrap; }
.info-row span:last-child { text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.resource-alerts { margin-bottom: 0.75rem; }
.alerts-header { display: flex; justify-content: space-between; align-items: center; }
.alerts-clear-btn {
  font-size: 0.65rem; padding: 2px 6px;
  background: #ef444422; color: #ef4444;
  border: 1px solid #ef444444; border-radius: 3px; cursor: pointer;
}
.alert-card {
  display: flex; gap: 0.4rem; align-items: center;
  padding: 4px 8px; margin-bottom: 3px;
  border-radius: 4px; font-size: 0.75rem;
}
.alert-card.critical { background: #ef444422; }
.alert-card.warning { background: #f59e0b22; }
.alert-card.info { background: #3b82f622; }
.alert-level {
  font-weight: 600; font-size: 0.65rem; text-transform: uppercase;
  padding: 1px 4px; border-radius: 3px;
}
.alert-card.critical .alert-level { color: #ef4444; }
.alert-card.warning .alert-level { color: #f59e0b; }
.alert-card.info .alert-level { color: #60a5fa; }
.alert-msg { flex: 1; color: var(--text-primary); }
.alert-time { font-size: 0.65rem; color: var(--text-secondary); }
.resource-processes { margin-bottom: 0.75rem; }
.resource-empty {
  font-size: 0.8rem; color: var(--text-secondary);
  font-style: italic; padding: 0.5rem 0;
}
.process-card {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 8px; margin-bottom: 4px;
  background: var(--bg-secondary); border-radius: 4px;
}
.process-info { display: flex; gap: 0.5rem; align-items: center; font-size: 0.8rem; }
.process-info strong { color: var(--text-primary); }
.process-pid { font-size: 0.7rem; color: var(--text-secondary); }
.process-runtime { font-size: 0.7rem; color: var(--accent-color, #3b82f6); }
.process-kill-btn {
  font-size: 0.7rem; padding: 3px 8px;
  background: #ef444433; color: #ef4444;
  border: 1px solid #ef444444; border-radius: 3px; cursor: pointer;
}
.resource-actions {
  display: flex; gap: 0.5rem;
}
.resource-btn {
  flex: 1; padding: 6px; font-size: 0.8rem;
  background: var(--bg-secondary); color: var(--text-primary);
  border: 1px solid var(--border-color, #4b5563); border-radius: 4px; cursor: pointer;
}
</style>
