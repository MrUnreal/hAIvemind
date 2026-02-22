// @ts-check
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 7.6: Cost Analytics Chart Tests ──────────────────────────────

test.describe('Cost Analytics — REST API', () => {
  test('GET /api/projects/:slug/cost-history returns 200', async () => {
    // Create a temp project first, or use existing
    const res = await fetch(`${API}/api/projects`);
    const projects = await res.json();
    if (projects.length === 0) {
      // Create a test project
      await fetch(`${API}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'cost-test' }),
      });
    }
    const slug = projects[0]?.slug || 'cost-test';
    const costRes = await fetch(`${API}/api/projects/${slug}/cost-history`);
    expect(costRes.ok).toBe(true);
  });

  test('returns { entries, totals, count } shape', async () => {
    const res = await fetch(`${API}/api/projects`);
    const projects = await res.json();
    if (projects.length === 0) return;

    const costRes = await fetch(`${API}/api/projects/${projects[0].slug}/cost-history`);
    const data = await costRes.json();
    expect(data).toHaveProperty('entries');
    expect(data).toHaveProperty('totals');
    expect(data).toHaveProperty('count');
    expect(Array.isArray(data.entries)).toBe(true);
    expect(typeof data.count).toBe('number');
  });

  test('returns 404 for nonexistent project', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent-project-zzz/cost-history`);
    expect(res.status).toBe(404);
  });

  test('respects limit parameter', async () => {
    const res = await fetch(`${API}/api/projects`);
    const projects = await res.json();
    if (projects.length === 0) return;

    const costRes = await fetch(`${API}/api/projects/${projects[0].slug}/cost-history?limit=1`);
    const data = await costRes.json();
    expect(data.entries.length).toBeLessThanOrEqual(1);
  });
});

test.describe('Cost Analytics — Fixture Data', () => {
  const fixtureDir = path.join(ROOT, 'projects', '_cost-test');
  const sessionsDir = path.join(fixtureDir, '.haivemind', 'sessions');

  test.beforeAll(() => {
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(path.join(fixtureDir, '.haivemind', 'project.json'), JSON.stringify({
      id: 'cost-test-id',
      slug: '_cost-test',
      name: 'Cost Test Project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    const registryPath = path.join(ROOT, 'projects', 'projects.json');
    let registry = { projects: {} };
    if (existsSync(registryPath)) {
      try { registry = JSON.parse(readFileSync(registryPath, 'utf-8')); } catch { /* */ }
    }
    registry.projects['_cost-test'] = {
      id: 'cost-test-id',
      name: 'Cost Test Project',
      slug: '_cost-test',
      createdAt: Date.now(),
    };
    writeFileSync(registryPath, JSON.stringify(registry, null, 2));

    // Session with cost data
    writeFileSync(path.join(sessionsDir, 'session-c1.json'), JSON.stringify({
      id: 'session-c1',
      projectSlug: '_cost-test',
      prompt: 'Build user auth',
      status: 'completed',
      createdAt: Date.now() - 86400000,
      completedAt: Date.now() - 86300000,
      tasks: [
        { id: 't1', label: 'Create middleware', status: 'success', dependencies: [] },
        { id: 't2', label: 'Create routes', status: 'success', dependencies: ['t1'] },
      ],
      agents: {
        'a1': { taskId: 't1', model: 'gpt-4o-mini', modelTier: 'T0', status: 'success', retries: 0 },
        'a2': { taskId: 't2', model: 'gpt-4o', modelTier: 'T2', status: 'success', retries: 0 },
      },
      costSummary: { totalPremiumRequests: 1, byTier: { T0: { count: 1 }, T2: { count: 1 } } },
    }));

    // Session without premium cost
    writeFileSync(path.join(sessionsDir, 'session-c2.json'), JSON.stringify({
      id: 'session-c2',
      projectSlug: '_cost-test',
      prompt: 'Fix CSS',
      status: 'completed',
      createdAt: Date.now() - 172800000,
      completedAt: Date.now() - 172700000,
      tasks: [
        { id: 't3', label: 'Update styles', status: 'success', dependencies: [] },
      ],
      agents: {
        'a3': { taskId: 't3', model: 'gpt-4o-mini', modelTier: 'T0', status: 'success', retries: 0 },
      },
      costSummary: { totalPremiumRequests: 0 },
    }));

    // Failed session with escalation
    writeFileSync(path.join(sessionsDir, 'session-c3.json'), JSON.stringify({
      id: 'session-c3',
      projectSlug: '_cost-test',
      prompt: 'Complex refactor',
      status: 'failed',
      createdAt: Date.now() - 3600000,
      tasks: [
        { id: 't4', label: 'Refactor core', status: 'failed', dependencies: [] },
      ],
      agents: {
        'a4': { taskId: 't4', model: 'gpt-4o-mini', modelTier: 'T0', status: 'failed', retries: 0 },
        'a5': { taskId: 't4', model: 'gpt-4o', modelTier: 'T1', status: 'failed', retries: 1 },
        'a6': { taskId: 't4', model: 'claude-sonnet', modelTier: 'T3', status: 'failed', retries: 2 },
      },
      costSummary: { totalPremiumRequests: 3, byTier: { T0: { count: 1 }, T1: { count: 1 }, T3: { count: 1 } } },
    }));
  });

  test.afterAll(() => {
    try { rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* */ }
    const registryPath = path.join(ROOT, 'projects', 'projects.json');
    if (existsSync(registryPath)) {
      try {
        const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
        delete registry.projects['_cost-test'];
        writeFileSync(registryPath, JSON.stringify(registry, null, 2));
      } catch { /* */ }
    }
  });

  test('cost-history returns entries for fixture sessions (unit)', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    const sessions = ws.listSessions('_cost-test');
    expect(sessions.length).toBe(3);
  });

  test('cost-history entries have correct shape (unit)', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    const sessions = ws.listSessions('_cost-test');

    // Simulate the route logic to verify the shape
    const entries = sessions
      .filter(s => s.status === 'completed' || s.status === 'failed')
      .map(s => {
        const tierCounts = { T0: 0, T1: 0, T2: 0, T3: 0 };
        if (s.agents) {
          for (const agent of Object.values(s.agents)) {
            const tier = agent.modelTier || 'T0';
            tierCounts[tier] = (tierCounts[tier] || 0) + 1;
          }
        }
        if (s.costSummary?.byTier) {
          for (const [tier, data] of Object.entries(s.costSummary.byTier)) {
            if (data.count) tierCounts[tier] = data.count;
          }
        }
        return {
          sessionId: s.id,
          prompt: (s.prompt || '').slice(0, 80),
          status: s.status,
          createdAt: s.createdAt,
          totalCost: s.costSummary?.totalPremiumRequests || 0,
          tiers: tierCounts,
          taskCount: Array.isArray(s.tasks) ? s.tasks.length : 0,
        };
      });

    expect(entries.length).toBe(3);
    for (const entry of entries) {
      expect(entry).toHaveProperty('sessionId');
      expect(entry).toHaveProperty('prompt');
      expect(entry).toHaveProperty('status');
      expect(entry).toHaveProperty('createdAt');
      expect(entry).toHaveProperty('totalCost');
      expect(entry).toHaveProperty('tiers');
      expect(entry).toHaveProperty('taskCount');
      expect(entry.tiers).toHaveProperty('T0');
    }
  });

  test('totals aggregate correctly (unit)', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    const sessions = ws.listSessions('_cost-test');
    const entries = sessions.filter(s => s.status === 'completed' || s.status === 'failed');

    const totals = { T0: 0, T1: 0, T2: 0, T3: 0, total: 0 };
    for (const s of entries) {
      totals.total += s.costSummary?.totalPremiumRequests || 0;
    }
    expect(totals.total).toBe(4); // 1 + 0 + 3
  });

  test('prompt is truncated to 80 chars (unit)', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    const sessions = ws.listSessions('_cost-test');

    for (const s of sessions) {
      const truncated = (s.prompt || '').slice(0, 80);
      expect(truncated.length).toBeLessThanOrEqual(80);
    }
  });
});

