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

    <div v-if="dagRewriteToast" class="status-toast dag-rewrite-toast">
      <div class="status-banner dag-rewrite-banner">
        <span>⚡ DAG Rewrite: {{ dagRewriteToast }}</span>
      </div>
    </div>

    <div v-if="sessionWarningToast" class="status-toast warning-toast">
      <div class="status-banner warning-banner">
        <span>⚠️ {{ sessionWarningToast }}</span>
      </div>
    </div>

    <div v-if="shutdownWarning" class="status-overlay shutdown-overlay">
      <div class="status-banner shutdown-banner">
        <span>🛑 {{ shutdownWarning }}</span>
      </div>
    </div>

    <div v-if="interruptedSessions.length > 0 && !hasActiveProject" class="interrupted-banner">
      <div v-for="is in interruptedSessions" :key="is.sessionId" class="interrupted-item">
        <div class="interrupted-info">
          <span class="interrupted-icon">⚡</span>
          <span>Interrupted session on <strong>{{ is.projectSlug }}</strong> — {{ is.incompleteTasks?.length || 0 }} tasks remaining</span>
        </div>
        <div class="interrupted-actions">
          <button class="interrupted-btn resume" @click="resumeInterrupted(is.sessionId)">Resume</button>
          <button class="interrupted-btn discard" @click="discardInterrupted(is.sessionId)">Discard</button>
        </div>
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
            :class="['tab-btn', { active: sideTab === 'settings' }]"
            @click="sideTab = 'settings'; sidePanelCollapsed = false"
          >
            ⚙️ Settings
          </button>
          <button
            :class="['tab-btn', { active: sideTab === 'metrics' }]"
            @click="sideTab = 'metrics'; sidePanelCollapsed = false"
          >
            📊 Metrics
          </button>
          <button
            :class="['tab-btn', { active: sideTab === 'autopilot' }]"
            @click="sideTab = 'autopilot'; sidePanelCollapsed = false"
          >
            🤖 Autopilot
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
          <SettingsPanel v-if="sideTab === 'settings'" @close="sidePanelCollapsed = true" />
          <MetricsDashboard v-if="sideTab === 'metrics'" @close="sidePanelCollapsed = true" />
          <AutopilotPanel
            v-if="sideTab === 'autopilot' && activeProject?.slug"
            :projectSlug="activeProject.slug"
            @close="sidePanelCollapsed = true"
          />
        </div>
      </div>
    </div>
  </div>
  <CommandPalette />
  <ToastContainer />
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
import SettingsPanel from './components/SettingsPanel.vue';
import MetricsDashboard from './components/MetricsDashboard.vue';
import AutopilotPanel from './components/AutopilotPanel.vue';
import CommandPalette from './components/CommandPalette.vue';
import ToastContainer from './components/ToastContainer.vue';
import { useWebSocket } from './composables/useWebSocket.js';
import { setCommands } from './composables/useCommandPalette.js';
import { toast } from './composables/useToast.js';
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
  projects,
  activeProject,
  hasActiveProject,
  clearProject,
  sessions,
  fetchSessions,
  selectProject,
} from './composables/useProjects.js';
import {
  projectSkills,
  latestReflection,
  loadProjectIntelligence,
  resetProjectIntelligence,
} from './composables/useProjectSettings.js';

const { connected, connectionLost, on, send, subscribeProject } = useWebSocket();
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
const dagRewriteToast = ref('');
const sessionWarningToast = ref('');
const interruptedSessions = ref([]);
const shutdownWarning = ref('');
let reconnectedTimeoutId = null;

// Phase 5.0: Fetch interrupted sessions on startup
(async () => {
  try {
    const res = await fetch('/api/interrupted-sessions');
    if (res.ok) interruptedSessions.value = await res.json();
  } catch { /* server might not support it yet */ }
})();

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
    toast.success('Reconnected');
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

on('dag:rewrite', (payload) => {
  const { removedEdge, toLabel, fromLabel } = payload;
  if (removedEdge) {
    // Mark the edge as rewritten (dashed) briefly, then remove it
    const edgeId = `${removedEdge.from}->${removedEdge.to}`;
    const idx = edges.value.findIndex(e => e.id === edgeId);
    if (idx !== -1) {
      // Briefly show dashed edge, then remove after animation
      edges.value[idx] = {
        ...edges.value[idx],
        style: { strokeDasharray: '8 4', stroke: '#f59e0b' },
        animated: true,
        label: '⚡ rewritten',
      };
      edges.value = [...edges.value]; // trigger reactivity
      setTimeout(() => {
        edges.value = edges.value.filter(e => e.id !== edgeId);
      }, 2000);
    }
  }
  // Show toast notification
  dagRewriteToast.value = `Unblocked "${toLabel}" from stalled "${fromLabel}"`;
  toast.info(`DAG Rewrite: Unblocked "${toLabel}" from stalled "${fromLabel}"`, 5000);
  setTimeout(() => { dagRewriteToast.value = ''; }, 5000);
});

