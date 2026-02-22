<template>
  <div v-if="visible" class="dep-viz-overlay" @click.self="$emit('close')">
    <div class="dep-viz-panel">
      <div class="dep-header">
        <h3>🔗 Dependency Graph</h3>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>

      <div v-if="loading" class="dep-loading">Analyzing dependencies...</div>
      <div v-else-if="error" class="dep-error">{{ error }}</div>
      <template v-else-if="data">
        <!-- Stats Row -->
        <div class="dep-stats">
          <div class="stat"><span class="stat-val">{{ data.stats.depth }}</span><span class="stat-label">Depth</span></div>
          <div class="stat"><span class="stat-val">{{ data.stats.width }}</span><span class="stat-label">Width</span></div>
          <div class="stat"><span class="stat-val">{{ data.stats.parallelism }}×</span><span class="stat-label">Parallelism</span></div>
          <div class="stat"><span class="stat-val">{{ data.criticalPath.length }}</span><span class="stat-label">Critical Path</span></div>
          <div class="stat" v-if="data.bottlenecks.length > 0">
            <span class="stat-val warn">{{ data.bottlenecks.length }}</span><span class="stat-label">Bottlenecks</span>
          </div>
        </div>

        <!-- Layer Visualization -->
        <div class="dep-layers">
          <div v-for="(layer, li) in data.layers" :key="li" class="dep-layer">
            <div class="layer-label">Wave {{ li + 1 }}</div>
            <div class="layer-tasks">
              <div
                v-for="node in layer"
                :key="node.id"
                class="dep-node"
                :class="{
                  'on-critical-path': isCritical(node.id),
                  'is-bottleneck': isBottleneck(node.id),
                  [`status-${node.status}`]: true,
                }"
                :title="`${node.label}\nStatus: ${node.status}\nTier: ${node.tier || 'N/A'}\nRetries: ${node.retries}`"
              >
                <span class="node-icon">{{ statusIcon(node.status) }}</span>
                <span class="node-label">{{ truncate(node.label, 30) }}</span>
                <span class="node-tier" v-if="node.tier">{{ node.tier }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Critical Path -->
        <div class="dep-section" v-if="data.criticalPath.length > 0">
          <h4>🔴 Critical Path</h4>
          <div class="critical-chain">
            <span v-for="(node, i) in data.criticalPath" :key="node.id" class="critical-node">
              {{ truncate(node.label, 25) }}
              <span v-if="i < data.criticalPath.length - 1" class="arrow">→</span>
            </span>
          </div>
        </div>

        <!-- Bottlenecks -->
        <div class="dep-section" v-if="data.bottlenecks.length > 0">
          <h4>⚠️ Bottlenecks</h4>
          <div v-for="bn in data.bottlenecks" :key="bn.id" class="bottleneck-item">
            <span class="bn-label">{{ bn.label }}</span>
            <span class="bn-reason">{{ bn.reason }}</span>
            <span class="bn-detail">fan-in: {{ bn.fanIn }}, fan-out: {{ bn.fanOut }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  projectSlug: { type: String, default: '' },
  sessionId: { type: String, default: '' },
});

defineEmits(['close']);

const data = ref(null);
const loading = ref(false);
const error = ref('');

const criticalIds = ref(new Set());
const bottleneckIds = ref(new Set());

function truncate(s, len) {
  if (!s) return '';
  return s.length > len ? s.slice(0, len) + '…' : s;
}

function statusIcon(status) {
  const icons = { success: '✅', failed: '❌', running: '⏳', pending: '⬜' };
  return icons[status] || '⬜';
}

function isCritical(id) { return criticalIds.value.has(id); }
function isBottleneck(id) { return bottleneckIds.value.has(id); }

async function fetchDeps() {
  if (!props.projectSlug || !props.sessionId) return;
  loading.value = true;
  error.value = '';
  data.value = null;

  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/sessions/${props.sessionId}/dependencies`);
    if (!res.ok) {
      error.value = 'Failed to load dependency data';
      return;
    }
    const result = await res.json();
    data.value = result;
    criticalIds.value = new Set(result.criticalPath.map(n => n.id));
    bottleneckIds.value = new Set(result.bottlenecks.map(n => n.id));
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

watch(() => props.visible, (v) => {
  if (v) fetchDeps();
});
</script>

<style scoped>
.dep-viz-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dep-viz-panel {
  background: #16161e;
  border: 1px solid #333;
  border-radius: 10px;
  width: 90%;
  max-width: 800px;
  max-height: 85vh;
  overflow-y: auto;
  padding: 20px;
}

.dep-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.dep-header h3 {
  font-size: 16px;
  color: #e0e0e0;
}

.close-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 18px;
  cursor: pointer;
}

.dep-loading, .dep-error {
  text-align: center;
  padding: 40px;
  color: #888;
}

.dep-error { color: #ef5350; }

/* Stats */
.dep-stats {
  display: flex;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: #1e1e2e;
  border-radius: 8px;
  padding: 10px 16px;
  min-width: 80px;
}

.stat-val {
  font-size: 22px;
  font-weight: bold;
  color: #64b5f6;
}

.stat-val.warn { color: #ffb74d; }

.stat-label {
  font-size: 11px;
  color: #888;
  margin-top: 2px;
}

/* Layers */
.dep-layers {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.dep-layer {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.layer-label {
  min-width: 60px;
  font-size: 11px;
  color: #888;
  padding-top: 8px;
  text-align: right;
}

.layer-tasks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1;
}

.dep-node {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #1e1e2e;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  color: #ccc;
  transition: all 0.2s;
}

.dep-node.on-critical-path {
  border-color: #ef5350;
  background: rgba(239, 83, 80, 0.1);
}

.dep-node.is-bottleneck {
  border-color: #ffb74d;
  background: rgba(255, 183, 77, 0.1);
}

.dep-node.status-success { color: #81c784; }
.dep-node.status-failed { color: #ef5350; }

.node-icon { font-size: 13px; }
.node-label { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-tier {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: #2a2a3a;
  color: #90caf9;
}

/* Critical Path */
.dep-section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #222;
}

.dep-section h4 {
  font-size: 13px;
  color: #bbb;
  margin-bottom: 8px;
}

.critical-chain {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.critical-node {
  color: #ef5350;
  font-size: 12px;
  font-family: 'Fira Code', monospace;
}

.arrow {
  color: #666;
  margin: 0 2px;
}

/* Bottlenecks */
.bottleneck-item {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 0;
  font-size: 12px;
}

.bn-label { color: #ffb74d; font-weight: 600; }
.bn-reason { color: #888; font-style: italic; }
.bn-detail { color: #666; font-size: 11px; }
</style>
