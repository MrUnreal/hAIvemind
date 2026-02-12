<template>
  <div class="flow-wrapper">
    <div v-if="sessionStatus === 'planning' || sessionStatus === 'loading'" class="planning-overlay">
      <div class="spinner"></div>
      <p>{{ sessionStatus === 'loading' ? 'Loading session...' : 'Orchestrator is decomposing your request...' }}</p>
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
      <Background variant="dots" :gap="20" :size="1" color="#222" />
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
        <span v-if="currentWaveStats">
          — {{ currentWaveStats.running }} swarming
          <span v-if="currentWaveStats.speculative"> ({{ currentWaveStats.speculative }} speculative)</span>
          · {{ currentWaveStats.completed }}/{{ currentWaveStats.total }} done
        </span>
      </div>
      <div class="wave-bar">
        <div class="wave-fill" :style="{ width: waveProgress + '%' }"></div>
      </div>
    </div>


  </div>
</template>

<script setup>
import { computed, watch, ref, nextTick } from 'vue';
import { VueFlow, useVueFlow } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/controls/dist/style.css';

import AgentNode from './AgentNode.vue';
import BookendNode from './BookendNode.vue';
import PromptNode from './PromptNode.vue';
import { layoutNodes } from '../utils/layout.js';
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

const { fitView } = useVueFlow();

// Auto-focus viewport on running nodes when they change
watch(taskStatusMap, () => {
  const runningNodeIds = flowNodes.value
    .filter(n => n.type === 'agent' && getNodeStatus(n.data.taskId) === 'running')
    .map(n => n.id);
  if (runningNodeIds.length > 0) {
    nextTick(() => {
      fitView({ nodes: runningNodeIds, padding: 0.3, duration: 400 });
    });
  }
}, { deep: true });

// Resolve effective status for a node ID (agent or bookend)
function getNodeStatus(nodeId) {
  if (nodeId === '__start__' || nodeId === '__end__') return null;
  const ts = taskStatusMap.get(nodeId);
  if (ts) return ts.status;
  const agent = taskAgentMap.value.get(nodeId);
  if (agent) return agent.status;
  return 'pending';
}

// Color edges based on connected node statuses
function applyEdgeStatuses(edgeList) {
  return edgeList.map(edge => {
    const sourceStatus = getNodeStatus(edge.source);
    const targetStatus = getNodeStatus(edge.target);

    // Active: either end is running
    if (sourceStatus === 'running' || targetStatus === 'running') {
      // Speculative edges get dashed styling
      const isSpeculative = speculativeTasks.value.has(edge.target);
      if (isSpeculative) {
        return { ...edge, animated: true, style: { stroke: '#b88aff', strokeWidth: 2.5, strokeDasharray: '6 3' } };
      }
      return { ...edge, animated: true, style: { stroke: '#4a9eff', strokeWidth: 2.5 } };
    }
    // Completed path: source is done
    if (sourceStatus === 'success' && (targetStatus === 'success' || targetStatus === 'running')) {
      return { ...edge, animated: false, style: { stroke: '#4caf50', strokeWidth: 1.5 } };
    }
    // Failed/blocked
    if (targetStatus === 'failed' || targetStatus === 'blocked') {
      return { ...edge, animated: false, style: { stroke: '#f44336', strokeWidth: 1.5 } };
    }
    // Default
    return { ...edge, animated: false, style: { stroke: '#333' } };
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
    return { ...node, data: newData };
  });
}

// Generate layout when plan arrives
watch(tasks, (newTasks) => {
  if (newTasks.length > 0) {
    const layout = layoutNodes(newTasks, edges.value);
    flowNodes.value = applyNodeStatuses(layout.nodes);
    flowEdges.value = layout.edges;
  }
}, { immediate: true });

// Update node data when task/agent statuses change — must replace the whole array for reactivity
watch([taskStatusMap, taskAgentMap], () => {
  if (flowNodes.value.length === 0) return;
  flowNodes.value = applyNodeStatuses(flowNodes.value);
  flowEdges.value = applyEdgeStatuses(flowEdges.value);
}, { deep: true });

function onNodeClick(event) {
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
  gap: 20px;
  color: #666;
}

.planning-overlay p {
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #1a1a2e;
  border-top-color: #f5c542;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
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
  border: 1px solid #1e1e2e;
  border-radius: 10px;
  padding: 8px 18px;
  font-size: 12px;
  color: #aaa;
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
  background: #1a1a2e;
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
  background: #0a0a0f;
}
</style>
