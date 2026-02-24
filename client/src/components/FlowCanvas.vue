<template>
  <div class="flow-wrapper">
    <div v-if="sessionStatus === 'planning' || sessionStatus === 'loading'" class="planning-overlay">
      <!-- Neural network background particles -->
      <div class="neural-field">
        <div v-for="n in 12" :key="n" class="neuron" :style="neuronStyle(n)"></div>
        <svg class="synapse-lines" viewBox="0 0 400 400">
          <line v-for="s in 8" :key="s" class="synapse"
            :x1="60 + (s * 37) % 280" :y1="40 + (s * 53) % 320"
            :x2="100 + ((s + 3) * 47) % 260" :y2="80 + ((s + 5) * 41) % 280"
            :style="{ animationDelay: `${s * 0.3}s` }" />
        </svg>
      </div>

      <!-- Pulsing hive brain -->
      <div class="hive-brain">
        <div class="brain-aura"></div>
        <div class="brain-core">🧠</div>
        <div class="brain-ring ring-1"></div>
        <div class="brain-ring ring-2"></div>
        <div class="brain-ring ring-3"></div>
      </div>

      <!-- Thinking status log -->
      <div class="thinking-log">
        <p class="thinking-label">
          {{ sessionStatus === 'loading' ? 'Loading session...' : thinkingMessage }}
        </p>
        <div v-if="sessionStatus === 'planning'" class="thinking-steps">
          <TransitionGroup name="step">
            <div v-for="step in visibleSteps" :key="step.id" class="step-line" :class="{ active: step.active }">
              <span class="step-icon">{{ step.active ? '◉' : '✓' }}</span>
              <span>{{ step.text }}</span>
            </div>
          </TransitionGroup>
        </div>
      </div>
    </div>

    <VueFlow
      v-else
      :nodes="flowNodes"
      :edges="flowEdges"
      :default-viewport="{ x: 0, y: 0, zoom: 1 }"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="false"
      fit-view-on-init
      @node-click="onNodeClick"
    >
      <Background variant="dots" :gap="30" :size="0.8" color="rgba(74,158,255,0.06)" />
      <Controls />

      <template #node-agent="nodeProps">
        <AgentNode :data="nodeProps.data" />
      </template>

      <template #node-bookend="nodeProps">
        <BookendNode :data="nodeProps.data" />
      </template>

      <template #node-prompt="nodeProps">
        <PromptNode :data="nodeProps.data" />
      </template>
    </VueFlow>

    <div v-if="sessionStatus === 'completed'" class="completion-banner success">
      ✅ All tasks completed
      <span v-if="costSummary" class="cost">— {{ costSummary.totalPremiumRequests }}× premium requests used</span>
      <span v-if="swarmStats" class="swarm-detail">
        · {{ swarmStats.totalWaves }} waves · peak {{ swarmStats.peakConcurrency }}× concurrent
        <span v-if="swarmStats.speculativeLaunches"> · {{ swarmStats.speculativeLaunches }} speculative</span>
        <span v-if="swarmStats.taskSplits"> · {{ swarmStats.taskSplits }} splits</span>
      </span>
    </div>
    <div v-if="sessionStatus === 'failed'" class="completion-banner error">
      ❌ Session failed
    </div>

    <!-- Swarm wave progress bar -->
    <div v-if="swarmWave && sessionStatus === 'running'" class="wave-progress">
      <div class="wave-label">
        🌊 Wave {{ swarmWave.currentWave + 1 }}/{{ swarmWave.totalWaves }}
        <span v-if="crossWaveRunning > 0 || currentWaveStats">
          — {{ crossWaveRunning || currentWaveStats?.running || 0 }} swarming
          <span v-if="crossWaveSpeculative > 0"> ({{ crossWaveSpeculative }} speculative)</span>
          <span v-if="currentWaveStats">· {{ currentWaveStats.completed }}/{{ currentWaveStats.total }} done</span>
        </span>
      </div>
      <div class="wave-bar">
        <div class="wave-fill" :style="{ width: waveProgress + '%' }"></div>
      </div>
    </div>


  </div>
</template>

<script setup>
import { computed, watch, ref, nextTick, onUnmounted } from 'vue';
import { VueFlow, useVueFlow } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/controls/dist/style.css';

