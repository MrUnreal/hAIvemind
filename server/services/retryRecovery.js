/**
 * server/services/retryRecovery.js — Auto-Retry & Recovery
 *
 * Configurable retry policies per task/session, circuit breaker patterns,
 * automatic fallback strategies, retry budgets.
 *
 * Data stored in project settings under `retryPolicies`, `circuitBreakers`, `retryLog`.
 */

import { refs } from '../state.js';

// ─── Constants ──────────────────────────────────────────────────────────

export const RETRY_STRATEGIES = ['fixed', 'linear', 'exponential'];
export const CIRCUIT_STATES = ['closed', 'open', 'half-open'];
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_DELAY_MS = 1000;
const DEFAULT_CIRCUIT_THRESHOLD = 5;
const DEFAULT_CIRCUIT_TIMEOUT_MS = 30000;

// ─── In-memory circuit breaker state ────────────────────────────────────

const circuitState = new Map(); // key → { state, failureCount, lastFailure, lastStateChange }

// ─── Helpers ────────────────────────────────────────────────────────────

function _genId(prefix = 'rp') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function _getSettings(slug) {
  return refs.workspace?.getProjectSettings?.(slug) || {};
}

function _saveSettings(slug, patch) {
  refs.workspace?.updateProjectSettings?.(slug, patch);
}

// ─── Retry Policy CRUD ─────────────────────────────────────────────────

/**
 * List all retry policies for a project.
 */
export function listRetryPolicies(slug) {
  const settings = _getSettings(slug);
  return settings.retryPolicies || [];
}

/**
 * Get a single retry policy by ID.
 */
export function getRetryPolicy(slug, policyId) {
  const policies = listRetryPolicies(slug);
  return policies.find(p => p.id === policyId) || null;
}

/**
 * Create a retry policy.
 * @param {string} slug
 * @param {object} data
 * @param {string} data.name - Policy name
 * @param {string} [data.strategy='exponential'] - Retry strategy
 * @param {number} [data.maxRetries=3] - Maximum retry attempts
 * @param {number} [data.delayMs=1000] - Base delay between retries
 * @param {number} [data.maxDelayMs] - Max delay cap (for exponential)
 * @param {string[]} [data.retryOn] - Error types/codes to retry on
 * @param {string[]} [data.fallbackActions] - Actions to take on exhaustion
 * @param {number} [data.budgetPerHour] - Max retries per hour (budget)
 * @returns {object}
 */
export function createRetryPolicy(slug, data) {
  if (!data.name) throw new Error('Policy name is required');

  const strategy = RETRY_STRATEGIES.includes(data.strategy) ? data.strategy : 'exponential';
  const policies = listRetryPolicies(slug);

  const policy = {
    id: _genId('rp'),
    name: data.name,
    strategy,
    maxRetries: data.maxRetries ?? DEFAULT_MAX_RETRIES,
    delayMs: data.delayMs ?? DEFAULT_DELAY_MS,
    maxDelayMs: data.maxDelayMs || null,
    retryOn: Array.isArray(data.retryOn) ? data.retryOn : [],
    fallbackActions: Array.isArray(data.fallbackActions) ? data.fallbackActions : [],
    budgetPerHour: data.budgetPerHour || null,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  policies.push(policy);
  _saveSettings(slug, { retryPolicies: policies });
  return policy;
}

/**
 * Update a retry policy.
 */
export function updateRetryPolicy(slug, policyId, patch) {
  const policies = listRetryPolicies(slug);
  const idx = policies.findIndex(p => p.id === policyId);
  if (idx === -1) return null;

  const allowed = ['name', 'strategy', 'maxRetries', 'delayMs', 'maxDelayMs',
    'retryOn', 'fallbackActions', 'budgetPerHour', 'enabled'];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      if (key === 'strategy' && !RETRY_STRATEGIES.includes(patch[key])) continue;
      policies[idx][key] = patch[key];
    }
  }
  policies[idx].updatedAt = Date.now();
  _saveSettings(slug, { retryPolicies: policies });
  return policies[idx];
}

