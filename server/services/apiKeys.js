/**
 * API Key Management — Phase 9.4
 *
 * Secure storage for per-backend API keys with masking and rotation support.
 * Keys are stored per-project via WorkspaceManager settings.
 */

import { refs } from '../state.js';
import { createHash, randomBytes } from 'crypto';

/**
 * @typedef {Object} ApiKeyEntry
 * @property {string} id
 * @property {string} backend — backend name (e.g. 'ollama', 'openai', 'anthropic')
 * @property {string} label — user-friendly label
 * @property {string} keyHash — SHA-256 hash of the key (for display/verification)
 * @property {string} maskedKey — e.g. "sk-...abcd"
 * @property {number} createdAt
 * @property {number} [rotatedAt]
 * @property {boolean} active
 */

/**
 * Get all API key entries for a project (without plaintext keys).
 * @param {string} slug
 * @returns {ApiKeyEntry[]}
 */
export function getApiKeys(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug);
  return settings?.apiKeys ?? [];
}

/**
 * Add an API key for a backend.
 * Stores a hashed + masked version — plaintext is not persisted.
 * @param {string} slug
 * @param {{ backend: string, label: string, key: string }} data
 * @returns {ApiKeyEntry}
 */
export function addApiKey(slug, data) {
  const keys = getApiKeys(slug);
  const entry = {
    id: `key-${Date.now()}-${randomBytes(4).toString('hex')}`,
    backend: data.backend,
    label: data.label || data.backend,
    keyHash: hashKey(data.key),
    maskedKey: maskKey(data.key),
    createdAt: Date.now(),
    rotatedAt: null,
    active: true,
  };
  keys.push(entry);
  saveApiKeys(slug, keys);

  // Also store the actual key in a separate secure map (in-memory only for runtime use)
  storeRuntimeKey(slug, entry.id, data.key);

  return entry;
}

/**
 * Remove an API key.
 * @param {string} slug
 * @param {string} keyId
 * @returns {boolean}
 */
export function removeApiKey(slug, keyId) {
  const keys = getApiKeys(slug);
  const idx = keys.findIndex(k => k.id === keyId);
  if (idx === -1) return false;
  keys.splice(idx, 1);
  saveApiKeys(slug, keys);
  runtimeKeys.get(slug)?.delete(keyId);
  return true;
}

/**
 * Rotate an API key — replace with new key.
 * @param {string} slug
 * @param {string} keyId
 * @param {string} newKey
 * @returns {ApiKeyEntry|null}
 */
export function rotateApiKey(slug, keyId, newKey) {
  const keys = getApiKeys(slug);
  const entry = keys.find(k => k.id === keyId);
  if (!entry) return null;
  entry.keyHash = hashKey(newKey);
  entry.maskedKey = maskKey(newKey);
  entry.rotatedAt = Date.now();
  saveApiKeys(slug, keys);
  storeRuntimeKey(slug, keyId, newKey);
  return entry;
}

/**
 * Toggle an API key active/inactive.
 * @param {string} slug
 * @param {string} keyId
 * @returns {boolean}
 */
export function toggleApiKey(slug, keyId) {
  const keys = getApiKeys(slug);
  const entry = keys.find(k => k.id === keyId);
  if (!entry) return false;
  entry.active = !entry.active;
  saveApiKeys(slug, keys);
  return true;
}

/**
 * Get the runtime (plaintext) key for a backend.
 * @param {string} slug
 * @param {string} backend
 * @returns {string|null}
 */
export function getRuntimeKey(slug, backend) {
  const keys = getApiKeys(slug);
  const activeKey = keys.find(k => k.backend === backend && k.active);
  if (!activeKey) return null;
  return runtimeKeys.get(slug)?.get(activeKey.id) ?? null;
}

// ────── Internal helpers ──────

/** @type {Map<string, Map<string, string>>} slug → keyId → plaintext */
const runtimeKeys = new Map();

function storeRuntimeKey(slug, keyId, key) {
  if (!runtimeKeys.has(slug)) runtimeKeys.set(slug, new Map());
  runtimeKeys.get(slug).set(keyId, key);
}

function hashKey(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function maskKey(key) {
  if (!key || key.length < 8) return '****';
  return key.slice(0, 4) + '…' + key.slice(-4);
}

function saveApiKeys(slug, keys) {
  refs.workspace?.updateProjectSettings?.(slug, { apiKeys: keys });
}

/**
 * Cleanup runtime keys for a project.
 * @param {string} slug
 */
export function cleanupApiKeys(slug) {
  runtimeKeys.delete(slug);
}
