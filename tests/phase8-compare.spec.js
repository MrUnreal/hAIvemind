// @ts-check
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 8.0: Session Comparison Tests ────────────────────────────────

// ── Fixture Data ──

const now = Date.now();

const sessionA = {
  id: 'cmp-a1',
  projectSlug: '_compare-test',
  prompt: 'Build authentication module',
  status: 'completed',
  createdAt: now - 120000,
  completedAt: now - 60000,
  tasks: [
    { id: 't1', label: 'Create auth middleware', status: 'success', dependencies: [] },
    { id: 't2', label: 'Write unit tests', status: 'success', dependencies: ['t1'] },
    { id: 't3', label: 'Setup database schema', status: 'success', dependencies: [] },
  ],
  agents: {
    a1: { taskId: 't1', model: 'gpt-4o-mini', modelTier: 'T0', status: 'success', retries: 0 },
    a2: { taskId: 't2', model: 'gpt-4o-mini', modelTier: 'T0', status: 'success', retries: 0 },
    a3: { taskId: 't3', model: 'gpt-4o', modelTier: 'T2', status: 'success', retries: 1 },
  },
  edges: [{ id: 'e1', source: 't1', target: 't2' }],
  costSummary: {
    totalPremiumRequests: 1,
    byTier: { T0: { count: 2 }, T2: { count: 1 } },
  },
};

const sessionB = {
  id: 'cmp-b1',
  projectSlug: '_compare-test',
  prompt: 'Build login page',
  status: 'completed',
  createdAt: now - 60000,
  completedAt: now - 10000,
  tasks: [
    { id: 't1', label: 'Create auth middleware', status: 'success', dependencies: [] },
    { id: 't2', label: 'Build login form', status: 'success', dependencies: ['t1'] },
    { id: 't3', label: 'Add OAuth provider', status: 'success', dependencies: ['t1'] },
    { id: 't4', label: 'Write unit tests', status: 'success', dependencies: ['t2', 't3'] },
  ],
  agents: {
    a1: { taskId: 't1', model: 'gpt-4o-mini', modelTier: 'T0', status: 'success', retries: 0 },
    a2: { taskId: 't2', model: 'gpt-4o', modelTier: 'T2', status: 'success', retries: 0 },
    a3: { taskId: 't3', model: 'gpt-4o', modelTier: 'T2', status: 'success', retries: 0 },
    a4: { taskId: 't4', model: 'claude-3.5-sonnet', modelTier: 'T3', status: 'success', retries: 0 },
  },
  edges: [
    { id: 'e1', source: 't1', target: 't2' },
    { id: 'e2', source: 't1', target: 't3' },
    { id: 'e3', source: 't2', target: 't4' },
    { id: 'e4', source: 't3', target: 't4' },
  ],
  costSummary: {
    totalPremiumRequests: 3,
    byTier: { T0: { count: 1 }, T2: { count: 2 }, T3: { count: 1 } },
  },
};

// ── REST API Tests ──

test.describe('Session Compare — REST API', () => {
  test('returns 400 when session IDs missing', async () => {
    const res = await fetch(`${API}/api/sessions/compare`);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('required');
  });

  test('returns 400 when project slug missing', async () => {
    const res = await fetch(`${API}/api/sessions/compare?a=x&b=y`);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Project');
  });

  test('returns 404 for nonexistent session A', async () => {
    const res = await fetch(`${API}/api/sessions/compare?a=nope&b=nope2&project=nonexistent-zzz`);
    expect(res.status).toBe(404);
  });

  test('route is wired and responds with JSON', async () => {
    const res = await fetch(`${API}/api/sessions/compare?a=x&b=y`);
    expect([400, 404]).toContain(res.status);
    const data = await res.json();
    expect(data).toHaveProperty('error');
  });
});

// ── compareSessions() Unit Tests ──

