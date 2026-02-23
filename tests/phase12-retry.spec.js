// @ts-check
import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';
const PROJ = 'test-retry-' + Date.now();
let slug;

test.describe.serial('Phase 12.1 — Auto-Retry & Recovery', () => {

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API}/projects`, { data: { name: PROJ } });
    expect(res.status()).toBe(201);
    slug = (await res.json()).slug;
  });

  // ── Retry Policy CRUD ───────────────────────────────────────────────────

  let policyId;

  test('create retry policy with defaults', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/retry-policies`, {
      data: { name: 'Default Retry' },
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.name).toBe('Default Retry');
    expect(body.strategy).toBe('exponential');
    expect(body.maxRetries).toBe(3);
    expect(body.delayMs).toBe(1000);
    expect(body.enabled).toBe(true);
    policyId = body.id;
  });

  test('create retry policy with custom strategy', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/retry-policies`, {
      data: { name: 'Linear Retry', strategy: 'linear', maxRetries: 5, delayMs: 500 },
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.strategy).toBe('linear');
    expect(body.maxRetries).toBe(5);
  });

  test('create policy without name → 400', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/retry-policies`, {
      data: { strategy: 'fixed' },
    });
    expect(r.status()).toBe(400);
  });

  test('list retry policies', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/retry-policies`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.length).toBe(2);
  });

  test('get single retry policy', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/retry-policies/${policyId}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.name).toBe('Default Retry');
  });

  test('get non-existent policy → 404', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/retry-policies/nope-999`);
    expect(r.status()).toBe(404);
  });

  test('update retry policy', async ({ request }) => {
    const r = await request.patch(`${API}/projects/${slug}/retry-policies/${policyId}`, {
      data: { maxRetries: 10, enabled: false },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.maxRetries).toBe(10);
    expect(body.enabled).toBe(false);
  });

  test('re-enable policy for further tests', async ({ request }) => {
    const r = await request.patch(`${API}/projects/${slug}/retry-policies/${policyId}`, {
      data: { enabled: true, maxRetries: 3 },
    });
    expect(r.status()).toBe(200);
  });

  // ── Retry Check ─────────────────────────────────────────────────────────

  test('should-retry returns true for first attempt', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/retry-check`, {
      data: { policyId, attempt: 0 },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.shouldRetry).toBe(true);
    expect(body.delay).toBeGreaterThan(0);
  });

  test('should-retry returns false when max exceeded', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/retry-check`, {
      data: { policyId, attempt: 10 },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.shouldRetry).toBe(false);
    expect(body.reason).toContain('Max retries');
  });

  test('retry-check missing policyId → 400', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/retry-check`, {
      data: { attempt: 0 },
    });
    expect(r.status()).toBe(400);
  });

  // ── Retry Log ───────────────────────────────────────────────────────────

  test('record a retry attempt', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/retry-log`, {
      data: { policyId, taskId: 'task-1', attempt: 0, errorType: 'timeout', outcome: 'retry', delay: 1000 },
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.policyId).toBe(policyId);
    expect(body.outcome).toBe('retry');
  });

  test('record success outcome', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/retry-log`, {
      data: { policyId, taskId: 'task-1', attempt: 1, outcome: 'success' },
    });
    expect(r.status()).toBe(201);
  });

  test('get retry log', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/retry-log`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);
  });

  test('filter retry log by policyId', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/retry-log?policyId=${policyId}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    for (const entry of body) {
      expect(entry.policyId).toBe(policyId);
    }
  });

  // ── Circuit Breaker ─────────────────────────────────────────────────────

  test('get circuit breaker state (default closed)', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/circuit-breakers/${policyId}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.state).toBe('closed');
    expect(body.policyId).toBe(policyId);
  });

  test('list all circuit breakers', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/circuit-breakers`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2); // 2 policies
  });

  test('reset circuit breaker', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/circuit-breakers/${policyId}/reset`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.state).toBe('closed');
    expect(body.failureCount).toBe(0);
  });

  // ── Retry Stats ─────────────────────────────────────────────────────────

  test('get retry stats', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/retry-stats`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty('totalRetries');
    expect(body).toHaveProperty('recentRetries');
    expect(body).toHaveProperty('outcomeCounts');
    expect(body).toHaveProperty('activePolicies');
    expect(body).toHaveProperty('circuitBreakers');
    expect(body.totalRetries).toBeGreaterThanOrEqual(2);
  });

  // ── Delete policy ───────────────────────────────────────────────────────

  test('delete retry policy', async ({ request }) => {
    const r = await request.delete(`${API}/projects/${slug}/retry-policies/${policyId}`);
    expect(r.status()).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });

  test('delete non-existent policy → 404', async ({ request }) => {
    const r = await request.delete(`${API}/projects/${slug}/retry-policies/nope-999`);
    expect(r.status()).toBe(404);
  });

  // ── 404 guards ──────────────────────────────────────────────────────────

  test('retry-policies on non-existent project → 404', async ({ request }) => {
    const r = await request.get(`${API}/projects/nonexistent-zzz/retry-policies`);
    expect(r.status()).toBe(404);
  });

  // ── Meta ────────────────────────────────────────────────────────────────

  test('GET /retry-strategies returns valid list', async ({ request }) => {
    const r = await request.get(`${API}/retry-strategies`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toContain('fixed');
    expect(body).toContain('linear');
    expect(body).toContain('exponential');
  });
});
