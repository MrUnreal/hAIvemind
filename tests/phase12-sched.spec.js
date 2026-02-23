// @ts-check
import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';
const PROJ = 'test-sched-' + Date.now();
let slug;

test.describe.serial('Phase 12.5 — Scheduled Tasks', () => {

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API}/projects`, { data: { name: PROJ } });
    expect(res.status()).toBe(201);
    slug = (await res.json()).slug;
  });

  // ── Create Schedules ──────────────────────────────────────────────────

  let schedId;

  test('create a daily schedule', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/scheduled-tasks`, {
      data: { name: 'Nightly build', task: 'run tests', repeatMode: 'daily', timezone: 'America/New_York' },
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('Nightly build');
    expect(body.task).toBe('run tests');
    expect(body.repeatMode).toBe('daily');
    expect(body.status).toBe('active');
    expect(body.timezone).toBe('America/New_York');
    expect(body.runCount).toBe(0);
    expect(body.nextRun).toBeTruthy();
    schedId = body.id;
  });

  test('create a one-time schedule', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/scheduled-tasks`, {
      data: { name: 'One-off deploy', task: 'deploy v2', repeatMode: 'once' },
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.repeatMode).toBe('once');
  });

  test('create schedule missing name → 400', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/scheduled-tasks`, {
      data: { task: 'something' },
    });
    expect(r.status()).toBe(400);
  });

  test('create schedule missing task → 400', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/scheduled-tasks`, {
      data: { name: 'No task' },
    });
    expect(r.status()).toBe(400);
  });

  // ── List / Get ────────────────────────────────────────────────────────

  test('list all schedules', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/scheduled-tasks`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);
  });

  test('filter schedules by status', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/scheduled-tasks?status=active`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.every(s => s.status === 'active')).toBe(true);
  });

  test('get single schedule', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/scheduled-tasks/${schedId}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.id).toBe(schedId);
    expect(body.name).toBe('Nightly build');
  });

  test('get non-existent schedule → 404', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/scheduled-tasks/no-such-id`);
    expect(r.status()).toBe(404);
  });

  // ── Update ────────────────────────────────────────────────────────────

  test('update schedule name and repeat mode', async ({ request }) => {
    const r = await request.patch(`${API}/projects/${slug}/scheduled-tasks/${schedId}`, {
      data: { name: 'Weekly build', repeatMode: 'weekly' },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.name).toBe('Weekly build');
    expect(body.repeatMode).toBe('weekly');
  });

  test('update non-existent schedule → 404', async ({ request }) => {
    const r = await request.patch(`${API}/projects/${slug}/scheduled-tasks/no-such-id`, {
      data: { name: 'nope' },
    });
    expect(r.status()).toBe(404);
  });

  // ── Pause / Resume ────────────────────────────────────────────────────

  test('pause a schedule', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/scheduled-tasks/${schedId}/pause`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('paused');
  });

  test('resume a paused schedule', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/scheduled-tasks/${schedId}/resume`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('active');
  });

  // ── Trigger Run ───────────────────────────────────────────────────────

  test('trigger a run increments runCount', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/scheduled-tasks/${schedId}/trigger`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.runCount).toBe(1);
    expect(body.lastRun).toBeTruthy();
    expect(body.nextRun).toBeTruthy();
  });

  test('trigger non-existent schedule → 404', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/scheduled-tasks/no-such-id/trigger`);
    expect(r.status()).toBe(404);
  });

  // ── Due Schedules ─────────────────────────────────────────────────────

  test('get due schedules returns array', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/scheduled-tasks-due`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
  });

  // ── Stats ─────────────────────────────────────────────────────────────

  test('get schedule stats', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/scheduled-task-stats`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('byStatus');
    expect(body).toHaveProperty('byMode');
    expect(body).toHaveProperty('totalRuns');
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.totalRuns).toBeGreaterThanOrEqual(1);
  });

  // ── Delete ────────────────────────────────────────────────────────────

  test('delete a schedule', async ({ request }) => {
    const r = await request.delete(`${API}/projects/${slug}/scheduled-tasks/${schedId}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.id).toBe(schedId);
  });

  test('delete non-existent schedule → 404', async ({ request }) => {
    const r = await request.delete(`${API}/projects/${slug}/scheduled-tasks/no-such-id`);
    expect(r.status()).toBe(404);
  });

  // ── Edge Cases & Meta ─────────────────────────────────────────────────

  test('schedules on non-existent project → 404', async ({ request }) => {
    const r = await request.get(`${API}/projects/nonexistent-zzz/scheduled-tasks`);
    expect(r.status()).toBe(404);
  });

  test('GET /schedule-statuses returns valid list', async ({ request }) => {
    const r = await request.get(`${API}/schedule-statuses`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toContain('active');
    expect(body).toContain('paused');
  });

  test('GET /repeat-modes returns valid list', async ({ request }) => {
    const r = await request.get(`${API}/repeat-modes`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toContain('daily');
    expect(body).toContain('cron');
    expect(body).toContain('once');
  });
});
