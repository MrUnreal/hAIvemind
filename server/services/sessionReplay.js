/**
 * Session Replay Service — Phase 11.1
 *
 * Provides step-by-step replay of completed sessions with timeline scrubbing.
 * Reconstructs ordered execution steps from saved session data:
 *   - Timeline events (task/agent status changes)
 *   - Agent outputs and summaries
 *   - Task progression through the DAG
 *
 * Each replay step includes: timestamp, type, taskId, agentId, data, and
 * an index for timeline scrubbing.
 */

import { refs } from '../state.js';

/**
 * Build a replay timeline from a completed session.
 * Merges timeline events + agent outputs into a unified, chronologically
 * ordered list of replay steps.
 *
 * @param {string} slug - Project slug
 * @param {string} sessionId - Session ID
 * @returns {{ session: object, steps: object[], summary: object } | null}
 */
export function getReplay(slug, sessionId) {
  const session = loadSession(slug, sessionId);
  if (!session) return null;

  const steps = buildSteps(session);
  const summary = buildSummary(session, steps);

  return { session: sessionMeta(session), steps, summary };
}

/**
 * Get a slice of replay steps (for scrubbing / pagination).
 *
 * @param {string} slug
 * @param {string} sessionId
 * @param {{ from?: number, to?: number, type?: string }} opts
 * @returns {{ steps: object[], total: number } | null}
 */
export function getReplaySlice(slug, sessionId, opts = {}) {
  const session = loadSession(slug, sessionId);
  if (!session) return null;

  let steps = buildSteps(session);
  if (opts.type) steps = steps.filter(s => s.type === opts.type);

  const total = steps.length;
  const from = opts.from || 0;
  const to = opts.to !== undefined ? opts.to : total;

  return { steps: steps.slice(from, to), total };
}

/**
 * Get replay step at a specific index.
 *
 * @param {string} slug
 * @param {string} sessionId
 * @param {number} index
 * @returns {object | null}
 */
export function getReplayStep(slug, sessionId, index) {
  const session = loadSession(slug, sessionId);
  if (!session) return null;

  const steps = buildSteps(session);
  if (index < 0 || index >= steps.length) return { error: 'Index out of range', total: steps.length };
  return steps[index];
}

/**
 * Get the agent outputs for a specific task in a session replay.
 *
 * @param {string} slug
 * @param {string} sessionId
 * @param {string} taskId
 * @returns {object[] | null}
 */
export function getTaskAgents(slug, sessionId, taskId) {
  const session = loadSession(slug, sessionId);
  if (!session) return null;

  const agents = session.agents || [];
  return agents
    .filter(a => a.taskId === taskId)
    .map(a => ({
      id: a.id,
      taskId: a.taskId,
      taskLabel: a.taskLabel,
      model: a.model,
      modelTier: a.modelTier,
      status: a.status,
      retries: a.retries || 0,
      startedAt: a.startedAt,
      finishedAt: a.finishedAt,
      outputLength: a.output?.length || 0,
      summary: a.summary || null,
      failureReport: a.failureReport || null,
    }));
}

/**
 * Get all unique step types available in a session replay.
 *
 * @param {string} slug
 * @param {string} sessionId
 * @returns {string[] | null}
 */
export function getReplayStepTypes(slug, sessionId) {
  const session = loadSession(slug, sessionId);
  if (!session) return null;

  const steps = buildSteps(session);
  return [...new Set(steps.map(s => s.type))];
}

// ── Internal helpers ──

/**
 * Load a session from disk.
 */
function loadSession(slug, sessionId) {
  if (!refs.workspace) return null;
  try {
    return refs.workspace.getSession(slug, sessionId);
  } catch {
    return null;
  }
}

/**
 * Extract lightweight session metadata.
 */
function sessionMeta(session) {
  return {
    id: session.id,
    projectSlug: session.projectSlug,
    prompt: session.prompt,
    status: session.status,
    createdAt: session.createdAt,
    completedAt: session.completedAt,
    taskCount: session.tasks?.length || 0,
    agentCount: session.agents?.length || 0,
    costSummary: session.costSummary || null,
  };
}

