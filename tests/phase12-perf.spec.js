// @ts-check
import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';
const PROJ = 'test-perf-' + Date.now();
let slug;

test.describe.serial('Phase 12.2 — Performance Profiling', () => {

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API}/projects`, { data: { name: PROJ } });
    expect(res.status()).toBe(201);
    slug = (await res.json()).slug;
  });

  // ── Record metrics ──────────────────────────────────────────────────────

  test('record a performance metric', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/metrics`, {
      data: { name: 'db-query', type: 'task', durationMs: 120, success: true },
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.name).toBe('db-query');
    expect(body.durationMs).toBe(120);
    expect(body.type).toBe('task');
  });

  test('record multiple metrics for percentiles', async ({ request }) => {
    const durations = [50, 80, 100, 150, 200, 300, 500, 800, 1000, 2000, 5000, 10000];
    for (const d of durations) {
      const r = await request.post(`${API}/projects/${slug}/metrics`, {
        data: { name: 'api-call', type: 'api', durationMs: d },
      });
      expect(r.status()).toBe(201);
    }
  });

  test('record metric without name → 400', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/metrics`, {
      data: { durationMs: 100 },
    });
    expect(r.status()).toBe(400);
  });

  test('record metric without durationMs → 400', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/metrics`, {
      data: { name: 'test' },
    });
    expect(r.status()).toBe(400);
  });

  // ── List and get metrics ────────────────────────────────────────────────

  test('list all metrics', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/metrics`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.length).toBeGreaterThanOrEqual(13);
  });

  test('filter metrics by name', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/metrics?name=db-query`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    for (const m of body) {
      expect(m.name).toBe('db-query');
    }
  });

  test('filter metrics by type', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/metrics?type=api`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    for (const m of body) {
      expect(m.type).toBe('api');
    }
  });

  test('list with limit', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/metrics?limit=3`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.length).toBeLessThanOrEqual(3);
  });

  // ── Percentiles ─────────────────────────────────────────────────────────

  test('get percentiles for an operation', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/percentiles/api-call`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty('p50');
    expect(body).toHaveProperty('p95');
    expect(body).toHaveProperty('p99');
    expect(body).toHaveProperty('min');
    expect(body).toHaveProperty('max');
    expect(body).toHaveProperty('avg');
    expect(body).toHaveProperty('count');
    expect(body.count).toBe(12);
    expect(body.min).toBe(50);
    expect(body.max).toBe(10000);
    expect(body.p50).toBeGreaterThan(0);
    // p95 should be high
    expect(body.p95).toBeGreaterThanOrEqual(5000);
  });

  test('percentiles for unknown operation returns zeros', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/percentiles/nonexistent-op`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.count).toBe(0);
    expect(body.p50).toBe(0);
  });

  // ── Bottleneck detection ────────────────────────────────────────────────

  test('detect bottlenecks', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/bottlenecks?thresholdMs=1000&minSamples=3`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    // api-call has P95 > 1000ms, so should appear
    const apiBottleneck = body.find(b => b.name === 'api-call');
    expect(apiBottleneck).toBeTruthy();
    expect(apiBottleneck.p95).toBeGreaterThanOrEqual(1000);
  });

  test('no bottlenecks with high threshold', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/bottlenecks?thresholdMs=99999`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.length).toBe(0);
  });

  // ── Trends ──────────────────────────────────────────────────────────────

  test('get performance trend', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/trend/api-call`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    // All metrics are recent, should be in one bucket
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]).toHaveProperty('bucketStart');
    expect(body[0]).toHaveProperty('avg');
    expect(body[0]).toHaveProperty('p95');
    expect(body[0]).toHaveProperty('count');
  });

  test('trend for unknown op returns empty', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/trend/nonexistent-op`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveLength(0);
  });

  // ── Summary ─────────────────────────────────────────────────────────────

  test('get performance summary', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/performance-summary`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.totalMetrics).toBeGreaterThanOrEqual(13);
    expect(body.totalDurationMs).toBeGreaterThan(0);
    expect(body).toHaveProperty('successRate');
    expect(body).toHaveProperty('typeCounts');
    expect(body).toHaveProperty('uniqueOperations');
    expect(body).toHaveProperty('slowestOperations');
    expect(body.slowestOperations.length).toBeGreaterThanOrEqual(1);
  });

  // ── Clear ───────────────────────────────────────────────────────────────

  test('clear all metrics', async ({ request }) => {
    const r = await request.delete(`${API}/projects/${slug}/metrics`);
    expect(r.status()).toBe(200);
    const after = await (await request.get(`${API}/projects/${slug}/metrics`)).json();
    expect(after).toHaveLength(0);
  });

  // ── 404 guards ──────────────────────────────────────────────────────────

  test('metrics on non-existent project → 404', async ({ request }) => {
    const r = await request.get(`${API}/projects/nonexistent-zzz/metrics`);
    expect(r.status()).toBe(404);
  });

  // ── Meta ────────────────────────────────────────────────────────────────

  test('GET /metric-types returns valid list', async ({ request }) => {
    const r = await request.get(`${API}/metric-types`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toContain('task');
    expect(body).toContain('api');
    expect(body).toContain('custom');
  });
});
