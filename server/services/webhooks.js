/**
 * Webhook Notification Service — Phase 7.8 + Phase 11.0 enhancements
 *
 * Fires HTTP POST notifications to registered URLs when session events occur.
 * Supports per-project webhook configuration with optional event filtering.
 *
 * Phase 11.0 additions:
 * - HMAC-SHA256 signature verification (X-hAIvemind-Signature header)
 * - Exponential backoff with jitter for retries
 * - Delivery history with per-attempt logging
 * - Test ping endpoint
 * - Webhook update (PUT)
 * - Delivery stats & history endpoints
 *
 * Events: session:started, session:complete, session:failed, session:warning,
 *         task:start, task:complete, task:fail, agent:spawn, agent:exit,
 *         diff:add, diff:review, alert:fire
 */

import { refs } from '../state.js';
import log from '../logger.js';
import { createHmac } from 'crypto';

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const retryTimers = new Map();

/** Delivery history — Map<slug, delivery[]> */
const deliveryHistory = new Map();

/** Max deliveries kept per project */
const MAX_DELIVERY_HISTORY = 200;

/** Default timeout for webhook requests (ms) */
const WEBHOOK_TIMEOUT = 10_000;

/** Max retry attempts for failed deliveries */
const MAX_RETRIES = 3;

/** All supported webhook events */
export const WEBHOOK_EVENTS = [
  'session:started', 'session:complete', 'session:failed', 'session:warning',
  'task:start', 'task:complete', 'task:fail',
  'agent:spawn', 'agent:exit',
  'diff:add', 'diff:review',
  'alert:fire', 'config:change',
  'ping',
];

/**
 * Get webhooks for a project.
 * @param {string} slug - Project slug
 * @returns {object[]} Array of webhook configs
 */
export function getWebhooks(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  return settings.webhooks || [];
}

/**
 * Save webhooks for a project.
 * @param {string} slug
 * @param {object[]} webhooks
 */
export function saveWebhooks(slug, webhooks) {
  refs.workspace?.updateProjectSettings?.(slug, { webhooks });
}

/**
 * Add a webhook to a project.
 * @param {string} slug
 * @param {{ url: string, events?: string[], secret?: string, name?: string, description?: string }} config
 * @returns {object} The created webhook
 */
export function addWebhook(slug, config) {
  if (!config.url) throw new Error('Webhook URL is required');
  try { new URL(config.url); } catch { throw new Error('Invalid webhook URL'); }

  const hooks = getWebhooks(slug);
  const id = `wh-${Date.now().toString(36)}`;
  const webhook = {
    id,
    url: config.url,
    name: config.name || config.url,
    description: config.description || '',
    events: config.events || ['session:complete', 'session:failed'],
    secret: config.secret || null,
    enabled: true,
    createdAt: Date.now(),
    deliveries: 0,
    failures: 0,
    lastDelivery: null,
    lastStatus: null,
  };
  hooks.push(webhook);
  saveWebhooks(slug, hooks);
  return webhook;
}

/**
 * Get a single webhook by ID.
 * @param {string} slug
 * @param {string} webhookId
 * @returns {object|null}
 */
export function getWebhook(slug, webhookId) {
  const hooks = getWebhooks(slug);
  return hooks.find(h => h.id === webhookId) || null;
}

/**
 * Update a webhook's configuration.
 * @param {string} slug
 * @param {string} webhookId
 * @param {object} updates - Fields to update (url, name, events, secret, description)
 * @returns {object|null}
 */
export function updateWebhook(slug, webhookId, updates) {
  const hooks = getWebhooks(slug);
  const hook = hooks.find(h => h.id === webhookId);
  if (!hook) return null;

  if (updates.url !== undefined) {
    try { new URL(updates.url); } catch { throw new Error('Invalid webhook URL'); }
    hook.url = updates.url;
  }
  if (updates.name !== undefined) hook.name = updates.name;
  if (updates.description !== undefined) hook.description = updates.description;
  if (updates.events !== undefined) hook.events = updates.events;
  if (updates.secret !== undefined) hook.secret = updates.secret || null;
  hook.updatedAt = Date.now();
  saveWebhooks(slug, hooks);
  return hook;
}

/**
 * Remove a webhook from a project.
 * @param {string} slug
 * @param {string} webhookId
 * @returns {boolean}
 */
export function removeWebhook(slug, webhookId) {
  const hooks = getWebhooks(slug);
  const idx = hooks.findIndex(h => h.id === webhookId);
  if (idx === -1) return false;
  hooks.splice(idx, 1);
  saveWebhooks(slug, hooks);
  return true;
}

