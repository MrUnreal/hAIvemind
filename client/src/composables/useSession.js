import { ref, reactive, computed } from 'vue';

/**
 * Reactive session state — shared across all components.
 * Singleton pattern: import once, share everywhere.
 */

/** @type {'idle'|'planning'|'running'|'completed'|'failed'} */
export const sessionStatus = ref('idle');

/** @type {import('vue').Ref<string|null>} - top-level session error message */
export const sessionError = ref(null);

/** @type {import('vue').Ref<string|null>} */
export const activeSessionId = ref(null);

/** @type {import('vue').Ref<object[]>} */
export const tasks = ref([]);

/** @type {import('vue').Ref<object[]>} */
export const edges = ref([]);

/** @type {Map<string, object>} - taskId → task status */
export const taskStatusMap = reactive(new Map());

/** @type {Map<string, object>} - agentId → agent info */
export const agentMap = reactive(new Map());

/** @type {Map<string, string[]>} - agentId → output chunks */
export const agentOutputMap = reactive(new Map());

/** @type {import('vue').Ref<string|null>} - currently selected agent for detail view */
export const selectedAgentId = ref(null);

/** @type {import('vue').Ref<object|null>} */
export const costSummary = ref(null);

/** @type {import('vue').Ref<object[]>} - event log for this session (internal) */
const eventLog = ref([]);

/** @type {import('vue').Ref<object[]>} - raw timeline events for this session */
export const timeline = ref([]);

/** Map taskId → latest agent info */
export const taskAgentMap = computed(() => {
  const map = new Map();
  for (const [agentId, agent] of agentMap) {
    const existing = map.get(agent.taskId);
    if (!existing || agent.retries >= existing.retries) {
      map.set(agent.taskId, { ...agent, agentId });
    }
  }
  return map;
});

export function resetSession() {
  sessionStatus.value = 'idle';
  sessionError.value = null;
  activeSessionId.value = null;
  tasks.value = [];
  edges.value = [];
  taskStatusMap.clear();
  agentMap.clear();
  agentOutputMap.clear();
  selectedAgentId.value = null;
  costSummary.value = null;
  eventLog.value = [];
  timeline.value = [];
}

/** Push a human-readable event into the log (internal) */
function logEvent(msg) {
  eventLog.value.push({
    time: Date.now(),
    message: msg,
  });
}

/**
 * Load a completed session from the API — restores the full DAG + agent state.
 * @param {string} projectSlug
 * @param {string} sessionId
 */
export async function loadSession(projectSlug, sessionId) {
  resetSession();
  activeSessionId.value = sessionId;
  sessionStatus.value = 'loading';

  try {
    const res = await fetch(`/api/projects/${projectSlug}/sessions/${sessionId}`);
    if (!res.ok) throw new Error('Failed to load session');
    const session = await res.json();

    // Restore tasks and edges
    if (Array.isArray(session.tasks)) {
      tasks.value = session.tasks;
    }
    if (Array.isArray(session.edges)) {
      edges.value = session.edges;
    }

    // Restore agent data
    if (session.agents && typeof session.agents === 'object') {
      for (const [agentId, agent] of Object.entries(session.agents)) {
        agentMap.set(agentId, {
          agentId,
          taskId: agent.taskId,
          model: agent.model,
          modelTier: agent.modelTier,
          multiplier: agent.multiplier,
          status: agent.status,
          retries: agent.retries,
          reason: agent.reason,
        });

        // Restore task status from agent data
        const existing = taskStatusMap.get(agent.taskId);
        if (!existing || agent.retries >= (existing.retries || 0)) {
          taskStatusMap.set(agent.taskId, {
            taskId: agent.taskId,
            status: agent.status,
            retries: agent.retries,
            modelTier: agent.modelTier,
          });
        }

        // Restore output
        if (Array.isArray(agent.output) && agent.output.length > 0) {
          agentOutputMap.set(agentId, agent.output);
        }
      }
    }

    costSummary.value = session.costSummary || null;
    timeline.value = Array.isArray(session.timeline) ? session.timeline : [];
    sessionStatus.value = session.status || 'completed';

    // Build event log from agent data
    if (session.agents) {
      const agents = Object.values(session.agents).sort((a, b) => a.startedAt - b.startedAt);
      for (const agent of agents) {
        if (agent.reason) {
          logEvent(agent.reason);
        }
        if (agent.status === 'success') {
          logEvent(`✅ Task completed with ${agent.model} (${agent.modelTier})`);
        } else if (agent.status === 'failed') {
          logEvent(`❌ ${agent.model} failed — will retry with escalated model`);
        }
      }
    }
  } catch (err) {
    console.error('[session] Failed to load:', err);
    sessionStatus.value = 'failed';
  }
}
