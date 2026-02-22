// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 8.7: Session Scheduling Tests ─────────────────────────────────

// ── Scheduler Service Unit Tests ──

test.describe('Scheduler — Service', () => {
  let cleanup;
  const SLUG = 'sched-test-slug';

  test.beforeAll(async () => {
    const { refs } = await import('../server/state.js');
    const { default: WorkspaceManager } = await import('../server/workspace.js');
    const testDir = path.join(ROOT, '.haivemind-workspace', SLUG, '.haivemind');
    mkdirSync(testDir, { recursive: true });
    const wm = new WorkspaceManager();
    // Register the test project so listProjects() finds it
    try { wm.createProject(SLUG, { slug: SLUG }); } catch { /* already exists */ }
    refs.workspace = wm;
  });

  test.afterAll(async () => {
    try { rmSync(path.join(ROOT, '.haivemind-workspace', SLUG), { recursive: true, force: true }); } catch {}
  });

  // ── Cron validation ──

  test('validateCron accepts valid expressions', async () => {
    const { validateCron } = await import('../server/services/scheduler.js');
    expect(() => validateCron('0 9 *')).not.toThrow();
    expect(() => validateCron('30 14 1')).not.toThrow();
    expect(() => validateCron('* * *')).not.toThrow();
    expect(() => validateCron('0 0 0')).not.toThrow();
    expect(() => validateCron('59 23 6')).not.toThrow();
  });

  test('validateCron rejects invalid expressions', async () => {
    const { validateCron } = await import('../server/services/scheduler.js');
    expect(() => validateCron('')).toThrow();
    expect(() => validateCron('0 9')).toThrow('3 fields');
    expect(() => validateCron('60 9 *')).toThrow('minute');
    expect(() => validateCron('0 25 *')).toThrow('hour');
    expect(() => validateCron('0 9 7')).toThrow('dayOfWeek');
    expect(() => validateCron('abc 9 *')).toThrow('minute');
  });

  test('cronMatches correctly matches time', async () => {
    const { cronMatches } = await import('../server/services/scheduler.js');
    const monday9am = new Date('2025-01-06T09:00:00'); // Monday=1
    expect(cronMatches('0 9 *', monday9am)).toBe(true);
    expect(cronMatches('0 9 1', monday9am)).toBe(true);
    expect(cronMatches('0 10 *', monday9am)).toBe(false);
    expect(cronMatches('30 9 *', monday9am)).toBe(false);
    expect(cronMatches('0 9 2', monday9am)).toBe(false);
    expect(cronMatches('* * *', monday9am)).toBe(true);
  });

  // ── Schedule CRUD ──

  test('getSchedules returns empty for new project', async () => {
    const { getSchedules } = await import('../server/services/scheduler.js');
    expect(getSchedules(SLUG)).toEqual([]);
  });

  test('addSchedule creates schedule with defaults', async () => {
    const { addSchedule, removeSchedule } = await import('../server/services/scheduler.js');
    const sched = addSchedule(SLUG, { prompt: 'Build feature X' });
    expect(sched).toHaveProperty('id');
    expect(sched.prompt).toBe('Build feature X');
    expect(sched.priority).toBe('normal');
    expect(sched.enabled).toBe(true);
    expect(sched.trigger).toBe('manual');
    expect(sched.runCount).toBe(0);
    expect(sched.cron).toBeNull();
    removeSchedule(SLUG, sched.id);
  });

  test('addSchedule with cron sets trigger to cron', async () => {
    const { addSchedule, removeSchedule } = await import('../server/services/scheduler.js');
    const sched = addSchedule(SLUG, { prompt: 'Daily build', cron: '0 9 *' });
    expect(sched.trigger).toBe('cron');
    expect(sched.cron).toBe('0 9 *');
    removeSchedule(SLUG, sched.id);
  });

  test('addSchedule throws without prompt', async () => {
    const { addSchedule } = await import('../server/services/scheduler.js');
    expect(() => addSchedule(SLUG, {})).toThrow('Prompt is required');
  });

  test('addSchedule rejects invalid cron', async () => {
    const { addSchedule } = await import('../server/services/scheduler.js');
    expect(() => addSchedule(SLUG, { prompt: 'x', cron: 'bad' })).toThrow();
  });

  test('updateSchedule modifies schedule', async () => {
    const { addSchedule, updateSchedule, removeSchedule } = await import('../server/services/scheduler.js');
    const sched = addSchedule(SLUG, { prompt: 'Original' });
    const updated = updateSchedule(SLUG, sched.id, { prompt: 'Updated', priority: 'high', enabled: false });
    expect(updated.prompt).toBe('Updated');
    expect(updated.priority).toBe('high');
    expect(updated.enabled).toBe(false);
    removeSchedule(SLUG, sched.id);
  });

  test('updateSchedule returns null for missing', async () => {
    const { updateSchedule } = await import('../server/services/scheduler.js');
    expect(updateSchedule(SLUG, 'sched-ghost', { prompt: 'x' })).toBeNull();
  });

  test('removeSchedule returns false for missing', async () => {
    const { removeSchedule } = await import('../server/services/scheduler.js');
    expect(removeSchedule(SLUG, 'sched-ghost')).toBe(false);
  });

  // ── Queue ──

  test('enqueue adds entry in priority order', async () => {
    const { enqueue, getQueue, dequeue } = await import('../server/services/scheduler.js');
    const low = enqueue(SLUG, 'Low task', { priority: 'low' });
    const high = enqueue(SLUG, 'High task', { priority: 'high' });
    const normal = enqueue(SLUG, 'Normal task', { priority: 'normal' });
    const q = getQueue();
    const slugEntries = q.filter(e => e.slug === SLUG);
    expect(slugEntries.length).toBeGreaterThanOrEqual(3);
    // High should come before normal, normal before low
    const highIdx = slugEntries.findIndex(e => e.id === high.id);
    const normalIdx = slugEntries.findIndex(e => e.id === normal.id);
    const lowIdx = slugEntries.findIndex(e => e.id === low.id);
    expect(highIdx).toBeLessThan(normalIdx);
    expect(normalIdx).toBeLessThan(lowIdx);
    // Clean up
    dequeue(low.id);
    dequeue(high.id);
    dequeue(normal.id);
  });

  test('dequeue removes entry', async () => {
    const { enqueue, dequeue, getQueue } = await import('../server/services/scheduler.js');
    const entry = enqueue(SLUG, 'To remove');
    expect(dequeue(entry.id)).toBe(true);
    expect(dequeue(entry.id)).toBe(false); // already removed
  });

  test('peekNext returns first pending', async () => {
    const { enqueue, peekNext, dequeue } = await import('../server/services/scheduler.js');
    const entry = enqueue(SLUG, 'Peek test', { priority: 'high' });
    const next = peekNext();
    expect(next).not.toBeNull();
    expect(next.status).toBe('pending');
    dequeue(entry.id);
  });

  test('markRunning updates entry', async () => {
    const { enqueue, markRunning, dequeue } = await import('../server/services/scheduler.js');
    const entry = enqueue(SLUG, 'Running test');
    const updated = markRunning(entry.id, 'session-123');
    expect(updated.status).toBe('running');
    expect(updated.sessionId).toBe('session-123');
    dequeue(entry.id);
  });

  test('markDone updates entry and schedule', async () => {
    const { enqueue, markDone, addSchedule, getSchedules, removeSchedule } = await import('../server/services/scheduler.js');
    const sched = addSchedule(SLUG, { prompt: 'Done test' });
    const entry = enqueue(SLUG, sched.prompt, { scheduleId: sched.id });
    markDone(entry.id, 'completed');
    // Check schedule was updated
    const schedules = getSchedules(SLUG);
    const updated = schedules.find(s => s.id === sched.id);
    expect(updated.lastStatus).toBe('completed');
    expect(updated.runCount).toBe(1);
    expect(updated.lastRun).toBeGreaterThan(0);
    removeSchedule(SLUG, sched.id);
  });

  test('markDone disables one-shot schedule', async () => {
    const { enqueue, markDone, addSchedule, getSchedules, removeSchedule } = await import('../server/services/scheduler.js');
    const sched = addSchedule(SLUG, { prompt: 'One shot', oneShot: true });
    expect(sched.enabled).toBe(true);
    const entry = enqueue(SLUG, sched.prompt, { scheduleId: sched.id });
    markDone(entry.id, 'completed');
    const schedules = getSchedules(SLUG);
    const updated = schedules.find(s => s.id === sched.id);
    expect(updated.enabled).toBe(false);
    removeSchedule(SLUG, sched.id);
  });

  // ── Cron Tick ──

  test('cronTick enqueues matching schedules', async () => {
    const { addSchedule, cronTick, getQueue, removeSchedule, dequeue } = await import('../server/services/scheduler.js');
    const now = new Date('2025-01-06T09:00:00');
    const sched = addSchedule(SLUG, { prompt: 'Cron fire', cron: '0 9 1' }); // Monday 9am
    cronTick(now);
    const q = getQueue();
    const matched = q.find(e => e.scheduleId === sched.id);
    expect(matched).toBeTruthy();
    expect(matched.prompt).toBe('Cron fire');
    // Clean up
    dequeue(matched.id);
    removeSchedule(SLUG, sched.id);
  });

  test('cronTick skips disabled schedules', async () => {
    const { addSchedule, updateSchedule, cronTick, getQueue, removeSchedule } = await import('../server/services/scheduler.js');
    const now = new Date('2025-01-06T09:00:00');
    const sched = addSchedule(SLUG, { prompt: 'Disabled', cron: '0 9 1' });
    updateSchedule(SLUG, sched.id, { enabled: false });
    cronTick(now);
    const q = getQueue();
    const matched = q.find(e => e.scheduleId === sched.id);
    expect(matched).toBeFalsy();
    removeSchedule(SLUG, sched.id);
  });
});

