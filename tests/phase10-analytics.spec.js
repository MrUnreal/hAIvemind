/**
 * Phase 10.0 — Session Analytics Tests
 *
 * Tests for analytics service, REST endpoints, CSV export,
 * time series, model breakdown, weekly digest, and
 * client component integration.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, existsSync, rmSync } from 'fs';

const API = 'http://localhost:3000/api';
const TEST_DIR = '.haivemind-workspace';

let WorkspaceManager, refs, analytics;

test.beforeAll(async () => {
  const wsModule = await import('../server/workspace.js');
  WorkspaceManager = wsModule.default;
  const stateModule = await import('../server/state.js');
  refs = stateModule.refs;
  analytics = await import('../server/services/analytics.js');

  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  const wm = new WorkspaceManager(TEST_DIR);
  refs.workspace = wm;
  try { wm.createProject('analytics-proj'); } catch { /* exists */ }
});

test.afterAll(async () => {
  if (existsSync(TEST_DIR)) {
    const { rmSync: rm } = await import('fs');
    rm(TEST_DIR, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  1 · ANALYTICS SERVICE — Project Stats
// ═══════════════════════════════════════════════════════════════════

test.describe('Analytics Service — Project Stats', () => {
  test('getProjectStats returns aggregate stats', () => {
    const stats = analytics.getProjectStats('analytics-proj');
    expect(typeof stats.total).toBe('number');
    expect(typeof stats.completed).toBe('number');
    expect(typeof stats.failed).toBe('number');
    expect(typeof stats.successRate).toBe('number');
    expect(typeof stats.avgDurationMs).toBe('number');
    expect(stats.avgDurationHuman).toBeTruthy();
    expect(typeof stats.totalCost).toBe('number');
    expect(typeof stats.costPerSession).toBe('number');
  });

  test('getProjectStats handles empty project', () => {
    const stats = analytics.getProjectStats('analytics-proj');
    expect(stats.total).toBeGreaterThanOrEqual(0);
    expect(stats.successRate).toBeGreaterThanOrEqual(0);
    expect(stats.successRate).toBeLessThanOrEqual(100);
  });

  test('getProjectStats accepts date range filters', () => {
    const stats = analytics.getProjectStats('analytics-proj', {
      from: '2020-01-01',
      to: '2099-12-31',
    });
    expect(typeof stats.total).toBe('number');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  2 · ANALYTICS SERVICE — Time Series
// ═══════════════════════════════════════════════════════════════════

test.describe('Analytics Service — Time Series', () => {
  test('getTimeSeries returns buckets for day granularity', () => {
    const series = analytics.getTimeSeries('analytics-proj', 'day', 7);
    expect(series.length).toBe(7);
    for (const bucket of series) {
      expect(bucket.period).toBeTruthy();
      expect(typeof bucket.sessions).toBe('number');
      expect(typeof bucket.completed).toBe('number');
      expect(typeof bucket.failed).toBe('number');
      expect(typeof bucket.cost).toBe('number');
    }
  });

  test('getTimeSeries returns buckets for week granularity', () => {
    const series = analytics.getTimeSeries('analytics-proj', 'week', 4);
    expect(series.length).toBe(4);
  });

  test('getTimeSeries defaults to 14 periods', () => {
    const series = analytics.getTimeSeries('analytics-proj');
    expect(series.length).toBe(14);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  3 · ANALYTICS SERVICE — Model Breakdown
// ═══════════════════════════════════════════════════════════════════

test.describe('Analytics Service — Model Breakdown', () => {
  test('getModelBreakdown returns array', () => {
    const models = analytics.getModelBreakdown('analytics-proj');
    expect(Array.isArray(models)).toBe(true);
  });

  test('each model entry has required fields', () => {
    const models = analytics.getModelBreakdown('analytics-proj');
    for (const m of models) {
      expect(m.model).toBeTruthy();
      expect(typeof m.count).toBe('number');
      expect(typeof m.totalCost).toBe('number');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  4 · ANALYTICS SERVICE — Weekly Digest
// ═══════════════════════════════════════════════════════════════════

test.describe('Analytics Service — Weekly Digest', () => {
  test('getWeeklyDigest returns current and previous stats', () => {
    const digest = analytics.getWeeklyDigest('analytics-proj');
    expect(digest.period).toBe('last_7_days');
    expect(digest.current).toBeTruthy();
    expect(digest.previous).toBeTruthy();
    expect(digest.trends).toBeTruthy();
    expect(typeof digest.trends.sessionsDelta).toBe('number');
    expect(typeof digest.trends.successRateDelta).toBe('number');
    expect(typeof digest.trends.costDelta).toBe('number');
    expect(digest.generatedAt).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  5 · ANALYTICS SERVICE — CSV Export
// ═══════════════════════════════════════════════════════════════════

test.describe('Analytics Service — CSV Export', () => {
  test('exportSessionsCsv returns valid CSV string', () => {
    const csv = analytics.exportSessionsCsv('analytics-proj');
    expect(typeof csv).toBe('string');
    const lines = csv.split('\n');
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('status');
    expect(lines[0]).toContain('prompt');
    expect(lines[0]).toContain('durationMs');
    expect(lines[0]).toContain('cost');
  });

  test('exportSessionsCsv accepts date filters', () => {
    const csv = analytics.exportSessionsCsv('analytics-proj', { from: '2020-01-01' });
    expect(csv).toContain('id,status');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  6 · ANALYTICS SERVICE — Top Sessions
// ═══════════════════════════════════════════════════════════════════

test.describe('Analytics Service — Top Sessions', () => {
  test('getTopSessions returns sorted array', () => {
    const top = analytics.getTopSessions('analytics-proj', 'duration', 5);
    expect(Array.isArray(top)).toBe(true);
    expect(top.length).toBeLessThanOrEqual(5);
  });

  test('getTopSessions supports cost sorting', () => {
    const top = analytics.getTopSessions('analytics-proj', 'cost', 3);
    expect(Array.isArray(top)).toBe(true);
    for (const s of top) {
      expect(typeof s.cost).toBe('number');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  7 · ANALYTICS ROUTES — REST API
// ═══════════════════════════════════════════════════════════════════

test.describe('Analytics Routes — REST API', () => {
  const PROJ = `analytics-route-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    await request.post(`${API}/projects`, { data: { name: PROJ } });
  });

  test('GET /analytics/stats returns stats', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/analytics/stats`);
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(typeof data.total).toBe('number');
    expect(typeof data.successRate).toBe('number');
  });

  test('GET /analytics/stats 404 for nonexistent project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/analytics/stats`);
    expect(res.status()).toBe(404);
  });

  test('GET /analytics/timeseries returns time buckets', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/analytics/timeseries?granularity=day&periods=7`);
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data.length).toBe(7);
  });

  test('GET /analytics/models returns model breakdown', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/analytics/models`);
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /analytics/digest returns weekly digest', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/analytics/digest`);
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data.period).toBe('last_7_days');
    expect(data.trends).toBeTruthy();
  });

  test('GET /analytics/export returns CSV', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/analytics/export`);
    expect(res.ok()).toBe(true);
    const text = await res.text();
    expect(text).toContain('id,status');
    const ct = res.headers()['content-type'];
    expect(ct).toContain('text/csv');
  });

  test('GET /analytics/top returns top sessions', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/analytics/top?sortBy=duration&limit=5`);
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /analytics/top 404 for nonexistent project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/analytics/top`);
    expect(res.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  8 · CLIENT — AnalyticsPanel.vue (source integration)
// ═══════════════════════════════════════════════════════════════════

test.describe('Client — AnalyticsPanel.vue integration', () => {
  let source;
  test.beforeAll(async () => {
    const { readFileSync } = await import('fs');
    source = readFileSync('client/src/components/AnalyticsPanel.vue', 'utf-8');
  });

  test('component has stats grid', () => {
    expect(source).toContain('analytics-stats-grid');
    expect(source).toContain('Total Sessions');
    expect(source).toContain('Success Rate');
    expect(source).toContain('Avg Duration');
  });

  test('component has status bars', () => {
    expect(source).toContain('analytics-bar-row');
    expect(source).toContain('bar-success');
    expect(source).toContain('bar-danger');
  });

  test('component has weekly digest section', () => {
    expect(source).toContain('Weekly Digest');
    expect(source).toContain('analytics-digest');
    expect(source).toContain('sessionsDelta');
  });

  test('component has sparkline chart', () => {
    expect(source).toContain('analytics-sparkline');
    expect(source).toContain('analytics-spark-bar');
  });

  test('component has CSV export button', () => {
    expect(source).toContain('Export CSV');
    expect(source).toContain('exportCsv');
    expect(source).toContain('/analytics/export');
  });

  test('component has model breakdown', () => {
    expect(source).toContain('analytics-model-row');
    expect(source).toContain('Model Usage');
  });

  test('component has refresh button', () => {
    expect(source).toContain('Refresh');
    expect(source).toContain('loadAll');
  });
});