on('session:warning', (payload) => {
  sessionWarningToast.value = payload.message || 'Session warning';
  toast.warning(payload.message || 'Session warning');
  setTimeout(() => { sessionWarningToast.value = ''; }, 6000);
});

on('shutdown:warning', (payload) => {
  shutdownWarning.value = payload.message || 'Server is shutting down';
});

on('session:interrupted', (payload) => {
  interruptedSessions.value.push(payload);
});

on('session:resumed', () => {
  // Refresh interrupted sessions list
  fetch('/api/interrupted-sessions').then(r => r.ok ? r.json() : []).then(data => {
    interruptedSessions.value = data;
  }).catch(() => {});
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

// Throttled stream — batched text for smooth progressive rendering
on('agent:stream', (payload) => {
  if (!agentOutputMap.has(payload.agentId)) {
    agentOutputMap.set(payload.agentId, []);
  }
  // Append as a single batched chunk (no duplicate with agent:output)
  // Stream is additive — UI can choose to use either source
});

// Phase 6.6: Autopilot WebSocket events
on('autopilot:started', () => { /* AutopilotPanel polls for updates */ });
on('autopilot:cycle', () => { /* AutopilotPanel polls for updates */ });
on('autopilot:stopped', () => { /* AutopilotPanel polls for updates */ });

on('session:complete', (payload) => {
  sessionStatus.value = 'completed';
  costSummary.value = payload.costSummary;
  const cost = payload.costSummary?.totalPremiumRequests || 0;
  toast.success(`Session complete — ${cost}× premium requests used`);
  // Refresh session list so history is up to date
  if (activeProject.value) {
    fetchSessions(activeProject.value.slug);
  }
});

on('session:error', (payload) => {
  sessionStatus.value = 'failed';
  sessionError.value = payload?.error || 'An unexpected error occurred during this session.';
  toast.error(payload?.error || 'Session failed');
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

// Phase 2: Handle skills + reflection updates
on('skills:update', (payload) => {
  if (payload.skills) {
    projectSkills.value = payload.skills;
  }
});

on('reflection:created', (payload) => {
  if (payload.reflection) {
    latestReflection.value = payload.reflection;
  }
});

// Load Phase 2 intelligence data when project is selected
watch(activeProject, async (project) => {
  if (project?.slug) {
    loadProjectIntelligence(project.slug);
    // Phase 6.7: Subscribe to project-scoped WS channel
    subscribeProject(project.slug);
  } else {
    resetProjectIntelligence();
    subscribeProject(null);
  }
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

function onSubmit(payload) {
  if (!activeProject.value || !connected.value) return;
  replayMode.value = false;
  sessionError.value = null;
  sessionStatus.value = 'planning';
  showPrompt.value = false;
  // Support both raw string (legacy) and { prompt, templateId, variables } object
  const data = typeof payload === 'string'
    ? { prompt: payload, projectSlug: activeProject.value.slug }
    : { ...payload, projectSlug: activeProject.value.slug };
  send('session:start', data);
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
  resetProjectIntelligence();
  clearProject();
  showPrompt.value = false;
}

function goToProject() {
  replayMode.value = false;
  resetSession();
  showPrompt.value = false;
}

// Phase 5.0: Interrupted session management
async function resumeInterrupted(sessionId) {
  try {
    const res = await fetch(`/api/interrupted-sessions/${sessionId}/resume`, { method: 'POST' });
    if (res.ok) {
      interruptedSessions.value = interruptedSessions.value.filter(s => s.sessionId !== sessionId);
    }
  } catch { /* ignore */ }
}

async function discardInterrupted(sessionId) {
  try {
    const res = await fetch(`/api/interrupted-sessions/${sessionId}/discard`, { method: 'POST' });
    if (res.ok) {
      interruptedSessions.value = interruptedSessions.value.filter(s => s.sessionId !== sessionId);
    }
  } catch { /* ignore */ }
}

// ── Command Palette ──

function buildCommands() {
  const cmds = [];

  // Navigation commands
  cmds.push({
    id: 'nav:home', label: 'Go Home', icon: '🏠', section: 'Navigation',
    hint: 'Return to project picker',
    action: goHome,
  });

  if (hasActiveProject.value) {
    cmds.push({
      id: 'nav:project', label: 'Back to Sessions', icon: '📁', section: 'Navigation',
      hint: activeProject.value.name,
      action: goToProject,
    });
    cmds.push({
      id: 'action:new-session', label: 'New Session', icon: '✨', section: 'Actions',
      hint: 'Start a new build session',
      action: () => { showPrompt.value = true; },
    });
  }

  // Project list commands (quick-switch)
  for (const p of projects.value.slice(0, 8)) {
    cmds.push({
      id: `project:${p.slug}`, label: p.name, icon: '📂', section: 'Projects',
      hint: `${p.sessionCount || 0} sessions`,
      action: () => { selectProject(p); },
    });
  }

  // Side panel tabs (when in active session)
  if (sessionStatus.value !== 'idle') {
    for (const tab of [
      { id: 'agent', label: 'Agent Panel', icon: '🤖' },
      { id: 'chat', label: 'Chat Panel', icon: '💬' },
      { id: 'settings', label: 'Settings', icon: '⚙️' },
      { id: 'metrics', label: 'Metrics', icon: '📊' },
      { id: 'autopilot', label: 'Autopilot', icon: '🤖' },
    ]) {
      cmds.push({
        id: `tab:${tab.id}`, label: tab.label, icon: tab.icon, section: 'Panels',
        action: () => { sideTab.value = tab.id; sidePanelCollapsed.value = false; },
      });
    }
    cmds.push({
      id: 'tab:toggle', label: 'Toggle Side Panel', icon: '◀', section: 'Panels',
      action: () => { sidePanelCollapsed.value = !sidePanelCollapsed.value; },
    });
    cmds.push({
      id: 'action:replay', label: 'Toggle Replay', icon: '🔄', section: 'Actions',
      action: () => { replayMode.value = !replayMode.value; },
    });
  }

  setCommands(cmds);
}

// Rebuild commands when context changes
watch([hasActiveProject, activeProject, sessionStatus, () => projects.value.length], buildCommands, { immediate: true });
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
  border-bottom: 1px solid #1a1a2e;
  flex-shrink: 0;
  position: relative;
}
.header::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(245, 197, 66, 0.3), transparent);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.logo {
  font-size: 18px;
  font-weight: 700;
  background: linear-gradient(135deg, #f5c542, #ffd866);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  cursor: pointer;
  transition: opacity 0.2s;
}
.logo:hover {
  opacity: 0.8;
}

.project-badge {
  font-size: 13px;
  font-weight: 500;
  color: #999;
  background: #14141e;
  border: 1px solid #22223a;
  padding: 4px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s, transform 0.15s;
}
.project-badge:hover {
  border-color: #f5c54266;
  color: #e0e0e0;
  transform: translateY(-1px);
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
  background: #1a1a0e;
  border: 1px solid #33331a;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  color: #f5c542;
  font-weight: 500;
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
  border-left: 1px solid #1a1a2e;
  background: #0f0f16;
  transition: width 0.25s ease;
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
  color: #555;
  font-size: 11px;
  font-weight: 600;
  padding: 10px 6px;
  cursor: pointer;
  transition: color 0.2s, border-bottom 0.2s;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
  overflow: hidden;
  letter-spacing: 0.01em;
}
.tab-btn.active {
  color: #f5c542;
  border-bottom-color: #f5c542;
}
.tab-btn:hover:not(.active) {
  color: #999;
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

.status-banner.dag-rewrite-banner {
  border-color: #f59e0b;
  color: #fbbf24;
}

.status-banner.warning-banner {
  border-color: #f59e0b;
  color: #fbbf24;
  background: #1a1710;
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

/* Phase 5.0: Shutdown & interrupted session styles */
.shutdown-overlay {
  z-index: 100;
}
.shutdown-banner {
  background: #4a0000;
  border-color: #ff1744;
  color: #ff8a80;
  font-weight: bold;
  font-size: 1.1em;
}

.interrupted-banner {
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}
.interrupted-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #1a1a2e;
  border: 1px solid #f5c542;
  border-radius: 8px;
  padding: 10px 16px;
  color: #e0e0e0;
}
.interrupted-info {
  display: flex;
  align-items: center;
  gap: 8px;
}
.interrupted-icon {
  font-size: 1.2em;
}
.interrupted-actions {
  display: flex;
  gap: 8px;
}
.interrupted-btn {
  border: 1px solid;
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 0.85em;
  background: transparent;
}
.interrupted-btn.resume {
  border-color: #66bb6a;
  color: #66bb6a;
}
.interrupted-btn.resume:hover {
  background: #66bb6a22;
}
.interrupted-btn.discard {
  border-color: #ef5350;
  color: #ef5350;
}
.interrupted-btn.discard:hover {
  background: #ef535022;
}
</style>
