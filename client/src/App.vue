<template>
  <div class="app">
    <header class="header">
      <div class="header-left">
        <h1 @click="goHome" class="logo">🐝 hAIvemind</h1>
        <span v-if="activeProject" class="project-badge" @click="goToProject">
          📁 {{ activeProject.name }}
        </span>
      </div>
      <div class="header-meta">
        <span :class="['status-dot', connected ? 'green' : 'red']"></span>
        <span>{{ connected ? 'Connected' : 'Disconnected' }}</span>
        <span v-if="costSummary" class="cost-badge">
          💰 {{ costSummary.totalPremiumRequests }}× premium requests
        </span>
        <button
          v-if="sessionStatus !== 'idle'"
          class="replay-btn"
          :class="{ active: replayMode }"
          @click="replayMode = !replayMode"
        >
          🔄 Replay
        </button>
      </div>
    </header>

    <!-- Connection + error status overlays -->
    <div v-if="reconnecting" class="status-overlay reconnecting-overlay">
      <div class="status-banner reconnecting-banner">
        <span class="status-dot pulse red"></span>
        <span>Connection lost. Reconnecting...</span>
      </div>
    </div>

    <div v-if="reconnectedNotification" class="status-toast reconnected-toast">
      <div class="status-banner reconnected-banner">
        <span>✅ Reconnected</span>
      </div>
    </div>

    <div
      v-if="sessionStatus === 'failed' || sessionError"
      class="status-overlay error-overlay"
    >
      <div class="error-card">
        <div class="error-header">
          <span class="error-title">Something went wrong</span>
          <p class="error-message">
            {{ sessionError || 'The orchestrator hit an error while planning or running this session.' }}
          </p>
        </div>
        <div class="error-actions">
          <button class="error-btn primary" @click="retrySession">Retry</button>
          <button class="error-btn secondary" @click="startNewSession">New Session</button>
        </div>
      </div>
    </div>

    <!-- Step 1: Pick or create a project -->
    <ProjectPicker v-if="!hasActiveProject" />

    <!-- Step 2a: Show session history (if project has sessions and idle) -->
    <SessionHistory
      v-else-if="sessionStatus === 'idle' && !showPrompt"
      @newSession="showPrompt = true"
    />

    <!-- Step 2b: Enter prompt -->
    <PromptInput
      v-else-if="sessionStatus === 'idle' && showPrompt"
      :connected="connected"
      @submit="onSubmit"
    />

    <!-- Step 3: Active/loaded session workspace -->
    <div v-else class="workspace">
      <div class="workspace-main">
        <FlowCanvas class="flow-area" />
        <SessionReplay
          v-if="replayMode"
          class="replay-panel"
          :timeline="timeline"
          :session-start="sessionStart"
          :session-end="sessionEnd"
          @update:replayState="onReplayStateUpdate"
        />
      </div>
      <div class="side-panel" :class="{ collapsed: sidePanelCollapsed }">
        <div class="side-tabs">
          <button
            :class="['tab-btn', { active: sideTab === 'agent' }]"
            @click="sideTab = 'agent'; sidePanelCollapsed = false"
          >
            🤖 Agent
          </button>
          <button
            :class="['tab-btn', { active: sideTab === 'chat' }]"
            @click="sideTab = 'chat'; sidePanelCollapsed = false"
          >
            💬 Chat
          </button>
          <button
            class="tab-collapse"
            @click="sidePanelCollapsed = !sidePanelCollapsed"
          >
            {{ sidePanelCollapsed ? '◀' : '▶' }}
          </button>
        </div>
        <div v-show="!sidePanelCollapsed" class="side-content">
          <AgentDetail v-if="sideTab === 'agent'" />
          <OrchestratorChat v-show="sideTab === 'chat'" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, computed } from 'vue';
