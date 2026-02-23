/**
 * server/services/notificationChannels.js — External Notification Channels
 *
 * Configurable per-project notification integrations:
 *   - Slack (webhook URL)
 *   - Discord (webhook URL)
 *   - Email (SMTP or API placeholder)
 *   - Custom webhook (arbitrary URL)
 *
 * Each channel supports: real-time (immediate) or digest mode.
 * Digest collects events and flushes on interval or manual trigger.
 */

import { refs } from '../state.js';

// ─── Channel Types ──────────────────────────────────────────────────────

export const CHANNEL_TYPES = ['slack', 'discord', 'email', 'custom'];
export const DELIVERY_MODES = ['realtime', 'digest'];

// ─── In-memory digest buffer ────────────────────────────────────────────

const digestBuffers = new Map(); // slug → Map<channelId, event[]>

// ─── Channel CRUD ───────────────────────────────────────────────────────

/**
 * List all notification channels for a project.
 */
export function listChannels(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  return settings.notificationChannels || [];
}

/**
 * Get a single channel by ID.
 */
export function getChannel(slug, channelId) {
  const channels = listChannels(slug);
  return channels.find(c => c.id === channelId) || null;
}

/**
 * Add or update a notification channel.
 * @param {string} slug
 * @param {object} channel - { type, name, config, mode?, events?, enabled? }
 */
export function addChannel(slug, channel) {
  if (!CHANNEL_TYPES.includes(channel.type)) {
    throw new Error(`Invalid channel type: ${channel.type}. Valid: ${CHANNEL_TYPES.join(', ')}`);
  }
  if (channel.mode && !DELIVERY_MODES.includes(channel.mode)) {
    throw new Error(`Invalid delivery mode: ${channel.mode}. Valid: ${DELIVERY_MODES.join(', ')}`);
  }

  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const channels = settings.notificationChannels || [];

  const id = channel.id || `ch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const existing = channels.findIndex(c => c.id === id);

  const entry = {
    id,
    type: channel.type,
    name: channel.name || channel.type,
    config: channel.config || {},
    mode: channel.mode || 'realtime',
    events: channel.events || ['*'],        // which events to notify on
    enabled: channel.enabled !== false,
    createdAt: existing >= 0 ? channels[existing].createdAt : Date.now(),
    updatedAt: Date.now(),
  };

  if (existing >= 0) {
    channels[existing] = entry;
  } else {
    channels.push(entry);
  }

  refs.workspace?.updateProjectSettings?.(slug, { notificationChannels: channels });
  return entry;
}

/**
 * Update a channel by ID.
 */
export function updateChannel(slug, channelId, patch) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const channels = settings.notificationChannels || [];
  const idx = channels.findIndex(c => c.id === channelId);
  if (idx < 0) return null;

  if (patch.type && !CHANNEL_TYPES.includes(patch.type)) {
    throw new Error(`Invalid channel type: ${patch.type}`);
  }
  if (patch.mode && !DELIVERY_MODES.includes(patch.mode)) {
    throw new Error(`Invalid delivery mode: ${patch.mode}`);
  }

  channels[idx] = { ...channels[idx], ...patch, id: channelId, updatedAt: Date.now() };
  refs.workspace?.updateProjectSettings?.(slug, { notificationChannels: channels });
  return channels[idx];
}

/**
 * Remove a channel.
 */
export function removeChannel(slug, channelId) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const channels = settings.notificationChannels || [];
  const idx = channels.findIndex(c => c.id === channelId);
  if (idx < 0) return false;

  channels.splice(idx, 1);
  refs.workspace?.updateProjectSettings?.(slug, { notificationChannels: channels });

  // Clean up digest buffer
  const buf = digestBuffers.get(slug);
  if (buf) buf.delete(channelId);

  return true;
}

/**
 * Toggle a channel enabled/disabled.
 */
export function toggleChannel(slug, channelId) {
  const channel = getChannel(slug, channelId);
  if (!channel) return null;
  return updateChannel(slug, channelId, { enabled: !channel.enabled });
}

// ─── Sending ────────────────────────────────────────────────────────────

/**
 * Format a notification payload for a specific channel type.
 */
function formatPayload(channel, event) {
  const base = {
    text: `[hAIvemind] ${event.action}: ${event.detail || ''}`.trim(),
    timestamp: event.timestamp || new Date().toISOString(),
    project: event.project || '',
  };

  switch (channel.type) {
    case 'slack':
      return {
        text: base.text,
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: `*${event.action}*\n${event.detail || ''}` },
        }],
      };

    case 'discord':
      return {
        content: base.text,
        embeds: [{
          title: event.action,
          description: event.detail || '',
          timestamp: base.timestamp,
          color: event.level === 'error' ? 0xff0000 : 0x00ff00,
        }],
      };

    case 'email':
      return {
        to: channel.config?.to || channel.config?.email,
        subject: `[hAIvemind] ${event.action}`,
        body: event.detail || base.text,
      };

    case 'custom':
    default:
      return { ...base, event };
  }
}

/**
 * Send a notification to a channel (or buffer for digest).
 * In real production, this would use fetch() to hit webhook URLs.
 * For now, we record delivery attempts for testing.
 */
export function sendNotification(slug, event) {
  const channels = listChannels(slug);
  const results = [];

  for (const channel of channels) {
    if (!channel.enabled) continue;

    // Check event filter
    if (!channel.events.includes('*') && !channel.events.includes(event.action)) {
      continue;
    }

    const payload = formatPayload(channel, event);

    if (channel.mode === 'digest') {
      // Buffer for digest
      if (!digestBuffers.has(slug)) digestBuffers.set(slug, new Map());
      const buf = digestBuffers.get(slug);
      if (!buf.has(channel.id)) buf.set(channel.id, []);
      buf.get(channel.id).push({ event, payload, bufferedAt: Date.now() });
      results.push({ channelId: channel.id, status: 'buffered', type: channel.type });
    } else {
      // Real-time: record delivery (in prod, would POST to webhook URL)
      results.push({ channelId: channel.id, status: 'sent', type: channel.type, payload });
    }
  }

  return results;
}

/**
 * Get digest buffer contents for a project.
 */
export function getDigest(slug, channelId) {
  const buf = digestBuffers.get(slug);
  if (!buf) return [];
  if (channelId) return buf.get(channelId) || [];
  // All channels
  const all = [];
  for (const [cid, events] of buf) {
    all.push({ channelId: cid, events });
  }
  return all;
}

/**
 * Flush (send) digest buffer and clear it.
 * Returns the flushed events.
 */
export function flushDigest(slug, channelId) {
  const buf = digestBuffers.get(slug);
  if (!buf) return [];

  if (channelId) {
    const events = buf.get(channelId) || [];
    buf.delete(channelId);
    return events;
  }

  const all = [];
  for (const [cid, events] of buf) {
    all.push({ channelId: cid, events: [...events] });
  }
  buf.clear();
  return all;
}

/**
 * Test a channel by sending a test notification.
 */
export function testChannel(slug, channelId) {
  const channel = getChannel(slug, channelId);
  if (!channel) return null;

  const testEvent = {
    action: 'test',
    detail: `Test notification from hAIvemind to ${channel.name}`,
    project: slug,
    timestamp: new Date().toISOString(),
  };

  const payload = formatPayload(channel, testEvent);
  return { channelId: channel.id, type: channel.type, payload, status: 'test-sent' };
}

// ─── Reset (test helper) ────────────────────────────────────────────────

export function _reset() {
  digestBuffers.clear();
}
