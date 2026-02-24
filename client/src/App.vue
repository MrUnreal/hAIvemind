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
        <button class="theme-toggle-btn" @click="toggleTheme" :title="isDark ? 'Switch to light theme' : 'Switch to dark theme'">
          {{ isDark ? '☀️' : '🌙' }}
        </button>
        <button v-if="activeProject" class="notif-bell-btn" @click="showNotifications = !showNotifications" title="Notifications">
          🔔<span v-if="notifBadge > 0" class="notif-badge">{{ notifBadge }}</span>
        </button>
        <NotificationCenter
          :visible="showNotifications"
          :projectSlug="activeProject?.slug || ''"
          @close="showNotifications = false"
        />
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
          <!-- Session group -->
          <div class="tab-group tab-group--session">
            <button
              v-for="tab in tabGroups.session"
              :key="tab.id"
              :class="['tab-btn', { active: sideTab === tab.id }]"
              :title="tab.label"
              @click="sideTab = tab.id; sidePanelCollapsed = false"
            >
              {{ tab.icon }}
            </button>
          </div>
          <!-- Config group -->
          <div class="tab-group tab-group--config">
            <button
              v-for="tab in tabGroups.config"
              :key="tab.id"
              :class="['tab-btn', { active: sideTab === tab.id }]"
              :title="tab.label"
              @click="sideTab = tab.id; sidePanelCollapsed = false"
            >
              {{ tab.icon }}
            </button>
          </div>
          <!-- Monitor group -->
          <div class="tab-group tab-group--monitor">
            <button
              v-for="tab in tabGroups.monitor"
              :key="tab.id"
              :class="['tab-btn', { active: sideTab === tab.id }]"
              :title="tab.label"
              @click="sideTab = tab.id; sidePanelCollapsed = false"
            >
              {{ tab.icon }}
            </button>
          </div>
          <button
            class="tab-collapse"
            @click="sidePanelCollapsed = !sidePanelCollapsed"
          >
            {{ sidePanelCollapsed ? '◀' : '▶' }}
          </button>
        </div>
        <div v-if="sideTab && !sidePanelCollapsed" :class="['side-tab-label', `label--${currentTabGroup}`]">
          {{ currentTabLabel }}
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
          <TemplatesPanel
            v-if="sideTab === 'templates'"
            :visible="sideTab === 'templates' && !sidePanelCollapsed"
            :projectSlug="activeProject?.slug"
            @close="sidePanelCollapsed = true"
            @launch="handleTemplateLaunch"
          />
          <ApiKeyPanel
            v-if="sideTab === 'keys'"
            :visible="sideTab === 'keys' && !sidePanelCollapsed"
            :projectSlug="activeProject?.slug"
            @close="sidePanelCollapsed = true"
          />
          <AuditLogPanel
            v-if="sideTab === 'audit'"
            :visible="sideTab === 'audit' && !sidePanelCollapsed"
            :projectSlug="activeProject?.slug"
            @close="sidePanelCollapsed = true"
          />
          <AnalyticsPanel
            v-if="sideTab === 'analytics'"
            :visible="sideTab === 'analytics' && !sidePanelCollapsed"
            :projectSlug="activeProject?.slug"
            @close="sidePanelCollapsed = true"
          />
          <ResourcePanel
            v-if="sideTab === 'resources'"
            :visible="sideTab === 'resources' && !sidePanelCollapsed"
            :projectSlug="activeProject?.slug"
            @close="sidePanelCollapsed = true"
          />
          <DiffReviewPanel
            v-if="sideTab === 'diffs'"
            :visible="sideTab === 'diffs' && !sidePanelCollapsed"
            :projectSlug="activeProject?.slug"
            @close="sidePanelCollapsed = true"
          />
          <LiveDashboard
            v-if="sideTab === 'live'"
            :visible="sideTab === 'live' && !sidePanelCollapsed"
            @close="sidePanelCollapsed = true"
          />
          <SuggestionsPanel
            v-if="sideTab === 'suggestions'"
            :visible="sideTab === 'suggestions' && !sidePanelCollapsed"
            :projectSlug="activeProject?.slug"
            @close="sidePanelCollapsed = true"
            @usePrompt="handleSuggestionUse"
          />
          <MemoryPanel
            v-if="sideTab === 'memory'"
            :visible="sideTab === 'memory' && !sidePanelCollapsed"
            :projectSlug="activeProject?.slug"
            @close="sidePanelCollapsed = true"
          />
          <AuthPanel
            v-if="sideTab === 'auth'"
            :visible="sideTab === 'auth' && !sidePanelCollapsed"
            @close="sidePanelCollapsed = true"
          />
        </div>
      </div>
    </div>
  </div>
  <CommandPalette />
  <ToastContainer />
  <KeyboardShortcutsHelp />
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import ProjectPicker from './components/ProjectPicker.vue';
import PromptInput from './components/PromptInput.vue';
import FlowCanvas from './components/FlowCanvas.vue';
import SessionReplay from './components/SessionReplay.vue';
import AgentDetail from './components/AgentDetail.vue';
import SessionHistory from './components/SessionHistory.vue';
import OrchestratorChat from './components/OrchestratorChat.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import MetricsDashboard from './components/MetricsDashboard.vue';
import LiveDashboard from './components/LiveDashboard.vue';
import AutopilotPanel from './components/AutopilotPanel.vue';
import CommandPalette from './components/CommandPalette.vue';
import ToastContainer from './components/ToastContainer.vue';
import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp.vue';
import NotificationCenter from './components/NotificationCenter.vue';
import ApiKeyPanel from './components/ApiKeyPanel.vue';
import TemplatesPanel from './components/TemplatesPanel.vue';
import AuditLogPanel from './components/AuditLogPanel.vue';
import AuthPanel from './components/AuthPanel.vue';
import AnalyticsPanel from './components/AnalyticsPanel.vue';
import MemoryPanel from './components/MemoryPanel.vue';
import SuggestionsPanel from './components/SuggestionsPanel.vue';
import ResourcePanel from './components/ResourcePanel.vue';
import DiffReviewPanel from './components/DiffReviewPanel.vue';
import { useWebSocket } from './composables/useWebSocket.js';
import { setCommands, openPalette, togglePalette } from './composables/useCommandPalette.js';
import { toast } from './composables/useToast.js';
import { registerShortcuts, installShortcutListener } from './composables/useKeyboardShortcuts.js';
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
  swarmWave,
  speculativeTasks,
  splitTasks,
  swarmStats,
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
import { useTheme } from './composables/useTheme.js';