import ProjectPicker from './components/ProjectPicker.vue';
import PromptInput from './components/PromptInput.vue';
import FlowCanvas from './components/FlowCanvas.vue';
import SessionReplay from './components/SessionReplay.vue';
import AgentDetail from './components/AgentDetail.vue';
import SessionHistory from './components/SessionHistory.vue';
import OrchestratorChat from './components/OrchestratorChat.vue';
import { useWebSocket } from './composables/useWebSocket.js';
import {
  sessionStatus,
  sessionError,
  activeSessionId,
  tasks,
  edges,
  taskStatusMap,
  agentMap,
  agentOutputMap,
  selectedAgentId,
  costSummary,
  resetSession,
  timeline,
  loadSession,
} from './composables/useSession.js';
import {
  activeProject,
  hasActiveProject,
  clearProject,
  sessions,
  fetchSessions,
} from './composables/useProjects.js';

const { connected, connectionLost, on, send } = useWebSocket();
const showPrompt = ref(false);
const sideTab = ref('agent');
const sidePanelCollapsed = ref(true);
const replayMode = ref(false);
const liveTasksSnapshot = ref(null);
const liveEdgesSnapshot = ref(null);
const liveTaskStatusSnapshot = ref(null);
const liveAgentMapSnapshot = ref(null);
const reconnecting = ref(false);
const reconnectedNotification = ref(false);
let reconnectedTimeoutId = null;

// Auto-open agent panel when a node is clicked
watch(selectedAgentId, (val) => {
  if (val) {
    sideTab.value = 'agent';
    sidePanelCollapsed.value = false;
  }
});

watch(replayMode, async (enabled) => {
  if (enabled) {
    liveTasksSnapshot.value = tasks.value.slice();
    liveEdgesSnapshot.value = edges.value.slice();
    liveTaskStatusSnapshot.value = new Map(taskStatusMap);
    liveAgentMapSnapshot.value = new Map(agentMap);

    if (
      activeProject.value &&
      activeSessionId.value &&
      (!timeline.value || timeline.value.length === 0)
    ) {
      await loadSession(activeProject.value.slug, activeSessionId.value);
    }
  } else {
    if (liveTasksSnapshot.value) {
      tasks.value = liveTasksSnapshot.value;
    }
    if (liveEdgesSnapshot.value) {
      edges.value = liveEdgesSnapshot.value;
    }
    // Restore taskStatusMap
    taskStatusMap.clear();
    if (liveTaskStatusSnapshot.value) {
      for (const [k, v] of liveTaskStatusSnapshot.value) taskStatusMap.set(k, v);
    }
    // Restore agentMap
    agentMap.clear();
    if (liveAgentMapSnapshot.value) {
      for (const [k, v] of liveAgentMapSnapshot.value) agentMap.set(k, v);
    }
    liveTasksSnapshot.value = null;
    liveEdgesSnapshot.value = null;
    liveTaskStatusSnapshot.value = null;
    liveAgentMapSnapshot.value = null;
  }
});

watch(connectionLost, (now, prev) => {
  if (!prev && now) {
    reconnecting.value = true;
  } else if (prev && !now) {
    reconnecting.value = false;
    reconnectedNotification.value = true;
    if (reconnectedTimeoutId) {
      clearTimeout(reconnectedTimeoutId);
    }
    reconnectedTimeoutId = setTimeout(() => {
      reconnectedNotification.value = false;
      reconnectedTimeoutId = null;
    }, 3000);
  }
});

const sessionStart = computed(() => {
  if (!timeline.value || timeline.value.length === 0) return 0;
  const times = timeline.value
    .map((e) => (typeof e.timestamp === 'number' ? e.timestamp : null))
    .filter((t) => t != null);
  if (times.length === 0) return 0;
  return Math.min(...times);
});

const sessionEnd = computed(() => {
  if (!timeline.value || timeline.value.length === 0) return sessionStart.value || 0;
  const times = timeline.value
    .map((e) => (typeof e.timestamp === 'number' ? e.timestamp : null))
    .filter((t) => t != null);
  if (times.length === 0) return sessionStart.value || 0;
  return Math.max(...times);
});

// ── WS event handlers ──

on('plan:created', (payload) => {
  if (payload.sessionId) {
    activeSessionId.value = payload.sessionId;
  }
  if (payload.append) {
    // Iterative: append new tasks/edges to existing DAG
    tasks.value = [...tasks.value, ...payload.tasks];
    edges.value = [...edges.value, ...payload.edges];
  } else {
    tasks.value = payload.tasks;
    edges.value = payload.edges;
    sessionStatus.value = 'running';
    // Auto-open chat panel to show build progress
    sideTab.value = 'chat';
    sidePanelCollapsed.value = false;
  }
});

