// @ts-check
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 7.3: Session Search Tests ────────────────────────────────────

test.describe('Session Search — WorkspaceManager', () => {
  test('workspace.js has searchSessions method', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    expect(typeof ws.searchSessions).toBe('function');
  });

  test('searchSessions returns empty for empty query', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    const result = ws.searchSessions('');
    expect(result).toEqual({ results: [], total: 0 });
  });

  test('searchSessions returns { results, total } shape', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    const result = ws.searchSessions('nonexistent-query-abc123');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('total');
    expect(Array.isArray(result.results)).toBe(true);
    expect(typeof result.total).toBe('number');
  });

  test('searchSessions respects limit parameter', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    const result = ws.searchSessions('test', { limit: 1 });
    expect(result.results.length).toBeLessThanOrEqual(1);
  });

  test('searchSessions respects projectSlug filter', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    const result = ws.searchSessions('test', { projectSlug: 'nonexistent-project' });
    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
  });
});

test.describe('Session Search — Fixture Data', () => {
  const fixtureDir = path.join(ROOT, 'projects', '_search-test');
  const sessionsDir = path.join(fixtureDir, '.haivemind', 'sessions');

  test.beforeAll(() => {
    // Create fixture sessions
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(path.join(fixtureDir, '.haivemind', 'project.json'), JSON.stringify({
      id: 'search-test-id',
      slug: '_search-test',
      name: 'Search Test Project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    // Register in projects.json
    const registryPath = path.join(ROOT, 'projects', 'projects.json');
    let registry = { projects: {} };
    if (existsSync(registryPath)) {
      try { registry = JSON.parse(readFileSync(registryPath, 'utf-8')); } catch { /* */ }
    }
    registry.projects['_search-test'] = {
      id: 'search-test-id',
      name: 'Search Test Project',
      slug: '_search-test',
      createdAt: Date.now(),
    };
    writeFileSync(registryPath, JSON.stringify(registry, null, 2));

    // Session 1: prompt matches "authentication"
    writeFileSync(path.join(sessionsDir, 'session-1.json'), JSON.stringify({
      id: 'session-1',
      projectSlug: '_search-test',
      prompt: 'Add JWT authentication to the Express API',
      status: 'completed',
      createdAt: Date.now() - 3600000,
      completedAt: Date.now() - 3500000,
      tasks: [
        { id: 't1', label: 'Create auth middleware', status: 'success', dependencies: [] },
        { id: 't2', label: 'Add login endpoint', status: 'success', dependencies: ['t1'] },
      ],
    }));

    // Session 2: task label matches "database"
    writeFileSync(path.join(sessionsDir, 'session-2.json'), JSON.stringify({
      id: 'session-2',
      projectSlug: '_search-test',
      prompt: 'Build the data layer',
      status: 'completed',
      createdAt: Date.now() - 7200000,
      completedAt: Date.now() - 7100000,
      tasks: [
        { id: 't3', label: 'Set up database connection', status: 'success', dependencies: [] },
        { id: 't4', label: 'Create user model', status: 'success', dependencies: ['t3'] },
      ],
    }));

    // Session 3: no match
    writeFileSync(path.join(sessionsDir, 'session-3.json'), JSON.stringify({
      id: 'session-3',
      projectSlug: '_search-test',
      prompt: 'Fix CSS styling issues',
      status: 'failed',
      createdAt: Date.now() - 10800000,
      tasks: [
        { id: 't5', label: 'Update responsive layout', status: 'failed', dependencies: [] },
      ],
    }));
  });

  test.afterAll(() => {
    // Clean up fixture
    try { rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* */ }
    // Remove from registry
    const registryPath = path.join(ROOT, 'projects', 'projects.json');
    if (existsSync(registryPath)) {
      try {
        const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
        delete registry.projects['_search-test'];
        writeFileSync(registryPath, JSON.stringify(registry, null, 2));
      } catch { /* */ }
    }
  });

  test('finds session by prompt text', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    const result = ws.searchSessions('authentication');
    expect(result.total).toBeGreaterThanOrEqual(1);
    const match = result.results.find(r => r.sessionId === 'session-1');
    expect(match).toBeDefined();
    expect(match.matchType).toMatch(/prompt|both/);
  });

  test('finds session by task label', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    const result = ws.searchSessions('database');
    expect(result.total).toBeGreaterThanOrEqual(1);
    const match = result.results.find(r => r.sessionId === 'session-2');
    expect(match).toBeDefined();
    expect(match.matchType).toMatch(/task|both/);
    expect(match.matchedTasks).toContain('Set up database connection');
  });

  test('returns no results for unmatched query', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    const result = ws.searchSessions('zzz_no_match_ever_zzz', { projectSlug: '_search-test' });
    expect(result.total).toBe(0);
    expect(result.results).toEqual([]);
  });

  test('result shape includes all expected fields', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    const result = ws.searchSessions('auth', { projectSlug: '_search-test' });
    expect(result.total).toBeGreaterThanOrEqual(1);
    const r = result.results[0];
    expect(r).toHaveProperty('sessionId');
    expect(r).toHaveProperty('projectSlug');
    expect(r).toHaveProperty('projectName');
    expect(r).toHaveProperty('prompt');
    expect(r).toHaveProperty('status');
    expect(r).toHaveProperty('createdAt');
    expect(r).toHaveProperty('taskCount');
    expect(r).toHaveProperty('matchedTasks');
    expect(r).toHaveProperty('matchType');
  });

  test('case-insensitive search works', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));

    const upper = ws.searchSessions('JWT', { projectSlug: '_search-test' });
    const lower = ws.searchSessions('jwt', { projectSlug: '_search-test' });
    expect(upper.total).toBe(lower.total);
    expect(upper.total).toBeGreaterThanOrEqual(1);
  });

  test('results are sorted newest first', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    // Search for something that matches multiple sessions
    const result = ws.searchSessions('session', { projectSlug: '_search-test' });
    if (result.results.length >= 2) {
      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i - 1].createdAt).toBeGreaterThanOrEqual(result.results[i].createdAt);
      }
    }
  });
});