const { isDark, toggleTheme } = useTheme();
const { connected, connectionLost, on, send, subscribeProject } = useWebSocket();
const showPrompt = ref(false);
const sideTab = ref('agent');
const sidePanelCollapsed = ref(true);

// Tab groups: icon-only buttons grouped by purpose
const tabGroups = {
  session: [
    { id: 'agent', icon: '🤖', label: 'Agent Detail' },
    { id: 'chat', icon: '💬', label: 'Chat' },
    { id: 'diffs', icon: '📝', label: 'Diffs' },
    { id: 'metrics', icon: '📊', label: 'Metrics' },
    { id: 'autopilot', icon: '🚀', label: 'Autopilot' },
  ],
  config: [
    { id: 'settings', icon: '⚙️', label: 'Settings' },
    { id: 'templates', icon: '📋', label: 'Templates' },
    { id: 'keys', icon: '🔑', label: 'Keys' },
    { id: 'suggestions', icon: '💡', label: 'Hints' },
    { id: 'memory', icon: '🧠', label: 'Memory' },
  ],
  monitor: [
    { id: 'analytics', icon: '📈', label: 'Stats' },
    { id: 'resources', icon: '🖥️', label: 'Resources' },
    { id: 'live', icon: '📡', label: 'Live' },
    { id: 'audit', icon: '📜', label: 'Audit' },
    { id: 'auth', icon: '🔐', label: 'Auth' },
  ],
};
const allTabs = [...tabGroups.session, ...tabGroups.config, ...tabGroups.monitor];
const currentTabLabel = computed(() => allTabs.find(t => t.id === sideTab.value)?.label ?? '');
const currentTabGroup = computed(() => {
  const id = sideTab.value;
  if (tabGroups.session.some(t => t.id === id)) return 'session';
  if (tabGroups.config.some(t => t.id === id)) return 'config';
  if (tabGroups.monitor.some(t => t.id === id)) return 'monitor';
  return '';
});
const replayMode = ref(false);
const showNotifications = ref(false);
const notifBadge = ref(0);
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

// ── Swarm events (update reactive state for UI) ──

on('swarm:wave', (payload) => {
  swarmWave.value = payload;
});

on('swarm:scaling', () => {
  // Handled by OrchestratorChat toast
});

