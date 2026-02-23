/**
 * server/services/globalSearch.js — Global Search & Filter
 *
 * Cross-resource search across sessions, memory, diffs, audit logs,
 * activity, and more. Supports:
 *   - Full-text substring matching (case-insensitive)
 *   - Resource type filtering
 *   - Date range filtering
 *   - Saved searches per project
 *   - Pagination
 */

import { refs } from '../state.js';

// ─── Helpers ────────────────────────────────────────────────────────────

/** Normalize a timestamp value (epoch ms, ISO string, or falsy) to epoch ms */
function _toEpoch(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  return 0;
}

// ─── Searchable Resource Types ──────────────────────────────────────────

export const SEARCH_TYPES = [
  'session',
  'memory',
  'diff',
  'audit',
  'activity',
  'collaborator',
  'webhook',
  'channel',
];

// ─── Search ─────────────────────────────────────────────────────────────

/**
 * Search across all data types for a project.
 *
 * @param {string} slug
 * @param {object} opts
 * @param {string} opts.q - Search query (substring match)
 * @param {string[]} [opts.types] - Filter by resource type(s)
 * @param {number} [opts.since] - Only results after this timestamp
 * @param {number} [opts.until] - Only results before this timestamp
 * @param {number} [opts.limit=50] - Max results per type
 * @param {number} [opts.offset=0] - Pagination offset
 * @returns {{ results: Array, totalCount: number, types: object }}
 */
