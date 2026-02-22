/**
 * Session Scheduler Service — Phase 8.7
 *
 * Cron-like scheduling for sessions, priority queue, and trigger management.
 * Schedules persist in project settings and execute via the orchestrator.
 *
 * Features:
 * - Cron-expression scheduling (minute, hour, day-of-week)
 * - Priority queue with ordering (high > normal > low)
 * - Trigger types: cron, manual, webhook (auto-run on events)
 * - Schedule enable/disable, one-shot vs recurring
 */

import { refs } from '../state.js';
import log from '../logger.js';

/** @type {Map<string, ReturnType<typeof setInterval>>} */
const cronTimers = new Map();

/** @type {Array<QueueEntry>} */
const queue = [];

/** Priority weights for queue ordering */
const PRIORITY_WEIGHT = { high: 0, normal: 1, low: 2 };

/**
 * @typedef {object} Schedule
 * @property {string} id - Unique schedule ID
 * @property {string} slug - Project slug
 * @property {string} prompt - Session prompt to execute
 * @property {string} cron - Cron expression (minute hour dayOfWeek) or null for manual
 * @property {'high'|'normal'|'low'} priority - Scheduling priority
 * @property {boolean} enabled - Whether the schedule is active
 * @property {boolean} oneShot - If true, disable after first run
 * @property {string} trigger - 'cron' | 'manual' | 'webhook'
 * @property {number} createdAt - Timestamp
 * @property {number|null} lastRun - Last execution timestamp
 * @property {number} runCount - Total executions
 * @property {string|null} lastStatus - Result of last execution
 */

/**
 * @typedef {object} QueueEntry
 * @property {string} id - Queue entry ID
 * @property {string} scheduleId - Associated schedule ID
 * @property {string} slug - Project slug
 * @property {string} prompt - Session prompt
 * @property {'high'|'normal'|'low'} priority - Priority level
 * @property {number} queuedAt - When queued
 * @property {'pending'|'running'|'completed'|'failed'} status
 * @property {string|null} sessionId - Created session ID
 */

// ═══════════════════════════════════════════════════════════
//  Schedule CRUD
// ═══════════════════════════════════════════════════════════

/**
 * Get all schedules for a project.
 * @param {string} slug
 * @returns {Schedule[]}
 */
export function getSchedules(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  return settings.schedules || [];
}

/**
 * Save schedules for a project.
 * @param {string} slug
 * @param {Schedule[]} schedules
 */
function saveSchedules(slug, schedules) {
  refs.workspace?.updateProjectSettings?.(slug, { schedules });
}

/**
 * Add a new schedule.
 * @param {string} slug
 * @param {object} config
 * @returns {Schedule}
 */
export function addSchedule(slug, config) {
  if (!config.prompt) throw new Error('Prompt is required');

  const schedules = getSchedules(slug);
  const id = `sched-${Date.now().toString(36)}`;

  /** @type {Schedule} */
  const schedule = {
    id,
    slug,
    prompt: config.prompt,
    cron: config.cron || null,
    priority: PRIORITY_WEIGHT[config.priority] !== undefined ? config.priority : 'normal',
    enabled: config.enabled !== false,
    oneShot: config.oneShot || false,
    trigger: config.cron ? 'cron' : (config.trigger || 'manual'),
    createdAt: Date.now(),
    lastRun: null,
    runCount: 0,
    lastStatus: null,
  };

  if (schedule.cron) {
    validateCron(schedule.cron);
  }

  schedules.push(schedule);
  saveSchedules(slug, schedules);
  return schedule;
}

/**
 * Update an existing schedule.
 * @param {string} slug
 * @param {string} scheduleId
 * @param {object} patch
 * @returns {Schedule|null}
 */
export function updateSchedule(slug, scheduleId, patch) {
  const schedules = getSchedules(slug);
  const sched = schedules.find(s => s.id === scheduleId);
  if (!sched) return null;

  const allowed = ['prompt', 'cron', 'priority', 'enabled', 'oneShot', 'trigger'];
  for (const key of allowed) {
    if (patch[key] !== undefined) sched[key] = patch[key];
  }
  if (patch.cron) {
    validateCron(patch.cron);
    sched.trigger = 'cron';
  }
  saveSchedules(slug, schedules);
  return sched;
}

/**
 * Remove a schedule.
 * @param {string} slug
 * @param {string} scheduleId
 * @returns {boolean}
 */
export function removeSchedule(slug, scheduleId) {
  const schedules = getSchedules(slug);
  const idx = schedules.findIndex(s => s.id === scheduleId);
  if (idx === -1) return false;
  schedules.splice(idx, 1);
  saveSchedules(slug, schedules);
  // Stop cron timer if running
  const timerKey = `${slug}:${scheduleId}`;
  if (cronTimers.has(timerKey)) {
    clearInterval(cronTimers.get(timerKey));
    cronTimers.delete(timerKey);
  }
  return true;
}

// ═══════════════════════════════════════════════════════════
//  Cron Parsing & Validation
// ═══════════════════════════════════════════════════════════

/**
 * Validate a simple cron expression.
 * Format: "minute hour dayOfWeek" where:
 *  - minute: 0-59 or *
 *  - hour: 0-23 or *
 *  - dayOfWeek: 0-6 (Sun=0) or *
 * @param {string} expr
 */
