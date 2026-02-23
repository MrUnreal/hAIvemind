/**
 * Phase 10.8 — Health Dashboard Tests
 *
 * Tests for health monitoring service (uptime, latency, errors,
 * backend health, score, thresholds), REST endpoints.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, existsSync, rmSync } from 'fs';

const API = 'http://localhost:3000/api';
const TEST_DIR = '.haivemind-workspace';

let WorkspaceManager, refs, health;

test.beforeAll(async () => {
  const wsModule = await import('../server/workspace.js');
  WorkspaceManager = wsModule.default;
  const stateModule = await import('../server/state.js');
  refs = stateModule.refs;
  health = await import('../server/services/healthDashboard.js');

  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  const wm = new WorkspaceManager(TEST_DIR);
  refs.workspace = wm;
});

test.afterAll(async () => {
  // No project created — nothing to clean
});

// ═══════════════════════════════════════════════════════════════════
//  1 · HEALTH SERVICE — Uptime
// ═══════════════════════════════════════════════════════════════════

test.describe('Health Dashboard — Uptime', () => {
  test('getUptime returns formatted uptime', () => {
    const u = health.getUptime();
    expect(u.ms).toBeGreaterThan(0);
    expect(u.seconds).toBeGreaterThanOrEqual(0);
    expect(u.startedAt).toBeTruthy();
    expect(u.formatted).toMatch(/\d+d \d+h \d+m \d+s/);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  2 · HEALTH SERVICE — Latency
// ═══════════════════════════════════════════════════════════════════

test.describe('Health Dashboard — Latency', () => {
  test.beforeEach(() => health._reset());

  test('recordLatency + getLatencyStats returns percentiles', () => {
    for (let i = 1; i <= 100; i++) health.recordLatency('/api/test', i);
    const stats = health.getLatencyStats();
    expect(stats.count).toBe(100);
    expect(stats.p50).toBeGreaterThanOrEqual(40);
    expect(stats.p90).toBeGreaterThanOrEqual(80);
    expect(stats.p95).toBeGreaterThanOrEqual(90);
    expect(stats.p99).toBeGreaterThanOrEqual(95);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(100);
    expect(stats.avg).toBe(51);
  });

  test('getLatencyStats filters by endpoint', () => {
    health.recordLatency('/a', 10);
    health.recordLatency('/b', 20);
    const stats = health.getLatencyStats({ endpoint: '/a' });
    expect(stats.count).toBe(1);
    expect(stats.avg).toBe(10);
  });

  test('getLatencyStats returns zeros when empty', () => {
    const stats = health.getLatencyStats();
    expect(stats.count).toBe(0);
    expect(stats.p50).toBe(0);
  });

  test('caps at MAX_LATENCIES', () => {
    for (let i = 0; i < 510; i++) health.recordLatency('/cap', 1);
    const stats = health.getLatencyStats();
    expect(stats.count).toBeLessThanOrEqual(500);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  3 · HEALTH SERVICE — Errors
// ═══════════════════════════════════════════════════════════════════

test.describe('Health Dashboard — Errors', () => {
  test.beforeEach(() => health._reset());

  test('recordError + getErrorStats returns errors', () => {
    health.recordError('Something failed', '/api/crash');
    health.recordError('Another fail');
    const stats = health.getErrorStats();
    expect(stats.total).toBe(2);
    expect(stats.byEndpoint['/api/crash']).toBe(1);
    expect(stats.recent[0].message).toBe('Another fail');
  });

  test('clearErrors empties error log', () => {
    health.recordError('err');
    health.clearErrors();
    expect(health.getErrorStats().total).toBe(0);
  });

  test('getErrorStats respects limit', () => {
    for (let i = 0; i < 30; i++) health.recordError(`e${i}`);
    const stats = health.getErrorStats({ limit: 5 });
    expect(stats.recent).toHaveLength(5);
  });

  test('error message is truncated at 500 chars', () => {
    health.recordError('x'.repeat(600));
    const stats = health.getErrorStats();
    expect(stats.recent[0].message.length).toBeLessThanOrEqual(500);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  4 · HEALTH SERVICE — Backend Health
// ═══════════════════════════════════════════════════════════════════

test.describe('Health Dashboard — Backend Health', () => {
  test.beforeEach(() => health._reset());

  test('recordBackendCheck + getBackendHealth returns status', () => {
    health.recordBackendCheck('copilot', true, 120);
    health.recordBackendCheck('openai', false, 5000);
    const backends = health.getBackendHealth();
    expect(backends.copilot.status).toBe('healthy');
    expect(backends.copilot.lastLatency).toBe(120);
    expect(backends.openai.status).toBe('unhealthy');
    expect(backends.openai.failures).toBe(1);
  });

  test('uptime percentage calculated correctly', () => {
    health.recordBackendCheck('test', true);
    health.recordBackendCheck('test', true);
    health.recordBackendCheck('test', false);
    const backends = health.getBackendHealth();
    expect(backends.test.uptime).toBe('66.7%');
    expect(backends.test.totalChecks).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  5 · HEALTH SERVICE — Health Score
// ═══════════════════════════════════════════════════════════════════

test.describe('Health Dashboard — Health Score', () => {
  test.beforeEach(() => health._reset());

  test('returns 100 when no issues', () => {
    const s = health.getHealthScore();
    expect(s.score).toBe(100);
    expect(s.status).toBe('healthy');
    expect(s.issues).toHaveLength(0);
  });

  test('penalizes unhealthy backends', () => {
    health.recordBackendCheck('broken', false);
    const s = health.getHealthScore();
    expect(s.score).toBeLessThan(100);
    expect(s.issues.some(i => i.includes('broken'))).toBe(true);
  });

  test('status reflects score', () => {
    // Force low score - many errors
    for (let i = 0; i < 60; i++) health.recordError('err');
    const s = health.getHealthScore();
    expect(s.score).toBeLessThanOrEqual(70);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  6 · HEALTH SERVICE — Thresholds
// ═══════════════════════════════════════════════════════════════════

test.describe('Health Dashboard — Thresholds', () => {
  test('getThresholds returns defaults', () => {
    const t = health.getThresholds();
    expect(t.maxP95LatencyMs).toBe(5000);
    expect(t.maxErrorsPerMinute).toBe(10);
    expect(t.minHealthScore).toBe(50);
  });

  test('setThresholds overrides values', () => {
    const t = health.setThresholds({ maxP95LatencyMs: 3000 });
    expect(t.maxP95LatencyMs).toBe(3000);
    // Reset
    health.setThresholds({ maxP95LatencyMs: 5000 });
  });

  test('checkThresholds returns violations', () => {
    health._reset();
    const result = health.checkThresholds();
    expect(result.healthy).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  7 · HEALTH SERVICE — Dashboard
// ═══════════════════════════════════════════════════════════════════

test.describe('Health Dashboard — getDashboard', () => {
  test.beforeEach(() => health._reset());

  test('getDashboard returns all sections', () => {
    const d = health.getDashboard();
    expect(d.uptime).toBeTruthy();
    expect(d.health).toBeTruthy();
    expect(d.latency).toBeTruthy();
    expect(d.errors).toBeTruthy();
    expect(d.backends).toBeTruthy();
    expect(d.thresholds).toBeTruthy();
    expect(d.health.score).toBeDefined();
    expect(d.uptime.formatted).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  8 · REST ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

test.describe('Health Dashboard — REST Endpoints', () => {
  let request;

  test.beforeAll(async ({ playwright }) => {
    request = await playwright.request.newContext();
  });

  test('GET /health/dashboard returns full dashboard', async () => {
    const res = await request.get(`${API}/health/dashboard`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.uptime).toBeTruthy();
    expect(body.health).toBeTruthy();
    expect(body.latency).toBeTruthy();
  });

  test('GET /health/uptime returns uptime', async () => {
    const res = await request.get(`${API}/health/uptime`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ms).toBeGreaterThan(0);
    expect(body.formatted).toBeTruthy();
  });

  test('GET /health/score returns score', async () => {
    const res = await request.get(`${API}/health/score`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.score).toBe('number');
    expect(body.status).toBeTruthy();
  });

  test('POST /health/latency records latency', async () => {
    const res = await request.post(`${API}/health/latency`, {
      data: { endpoint: '/api/test', ms: 42 },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('POST /health/latency validates input', async () => {
    const res = await request.post(`${API}/health/latency`, { data: {} });
    expect(res.status()).toBe(400);
  });

  test('GET /health/latency returns stats', async () => {
    const res = await request.get(`${API}/health/latency`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.count).toBe('number');
  });

  test('POST /health/errors records error', async () => {
    const res = await request.post(`${API}/health/errors`, {
      data: { message: 'test error', endpoint: '/api/crash' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('POST /health/errors validates input', async () => {
    const res = await request.post(`${API}/health/errors`, { data: {} });
    expect(res.status()).toBe(400);
  });

  test('GET /health/errors returns stats', async () => {
    const res = await request.get(`${API}/health/errors`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.total).toBe('number');
  });

  test('DELETE /health/errors clears errors', async () => {
    const res = await request.delete(`${API}/health/errors`);
    expect(res.ok()).toBeTruthy();
  });

  test('POST /health/backends records check', async () => {
    const res = await request.post(`${API}/health/backends`, {
      data: { backend: 'copilot', available: true, latencyMs: 100 },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('POST /health/backends validates input', async () => {
    const res = await request.post(`${API}/health/backends`, { data: {} });
    expect(res.status()).toBe(400);
  });

  test('GET /health/backends returns backend health', async () => {
    const res = await request.get(`${API}/health/backends`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.copilot).toBeTruthy();
  });

  test('GET /health/thresholds returns thresholds', async () => {
    const res = await request.get(`${API}/health/thresholds`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.maxP95LatencyMs).toBeTruthy();
  });

  test('PUT /health/thresholds sets thresholds', async () => {
    const res = await request.put(`${API}/health/thresholds`, {
      data: { maxP95LatencyMs: 3000 },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.maxP95LatencyMs).toBe(3000);
  });

  test('GET /health/thresholds/check checks thresholds', async () => {
    const res = await request.get(`${API}/health/thresholds/check`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.healthy).toBe('boolean');
  });
});
