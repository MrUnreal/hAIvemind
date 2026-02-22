/**
 * server/services/eventBus.js — Internal Event Bus
 *
 * Pub/sub event system that decouples services, enables plugin hooks,
 * and supports async event processing with wildcard subscriptions.
 */

// ─── Event Store ────────────────────────────────────────────────────
const listeners = new Map();      // event → Set<{ handler, once, id }>
const history = [];               // last N events
const MAX_HISTORY = 200;
let nextId = 1;

// ─── Subscribe ──────────────────────────────────────────────────────

/**
 * Subscribe to an event.
 * @param {string} event - Event name or '*' for all events
 * @param {Function} handler - async-safe callback (data, meta) => void
 * @param {object} opts - { once?: boolean }
 * @returns {number} subscription id for unsubscribe
 */
export function on(event, handler, opts = {}) {
  if (typeof handler !== 'function') throw new Error('Handler must be a function');
  const id = nextId++;
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add({ handler, once: !!opts.once, id });
  return id;
}

/**
 * Subscribe to an event, auto-unsubscribe after first call.
 */
export function once(event, handler) {
  return on(event, handler, { once: true });
}

/**
 * Unsubscribe by subscription id.
 * @returns {boolean} true if found and removed
 */
export function off(subId) {
  for (const [, subs] of listeners) {
    for (const sub of subs) {
      if (sub.id === subId) {
        subs.delete(sub);
        return true;
      }
    }
  }
  return false;
}

/**
 * Remove all listeners for a specific event, or all events.
 */
export function removeAllListeners(event) {
  if (event) {
    listeners.delete(event);
  } else {
    listeners.clear();
  }
}

// ─── Emit ───────────────────────────────────────────────────────────

/**
 * Emit an event, calling all handlers (sync + async safe).
 * @param {string} event
 * @param {*} data
 * @returns {Promise<{ event, listenerCount, errors }>}
 */
export async function emit(event, data = {}) {
  const meta = {
    event,
    timestamp: new Date().toISOString(),
    id: `evt-${Date.now()}-${nextId++}`,
  };

  // Record in history
  history.push({ ...meta, data });
  if (history.length > MAX_HISTORY) history.shift();

  const errors = [];
  let listenerCount = 0;

  // Collect matching handlers: exact + wildcard
  const handlers = [];
  if (listeners.has(event)) {
    for (const sub of listeners.get(event)) handlers.push({ sub, set: listeners.get(event) });
  }
  if (listeners.has('*')) {
    for (const sub of listeners.get('*')) handlers.push({ sub, set: listeners.get('*') });
  }

  for (const { sub, set } of handlers) {
    listenerCount++;
    try {
      await sub.handler(data, meta);
    } catch (err) {
      errors.push({ listener: sub.id, error: err.message || String(err) });
    }
    if (sub.once) set.delete(sub);
  }

  return { event, listenerCount, errors };
}

/**
 * Emit without awaiting handlers (fire-and-forget).
 */
export function emitSync(event, data = {}) {
  emit(event, data).catch(() => {});
}

// ─── History + Stats ────────────────────────────────────────────────

/**
 * Get event history, optionally filtered.
 * @param {object} opts - { event?, limit? }
 */
export function getHistory(opts = {}) {
  let h = [...history];
  if (opts.event) h = h.filter(e => e.event === opts.event);
  const limit = opts.limit || 50;
  return h.slice(-limit);
}

/**
 * Clear event history.
 */
export function clearHistory() {
  history.length = 0;
}

/**
 * Get bus stats.
 */
export function getStats() {
  let totalListeners = 0;
  const eventCounts = {};
  for (const [evt, subs] of listeners) {
    eventCounts[evt] = subs.size;
    totalListeners += subs.size;
  }

  // Count event types in history
  const historyCounts = {};
  for (const h of history) {
    historyCounts[h.event] = (historyCounts[h.event] || 0) + 1;
  }

  return {
    totalListeners,
    eventCounts,
    historySize: history.length,
    historyCounts,
  };
}

/**
 * List all registered event names.
 */
export function listEvents() {
  return [...listeners.keys()];
}

// ─── Well-Known Events ──────────────────────────────────────────────
export const EVENTS = {
  SESSION_START: 'session:start',
  SESSION_END: 'session:end',
  SESSION_ERROR: 'session:error',
  TASK_START: 'task:start',
  TASK_COMPLETE: 'task:complete',
  TASK_FAIL: 'task:fail',
  AGENT_SPAWN: 'agent:spawn',
  AGENT_EXIT: 'agent:exit',
  PLUGIN_LOAD: 'plugin:load',
  PLUGIN_UNLOAD: 'plugin:unload',
  PROJECT_CREATE: 'project:create',
  PROJECT_DELETE: 'project:delete',
  DIFF_ADD: 'diff:add',
  DIFF_REVIEW: 'diff:review',
  ALERT_FIRE: 'alert:fire',
  MEMORY_ADD: 'memory:add',
  CONFIG_CHANGE: 'config:change',
};

// ─── Reset (for tests) ─────────────────────────────────────────────
export function _reset() {
  listeners.clear();
  history.length = 0;
  nextId = 1;
}
