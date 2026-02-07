// Shared WebSocket protocol message types
export const MSG = {
  // Client → Server
  SESSION_START: 'session:start',
  AGENT_RETRY: 'agent:retry',
  CHAT_MESSAGE: 'chat:message',

  // Server → Client
  PLAN_CREATED: 'plan:created',
  TASK_STATUS: 'task:status',
  AGENT_STATUS: 'agent:status',
  AGENT_OUTPUT: 'agent:output',
  SESSION_COMPLETE: 'session:complete',
  SESSION_ERROR: 'session:error',
  CHAT_RESPONSE: 'chat:response',
  VERIFICATION_STATUS: 'verify:status',
  ITERATION_START: 'iteration:start',
  ITERATION_COMPLETE: 'iteration:complete',
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