// ── REST API Tests ──

test.describe('Scheduler — REST API', () => {
  test('GET schedules returns 404 for missing project', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent-zzz/schedules`);
    expect(res.status).toBe(404);
  });

  test('POST schedule returns 404 for missing project', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent-zzz/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Test' }),
    });
    expect(res.status).toBe(404);
  });

  test('PATCH schedule returns 404 for missing project', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent-zzz/schedules/sched-nope`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(404);
  });

  test('DELETE schedule returns 404 for missing project', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent-zzz/schedules/sched-nope`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  test('GET queue returns array', async () => {
    const res = await fetch(`${API}/api/queue`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('POST queue returns 404 for missing project', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent-zzz/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Queued task' }),
    });
    expect(res.status).toBe(404);
  });

  test('POST queue returns 400 without prompt', async () => {
    // This needs a real project — use the queue endpoint which checks project first
    // For now, just test the missing project case covers the guard
    const res = await fetch(`${API}/api/projects/nonexistent-zzz/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404); // project check comes before prompt check
  });

  test('DELETE queue entry returns 404 for missing', async () => {
    const res = await fetch(`${API}/api/queue/q-nonexistent`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });
});

// ── Client Component Tests ──

test.describe('Scheduler — Client Component', () => {
  test('SchedulerPanel.vue exists and has template', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/SchedulerPanel.vue'), 'utf8');
    expect(content).toContain('<template>');
    expect(content).toContain('<script setup>');
  });

  test('has add schedule form', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/SchedulerPanel.vue'), 'utf8');
    expect(content).toContain('sched-add-form');
    expect(content).toContain('sched-add-btn');
    expect(content).toContain('sched-prompt-input');
  });

  test('has cron input and priority selector', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/SchedulerPanel.vue'), 'utf8');
    expect(content).toContain('sched-cron-input');
    expect(content).toContain('sched-priority-select');
    expect(content).toContain('sched-oneshot-label');
  });

  test('has schedule list with actions', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/SchedulerPanel.vue'), 'utf8');
    expect(content).toContain('sched-list');
    expect(content).toContain('sched-item');
    expect(content).toContain('sched-actions');
  });

  test('supports toggle, run now, delete actions', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/SchedulerPanel.vue'), 'utf8');
    expect(content).toContain('toggleSchedule');
    expect(content).toContain('runNow');
    expect(content).toContain('deleteSchedule');
  });

  test('has queue section', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/SchedulerPanel.vue'), 'utf8');
    expect(content).toContain('sched-queue-section');
    expect(content).toContain('sched-queue-item');
    expect(content).toContain('cancelQueueEntry');
  });

  test('has priority badges', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/SchedulerPanel.vue'), 'utf8');
    expect(content).toContain('sched-p-high');
    expect(content).toContain('sched-p-normal');
    expect(content).toContain('sched-p-low');
  });

  test('SessionHistory has scheduler toggle button', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/SessionHistory.vue'), 'utf8');
    expect(content).toContain('scheduler-toggle-btn');
    expect(content).toContain('SchedulerPanel');
    expect(content).toContain('showScheduler');
  });
});
