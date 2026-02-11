<template>
  <div :class="['agent-node', statusClass]">
    <Handle type="target" :position="Position.Left" />
    <div class="node-header">
      <span class="status-icon">{{ statusIcon }}</span>
      <span class="label">{{ data.label }}</span>
    </div>
    <div class="node-meta">
      <span v-if="data.model" class="model-badge" :class="tierClass">
        {{ data.modelTier || 'T0' }} · {{ data.model }}
      </span>
      <span v-if="data.multiplier !== undefined" class="cost-badge">
        {{ data.multiplier }}×
      </span>
      <span v-if="data.retries > 0" class="retry-badge">
        ↻{{ data.retries }}
      </span>
      <span v-if="elapsed" class="time-badge" :class="{ 'time-live': data.status === 'running' }">
        ⏱ {{ elapsed }}
      </span>
    </div>
    <div v-if="data.reason" class="node-reason">
      {{ data.reason }}
    </div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import { Handle, Position } from '@vue-flow/core';

const props = defineProps({
  data: { type: Object, required: true },
});

const statusClass = computed(() => `status-${props.data.status || 'pending'}`);
const tierClass = computed(() => (props.data.modelTier || 'T0').toLowerCase());

const statusIcon = computed(() => {
  switch (props.data.status) {
    case 'running': return '⏳';
    case 'success': return '✅';
    case 'failed': return '❌';
    case 'blocked': return '🚧';
    default: return '⬜';
  }
});

// ── Live runtime timer ──
const now = ref(Date.now());
let timer = null;

function startTimer() {
  if (timer) return;
  timer = setInterval(() => { now.value = Date.now(); }, 1000);
}

function stopTimer() {
  if (timer) { clearInterval(timer); timer = null; }
}

watch(() => props.data.status, (status) => {
  if (status === 'running') startTimer();
  else stopTimer();
}, { immediate: true });

onMounted(() => {
  if (props.data.status === 'running') startTimer();
});

onUnmounted(() => stopTimer());

const elapsed = computed(() => {
  if (!props.data.startedAt) return null;
  const end = (props.data.status === 'running') ? now.value : (props.data.completedAt || now.value);
  const secs = Math.max(0, Math.floor((end - props.data.startedAt) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m${remainSecs.toString().padStart(2, '0')}s`;
});
</script>

<style scoped>
.agent-node {
  background: #0f0f16;
  border: 2px solid #1e1e2e;
  border-radius: 12px;
  padding: 12px 16px;
  min-width: 220px;
  cursor: pointer;
  transition: border-color 0.3s, box-shadow 0.3s, transform 0.2s;
}

.agent-node:hover {
  box-shadow: 0 0 16px rgba(245, 197, 66, 0.1);
  transform: translateY(-1px);
}

.status-pending { border-color: #2a2a3e; }
.status-running {
  border-color: #4a9eff;
  box-shadow: 0 0 16px rgba(74, 158, 255, 0.2);
  animation: pulse 2s ease-in-out infinite;
}
.status-success { border-color: #2a7a2a; background: #0d140d; }
.status-failed { border-color: #7a2a2a; background: #140d0d; }
.status-blocked { border-color: #7a5a00; }

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 8px rgba(74, 158, 255, 0.15); }
  50% { box-shadow: 0 0 20px rgba(74, 158, 255, 0.35); }
}

.node-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.status-icon {
  font-size: 14px;
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.model-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
}
.model-badge.t0 { background: #1a3a1a; color: #6ecf6e; }
.model-badge.t1 { background: #2a2a1a; color: #c5c56a; }
.model-badge.t2 { background: #1a2a3a; color: #6aacf5; }
.model-badge.t3 { background: #2a1a3a; color: #b56af5; }
.model-badge.t4 { background: #3a1a1a; color: #f56a6a; }

.cost-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #1a1a2e;
  color: #f5c542;
}

.retry-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #2a1a1a;
  color: #f56a6a;
}

.time-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #1a1a2e;
  color: #888;
  font-variant-numeric: tabular-nums;
}

.time-badge.time-live {
  color: #4a9eff;
  background: #0f1a2e;
}

.node-reason {
  margin-top: 6px;
  font-size: 10px;
  color: #888;
  line-height: 1.3;
  white-space: normal;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