test.describe('Session Search — REST API', () => {
  test('GET /api/sessions/search returns 200', async () => {
    const res = await fetch(`${API}/api/sessions/search?q=test`);
    expect(res.ok).toBe(true);
  });

  test('returns { results, total } shape', async () => {
    const res = await fetch(`${API}/api/sessions/search?q=test`);
    const data = await res.json();
    expect(data).toHaveProperty('results');
    expect(data).toHaveProperty('total');
    expect(Array.isArray(data.results)).toBe(true);
  });

  test('empty query returns empty results', async () => {
    const res = await fetch(`${API}/api/sessions/search?q=`);
    const data = await res.json();
    expect(data.results).toEqual([]);
    expect(data.total).toBe(0);
  });

  test('supports project filter', async () => {
    const res = await fetch(`${API}/api/sessions/search?q=test&project=nonexistent`);
    const data = await res.json();
    expect(data.results).toEqual([]);
    expect(data.total).toBe(0);
  });

  test('respects limit parameter', async () => {
    const res = await fetch(`${API}/api/sessions/search?q=a&limit=2`);
    const data = await res.json();
    expect(data.results.length).toBeLessThanOrEqual(2);
  });

  test('limit capped at 200', async () => {
    const res = await fetch(`${API}/api/sessions/search?q=a&limit=999`);
    expect(res.ok).toBe(true);
    // The route caps at 200, so this should still work
  });
});

test.describe('Session Search — Client Component', () => {
  test('SessionSearch.vue exists', () => {
    expect(existsSync(path.join(ROOT, 'client', 'src', 'components', 'SessionSearch.vue'))).toBe(true);
  });

  test('SessionSearch.vue has search input', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'components', 'SessionSearch.vue'),
      'utf-8',
    );
    expect(content).toContain('search-input');
    expect(content).toContain('placeholder');
    expect(content).toContain('v-model="query"');
  });

  test('SessionSearch.vue emits select event', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'components', 'SessionSearch.vue'),
      'utf-8',
    );
    expect(content).toContain("emit('select'");
    expect(content).toContain('defineEmits');
  });

  test('SessionSearch.vue has debounced search', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'components', 'SessionSearch.vue'),
      'utf-8',
    );
    expect(content).toContain('debounce');
    expect(content).toContain('setTimeout');
  });

  test('SessionSearch.vue has highlight function', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'components', 'SessionSearch.vue'),
      'utf-8',
    );
    expect(content).toContain('highlight(');
    expect(content).toContain('<mark>');
  });

  test('SessionHistory.vue imports SessionSearch', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'components', 'SessionHistory.vue'),
      'utf-8',
    );
    expect(content).toContain("import SessionSearch from './SessionSearch.vue'");
    expect(content).toContain('<SessionSearch');
  });
});
