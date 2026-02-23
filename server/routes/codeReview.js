/**
 * Code review routes — diff review, workspace snapshots.
 */
import { Router } from 'express';
import { refs } from '../state.js';
import {
  getDiffs, getDiff, addDiff, reviewHunk, bulkReview,
  revertDiff, removeDiff, clearDiffs, getReviewStats,
} from '../services/diffReview.js';
import {
  createSnapshot, listSnapshots, getSnapshot, restoreSnapshot,
  deleteSnapshot, updateSnapshot, diffSnapshots, clearSnapshots,
  getSnapshotStats,
} from '../services/workspaceSnapshots.js';

const router = Router();

// ═════════════════════════════════════════════════════════════════
//  Diff Review (Phase 10.4)
// ═════════════════════════════════════════════════════════════════

/** List diffs for a project */
router.get('/projects/:slug/diffs', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { sessionId, status, file } = req.query;
  res.json(getDiffs(req.params.slug, { sessionId, status, file }));
});

/** Get review stats */
router.get('/projects/:slug/diffs/stats', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getReviewStats(req.params.slug));
});

/** Get single diff */
router.get('/projects/:slug/diffs/:diffId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const diff = getDiff(req.params.slug, req.params.diffId);
  if (!diff) return res.status(404).json({ error: 'Diff not found' });
  res.json(diff);
});

/** Add a diff */
router.post('/projects/:slug/diffs', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.status(201).json(addDiff(req.params.slug, req.body));
});

/** Review a hunk */
router.post('/projects/:slug/diffs/:diffId/hunks/:hunkId/review', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const result = reviewHunk(req.params.slug, req.params.diffId, req.params.hunkId, req.body.status, req.body.reviewer);
  if (!result) return res.status(404).json({ error: 'Diff or hunk not found' });
  res.json(result);
});

/** Bulk review all hunks */
router.post('/projects/:slug/diffs/:diffId/bulk-review', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const result = bulkReview(req.params.slug, req.params.diffId, req.body.status, req.body.reviewer);
  if (!result) return res.status(404).json({ error: 'Diff not found' });
  res.json(result);
});

/** Revert a diff */
router.post('/projects/:slug/diffs/:diffId/revert', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const result = revertDiff(req.params.slug, req.params.diffId);
  if (!result) return res.status(404).json({ error: 'Diff not found' });
  res.json(result);
});

/** Delete a diff */
router.delete('/projects/:slug/diffs/:diffId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const ok = removeDiff(req.params.slug, req.params.diffId);
  if (!ok) return res.status(404).json({ error: 'Diff not found' });
  res.json({ ok: true });
});

/** Clear all diffs */
router.delete('/projects/:slug/diffs', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  clearDiffs(req.params.slug);
  res.json({ ok: true });
});


// ─── Workspace Snapshots ───────────────────────────────────────

/** List snapshots */
router.get('/projects/:slug/snapshots', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const opts = {};
  if (req.query.limit) opts.limit = parseInt(req.query.limit, 10);
  if (req.query.auto !== undefined) opts.auto = req.query.auto === 'true';
  res.json(listSnapshots(req.params.slug, opts));
});

/** Create snapshot */
router.post('/projects/:slug/snapshots', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(createSnapshot(req.params.slug, req.body));
});

/** Get snapshot stats */
router.get('/projects/:slug/snapshots/stats', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getSnapshotStats(req.params.slug));
});

/** Diff two snapshots */
router.get('/projects/:slug/snapshots/diff', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { snap1, snap2 } = req.query;
  if (!snap1 || !snap2) return res.status(400).json({ error: 'snap1 and snap2 required' });
  const result = diffSnapshots(req.params.slug, snap1, snap2);
  if (!result) return res.status(404).json({ error: 'Snapshot not found' });
  res.json(result);
});

/** Get single snapshot */
router.get('/projects/:slug/snapshots/:snapId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const snap = getSnapshot(req.params.slug, req.params.snapId);
  if (!snap) return res.status(404).json({ error: 'Snapshot not found' });
  res.json(snap);
});

/** Update snapshot */
router.put('/projects/:slug/snapshots/:snapId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const snap = updateSnapshot(req.params.slug, req.params.snapId, req.body);
  if (!snap) return res.status(404).json({ error: 'Snapshot not found' });
  res.json(snap);
});

/** Restore snapshot */
router.post('/projects/:slug/snapshots/:snapId/restore', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const result = restoreSnapshot(req.params.slug, req.params.snapId);
  if (!result) return res.status(404).json({ error: 'Snapshot not found' });
  res.json(result);
});

/** Delete snapshot */
router.delete('/projects/:slug/snapshots/:snapId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const ok = deleteSnapshot(req.params.slug, req.params.snapId);
  if (!ok) return res.status(404).json({ error: 'Snapshot not found' });
  res.json({ ok: true });
});

/** Clear all snapshots */
router.delete('/projects/:slug/snapshots', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  clearSnapshots(req.params.slug);
  res.json({ ok: true });
});


export default router;