export function validateCron(expr) {
  if (!expr || typeof expr !== 'string') throw new Error('Cron expression is required');
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 3) throw new Error('Cron must have 3 fields: minute hour dayOfWeek');

  const [min, hour, dow] = parts;
  if (min !== '*' && (isNaN(+min) || +min < 0 || +min > 59)) {
    throw new Error('Cron minute must be 0-59 or *');
  }
  if (hour !== '*' && (isNaN(+hour) || +hour < 0 || +hour > 23)) {
    throw new Error('Cron hour must be 0-23 or *');
  }
  if (dow !== '*' && (isNaN(+dow) || +dow < 0 || +dow > 6)) {
    throw new Error('Cron dayOfWeek must be 0-6 or *');
  }
}

/**
 * Check if a cron expression matches the current time.
 * @param {string} expr
 * @param {Date} [now]
 * @returns {boolean}
 */
export function cronMatches(expr, now = new Date()) {
  const parts = expr.trim().split(/\s+/);
  const [min, hour, dow] = parts;

  if (min !== '*' && +min !== now.getMinutes()) return false;
  if (hour !== '*' && +hour !== now.getHours()) return false;
  if (dow !== '*' && +dow !== now.getDay()) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════
//  Priority Queue
// ═══════════════════════════════════════════════════════════

/**
 * Enqueue a session for execution.
 * @param {string} slug
 * @param {string} prompt
 * @param {object} [options]
 * @returns {QueueEntry}
 */
export function enqueue(slug, prompt, options = {}) {
  const entry = {
    id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    scheduleId: options.scheduleId || null,
    slug,
    prompt,
    priority: options.priority || 'normal',
    queuedAt: Date.now(),
    status: 'pending',
    sessionId: null,
  };
  queue.push(entry);
  // Sort by priority, then by queued time
  queue.sort((a, b) => {
    const pa = PRIORITY_WEIGHT[a.priority] ?? 1;
    const pb = PRIORITY_WEIGHT[b.priority] ?? 1;
    return pa - pb || a.queuedAt - b.queuedAt;
  });
  return entry;
}

/**
 * Get the current queue.
 * @returns {QueueEntry[]}
 */
export function getQueue() {
  return [...queue];
}

/**
 * Remove a queue entry by ID.
 * @param {string} entryId
 * @returns {boolean}
 */
export function dequeue(entryId) {
  const idx = queue.findIndex(e => e.id === entryId);
  if (idx === -1) return false;
  queue.splice(idx, 1);
  return true;
}

/**
 * Get next pending entry from the queue.
 * @returns {QueueEntry|null}
 */
export function peekNext() {
  return queue.find(e => e.status === 'pending') || null;
}

/**
 * Mark a queue entry as running.
 * @param {string} entryId
 * @param {string} sessionId
 * @returns {QueueEntry|null}
 */
export function markRunning(entryId, sessionId) {
  const entry = queue.find(e => e.id === entryId);
  if (!entry) return null;
  entry.status = 'running';
  entry.sessionId = sessionId;
  return entry;
}

/**
 * Mark a queue entry as completed/failed and update the schedule.
 * @param {string} entryId
 * @param {'completed'|'failed'} status
 */
export function markDone(entryId, status) {
  const entry = queue.find(e => e.id === entryId);
  if (!entry) return null;
  entry.status = status;

  // Update associated schedule
  if (entry.scheduleId && entry.slug) {
    const schedules = getSchedules(entry.slug);
    const sched = schedules.find(s => s.id === entry.scheduleId);
    if (sched) {
      sched.lastRun = Date.now();
      sched.runCount++;
      sched.lastStatus = status;
      if (sched.oneShot) sched.enabled = false;
      saveSchedules(entry.slug, schedules);
    }
  }

  // Remove completed entries older than 1 hour
  const cutoff = Date.now() - 3_600_000;
  for (let i = queue.length - 1; i >= 0; i--) {
    if ((queue[i].status === 'completed' || queue[i].status === 'failed') && queue[i].queuedAt < cutoff) {
      queue.splice(i, 1);
    }
  }

  return entry;
}

// ═══════════════════════════════════════════════════════════
//  Cron Tick (called every minute)
// ═══════════════════════════════════════════════════════════

/** Timer for the cron tick */
let cronTickTimer = null;

/**
 * Start the global cron tick. Runs every 60s, checks all project schedules.
 */
export function startCronTick() {
  if (cronTickTimer) return; // already running
  cronTickTimer = setInterval(() => {
    try {
      cronTick();
    } catch (err) {
      log.error('Scheduler cron tick error:', err.message);
    }
  }, 60_000);
  log.info('Scheduler cron tick started');
}

/**
 * Stop the global cron tick.
 */
export function stopCronTick() {
  if (cronTickTimer) {
    clearInterval(cronTickTimer);
    cronTickTimer = null;
  }
  // Clear all per-schedule timers
  for (const timer of cronTimers.values()) clearInterval(timer);
  cronTimers.clear();
}

/**
 * Single cron tick — checks all projects' schedules against current time.
 */
export function cronTick(now = new Date()) {
  if (!refs.workspace) return;
  const projects = refs.workspace.listProjects();
  for (const project of projects) {
    const schedules = getSchedules(project.slug);
    for (const sched of schedules) {
      if (!sched.enabled || !sched.cron) continue;
      if (cronMatches(sched.cron, now)) {
        // Don't double-queue if already pending/running for this schedule
        const alreadyQueued = queue.some(
          e => e.scheduleId === sched.id && (e.status === 'pending' || e.status === 'running')
        );
        if (alreadyQueued) continue;

        enqueue(project.slug, sched.prompt, {
          scheduleId: sched.id,
          priority: sched.priority,
        });
        log.info(`Scheduled session queued: ${project.slug} — ${sched.prompt.slice(0, 50)}`);
      }
    }
  }
}

/**
 * Clean up scheduler resources. Call on shutdown.
 */
export function cleanupScheduler() {
  stopCronTick();
  queue.length = 0;
}