on('task:status', (payload) => {
  taskStatusMap.set(payload.taskId, payload);
});

on('agent:status', (payload) => {
  agentMap.set(payload.agentId, payload);
  if (!agentOutputMap.has(payload.agentId)) {
    agentOutputMap.set(payload.agentId, []);
  }
});

on('agent:output', (payload) => {
  if (!agentOutputMap.has(payload.agentId)) {
    agentOutputMap.set(payload.agentId, []);
  }
  agentOutputMap.get(payload.agentId).push(payload.chunk);
});

on('session:complete', (payload) => {
  sessionStatus.value = 'completed';
  costSummary.value = payload.costSummary;
  // Refresh session list so history is up to date
  if (activeProject.value) {
    fetchSessions(activeProject.value.slug);
  }
});

on('session:error', (payload) => {
  sessionStatus.value = 'failed';
  sessionError.value = payload?.error || 'An unexpected error occurred during this session.';
  console.error('Session error:', payload?.error || payload);
});

on('iteration:start', (payload) => {
  sessionStatus.value = 'running';
});

on('iteration:complete', (payload) => {
  sessionStatus.value = 'completed';
  if (payload.costSummary) {
    if (costSummary.value) {
      costSummary.value = {
        ...costSummary.value,
        totalPremiumRequests: (costSummary.value.totalPremiumRequests || 0) + (payload.costSummary.totalPremiumRequests || 0),
      };
    } else {
      costSummary.value = payload.costSummary;
    }
  }
});

on('verify:status', (payload) => {
  // Handled by OrchestratorChat
});

function onReplayStateUpdate(state) {
  if (!replayMode.value) return;

  const hasTasks = state && Array.isArray(state.filteredTasks) && state.filteredTasks.length > 0;
  const hasEdges = state && Array.isArray(state.filteredEdges) && state.filteredEdges.length > 0;

  if (hasTasks) {
    tasks.value = state.filteredTasks;
  } else if (liveTasksSnapshot.value) {
    tasks.value = liveTasksSnapshot.value;
  }

  if (hasEdges) {
    edges.value = state.filteredEdges;
  } else if (liveEdgesSnapshot.value) {
    edges.value = liveEdgesSnapshot.value;
  }

  // Rebuild taskStatusMap from replay's historical task statuses
  taskStatusMap.clear();
  if (state && state.taskStatuses) {
    for (const [taskId, statusData] of Object.entries(state.taskStatuses)) {
      taskStatusMap.set(taskId, statusData);
    }
  }
  // Ensure tasks NOT yet seen at this replay time show as 'pending'
  for (const t of tasks.value) {
    const tid = t.id || t.taskId;
    if (tid && !tid.startsWith('__') && !taskStatusMap.has(tid)) {
      taskStatusMap.set(tid, { taskId: tid, status: 'pending' });
    }
  }

  // Rebuild agentMap from replay's historical agent statuses
  agentMap.clear();
  if (state && state.agentStatuses) {
    for (const [agentId, agentData] of Object.entries(state.agentStatuses)) {
      agentMap.set(agentId, agentData);
    }
  }
}

function onSubmit(prompt) {
  if (!activeProject.value || !connected.value) return;
  replayMode.value = false;
  sessionError.value = null;
  sessionStatus.value = 'planning';
  showPrompt.value = false;
  send('session:start', { prompt, projectSlug: activeProject.value.slug });
}

function retrySession() {
  resetSession();
  showPrompt.value = true;
}

function startNewSession() {
  resetSession();
  showPrompt.value = true;
}

function goHome() {
  replayMode.value = false;
  resetSession();
  clearProject();
  showPrompt.value = false;
}

function goToProject() {
  replayMode.value = false;
  resetSession();
  showPrompt.value = false;
}
</script>

