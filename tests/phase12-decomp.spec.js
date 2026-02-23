// @ts-check
import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';
const PROJ = 'test-decomp-' + Date.now();
let slug;

test.describe.serial('Phase 12.3 — Smart Decomposition', () => {

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API}/projects`, { data: { name: PROJ } });
    expect(res.status()).toBe(201);
    slug = (await res.json()).slug;
  });

  // ── Complexity Estimation ───────────────────────────────────────────────

  test('estimate trivial complexity', async ({ request }) => {
    const r = await request.post(`${API}/estimate-complexity`, {
      data: { description: 'Fix a bug' },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.level).toBe('trivial');
    expect(body.score).toBeGreaterThanOrEqual(0);
    expect(body).toHaveProperty('signals');
    expect(body).toHaveProperty('reasoning');
  });

  test('estimate complex task', async ({ request }) => {
    const r = await request.post(`${API}/estimate-complexity`, {
      data: { description: 'Refactor the database schema and migrate all data, then redesign the authentication architecture for performance optimization and security hardening with infrastructure deploy' },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(['complex', 'epic']).toContain(body.level);
    expect(body.score).toBeGreaterThan(10);
    expect(body.signals.length).toBeGreaterThan(3);
  });

  test('estimate complexity missing description → 400', async ({ request }) => {
    const r = await request.post(`${API}/estimate-complexity`, { data: {} });
    expect(r.status()).toBe(400);
  });

  // ── Decomposition ──────────────────────────────────────────────────────

  let decId, subtaskIds;

  test('decompose a complex task', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/decompositions`, {
      data: {
        name: 'Build user auth',
        description: 'Implement user authentication with OAuth2. Add database models. Create API endpoints. Write integration tests.',
      },
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('Build user auth');
    expect(body).toHaveProperty('complexity');
    expect(body).toHaveProperty('subtasks');
    expect(body.subtasks.length).toBeGreaterThanOrEqual(2);
    expect(body).toHaveProperty('executionMode');
    expect(body).toHaveProperty('totalWeight');
    expect(body).toHaveProperty('estimatedParallelism');
    decId = body.id;
    subtaskIds = body.subtasks.map(st => st.id);
  });

  test('decompose with hints', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/decompositions`, {
      data: {
        name: 'Deploy pipeline',
        description: 'Set up CI/CD pipeline',
        hints: ['Create Dockerfile', 'Set up GitHub Actions', 'Configure deploy scripts'],
      },
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.subtasks.length).toBe(3);
    expect(body.subtasks[0].name).toBe('Create Dockerfile');
  });

  test('decompose missing name → 400', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/decompositions`, {
      data: { description: 'something' },
    });
    expect(r.status()).toBe(400);
  });

  test('decompose missing description → 400', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/decompositions`, {
      data: { name: 'test' },
    });
    expect(r.status()).toBe(400);
  });

  // ── List and Get ────────────────────────────────────────────────────────

  test('list decompositions', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/decompositions`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.length).toBe(2);
  });

  test('get single decomposition', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/decompositions/${decId}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.name).toBe('Build user auth');
  });

  test('get non-existent decomposition → 404', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/decompositions/nope-999`);
    expect(r.status()).toBe(404);
  });

  // ── Sub-task Merging ──────────────────────────────────────────────────

  test('merge two sub-tasks', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/decompositions/${decId}/merge`, {
      data: { subtask1Id: subtaskIds[0], subtask2Id: subtaskIds[1], mergedName: 'Combined task' },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    // Should have one fewer subtask
    expect(body.subtasks.length).toBe(subtaskIds.length - 1);
    const merged = body.subtasks.find(st => st.name === 'Combined task');
    expect(merged).toBeTruthy();
    expect(merged.mergedFrom).toContain(subtaskIds[0]);
    expect(merged.mergedFrom).toContain(subtaskIds[1]);
  });

  test('merge with invalid subtask IDs → 404', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/decompositions/${decId}/merge`, {
      data: { subtask1Id: 'nope1', subtask2Id: 'nope2' },
    });
    expect(r.status()).toBe(404);
  });

  test('merge missing IDs → 400', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/decompositions/${decId}/merge`, {
      data: {},
    });
    expect(r.status()).toBe(400);
  });

  // ── Stats ─────────────────────────────────────────────────────────────

  test('get decomposition stats', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/decomposition-stats`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.totalDecompositions).toBe(2);
    expect(body.totalSubtasks).toBeGreaterThanOrEqual(4);
    expect(body).toHaveProperty('totalWeight');
    expect(body).toHaveProperty('complexityCounts');
    expect(body).toHaveProperty('avgSubtasksPerDecomposition');
  });

  // ── Delete ────────────────────────────────────────────────────────────

  test('delete decomposition', async ({ request }) => {
    const r = await request.delete(`${API}/projects/${slug}/decompositions/${decId}`);
    expect(r.status()).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });

  test('delete non-existent decomposition → 404', async ({ request }) => {
    const r = await request.delete(`${API}/projects/${slug}/decompositions/nope-999`);
    expect(r.status()).toBe(404);
  });

  // ── 404 guards ──────────────────────────────────────────────────────────

  test('decompositions on non-existent project → 404', async ({ request }) => {
    const r = await request.get(`${API}/projects/nonexistent-zzz/decompositions`);
    expect(r.status()).toBe(404);
  });

  // ── Meta ────────────────────────────────────────────────────────────────

  test('GET /complexity-levels returns valid list', async ({ request }) => {
    const r = await request.get(`${API}/complexity-levels`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toContain('trivial');
    expect(body).toContain('complex');
    expect(body).toContain('epic');
  });
});
