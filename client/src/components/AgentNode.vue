<template>
  <div :class="['agent-node', statusClass, { 'node-spawning': spawning, 'node-dormant': isDormant }]"
       :style="spawnDelay">
    <Handle type="target" :position="Position.Left" />

    <!-- Completion ripple ring -->
    <div v-if="showRipple" class="ripple-ring"></div>

    <!-- Running glow orb -->
    <div v-if="data.status === 'running'" class="glow-orb"></div>

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
      <span v-if="data.speculative" class="speculative-badge">
        🔮 speculative
      </span>
      <span v-if="data.splitFrom" class="split-badge">
        🔀 split
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

// Dormant = pending and not yet activated by the swarm
const isDormant = computed(() => props.data.status === 'pending');

const statusIcon = computed(() => {
  switch (props.data.status) {
    case 'running': return '⏳';
    case 'success': return '✅';
    case 'failed': return '❌';
    case 'blocked': return '🚧';
    default: return '⬜';
  }
});

// ── Spawn animation ──
const spawning = ref(true);
const spawnDelay = computed(() => {
  const wave = props.data.wave || 0;
  return { '--spawn-delay': `${wave * 0.15}s` };
});

onMounted(() => {
  const delay = (props.data.wave || 0) * 150 + 400;
  setTimeout(() => { spawning.value = false; }, delay);
});

// ── Completion ripple ──
const showRipple = ref(false);
let prevStatus = props.data.status;

watch(() => props.data.status, (newStatus) => {
  if (newStatus === 'success' && prevStatus !== 'success') {
    showRipple.value = true;
    setTimeout(() => { showRipple.value = false; }, 1200);
  }
  prevStatus = newStatus;
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
  position: relative;
  background: rgba(12, 18, 30, 0.95);
  border: 1.5px solid rgba(74, 158, 255, 0.15);
  border-radius: 14px;
  padding: 12px 16px;
  min-width: 220px;
  cursor: pointer;
  transition: border-color 0.5s ease, box-shadow 0.5s ease, transform 0.3s ease, opacity 0.5s ease;
  backdrop-filter: blur(4px);
}

/* ── Spawn animation ── */
.node-spawning {
  animation: nodeSpawn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  animation-delay: var(--spawn-delay, 0s);
}

@keyframes nodeSpawn {
  0% { opacity: 0; transform: scale(0.3) rotate(-8deg); filter: blur(8px); }
  60% { opacity: 1; transform: scale(1.06) rotate(1deg); filter: blur(0); }
  100% { opacity: 1; transform: scale(1) rotate(0deg); filter: blur(0); }
}

/* ── Dormant state — faded, waiting ── */
.node-dormant {
  opacity: 0.5;
  border-color: rgba(74, 158, 255, 0.08);
}
.node-dormant:hover {
  opacity: 0.8;
}

.agent-node:hover {
  box-shadow: 0 0 20px rgba(74, 158, 255, 0.15);
  transform: translateY(-2px);
  border-color: rgba(74, 158, 255, 0.3);
}

/* ── Status states ── */
.status-pending { border-color: rgba(74, 158, 255, 0.08); }

.status-running {
  opacity: 1;
  border-color: rgba(74, 158, 255, 0.6);
  box-shadow: 0 0 20px rgba(74, 158, 255, 0.2), 0 0 60px rgba(74, 158, 255, 0.05);
  animation: hivePulse 2.5s ease-in-out infinite;
}

.status-success {
  opacity: 1;
  border-color: rgba(76, 175, 80, 0.5);
  background: rgba(10, 25, 12, 0.95);
  box-shadow: 0 0 12px rgba(76, 175, 80, 0.1);
}

.status-failed {
  opacity: 1;
  border-color: rgba(244, 67, 54, 0.5);
  background: rgba(25, 10, 10, 0.95);
  box-shadow: 0 0 12px rgba(244, 67, 54, 0.1);
}

.status-blocked {
  opacity: 0.6;
  border-color: rgba(255, 152, 0, 0.4);
}

/* ── Bio-luminescent pulse for running nodes ── */
@keyframes hivePulse {
  0%, 100% {
    box-shadow: 0 0 12px rgba(74, 158, 255, 0.15), 0 0 40px rgba(74, 158, 255, 0.03);
    border-color: rgba(74, 158, 255, 0.5);
  }
  50% {
    box-shadow: 0 0 25px rgba(74, 158, 255, 0.35), 0 0 80px rgba(74, 158, 255, 0.08);
    border-color: rgba(74, 158, 255, 0.8);
  }
}

/* ── Glow orb behind running nodes ── */
.glow-orb {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 160%;
  height: 160%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(74, 158, 255, 0.08) 0%, transparent 70%);
  pointer-events: none;
  animation: orbBreathe 3s ease-in-out infinite;
  z-index: -1;
}

@keyframes orbBreathe {
  0%, 100% { opacity: 0.5; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
}

/* ── Completion ripple ring ── */
.ripple-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 100%;
  height: 100%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2px solid rgba(76, 175, 80, 0.6);
  pointer-events: none;
  animation: rippleExpand 1.2s ease-out forwards;
  z-index: -1;
}

@keyframes rippleExpand {
  0% { width: 100%; height: 100%; opacity: 1; border-width: 3px; }
  100% { width: 300%; height: 300%; opacity: 0; border-width: 1px; }
}

/* ── Node content ── */
.node-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.status-icon { font-size: 14px; }

.label {
  font-size: 13px;
  font-weight: 600;
  color: rgba(220, 230, 245, 0.95);
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
.model-badge.t0 { background: rgba(26, 58, 26, 0.6); color: #6ecf6e; }
.model-badge.t1 { background: rgba(42, 42, 26, 0.6); color: #c5c56a; }
.model-badge.t2 { background: rgba(26, 42, 58, 0.6); color: #6aacf5; }
.model-badge.t3 { background: rgba(42, 26, 58, 0.6); color: #b56af5; }
.model-badge.t4 { background: rgba(58, 26, 26, 0.6); color: #f56a6a; }

.cost-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(40, 35, 15, 0.6);
  color: #f5c542;
}

.retry-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(42, 20, 20, 0.6);
  color: #f56a6a;
}

.speculative-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(30, 20, 45, 0.6);
  color: #b88aff;
  font-weight: 500;
}

.split-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(20, 40, 35, 0.6);
  color: #6af5c0;
  font-weight: 500;
}

.time-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(20, 25, 40, 0.6);
  color: rgba(180, 190, 210, 0.6);
  font-variant-numeric: tabular-nums;
}

.time-badge.time-live {
  color: #4a9eff;
  background: rgba(15, 26, 46, 0.8);
}

.node-reason {
  margin-top: 6px;
  font-size: 10px;
  color: rgba(150, 165, 185, 0.6);
  line-height: 1.3;
  white-space: normal;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