export function search(slug, opts = {}) {
  const ws = refs.workspace;
  if (!ws) return { results: [], totalCount: 0, types: {} };

  const q = (opts.q || '').toLowerCase();
  const types = opts.types || SEARCH_TYPES;
  const since = opts.since || 0;
  const until = opts.until || Infinity;
  const limit = opts.limit || 50;
  const offset = opts.offset || 0;

  let allResults = [];
  const typeCounts = {};

  // Search sessions
  if (types.includes('session')) {
    const sessions = ws.listSessions(slug);
    const hits = [];
    for (const s of sessions) {
      const ts = _toEpoch(s.createdAt);
      if (ts < since || ts > until) continue;
      const searchable = [
        s.id, s.prompt, s.status,
        ...(s.tasks || []).map(t => `${t.label || ''} ${t.id || ''}`),
      ].join(' ').toLowerCase();
      if (!q || searchable.includes(q)) {
        hits.push({
          type: 'session',
          id: s.id,
          title: s.prompt?.slice(0, 100) || s.id,
          status: s.status,
          timestamp: ts,
          match: _highlightMatch(s.prompt || s.id, q),
        });
      }
    }
    typeCounts.session = hits.length;
    allResults.push(...hits);
  }

  // Search memory
  if (types.includes('memory')) {
    const settings = ws.getProjectSettings(slug);
    const memories = settings.agentMemory || [];
    const hits = [];
    for (const m of memories) {
      const ts = _toEpoch(m.createdAt);
      if (ts < since || ts > until) continue;
      const searchable = [m.key, m.content, m.type, ...(m.tags || [])].join(' ').toLowerCase();
      if (!q || searchable.includes(q)) {
        hits.push({
          type: 'memory',
          id: m.id,
          title: m.key || m.content?.slice(0, 80) || m.id,
          memoryType: m.type,
          timestamp: ts,
          match: _highlightMatch(m.content || m.key || '', q),
        });
      }
    }
    typeCounts.memory = hits.length;
    allResults.push(...hits);
  }

  // Search diffs
  if (types.includes('diff')) {
    const settings = ws.getProjectSettings(slug);
    const diffs = settings.diffs || [];
    const hits = [];
    for (const d of diffs) {
      const ts = _toEpoch(d.createdAt);
      if (ts < since || ts > until) continue;
      const searchable = [d.file, d.description, d.status, d.id].join(' ').toLowerCase();
      if (!q || searchable.includes(q)) {
        hits.push({
          type: 'diff',
          id: d.id,
          title: d.file || d.description || d.id,
          status: d.status,
          timestamp: ts,
          match: _highlightMatch(d.description || d.file || '', q),
        });
      }
    }
    typeCounts.diff = hits.length;
    allResults.push(...hits);
  }

  // Search audit log
  if (types.includes('audit')) {
    const settings = ws.getProjectSettings(slug);
    const audit = settings.auditLog || [];
    const hits = [];
    for (const a of audit) {
      const ts = a.timestamp || 0;
      if (ts < since || ts > until) continue;
      const searchable = [a.action, a.actor, a.detail, a.id].join(' ').toLowerCase();
      if (!q || searchable.includes(q)) {
        hits.push({
          type: 'audit',
          id: a.id,
          title: `${a.action} by ${a.actor || 'system'}`,
          action: a.action,
          timestamp: ts,
          match: _highlightMatch(a.detail || a.action || '', q),
        });
      }
    }
    typeCounts.audit = hits.length;
    allResults.push(...hits);
  }

  // Search activity feed
  if (types.includes('activity')) {
    const settings = ws.getProjectSettings(slug);
    const activity = settings.activityFeed || [];
    const hits = [];
    for (const a of activity) {
      const ts = _toEpoch(a.timestamp);
      if (ts < since || ts > until) continue;
      const searchable = [a.userId, a.action, a.detail, a.id].join(' ').toLowerCase();
      if (!q || searchable.includes(q)) {
        hits.push({
          type: 'activity',
          id: a.id,
          title: `${a.action}: ${a.detail || ''}`.trim(),
          userId: a.userId,
          timestamp: ts,
          match: _highlightMatch(a.detail || a.action || '', q),
        });
      }
    }
    typeCounts.activity = hits.length;
    allResults.push(...hits);
  }

  // Search collaborators
  if (types.includes('collaborator')) {
    const settings = ws.getProjectSettings(slug);
    const collabs = settings.collaborators || [];
    const hits = [];
    for (const c of collabs) {
      const searchable = [c.userId, c.name, c.role].join(' ').toLowerCase();
      if (!q || searchable.includes(q)) {
        hits.push({
          type: 'collaborator',
          id: c.userId,
          title: c.name || c.userId,
          role: c.role,
          timestamp: _toEpoch(c.addedAt),
          match: _highlightMatch(c.name || c.userId, q),
        });
      }
    }
    typeCounts.collaborator = hits.length;
    allResults.push(...hits);
  }

  // Search webhooks
  if (types.includes('webhook')) {
    const settings = ws.getProjectSettings(slug);
    const webhooks = settings.webhooks || [];
    const hits = [];
    for (const w of webhooks) {
      const searchable = [w.url, w.events?.join(' '), w.id].join(' ').toLowerCase();
      if (!q || searchable.includes(q)) {
        hits.push({
          type: 'webhook',
          id: w.id,
          title: w.url || w.id,
          enabled: w.enabled,
          timestamp: w.createdAt || 0,
          match: _highlightMatch(w.url || '', q),
        });
      }
    }
    typeCounts.webhook = hits.length;
    allResults.push(...hits);
  }

  // Search notification channels
  if (types.includes('channel')) {
    const settings = ws.getProjectSettings(slug);
    const channels = settings.notificationChannels || [];
    const hits = [];
    for (const ch of channels) {
      const searchable = [ch.name, ch.type, ch.id].join(' ').toLowerCase();
      if (!q || searchable.includes(q)) {
        hits.push({
          type: 'channel',
          id: ch.id,
          title: ch.name || ch.type,
          channelType: ch.type,
          timestamp: ch.createdAt || 0,
          match: _highlightMatch(ch.name || ch.type || '', q),
        });
      }
    }
    typeCounts.channel = hits.length;
    allResults.push(...hits);
  }

  // Sort by timestamp descending
  allResults.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const totalCount = allResults.length;
  allResults = allResults.slice(offset, offset + limit);

  return { results: allResults, totalCount, types: typeCounts };
}

function _highlightMatch(text, query) {
  if (!query || !text) return text;
  const idx = text.toLowerCase().indexOf(query);
  if (idx < 0) return text.slice(0, 100);
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + query.length + 20);
  return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
}

// ─── Saved Searches ─────────────────────────────────────────────────────

/**
 * List saved searches for a project.
 */
export function listSavedSearches(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  return settings.savedSearches || [];
}

/**
 * Save a search query.
 */
export function saveSearch(slug, searchDef) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const saved = settings.savedSearches || [];

  const entry = {
    id: `ss-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: searchDef.name || searchDef.q,
    q: searchDef.q || '',
    types: searchDef.types || null,
    createdAt: Date.now(),
  };

  saved.push(entry);
  refs.workspace?.updateProjectSettings?.(slug, { savedSearches: saved });
  return entry;
}

/**
 * Delete a saved search.
 */
export function deleteSavedSearch(slug, searchId) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const saved = settings.savedSearches || [];
  const idx = saved.findIndex(s => s.id === searchId);
  if (idx < 0) return false;

  saved.splice(idx, 1);
  refs.workspace?.updateProjectSettings?.(slug, { savedSearches: saved });
  return true;
}

// ─── Reset (test helper) ────────────────────────────────────────────────

export function _reset() {
  // Stateless service — nothing to reset
}
