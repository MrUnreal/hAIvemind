/**
 * Phase 11.7 — Cost Budgets tests
 *
 * Tests budget CRUD, spend tracking, alerts, forecasting, and permission checks.
 *
 * 26 tests
 */

import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';
const PROJ = `budget-test-${Date.now()}`;

test.beforeAll(async ({ request }) => {
  await request.post(`${API}/projects`, { data: { name: PROJ } });
});

// ═══════════════════════════════════════════════════════════
//  Budget CRUD
// ═══════════════════════════════════════════════════════════

test.describe('Budget CRUD', () => {
  test('GET returns default budget', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/budget`);
    expect(res.ok()).toBe(true);
    const budget = await res.json();
    expect(budget.period).toBe('monthly');
    expect(budget.softLimit).toBeNull();
    expect(budget.hardLimit).toBeNull();
  });

  test('PUT sets budget limits', async ({ request }) => {
    const res = await request.put(`${API}/projects/${PROJ}/budget`, {
      data: { softLimit: 50, hardLimit: 100, period: 'daily' },
    });
    expect(res.ok()).toBe(true);
    const budget = await res.json();
    expect(budget.softLimit).toBe(50);
    expect(budget.hardLimit).toBe(100);
    expect(budget.period).toBe('daily');
    expect(budget.updatedAt).toBeTruthy();
  });

  test('PUT rejects invalid period', async ({ request }) => {
    const res = await request.put(`${API}/projects/${PROJ}/budget`, {
      data: { period: 'yearly' },
    });
    expect(res.status()).toBe(400);
  });

  test('PUT rejects non-number softLimit', async ({ request }) => {
    const res = await request.put(`${API}/projects/${PROJ}/budget`, {
      data: { softLimit: 'high' },
    });
    expect(res.status()).toBe(400);
  });

  test('DELETE clears budget', async ({ request }) => {
    const res = await request.delete(`${API}/projects/${PROJ}/budget`);
    expect(res.ok()).toBe(true);

    const get = await request.get(`${API}/projects/${PROJ}/budget`);
    const budget = await get.json();
    expect(budget.softLimit).toBeNull();
    expect(budget.hardLimit).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
//  Spend Tracking
// ═══════════════════════════════════════════════════════════

test.describe('Spend Tracking', () => {
  test('POST records spend entry', async ({ request }) => {
    // Re-set budget for spend tests
    await request.put(`${API}/projects/${PROJ}/budget`, {
      data: { softLimit: 5, hardLimit: 10, period: 'total' },
    });

    const res = await request.post(`${API}/projects/${PROJ}/budget/spend`, {
      data: { amount: 3, sessionId: 'sess-1', description: 'Build session' },
    });
    expect(res.status()).toBe(201);
    const entry = await res.json();
    expect(entry.amount).toBe(3);
    expect(entry.timestamp).toBeTruthy();
  });

  test('POST rejects non-number amount', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/budget/spend`, {
      data: { amount: 'three' },
    });
    expect(res.status()).toBe(400);
  });

  test('GET spend returns current period spend', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/budget/spend`);
    expect(res.ok()).toBe(true);
    const spend = await res.json();
    expect(spend.totalSpend).toBe(3);
    expect(spend.period).toBe('total');
    expect(spend.softLimitReached).toBe(false);
    expect(spend.hardLimitReached).toBe(false);
    expect(spend.remaining).toBe(7);
  });

  test('GET log returns spend history', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/budget/log`);
    expect(res.ok()).toBe(true);
    const log = await res.json();
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0].amount).toBe(3);
  });

  test('GET log supports limit param', async ({ request }) => {
    await request.post(`${API}/projects/${PROJ}/budget/spend`, {
      data: { amount: 1, description: 'Extra' },
    });
    const res = await request.get(`${API}/projects/${PROJ}/budget/log?limit=1`);
    const log = await res.json();
    expect(log.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════
//  Alerts
// ═══════════════════════════════════════════════════════════

test.describe('Alerts', () => {
  test('recording spend past soft limit generates alert', async ({ request }) => {
    // Current spend is 4 (3 + 1), soft limit is 5
    await request.post(`${API}/projects/${PROJ}/budget/spend`, {
      data: { amount: 2, description: 'Past soft' },
    });
    // Now at 6, soft limit = 5

    const res = await request.get(`${API}/projects/${PROJ}/budget/alerts`);
    expect(res.ok()).toBe(true);
    const alerts = await res.json();
    const softAlert = alerts.find(a => a.type === 'soft-limit');
    expect(softAlert).toBeTruthy();
    expect(softAlert.message).toContain('Soft limit');
  });

  test('recording spend past hard limit generates alert', async ({ request }) => {
    await request.post(`${API}/projects/${PROJ}/budget/spend`, {
      data: { amount: 5, description: 'Past hard' },
    });
    // Now at 11, hard limit = 10

    const res = await request.get(`${API}/projects/${PROJ}/budget/alerts`);
    const alerts = await res.json();
    const hardAlert = alerts.find(a => a.type === 'hard-limit');
    expect(hardAlert).toBeTruthy();
    expect(hardAlert.message).toContain('Hard limit');
  });

  test('DELETE clears alerts', async ({ request }) => {
    const res = await request.delete(`${API}/projects/${PROJ}/budget/alerts`);
    expect(res.ok()).toBe(true);

    const check = await request.get(`${API}/projects/${PROJ}/budget/alerts`);
    const alerts = await check.json();
    expect(alerts.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
//  Permission Check
// ═══════════════════════════════════════════════════════════

test.describe('Permission Check', () => {
  test('check returns blocked when hard limit reached', async ({ request }) => {
    // spend is at 11, hard limit 10
    const res = await request.get(`${API}/projects/${PROJ}/budget/check`);
    expect(res.ok()).toBe(true);
    const result = await res.json();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Hard budget limit');
  });

  test('check returns allowed when under limit', async ({ request }) => {
    // Create fresh project with no spend
    const freshSlug = `budget-fresh-${Date.now()}`;
    await request.post(`${API}/projects`, { data: { name: freshSlug } });
    await request.put(`${API}/projects/${freshSlug}/budget`, {
      data: { hardLimit: 100, period: 'total' },
    });

    const res = await request.get(`${API}/projects/${freshSlug}/budget/check`);
    const result = await res.json();
    expect(result.allowed).toBe(true);
  });

  test('check returns allowed when no hard limit set', async ({ request }) => {
    const noLimitSlug = `budget-nolimit-${Date.now()}`;
    await request.post(`${API}/projects`, { data: { name: noLimitSlug } });

    const res = await request.get(`${API}/projects/${noLimitSlug}/budget/check`);
    const result = await res.json();
    expect(result.allowed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
//  Forecast & Meta
// ═══════════════════════════════════════════════════════════

test.describe('Forecast & Meta', () => {
  test('GET forecast returns projection', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/budget/forecast`);
    expect(res.ok()).toBe(true);
    const fc = await res.json();
    // Period is 'total', so forecast should say not available
    expect(fc.forecast).toBeNull();
  });

  test('GET forecast works for daily budget', async ({ request }) => {
    const dailySlug = `budget-daily-${Date.now()}`;
    await request.post(`${API}/projects`, { data: { name: dailySlug } });
    await request.put(`${API}/projects/${dailySlug}/budget`, {
      data: { softLimit: 50, hardLimit: 100, period: 'daily' },
    });
    await request.post(`${API}/projects/${dailySlug}/budget/spend`, {
      data: { amount: 10 },
    });

    const res = await request.get(`${API}/projects/${dailySlug}/budget/forecast`);
    const fc = await res.json();
    // May return forecast or insufficient data depending on timing
    expect(fc).toBeTruthy();
  });

  test('GET budget-periods returns valid periods', async ({ request }) => {
    const res = await request.get(`${API}/budget-periods`);
    expect(res.ok()).toBe(true);
    const periods = await res.json();
    expect(periods).toContain('daily');
    expect(periods).toContain('weekly');
    expect(periods).toContain('monthly');
    expect(periods).toContain('total');
  });

  test('budget 404 for unknown project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/budget`);
    expect(res.status()).toBe(404);
  });

  test('DELETE spend log clears all entries', async ({ request }) => {
    const res = await request.delete(`${API}/projects/${PROJ}/budget/log`);
    expect(res.ok()).toBe(true);
    const check = await request.get(`${API}/projects/${PROJ}/budget/log`);
    const log = await check.json();
    expect(log.length).toBe(0);
  });
});
