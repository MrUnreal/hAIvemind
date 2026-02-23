/**
 * Resource routes — system resources, health dashboard.
 */
import { Router } from 'express';
import { refs } from '../state.js';
import {
  getSystemMetrics, getLimits, setLimits, trackProcess, untrackProcess,
  getTrackedProcesses, killProcess, recordSnapshot, getSnapshots,
  getAlerts, clearAlerts,
} from '../services/resourceMonitor.js';
import {
  getUptime, recordLatency, getLatencyStats, recordError, getErrorStats,
  clearErrors, recordBackendCheck, getBackendHealth, getHealthScore,
  getThresholds, setThresholds, checkThresholds, getDashboard,
} from '../services/healthDashboard.js';

const router = Router();

// ═════════════════════════════════════════════════════════════════
//  Resource Monitor (Phase 10.3)
// ═════════════════════════════════════════════════════════════════

/** Get system metrics (global, no project needed) */
router.get('/resources/system', (_req, res) => {
  res.json(getSystemMetrics());
});

/** Get resource snapshots */
router.get('/resources/snapshots', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : undefined;
  res.json(getSnapshots(limit));
});

/** Record a snapshot */
router.post('/resources/snapshots', (_req, res) => {
  res.json(recordSnapshot());
});

/** Get resource alerts */
router.get('/resources/alerts', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : undefined;
  res.json(getAlerts(limit));
});

/** Clear alerts */
router.delete('/resources/alerts', (_req, res) => {
  clearAlerts();
  res.json({ ok: true });
});

/** Get tracked processes */
router.get('/resources/processes', (_req, res) => {
  res.json(getTrackedProcesses());
});

/** Track a process */
router.post('/resources/processes', (req, res) => {
  const { pid, label, slug } = req.body;
  if (!pid) return res.status(400).json({ error: 'pid required' });
  trackProcess(pid, label || `Process ${pid}`, slug);
  res.status(201).json({ ok: true, pid });
});

/** Kill a tracked process */
router.delete('/resources/processes/:pid', (req, res) => {
  const pid = parseInt(req.params.pid);
  if (isNaN(pid)) return res.status(400).json({ error: 'invalid pid' });
  res.json(killProcess(pid));
});

/** Get resource limits for a project */
router.get('/projects/:slug/resources/limits', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getLimits(req.params.slug));
});

/** Set resource limits for a project */
router.put('/projects/:slug/resources/limits', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(setLimits(req.params.slug, req.body));
});


// ─── Health Dashboard ───────────────────────────────────────────

/** Full health dashboard */
router.get('/health/dashboard', (req, res) => {
  res.json(getDashboard());
});

/** Uptime */
router.get('/health/uptime', (req, res) => {
  res.json(getUptime());
});

/** Health score */
router.get('/health/score', (req, res) => {
  res.json(getHealthScore());
});

/** Latency stats */
router.get('/health/latency', (req, res) => {
  const opts = {};
  if (req.query.endpoint) opts.endpoint = req.query.endpoint;
  if (req.query.windowMs) opts.windowMs = parseInt(req.query.windowMs, 10);
  res.json(getLatencyStats(opts));
});

/** Record latency */
router.post('/health/latency', (req, res) => {
  const { endpoint, ms } = req.body;
  if (!endpoint || typeof ms !== 'number') {
    return res.status(400).json({ error: 'endpoint and ms required' });
  }
  recordLatency(endpoint, ms);
  res.json({ ok: true });
});

/** Error stats */
router.get('/health/errors', (req, res) => {
  const opts = {};
  if (req.query.windowMs) opts.windowMs = parseInt(req.query.windowMs, 10);
  if (req.query.limit) opts.limit = parseInt(req.query.limit, 10);
  res.json(getErrorStats(opts));
});

/** Record error */
router.post('/health/errors', (req, res) => {
  const { message, endpoint } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  recordError(message, endpoint);
  res.json({ ok: true });
});

/** Clear errors */
router.delete('/health/errors', (req, res) => {
  clearErrors();
  res.json({ ok: true });
});

/** Backend health */
router.get('/health/backends', (req, res) => {
  res.json(getBackendHealth());
});

/** Record backend check */
router.post('/health/backends', (req, res) => {
  const { backend, available, latencyMs } = req.body;
  if (!backend || typeof available !== 'boolean') {
    return res.status(400).json({ error: 'backend and available required' });
  }
  recordBackendCheck(backend, available, latencyMs || 0);
  res.json({ ok: true });
});

/** Get thresholds */
router.get('/health/thresholds', (req, res) => {
  res.json(getThresholds());
});

/** Set thresholds */
router.put('/health/thresholds', (req, res) => {
  res.json(setThresholds(req.body));
});

/** Check thresholds */
router.get('/health/thresholds/check', (req, res) => {
  res.json(checkThresholds());
});


export default router;
