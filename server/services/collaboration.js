/**
 * Collaboration Service — Phase 11.3
 *
 * Multi-user project sharing with role-based access control (RBAC),
 * activity feed, and presence tracking.
 *
 * Roles: viewer (read-only), editor (read+write), admin (full control)
 * Activity: timestamped log of user actions within a project
 * Presence: which users are currently online viewing a project
 */

import { refs } from '../state.js';

/** Valid roles in ascending privilege order */
const ROLES = ['viewer', 'editor', 'admin'];

/** Max activity entries per project */
const MAX_ACTIVITY = 500;

/** In-memory presence tracking */
const presence = new Map(); // slug -> Map<userId, { joinedAt, lastSeen }>

// ═══════════════════════════════════════════════════════════
//  Collaborators (RBAC)
// ═══════════════════════════════════════════════════════════

/**
 * List collaborators for a project.
 * @param {string} slug
 * @returns {object[]}
 */
export function listCollaborators(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  return settings.collaborators || [];
}

/**
 * Add or update a collaborator.
 * @param {string} slug
 * @param {{ userId: string, name?: string, role?: string }} collab
 * @returns {object} The collaborator entry
 */
export function addCollaborator(slug, collab) {
  if (!collab.userId) throw new Error('userId is required');
  const role = collab.role || 'viewer';
  if (!ROLES.includes(role)) throw new Error(`Invalid role. Must be one of: ${ROLES.join(', ')}`);

  const collabs = listCollaborators(slug);
  const existing = collabs.find(c => c.userId === collab.userId);
  if (existing) {
    existing.role = role;
    if (collab.name) existing.name = collab.name;
    existing.updatedAt = Date.now();
  } else {
    collabs.push({
      userId: collab.userId,
      name: collab.name || collab.userId,
      role,
      addedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  refs.workspace?.updateProjectSettings?.(slug, { collaborators: collabs });
  return existing || collabs[collabs.length - 1];
}

/**
 * Remove a collaborator from a project.
 * @param {string} slug
 * @param {string} userId
 * @returns {boolean}
 */
export function removeCollaborator(slug, userId) {
  const collabs = listCollaborators(slug);
  const idx = collabs.findIndex(c => c.userId === userId);
  if (idx === -1) return false;
  collabs.splice(idx, 1);
  refs.workspace?.updateProjectSettings?.(slug, { collaborators: collabs });
  return true;
}

/**
 * Get a collaborator's role for a project.
 * @param {string} slug
 * @param {string} userId
 * @returns {string|null} Role or null if not a collaborator
 */
export function getRole(slug, userId) {
  const collabs = listCollaborators(slug);
  const collab = collabs.find(c => c.userId === userId);
  return collab?.role || null;
}

/**
 * Check if a user has at least a given access level.
 * @param {string} slug
 * @param {string} userId
 * @param {string} requiredRole
 * @returns {boolean}
 */
export function hasAccess(slug, userId, requiredRole) {
  const role = getRole(slug, userId);
  if (!role) return false;
  return ROLES.indexOf(role) >= ROLES.indexOf(requiredRole);
}

// ═══════════════════════════════════════════════════════════
//  Activity Feed
// ═══════════════════════════════════════════════════════════

/**
 * Get the activity feed for a project.
 * @param {string} slug
 * @param {{ limit?: number, userId?: string, action?: string }} opts
 * @returns {object[]}
 */
export function getActivity(slug, opts = {}) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  let activity = settings.activityFeed || [];
  if (opts.userId) activity = activity.filter(a => a.userId === opts.userId);
  if (opts.action) activity = activity.filter(a => a.action === opts.action);
  const limit = opts.limit || 50;
  return activity.slice(-limit);
}

/**
 * Record an activity entry.
 * @param {string} slug
 * @param {{ userId: string, action: string, detail?: string, metadata?: object }} entry
 * @returns {object}
 */
export function recordActivity(slug, entry) {
  if (!entry.userId || !entry.action) throw new Error('userId and action are required');

  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const activity = settings.activityFeed || [];

  const record = {
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    userId: entry.userId,
    action: entry.action,
    detail: entry.detail || '',
    metadata: entry.metadata || null,
    timestamp: Date.now(),
  };

  activity.push(record);

  // Cap activity
  if (activity.length > MAX_ACTIVITY) {
    activity.splice(0, activity.length - MAX_ACTIVITY);
  }

  refs.workspace?.updateProjectSettings?.(slug, { activityFeed: activity });
  return record;
}

/**
 * Clear the activity feed for a project.
 * @param {string} slug
 */
export function clearActivity(slug) {
  refs.workspace?.updateProjectSettings?.(slug, { activityFeed: [] });
}

// ═══════════════════════════════════════════════════════════
//  Presence
// ═══════════════════════════════════════════════════════════

/**
 * Mark a user as present in a project.
 * @param {string} slug
 * @param {string} userId
 * @returns {object}
 */
export function joinPresence(slug, userId) {
  if (!presence.has(slug)) presence.set(slug, new Map());
  const projectPresence = presence.get(slug);

  const entry = {
    userId,
    joinedAt: projectPresence.get(userId)?.joinedAt || Date.now(),
    lastSeen: Date.now(),
  };
  projectPresence.set(userId, entry);
  return entry;
}

/**
 * Remove a user from presence.
 * @param {string} slug
 * @param {string} userId
 * @returns {boolean}
 */
export function leavePresence(slug, userId) {
  if (!presence.has(slug)) return false;
  return presence.get(slug).delete(userId);
}

/**
 * Get currently present users for a project.
 * Prunes stale entries (>5 minutes without heartbeat).
 * @param {string} slug
 * @returns {object[]}
 */
export function getPresence(slug) {
  if (!presence.has(slug)) return [];
  const projectPresence = presence.get(slug);
  const staleThreshold = Date.now() - 5 * 60 * 1000; // 5 minutes

  // Prune stale
  for (const [uid, entry] of projectPresence) {
    if (entry.lastSeen < staleThreshold) {
      projectPresence.delete(uid);
    }
  }

  return Array.from(projectPresence.values());
}

/**
 * Heartbeat — update lastSeen for a user.
 * @param {string} slug
 * @param {string} userId
 * @returns {boolean}
 */
export function heartbeat(slug, userId) {
  if (!presence.has(slug)) return false;
  const entry = presence.get(slug).get(userId);
  if (!entry) return false;
  entry.lastSeen = Date.now();
  return true;
}

// ═══════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════

/**
 * Get valid roles.
 * @returns {string[]}
 */
export function getRoles() {
  return [...ROLES];
}

/**
 * Clear all presence data for a project (e.g., on deletion).
 * @param {string} slug
 */
export function clearPresence(slug) {
  presence.delete(slug);
}

/**
 * Reset all in-memory state (for tests).
 */
export function _reset() {
  presence.clear();
}
