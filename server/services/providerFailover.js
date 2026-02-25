/**
 * server/services/providerFailover.js — Phase 15.2: Provider Failover & Cost-Aware Selection
 *
 * Wraps backend selection with automatic failover. If primary provider fails,
 * transparently retries with an alternative provider. Tracks provider health
 * and selects cost-optimal provider when multiple can serve the same model tier.
 */

import { getBackend, listBackends } from '../backends/index.js';
import config from '../config.js';

// ─── Provider Health Tracking ────────────────────────────────────────
/** @type {Map<string, { failures: number, lastFailure: number, lastSuccess: number, totalCalls: number, successRate: number }>} */
const providerHealth = new Map();

const HEALTH_WINDOW_MS = 5 * 60 * 1000; // 5 minute window for failure tracking
const MAX_FAILURES_BEFORE_SKIP = 3;     // Skip provider after 3 consecutive failures
const RECOVERY_CHECK_MS = 60 * 1000;     // Try failed provider again after 1 minute

/**
 * Record a successful call to a provider.
 * @param {string} providerName
 */
export function recordSuccess(providerName) {
  const health = providerHealth.get(providerName) || { failures: 0, lastFailure: 0, lastSuccess: 0, totalCalls: 0, successRate: 1 };
  health.failures = 0;
  health.lastSuccess = Date.now();
  health.totalCalls++;
  health.successRate = health.totalCalls > 0
    ? (health.totalCalls - health.failures) / health.totalCalls
    : 1;
  providerHealth.set(providerName, health);
}

/**
 * Record a failed call to a provider.
 * @param {string} providerName
 */
export function recordFailure(providerName) {
  const health = providerHealth.get(providerName) || { failures: 0, lastFailure: 0, lastSuccess: 0, totalCalls: 0, successRate: 1 };
  health.failures++;
  health.lastFailure = Date.now();
  health.totalCalls++;
  health.successRate = health.totalCalls > 0
    ? Math.max(0, (health.totalCalls - health.failures) / health.totalCalls)
    : 0;
  providerHealth.set(providerName, health);
}

/**
 * Check if a provider is currently healthy (not in cooldown).
 * @param {string} providerName
 * @returns {boolean}
 */
export function isProviderHealthy(providerName) {
  const health = providerHealth.get(providerName);
  if (!health) return true; // Assume healthy if no data

  // Too many recent failures
  if (health.failures >= MAX_FAILURES_BEFORE_SKIP) {
    // Check if enough time has passed to retry
    const timeSinceLastFailure = Date.now() - health.lastFailure;
    if (timeSinceLastFailure < RECOVERY_CHECK_MS) {
      return false;
    }
    // Reset failures to give it another chance
    health.failures = Math.floor(health.failures / 2);
  }

  return true;
}

/**
 * Get the provider health status for all providers.
 * @returns {Array<{ name: string, healthy: boolean, failures: number, successRate: number, lastFailure: number }>}
 */
export function getProviderHealthStatus() {
  const backends = listBackends();
  return backends.map(name => {
    const health = providerHealth.get(name);
    return {
      name,
      healthy: isProviderHealthy(name),
      failures: health?.failures || 0,
      successRate: health?.successRate ?? 1,
      lastFailure: health?.lastFailure || 0,
      lastSuccess: health?.lastSuccess || 0,
      totalCalls: health?.totalCalls || 0,
    };
  });
}

// ─── Provider Tier Mapping ───────────────────────────────────────────
// Maps tier → [{ provider, model, costMultiplier }] (ordered by preference)
export const TIER_PROVIDER_MAP = {
  T0: [
    { provider: 'copilot', model: 'gpt-5.1', multiplier: 0 },
    { provider: 'openai', model: 'gpt-4o-mini', multiplier: 0.1 },
  ],
  T1: [
    { provider: 'copilot', model: 'claude-haiku-4.5', multiplier: 0.33 },
    { provider: 'anthropic', model: 'claude-3-5-haiku-20241022', multiplier: 0.4 },
    { provider: 'openai', model: 'gpt-4o', multiplier: 0.5 },
  ],
  T2: [
    { provider: 'copilot', model: 'claude-sonnet-4.5', multiplier: 1 },
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514', multiplier: 1.2 },
    { provider: 'openai', model: 'gpt-4.5-preview', multiplier: 1.5 },
  ],
  T3: [
    { provider: 'copilot', model: 'claude-opus-4.5', multiplier: 3 },
    { provider: 'anthropic', model: 'claude-opus-4-20250514', multiplier: 3.5 },
    { provider: 'openai', model: 'o3', multiplier: 4 },
  ],
};

/**
 * Get the best available provider for a tier, considering health and cost.
 * @param {string} tier — T0, T1, T2, or T3
 * @returns {{ provider: string, model: string, multiplier: number } | null}
 */
export function getBestProviderForTier(tier) {
  const options = TIER_PROVIDER_MAP[tier] || [];
  const availableBackends = new Set(listBackends());

  for (const option of options) {
    if (!availableBackends.has(option.provider)) continue;
    if (!isProviderHealthy(option.provider)) continue;
    return option;
  }

  // All providers unhealthy — try the first available anyway
  for (const option of options) {
    if (availableBackends.has(option.provider)) return option;
  }

  return null;
}

/**
 * Spawn with failover: try primary provider, fall back to alternatives on failure.
 *
 * @param {string} prompt
 * @param {string} workDir
 * @param {object} opts — { model, modelConfig, tier }
 * @param {string} [primaryProvider] — preferred provider name
 * @returns {{ process: ChildProcess-like, cliCommand: string, provider: string }}
 */
export function spawnWithFailover(prompt, workDir, opts, primaryProvider) {
  const tier = opts.modelConfig?.tier || 'T1';
  const availableBackends = new Set(listBackends());

  // Determine provider order: primary first, then alternatives
  const providerOrder = [];

  if (primaryProvider && availableBackends.has(primaryProvider) && isProviderHealthy(primaryProvider)) {
    providerOrder.push(primaryProvider);
  }

  // Add tier-appropriate alternatives
  const alternatives = TIER_PROVIDER_MAP[tier] || [];
  for (const alt of alternatives) {
    if (!providerOrder.includes(alt.provider) && availableBackends.has(alt.provider) && isProviderHealthy(alt.provider)) {
      providerOrder.push(alt.provider);
    }
  }

  // If no healthy providers, add all available ones
  if (providerOrder.length === 0) {
    for (const name of availableBackends) {
      providerOrder.push(name);
    }
  }

  // Try providers in order
  for (const providerName of providerOrder) {
    try {
      const backend = getBackend(providerName, config.backends?.[providerName] || {});
      const result = backend.spawn(prompt, workDir, opts);
      return { ...result, provider: providerName };
    } catch (err) {
      console.warn(`[failover] Provider ${providerName} failed to spawn: ${err.message}`);
      recordFailure(providerName);
    }
  }

  // All providers failed — throw
  throw new Error(`All providers failed for tier ${tier}. Tried: ${providerOrder.join(', ')}`);
}

/**
 * Reset health tracking (useful for testing).
 */
export function resetHealth() {
  providerHealth.clear();
}
