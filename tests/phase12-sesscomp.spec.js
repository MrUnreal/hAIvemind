// @ts-check
import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';
const PROJ = 'test-sesscomp-' + Date.now();
let slug;

// Mock session data for comparisons
const SESSION_A = {
  id: 'sess-a-001',
  duration: 30000,
  taskCount: 5,
  messageCount: 20,
  cost: 1.5,
  errorCount: 0,
};
const SESSION_B = {
  id: 'sess-b-002',
  duration: 60000,
  taskCount: 3,
  messageCount: 40,
  cost: 3.0,
  errorCount: 2,
};

test.describe.serial('Phase 12.4 — Session Comparison', () => {

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API}/projects`, { data: { name: PROJ } });
    expect(res.status()).toBe(201);
    slug = (await res.json()).slug;
  });

  // ── Compare Sessions ──────────────────────────────────────────────────

  let compId;

  test('compare two inline sessions', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/session-comparisons`, {
      data: { sessionA: SESSION_A, sessionB: SESSION_B, label: 'A/B test' },
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.id).toBeTruthy();
    expect(body.sessionIdA).toBe('sess-a-001');
    expect(body.sessionIdB).toBe('sess-b-002');
    expect(body.diff).toBeTruthy();
    expect(body.diff.categories).toBeTruthy();
    expect(body.diff.overall).toBeTruthy();
    expect(body.scoreA).toBeGreaterThanOrEqual(0);
    expect(body.scoreB).toBeGreaterThanOrEqual(0);
    expect(body.outcome).toBeTruthy();
    expect(body.label).toBe('A/B test');
    compId = body.id;
  });

  test('A wins more categories (fewer errors, lower cost, faster)', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/session-comparisons`, {
      data: { sessionA: SESSION_A, sessionB: SESSION_B },
    });
    const body = await r.json();
    // A: faster, more tasks, lower cost, fewer errors → A should win most categories
    expect(body.diff.categories.duration.winner).toBe('a');
    expect(body.diff.categories.tasks.winner).toBe('a');
    expect(body.diff.categories.cost.winner).toBe('a');
    expect(body.diff.categories.errors.winner).toBe('a');
    expect(body.outcome).toBe('a-better');
  });

  test('compare missing sessions → 400', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/session-comparisons`, {
      data: {},
    });
    expect(r.status()).toBe(400);
  });

  // ── Quick Diff ────────────────────────────────────────────────────────

  test('quick diff returns comparison without storing', async ({ request }) => {
    // First count existing comparisons
    const before = await request.get(`${API}/projects/${slug}/session-comparisons`);
    const countBefore = (await before.json()).length;

    const r = await request.post(`${API}/projects/${slug}/session-comparisons/quick-diff`, {
      data: { sessionA: SESSION_A, sessionB: SESSION_B },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.diff).toBeTruthy();
    expect(body.scoreA).toBeGreaterThanOrEqual(0);
    expect(body.scoreB).toBeGreaterThanOrEqual(0);

    // Should NOT have stored a new comparison
    const after = await request.get(`${API}/projects/${slug}/session-comparisons`);
    const countAfter = (await after.json()).length;
    expect(countAfter).toBe(countBefore);
  });

  test('quick diff missing data → 400', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/session-comparisons/quick-diff`, {
      data: {},
    });
    expect(r.status()).toBe(400);
  });

  // ── List / Get / Delete ───────────────────────────────────────────────

  test('list saved comparisons', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/session-comparisons`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  test('get single comparison by ID', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/session-comparisons/${compId}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.id).toBe(compId);
  });

  test('get non-existent comparison → 404', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/session-comparisons/no-such-id`);
    expect(r.status()).toBe(404);
  });

  test('delete comparison', async ({ request }) => {
    const r = await request.delete(`${API}/projects/${slug}/session-comparisons/${compId}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.id).toBe(compId);

    // Verify it's gone
    const r2 = await request.get(`${API}/projects/${slug}/session-comparisons/${compId}`);
    expect(r2.status()).toBe(404);
  });

  test('delete non-existent comparison → 404', async ({ request }) => {
    const r = await request.delete(`${API}/projects/${slug}/session-comparisons/no-such-id`);
    expect(r.status()).toBe(404);
  });

  // ── Session Scoring ───────────────────────────────────────────────────

  test('score session via inline comparison', async ({ request }) => {
    // Score is embedded in comparison result — use compare to check scores
    const r = await request.post(`${API}/projects/${slug}/session-comparisons`, {
      data: { sessionA: SESSION_A, sessionB: SESSION_B },
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    // SESSION_A has 5 tasks, 0 errors, low cost, fast → higher score
    expect(body.scoreA).toBeGreaterThan(body.scoreB);
  });

  // ── Comparison Stats ──────────────────────────────────────────────────

  test('get comparison stats', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/session-comparison-stats`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('outcomes');
    expect(body).toHaveProperty('avgScoreA');
    expect(body).toHaveProperty('avgScoreB');
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  // ── Edge Cases & Meta ─────────────────────────────────────────────────

  test('comparisons on non-existent project → 404', async ({ request }) => {
    const r = await request.get(`${API}/projects/nonexistent-zzz/session-comparisons`);
    expect(r.status()).toBe(404);
  });

  test('GET /comparison-outcomes returns valid list', async ({ request }) => {
    const r = await request.get(`${API}/comparison-outcomes`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toContain('a-better');
    expect(body).toContain('b-better');
    expect(body).toContain('tie');
  });

  test('GET /diff-categories returns valid list', async ({ request }) => {
    const r = await request.get(`${API}/diff-categories`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toContain('duration');
    expect(body).toContain('cost');
    expect(body).toContain('errors');
  });

  // ── Tie scenario ──────────────────────────────────────────────────────

  test('comparing identical sessions produces tie', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/session-comparisons`, {
      data: { sessionA: SESSION_A, sessionB: SESSION_A },
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.outcome).toBe('tie');
    expect(body.scoreA).toBe(body.scoreB);
  });
});
