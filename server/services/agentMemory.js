/**
 * server/services/agentMemory.js — Persistent Agent Memory
 *
 * Stores learned patterns, project conventions, error history,
 * and preference recall across sessions. Enables agents to
 * improve over time per project.
 */

import { randomBytes } from 'crypto';
import { refs } from '../state.js';

// ─── Memory Categories ───────────────────────────────────────────────
export const MEMORY_TYPES = [
  'pattern',      // Learned code patterns & conventions
  'error',        // Error history with resolutions
  'preference',   // User preferences & style choices
  'convention',   // Project conventions (naming, structure, etc.)
  'context',      // Persistent context from prior sessions
  'note',         // Free-form notes
];

// ─── CRUD Operations ─────────────────────────────────────────────────

/**
 * Get all memories for a project, optionally filtered by type.
 * @param {string} slug
 * @param {object} opts - { type?, search?, limit?, offset? }
 * @returns {{ entries: Array, total: number }}
 */
export function getMemories(slug, opts = {}) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  let entries = settings.agentMemory || [];

  if (opts.type) entries = entries.filter(e => e.type === opts.type);
  if (opts.search) {
    const q = opts.search.toLowerCase();
    entries = entries.filter(e =>
      (e.content || '').toLowerCase().includes(q) ||
      (e.key || '').toLowerCase().includes(q) ||
      (e.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }

  const total = entries.length;
  const offset = opts.offset || 0;
  const limit = opts.limit || 100;
  entries = entries.slice(offset, offset + limit);

  return { entries, total };
}

/**
 * Get a single memory entry by ID.
 */
export function getMemory(slug, memoryId) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const entries = settings.agentMemory || [];
  return entries.find(e => e.id === memoryId) || null;
}

/**
 * Add a memory entry.
 * @param {string} slug
 * @param {object} data - { type, key, content, tags?, metadata?, source? }
 * @returns {object} created entry
 */
export function addMemory(slug, data) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const entries = settings.agentMemory || [];

  const type = MEMORY_TYPES.includes(data.type) ? data.type : 'note';
  const entry = {
    id: `mem-${Date.now()}-${randomBytes(4).toString('hex')}`,
    type,
    key: data.key || '',
    content: data.content || '',
    tags: Array.isArray(data.tags) ? data.tags : [],
    metadata: data.metadata || {},
    source: data.source || 'agent',
    accessCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  entries.unshift(entry);

  // Cap at 500 entries
  if (entries.length > 500) entries.length = 500;

  refs.workspace?.updateProjectSettings?.(slug, { agentMemory: entries });
  return entry;
}

/**
 * Update a memory entry.
 */
export function updateMemory(slug, memoryId, patch) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const entries = settings.agentMemory || [];
  const entry = entries.find(e => e.id === memoryId);
  if (!entry) return null;

  if (patch.content !== undefined) entry.content = patch.content;
  if (patch.key !== undefined) entry.key = patch.key;
  if (patch.tags !== undefined) entry.tags = patch.tags;
  if (patch.metadata !== undefined) entry.metadata = { ...entry.metadata, ...patch.metadata };
  entry.updatedAt = new Date().toISOString();

  refs.workspace?.updateProjectSettings?.(slug, { agentMemory: entries });
  return entry;
}

/**
 * Remove a memory entry.
 */
export function removeMemory(slug, memoryId) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const entries = settings.agentMemory || [];
  const idx = entries.findIndex(e => e.id === memoryId);
  if (idx === -1) return false;

  entries.splice(idx, 1);
  refs.workspace?.updateProjectSettings?.(slug, { agentMemory: entries });
  return true;
}

/**
 * Record an access to a memory entry (for recall scoring).
 */
export function touchMemory(slug, memoryId) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const entries = settings.agentMemory || [];
  const entry = entries.find(e => e.id === memoryId);
  if (!entry) return null;

  entry.accessCount = (entry.accessCount || 0) + 1;
  entry.lastAccessedAt = new Date().toISOString();

  refs.workspace?.updateProjectSettings?.(slug, { agentMemory: entries });
  return entry;
}

// ─── Search & Recall ─────────────────────────────────────────────────

/**
 * Recall relevant memories for a given query/context.
 * Returns memories ranked by relevance (keyword match + recency + access count).
 * @param {string} slug
 * @param {string} query
 * @param {number} limit
 * @returns {Array}
 */
export function recallMemories(slug, query, limit = 10) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const entries = settings.agentMemory || [];
  if (!query || !entries.length) return [];

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  const scored = entries.map(entry => {
    let score = 0;
    const text = `${entry.key} ${entry.content} ${(entry.tags || []).join(' ')}`.toLowerCase();

    // Term matching
    for (const term of terms) {
      if (text.includes(term)) score += 10;
      if ((entry.key || '').toLowerCase().includes(term)) score += 5;
    }

    // Recency boost (newer = higher score)
    const age = Date.now() - new Date(entry.updatedAt).getTime();
    const daysSince = age / 86400000;
    score += Math.max(0, 5 - Math.floor(daysSince)); // up to 5 points for last 5 days

    // Access count boost
    score += Math.min(entry.accessCount || 0, 5);

    return { ...entry, _score: score };
  });

  return scored
    .filter(e => e._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...entry }) => entry);
}

/**
 * Get all unique tags used across memories.
 */
export function getTags(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const entries = settings.agentMemory || [];
  const tags = new Set();
  for (const e of entries) {
    for (const t of e.tags || []) tags.add(t);
  }
  return [...tags].sort();
}

/**
 * Clear all memories for a project.
 */
export function clearMemories(slug) {
  refs.workspace?.updateProjectSettings?.(slug, { agentMemory: [] });
  return true;
}

/**
 * Get memory stats for a project.
 */
export function getMemoryStats(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const entries = settings.agentMemory || [];

  const typeCounts = {};
  for (const e of entries) {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  }

  return {
    total: entries.length,
    byType: typeCounts,
    totalTags: getTags(slug).length,
    totalAccesses: entries.reduce((sum, e) => sum + (e.accessCount || 0), 0),
  };
}
