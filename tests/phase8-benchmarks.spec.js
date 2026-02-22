// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 8.8: Performance Benchmarks Tests ─────────────────────────────

// ── Benchmark Service Unit Tests ──

test.describe('Benchmarks — Service', () => {
  test('computeBenchmarks returns empty structure for no sessions', async () => {
    const { computeBenchmarks } = await import('../server/services/benchmarks.js');
    const result = computeBenchmarks([]);
    expect(result.totalSessions).toBe(0);
    expect(result.trends.duration).toEqual([]);
    expect(result.trends.cost).toEqual([]);
    expect(result.averages.duration).toBe(0);
    expect(result.regressions).toEqual([]);
    expect(result.modelComparison).toEqual([]);
    expect(result.summary.fastest).toBeNull();
  });

  test('computeBenchmarks handles null input', async () => {
    const { computeBenchmarks } = await import('../server/services/benchmarks.js');
    const result = computeBenchmarks(null);
    expect(result.totalSessions).toBe(0);
  });

  test('computeBenchmarks calculates duration trends', async () => {
    const { computeBenchmarks } = await import('../server/services/benchmarks.js');
    const sessions = [
      { id: 's1', status: 'completed', createdAt: 1000, completedAt: 5000, tasks: [{ id: 't1' }], costSummary: { totalPremiumRequests: 2 } },
      { id: 's2', status: 'completed', createdAt: 6000, completedAt: 8000, tasks: [{ id: 't1' }, { id: 't2' }], costSummary: { totalPremiumRequests: 4 } },
    ];
    const result = computeBenchmarks(sessions);
    expect(result.totalSessions).toBe(2);
    expect(result.trends.duration.length).toBe(2);
    expect(result.trends.duration[0].value).toBe(4000); // 5000-1000
    expect(result.trends.duration[1].value).toBe(2000); // 8000-6000
  });

  test('computeBenchmarks calculates averages', async () => {
    const { computeBenchmarks } = await import('../server/services/benchmarks.js');
    const sessions = [
      { id: 's1', status: 'completed', createdAt: 1000, completedAt: 5000, tasks: [{ id: 't1' }], costSummary: { totalPremiumRequests: 2 } },
      { id: 's2', status: 'completed', createdAt: 6000, completedAt: 10000, tasks: [{ id: 't1' }, { id: 't2' }], costSummary: { totalPremiumRequests: 6 } },
    ];
    const result = computeBenchmarks(sessions);
    expect(result.averages.duration).toBe(4000); // avg(4000, 4000)
    expect(result.averages.cost).toBe(4); // avg(2, 6)
    expect(result.averages.taskCount).toBe(1.5); // avg(1, 2)
  });

  test('computeBenchmarks identifies fastest/cheapest', async () => {
    const { computeBenchmarks } = await import('../server/services/benchmarks.js');
    const sessions = [
      { id: 'fast', status: 'completed', createdAt: 0, completedAt: 1000, tasks: [], costSummary: { totalPremiumRequests: 10 } },
      { id: 'slow', status: 'completed', createdAt: 0, completedAt: 5000, tasks: [], costSummary: { totalPremiumRequests: 1 } },
    ];
    const result = computeBenchmarks(sessions);
    expect(result.summary.fastest).toBe('fast');
    expect(result.summary.slowest).toBe('slow');
    expect(result.summary.cheapest).toBe('slow');
    expect(result.summary.costliest).toBe('fast');
  });

  test('computeBenchmarks filters out non-terminal sessions', async () => {
    const { computeBenchmarks } = await import('../server/services/benchmarks.js');
    const sessions = [
      { id: 's1', status: 'completed', createdAt: 1000, completedAt: 2000, tasks: [], costSummary: {} },
      { id: 's2', status: 'running', createdAt: 3000, tasks: [], costSummary: {} },
      { id: 's3', status: 'failed', createdAt: 4000, completedAt: 5000, tasks: [], costSummary: {} },
    ];
    const result = computeBenchmarks(sessions);
    expect(result.totalSessions).toBe(2); // running filtered out
  });

  test('computeBenchmarks cost trend', async () => {
    const { computeBenchmarks } = await import('../server/services/benchmarks.js');
    const sessions = [
      { id: 's1', status: 'completed', createdAt: 1000, completedAt: 2000, tasks: [], costSummary: { totalPremiumRequests: 3 } },
      { id: 's2', status: 'completed', createdAt: 3000, completedAt: 4000, tasks: [], costSummary: { totalPremiumRequests: 7 } },
    ];
    const result = computeBenchmarks(sessions);
    expect(result.trends.cost[0].value).toBe(3);
    expect(result.trends.cost[1].value).toBe(7);
  });

  // ── Regression Detection ──

  test('detectRegressions finds regressions', async () => {
    const { detectRegressions } = await import('../server/services/benchmarks.js');
    // 5 prior points averaging 100, 3 recent points averaging 200 → 100% increase
    const trends = {
      duration: [
        { value: 100 }, { value: 100 }, { value: 100 }, { value: 100 }, { value: 100 },
        { value: 200 }, { value: 200 }, { value: 200 },
      ],
    };
    const regs = detectRegressions(trends);
    expect(regs.length).toBe(1);
    expect(regs[0].metric).toBe('duration');
    expect(regs[0].changePercent).toBe(100);
    expect(regs[0].severity).toBe('medium');
  });

  test('detectRegressions returns empty when no regression', async () => {
    const { detectRegressions } = await import('../server/services/benchmarks.js');
    const trends = {
      duration: [
        { value: 100 }, { value: 100 }, { value: 100 }, { value: 100 }, { value: 100 },
        { value: 100 }, { value: 100 }, { value: 100 },
      ],
    };
    const regs = detectRegressions(trends);
    expect(regs.length).toBe(0);
  });

  test('detectRegressions requires minimum data', async () => {
    const { detectRegressions } = await import('../server/services/benchmarks.js');
    const trends = { duration: [{ value: 100 }, { value: 200 }] };
    expect(detectRegressions(trends).length).toBe(0);
  });

  // ── Model Comparison ──

  test('compareModels aggregates tier data', async () => {
    const { compareModels } = await import('../server/services/benchmarks.js');
    const sessions = [
      { status: 'completed', createdAt: 1000, completedAt: 5000, costSummary: { tierBreakdown: { T0: 4, T1: 1 } } },
      { status: 'completed', createdAt: 6000, completedAt: 8000, costSummary: { tierBreakdown: { T0: 2 } } },
      { status: 'failed', createdAt: 9000, completedAt: 10000, costSummary: { tierBreakdown: { T0: 3, T2: 1 } } },
    ];
    const result = compareModels(sessions);
    expect(result.length).toBe(3); // T0, T1, T2
    const t0 = result.find(m => m.tier === 'T0');
    expect(t0.sessions).toBe(3);
    expect(t0.totalRequests).toBe(9);
    expect(t0.successRate).toBe(67); // 2/3
  });

  test('compareModels handles no tier data', async () => {
    const { compareModels } = await import('../server/services/benchmarks.js');
    const sessions = [
      { status: 'completed', createdAt: 1000, completedAt: 2000, costSummary: {} },
    ];
    expect(compareModels(sessions)).toEqual([]);
  });

  // ── Format Duration ──

  test('formatDuration formats correctly', async () => {
    const { formatDuration } = await import('../server/services/benchmarks.js');
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(90000)).toBe('1m 30s');
  });
});

