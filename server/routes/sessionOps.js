/**
 * Session operations routes — replay, comparison, scoring.
 */
import { Router } from 'express';
import { refs } from '../state.js';
import {
  getReplay, getReplaySlice, getReplayStep, getTaskAgents, getReplayStepTypes,
} from '../services/sessionReplay.js';
import {
  compareSessions, quickDiff, listComparisons, getComparison,
  deleteComparison, scoreSession, getComparisonStats,
  COMPARISON_OUTCOMES, DIFF_CATEGORIES,
} from '../services/sessionComparison.js';

const router = Router();

/** Get full session replay */
router.get('/projects/:slug/sessions/:sessionId/replay', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const replay = getReplay(req.params.slug, req.params.sessionId);
  if (!replay) return res.status(404).json({ error: 'Session not found' });
  res.json(replay);
});

/** Get replay step slice (for timeline scrubbing) */
router.get('/projects/:slug/sessions/:sessionId/replay/slice', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const opts = {};
  if (req.query.from) opts.from = parseInt(req.query.from, 10);
  if (req.query.to) opts.to = parseInt(req.query.to, 10);
  if (req.query.type) opts.type = req.query.type;
  const result = getReplaySlice(req.params.slug, req.params.sessionId, opts);
  if (!result) return res.status(404).json({ error: 'Session not found' });
  res.json(result);
});

/** Get a single replay step by index */
router.get('/projects/:slug/sessions/:sessionId/replay/step/:index', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const step = getReplayStep(req.params.slug, req.params.sessionId, parseInt(req.params.index, 10));
  if (!step) return res.status(404).json({ error: 'Session not found' });
  res.json(step);
});

/** Get agent outputs for a specific task in replay */
router.get('/projects/:slug/sessions/:sessionId/replay/task/:taskId/agents', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const agents = getTaskAgents(req.params.slug, req.params.sessionId, req.params.taskId);
  if (!agents) return res.status(404).json({ error: 'Session not found' });
  res.json(agents);
});

/** Get available step types in a session replay */
router.get('/projects/:slug/sessions/:sessionId/replay/types', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const types = getReplayStepTypes(req.params.slug, req.params.sessionId);
  if (!types) return res.status(404).json({ error: 'Session not found' });
  res.json(types);
});


// ─── Phase 12.4 — Session Comparison ─────────────────────────────────────

/** Compare two sessions */
router.post('/projects/:slug/session-comparisons', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const { sessionIdA, sessionIdB, sessionA, sessionB } = req.body;
  if ((!sessionIdA && !sessionA) || (!sessionIdB && !sessionB)) {
    return res.status(400).json({ error: 'sessionIdA/sessionA and sessionIdB/sessionB are required' });
  }
  try {
    const comp = compareSessions(req.params.slug, req.body);
    res.status(201).json(comp);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/** Quick diff (read-only, not stored) */
router.post('/projects/:slug/session-comparisons/quick-diff', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const { sessionIdA, sessionIdB, sessionA, sessionB } = req.body;
  if ((!sessionIdA && !sessionA) || (!sessionIdB && !sessionB)) {
    return res.status(400).json({ error: 'sessionIdA/sessionA and sessionIdB/sessionB are required' });
  }
  try {
    res.json(quickDiff(req.params.slug, req.body));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/** List saved comparisons */
router.get('/projects/:slug/session-comparisons', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(listComparisons(req.params.slug));
});

/** Get a single comparison */
router.get('/projects/:slug/session-comparisons/:compId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const comp = getComparison(req.params.slug, req.params.compId);
  if (!comp) return res.status(404).json({ error: 'Comparison not found' });
  res.json(comp);
});

/** Delete a comparison */
router.delete('/projects/:slug/session-comparisons/:compId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const removed = deleteComparison(req.params.slug, req.params.compId);
  if (!removed) return res.status(404).json({ error: 'Comparison not found' });
  res.json(removed);
});

/** Score a single session's effectiveness */
router.get('/projects/:slug/sessions/:sessionId/score', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  try {
    res.json(scoreSession(req.params.slug, req.params.sessionId));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/** Comparison stats */
router.get('/projects/:slug/session-comparison-stats', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getComparisonStats(req.params.slug));
});

/** Available comparison outcomes */
router.get('/comparison-outcomes', (_req, res) => {
  res.json(COMPARISON_OUTCOMES);
});

/** Available diff categories */
router.get('/diff-categories', (_req, res) => {
  res.json(DIFF_CATEGORIES);
});


export default router;
