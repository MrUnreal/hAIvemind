<template>
  <div class="cost-chart">
    <div class="chart-header">
      <h4>Cost History</h4>
      <div class="chart-legend">
        <span class="legend-item"><span class="dot t0"></span> T0 (Free)</span>
        <span class="legend-item"><span class="dot t1"></span> T1</span>
        <span class="legend-item"><span class="dot t2"></span> T2</span>
        <span class="legend-item"><span class="dot t3"></span> T3</span>
      </div>
    </div>

    <div v-if="loading" class="chart-loading">Loading cost data...</div>

    <div v-else-if="entries.length === 0" class="chart-empty">
      No session cost data yet.
    </div>

    <template v-else>
      <!-- Totals summary -->
      <div class="totals-row">
        <span class="total-item" v-for="(count, tier) in totals" :key="tier">
          <span :class="['total-tier', tier.toLowerCase()]">{{ tier }}</span>
          <span class="total-count">{{ count }}</span>
        </span>
      </div>

      <!-- Bar chart -->
      <div class="chart-area">
        <div class="y-axis">
          <span class="y-label">{{ maxAgents }}</span>
          <span class="y-label">{{ Math.ceil(maxAgents / 2) }}</span>
          <span class="y-label">0</span>
        </div>

        <div class="bars-container">
          <div
            v-for="(entry, i) in entries"
            :key="entry.sessionId"
            class="bar-wrapper"
            :title="barTooltip(entry)"
            @mouseenter="hoveredIdx = i"
            @mouseleave="hoveredIdx = -1"
          >
            <!-- Stacked bar segments -->
            <div class="stacked-bar" :style="{ height: barHeight(entry) + '%' }">
              <div
                v-if="entry.tiers.T3 > 0"
                class="bar-segment t3"
                :style="{ height: segmentPercent(entry, 'T3') + '%' }"
              ></div>
              <div
                v-if="entry.tiers.T2 > 0"
                class="bar-segment t2"
                :style="{ height: segmentPercent(entry, 'T2') + '%' }"
              ></div>
              <div
                v-if="entry.tiers.T1 > 0"
                class="bar-segment t1"
                :style="{ height: segmentPercent(entry, 'T1') + '%' }"
              ></div>
              <div
                v-if="entry.tiers.T0 > 0"
                class="bar-segment t0"
                :style="{ height: segmentPercent(entry, 'T0') + '%' }"
              ></div>
            </div>

            <!-- X-axis label -->
            <span class="x-label" v-if="shouldShowLabel(i)">
              {{ formatDate(entry.createdAt) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Hover detail -->
      <div v-if="hoveredIdx >= 0 && entries[hoveredIdx]" class="hover-detail">
        <div class="detail-prompt">{{ entries[hoveredIdx].prompt || 'Untitled' }}</div>
        <div class="detail-stats">
          <span :class="['detail-pill', `pill-${entries[hoveredIdx].status}`]">
            {{ entries[hoveredIdx].status }}
          </span>
          <span>{{ entries[hoveredIdx].taskCount }} {{ entries[hoveredIdx].taskCount === 1 ? 'task' : 'tasks' }}</span>
          <span v-for="(count, tier) in entries[hoveredIdx].tiers" :key="tier" v-show="count > 0">
            <span :class="['tier-badge', tier.toLowerCase()]">{{ tier }}: {{ count }}</span>
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';

const props = defineProps({
  projectSlug: { type: String, required: true },
});

const loading = ref(false);
const entries = ref([]);
const totals = ref({});
const hoveredIdx = ref(-1);

const maxAgents = computed(() => {
  if (entries.value.length === 0) return 1;
  const max = Math.max(
    ...entries.value.map(e =>
      (e.tiers.T0 || 0) + (e.tiers.T1 || 0) + (e.tiers.T2 || 0) + (e.tiers.T3 || 0)
    ),
    1,
  );
  return max;
});

function barHeight(entry) {
  const total = (entry.tiers.T0 || 0) + (entry.tiers.T1 || 0) +
                (entry.tiers.T2 || 0) + (entry.tiers.T3 || 0);
  if (total === 0) return 3; // minimum visible bar
  return Math.max((total / maxAgents.value) * 100, 3);
}

function segmentPercent(entry, tier) {
  const total = (entry.tiers.T0 || 0) + (entry.tiers.T1 || 0) +
                (entry.tiers.T2 || 0) + (entry.tiers.T3 || 0);
  if (total === 0) return 0;
  return (entry.tiers[tier] / total) * 100;
}

function shouldShowLabel(i) {
  const count = entries.value.length;
  if (count <= 10) return true;
  if (count <= 20) return i % 2 === 0;
  return i % Math.ceil(count / 10) === 0;
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function barTooltip(entry) {
  const parts = [`${entry.prompt || 'Session'}`];
  parts.push(`Status: ${entry.status}`);
  parts.push(`Tasks: ${entry.taskCount}`);
  for (const [tier, count] of Object.entries(entry.tiers)) {
    if (count > 0) parts.push(`${tier}: ${count} agents`);
  }
  return parts.join('\n');
}

async function fetchCostHistory() {
  loading.value = true;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/cost-history`);
    if (res.ok) {
      const data = await res.json();
      entries.value = data.entries || [];
      totals.value = data.totals || {};
    }
  } catch (err) {
    console.error('[cost-chart] Failed to fetch:', err);
  } finally {
    loading.value = false;
  }
}

onMounted(fetchCostHistory);
watch(() => props.projectSlug, fetchCostHistory);
</script>

<style scoped>
.cost-chart {
  margin-bottom: 20px;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.chart-header h4 {
  color: var(--text-muted);
  font-size: 11px;
  text-transform: uppercase;
  font-weight: 600;
  margin: 0;
}

.chart-legend {
  display: flex;
  gap: 10px;
  font-size: 10px;
  color: var(--text-tertiary);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
.dot.t0 { background: #4caf50; }
.dot.t1 { background: #f5c542; }
.dot.t2 { background: #4a9eff; }
.dot.t3 { background: #c07ef5; }

.chart-loading, .chart-empty {
  padding: 16px 0;
  color: var(--text-tertiary);
  font-size: 12px;
  text-align: center;
}

.totals-row {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border-radius: 6px;
  border: 1px solid var(--border-secondary);
}

.total-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.total-tier {
  font-weight: 600;
  font-size: 11px;
}
.total-tier.t0 { color: #6ecf6e; }
.total-tier.t1 { color: #f5c542; }
.total-tier.t2 { color: #4a9eff; }
.total-tier.t3 { color: #c07ef5; }
.total-tier.total { color: var(--text-primary); }

.total-count {
  color: #c0c0c0;
  font-weight: 500;
}

.chart-area {
  display: flex;
  gap: 4px;
  height: 140px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  padding: 8px;
}

.y-axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 24px;
  padding-right: 4px;
}

.y-label {
  font-size: 9px;
  color: var(--border-input);
  text-align: right;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}

.bars-container {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  padding-bottom: 16px;
  position: relative;
}

.bar-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
  cursor: pointer;
  min-width: 4px;
  position: relative;
}

.bar-wrapper:hover .stacked-bar {
  filter: brightness(1.3);
}

.stacked-bar {
  width: 100%;
  max-width: 24px;
  min-width: 3px;
  border-radius: 2px 2px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: filter 0.15s;
}

.bar-segment {
  width: 100%;
}
.bar-segment.t0 { background: #4caf50; }
.bar-segment.t1 { background: #f5c542; }
.bar-segment.t2 { background: #4a9eff; }
.bar-segment.t3 { background: #c07ef5; }

.x-label {
  position: absolute;
  bottom: -14px;
  font-size: 8px;
  color: var(--border-input);
  white-space: nowrap;
  transform: rotate(-30deg);
  transform-origin: top left;
}

.hover-detail {
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-secondary);
  border-radius: 6px;
  font-size: 12px;
}

.detail-prompt {
  color: var(--text-primary);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-stats {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  color: var(--text-muted);
  font-size: 11px;
}

.detail-pill {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
}
.pill-completed { background: #1b4332; color: #95d5b2; }
.pill-failed { background: #3d0000; color: #ff8888; }

.tier-badge {
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
}
.tier-badge.t0 { background: #1a3a1a; color: #6ecf6e; }
.tier-badge.t1 { background: #3a2a0a; color: #f5c542; }
.tier-badge.t2 { background: #0a2a5a; color: #4a9eff; }
.tier-badge.t3 { background: #2a0a4a; color: #c07ef5; }
</style>