<style>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: #111118;
  border-bottom: 1px solid #222;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.logo {
  font-size: 18px;
  font-weight: 600;
  color: #f5c542;
  cursor: pointer;
  transition: opacity 0.2s;
}
.logo:hover {
  opacity: 0.8;
}

.project-badge {
  font-size: 13px;
  font-weight: 500;
  color: #aaa;
  background: #1a1a2e;
  border: 1px solid #2a2a3e;
  padding: 4px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s;
}
.project-badge:hover {
  border-color: #f5c542;
  color: #e0e0e0;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #888;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.status-dot.green { background: #4caf50; }
.status-dot.red { background: #f44336; }

.cost-badge {
  background: #1a1a2e;
  border: 1px solid #333;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  color: #f5c542;
}

.replay-btn {
  background: #1a1a2e;
  border: 1px solid #333;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: #ccc;
  cursor: pointer;
}
.replay-btn.active {
  background: #f5c542;
  border-color: #f5c542;
  color: #111;
}

.workspace {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.workspace-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.flow-area {
  flex: 1;
}

.replay-panel {
  flex: 0 0 260px;
  border-top: 1px solid #222;
}

.side-panel {
  display: flex;
  flex-direction: column;
  border-left: 1px solid #222;
  background: #111118;
  transition: width 0.2s;
  width: 480px;
  flex-shrink: 0;
}
.side-panel.collapsed {
  width: 42px;
}

.side-tabs {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid #222;
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  background: none;
  border: none;
  color: #666;
  font-size: 12px;
  font-weight: 600;
  padding: 10px 8px;
  cursor: pointer;
  transition: color 0.2s, border-bottom 0.2s;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
  overflow: hidden;
}
.tab-btn.active {
  color: #f5c542;
  border-bottom-color: #f5c542;
}
.tab-btn:hover:not(.active) {
  color: #aaa;
}

.side-panel.collapsed .tab-btn {
  display: none;
}

.tab-collapse {
  background: none;
  border: none;
  color: #555;
  font-size: 12px;
  padding: 10px 12px;
  cursor: pointer;
  flex-shrink: 0;
}
.tab-collapse:hover {
  color: #e0e0e0;
}

.side-content {
  flex: 1;
  overflow: hidden;
}

/* Session + connection status overlays */
.status-overlay {
  position: fixed;
  left: 0;
  right: 0;
  z-index: 40;
}

.reconnecting-overlay {
  top: 60px;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.error-overlay {
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(13, 13, 20, 0.94);
  backdrop-filter: blur(4px);
}

.status-toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 45;
}

.status-banner {
  background: #0d0d14;
  border: 1px solid #1a1a2e;
  color: #ddd;
  padding: 8px 16px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
}

.status-banner.reconnecting-banner {
  border-color: #f44336;
  color: #f44336;
}

.status-banner.reconnected-banner {
  border-color: #4caf50;
  color: #6ecf6e;
}

.error-card {
  background: #0d0d14;
  border: 1px solid #1a1a2e;
  border-radius: 16px;
  padding: 24px 28px;
  max-width: 520px;
  width: calc(100% - 48px);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.8);
}

.error-header {
  margin-bottom: 16px;
}

.error-title {
  display: block;
  font-size: 16px;
  font-weight: 600;
  color: #f44336;
  margin-bottom: 6px;
}

.error-message {
  margin: 0;
  font-size: 14px;
  color: #ccc;
}

.error-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 4px;
}

.error-btn {
  padding: 8px 18px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 999px;
  cursor: pointer;
  border: 1px solid transparent;
  background: transparent;
  color: #e0e0e0;
}

.error-btn.primary {
  background: #f44336;
  border-color: #f44336;
  color: #0d0d14;
}

.error-btn.primary:hover {
  background: #ff6659;
  border-color: #ff6659;
}

.error-btn.secondary {
  border-color: #1a1a2e;
  background: #111118;
}

.error-btn.secondary:hover {
  border-color: #f5c542;
}

.status-dot.pulse {
  box-shadow: 0 0 0 0 rgba(244, 67, 54, 0.7);
  animation: status-pulse 1.2s infinite;
}

@keyframes status-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(244, 67, 54, 0.7);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(244, 67, 54, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(244, 67, 54, 0);
  }
}
</style>
