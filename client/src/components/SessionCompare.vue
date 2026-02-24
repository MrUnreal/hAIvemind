<template>
  <div class="session-compare" v-if="visible">
    <div class="compare-header">
      <h3>📊 Session Comparison</h3>
      <button class="close-btn" @click="$emit('close')">✕</button>
    </div>

    <div v-if="loading" class="compare-loading">Loading comparison...</div>
    <div v-else-if="error" class="compare-error">{{ error }}</div>
    <div v-else-if="data" class="compare-body">
      <!-- Session Info -->
      <div class="compare-section">
        <h4>Sessions</h4>
        <div class="compare-grid">
          <div class="compare-card" :class="data.sessions.a.status">
            <div class="card-label">A</div>
            <div class="card-prompt">{{ data.sessions.a.prompt }}</div>
            <div class="card-meta">{{ data.sessions.a.status }} · {{ data.sessions.a.project }}</div>
          </div>
          <div class="compare-card" :class="data.sessions.b.status">
            <div class="card-label">B</div>
            <div class="card-prompt">{{ data.sessions.b.prompt }}</div>
            <div class="card-meta">{{ data.sessions.b.status }} · {{ data.sessions.b.project }}</div>
          </div>
        </div>
      </div>

      <!-- Metrics Row -->
      <div class="compare-section">
        <h4>Metrics</h4>
        <div class="metrics-row">
          <div class="metric">
            <span class="metric-label">Tasks</span>
            <span class="metric-val">{{ data.tasks.countA }}</span>
            <span class="metric-vs">vs</span>
            <span class="metric-val">{{ data.tasks.countB }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Agents</span>
            <span class="metric-val">{{ data.agents.countA }}</span>
            <span class="metric-vs">vs</span>
            <span class="metric-val">{{ data.agents.countB }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Premium Requests</span>
            <span class="metric-val">{{ data.cost.premiumA }}</span>
            <span class="metric-vs">vs</span>
            <span class="metric-val">{{ data.cost.premiumB }}</span>
            <span class="metric-delta" :class="data.cost.delta > 0 ? 'up' : data.cost.delta < 0 ? 'down' : ''">
              {{ data.cost.delta > 0 ? '+' : '' }}{{ data.cost.delta }}
            </span>
          </div>
          <div class="metric" v-if="data.duration.a != null || data.duration.b != null">
            <span class="metric-label">Duration</span>
            <span class="metric-val">{{ formatDuration(data.duration.a) }}</span>
            <span class="metric-vs">vs</span>
            <span class="metric-val">{{ formatDuration(data.duration.b) }}</span>
          </div>
        </div>
      </div>

      <!-- Task Overlap -->
      <div class="compare-section">
        <h4>Task Overlap ({{ data.tasks.overlapPct }}%)</h4>
        <div class="overlap-bar">
          <div class="overlap-fill" :style="{ width: data.tasks.overlapPct + '%' }"></div>
        </div>
        <div class="overlap-lists" v-if="data.tasks.shared.length || data.tasks.onlyA.length || data.tasks.onlyB.length">
          <div v-if="data.tasks.shared.length" class="overlap-group">
            <span class="overlap-tag shared">Shared ({{ data.tasks.shared.length }})</span>
            <span class="task-label" v-for="t in data.tasks.shared" :key="t">{{ t }}</span>
          </div>
          <div v-if="data.tasks.onlyA.length" class="overlap-group">
            <span class="overlap-tag only-a">Only A ({{ data.tasks.onlyA.length }})</span>
            <span class="task-label" v-for="t in data.tasks.onlyA" :key="t">{{ t }}</span>
          </div>
          <div v-if="data.tasks.onlyB.length" class="overlap-group">
            <span class="overlap-tag only-b">Only B ({{ data.tasks.onlyB.length }})</span>
            <span class="task-label" v-for="t in data.tasks.onlyB" :key="t">{{ t }}</span>
          </div>
        </div>
      </div>

      <!-- Model Usage -->
      <div class="compare-section">
        <h4>Model Tiers</h4>
        <div class="tier-compare">
          <div class="tier-row" v-for="tier in allTiers" :key="tier">
            <span class="tier-name">{{ tier }}</span>
            <span class="tier-count a">{{ data.models.a[tier] || 0 }}</span>
            <span class="tier-bar">
              <span class="bar-a" :style="{ width: barWidth(data.models.a[tier] || 0) }"></span>
              <span class="bar-b" :style="{ width: barWidth(data.models.b[tier] || 0) }"></span>
            </span>
            <span class="tier-count b">{{ data.models.b[tier] || 0 }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  visible: Boolean,
  sessionA: Object,
  sessionB: Object,
  projectA: String,
  projectB: String,
});

defineEmits(['close']);

const data = ref(null);
const loading = ref(false);
const error = ref(null);

const allTiers = computed(() => {
  if (!data.value) return [];
  const tiers = new Set([
    ...Object.keys(data.value.models.a),
    ...Object.keys(data.value.models.b),
  ]);
  return ['T0', 'T1', 'T2', 'T3'].filter(t => tiers.has(t));
});

function formatDuration(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function barWidth(count) {
  const max = Math.max(
    ...Object.values(data.value?.models?.a || {}),
    ...Object.values(data.value?.models?.b || {}),
    1,
  );
  return `${Math.round((count / max) * 100)}%`;
}

async function loadComparison() {
  if (!props.sessionA?.id || !props.sessionB?.id) return;
  loading.value = true;
  error.value = null;
  try {
    const params = new URLSearchParams({
      a: props.sessionA.id,
      b: props.sessionB.id,
      projectA: props.projectA || '',
      projectB: props.projectB || '',
    });
    const res = await fetch(`/api/sessions/compare?${params}`);
    if (!res.ok) throw new Error((await res.json()).error || 'Comparison failed');
    data.value = await res.json();
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

watch(() => [props.visible, props.sessionA, props.sessionB], () => {
  if (props.visible && props.sessionA && props.sessionB) {
    loadComparison();
  }
}, { immediate: true });
</script>

<style scoped>
.session-compare {
  background: var(--border-primary);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 16px;
  margin: 12px 0;
}
.compare-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.compare-header h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 14px;
}
.close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
}
.close-btn:hover { color: #fff; }
.compare-loading, .compare-error {
  color: var(--text-muted);
  font-size: 13px;
  padding: 8px 0;
}
.compare-error { color: #f44; }
.compare-section {
  margin-bottom: 16px;
}
.compare-section h4 {
  color: var(--text-secondary);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 8px 0;
}
.compare-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.compare-card {
  background: var(--border-primary);
  border-radius: 6px;
  padding: 10px;
  border-left: 3px solid var(--text-tertiary);
}
.compare-card.completed { border-left-color: #4caf50; }
.compare-card.failed { border-left-color: #f44336; }
.card-label {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: bold;
  margin-bottom: 4px;
}
.card-prompt {
  color: var(--text-primary);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-meta {
  color: var(--text-tertiary);
  font-size: 11px;
  margin-top: 4px;
}
.metrics-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.metric {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--border-primary);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
}
.metric-label {
  color: var(--text-muted);
  margin-right: 4px;
}
.metric-val { color: var(--text-primary); font-weight: bold; }
.metric-vs { color: var(--text-tertiary); font-size: 11px; }
.metric-delta {
  font-size: 11px;
  margin-left: 4px;
}
.metric-delta.up { color: #f44336; }
.metric-delta.down { color: #4caf50; }
.overlap-bar {
  height: 6px;
  background: var(--border-subtle);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
}
.overlap-fill {
  height: 100%;
  background: #4caf50;
  border-radius: 3px;
  transition: width 0.3s;
}
.overlap-lists { display: flex; flex-direction: column; gap: 6px; }
.overlap-group { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.overlap-tag {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: bold;
}
.overlap-tag.shared { background: #1b5e20; color: #a5d6a7; }
.overlap-tag.only-a { background: #1a237e; color: #9fa8da; }
.overlap-tag.only-b { background: #4a148c; color: #ce93d8; }
.task-label {
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--border-secondary);
  padding: 2px 6px;
  border-radius: 3px;
}
.tier-compare { display: flex; flex-direction: column; gap: 4px; }
.tier-row {
  display: grid;
  grid-template-columns: 40px 30px 1fr 30px;
  gap: 8px;
  align-items: center;
  font-size: 12px;
}
.tier-name { color: var(--text-muted); font-weight: bold; }
.tier-count { text-align: center; }
.tier-count.a { color: #64b5f6; }
.tier-count.b { color: #ba68c8; }
.tier-bar {
  display: flex;
  height: 8px;
  gap: 2px;
}
.bar-a {
  background: #64b5f6;
  border-radius: 2px;
  height: 100%;
  min-width: 2px;
}
.bar-b {
  background: #ba68c8;
  border-radius: 2px;
  height: 100%;
  min-width: 2px;
}
</style>
