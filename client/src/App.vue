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
      </div>
    </header>

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
      @submit="onSubmit"
    />

    <!-- Step 3: Active/loaded session workspace -->
    <div v-else class="workspace">
      <FlowCanvas class="flow-area" />
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
import { ref, onMounted, watch } from 'vue';
import ProjectPicker from './components/ProjectPicker.vue';
import PromptInput from './components/PromptInput.vue';
import FlowCanvas from './components/FlowCanvas.vue';
import AgentDetail from './components/AgentDetail.vue';
import SessionHistory from './components/SessionHistory.vue';
import OrchestratorChat from './components/OrchestratorChat.vue';
import { useWebSocket } from './composables/useWebSocket.js';
import {
  sessionStatus,
  tasks,
  edges,
  taskStatusMap,
  agentMap,
  agentOutputMap,
  selectedAgentId,
  costSummary,
  resetSession,
} from './composables/useSession.js';
import {
  activeProject,
  hasActiveProject,
  clearProject,
  sessions,
  fetchSessions,
} from './composables/useProjects.js';

const { connected, on, send } = useWebSocket();
const showPrompt = ref(false);
const sideTab = ref('agent');
const sidePanelCollapsed = ref(true);

// Auto-open agent panel when a node is clicked
watch(selectedAgentId, (val) => {
  if (val) {
    sideTab.value = 'agent';
    sidePanelCollapsed.value = false;
  }
});

// ── WS event handlers ──

on('plan:created', (payload) => {
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
  console.error('Session error:', payload.error);
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

function onSubmit(prompt) {
  if (!activeProject.value) return;
  sessionStatus.value = 'planning';
  showPrompt.value = false;
  send('session:start', { prompt, projectSlug: activeProject.value.slug });
}

function goHome() {
  resetSession();
  clearProject();
  showPrompt.value = false;
}

function goToProject() {
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

.workspace {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.flow-area {
  flex: 1;
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
</style>
