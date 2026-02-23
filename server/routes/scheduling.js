/**
 * Scheduling routes — retry policies, benchmarks, schedules, queue, scheduled tasks.
 */
import { Router } from 'express';
import { refs } from '../state.js';
import { validateRetrySettings, buildRetryPolicy } from '../services/retryPolicy.js';
import { computeBenchmarks } from '../services/benchmarks.js';
import {
  getSchedules, addSchedule, updateSchedule, removeSchedule,
  getQueue, enqueue, dequeue,
} from '../services/scheduler.js';
import {
  createSchedule as createSchedTask, listSchedules as listSchedTasks,
  getSchedule as getSchedTask, updateSchedule as updateSchedTask,
  deleteSchedule as deleteSchedTask, pauseSchedule, resumeSchedule, triggerRun,
  getDueSchedules, getScheduleStats as getSchedStats,
  SCHEDULE_STATUSES, REPEAT_MODES,
} from '../services/scheduledTasks.js';

const router = Router();

/** Get retry policy for a project (merged with defaults) */
router.get('/projects/:slug/retry-policy', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const settings = refs.workspace.getProjectSettings(req.params.slug);
  res.json(buildRetryPolicy(settings));
});

/** Update retry policy for a project */
router.put('/projects/:slug/retry-policy', (req, res) => {
  const { valid, policy, errors } = validateRetrySettings(req.body);
  if (!valid) return res.status(400).json({ error: errors.join('; ') });

  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const settings = refs.workspace.getProjectSettings(req.params.slug);
  const merged = { ...settings, ...policy };
  refs.workspace.updateProjectSettings(req.params.slug, merged);
  res.json(buildRetryPolicy(merged));
});

// ═══════════════════════════════════════════════════════════
//  Benchmarks — Phase 8.8
// ═══════════════════════════════════════════════════════════

/** Get performance benchmarks for a project */
router.get('/projects/:slug/benchmarks', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const sessions = refs.workspace.listSessions(req.params.slug);
  res.json(computeBenchmarks(sessions));
});

// ═══════════════════════════════════════════════════════════
//  Schedules — Phase 8.7
// ═══════════════════════════════════════════════════════════

/** List schedules for a project */
router.get('/projects/:slug/schedules', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getSchedules(req.params.slug));
});

/** Create a schedule */
router.post('/projects/:slug/schedules', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  try {
    const schedule = addSchedule(req.params.slug, req.body);
    res.status(201).json(schedule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Update a schedule */
router.patch('/projects/:slug/schedules/:scheduleId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  try {
    const updated = updateSchedule(req.params.slug, req.params.scheduleId, req.body);
    if (!updated) return res.status(404).json({ error: 'Schedule not found' });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Delete a schedule */
router.delete('/projects/:slug/schedules/:scheduleId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const removed = removeSchedule(req.params.slug, req.params.scheduleId);
  if (!removed) return res.status(404).json({ error: 'Schedule not found' });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
//  Queue — Phase 8.7
// ═══════════════════════════════════════════════════════════

/** Get the current execution queue */
router.get('/queue', (_req, res) => {
  res.json(getQueue());
});

/** Enqueue a session manually */
router.post('/projects/:slug/queue', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  if (!req.body.prompt) return res.status(400).json({ error: 'Prompt is required' });
  const entry = enqueue(req.params.slug, req.body.prompt, {
    priority: req.body.priority,
    scheduleId: req.body.scheduleId,
  });
  res.status(201).json(entry);
});

/** Remove a queue entry */
router.delete('/queue/:entryId', (req, res) => {
  const removed = dequeue(req.params.entryId);
  if (!removed) return res.status(404).json({ error: 'Queue entry not found' });
  res.json({ success: true });
});

// ─── Phase 12.5 — Scheduled Tasks ────────────────────────────────────────

/** Create a scheduled task */
router.post('/projects/:slug/scheduled-tasks', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  try {
    const sched = createSchedTask(req.params.slug, req.body);
    res.status(201).json(sched);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** List scheduled tasks */
router.get('/projects/:slug/scheduled-tasks', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(listSchedTasks(req.params.slug, req.query));
});

/** Get a single scheduled task */
router.get('/projects/:slug/scheduled-tasks/:schedId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const sched = getSchedTask(req.params.slug, req.params.schedId);
  if (!sched) return res.status(404).json({ error: 'Schedule not found' });
  res.json(sched);
});

/** Update a scheduled task */
router.patch('/projects/:slug/scheduled-tasks/:schedId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const sched = updateSchedTask(req.params.slug, req.params.schedId, req.body);
  if (!sched) return res.status(404).json({ error: 'Schedule not found' });
  res.json(sched);
});

/** Delete a scheduled task */
router.delete('/projects/:slug/scheduled-tasks/:schedId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const removed = deleteSchedTask(req.params.slug, req.params.schedId);
  if (!removed) return res.status(404).json({ error: 'Schedule not found' });
  res.json(removed);
});

/** Pause a scheduled task */
router.post('/projects/:slug/scheduled-tasks/:schedId/pause', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const sched = pauseSchedule(req.params.slug, req.params.schedId);
  if (!sched) return res.status(404).json({ error: 'Schedule not found' });
  res.json(sched);
});

/** Resume a scheduled task */
router.post('/projects/:slug/scheduled-tasks/:schedId/resume', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const sched = resumeSchedule(req.params.slug, req.params.schedId);
  if (!sched) return res.status(404).json({ error: 'Schedule not found' });
  res.json(sched);
});

/** Trigger a run */
router.post('/projects/:slug/scheduled-tasks/:schedId/trigger', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const result = triggerRun(req.params.slug, req.params.schedId);
  if (!result) return res.status(404).json({ error: 'Schedule not found' });
  res.json(result);
});

/** Get due scheduled tasks */
router.get('/projects/:slug/scheduled-tasks-due', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getDueSchedules(req.params.slug));
});

/** Scheduled task stats */
router.get('/projects/:slug/scheduled-task-stats', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getSchedStats(req.params.slug));
});

/** Available schedule statuses */
router.get('/schedule-statuses', (_req, res) => {
  res.json(SCHEDULE_STATUSES);
});

/** Available repeat modes */
router.get('/repeat-modes', (_req, res) => {
  res.json(REPEAT_MODES);
});


export default router;