import AgentNode from './AgentNode.vue';
import BookendNode from './BookendNode.vue';
import PromptNode from './PromptNode.vue';
import { hivemindLayout } from '../utils/hivemindLayout.js';
import {
  sessionStatus,
  tasks,
  edges,
  taskStatusMap,
  taskAgentMap,
  selectedAgentId,
  costSummary,
  swarmWave,
  speculativeTasks,
  splitTasks,
  swarmStats,
} from '../composables/useSession.js';

const flowNodes = ref([]);
const flowEdges = ref([]);

const { fitView, updateNodeInternals } = useVueFlow();

// ── Planning overlay thinking animation ──
const thinkingSteps = [
  'Parsing prompt structure...',
  'Identifying file dependencies...',
  'Estimating task complexity...',
  'Building dependency graph...',
  'Optimizing wave parallelism...',
  'Selecting model tiers...',
  'Assigning execution order...',
  'Finalizing task plan...',
];

const thinkingMessages = [
  'Orchestrator is analyzing your request...',
  'Decomposing into parallel tasks...',
  'The hivemind is thinking...',
  'Mapping the execution graph...',
  'Planning optimal task waves...',
];

const visibleSteps = ref([]);
const thinkingMessage = ref(thinkingMessages[0]);
let stepIndex = 0;
let messageIndex = 0;
let stepTimer = null;
let msgTimer = null;
let stepIdCounter = 0;

function startThinkingAnimation() {
  stopThinkingAnimation();
  stepIndex = 0;
  messageIndex = 0;
  stepIdCounter = 0;
  visibleSteps.value = [];
  thinkingMessage.value = thinkingMessages[0];

  // Cycle through thinking steps
  stepTimer = setInterval(() => {
    // Mark previous step as done
    if (visibleSteps.value.length > 0) {
      visibleSteps.value = visibleSteps.value.map(s => ({ ...s, active: false }));
    }
    // Add new step
    visibleSteps.value = [
      ...visibleSteps.value.slice(-3), // Keep last 3 completed
      { id: ++stepIdCounter, text: thinkingSteps[stepIndex % thinkingSteps.length], active: true },
    ];
    stepIndex++;
  }, 2200);

  // Cycle through header messages
  msgTimer = setInterval(() => {
    messageIndex = (messageIndex + 1) % thinkingMessages.length;
    thinkingMessage.value = thinkingMessages[messageIndex];
  }, 4000);
}

function stopThinkingAnimation() {
  if (stepTimer) { clearInterval(stepTimer); stepTimer = null; }
  if (msgTimer) { clearInterval(msgTimer); msgTimer = null; }
}

// Neuron position generator for the background
function neuronStyle(n) {
  const angle = (n / 12) * Math.PI * 2;
  const radius = 120 + (n % 3) * 40;
  const x = 50 + Math.cos(angle) * (radius / 4);
  const y = 50 + Math.sin(angle) * (radius / 4);
  return {
    left: `${x}%`,
    top: `${y}%`,
    animationDelay: `${n * 0.25}s`,
    animationDuration: `${2 + (n % 3) * 0.5}s`,
  };
}

watch(sessionStatus, (status) => {
  if (status === 'planning') startThinkingAnimation();
  else stopThinkingAnimation();
}, { immediate: true });

onUnmounted(() => stopThinkingAnimation());

// Auto-focus: fit entire DAG once on plan load, then gently pan only on wave transitions
const lastFocusedWave = ref(-1);

watch(swarmWave, (wave) => {
  if (!wave || wave.currentWave === lastFocusedWave.value) return;
  lastFocusedWave.value = wave.currentWave;
  // On wave transition, fit the full DAG so user sees the big picture
  nextTick(() => {
    fitView({ padding: 0.15, duration: 600 });
  });
}, { deep: true });

// Resolve effective status for a node ID (agent or bookend)
function getNodeStatus(nodeId) {
  if (nodeId === '__start__' || nodeId === '__end__') return null;
  const ts = taskStatusMap.get(nodeId);
  if (ts) return ts.status;
  const agent = taskAgentMap.value.get(nodeId);
  if (agent) return agent.status;
  // In completed/failed sessions, treat untracked tasks as done
  if (sessionStatus.value === 'completed') return 'success';
  if (sessionStatus.value === 'failed') return 'failed';
  return 'pending';
}

