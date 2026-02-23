/**
 * Scheduled Tasks Service — Phase 12.5
 *
 * Cron-style scheduling, recurring sessions, timezone-aware scheduling,
 * next-run calculation, schedule enable/disable.
 */

import { refs } from '../state.js';

// ─── Constants ──────────────────────────────────────────────────────────

export const SCHEDULE_STATUSES = ['active', 'paused', 'completed', 'expired'];
export const REPEAT_MODES = ['once', 'hourly', 'daily', 'weekly', 'monthly', 'cron'];

// ─── Helpers ────────────────────────────────────────────────────────────

function _genId(prefix = 'sched') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function _getSchedules(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  return settings.scheduledTasks || [];
}

function _saveSchedules(slug, schedules) {
  if (schedules.length > 500) schedules.splice(0, schedules.length - 500);
  refs.workspace?.updateProjectSettings?.(slug, { scheduledTasks: schedules });
}

/**
 * Calculate the next run time based on repeat mode and last run.
 * @param {string} mode - One of REPEAT_MODES
 * @param {number} baseTime - Epoch ms of last run or anchor
 * @returns {number|null} Epoch ms of next run, or null for 'once' that already ran
 */
function _calcNextRun(mode, baseTime) {
  const base = baseTime || Date.now();
  switch (mode) {
    case 'once': return null;
    case 'hourly': return base + 3600000;
    case 'daily': return base + 86400000;
    case 'weekly': return base + 604800000;
    case 'monthly': return base + 2592000000; // ~30 days
    case 'cron': return base + 3600000; // fallback to hourly for cron
    default: return null;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Create a new scheduled task.
 */
export function createSchedule(slug, data = {}) {
  if (!data.name) throw new Error('name is required');
  if (!data.task) throw new Error('task is required');

  const mode = REPEAT_MODES.includes(data.repeatMode) ? data.repeatMode : 'once';
  const startAt = data.startAt || Date.now();

  const schedule = {
    id: _genId(),
    name: data.name,
    task: data.task,
    repeatMode: mode,
    status: 'active',
    timezone: data.timezone || 'UTC',
    startAt,
    nextRun: startAt,
    lastRun: null,
    runCount: 0,
    maxRuns: data.maxRuns || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const schedules = _getSchedules(slug);
  schedules.push(schedule);
  _saveSchedules(slug, schedules);
  return schedule;
}

/**
 * List all schedules for a project.
 */
export function listSchedules(slug, filters = {}) {
  let schedules = _getSchedules(slug);
  if (filters.status) schedules = schedules.filter(s => s.status === filters.status);
  if (filters.repeatMode) schedules = schedules.filter(s => s.repeatMode === filters.repeatMode);
  return schedules;
}

/**
 * Get a single schedule by ID.
 */
export function getSchedule(slug, schedId) {
  return _getSchedules(slug).find(s => s.id === schedId) || null;
}

/**
 * Update a schedule (name, task, repeatMode, timezone, status, maxRuns).
 */
export function updateSchedule(slug, schedId, patch = {}) {
  const schedules = _getSchedules(slug);
  const sched = schedules.find(s => s.id === schedId);
  if (!sched) return null;

  if (patch.name !== undefined) sched.name = patch.name;
  if (patch.task !== undefined) sched.task = patch.task;
  if (patch.repeatMode && REPEAT_MODES.includes(patch.repeatMode)) sched.repeatMode = patch.repeatMode;
  if (patch.timezone !== undefined) sched.timezone = patch.timezone;
  if (patch.status && SCHEDULE_STATUSES.includes(patch.status)) sched.status = patch.status;
  if (patch.maxRuns !== undefined) sched.maxRuns = patch.maxRuns;
  sched.updatedAt = Date.now();

  _saveSchedules(slug, schedules);
  return sched;
}

/**
 * Delete a schedule.
 */
export function deleteSchedule(slug, schedId) {
  const schedules = _getSchedules(slug);
  const idx = schedules.findIndex(s => s.id === schedId);
  if (idx === -1) return null;
  const removed = schedules.splice(idx, 1)[0];
  _saveSchedules(slug, schedules);
  return removed;
}

/**
 * Pause a schedule.
 */
export function pauseSchedule(slug, schedId) {
  return updateSchedule(slug, schedId, { status: 'paused' });
}

/**
 * Resume a paused schedule.
 */
export function resumeSchedule(slug, schedId) {
  return updateSchedule(slug, schedId, { status: 'active' });
}

/**
 * Simulate a run: increment runCount, update lastRun, calculate nextRun.
 * Returns the updated schedule or null if expired/completed.
 */
export function triggerRun(slug, schedId) {
  const schedules = _getSchedules(slug);
  const sched = schedules.find(s => s.id === schedId);
  if (!sched) return null;
  if (sched.status !== 'active') return { ...sched, skipped: true, reason: `status is ${sched.status}` };

  sched.runCount++;
  sched.lastRun = Date.now();
  sched.nextRun = _calcNextRun(sched.repeatMode, sched.lastRun);

  // Check if maxRuns exceeded
  if (sched.maxRuns && sched.runCount >= sched.maxRuns) {
    sched.status = 'completed';
    sched.nextRun = null;
  }

  // 'once' tasks complete after first run
  if (sched.repeatMode === 'once') {
    sched.status = 'completed';
    sched.nextRun = null;
  }

  sched.updatedAt = Date.now();
  _saveSchedules(slug, schedules);
  return sched;
}

/**
 * Get schedules that are due to run (nextRun <= now and status === 'active').
 */
export function getDueSchedules(slug) {
  const now = Date.now();
  return _getSchedules(slug).filter(s => s.status === 'active' && s.nextRun && s.nextRun <= now);
}

/**
 * Get schedule stats for the project.
 */
export function getScheduleStats(slug) {
  const schedules = _getSchedules(slug);
  const byStatus = {};
  const byMode = {};
  let totalRuns = 0;
  for (const s of schedules) {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    byMode[s.repeatMode] = (byMode[s.repeatMode] || 0) + 1;
    totalRuns += s.runCount || 0;
  }
  return {
    total: schedules.length,
    byStatus,
    byMode,
    totalRuns,
  };
}
