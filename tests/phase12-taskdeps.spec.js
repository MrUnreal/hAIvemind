// @ts-check
import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';
const PROJ = 'test-taskdeps-' + Date.now();
let slug;

test.describe.serial('Phase 12.0 — Task Dependencies & Priority', () => {

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API}/projects`, { data: { name: PROJ } });
    expect(res.status()).toBe(201);
    slug = (await res.json()).slug;
  });

  // ── Task CRUD ───────────────────────────────────────────────────────────

  let taskA, taskB, taskC;

  test('create task with default priority', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/tasks`, {
      data: { name: 'Setup database' },
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.name).toBe('Setup database');
    expect(body.priority).toBe('medium');
    expect(body.status).toBe('pending');
    expect(body.id).toBeTruthy();
    taskA = body;
  });

  test('create task with explicit priority', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/tasks`, {
      data: { name: 'Deploy service', priority: 'critical' },
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.priority).toBe('critical');
    taskB = body;
  });

  test('create low-priority task', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/tasks`, {
      data: { name: 'Write docs', priority: 'low' },
    });
    expect(r.status()).toBe(201);
    taskC = await r.json();
  });

  test('create task without name → 400', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/tasks`, {
      data: { priority: 'high' },
    });
    expect(r.status()).toBe(400);
  });

  test('list tasks returns all', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/tasks`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(3);
  });

  test('get single task', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/tasks/${taskA.id}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.name).toBe('Setup database');
  });

  test('get non-existent task → 404', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/tasks/nope-999`);
    expect(r.status()).toBe(404);
  });

  test('update task priority', async ({ request }) => {
    const r = await request.patch(`${API}/projects/${slug}/tasks/${taskA.id}`, {
      data: { priority: 'high' },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.priority).toBe('high');
  });

  test('update task status', async ({ request }) => {
    const r = await request.patch(`${API}/projects/${slug}/tasks/${taskA.id}`, {
      data: { status: 'completed' },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('completed');
  });

  test('filter tasks by status', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/tasks?status=pending`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    for (const t of body) {
      expect(t.status).toBe('pending');
    }
  });

  test('filter tasks by priority', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/tasks?priority=critical`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    for (const t of body) {
      expect(t.priority).toBe('critical');
    }
    expect(body.length).toBe(1);
  });

  // ── Dependencies ────────────────────────────────────────────────────────

  let depId;

  test('add blocking dependency', async ({ request }) => {
    // taskB depends on taskA (taskA must complete before taskB)
    const r = await request.post(`${API}/projects/${slug}/dependencies`, {
      data: { from: taskA.id, to: taskB.id, type: 'blocking' },
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.from).toBe(taskA.id);
    expect(body.to).toBe(taskB.id);
    expect(body.type).toBe('blocking');
    depId = body.id;
  });

  test('add non-blocking dependency', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/dependencies`, {
      data: { from: taskA.id, to: taskC.id, type: 'non-blocking' },
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.type).toBe('non-blocking');
  });

  test('duplicate dependency → 400', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/dependencies`, {
      data: { from: taskA.id, to: taskB.id },
    });
    expect(r.status()).toBe(400);
  });

  test('self-dependency → 400', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/dependencies`, {
      data: { from: taskA.id, to: taskA.id },
    });
    expect(r.status()).toBe(400);
  });

  test('circular dependency → 400', async ({ request }) => {
    // taskA is completed, taskB depends on taskA. If we try taskA depends on taskB → cycle
    const r = await request.post(`${API}/projects/${slug}/dependencies`, {
      data: { from: taskB.id, to: taskA.id },
    });
    expect(r.status()).toBe(400);
    const body = await r.json();
    expect(body.error).toContain('circular');
  });

  test('list dependencies', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/dependencies`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
  });

  // ── Schedule & Analysis ─────────────────────────────────────────────────

  test('get schedule returns categorized tasks', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/schedule`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty('ready');
    expect(body).toHaveProperty('blocked');
    expect(body).toHaveProperty('active');
    expect(body).toHaveProperty('done');
    expect(body).toHaveProperty('totalCount');
    // taskA is completed → in done. taskB depends on taskA (completed) → ready
    expect(body.done.length).toBeGreaterThanOrEqual(1);
  });

  test('schedule: taskB is ready (blocking dep completed)', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/schedule`);
    const body = await r.json();
    const readyIds = body.ready.map(t => t.id);
    // taskB depends on taskA which is completed → taskB should be ready
    expect(readyIds).toContain(taskB.id);
  });

  test('get critical path', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/critical-path`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    // Critical path: taskA → taskB (blocking chain)
    if (body.length > 0) {
      expect(body).toContain(taskA.id);
      expect(body).toContain(taskB.id);
    }
  });

  test('get dependency stats', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/dependency-stats`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.totalTasks).toBe(3);
    expect(body.totalEdges).toBe(2);
    expect(body.blockingEdges).toBe(1);
    expect(body.nonBlockingEdges).toBe(1);
    expect(body).toHaveProperty('statusCounts');
    expect(body).toHaveProperty('priorityCounts');
  });

  // ── Remove dependency ───────────────────────────────────────────────────

  test('remove dependency', async ({ request }) => {
    const r = await request.delete(`${API}/projects/${slug}/dependencies/${depId}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
  });

  test('remove non-existent dependency → 404', async ({ request }) => {
    const r = await request.delete(`${API}/projects/${slug}/dependencies/nope-999`);
    expect(r.status()).toBe(404);
  });

  // ── Delete task ─────────────────────────────────────────────────────────

  test('delete task removes it and its edges', async ({ request }) => {
    const r = await request.delete(`${API}/projects/${slug}/tasks/${taskC.id}`);
    expect(r.status()).toBe(200);
    // Verify gone
    const r2 = await request.get(`${API}/projects/${slug}/tasks`);
    const tasks = await r2.json();
    expect(tasks.find(t => t.id === taskC.id)).toBeFalsy();
  });

  test('delete non-existent task → 404', async ({ request }) => {
    const r = await request.delete(`${API}/projects/${slug}/tasks/nope-999`);
    expect(r.status()).toBe(404);
  });

  // ── 404 guards ──────────────────────────────────────────────────────────

  test('tasks on non-existent project → 404', async ({ request }) => {
    const r = await request.get(`${API}/projects/nonexistent-zzz/tasks`);
    expect(r.status()).toBe(404);
  });

  test('schedule on non-existent project → 404', async ({ request }) => {
    const r = await request.get(`${API}/projects/nonexistent-zzz/schedule`);
    expect(r.status()).toBe(404);
  });

  // ── Meta endpoints ─────────────────────────────────────────────────────

  test('GET /priority-levels returns valid list', async ({ request }) => {
    const r = await request.get(`${API}/priority-levels`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toContain('critical');
    expect(body).toContain('high');
    expect(body).toContain('medium');
    expect(body).toContain('low');
  });

  test('GET /task-statuses returns valid list', async ({ request }) => {
    const r = await request.get(`${API}/task-statuses`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toContain('pending');
    expect(body).toContain('completed');
  });
});