// Color edges based on connected node statuses
function applyEdgeStatuses(edgeList) {
  return edgeList.map(edge => {
    const sourceStatus = getNodeStatus(edge.source);
    const targetStatus = getNodeStatus(edge.target);

    // Active: either end is running
    if (sourceStatus === 'running' || targetStatus === 'running') {
      const isSpeculative = speculativeTasks.value.has(edge.target);
      if (isSpeculative) {
        return { ...edge, animated: true, style: { stroke: '#b88aff', strokeWidth: 2.5, strokeDasharray: '6 3' }, class: 'edge-active edge-speculative' };
      }
      return { ...edge, animated: true, style: { stroke: '#4a9eff', strokeWidth: 2.5 }, class: 'edge-active' };
    }
    // Completed path
    if (sourceStatus === 'success' && (targetStatus === 'success' || targetStatus === 'running')) {
      return { ...edge, animated: false, style: { stroke: 'rgba(76, 175, 80, 0.5)', strokeWidth: 2 }, class: 'edge-done' };
    }
    // Failed/blocked
    if (targetStatus === 'failed' || targetStatus === 'blocked') {
      return { ...edge, animated: false, style: { stroke: 'rgba(244, 67, 54, 0.5)', strokeWidth: 2 }, class: 'edge-failed' };
    }
    // Default — dim tendril
    return { ...edge, animated: false, style: { stroke: 'rgba(74, 158, 255, 0.18)', strokeWidth: 1.5 }, class: 'edge-dormant' };
  });
}

// Apply current task/agent statuses to a node array
function applyNodeStatuses(nodes) {
  return nodes.map(node => {
    if (node.id === '__end__') {
      const endVariant = sessionStatus.value === 'completed' ? 'complete'
        : sessionStatus.value === 'failed' ? 'failed' : 'end';
      return { ...node, data: { ...node.data, variant: endVariant } };
    }
    if (node.type === 'bookend' || node.type === 'prompt') return node;

    const taskId = node.data.taskId;
    const taskStatus = taskStatusMap.get(taskId);
    const agentInfo = taskAgentMap.value.get(taskId);
    let newData = { ...node.data };

    // Inject swarm metadata
    if (speculativeTasks.value.has(taskId)) {
      newData.speculative = true;
    }
    if (splitTasks.value.has(taskId)) {
      newData.splitFrom = true;
    }

    if (taskStatus) {
      newData = { ...newData, status: taskStatus.status, retries: taskStatus.retries, modelTier: taskStatus.modelTier, startedAt: taskStatus.startedAt, completedAt: taskStatus.completedAt };
    }
    if (agentInfo) {
      newData = { ...newData, agentId: agentInfo.agentId, model: agentInfo.model, multiplier: agentInfo.multiplier, status: agentInfo.status || newData.status, reason: agentInfo.reason || newData.reason };
    }

    // Split parent tasks are "success by delegation" — don't show as failed
    if (newData.splitFrom) {
      newData.status = 'success';
    }

    // In completed/failed sessions, promote unknown tasks to success/failed
    if (!taskStatus && !agentInfo && newData.status === 'pending') {
      if (sessionStatus.value === 'completed') newData.status = 'success';
      else if (sessionStatus.value === 'failed') newData.status = 'failed';
    }

    return { ...node, data: newData };
  });
}

// Generate layout when plan arrives
watch(tasks, (newTasks) => {
  if (newTasks.length > 0) {
    const layout = hivemindLayout(newTasks, edges.value);
    flowNodes.value = applyNodeStatuses(layout.nodes);
    flowEdges.value = layout.edges;
    // Force VueFlow to recalculate handle positions after DOM renders
    nextTick(() => {
      requestAnimationFrame(() => updateNodeInternals());
    });
  }
}, { immediate: true });

// Update node data when task/agent statuses change — must replace the whole array for reactivity
watch([taskStatusMap, taskAgentMap, sessionStatus], () => {
  if (flowNodes.value.length === 0) return;
  flowNodes.value = applyNodeStatuses(flowNodes.value);
  flowEdges.value = applyEdgeStatuses(flowEdges.value);
  // Recalculate handle positions when node content changes height
  nextTick(() => {
    requestAnimationFrame(() => updateNodeInternals());
  });
}, { deep: true });

