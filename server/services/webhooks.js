/**
 * Webhook Notification Service — Phase 7.8
 *
 * Fires HTTP POST notifications to registered URLs when session events occur.
 * Supports per-project webhook configuration with optional event filtering.
 *
 * Events: session:started, session:complete, session:failed, session:warning
 */

import { refs } from '../state.js';
import log from '../logger.js';

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const retryTimers = new Map();

/** Default timeout for webhook requests (ms) */
const WEBHOOK_TIMEOUT = 10_000;

/** Max retry attempts for failed deliveries */
const MAX_RETRIES = 3;

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
 * @param {{ url: string, events?: string[], secret?: string, name?: string }} config
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
    events: config.events || ['session:complete', 'session:failed'],
    secret: config.secret || null,
    enabled: true,
    createdAt: Date.now(),
    deliveries: 0,
    failures: 0,
  };
  hooks.push(webhook);
  saveWebhooks(slug, hooks);
  return webhook;
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
 * Fire a webhook event for a project.
 * Sends HTTP POST to all enabled webhooks that subscribe to the given event.
 *
 * @param {string} slug - Project slug
 * @param {string} event - Event name (e.g. 'session:complete')
 * @param {object} payload - Event payload
 */
export async function fireWebhook(slug, event, payload) {
  const hooks = getWebhooks(slug);
  const eligible = hooks.filter(h => h.enabled && h.events.includes(event));
  if (eligible.length === 0) return;

  const body = JSON.stringify({
    event,
    project: slug,
    timestamp: new Date().toISOString(),
    payload,
  });

  const results = await Promise.allSettled(
    eligible.map(hook => deliverWebhook(slug, hook, body, 0)),
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.length - succeeded;
  if (failed > 0) {
    log.warn(`[webhooks] ${slug}/${event}: ${succeeded} delivered, ${failed} failed`);
  } else if (succeeded > 0) {
    log.info(`[webhooks] ${slug}/${event}: ${succeeded} delivered`);
  }
}

/**
 * Deliver a webhook POST with retry logic.
 * @param {string} slug
 * @param {object} hook
 * @param {string} body
 * @param {number} attempt
 */
async function deliverWebhook(slug, hook, body, attempt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT);
  const timerId = `${hook.id}-${Date.now()}`;
  retryTimers.set(timerId, timer);

  try {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'hAIvemind-Webhook/1.0',
      'X-hAIvemind-Event': JSON.parse(body).event,
    };
    if (hook.secret) {
      headers['X-hAIvemind-Secret'] = hook.secret;
    }

    const res = await fetch(hook.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);
    retryTimers.delete(timerId);

    if (!res.ok && attempt < MAX_RETRIES) {
      log.warn(`[webhooks] ${hook.name}: HTTP ${res.status}, retrying (${attempt + 1}/${MAX_RETRIES})`);
      await delay(1000 * (attempt + 1)); // Linear backoff
      return deliverWebhook(slug, hook, body, attempt + 1);
    }

    // Update delivery stats
    updateDeliveryStats(slug, hook.id, res.ok);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    clearTimeout(timer);
    retryTimers.delete(timerId);

    if (attempt < MAX_RETRIES && err.name !== 'AbortError') {
      log.warn(`[webhooks] ${hook.name}: ${err.message}, retrying (${attempt + 1}/${MAX_RETRIES})`);
      await delay(1000 * (attempt + 1));
      return deliverWebhook(slug, hook, body, attempt + 1);
    }

    updateDeliveryStats(slug, hook.id, false);
    log.error(`[webhooks] ${hook.name}: delivery failed — ${err.message}`);
    throw err;
  }
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
