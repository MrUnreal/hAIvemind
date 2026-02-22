<template>
  <div v-if="visible" class="bench-panel">
    <div class="bench-header">
      <h3>📊 Performance Benchmarks</h3>
      <button class="bench-close" @click="$emit('close')">✕</button>
    </div>

    <div v-if="loading" class="bench-loading">Loading benchmarks…</div>
    <div v-else-if="!data || data.totalSessions === 0" class="bench-empty">
      No completed sessions to benchmark yet.
    </div>
    <template v-else>
      <!-- Averages Summary -->
      <div class="bench-averages">
        <div class="bench-stat">
          <span class="bench-stat-label">Avg Duration</span>
          <span class="bench-stat-value">{{ formatDuration(data.averages.duration) }}</span>
        </div>
        <div class="bench-stat">
          <span class="bench-stat-label">Avg Cost</span>
          <span class="bench-stat-value">{{ data.averages.cost }} reqs</span>
        </div>
        <div class="bench-stat">
          <span class="bench-stat-label">Avg Tasks</span>
          <span class="bench-stat-value">{{ data.averages.taskCount }}</span>
        </div>
        <div class="bench-stat">
          <span class="bench-stat-label">Sessions</span>
          <span class="bench-stat-value">{{ data.totalSessions }}</span>
        </div>
      </div>

      <!-- Regression Alerts -->
      <div v-if="data.regressions.length > 0" class="bench-regressions">
        <h4>⚠️ Regression Alerts</h4>
        <div v-for="r in data.regressions" :key="r.metric" class="bench-regression-item"
             :class="'bench-sev-' + r.severity">
          <span class="bench-reg-metric">{{ r.metric }}</span>
          <span class="bench-reg-change">+{{ r.changePercent }}%</span>
          <span class="bench-reg-msg">{{ r.message }}</span>
        </div>
      </div>

      <!-- Duration Trend -->
      <div class="bench-trend-section">
        <h4>⏱️ Duration Trend</h4>
        <div class="bench-trend-chart">
          <div v-for="(d, i) in data.trends.duration" :key="'dur-' + i"
               class="bench-bar-col" :title="d.sessionId">
            <div class="bench-bar" :class="'bench-status-' + d.status"
                 :style="{ height: barHeight(d.value, maxDuration) }"></div>
            <span class="bench-bar-label">{{ shortDuration(d.value) }}</span>
          </div>
        </div>
      </div>

      <!-- Cost Trend -->
      <div class="bench-trend-section">
        <h4>💰 Cost Trend</h4>
        <div class="bench-trend-chart">
          <div v-for="(c, i) in data.trends.cost" :key="'cost-' + i"
               class="bench-bar-col" :title="c.sessionId">
            <div class="bench-bar bench-bar-cost"
                 :style="{ height: barHeight(c.value, maxCost) }"></div>
            <span class="bench-bar-label">{{ c.value }}</span>
          </div>
        </div>
      </div>

      <!-- Model Comparison -->
      <div v-if="data.modelComparison.length > 0" class="bench-models">
        <h4>🤖 Model Tier Comparison</h4>
        <table class="bench-model-table">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Sessions</th>
              <th>Requests</th>
              <th>Avg Reqs</th>
              <th>Success %</th>
              <th>Avg Duration</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in data.modelComparison" :key="m.tier" class="bench-model-row">
              <td class="bench-tier-name">{{ m.tier }}</td>
              <td>{{ m.sessions }}</td>
              <td>{{ m.totalRequests }}</td>
              <td>{{ m.avgRequestsPerSession }}</td>
              <td :class="successRateClass(m.successRate)">{{ m.successRate }}%</td>
              <td>{{ m.avgDuration ? formatDuration(m.avgDuration) : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Summary -->
      <div class="bench-summary">
        <div v-if="data.summary.fastest" class="bench-summary-item">
          🏆 Fastest: <code>{{ data.summary.fastest }}</code>
        </div>
        <div v-if="data.summary.cheapest" class="bench-summary-item">
          💚 Cheapest: <code>{{ data.summary.cheapest }}</code>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue';

const props = defineProps({ visible: Boolean, projectSlug: String });
const emit = defineEmits(['close']);

const data = ref(null);
const loading = ref(false);

async function loadBenchmarks() {
  if (!props.projectSlug) return;
  loading.value = true;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/benchmarks`);
    if (res.ok) data.value = await res.json();
  } catch { /* ignore */ }
  loading.value = false;
}

const maxDuration = computed(() => {
  if (!data.value) return 1;
  const vals = data.value.trends.duration.filter(d => d.value !== null).map(d => d.value);
  return Math.max(...vals, 1);
});

const maxCost = computed(() => {
  if (!data.value) return 1;
  const vals = data.value.trends.cost.map(c => c.value);
  return Math.max(...vals, 1);
});

function barHeight(value, max) {
  if (value === null || value === 0) return '2px';
  return `${Math.max(4, Math.round((value / max) * 60))}px`;
}

function formatDuration(ms) {
  if (ms == null || ms <= 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function shortDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${Math.floor(ms / 60000)}m`;
}

function successRateClass(rate) {
  if (rate >= 80) return 'bench-rate-good';
  if (rate >= 50) return 'bench-rate-warn';
  return 'bench-rate-bad';
}

watch(() => props.visible, v => { if (v) loadBenchmarks(); });
</script>

<style scoped>
.bench-panel { background: #1e1e2e; border: 1px solid #444; border-radius: 8px; padding: 16px; margin: 12px 0; }
.bench-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.bench-header h3 { margin: 0; color: #e0e0e0; }
.bench-close { background: none; border: none; color: #888; cursor: pointer; font-size: 18px; }
.bench-loading { color: #888; text-align: center; padding: 20px; }
.bench-empty { color: #666; font-style: italic; text-align: center; padding: 20px; }

.bench-averages { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.bench-stat { background: #262636; border-radius: 6px; padding: 10px 14px; flex: 1; min-width: 100px; text-align: center; }
.bench-stat-label { display: block; font-size: 11px; color: #888; text-transform: uppercase; margin-bottom: 4px; }
.bench-stat-value { display: block; font-size: 18px; font-weight: 600; color: #e0e0e0; }

.bench-regressions { background: #2a1a1a; border: 1px solid #ff6b6b44; border-radius: 6px; padding: 10px; margin-bottom: 12px; }
.bench-regressions h4 { margin: 0 0 8px; color: #ff6b6b; font-size: 14px; }
.bench-regression-item { display: flex; gap: 8px; align-items: center; padding: 4px 0; font-size: 13px; }
.bench-reg-metric { font-weight: 600; color: #ffa94d; text-transform: capitalize; }
.bench-reg-change { color: #ff6b6b; font-weight: 600; }
.bench-reg-msg { color: #ccc; }
.bench-sev-high { border-left: 3px solid #ff6b6b; padding-left: 8px; }
.bench-sev-medium { border-left: 3px solid #ffa94d; padding-left: 8px; }

.bench-trend-section { margin-bottom: 14px; }
.bench-trend-section h4 { margin: 0 0 8px; color: #ccc; font-size: 13px; }
.bench-trend-chart { display: flex; gap: 3px; align-items: flex-end; min-height: 70px; background: #1a1a2a; border-radius: 4px; padding: 8px; overflow-x: auto; }
.bench-bar-col { display: flex; flex-direction: column; align-items: center; min-width: 16px; }
.bench-bar { width: 12px; border-radius: 2px 2px 0 0; transition: height 0.3s; }
.bench-status-completed { background: #51cf66; }
.bench-status-failed { background: #ff6b6b; }
.bench-bar-cost { background: #4c8dff; }
.bench-bar-label { font-size: 9px; color: #666; margin-top: 2px; }

.bench-models { margin-bottom: 14px; }
.bench-models h4 { margin: 0 0 8px; color: #ccc; font-size: 13px; }
.bench-model-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.bench-model-table th { text-align: left; padding: 6px 8px; color: #888; border-bottom: 1px solid #333; }
.bench-model-table td { padding: 6px 8px; color: #ccc; border-bottom: 1px solid #262636; }
.bench-tier-name { font-weight: 600; color: #e0e0e0; }
.bench-rate-good { color: #51cf66; }
.bench-rate-warn { color: #ffa94d; }
.bench-rate-bad { color: #ff6b6b; }

.bench-summary { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: #ccc; }
.bench-summary code { background: #262636; padding: 1px 6px; border-radius: 3px; font-size: 11px; }
</style>