function onNodeClick(event) {
  const nodeId = event.node?.id;
  if (!nodeId || nodeId === '__start__' || nodeId === '__end__') return;

  // Look up agent directly from taskAgentMap using the node's task ID
  // (VueFlow's internal node data may be stale after reactivity updates)
  const taskId = event.node?.data?.taskId || nodeId;
  const agentInfo = taskAgentMap.value.get(taskId);
  if (agentInfo?.agentId) {
    selectedAgentId.value = agentInfo.agentId;
    return;
  }

  // Fallback: check the node data directly
  const agentId = event.node?.data?.agentId;
  if (agentId) {
    selectedAgentId.value = agentId;
  }
}

// ── Swarm wave progress ──
const currentWaveStats = computed(() => {
  if (!swarmWave.value?.waveStats) return null;
  return swarmWave.value.waveStats;
});

const crossWaveRunning = computed(() => swarmWave.value?.totalRunning || 0);
const crossWaveSpeculative = computed(() => swarmWave.value?.totalSpeculative || 0);

const waveProgress = computed(() => {
  if (!swarmWave.value?.allWaves) return 0;
  const all = swarmWave.value.allWaves;
  let totalDone = 0;
  let totalTasks = 0;
  for (const w of Object.values(all)) {
    totalDone += (w.completed || 0);
    totalTasks += (w.total || 0);
  }
  return totalTasks > 0 ? Math.round((totalDone / totalTasks) * 100) : 0;
});
</script>

<style scoped>
.flow-wrapper {
  position: relative;
  height: 100%;
}

.planning-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 24px;
  color: var(--text-tertiary);
  position: relative;
  overflow: hidden;
  background: radial-gradient(ellipse at center, rgba(10, 18, 30, 1) 0%, rgba(5, 8, 14, 1) 70%);
}

/* ── Neural network background ── */
.neural-field {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.neuron {
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(74, 158, 255, 0.3);
  box-shadow: 0 0 12px rgba(74, 158, 255, 0.15);
  animation: neuronPulse 2s ease-in-out infinite alternate;
}

@keyframes neuronPulse {
  0% { opacity: 0.2; transform: scale(0.8); }
  100% { opacity: 0.7; transform: scale(1.3); }
}

.synapse-lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.synapse {
  stroke: rgba(74, 158, 255, 0.08);
  stroke-width: 1;
  animation: synapseFire 3s ease-in-out infinite;
}

@keyframes synapseFire {
  0%, 100% { stroke: rgba(74, 158, 255, 0.05); stroke-width: 0.5; }
  50% { stroke: rgba(74, 158, 255, 0.2); stroke-width: 1.5; }
}

/* ── Pulsing hive brain ── */
.hive-brain {
  position: relative;
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.brain-core {
  font-size: 48px;
  z-index: 3;
  animation: brainFloat 3s ease-in-out infinite;
  filter: drop-shadow(0 0 20px rgba(245, 197, 66, 0.3));
}

@keyframes brainFloat {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-6px) scale(1.05); }
}

.brain-aura {
  position: absolute;
  width: 200%;
  height: 200%;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(245, 197, 66, 0.08) 0%, transparent 60%);
  animation: auraExpand 3s ease-in-out infinite;
}

@keyframes auraExpand {
  0%, 100% { opacity: 0.5; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.15); }
}

.brain-ring {
  position: absolute;
  border-radius: 50%;
  border: 1.5px solid rgba(245, 197, 66, 0.15);
  animation: ringPulse 4s ease-out infinite;
}

.ring-1 { width: 90px; height: 90px; animation-delay: 0s; }
.ring-2 { width: 130px; height: 130px; animation-delay: 1.3s; }
.ring-3 { width: 170px; height: 170px; animation-delay: 2.6s; }

@keyframes ringPulse {
  0% { opacity: 0.6; transform: scale(0.8); border-color: rgba(245, 197, 66, 0.3); }
  100% { opacity: 0; transform: scale(1.6); border-color: rgba(245, 197, 66, 0); }
}

/* ── Thinking log ── */
.thinking-log {
  text-align: center;
  z-index: 2;
  max-width: 360px;
}

.thinking-label {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #f5c542;
  margin-bottom: 16px;
  animation: labelGlow 2s ease-in-out infinite alternate;
}