// ── REST API Tests ──

test.describe('Benchmarks — REST API', () => {
  test('GET benchmarks returns 404 for missing project', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent-zzz/benchmarks`);
    expect(res.status).toBe(404);
  });

  test('GET benchmarks returns valid structure', async () => {
    // Use the running server — if any project exists, test against it
    const projRes = await fetch(`${API}/api/projects`);
    const projects = await projRes.json();
    if (projects.length === 0) return; // skip if no projects

    const res = await fetch(`${API}/api/projects/${projects[0].slug}/benchmarks`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('totalSessions');
    expect(data).toHaveProperty('trends');
    expect(data).toHaveProperty('averages');
    expect(data).toHaveProperty('regressions');
    expect(data).toHaveProperty('modelComparison');
    expect(data).toHaveProperty('summary');
  });
});

// ── Client Component Tests ──

test.describe('Benchmarks — Client Component', () => {
  test('BenchmarkPanel.vue exists and has template', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/BenchmarkPanel.vue'), 'utf8');
    expect(content).toContain('<template>');
    expect(content).toContain('<script setup>');
  });

  test('has averages summary section', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/BenchmarkPanel.vue'), 'utf8');
    expect(content).toContain('bench-averages');
    expect(content).toContain('bench-stat');
    expect(content).toContain('Avg Duration');
    expect(content).toContain('Avg Cost');
  });

  test('has regression alerts section', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/BenchmarkPanel.vue'), 'utf8');
    expect(content).toContain('bench-regressions');
    expect(content).toContain('bench-regression-item');
    expect(content).toContain('bench-sev-high');
  });

  test('has duration and cost trend charts', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/BenchmarkPanel.vue'), 'utf8');
    expect(content).toContain('bench-trend-chart');
    expect(content).toContain('bench-bar');
    expect(content).toContain('Duration Trend');
    expect(content).toContain('Cost Trend');
  });

  test('has model comparison table', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/BenchmarkPanel.vue'), 'utf8');
    expect(content).toContain('bench-model-table');
    expect(content).toContain('bench-tier-name');
    expect(content).toContain('Success %');
    expect(content).toContain('Avg Duration');
  });

  test('has summary section', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/BenchmarkPanel.vue'), 'utf8');
    expect(content).toContain('bench-summary');
    expect(content).toContain('Fastest');
    expect(content).toContain('Cheapest');
  });

  test('SessionHistory has benchmark toggle button', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/SessionHistory.vue'), 'utf8');
    expect(content).toContain('benchmark-toggle-btn');
    expect(content).toContain('BenchmarkPanel');
    expect(content).toContain('showBenchmarks');
  });
});
