/**
 * Phase 10.6 — Rate Limiting Tests
 *
 * Tests for rate limiting service (check, cooldown, burst, config,
 * middleware), REST endpoints, and per-project overrides.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, existsSync, rmSync } from 'fs';

const API = 'http://localhost:3000/api';
const TEST_DIR = '.haivemind-workspace';

let WorkspaceManager, refs, rl;

test.beforeAll(async () => {
  const wsModule = await import('../server/workspace.js');
  WorkspaceManager = wsModule.default;
  const stateModule = await import('../server/state.js');
  refs = stateModule.refs;
  rl = await import('../server/services/rateLimiter.js');

  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  const wm = new WorkspaceManager(TEST_DIR);
  refs.workspace = wm;
  try { wm.createProject('rate-proj'); } catch { /* exists */ }
});

test.afterAll(async () => {
  const projDir = `${TEST_DIR}/rate-proj`;
  if (existsSync(projDir)) {
    rmSync(projDir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  1 · RATE SERVICE — Defaults
// ═══════════════════════════════════════════════════════════════════

test.describe('Rate Limiter — Defaults', () => {
  test('getDefaults returns expected values', () => {
    const d = rl.getDefaults();
    expect(d.requestsPerMinute).toBe(60);
    expect(d.requestsPerHour).toBe(600);
    expect(d.burstLimit).toBe(20);
    expect(d.cooldownMs).toBe(5000);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  2 · RATE SERVICE — checkRate
// ═══════════════════════════════════════════════════════════════════

test.describe('Rate Limiter — checkRate', () => {
  test.beforeEach(() => rl.clearAll());

  test('allows first request', () => {
    const r = rl.checkRate('test-key');
    expect(r.allowed).toBe(true);
    expect(r.remaining.minute).toBe(59);
  });

  test('tracks remaining counts', () => {
    for (let i = 0; i < 5; i++) rl.checkRate('count-key');
    const r = rl.checkRate('count-key');
    expect(r.allowed).toBe(true);
    expect(r.remaining.minute).toBe(54);
  });

  test('denies when per-minute limit exceeded', () => {
    const limits = { requestsPerMinute: 3, requestsPerHour: 1000, burstLimit: 100, cooldownMs: 0 };
    rl.checkRate('pm', limits);
    rl.checkRate('pm', limits);
    rl.checkRate('pm', limits);
    const r = rl.checkRate('pm', limits);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('minute');
    expect(typeof r.retryAfterMs).toBe('number');
  });

  test('denies when burst limit exceeded', () => {
    const limits = { requestsPerMinute: 1000, requestsPerHour: 10000, burstLimit: 2, cooldownMs: 100 };
    rl.checkRate('burst', limits);
    rl.checkRate('burst', limits);
    const r = rl.checkRate('burst', limits);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('burst');
    expect(r.retryAfterMs).toBe(100);
  });

  test('cooldown blocks requests', () => {
    const limits = { requestsPerMinute: 1000, requestsPerHour: 10000, burstLimit: 1, cooldownMs: 50000 };
    rl.checkRate('cd', limits);
    rl.checkRate('cd', limits); // triggers burst → cooldown
    const r = rl.checkRate('cd', limits);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('cooldown');
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  test('denies when per-hour limit exceeded', () => {
    const limits = { requestsPerMinute: 1000, requestsPerHour: 3, burstLimit: 100, cooldownMs: 0 };
    rl.checkRate('ph', limits);
    rl.checkRate('ph', limits);
    rl.checkRate('ph', limits);
    const r = rl.checkRate('ph', limits);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('hour');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  3 · RATE SERVICE — Status + recordHit
// ═══════════════════════════════════════════════════════════════════

test.describe('Rate Limiter — Status', () => {
  test.beforeEach(() => rl.clearAll());

  test('getStatus returns hit counts', () => {
    rl.checkRate('st');
    rl.checkRate('st');
    const s = rl.getStatus('st');
    expect(s.key).toBe('st');
    expect(s.minuteHits).toBe(2);
    expect(s.hourHits).toBe(2);
  });

  test('recordHit adds a hit without checking', () => {
    rl.recordHit('manual');
    const s = rl.getStatus('manual');
    expect(s.minuteHits).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  4 · RATE SERVICE — Buckets
// ═══════════════════════════════════════════════════════════════════

test.describe('Rate Limiter — Buckets', () => {
  test.beforeEach(() => rl.clearAll());

  test('clearBucket removes specific key', () => {
    rl.checkRate('b1');
    rl.checkRate('b2');
    rl.clearBucket('b1');
    expect(rl.listKeys()).not.toContain('b1');
    expect(rl.listKeys()).toContain('b2');
  });

  test('clearAll removes all keys', () => {
    rl.checkRate('x');
    rl.checkRate('y');
    rl.clearAll();
    expect(rl.listKeys()).toHaveLength(0);
  });

  test('listKeys returns tracked keys', () => {
    rl.checkRate('k1');
    rl.checkRate('k2');
    const keys = rl.listKeys();
    expect(keys).toContain('k1');
    expect(keys).toContain('k2');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  5 · RATE SERVICE — Project Limits
// ═══════════════════════════════════════════════════════════════════

test.describe('Rate Limiter — Project Limits', () => {
  const SLUG = 'rate-proj';

  test('getLimits returns defaults initially', () => {
    rl.resetLimits(SLUG);
    const l = rl.getLimits(SLUG);
    expect(l.requestsPerMinute).toBe(60);
  });

  test('setLimits overrides project limits', () => {
    const l = rl.setLimits(SLUG, { requestsPerMinute: 30 });
    expect(l.requestsPerMinute).toBe(30);
  });

  test('getLimits reflects override', () => {
    const l = rl.getLimits(SLUG);
    expect(l.requestsPerMinute).toBe(30);
  });

  test('setLimits ignores invalid values', () => {
    const l = rl.setLimits(SLUG, { requestsPerMinute: -5, burstLimit: 0 });
    // Should keep previous valid setting (30) since invalid values are skipped
    expect(l.requestsPerMinute).toBe(30);
  });

  test('resetLimits restores defaults', () => {
    const l = rl.resetLimits(SLUG);
    expect(l.requestsPerMinute).toBe(60);
    expect(l.requestsPerHour).toBe(600);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  6 · RATE SERVICE — Middleware
// ═══════════════════════════════════════════════════════════════════

test.describe('Rate Limiter — Middleware', () => {
  test.beforeEach(() => rl.clearAll());

  test('middleware allows requests under limit', () => {
    const mw = rl.rateLimitMiddleware({ keyFn: () => 'mw-test', limits: { requestsPerMinute: 100, requestsPerHour: 1000, burstLimit: 50, cooldownMs: 0 } });
    let nextCalled = false;
    const headers = {};
    const req = { ip: '127.0.0.1' };
    const res = {
      setHeader: (k, v) => { headers[k] = v; },
      status: () => res,
      json: () => {},
    };
    mw(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(headers['X-RateLimit-Remaining-Minute']).toBeDefined();
  });

  test('middleware blocks when limit exceeded', () => {
    const mw = rl.rateLimitMiddleware({ keyFn: () => 'mw-block', limits: { requestsPerMinute: 1, requestsPerHour: 1000, burstLimit: 100, cooldownMs: 0 } });
    const headers = {};
    let statusCode = null;
    let body = null;
    const req = {};
    const res = {
      setHeader: (k, v) => { headers[k] = v; },
      status: (code) => { statusCode = code; return res; },
      json: (b) => { body = b; },
    };
    mw(req, res, () => {});  // first — allowed
    mw(req, res, () => {});  // second — blocked
    expect(statusCode).toBe(429);
    expect(body.error).toContain('Rate limit');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  7 · REST ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

const PROJ = `rate-rest-${Date.now()}`;

test.describe('Rate Limiter — REST Endpoints', () => {
  let request;

  test.beforeAll(async ({ playwright }) => {
    request = await playwright.request.newContext();
    const res = await request.post(`${API}/projects`, { data: { name: PROJ } });
    expect(res.status()).toBe(201);
  });

  test('GET /projects/:slug/rate-limits returns defaults', async () => {
    const res = await request.get(`${API}/projects/${PROJ}/rate-limits`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.requestsPerMinute).toBe(60);
  });

  test('PUT /projects/:slug/rate-limits sets limits', async () => {
    const res = await request.put(`${API}/projects/${PROJ}/rate-limits`, {
      data: { requestsPerMinute: 25 },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.requestsPerMinute).toBe(25);
  });

  test('DELETE /projects/:slug/rate-limits resets', async () => {
    const res = await request.delete(`${API}/projects/${PROJ}/rate-limits`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.requestsPerMinute).toBe(60);
  });

  test('GET /rate-limits 404 for nonexistent project', async () => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/rate-limits`);
    expect(res.status()).toBe(404);
  });

  test('POST /rate/check checks a key', async () => {
    const res = await request.post(`${API}/rate/check`, {
      data: { key: 'rest-test-key' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.allowed).toBe(true);
    expect(typeof body.remaining.minute).toBe('number');
  });

  test('POST /rate/check requires key', async () => {
    const res = await request.post(`${API}/rate/check`, { data: {} });
    expect(res.status()).toBe(400);
  });

  test('GET /rate/status/:key returns status', async () => {
    await request.post(`${API}/rate/check`, { data: { key: 'status-key' } });
    const res = await request.get(`${API}/rate/status/status-key`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.key).toBe('status-key');
    expect(body.minuteHits).toBeGreaterThanOrEqual(1);
  });

  test('GET /rate/keys lists tracked keys', async () => {
    const res = await request.get(`${API}/rate/keys`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.keys)).toBe(true);
  });

  test('GET /rate/defaults returns defaults', async () => {
    const res = await request.get(`${API}/rate/defaults`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.requestsPerMinute).toBe(60);
  });

  test('DELETE /rate/buckets/:key clears a key', async () => {
    await request.post(`${API}/rate/check`, { data: { key: 'del-me' } });
    const res = await request.delete(`${API}/rate/buckets/del-me`);
    expect(res.ok()).toBeTruthy();
  });

  test('DELETE /rate/buckets clears all', async () => {
    const res = await request.delete(`${API}/rate/buckets`);
    expect(res.ok()).toBeTruthy();
    const keys = await request.get(`${API}/rate/keys`);
    const body = await keys.json();
    expect(body.keys).toHaveLength(0);
  });
});