/**
 * Delete a retry policy.
 */
export function deleteRetryPolicy(slug, policyId) {
  const policies = listRetryPolicies(slug);
  const idx = policies.findIndex(p => p.id === policyId);
  if (idx === -1) return false;
  policies.splice(idx, 1);
  _saveSettings(slug, { retryPolicies: policies });
  return true;
}

// ─── Retry Execution ────────────────────────────────────────────────────

/**
 * Calculate the delay for a given attempt number using the policy strategy.
 * @param {object} policy
 * @param {number} attempt - 0-based attempt number
 * @returns {number} Delay in milliseconds
 */
export function calculateDelay(policy, attempt) {
  let delay;
  switch (policy.strategy) {
    case 'fixed':
      delay = policy.delayMs;
      break;
    case 'linear':
      delay = policy.delayMs * (attempt + 1);
      break;
    case 'exponential':
    default:
      delay = policy.delayMs * Math.pow(2, attempt);
      break;
  }
  if (policy.maxDelayMs && delay > policy.maxDelayMs) {
    delay = policy.maxDelayMs;
  }
  return delay;
}

/**
 * Check if a retry should be attempted based on policy and current state.
 * @param {string} slug
 * @param {string} policyId
 * @param {number} currentAttempt - Current attempt number (0-based)
 * @param {string} [errorType] - The error type/code
 * @returns {{ shouldRetry: boolean, reason: string, delay: number }}
 */
export function shouldRetry(slug, policyId, currentAttempt, errorType) {
  const policy = getRetryPolicy(slug, policyId);
  if (!policy) return { shouldRetry: false, reason: 'Policy not found', delay: 0 };
  if (!policy.enabled) return { shouldRetry: false, reason: 'Policy disabled', delay: 0 };

  // Check max retries
  if (currentAttempt >= policy.maxRetries) {
    return { shouldRetry: false, reason: 'Max retries exceeded', delay: 0 };
  }

  // Check retryOn filter
  if (policy.retryOn.length > 0 && errorType && !policy.retryOn.includes(errorType)) {
    return { shouldRetry: false, reason: 'Error type not retryable', delay: 0 };
  }

  // Check budget
  if (policy.budgetPerHour) {
    const log = getRetryLog(slug);
    const oneHourAgo = Date.now() - 3600000;
    const recentRetries = log.filter(e =>
      e.policyId === policyId && e.timestamp > oneHourAgo
    ).length;
    if (recentRetries >= policy.budgetPerHour) {
      return { shouldRetry: false, reason: 'Retry budget exhausted', delay: 0 };
    }
  }

  // Check circuit breaker
  const cbKey = `${slug}:${policyId}`;
  const cb = circuitState.get(cbKey);
  if (cb && cb.state === 'open') {
    const elapsed = Date.now() - cb.lastStateChange;
    if (elapsed < DEFAULT_CIRCUIT_TIMEOUT_MS) {
      return { shouldRetry: false, reason: 'Circuit breaker open', delay: 0 };
    }
    // Transition to half-open
    cb.state = 'half-open';
    cb.lastStateChange = Date.now();
  }

  const delay = calculateDelay(policy, currentAttempt);
  return { shouldRetry: true, reason: 'OK', delay };
}

// ─── Retry Log ──────────────────────────────────────────────────────────

/**
 * Record a retry attempt in the log.
 */
export function recordRetry(slug, entry) {
  const settings = _getSettings(slug);
  const log = settings.retryLog || [];

  const record = {
    id: _genId('retry'),
    policyId: entry.policyId || null,
    taskId: entry.taskId || null,
    attempt: entry.attempt || 0,
    errorType: entry.errorType || null,
    errorMessage: entry.errorMessage || '',
    outcome: entry.outcome || 'retry', // 'retry', 'success', 'exhausted', 'circuit-open'
    delay: entry.delay || 0,
    timestamp: Date.now(),
  };

  log.push(record);

  // Cap at 1000 entries
  if (log.length > 1000) log.splice(0, log.length - 1000);

  _saveSettings(slug, { retryLog: log });

  // Update circuit breaker state
  if (entry.outcome === 'retry' || entry.outcome === 'exhausted') {
    _recordFailure(slug, entry.policyId);
  } else if (entry.outcome === 'success') {
    _recordSuccess(slug, entry.policyId);
  }

  return record;
}

