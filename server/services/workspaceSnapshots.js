/**
 * server/services/workspaceSnapshots.js — Workspace Snapshots
 *
 * Full workspace backup/restore system. Captures project settings,
 * session metadata, and workspace state as named checkpoints.
 * Supports diff between snapshots, restore, and auto-snapshots
 * before risky operations.
 */

import { randomBytes } from 'crypto';
import { refs } from '../state.js';

// ─── Snapshot Management ────────────────────────────────────────────

const MAX_SNAPSHOTS = 50;

/**
 * Create a snapshot of the workspace or project.
 * @param {string} slug - project slug
 * @param {object} opts - { name?, description?, auto? }
 * @returns {object} created snapshot
 */
export function createSnapshot(slug, opts = {}) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const snapshots = settings.workspaceSnapshots || [];

  const snapshot = {
    id: `snap-${Date.now()}-${randomBytes(4).toString('hex')}`,
    name: opts.name || `Snapshot ${snapshots.length + 1}`,
    description: opts.description || '',
    auto: !!opts.auto,
    createdAt: new Date().toISOString(),
    data: captureState(slug),
  };

  snapshots.unshift(snapshot);
  if (snapshots.length > MAX_SNAPSHOTS) snapshots.length = MAX_SNAPSHOTS;

  refs.workspace?.updateProjectSettings?.(slug, { workspaceSnapshots: snapshots });
  return { id: snapshot.id, name: snapshot.name, description: snapshot.description, auto: snapshot.auto, createdAt: snapshot.createdAt };
}

/**
 * Capture current state for a project.
 */
function captureState(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  // Capture relevant settings (excluding snapshots themselves to avoid recursion)
  const { workspaceSnapshots, ...rest } = settings;
  return {
    settings: rest,
    capturedAt: new Date().toISOString(),
    settingsKeys: Object.keys(rest),
  };
}

/**
 * List all snapshots for a project.
 * @param {string} slug
 * @param {object} opts - { limit?, auto? }
 * @returns {{ snapshots: Array, total: number }}
 */
export function listSnapshots(slug, opts = {}) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  let snaps = (settings.workspaceSnapshots || []).map(s => ({
    id: s.id, name: s.name, description: s.description,
    auto: s.auto, createdAt: s.createdAt,
  }));

  if (opts.auto !== undefined) {
    snaps = snaps.filter(s => s.auto === opts.auto);
  }

  const limit = opts.limit || 50;
  return { snapshots: snaps.slice(0, limit), total: snaps.length };
}

/**
 * Get a single snapshot (with data).
 */
export function getSnapshot(slug, snapshotId) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const snaps = settings.workspaceSnapshots || [];
  return snaps.find(s => s.id === snapshotId) || null;
}

/**
 * Restore a snapshot — replaces project settings with snapshot data.
 * Auto-creates a pre-restore backup.
 * @param {string} slug
 * @param {string} snapshotId
 * @returns {{ restored: boolean, backupId: string }}
 */
export function restoreSnapshot(slug, snapshotId) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const snaps = settings.workspaceSnapshots || [];
  const snap = snaps.find(s => s.id === snapshotId);
  if (!snap) return null;

  // Create backup before restore
  const backup = createSnapshot(slug, {
    name: `Pre-restore backup (${snap.name})`,
    description: `Auto-backup before restoring snapshot ${snap.id}`,
    auto: true,
  });

  // Restore settings from snapshot data
  const restoredSettings = snap.data?.settings || {};
  // Preserve the snapshots array itself (don't overwrite)
  const currentSnaps = refs.workspace?.getProjectSettings?.(slug)?.workspaceSnapshots || [];
  refs.workspace?.updateProjectSettings?.(slug, {
    ...restoredSettings,
    workspaceSnapshots: currentSnaps,
  });

  return { restored: true, backupId: backup.id, snapshotName: snap.name };
}

/**
 * Delete a snapshot.
 */
export function deleteSnapshot(slug, snapshotId) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const snaps = settings.workspaceSnapshots || [];
  const idx = snaps.findIndex(s => s.id === snapshotId);
  if (idx === -1) return false;

  snaps.splice(idx, 1);
  refs.workspace?.updateProjectSettings?.(slug, { workspaceSnapshots: snaps });
  return true;
}

/**
 * Rename/update a snapshot.
 */
export function updateSnapshot(slug, snapshotId, updates) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const snaps = settings.workspaceSnapshots || [];
  const snap = snaps.find(s => s.id === snapshotId);
  if (!snap) return null;

  if (updates.name) snap.name = updates.name;
  if (updates.description !== undefined) snap.description = updates.description;

  refs.workspace?.updateProjectSettings?.(slug, { workspaceSnapshots: snaps });
  return { id: snap.id, name: snap.name, description: snap.description, auto: snap.auto, createdAt: snap.createdAt };
}

/**
 * Compare two snapshots and return differences.
 * @param {string} slug
 * @param {string} snapId1
 * @param {string} snapId2
 * @returns {object} diff report
 */
export function diffSnapshots(slug, snapId1, snapId2) {
  const snap1 = getSnapshot(slug, snapId1);
  const snap2 = getSnapshot(slug, snapId2);
  if (!snap1 || !snap2) return null;

  const keys1 = new Set(snap1.data?.settingsKeys || []);
  const keys2 = new Set(snap2.data?.settingsKeys || []);

  const added = [...keys2].filter(k => !keys1.has(k));
  const removed = [...keys1].filter(k => !keys2.has(k));
  const shared = [...keys1].filter(k => keys2.has(k));

  const changed = [];
  for (const key of shared) {
    const v1 = JSON.stringify(snap1.data?.settings?.[key]);
    const v2 = JSON.stringify(snap2.data?.settings?.[key]);
    if (v1 !== v2) changed.push(key);
  }

  return {
    snapshot1: { id: snap1.id, name: snap1.name, createdAt: snap1.createdAt },
    snapshot2: { id: snap2.id, name: snap2.name, createdAt: snap2.createdAt },
    added,
    removed,
    changed,
    unchanged: shared.filter(k => !changed.includes(k)),
    totalDifferences: added.length + removed.length + changed.length,
  };
}

/**
 * Clear all snapshots for a project.
 */
export function clearSnapshots(slug) {
  refs.workspace?.updateProjectSettings?.(slug, { workspaceSnapshots: [] });
  return true;
}

/**
 * Get snapshot stats.
 */
export function getSnapshotStats(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const snaps = settings.workspaceSnapshots || [];
  const autoCount = snaps.filter(s => s.auto).length;
  const manualCount = snaps.length - autoCount;
  const oldest = snaps.length ? snaps[snaps.length - 1].createdAt : null;
  const newest = snaps.length ? snaps[0].createdAt : null;

  return {
    total: snaps.length,
    auto: autoCount,
    manual: manualCount,
    oldest,
    newest,
    maxSnapshots: MAX_SNAPSHOTS,
  };
}
