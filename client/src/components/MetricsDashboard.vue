<template>
  <div class="metrics-dashboard">
    <div class="panel-header">
      <h3>📊 Metrics & Reflections</h3>
      <button class="close-btn" @click="$emit('close')" title="Close">×</button>
    </div>

    <div class="panel-body" v-if="reflections.length > 0">
      <!-- Aggregate stats -->
      <div class="aggregate-section">
        <h4>Project Overview</h4>
        <div class="stats-grid">
          <div class="stat-card">
            <span class="stat-value">{{ totalSessions }}</span>
            <span class="stat-label">Sessions</span>
          </div>
          <div class="stat-card">
            <span class="stat-value">{{ avgSuccessRate }}%</span>
            <span class="stat-label">Avg Success</span>
          </div>
          <div class="stat-card">
            <span class="stat-value">{{ avgRetryRate }}</span>
            <span class="stat-label">Avg Retries</span>
          </div>
          <div class="stat-card">
            <span class="stat-value">{{ totalCost }}</span>
            <span class="stat-label">Total Cost</span>
          </div>
        </div>

        <!-- Tier usage breakdown -->
        <div class="tier-breakdown" v-if="aggregateTierUsage">
          <h4>Model Usage</h4>
          <div class="tier-bars">
            <div v-for="(count, tier) in aggregateTierUsage" :key="tier" class="tier-bar-row">
              <span :class="['tier-label', tier.toLowerCase()]">{{ tier }}</span>
              <div class="bar-track">
                <div
                  class="bar-fill"
                  :class="tier.toLowerCase()"
                  :style="{ width: tierPercent(count) + '%' }"
                ></div>
              </div>
              <span class="bar-count">{{ count }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Individual reflections -->
      <div class="reflections-section">
        <h4>Session Reflections</h4>
        <div
          v-for="r in reflections"
          :key="r.sessionId"
          class="reflection-card"
        >
          <div class="reflection-header">
            <span :class="['status-dot', r.status === 'mostly-succeeded' ? 'dot-success' : 'dot-warn']"></span>
            <span class="reflection-date">{{ formatDate(r.createdAt) }}</span>
            <span class="reflection-duration" v-if="r.durationMs">{{ formatDuration(r.durationMs) }}</span>
          </div>

          <div class="reflection-stats">
            <span class="r-stat">
              <span class="r-val success">{{ r.successCount || 0 }}</span> passed
            </span>
            <span class="r-stat">
              <span class="r-val fail">{{ r.failCount || 0 }}</span> failed
            </span>
            <span class="r-stat">
              <span class="r-val">{{ r.taskCount || 0 }}</span> tasks
            </span>
            <span class="r-stat" v-if="r.retryRate > 0">
              <span class="r-val warn">{{ r.retryRate }}</span> retry rate
            </span>
          </div>

          <!-- Escalated tasks -->
          <div v-if="r.escalatedTasks?.length" class="escalated-list">
            <span class="escalated-label">⬆ Escalated:</span>
            <span v-for="et in r.escalatedTasks" :key="et.taskId" class="escalated-chip">
              {{ et.label }} → {{ et.finalTier }} ({{ et.retriesNeeded }} retries)
            </span>
          </div>

          <!-- Cost breakdown -->
          <div v-if="r.costSummary" class="cost-row">
            <span class="cost-label">Cost:</span>
            <span class="cost-value">{{ r.costSummary.totalPremiumRequests }}×</span>
            <span class="cost-detail" v-for="(data, tier) in r.costSummary.byTier" :key="tier">
              {{ tier }}: {{ data.count }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <p>📭 No reflections yet</p>
      <span>Complete a session to see metrics here.</span>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { activeProject } from '../composables/useProjects.js';
import { projectReflections, fetchReflections } from '../composables/useProjectSettings.js';

const emit = defineEmits(['close']);

const reflections = computed(() => projectReflections.value || []);

const totalSessions = computed(() => reflections.value.length);

const avgSuccessRate = computed(() => {
  if (!reflections.value.length) return 0;
  const rates = reflections.value.map(r => {
    const total = (r.successCount || 0) + (r.failCount || 0);
    return total > 0 ? (r.successCount || 0) / total : 0;
  });
  return Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100);
});

const avgRetryRate = computed(() => {
  if (!reflections.value.length) return '0';
  const avg = reflections.value.reduce((sum, r) => sum + (r.retryRate || 0), 0) / reflections.value.length;
  return avg.toFixed(1);
});

const totalCost = computed(() => {
  const total = reflections.value.reduce((sum, r) => {
    return sum + (r.costSummary?.totalPremiumRequests || 0);
  }, 0);
  return total + '×';
});

const aggregateTierUsage = computed(() => {
  const usage = {};
  for (const r of reflections.value) {
    if (r.tierUsage) {
      for (const [tier, count] of Object.entries(r.tierUsage)) {
        usage[tier] = (usage[tier] || 0) + count;
      }
    }
  }
  return Object.keys(usage).length > 0 ? usage : null;
});

const maxTierCount = computed(() => {
  if (!aggregateTierUsage.value) return 1;
  return Math.max(...Object.values(aggregateTierUsage.value), 1);
});

function tierPercent(count) {
  return Math.round((count / maxTierCount.value) * 100);
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}m`;
}

onMounted(async () => {
  if (activeProject.value?.slug) {
    await fetchReflections(activeProject.value.slug);
  }
});
</script>

<style scoped>
.metrics-dashboard {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0a0a0f;
  color: #c0c0c0;
  font-size: 13px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #2a2a3e;
}

.panel-header h3 {
  margin: 0;
  font-size: 14px;
  color: #e0e0e0;
}

.close-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 18px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.close-btn:hover {
  background: #2a2a3e;
  color: #fff;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* ── Aggregate Stats ── */

.aggregate-section h4,
.reflections-section h4 {
  color: #888;
  font-size: 11px;
  text-transform: uppercase;
  font-weight: 600;
  margin: 0 0 12px;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 20px;
}

.stat-card {
  background: #16161e;
  border: 1px solid #2a2a3e;
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}

.stat-value {
  display: block;
  font-size: 20px;
  font-weight: 700;
  color: #e0e0e0;
  line-height: 1.2;
}

.stat-label {
  display: block;
  font-size: 10px;
  text-transform: uppercase;
  color: #555;
  margin-top: 4px;
}

/* ── Tier Breakdown ── */

.tier-breakdown {
  margin-bottom: 20px;
}

.tier-bars {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tier-bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tier-label {
  width: 28px;
  font-size: 11px;
  font-weight: 600;
  text-align: right;
}
.tier-label.t0 { color: #6ecf6e; }
.tier-label.t1 { color: #f5c542; }
.tier-label.t2 { color: #4a9eff; }
.tier-label.t3 { color: #c07ef5; }

.bar-track {
  flex: 1;
  height: 8px;
  background: #16161e;
  border-radius: 4px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}
.bar-fill.t0 { background: #2a4a2a; }
.bar-fill.t1 { background: #4a3a1a; }
.bar-fill.t2 { background: #1a3a6a; }
.bar-fill.t3 { background: #3a1a5a; }

.bar-count {
  width: 24px;
  font-size: 11px;
  color: #666;
  text-align: right;
}

/* ── Reflections ── */

.reflections-section {
  border-top: 1px solid #1a1a2e;
  padding-top: 16px;
}

.reflection-card {
  background: #16161e;
  border: 1px solid #2a2a3e;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 8px;
}

.reflection-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dot-success { background: #4caf50; }
.dot-warn { background: #ff9800; }

.reflection-date {
  font-size: 12px;
  color: #888;
}

.reflection-duration {
  font-size: 11px;
  color: #555;
  margin-left: auto;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}

.reflection-stats {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.r-stat {
  font-size: 12px;
  color: #666;
}

.r-val {
  font-weight: 600;
  color: #c0c0c0;
}
.r-val.success { color: #6ecf6e; }
.r-val.fail { color: #f56a6a; }
.r-val.warn { color: #f5c542; }

.escalated-list {
  margin-top: 8px;
  font-size: 11px;
}

.escalated-label {
  color: #f5c542;
  margin-right: 6px;
}

.escalated-chip {
  display: inline-block;
  background: #2a2a1a;
  border: 1px solid #3a3a2a;
  border-radius: 4px;
  padding: 2px 6px;
  margin: 2px;
  font-size: 11px;
  color: #c0a040;
}

.cost-row {
  margin-top: 8px;
  font-size: 11px;
  color: #666;
  display: flex;
  gap: 8px;
  align-items: center;
}

.cost-label {
  color: #555;
}

.cost-value {
  color: #f5c542;
  font-weight: 600;
}

.cost-detail {
  color: #555;
}

/* ── Empty ── */

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 32px;
  text-align: center;
}

.empty-state p {
  font-size: 16px;
  color: #666;
  margin: 0 0 8px;
}

.empty-state span {
  font-size: 12px;
  color: #444;
}
</style>
