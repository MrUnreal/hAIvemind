/**
 * Agent Profiles Service — Phase 12.7
 *
 * Named agent configurations, profile switching, per-task assignment,
 * profile templates, capability tagging.
 */

import { refs } from '../state.js';

// ─── Constants ──────────────────────────────────────────────────────────

export const PROFILE_ROLES = ['generalist', 'coder', 'reviewer', 'architect', 'tester', 'ops', 'custom'];
export const MODEL_TIERS = ['T0', 'T1', 'T2', 'T3'];

// ─── Helpers ────────────────────────────────────────────────────────────

function _genId(prefix = 'prof') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function _getProfiles(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  return settings.agentProfiles || [];
}

function _saveProfiles(slug, profiles) {
  if (profiles.length > 100) profiles.splice(0, profiles.length - 100);
  refs.workspace?.updateProjectSettings?.(slug, { agentProfiles: profiles });
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Create a new agent profile.
 */
export function createProfile(slug, data = {}) {
  if (!data.name) throw new Error('name is required');
  if (data.role && !PROFILE_ROLES.includes(data.role)) {
    throw new Error(`Invalid role: ${data.role}. Must be one of: ${PROFILE_ROLES.join(', ')}`);
  }
  if (data.modelTier && !MODEL_TIERS.includes(data.modelTier)) {
    throw new Error(`Invalid modelTier: ${data.modelTier}. Must be one of: ${MODEL_TIERS.join(', ')}`);
  }

  const profiles = _getProfiles(slug);
  if (profiles.some(p => p.name === data.name)) {
    throw new Error(`Profile with name "${data.name}" already exists`);
  }

  const profile = {
    id: _genId(),
    name: data.name,
    role: data.role || 'generalist',
    modelTier: data.modelTier || 'T0',
    systemPrompt: data.systemPrompt || '',
    capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
    maxTokens: data.maxTokens || 4096,
    temperature: typeof data.temperature === 'number' ? data.temperature : 0.7,
    isDefault: !!data.isDefault,
    tags: Array.isArray(data.tags) ? data.tags : [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // If setting as default, unset other defaults for same role
  if (profile.isDefault) {
    for (const p of profiles) {
      if (p.role === profile.role) p.isDefault = false;
    }
  }

  profiles.push(profile);
  _saveProfiles(slug, profiles);
  return profile;
}

/**
 * List all profiles, optionally filtered.
 */
export function listProfiles(slug, filters = {}) {
  let profiles = _getProfiles(slug);
  if (filters.role) profiles = profiles.filter(p => p.role === filters.role);
  if (filters.modelTier) profiles = profiles.filter(p => p.modelTier === filters.modelTier);
  if (filters.tag) profiles = profiles.filter(p => p.tags.includes(filters.tag));
  return profiles;
}

/**
 * Get a single profile by ID.
 */
export function getProfile(slug, profileId) {
  return _getProfiles(slug).find(p => p.id === profileId) || null;
}

/**
 * Update a profile.
 */
export function updateProfile(slug, profileId, patch = {}) {
  const profiles = _getProfiles(slug);
  const prof = profiles.find(p => p.id === profileId);
  if (!prof) return null;

  if (patch.name !== undefined) prof.name = patch.name;
  if (patch.role && PROFILE_ROLES.includes(patch.role)) prof.role = patch.role;
  if (patch.modelTier && MODEL_TIERS.includes(patch.modelTier)) prof.modelTier = patch.modelTier;
  if (patch.systemPrompt !== undefined) prof.systemPrompt = patch.systemPrompt;
  if (Array.isArray(patch.capabilities)) prof.capabilities = patch.capabilities;
  if (patch.maxTokens !== undefined) prof.maxTokens = patch.maxTokens;
  if (typeof patch.temperature === 'number') prof.temperature = patch.temperature;
  if (Array.isArray(patch.tags)) prof.tags = patch.tags;

  if (patch.isDefault !== undefined) {
    prof.isDefault = !!patch.isDefault;
    if (prof.isDefault) {
      for (const p of profiles) {
        if (p.id !== prof.id && p.role === prof.role) p.isDefault = false;
      }
    }
  }

  prof.updatedAt = Date.now();
  _saveProfiles(slug, profiles);
  return prof;
}

/**
 * Delete a profile.
 */
export function deleteProfile(slug, profileId) {
  const profiles = _getProfiles(slug);
  const idx = profiles.findIndex(p => p.id === profileId);
  if (idx === -1) return null;
  const removed = profiles.splice(idx, 1)[0];
  _saveProfiles(slug, profiles);
  return removed;
}

/**
 * Clone a profile with a new name.
 */
export function cloneProfile(slug, profileId, newName) {
  const source = getProfile(slug, profileId);
  if (!source) return null;

  return createProfile(slug, {
    ...source,
    name: newName || `${source.name} (copy)`,
    isDefault: false,
  });
}

/**
 * Get the default profile for a role.
 */
export function getDefaultProfile(slug, role) {
  const profiles = _getProfiles(slug);
  return profiles.find(p => p.role === role && p.isDefault) || null;
}

/**
 * Get profile stats.
 */
export function getProfileStats(slug) {
  const profiles = _getProfiles(slug);
  const byRole = {};
  const byTier = {};
  for (const p of profiles) {
    byRole[p.role] = (byRole[p.role] || 0) + 1;
    byTier[p.modelTier] = (byTier[p.modelTier] || 0) + 1;
  }
  return {
    total: profiles.length,
    byRole,
    byTier,
    defaults: profiles.filter(p => p.isDefault).map(p => ({ id: p.id, name: p.name, role: p.role })),
  };
}