/**
 * Toggle a webhook's enabled state.
 * @param {string} slug
 * @param {string} webhookId
 * @param {boolean} enabled
 * @returns {object|null}
 */
export function toggleWebhook(slug, webhookId, enabled) {
  const hooks = getWebhooks(slug);
  const hook = hooks.find(h => h.id === webhookId);
  if (!hook) return null;
  hook.enabled = enabled;
  saveWebhooks(slug, hooks);
  return hook;
}

/**
 * Compute HMAC-SHA256 signature for a webhook payload.
 * @param {string} body - JSON body string
 * @param {string} secret - Webhook secret
 * @returns {string} hex-encoded HMAC signature
 */
export function computeSignature(body, secret) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Verify an HMAC-SHA256 signature.
 * @param {string} body - JSON body string
 * @param {string} secret - Webhook secret
 * @param {string} signature - Provided signature to verify
 * @returns {boolean}
 */
export function verifySignature(body, secret, signature) {
  const expected = computeSignature(body, secret);
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Fire a webhook event for a project.
 * Sends HTTP POST to all enabled webhooks that subscribe to the given event.
 *
 * @param {string} slug - Project slug
 * @param {string} event - Event name (e.g. 'session:complete')
 * @param {object} payload - Event payload
 * @returns {Promise<{delivered: number, failed: number}>}
 */
export async function fireWebhook(slug, event, payload) {
  const hooks = getWebhooks(slug);
  const eligible = hooks.filter(h => h.enabled && h.events.includes(event));
  if (eligible.length === 0) return { delivered: 0, failed: 0 };

  const body = JSON.stringify({
    event,
    project: slug,
    timestamp: new Date().toISOString(),
    payload,
  });

  const results = await Promise.allSettled(
    eligible.map(hook => deliverWebhook(slug, hook, body, event, 0)),
  );

  const delivered = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.length - delivered;
  if (failed > 0) {
    log.warn(`[webhooks] ${slug}/${event}: ${delivered} delivered, ${failed} failed`);
  } else if (delivered > 0) {
    log.info(`[webhooks] ${slug}/${event}: ${delivered} delivered`);
  }
  return { delivered, failed };
}

/**
 * Send a test ping to a specific webhook.
 * @param {string} slug
 * @param {string} webhookId
 * @returns {Promise<object>} delivery result
 */
export async function testWebhook(slug, webhookId) {
  const hooks = getWebhooks(slug);
  const hook = hooks.find(h => h.id === webhookId);
  if (!hook) return { error: 'Webhook not found' };

  const body = JSON.stringify({
    event: 'ping',
    project: slug,
    timestamp: new Date().toISOString(),
    payload: { test: true, webhookId },
  });

  try {
    await deliverWebhook(slug, hook, body, 'ping', 0);
    return { success: true, webhookId };
  } catch (err) {
    return { success: false, webhookId, error: err.message };
  }
}

/**
 * Deliver a webhook POST with exponential backoff retry.
 * @param {string} slug
 * @param {object} hook
 * @param {string} body
 * @param {string} event
 * @param {number} attempt
 */
async function deliverWebhook(slug, hook, body, event, attempt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT);
  const timerId = `${hook.id}-${Date.now()}`;
  retryTimers.set(timerId, timer);

  const startTime = Date.now();

  try {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'hAIvemind-Webhook/2.0',
      'X-hAIvemind-Event': event,
      'X-hAIvemind-Delivery': timerId,
    };
    // HMAC-SHA256 signature if secret is configured
    if (hook.secret) {
      headers['X-hAIvemind-Signature'] = `sha256=${computeSignature(body, hook.secret)}`;
    }

    const res = await fetch(hook.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);
    retryTimers.delete(timerId);

    const durationMs = Date.now() - startTime;

    if (!res.ok && attempt < MAX_RETRIES) {
      recordDelivery(slug, hook.id, event, attempt, false, res.status, durationMs);
      log.warn(`[webhooks] ${hook.name}: HTTP ${res.status}, retrying (${attempt + 1}/${MAX_RETRIES})`);
      await delay(exponentialBackoff(attempt));
      return deliverWebhook(slug, hook, body, event, attempt + 1);
    }

    // Update delivery stats
    recordDelivery(slug, hook.id, event, attempt, res.ok, res.status, durationMs);
    updateDeliveryStats(slug, hook.id, res.ok);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    clearTimeout(timer);
    retryTimers.delete(timerId);

    const durationMs = Date.now() - startTime;

    if (attempt < MAX_RETRIES && err.name !== 'AbortError') {
      recordDelivery(slug, hook.id, event, attempt, false, 0, durationMs, err.message);
      log.warn(`[webhooks] ${hook.name}: ${err.message}, retrying (${attempt + 1}/${MAX_RETRIES})`);
      await delay(exponentialBackoff(attempt));
      return deliverWebhook(slug, hook, body, event, attempt + 1);
    }

    recordDelivery(slug, hook.id, event, attempt, false, 0, durationMs, err.message);
    updateDeliveryStats(slug, hook.id, false);
    log.error(`[webhooks] ${hook.name}: delivery failed — ${err.message}`);
    throw err;
  }
}