test.describe('Session Compare — compareSessions()', () => {
  test('returns correct session metadata', async () => {
    const { compareSessions } = await import('../server/routes/sessions.js');
    const result = compareSessions(sessionA, sessionB, 'proj-a', 'proj-b');

    expect(result.sessions.a.id).toBe('cmp-a1');
    expect(result.sessions.b.id).toBe('cmp-b1');
    expect(result.sessions.a.project).toBe('proj-a');
    expect(result.sessions.b.project).toBe('proj-b');
    expect(result.sessions.a.prompt).toBe('Build authentication module');
    expect(result.sessions.b.prompt).toBe('Build login page');
    expect(result.sessions.a.status).toBe('completed');
  });

  test('computes correct task counts', async () => {
    const { compareSessions } = await import('../server/routes/sessions.js');
    const result = compareSessions(sessionA, sessionB, 'p', 'p');

    expect(result.tasks.countA).toBe(3);
    expect(result.tasks.countB).toBe(4);
  });

  test('identifies shared task labels', async () => {
    const { compareSessions } = await import('../server/routes/sessions.js');
    const result = compareSessions(sessionA, sessionB, 'p', 'p');

    // Both have "Create auth middleware" and "Write unit tests"
    expect(result.tasks.shared).toContain('Create auth middleware');
    expect(result.tasks.shared).toContain('Write unit tests');
    expect(result.tasks.shared.length).toBe(2);
  });

  test('identifies tasks only in A', async () => {
    const { compareSessions } = await import('../server/routes/sessions.js');
    const result = compareSessions(sessionA, sessionB, 'p', 'p');

    expect(result.tasks.onlyA).toContain('Setup database schema');
    expect(result.tasks.onlyA.length).toBe(1);
  });

  test('identifies tasks only in B', async () => {
    const { compareSessions } = await import('../server/routes/sessions.js');
    const result = compareSessions(sessionA, sessionB, 'p', 'p');

    expect(result.tasks.onlyB).toContain('Build login form');
    expect(result.tasks.onlyB).toContain('Add OAuth provider');
    expect(result.tasks.onlyB.length).toBe(2);
  });

  test('calculates overlap percentage', async () => {
    const { compareSessions } = await import('../server/routes/sessions.js');
    const result = compareSessions(sessionA, sessionB, 'p', 'p');

    // 2 shared * 2 / (3 + 4) * 100 = 57%
    expect(result.tasks.overlapPct).toBe(57);
  });

  test('computes cost delta', async () => {
    const { compareSessions } = await import('../server/routes/sessions.js');
    const result = compareSessions(sessionA, sessionB, 'p', 'p');

    expect(result.cost.premiumA).toBe(1);
    expect(result.cost.premiumB).toBe(3);
    expect(result.cost.delta).toBe(2); // B - A
  });

  test('includes per-tier cost breakdown', async () => {
    const { compareSessions } = await import('../server/routes/sessions.js');
    const result = compareSessions(sessionA, sessionB, 'p', 'p');

    expect(result.cost.byTierA).toEqual({ T0: { count: 2 }, T2: { count: 1 } });
    expect(result.cost.byTierB).toEqual({ T0: { count: 1 }, T2: { count: 2 }, T3: { count: 1 } });
  });

  test('computes model usage by tier', async () => {
    const { compareSessions } = await import('../server/routes/sessions.js');
    const result = compareSessions(sessionA, sessionB, 'p', 'p');

    expect(result.models.a).toEqual({ T0: 2, T2: 1 });
    expect(result.models.b).toEqual({ T0: 1, T2: 2, T3: 1 });
  });

  test('computes duration and delta', async () => {
    const { compareSessions } = await import('../server/routes/sessions.js');
    const result = compareSessions(sessionA, sessionB, 'p', 'p');

    expect(result.duration.a).toBe(60000); // 120000 - 60000
    expect(result.duration.b).toBe(50000); // 60000 - 10000
    expect(result.duration.deltaMs).toBe(-10000); // 50000 - 60000
  });

  test('counts agents correctly', async () => {
    const { compareSessions } = await import('../server/routes/sessions.js');
    const result = compareSessions(sessionA, sessionB, 'p', 'p');

    expect(result.agents.countA).toBe(3);
    expect(result.agents.countB).toBe(4);
  });

  test('handles empty sessions gracefully', async () => {
    const { compareSessions } = await import('../server/routes/sessions.js');
    const empty = { id: 'empty', prompt: '', status: 'idle', tasks: [], agents: {} };
    const result = compareSessions(empty, empty, 'p', 'p');

    expect(result.tasks.countA).toBe(0);
    expect(result.tasks.countB).toBe(0);
    expect(result.tasks.shared).toEqual([]);
    expect(result.tasks.overlapPct).toBe(0);
    expect(result.cost.premiumA).toBe(0);
    expect(result.cost.premiumB).toBe(0);
    expect(result.agents.countA).toBe(0);
  });

  test('handles missing costSummary', async () => {
    const { compareSessions } = await import('../server/routes/sessions.js');
    const noCost = { id: 'nc', prompt: '', status: 'completed', tasks: [], agents: {} };
    const result = compareSessions(noCost, sessionB, 'p', 'p');

    expect(result.cost.premiumA).toBe(0);
    expect(result.cost.premiumB).toBe(3);
    expect(result.cost.delta).toBe(3);
    expect(result.cost.byTierA).toEqual({});
  });

  test('handles null duration when timestamps missing', async () => {
    const { compareSessions } = await import('../server/routes/sessions.js');
    const noTime = { id: 'nt', prompt: '', status: 'completed', tasks: [], agents: {} };
    const result = compareSessions(noTime, sessionB, 'p', 'p');

    expect(result.duration.a).toBeNull();
    expect(result.duration.deltaMs).toBeNull();
  });
});

// ── Client Integration ──

test.describe('Session Compare — Client Integration', () => {
  test('SessionCompare.vue component exists', () => {
    const fp = path.join(ROOT, 'client', 'src', 'components', 'SessionCompare.vue');
    expect(existsSync(fp)).toBe(true);
  });

  test('SessionCompare.vue fetches from compare endpoint', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'SessionCompare.vue'), 'utf-8');
    expect(src).toContain('/api/sessions/compare');
    expect(src).toContain('projectA');
    expect(src).toContain('projectB');
  });

  test('SessionCompare.vue renders comparison sections', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'SessionCompare.vue'), 'utf-8');
    expect(src).toContain('task');
    expect(src).toContain('overlap');
    expect(src).toContain('cost');
  });

  test('SessionHistory.vue has compare button', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'SessionHistory.vue'), 'utf-8');
    expect(src).toContain('compare-btn');
    expect(src).toContain('Compare');
  });

  test('SessionHistory.vue imports SessionCompare', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'SessionHistory.vue'), 'utf-8');
    expect(src).toContain('SessionCompare');
    expect(src).toContain('compareMode');
    expect(src).toContain('onCompareSelect');
  });

  test('SessionHistory.vue has compare mode state management', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'SessionHistory.vue'), 'utf-8');
    expect(src).toContain('compareA');
    expect(src).toContain('compareB');
    expect(src).toContain('showCompare');
    expect(src).toContain('exitCompare');
  });
});