@keyframes labelGlow {
  0% { text-shadow: 0 0 8px rgba(245, 197, 66, 0.1); }
  100% { text-shadow: 0 0 16px rgba(245, 197, 66, 0.3); }
}

.thinking-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.step-line {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(106, 172, 245, 0.4);
  transition: color 0.3s ease, opacity 0.3s ease;
}

.step-line.active {
  color: rgba(106, 172, 245, 0.9);
}

.step-icon {
  font-size: 8px;
  width: 12px;
  text-align: center;
}

.step-line.active .step-icon {
  animation: iconPulse 1s ease-in-out infinite;
  color: #4a9eff;
}

@keyframes iconPulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

/* Step transitions */
.step-enter-active {
  transition: all 0.4s ease-out;
}
.step-leave-active {
  transition: all 0.3s ease-in;
}
.step-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.step-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.completion-banner {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 28px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  backdrop-filter: blur(8px);
  animation: banner-appear 0.4s ease-out;
}

@keyframes banner-appear {
  from { opacity: 0; transform: translateX(-50%) translateY(10px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

.completion-banner.success {
  background: rgba(26, 58, 26, 0.9);
  border: 1px solid #2a5a2a;
  color: #6ecf6e;
  box-shadow: 0 4px 24px rgba(76, 175, 80, 0.15);
}
.completion-banner.error {
  background: rgba(58, 26, 26, 0.9);
  border: 1px solid #5a2a2a;
  color: #f56a6a;
  box-shadow: 0 4px 24px rgba(244, 67, 54, 0.15);
}

.cost {
  color: #f5c542;
}

.swarm-detail {
  color: #6aacf5;
  font-size: 12px;
}

/* ── Wave progress bar ── */
.wave-progress {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(15, 15, 22, 0.92);
  border: 1px solid var(--bg-card);
  border-radius: 10px;
  padding: 8px 18px;
  font-size: 12px;
  color: var(--text-secondary);
  backdrop-filter: blur(8px);
  min-width: 280px;
  animation: banner-appear 0.4s ease-out;
  z-index: 10;
}

.wave-label {
  margin-bottom: 6px;
  color: #6aacf5;
  font-weight: 600;
}

.wave-bar {
  background: var(--border-primary);
  border-radius: 4px;
  height: 6px;
  overflow: hidden;
}

.wave-fill {
  background: linear-gradient(90deg, #4a9eff, #6af5c0);
  height: 100%;
  border-radius: 4px;
  transition: width 0.5s ease;
}

/* Override vue-flow bg */
:deep(.vue-flow) {
  background: radial-gradient(ellipse at center, rgba(10, 18, 30, 1) 0%, rgba(5, 8, 14, 1) 70%);
}

/* ── Handle dots — subtle, blending with edge endpoints ── */
:deep(.vue-flow__handle) {
  width: 8px;
  height: 8px;
  background: rgba(74, 158, 255, 0.12);
  border: 1.5px solid rgba(74, 158, 255, 0.25);
  transition: background 0.3s, border-color 0.3s;
}

:deep(.vue-flow__node.selected .vue-flow__handle),
:deep(.vue-flow__node:hover .vue-flow__handle) {
  background: rgba(74, 158, 255, 0.3);
  border-color: rgba(74, 158, 255, 0.5);
}

/* ── Hivemind edge effects ── */
:deep(.vue-flow__edge-path) {
  transition: stroke 0.6s ease, stroke-width 0.4s ease, opacity 0.5s ease;
}

:deep(.edge-active .vue-flow__edge-path) {
  filter: drop-shadow(0 0 4px rgba(74, 158, 255, 0.4));
}

:deep(.edge-done .vue-flow__edge-path) {
  filter: drop-shadow(0 0 3px rgba(76, 175, 80, 0.25));
}

:deep(.edge-failed .vue-flow__edge-path) {
  filter: drop-shadow(0 0 3px rgba(244, 67, 54, 0.3));
}

:deep(.edge-dormant .vue-flow__edge-path) {
  opacity: 0.4;
}

/* Animated edge flow particles */
:deep(.vue-flow__edge.animated .vue-flow__edge-path) {
  stroke-dasharray: 8 4;
  animation: edgeFlow 1.2s linear infinite;
}

@keyframes edgeFlow {
  to { stroke-dashoffset: -24; }
}
</style>
