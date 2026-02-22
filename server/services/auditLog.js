/**
 * Audit Log — Phase 9.6
 *
 * Immutable append-only log of state changes per project.
 * Entries are stored in project settings and capped at MAX_ENTRIES.
 */

import { refs } from '../state.js';
import { randomBytes } from 'crypto';

/**
 * @typedef {Object} AuditEntry
 * @property {string} id
 * @property {string} action — what happened (e.g. 'session.start', 'settings.update', 'key.add')
 * @property {string} actor — who did it ('user', 'system', 'autopilot', agent id)
 * @property {Object} [details] — arbitrary context (old/new values, etc.)
 * @property {number} timestamp
 */

const MAX_ENTRIES = 500;

/** Action categories for filtering. */
const ACTIONS = [
  'session.start', 'session.complete', 'session.fail',
  'settings.update', 'project.create', 'project.delete',
  'key.add', 'key.remove', 'key.rotate',
  'template.create', 'template.delete', 'template.use',
  'webhook.create', 'webhook.delete', 'webhook.toggle',
  'schedule.create', 'schedule.delete',
  'autopilot.start', 'autopilot.stop',
  'plugin.install', 'plugin.remove',
  'custom',
];

/**
 * Get all audit entries for a project, newest first.
 * @param {string} slug
 * @param {{ action?: string, actor?: string, limit?: number, offset?: number }} [opts]
 * @returns {{ entries: AuditEntry[], total: number }}
 */
export function getAuditLog(slug, opts = {}) {
  const all = loadEntries(slug);
  let filtered = all;
  if (opts.action) filtered = filtered.filter(e => e.action === opts.action);
  if (opts.actor) filtered = filtered.filter(e => e.actor === opts.actor);
  const total = filtered.length;
  const offset = opts.offset || 0;
  const limit = opts.limit || 50;
  return { entries: filtered.slice(offset, offset + limit), total };
}

/**
 * Append an audit entry. Immutable — entries cannot be modified or deleted individually.
 * @param {string} slug
 * @param {{ action: string, actor?: string, details?: Object }} data
 * @returns {AuditEntry}
 */
export function appendAuditEntry(slug, data) {
  const entries = loadEntries(slug);
  const entry = {
    id: `aud-${Date.now()}-${randomBytes(4).toString('hex')}`,
    action: data.action || 'custom',
    actor: data.actor || 'system',
    details: data.details || {},
    timestamp: Date.now(),
  };
  // Prepend (newest first)
  entries.unshift(entry);
  // Cap length
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  saveEntries(slug, entries);
  return entry;
}

/**
 * Get unique actors from log.
 * @param {string} slug
 * @returns {string[]}
 */
export function getActors(slug) {
  const entries = loadEntries(slug);
  return [...new Set(entries.map(e => e.actor))];
}

/**
 * Clear all audit entries. Use with caution — intended for tests/admin.
 * @param {string} slug
 * @returns {number} count cleared
 */
export function clearAuditLog(slug) {
  const entries = loadEntries(slug);
  const count = entries.length;
  saveEntries(slug, []);
  return count;
}

/** Exported for reference. */
export { ACTIONS, MAX_ENTRIES };

// ────── Internal ──────

function loadEntries(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug);
  return settings?.auditLog ?? [];
}

function saveEntries(slug, entries) {
  refs.workspace?.updateProjectSettings?.(slug, { auditLog: entries });
}
