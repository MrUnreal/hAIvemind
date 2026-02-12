// Shared WebSocket protocol message types
export const MSG = {
  // Client → Server
  SESSION_START: 'session:start',
  AGENT_RETRY: 'agent:retry',
  CHAT_MESSAGE: 'chat:message',
  GATE_RESPONSE: 'gate:response',

  // Server → Client
  PLAN_CREATED: 'plan:created',
  PLAN_RESEARCH: 'plan:research',
  TASK_STATUS: 'task:status',
  AGENT_STATUS: 'agent:status',
  AGENT_OUTPUT: 'agent:output',
  AGENT_STREAM: 'agent:stream',
  SESSION_COMPLETE: 'session:complete',
  SESSION_ERROR: 'session:error',
  CHAT_RESPONSE: 'chat:response',
  SELFDEV_START: 'selfdev:start',
  SELFDEV_DIFF: 'selfdev:diff',
  VERIFICATION_STATUS: 'verify:status',
  GATE_REQUEST: 'gate:request',
  ITERATION_START: 'iteration:start',
  ITERATION_COMPLETE: 'iteration:complete',
  RECONNECT_SYNC: 'reconnect:sync',

  // Phase 2 — Intelligence & UX
  SKILLS_UPDATE: 'skills:update',
  REFLECTION_CREATED: 'reflection:created',
  SETTINGS_UPDATE: 'settings:update',

  // Phase 3 — Scaling & Extensibility
  DAG_REWRITE: 'dag:rewrite',

  // Phase 7.5 — Swarm Parallelism
  SWARM_WAVE: 'swarm:wave',
  SWARM_SCALING: 'swarm:scaling',
  TASK_SPLIT: 'task:split',
  SPECULATIVE_START: 'task:speculative',

  // Phase 4 — Workspace Intelligence & Cost Control
  SESSION_WARNING: 'session:warning',

  // Phase 5 — Graceful Shutdown & Session Recovery
  SHUTDOWN_WARNING: 'shutdown:warning',
  SESSION_INTERRUPTED: 'session:interrupted',
  SESSION_RESUMED: 'session:resumed',

  // Phase 5.7 — Plugin System
  PLUGIN_EVENT: 'plugin:event',
  PLUGIN_STATUS: 'plugin:status',

  // Phase 6.6 — Autopilot
  AUTOPILOT_STARTED: 'autopilot:started',
  AUTOPILOT_CYCLE: 'autopilot:cycle',
  AUTOPILOT_STOPPED: 'autopilot:stopped',

  // Phase 6.7 — Scoped WS Channels
  WS_SUBSCRIBE: 'ws:subscribe',
  WS_UNSUBSCRIBE: 'ws:unsubscribe',
};

export function makeMsg(type, payload) {
  return JSON.stringify({ type, payload });
}

export function parseMsg(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