/**
 * Record a delivery attempt in history.
 */
function recordDelivery(slug, webhookId, event, attempt, success, statusCode, durationMs, error) {
  if (!deliveryHistory.has(slug)) deliveryHistory.set(slug, []);
  const history = deliveryHistory.get(slug);
  history.push({
    webhookId,
    event,
    attempt,
    success,
    statusCode,
    durationMs,
    error: error || null,
    timestamp: Date.now(),
  });
  // Cap history
  if (history.length > MAX_DELIVERY_HISTORY) {
    history.splice(0, history.length - MAX_DELIVERY_HISTORY);
  }
}

/**
 * Get delivery history for a project.
 * @param {string} slug
 * @param {{ webhookId?: string, event?: string, limit?: number }} opts
 * @returns {object[]}
 */
export function getDeliveryHistory(slug, opts = {}) {
  const history = deliveryHistory.get(slug) || [];
  let filtered = history;
  if (opts.webhookId) filtered = filtered.filter(d => d.webhookId === opts.webhookId);
  if (opts.event) filtered = filtered.filter(d => d.event === opts.event);
  const limit = opts.limit || 50;
  return filtered.slice(-limit);
}

/**
 * Get delivery statistics for a project.
 * @param {string} slug
 * @returns {object}
 */
export function getDeliveryStats(slug) {
  const history = deliveryHistory.get(slug) || [];
  const total = history.length;
  const successful = history.filter(d => d.success).length;
  const failed = total - successful;
  const avgDuration = total > 0
    ? Math.round(history.reduce((sum, d) => sum + d.durationMs, 0) / total)
    : 0;

  // Group by webhook
  const byWebhook = {};
  for (const d of history) {
    if (!byWebhook[d.webhookId]) {
      byWebhook[d.webhookId] = { total: 0, successful: 0, failed: 0 };
    }
    byWebhook[d.webhookId].total++;
    if (d.success) byWebhook[d.webhookId].successful++;
    else byWebhook[d.webhookId].failed++;
  }

  return { total, successful, failed, avgDurationMs: avgDuration, byWebhook };
}

/**
 * Clear delivery history for a project.
 * @param {string} slug
 */
export function clearDeliveryHistory(slug) {
  deliveryHistory.delete(slug);
}

/**
 * Exponential backoff with jitter.
 * @param {number} attempt - 0-based attempt number
 * @returns {number} delay in ms
 */
function exponentialBackoff(attempt) {
  const base = 1000; // 1s
  const maxDelay = 30_000; // 30s cap
  const exp = Math.min(base * Math.pow(2, attempt), maxDelay);
  const jitter = Math.random() * exp * 0.3; // up to 30% jitter
  return Math.round(exp + jitter);
}

/**
 * Update delivery count for a webhook.
 * @param {string} slug
 * @param {string} webhookId
 * @param {boolean} success
 */
function updateDeliveryStats(slug, webhookId, success) {
  try {
    const hooks = getWebhooks(slug);
    const hook = hooks.find(h => h.id === webhookId);
    if (hook) {
      hook.deliveries = (hook.deliveries || 0) + 1;
      if (!success) hook.failures = (hook.failures || 0) + 1;
      hook.lastDelivery = Date.now();
      hook.lastStatus = success ? 'ok' : 'failed';
      saveWebhooks(slug, hooks);
    }
  } catch { /* best-effort stats */ }
}

/** Simple delay helper */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Clean up any pending retry timers (for graceful shutdown).
 */
export function cleanupWebhooks() {
  for (const [id, timer] of retryTimers) {
    clearTimeout(timer);
    retryTimers.delete(id);
  }
}

/**
 * Reset all in-memory state (for tests).
 */
export function _reset() {
  cleanupWebhooks();
  deliveryHistory.clear();
}