/**
 * Build ordered replay steps from session data.
 *
 * Sources:
 * 1. Timeline events (status changes for tasks, agents, verification)
 * 2. Task metadata (start/complete times from tasks array)
 * 3. Agent lifecycle events (spawn time, finish time)
 *
 * Steps are sorted chronologically and assigned sequential indexes.
 */
function buildSteps(session) {
  const steps = [];

  // 1. Session creation step
  steps.push({
    type: 'session:start',
    timestamp: session.createdAt,
    data: {
      prompt: session.prompt,
      projectSlug: session.projectSlug,
    },
  });

  // 2. Timeline events
  if (Array.isArray(session.timeline)) {
    for (const event of session.timeline) {
      steps.push({
        type: event.type || 'timeline',
        timestamp: event.timestamp,
        data: event.data || {},
        taskId: event.data?.taskId || event.data?.id || null,
        agentId: event.data?.agentId || null,
      });
    }
  }

  // 3. Task lifecycle events (if tasks have timing data not in timeline)
  if (Array.isArray(session.tasks)) {
    for (const task of session.tasks) {
      // Only add explicit task entries if they have timing info
      // that isn't already in the timeline
      if (task.startedAt) {
        const alreadyInTimeline = steps.some(
          s => s.taskId === task.id && s.timestamp === task.startedAt
        );
        if (!alreadyInTimeline) {
          steps.push({
            type: 'task:started',
            timestamp: task.startedAt,
            taskId: task.id,
            data: { label: task.label, description: task.description, dependencies: task.dependencies },
          });
        }
      }
      if (task.completedAt) {
        const alreadyInTimeline = steps.some(
          s => s.taskId === task.id && s.timestamp === task.completedAt
        );
        if (!alreadyInTimeline) {
          steps.push({
            type: 'task:completed',
            timestamp: task.completedAt,
            taskId: task.id,
            data: { label: task.label, status: task.status },
          });
        }
      }
    }
  }

  // 4. Agent lifecycle events
  if (Array.isArray(session.agents)) {
    for (const agent of session.agents) {
      if (agent.startedAt) {
        steps.push({
          type: 'agent:started',
          timestamp: agent.startedAt,
          agentId: agent.id,
          taskId: agent.taskId,
          data: {
            model: agent.model,
            modelTier: agent.modelTier,
            taskLabel: agent.taskLabel,
          },
        });
      }
      if (agent.finishedAt) {
        steps.push({
          type: 'agent:finished',
          timestamp: agent.finishedAt,
          agentId: agent.id,
          taskId: agent.taskId,
          data: {
            status: agent.status,
            model: agent.model,
            retries: agent.retries || 0,
            summary: agent.summary || null,
          },
        });
      }
    }
  }

  // 5. Session completion step
  if (session.completedAt) {
    steps.push({
      type: 'session:end',
      timestamp: session.completedAt,
      data: {
        status: session.status,
        costSummary: session.costSummary || null,
      },
    });
  }

  // Sort chronologically, then assign indexes
  steps.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  steps.forEach((step, i) => { step.index = i; });

  return steps;
}

/**
 * Build a high-level summary of the replay.
 */
function buildSummary(session, steps) {
  const types = {};
  for (const s of steps) {
    types[s.type] = (types[s.type] || 0) + 1;
  }

  const durationMs = session.completedAt && session.createdAt
    ? session.completedAt - session.createdAt
    : null;

  return {
    totalSteps: steps.length,
    stepTypes: types,
    durationMs,
    durationFormatted: durationMs ? formatDuration(durationMs) : null,
    taskCount: session.tasks?.length || 0,
    agentCount: session.agents?.length || 0,
    status: session.status,
    firstStep: steps[0]?.timestamp || null,
    lastStep: steps[steps.length - 1]?.timestamp || null,
  };
}

/**
 * Format milliseconds as a human-readable duration.
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSec}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}h ${remainingMin}m`;
}