/**
 * Get the retry log for a project.
 * @param {string} slug
 * @param {object} [opts]
 * @param {string} [opts.policyId] - Filter by policy
 * @param {string} [opts.taskId] - Filter by task
 * @param {number} [opts.limit=50] - Max entries
 * @returns {Array}
 */
export function getRetryLog(slug, opts = {}) {
  const settings = _getSettings(slug);
  let log = settings.retryLog || [];

  if (opts.policyId) log = log.filter(e => e.policyId === opts.policyId);
  if (opts.taskId) log = log.filter(e => e.taskId === opts.taskId);

  const limit = opts.limit || 50;
  return log.slice(-limit);
}

// ─── Circuit Breaker ────────────────────────────────────────────────────

/**
 * Get circuit breaker state.
 */
export function getCircuitBreaker(slug, policyId) {
  const key = `${slug}:${policyId}`;
  const cb = circuitState.get(key) || {
    state: 'closed',
    failureCount: 0,
    lastFailure: null,
    lastStateChange: Date.now(),
  };
  return { policyId, ...cb };
}

/**
 * Reset a circuit breaker.
 */
export function resetCircuitBreaker(slug, policyId) {
  const key = `${slug}:${policyId}`;
  circuitState.set(key, {
    state: 'closed',
    failureCount: 0,
    lastFailure: null,
    lastStateChange: Date.now(),
  });
  return getCircuitBreaker(slug, policyId);
}

/**
 * Get all circuit breaker states for a project.
 */
export function listCircuitBreakers(slug) {
  const policies = listRetryPolicies(slug);
  return policies.map(p => getCircuitBreaker(slug, p.id));
}

function _recordFailure(slug, policyId) {
  if (!policyId) return;
  const key = `${slug}:${policyId}`;
  const cb = circuitState.get(key) || {
    state: 'closed',
    failureCount: 0,
    lastFailure: null,
    lastStateChange: Date.now(),
  };

  cb.failureCount++;
  cb.lastFailure = Date.now();

  if (cb.failureCount >= DEFAULT_CIRCUIT_THRESHOLD && cb.state === 'closed') {
    cb.state = 'open';
    cb.lastStateChange = Date.now();
  }

  circuitState.set(key, cb);
}

function _recordSuccess(slug, policyId) {
  if (!policyId) return;
  const key = `${slug}:${policyId}`;
  const cb = circuitState.get(key);
  if (!cb) return;

  if (cb.state === 'half-open') {
    cb.state = 'closed';
    cb.failureCount = 0;
    cb.lastStateChange = Date.now();
    circuitState.set(key, cb);
  }
}

// ─── Retry Stats ────────────────────────────────────────────────────────

/**
 * Get retry statistics for a project.
 */
export function getRetryStats(slug) {
  const log = getRetryLog(slug, { limit: 1000 });
  const outcomeCounts = {};
  const policyRetries = {};

  for (const entry of log) {
    outcomeCounts[entry.outcome] = (outcomeCounts[entry.outcome] || 0) + 1;
    if (entry.policyId) {
      policyRetries[entry.policyId] = (policyRetries[entry.policyId] || 0) + 1;
    }
  }

  const policies = listRetryPolicies(slug);
  const oneHourAgo = Date.now() - 3600000;
  const recentRetries = log.filter(e => e.timestamp > oneHourAgo).length;

  return {
    totalRetries: log.length,
    recentRetries,
    outcomeCounts,
    policyRetries,
    activePolicies: policies.filter(p => p.enabled).length,
    totalPolicies: policies.length,
    circuitBreakers: listCircuitBreakers(slug),
  };
}

/**
 * Reset for testing.
 */
export function _reset() {
  circuitState.clear();
}
