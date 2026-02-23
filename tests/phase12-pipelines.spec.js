// @ts-check
import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';
const PROJ = 'test-pipelines-' + Date.now();
let slug;

test.describe.serial('Phase 12.6 — Custom Pipelines', () => {

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API}/projects`, { data: { name: PROJ } });
    expect(res.status()).toBe(201);
    slug = (await res.json()).slug;
  });

  // ── Create Pipelines ──────────────────────────────────────────────────

  let pipeId, approvalStepId;

  test('create a 3-step pipeline', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/pipelines`, {
      data: {
        name: 'Build & Deploy',
        description: 'CI/CD pipeline',
        steps: [
          { name: 'Build', type: 'task', config: { cmd: 'npm run build' } },
          { name: 'Review', type: 'approval' },
          { name: 'Deploy', type: 'task', config: { cmd: 'npm run deploy' } },
        ],
      },
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('Build & Deploy');
    expect(body.steps).toHaveLength(3);
    expect(body.steps[0].type).toBe('task');
    expect(body.steps[1].type).toBe('approval');
    expect(body.status).toBe('draft');
    pipeId = body.id;
    approvalStepId = body.steps[1].id;
  });

  test('create pipeline missing name → 400', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/pipelines`, {
      data: { steps: [{ name: 'X', type: 'task' }] },
    });
    expect(r.status()).toBe(400);
  });

  test('create pipeline missing steps → 400', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/pipelines`, {
      data: { name: 'No steps' },
    });
    expect(r.status()).toBe(400);
  });

  // ── List / Get ────────────────────────────────────────────────────────

  test('list pipelines', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/pipelines`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  test('get single pipeline', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/pipelines/${pipeId}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.id).toBe(pipeId);
  });

  test('get non-existent pipeline → 404', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/pipelines/no-such-id`);
    expect(r.status()).toBe(404);
  });

  // ── Pipeline Execution Flow ───────────────────────────────────────────

  test('start a pipeline', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/pipelines/${pipeId}/start`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('running');
    expect(body.steps[0].status).toBe('running');
    expect(body.currentStep).toBe(0);
  });

  test('advance pipeline — complete step 0, step 1 is approval gate', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/pipelines/${pipeId}/advance`, {
      data: { result: 'Build succeeded' },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.steps[0].status).toBe('completed');
    expect(body.steps[1].status).toBe('waiting-approval');
    expect(body.currentStep).toBe(1);
  });

  test('approve a step', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/pipelines/${pipeId}/approve/${approvalStepId}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.steps[1].status).toBe('running');
  });

  test('advance past approval step, deploy step starts', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/pipelines/${pipeId}/advance`, {
      data: { result: 'Review approved' },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.steps[1].status).toBe('completed');
    expect(body.steps[2].status).toBe('running');
    expect(body.currentStep).toBe(2);
  });

  test('advance final step — pipeline completes', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/pipelines/${pipeId}/advance`, {
      data: { result: 'Deployed successfully' },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('completed');
    expect(body.steps[2].status).toBe('completed');
    expect(body.completedAt).toBeTruthy();
  });

  // ── Cancel Flow ───────────────────────────────────────────────────────

  let cancelPipeId;

  test('create and cancel a pipeline', async ({ request }) => {
    // Create
    const c = await request.post(`${API}/projects/${slug}/pipelines`, {
      data: { name: 'Cancel test', steps: [{ name: 'A', type: 'task' }, { name: 'B', type: 'task' }] },
    });
    cancelPipeId = (await c.json()).id;

    // Start
    await request.post(`${API}/projects/${slug}/pipelines/${cancelPipeId}/start`);

    // Cancel
    const r = await request.post(`${API}/projects/${slug}/pipelines/${cancelPipeId}/cancel`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('cancelled');
    // Pending/running steps should be skipped
    expect(body.steps.filter(s => s.status === 'skipped').length).toBeGreaterThanOrEqual(1);
  });

  // ── Failure Flow ──────────────────────────────────────────────────────

  test('advance with failure stops pipeline', async ({ request }) => {
    const c = await request.post(`${API}/projects/${slug}/pipelines`, {
      data: { name: 'Fail test', steps: [{ name: 'A', type: 'task' }, { name: 'B', type: 'task' }] },
    });
    const failPipeId = (await c.json()).id;
    await request.post(`${API}/projects/${slug}/pipelines/${failPipeId}/start`);

    const r = await request.post(`${API}/projects/${slug}/pipelines/${failPipeId}/advance`, {
      data: { failed: true, result: 'Build error' },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('failed');
    expect(body.steps[0].status).toBe('failed');
  });

  // ── Stats ─────────────────────────────────────────────────────────────

  test('get pipeline stats', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/pipeline-stats`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('byStatus');
    expect(body).toHaveProperty('totalSteps');
    expect(body).toHaveProperty('completedSteps');
    expect(body.total).toBeGreaterThanOrEqual(3);
  });

  // ── Delete ────────────────────────────────────────────────────────────

  test('delete a pipeline', async ({ request }) => {
    const r = await request.delete(`${API}/projects/${slug}/pipelines/${pipeId}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.id).toBe(pipeId);
  });

  test('delete non-existent pipeline → 404', async ({ request }) => {
    const r = await request.delete(`${API}/projects/${slug}/pipelines/no-such-id`);
    expect(r.status()).toBe(404);
  });

  // ── Edge Cases & Meta ─────────────────────────────────────────────────

  test('pipelines on non-existent project → 404', async ({ request }) => {
    const r = await request.get(`${API}/projects/nonexistent-zzz/pipelines`);
    expect(r.status()).toBe(404);
  });

  test('GET /step-types returns valid list', async ({ request }) => {
    const r = await request.get(`${API}/step-types`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toContain('task');
    expect(body).toContain('approval');
    expect(body).toContain('condition');
  });

  test('GET /pipeline-statuses returns valid list', async ({ request }) => {
    const r = await request.get(`${API}/pipeline-statuses`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toContain('draft');
    expect(body).toContain('running');
    expect(body).toContain('completed');
  });
});