on('task:split', (payload) => {
  splitTasks.value.add(payload.originalTaskId);
  toast.info(`🔀 "${payload.originalLabel}" split into ${payload.subtasks.length} sub-tasks`);
});

on('task:speculative', (payload) => {
  speculativeTasks.value.add(payload.taskId);
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
  swarmStats.value = payload.swarmStats || null;
  const cost = payload.costSummary?.totalPremiumRequests || 0;
  const ss = payload.swarmStats;
  if (ss?.peakConcurrency > 1) {
    toast.success(`Session complete — ${cost}× premium, peak ${ss.peakConcurrency} concurrent agents`);
  } else {
    toast.success(`Session complete — ${cost}× premium requests used`);
  }
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

function handleTemplateLaunch({ prompt }) {
  onSubmit(prompt);
}

function handleSuggestionUse(text) {
  showPrompt.value = true;
  // Small delay to let PromptInput mount, then pre-fill
  setTimeout(() => {
    const textarea = document.querySelector('.prompt-input textarea');
    if (textarea) {
      textarea.value = text;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, 100);
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

// ── Keyboard Shortcuts (7.4) ──

registerShortcuts([
  {
    key: 'h', label: 'H', description: 'Go home (project picker)',
    group: 'Navigation', action: goHome,
  },
  {
    key: 'n', label: 'N', description: 'New session',
    group: 'Navigation', action: () => { if (hasActiveProject.value) showPrompt.value = true; },
  },
  {
    key: 's', label: 'S', description: 'Back to sessions list',
    group: 'Navigation', action: () => { if (hasActiveProject.value) goToProject(); },
  },
  {
    key: '1', label: '1', description: 'Agent panel',
    group: 'Panels', action: () => { sideTab.value = 'agent'; sidePanelCollapsed.value = false; },
  },
  {
    key: '2', label: '2', description: 'Chat panel',
    group: 'Panels', action: () => { sideTab.value = 'chat'; sidePanelCollapsed.value = false; },
  },
  {
    key: '3', label: '3', description: 'Settings panel',
    group: 'Panels', action: () => { sideTab.value = 'settings'; sidePanelCollapsed.value = false; },
  },
  {
    key: '4', label: '4', description: 'Metrics panel',
    group: 'Panels', action: () => { sideTab.value = 'metrics'; sidePanelCollapsed.value = false; },
  },
  {
    key: '5', label: '5', description: 'Autopilot panel',
    group: 'Panels', action: () => { sideTab.value = 'autopilot'; sidePanelCollapsed.value = false; },
  },
  {
    key: '[', label: '[', description: 'Collapse side panel',
    group: 'Panels', action: () => { sidePanelCollapsed.value = true; },
  },
  {
    key: ']', label: ']', description: 'Expand side panel',
    group: 'Panels', action: () => { sidePanelCollapsed.value = false; },
  },
  {
    key: 'r', label: 'R', description: 'Toggle session replay',
    group: 'Actions', action: () => { if (sessionStatus.value !== 'idle') replayMode.value = !replayMode.value; },
  },
  {
    key: 'k', label: 'Ctrl+K', description: 'Open command palette',
    group: 'Actions', ctrlKey: true, action: togglePalette,
  },
]);

const cleanupShortcuts = installShortcutListener();
onUnmounted(() => cleanupShortcuts());
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
  background: var(--header-bg);
  border-bottom: 1px solid var(--header-border);
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
  background: linear-gradient(90deg, transparent, var(--accent-gold-dim), transparent);
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
  color: var(--text-secondary);
  background: var(--badge-bg);
  border: 1px solid var(--badge-border);
  padding: 4px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s, transform 0.15s;
}
.project-badge:hover {
  border-color: var(--accent-gold-dim);
  color: var(--text-primary);
  transform: translateY(-1px);
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text-muted);
}

.theme-toggle-btn {
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s, transform 0.15s;
  line-height: 1;
}
.theme-toggle-btn:hover {
  background: var(--btn-hover-bg);
  border-color: var(--accent-gold);
  transform: translateY(-1px);
}

.notif-bell-btn {
  position: relative;
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s, transform 0.15s;
  line-height: 1;
}
.notif-bell-btn:hover {
  background: var(--btn-hover-bg);
  border-color: var(--accent-gold);
  transform: translateY(-1px);
}
.notif-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  background: var(--status-error);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  min-width: 16px;
  height: 16px;
  border-radius: 99px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.status-dot.green { background: #4caf50; }
.status-dot.red { background: #f44336; }

.cost-badge {
  background: var(--badge-bg);
  border: 1px solid var(--badge-border);
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  color: var(--accent-gold);
  font-weight: 500;
}

.replay-btn {
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--btn-text);
  cursor: pointer;
}
.replay-btn.active {
  background: var(--accent-gold);
  border-color: var(--accent-gold);
  color: var(--bg-primary);
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
  flex: 3;
  overflow: hidden;
  position: relative;
  min-height: 200px;
}

.replay-panel {
  flex: 0 0 auto;
  min-height: 160px;
  max-height: 35vh;
  overflow-y: auto;
  border-top: 2px solid var(--border-subtle);
}

.side-panel {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--header-border);
  background: var(--bg-primary);
  transition: width 0.25s ease;
  width: 480px;
  flex-shrink: 0;
}
.side-panel.collapsed {
  width: 42px;
}

.side-tabs {
  display: flex;
  align-items: end;
  flex-shrink: 0;
  padding: 0;
  gap: 0;
  background: var(--bg-primary);
  position: relative;
}
/* bottom line that runs behind all tabs */
.side-tabs::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--border-subtle);
  z-index: 0;
}

/* Tab groups — colored bottom accent bar per group */
.tab-group {
  display: flex;
  align-items: end;
  gap: 0;
  padding: 3px 4px 0;
  position: relative;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  z-index: 1;
}
.tab-group--session { border-bottom-color: rgba(110, 168, 217, 0.3); }
.tab-group--config  { border-bottom-color: rgba(212, 168, 67, 0.3); }
.tab-group--monitor { border-bottom-color: rgba(90, 191, 123, 0.3); }

.tab-btn {
  background: none;
  border: 1px solid transparent;
  border-bottom: none;
  color: var(--text-tertiary);
  font-size: 15px;
  padding: 5px 6px 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  border-radius: 6px 6px 0 0;
  line-height: 1;
  position: relative;
  z-index: 1;
  margin-bottom: -2px;
  opacity: 0.6;
}
.tab-btn:hover:not(.active) {
  opacity: 1;
  background: rgba(255, 255, 255, 0.05);
}

/* Active tab — lifts above the bottom line */
.tab-btn.active {
  opacity: 1;
  z-index: 2;
  background: var(--bg-primary);
  border-color: var(--border-subtle);
  margin-bottom: -1px;
  padding-bottom: 7px;
}

/* Group color tints on icons */
.tab-group--session .tab-btn { color: #7bb8e8; }
.tab-group--session .tab-btn.active { color: #a0d4ff; border-color: #5a9cc8; }
.tab-group--config  .tab-btn { color: #d4a843; }
.tab-group--config  .tab-btn.active { color: #f5c94a; border-color: #b8912e; }
.tab-group--monitor .tab-btn { color: #5ec47e; }
.tab-group--monitor .tab-btn.active { color: #80eca0; border-color: #3da85a; }

.side-tab-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  padding: 4px 12px 3px;
  border-bottom: 1px solid var(--border-subtle);
}
.side-tab-label.label--session { color: #a0d4ff; }
.side-tab-label.label--config  { color: #f5c94a; }
.side-tab-label.label--monitor { color: #80eca0; }

.side-panel.collapsed .tab-group {
  display: none;
}

.side-panel.collapsed .side-tab-label {
  display: none;
}

.tab-collapse {
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 12px;
  padding: 10px 12px;
  cursor: pointer;
  flex-shrink: 0;
}
.tab-collapse:hover {
  color: var(--text-primary);
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
  background: var(--bg-overlay);
  backdrop-filter: blur(4px);
}

.status-toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 45;
}

.status-banner {
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  color: var(--text-primary);
  padding: 8px 16px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: var(--shadow-lg);
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
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 16px;
  padding: 24px 28px;
  max-width: 520px;
  width: calc(100% - 48px);
  box-shadow: var(--shadow-lg);
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
  color: var(--text-secondary);
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
  color: var(--text-primary);
}

.error-btn.primary {
  background: var(--status-error);
  border-color: var(--status-error);
  color: var(--bg-primary);
}

.error-btn.primary:hover {
  background: #ff6659;
  border-color: #ff6659;
}

.error-btn.secondary {
  border-color: var(--border-primary);
  background: var(--header-bg);
}

.error-btn.secondary:hover {
  border-color: var(--accent-gold);
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
  background: var(--bg-card);
  border: 1px solid var(--accent-gold);
  border-radius: 8px;
  padding: 10px 16px;
  color: var(--text-primary);
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
