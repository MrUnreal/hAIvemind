/**
 * Analytics routes — session analytics, performance profiling.
 */
import { Router } from 'express';
import { refs } from '../state.js';
import {
  getProjectStats, getTimeSeries, getModelBreakdown,
  getWeeklyDigest, exportSessionsCsv, getTopSessions,
} from '../services/analytics.js';
import {
  recordMetric, listMetrics, getMetric, getPercentiles,
  detectBottlenecks, getTrend, getPerformanceSummary, clearMetrics,
  METRIC_TYPES,
} from '../services/performanceProfiling.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════
//  Session Analytics (Phase 10.0)
// ═══════════════════════════════════════════════════════════════════

/** Get aggregate project stats */
router.get('/projects/:slug/analytics/stats', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { from, to } = req.query;
  res.json(getProjectStats(req.params.slug, { from, to }));
});

/** Get time-series data */
router.get('/projects/:slug/analytics/timeseries', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const granularity = req.query.granularity || 'day';
  const periods = parseInt(req.query.periods) || 14;
  res.json(getTimeSeries(req.params.slug, granularity, periods));
});

/** Get model usage breakdown */
router.get('/projects/:slug/analytics/models', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getModelBreakdown(req.params.slug));
});

/** Get weekly digest */
router.get('/projects/:slug/analytics/digest', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getWeeklyDigest(req.params.slug));
});

/** Export sessions as CSV */
router.get('/projects/:slug/analytics/export', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { from, to } = req.query;
  const csv = exportSessionsCsv(req.params.slug, { from, to });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.slug}-sessions.csv"`);
  res.send(csv);
});

/** Get top sessions by duration or cost */
router.get('/projects/:slug/analytics/top', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const sortBy = req.query.sortBy || 'duration';
  const limit = parseInt(req.query.limit) || 10;
  res.json(getTopSessions(req.params.slug, sortBy, limit));
});


// ─── Phase 12.2: Performance Profiling ──────────────────────────────────

/** Record a performance metric */
router.post('/projects/:slug/metrics', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  try {
    const metric = recordMetric(req.params.slug, req.body);
    res.status(201).json(metric);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** List metrics */
router.get('/projects/:slug/metrics', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(listMetrics(req.params.slug, {
    name: req.query.name,
    type: req.query.type,
    since: req.query.since ? parseInt(req.query.since, 10) : undefined,
    until: req.query.until ? parseInt(req.query.until, 10) : undefined,
    limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
  }));
});

/** Get a single metric */
router.get('/projects/:slug/metrics/:metricId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const metric = getMetric(req.params.slug, req.params.metricId);
  if (!metric) return res.status(404).json({ error: 'Metric not found' });
  res.json(metric);
});

/** Get percentiles for an operation */
router.get('/projects/:slug/percentiles/:opName', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const since = req.query.since ? parseInt(req.query.since, 10) : undefined;
  res.json(getPercentiles(req.params.slug, req.params.opName, { since }));
});

/** Detect bottlenecks */
router.get('/projects/:slug/bottlenecks', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(detectBottlenecks(req.params.slug, {
    thresholdMs: req.query.thresholdMs ? parseInt(req.query.thresholdMs, 10) : undefined,
    minSamples: req.query.minSamples ? parseInt(req.query.minSamples, 10) : undefined,
  }));
});

/** Get performance trend */
router.get('/projects/:slug/trend/:opName', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getTrend(req.params.slug, req.params.opName, {
    bucketMs: req.query.bucketMs ? parseInt(req.query.bucketMs, 10) : undefined,
    since: req.query.since ? parseInt(req.query.since, 10) : undefined,
  }));
});

/** Performance summary */
router.get('/projects/:slug/performance-summary', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getPerformanceSummary(req.params.slug));
});

/** Clear all metrics */
router.delete('/projects/:slug/metrics', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  clearMetrics(req.params.slug);
  res.json({ ok: true });
});

/** List metric types */
router.get('/metric-types', (_req, res) => {
  res.json(METRIC_TYPES);
});


export default router;
