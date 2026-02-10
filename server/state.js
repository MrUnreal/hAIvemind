/**
 * Shared mutable state — Phase 6.8
 *
 * Single source of truth for all in-memory state that is shared
 * across routes, services, and WebSocket handlers.
 */

/** @type {Map<string, object>} */
export const sessions = new Map();

/** Map from taskId to sessionId for timeline attribution */
export const taskToSession = new Map();

/** Active orchestrator contexts (for post-completion chat) */
export const activeContexts = new Map();

/** Workspace directory locks to prevent concurrent sessions */
export const workDirLocks = new Map();

/** Connected WebSocket clients */
/** @type {Set<import('ws').WebSocket>} */
export const clients = new Set();

/** Active autopilot runs: slug → { running, abortController, cycles, decisions } */
export const autopilotRuns = new Map();

/**
 * Mutable references to singletons set during initialization.
 * Avoids circular dependencies — modules read refs at call time, not import time.
 */
export const refs = {
  /** @type {import('./workspace.js').default|null} */
  workspace: null,
  /** @type {import('./pluginManager.js').default|null} */
  pluginManager: null,
  /** Swarm manager instance */
  swarmInstance: null,
  /** Checkpoint timer handle */
  checkpointTimer: null,
  /** Prune interval ID */
  pruneIntervalId: null,
  /** Heartbeat interval ID */
  heartbeatInterval: null,
  /** WebSocket server instance */
  wss: null,
  /** HTTP server instance */
  server: null,
  /** Demo / mock mode flag */
  DEMO: false,
  /** Templates directory path */
  TEMPLATES_DIR: '',
};
