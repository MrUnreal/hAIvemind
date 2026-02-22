/**
 * Phase 8.3: Smart Retry Policies
 *
 * Per-project configurable retry behavior with backoff strategies,
 * skip-after-N consecutive failures, and retry reason tracking.
 */

import config from '../config.js';

// ── Backoff Strategies ──

const BACKOFF = {
  /** No delay between retries */
  none: (_attempt) => 0,
  /** Linear backoff: delay = attempt * baseMs */
  linear: (attempt, baseMs = 2000) => attempt * baseMs,
  /** Exponential backoff: delay = baseMs * 2^attempt (capped at 30s) */
  exponential: (attempt, baseMs = 1000) => Math.min(baseMs * Math.pow(2, attempt), 30000),
  /** Fixed delay between retries */
  fixed: (_attempt, baseMs = 3000) => baseMs,
};

/**
 * Build a retry policy from project settings + global config.
 *
 * @param {object} [settings] - Project settings (from workspace.getProjectSettings)
 * @returns {RetryPolicy}
 *
 * @typedef {object} RetryPolicy
 * @property {number} maxRetries - Max retry attempts
 * @property {string} backoffStrategy - 'none' | 'linear' | 'exponential' | 'fixed'
 * @property {number} backoffBaseMs - Base delay in ms for backoff calculation
 * @property {number} skipAfterConsecutiveFailures - Skip task after N consecutive failures (0 = disabled)
 * @property {string[]} escalation - Tier escalation chain
 */
export function buildRetryPolicy(settings = {}) {
  return {
    maxRetries: settings.maxRetriesTotal ?? config.maxRetriesTotal,
    backoffStrategy: settings.backoffStrategy ?? 'none',
    backoffBaseMs: settings.backoffBaseMs ?? 2000,
    skipAfterConsecutiveFailures: settings.skipAfterConsecutiveFailures ?? 0,
    escalation: settings.escalation ?? config.escalation,
  };
}

/**
 * Get the backoff delay for a given retry attempt.
 *
 * @param {RetryPolicy} policy
 * @param {number} attempt - 0-based retry attempt number
 * @returns {number} delay in milliseconds
 */
export function getBackoffDelay(policy, attempt) {
  const fn = BACKOFF[policy.backoffStrategy] || BACKOFF.none;
  return fn(attempt, policy.backoffBaseMs);
}

/**
 * Decide whether to retry a failed task.
 *
 * @param {RetryPolicy} policy
 * @param {number} currentRetries - How many retries have been attempted so far
 * @param {number} consecutiveFailures - How many times in a row this task has failed
 * @returns {{ shouldRetry: boolean, reason: string, delayMs: number }}
 */
export function shouldRetry(policy, currentRetries, consecutiveFailures = 0) {
  if (currentRetries >= policy.maxRetries) {
    return {
      shouldRetry: false,
      reason: `Max retries reached (${policy.maxRetries})`,
      delayMs: 0,
    };
  }

  if (policy.skipAfterConsecutiveFailures > 0 &&
      consecutiveFailures >= policy.skipAfterConsecutiveFailures) {
    return {
      shouldRetry: false,
      reason: `Skipped after ${consecutiveFailures} consecutive failures`,
      delayMs: 0,
    };
  }

  const delayMs = getBackoffDelay(policy, currentRetries);
  return {
    shouldRetry: true,
    reason: currentRetries === 0
      ? 'Initial attempt'
      : `Retry #${currentRetries} (${policy.backoffStrategy} backoff${delayMs > 0 ? `, ${delayMs}ms delay` : ''})`,
    delayMs,
  };
}

/**
 * Create a retry reason record for tracking.
 *
 * @param {string} taskId
 * @param {number} attempt
 * @param {string} reason
 * @param {string} [error]
 * @returns {object}
 */
export function makeRetryRecord(taskId, attempt, reason, error) {
  return {
    taskId,
    attempt,
    reason,
    error: error || null,
    timestamp: Date.now(),
  };
}

/**
 * Validate and normalize retry policy settings.
 * Returns a cleaned policy object with only valid fields.
 *
 * @param {object} input - Raw settings from API
 * @returns {{ valid: boolean, policy: object, errors: string[] }}
 */
export function validateRetrySettings(input) {
  const errors = [];
  const policy = {};

  if (input.maxRetriesTotal !== undefined) {
    const n = parseInt(input.maxRetriesTotal, 10);
    if (isNaN(n) || n < 0 || n > 20) {
      errors.push('maxRetriesTotal must be 0-20');
    } else {
      policy.maxRetriesTotal = n;
    }
  }

  if (input.backoffStrategy !== undefined) {
    if (!BACKOFF[input.backoffStrategy]) {
      errors.push(`backoffStrategy must be one of: ${Object.keys(BACKOFF).join(', ')}`);
    } else {
      policy.backoffStrategy = input.backoffStrategy;
    }
  }

  if (input.backoffBaseMs !== undefined) {
    const n = parseInt(input.backoffBaseMs, 10);
    if (isNaN(n) || n < 0 || n > 60000) {
      errors.push('backoffBaseMs must be 0-60000');
    } else {
      policy.backoffBaseMs = n;
    }
  }

  if (input.skipAfterConsecutiveFailures !== undefined) {
    const n = parseInt(input.skipAfterConsecutiveFailures, 10);
    if (isNaN(n) || n < 0 || n > 10) {
      errors.push('skipAfterConsecutiveFailures must be 0-10');
    } else {
      policy.skipAfterConsecutiveFailures = n;
    }
  }

  if (input.escalation !== undefined) {
    if (!Array.isArray(input.escalation) || input.escalation.length === 0) {
      errors.push('escalation must be a non-empty array');
    } else {
      const validTiers = ['T0', 'T1', 'T2', 'T3'];
      const invalid = input.escalation.filter(t => !validTiers.includes(t));
      if (invalid.length > 0) {
        errors.push(`Invalid tiers: ${invalid.join(', ')}`);
      } else {
        policy.escalation = input.escalation;
      }
    }
  }

  return {
    valid: errors.length === 0,
    policy,
    errors,
  };
}
