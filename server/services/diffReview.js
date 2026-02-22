/**
 * server/services/diffReview.js — Diff Review System
 *
 * Side-by-side diff viewer for agent changes. Supports
 * per-hunk approve/reject, bulk operations, revert support,
 * and review status tracking.
 */

import { randomBytes } from 'crypto';
import { refs } from '../state.js';

// ─── Review Statuses ────────────────────────────────────────────────
export const REVIEW_STATUSES = ['pending', 'approved', 'rejected', 'reverted'];

// ─── Diff Entry Management ──────────────────────────────────────────

/**
 * Get all diffs for a project session.
 * @param {string} slug
 * @param {object} opts - { sessionId?, status?, file? }
 * @returns {{ diffs: Array, total: number }}
 */
export function getDiffs(slug, opts = {}) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  let diffs = settings.diffReviews || [];

  if (opts.sessionId) diffs = diffs.filter(d => d.sessionId === opts.sessionId);
  if (opts.status) diffs = diffs.filter(d => d.status === opts.status);
  if (opts.file) diffs = diffs.filter(d => d.file?.includes(opts.file));

  return { diffs, total: diffs.length };
}

/**
 * Get a single diff by ID.
 */
export function getDiff(slug, diffId) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const diffs = settings.diffReviews || [];
  return diffs.find(d => d.id === diffId) || null;
}

/**
 * Add a diff for review.
 * @param {string} slug
 * @param {object} data - { file, hunks, sessionId?, before?, after? }
 * @returns {object} created diff
 */
export function addDiff(slug, data) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const diffs = settings.diffReviews || [];

  const diff = {
    id: `diff-${Date.now()}-${randomBytes(4).toString('hex')}`,
    file: data.file || 'unknown',
    hunks: Array.isArray(data.hunks) ? data.hunks.map((h, i) => ({
      id: `hunk-${i}`,
      header: h.header || `@@ hunk ${i} @@`,
      lines: h.lines || [],
      status: 'pending',
    })) : [],
    before: data.before || '',
    after: data.after || '',
    sessionId: data.sessionId || '',
    status: 'pending',
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    reviewedBy: null,
  };

  diffs.unshift(diff);

  // Cap at 200 diffs
  if (diffs.length > 200) diffs.length = 200;

  refs.workspace?.updateProjectSettings?.(slug, { diffReviews: diffs });
  return diff;
}

/**
 * Review a single hunk within a diff.
 * @param {string} slug
 * @param {string} diffId
 * @param {string} hunkId
 * @param {'approved'|'rejected'} status
 * @param {string} [reviewer]
 * @returns {object|null}
 */
export function reviewHunk(slug, diffId, hunkId, status, reviewer = 'user') {
  if (!['approved', 'rejected'].includes(status)) return null;

  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const diffs = settings.diffReviews || [];
  const diff = diffs.find(d => d.id === diffId);
  if (!diff) return null;

  const hunk = diff.hunks.find(h => h.id === hunkId);
  if (!hunk) return null;

  hunk.status = status;
  hunk.reviewedAt = new Date().toISOString();

  // Update diff-level status based on hunks
  updateDiffStatus(diff, reviewer);

  refs.workspace?.updateProjectSettings?.(slug, { diffReviews: diffs });
  return diff;
}

/**
 * Bulk approve/reject all hunks in a diff.
 * @param {string} slug
 * @param {string} diffId
 * @param {'approved'|'rejected'} status
 * @param {string} [reviewer]
 * @returns {object|null}
 */
export function bulkReview(slug, diffId, status, reviewer = 'user') {
  if (!['approved', 'rejected'].includes(status)) return null;

  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const diffs = settings.diffReviews || [];
  const diff = diffs.find(d => d.id === diffId);
  if (!diff) return null;

  for (const hunk of diff.hunks) {
    hunk.status = status;
    hunk.reviewedAt = new Date().toISOString();
  }

  diff.status = status;
  diff.reviewedAt = new Date().toISOString();
  diff.reviewedBy = reviewer;

  refs.workspace?.updateProjectSettings?.(slug, { diffReviews: diffs });
  return diff;
}

/**
 * Revert a diff (mark as reverted).
 * @param {string} slug
 * @param {string} diffId
 * @returns {object|null}
 */
export function revertDiff(slug, diffId) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const diffs = settings.diffReviews || [];
  const diff = diffs.find(d => d.id === diffId);
  if (!diff) return null;

  diff.status = 'reverted';
  diff.revertedAt = new Date().toISOString();
  for (const hunk of diff.hunks) hunk.status = 'reverted';

  refs.workspace?.updateProjectSettings?.(slug, { diffReviews: diffs });
  return diff;
}

/**
 * Remove a diff entry.
 */
export function removeDiff(slug, diffId) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const diffs = settings.diffReviews || [];
  const idx = diffs.findIndex(d => d.id === diffId);
  if (idx === -1) return false;

  diffs.splice(idx, 1);
  refs.workspace?.updateProjectSettings?.(slug, { diffReviews: diffs });
  return true;
}

/**
 * Clear all diffs for a project.
 */
export function clearDiffs(slug) {
  refs.workspace?.updateProjectSettings?.(slug, { diffReviews: [] });
  return true;
}

/**
 * Get review stats for a project.
 */
export function getReviewStats(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const diffs = settings.diffReviews || [];

  const statusCounts = { pending: 0, approved: 0, rejected: 0, reverted: 0 };
  let totalHunks = 0;
  let pendingHunks = 0;
  const filesChanged = new Set();

  for (const d of diffs) {
    statusCounts[d.status] = (statusCounts[d.status] || 0) + 1;
    filesChanged.add(d.file);
    for (const h of d.hunks) {
      totalHunks++;
      if (h.status === 'pending') pendingHunks++;
    }
  }

  return {
    total: diffs.length,
    byStatus: statusCounts,
    totalHunks,
    pendingHunks,
    filesChanged: filesChanged.size,
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────

function updateDiffStatus(diff, reviewer) {
  const allApproved = diff.hunks.every(h => h.status === 'approved');
  const allRejected = diff.hunks.every(h => h.status === 'rejected');
  const anyPending = diff.hunks.some(h => h.status === 'pending');

  if (allApproved) diff.status = 'approved';
  else if (allRejected) diff.status = 'rejected';
  else if (!anyPending) diff.status = 'approved'; // mixed = approved
  else diff.status = 'pending';

  if (!anyPending) {
    diff.reviewedAt = new Date().toISOString();
    diff.reviewedBy = reviewer;
  }
}