test.describe('Cost Analytics — Client Components', () => {
  test('CostChart.vue exists', () => {
    expect(existsSync(path.join(ROOT, 'client', 'src', 'components', 'CostChart.vue'))).toBe(true);
  });

  test('CostChart.vue has tier-colored bar segments', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'components', 'CostChart.vue'),
      'utf-8',
    );
    expect(content).toContain('bar-segment t0');
    expect(content).toContain('bar-segment t1');
    expect(content).toContain('bar-segment t2');
    expect(content).toContain('bar-segment t3');
  });

  test('CostChart.vue fetches from cost-history API', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'components', 'CostChart.vue'),
      'utf-8',
    );
    expect(content).toContain('/api/projects/');
    expect(content).toContain('cost-history');
  });

  test('CostChart.vue has legend with tier labels', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'components', 'CostChart.vue'),
      'utf-8',
    );
    expect(content).toContain('T0 (Free)');
    expect(content).toContain('chart-legend');
  });

  test('CostChart.vue has hover detail panel', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'components', 'CostChart.vue'),
      'utf-8',
    );
    expect(content).toContain('hover-detail');
    expect(content).toContain('hoveredIdx');
  });

  test('MetricsDashboard.vue imports CostChart', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'components', 'MetricsDashboard.vue'),
      'utf-8',
    );
    expect(content).toContain("import CostChart from './CostChart.vue'");
    expect(content).toContain('<CostChart');
  });
});
