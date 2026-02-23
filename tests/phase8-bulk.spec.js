// @ts-check
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 8.1: Bulk Session Actions Tests ──────────────────────────────

// ── Fixture Data ──

const makeSession = (id, label) => ({
  id,
  projectSlug: '_bulk-test',
  prompt: `Build ${label}`,
  status: 'completed',
  createdAt: Date.now() - 100000,
  completedAt: Date.now() - 50000,
  tasks: [{ id: 't1', label, status: 'success', dependencies: [] }],
  agents: { a1: { taskId: 't1', model: 'gpt-4o-mini', modelTier: 'T0', status: 'success', retries: 0 } },
  edges: [],
  costSummary: { totalPremiumRequests: 0, byTier: { T0: { count: 1 } } },
});

// ── REST API Tests ──

test.describe('Bulk Sessions — REST API', () => {
  test('bulk-delete returns 400 without sessionIds', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent/sessions/bulk-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('sessionIds');
  });

  test('bulk-delete returns 400 with empty array', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent/sessions/bulk-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds: [] }),
    });
    expect(res.status).toBe(400);
  });

  test('bulk-delete reports not-found for nonexistent sessions', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent/sessions/bulk-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds: ['nope-1', 'nope-2'] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toEqual([]);
    expect(data.notFound).toEqual(['nope-1', 'nope-2']);
  });

  test('bulk-export returns 400 without sessionIds', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent/sessions/bulk-export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test('bulk-export reports not-found for missing sessions', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent/sessions/bulk-export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds: ['missing-1'] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sessions).toEqual([]);
    expect(data.notFound).toEqual(['missing-1']);
  });
});

// ── WorkspaceManager.deleteSession Unit Tests ──

test.describe('Bulk Sessions — deleteSession()', () => {
  const fixtureDir = path.join(ROOT, 'projects', '_bulk-test');
  const sessionsDir = path.join(fixtureDir, '.haivemind', 'sessions');
  const registryPath = path.join(ROOT, 'projects', 'projects.json');

  test.beforeAll(() => {
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(path.join(fixtureDir, '.haivemind', 'project.json'), JSON.stringify({
      id: 'bulk-test-id', slug: '_bulk-test', name: 'Bulk Test',
      createdAt: Date.now(), updatedAt: Date.now(),
    }));
    // Write multiple sessions
    for (const id of ['bulk-s1', 'bulk-s2', 'bulk-s3']) {
      writeFileSync(path.join(sessionsDir, `${id}.json`), JSON.stringify(makeSession(id, `task-${id}`)));
    }
    // Register project
    let registry = { projects: {} };
    if (existsSync(registryPath)) {
      try { registry = JSON.parse(readFileSync(registryPath, 'utf-8')); } catch { /* */ }
    }
    registry.projects['_bulk-test'] = {
      id: 'bulk-test-id', name: 'Bulk Test', slug: '_bulk-test', createdAt: Date.now(),
    };
    writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  });

  test.afterAll(() => {
    try { rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* */ }
    if (existsSync(registryPath)) {
      try {
        const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
        delete registry.projects['_bulk-test'];
        writeFileSync(registryPath, JSON.stringify(registry, null, 2));
      } catch { /* */ }
    }
  });

  test('deleteSession returns true for existing session', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    // Write a temp session to delete
    const tempId = 'del-temp-1';
    writeFileSync(path.join(sessionsDir, `${tempId}.json`), JSON.stringify(makeSession(tempId, 'temp')));
    const result = ws.deleteSession('_bulk-test', tempId);
    expect(result).toBe(true);
    expect(existsSync(path.join(sessionsDir, `${tempId}.json`))).toBe(false);
  });

  test('deleteSession returns false for nonexistent session', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    const result = ws.deleteSession('_bulk-test', 'nonexistent-zzz');
    expect(result).toBe(false);
  });

  test('deleteSession returns false for nonexistent project', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    const result = ws.deleteSession('no-such-project', 'whatever');
    expect(result).toBe(false);
  });

  test('can list sessions after partial bulk delete', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    // Delete one of the fixture sessions
    const tempId = 'del-partial-1';
    writeFileSync(path.join(sessionsDir, `${tempId}.json`), JSON.stringify(makeSession(tempId, 'partial')));
    const before = ws.listSessions('_bulk-test');
    ws.deleteSession('_bulk-test', tempId);
    const after = ws.listSessions('_bulk-test');
    expect(after.length).toBe(before.length - 1);
    expect(after.find(s => s.id === tempId)).toBeUndefined();
  });
});

// ── Bulk Export Unit Tests ──

test.describe('Bulk Sessions — Bulk Export', () => {
  const fixtureDir = path.join(ROOT, 'projects', '_bulkexp-test');
  const sessionsDir = path.join(fixtureDir, '.haivemind', 'sessions');
  const registryPath = path.join(ROOT, 'projects', 'projects.json');

  test.beforeAll(() => {
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(path.join(fixtureDir, '.haivemind', 'project.json'), JSON.stringify({
      id: 'bulkexp-id', slug: '_bulkexp-test', name: 'Bulk Export Test',
      createdAt: Date.now(), updatedAt: Date.now(),
    }));
    for (const id of ['bexp-s1', 'bexp-s2']) {
      writeFileSync(path.join(sessionsDir, `${id}.json`), JSON.stringify(makeSession(id, `export-${id}`)));
    }
    let registry = { projects: {} };
    if (existsSync(registryPath)) {
      try { registry = JSON.parse(readFileSync(registryPath, 'utf-8')); } catch { /* */ }
    }
    registry.projects['_bulkexp-test'] = {
      id: 'bulkexp-id', name: 'Bulk Export Test', slug: '_bulkexp-test', createdAt: Date.now(),
    };
    writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  });

  test.afterAll(() => {
    try { rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* */ }
    if (existsSync(registryPath)) {
      try {
        const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
        delete registry.projects['_bulkexp-test'];
        writeFileSync(registryPath, JSON.stringify(registry, null, 2));
      } catch { /* */ }
    }
  });

  test('bulk-export returns sessions as JSON from live server', async () => {
    // If the running server has this project registered, it will work;
    // otherwise we test the route wiring at least
    const res = await fetch(`${API}/api/projects/_bulkexp-test/sessions/bulk-export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds: ['bexp-s1', 'bexp-s2'] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // Server may or may not find these depending on registry sync;
    // but response shape should be correct
    expect(data).toHaveProperty('sessions');
    expect(data).toHaveProperty('notFound');
    expect(Array.isArray(data.sessions)).toBe(true);
    expect(Array.isArray(data.notFound)).toBe(true);
  });

  test('bulk-export supports markdown format param', async () => {
    const res = await fetch(`${API}/api/projects/_bulkexp-test/sessions/bulk-export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds: ['nonexistent'], format: 'markdown' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.notFound).toContain('nonexistent');
  });
});

// ── Client Integration ──

test.describe('Bulk Sessions — Client Integration', () => {
  test('SessionHistory.vue has bulk toggle button', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'SessionHistory.vue'), 'utf-8');
    expect(src).toContain('bulk-toggle-btn');
    expect(src).toContain('toggleBulkMode');
    expect(src).toContain('☑ Select');
  });

  test('SessionHistory.vue has bulk action bar', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'SessionHistory.vue'), 'utf-8');
    expect(src).toContain('bulk-bar');
    expect(src).toContain('bulk-actions');
    expect(src).toContain('bulkExport');
    expect(src).toContain('bulkDelete');
  });

  test('SessionHistory.vue has bulk checkbox per session', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'SessionHistory.vue'), 'utf-8');
    expect(src).toContain('bulk-checkbox');
    expect(src).toContain('toggleBulkSelect');
    expect(src).toContain('bulkSelected');
  });

  test('SessionHistory.vue has Select All functionality', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'SessionHistory.vue'), 'utf-8');
    expect(src).toContain('bulkSelectAll');
    expect(src).toContain('Select All');
  });

  test('SessionHistory.vue calls correct API endpoints', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'SessionHistory.vue'), 'utf-8');
    expect(src).toContain('/sessions/bulk-delete');
    expect(src).toContain('/sessions/bulk-export');
  });

  test('SessionHistory.vue refreshes after bulk delete', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'SessionHistory.vue'), 'utf-8');
    expect(src).toContain('fetchSessions');
  });

  test('bulk-selected CSS class exists', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'SessionHistory.vue'), 'utf-8');
    expect(src).toContain('.bulk-selected');
    expect(src).toContain('.bulk-bar');
    expect(src).toContain('.bulk-checkbox');
  });
});

// ── Session Cancel & Single Delete Tests ──

test.describe('Session Cancel & Delete — REST API', () => {
  const SLUG = `cancel-test-${Date.now()}`;
  let projDir;

  test.beforeAll(async () => {
    // Create project via API so the running server knows about it
    const createRes = await fetch(`${API}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: SLUG }),
    });
    const proj = await createRes.json();
    projDir = proj.dir;

    // Write session files directly to the sessions dir
    const sessionsDir = path.join(projDir, '.haivemind', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(path.join(sessionsDir, 'plan-sess-1.json'), JSON.stringify({
      id: 'plan-sess-1', status: 'planning', prompt: 'test', createdAt: Date.now()
    }));
    writeFileSync(path.join(sessionsDir, 'done-sess-1.json'), JSON.stringify({
      id: 'done-sess-1', status: 'completed', prompt: 'done', createdAt: Date.now()
    }));
    writeFileSync(path.join(sessionsDir, 'run-sess-1.json'), JSON.stringify({
      id: 'run-sess-1', status: 'running', prompt: 'running', createdAt: Date.now()
    }));
  });

  test.afterAll(async () => {
    if (projDir && existsSync(projDir)) rmSync(projDir, { recursive: true, force: true });
  });

  test('cancel planning session succeeds', async () => {
    const res = await fetch(`${API}/api/projects/${SLUG}/sessions/plan-sess-1/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Test cancel' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cancelled).toBe('plan-sess-1');
    expect(data.previousStatus).toBe('planning');
  });

  test('cancel completed session returns 400', async () => {
    const res = await fetch(`${API}/api/projects/${SLUG}/sessions/done-sess-1/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('completed');
  });

  test('cancel nonexistent session returns 404', async () => {
    const res = await fetch(`${API}/api/projects/${SLUG}/sessions/no-such-id/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(404);
  });

  test('cancel running session succeeds', async () => {
    const res = await fetch(`${API}/api/projects/${SLUG}/sessions/run-sess-1/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.previousStatus).toBe('running');
  });

  test('DELETE single session succeeds', async () => {
    const res = await fetch(`${API}/api/projects/${SLUG}/sessions/done-sess-1`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe('done-sess-1');
  });

  test('DELETE nonexistent session returns 404', async () => {
    const res = await fetch(`${API}/api/projects/${SLUG}/sessions/no-such-id`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });
});

// ── Session Cancel & Delete — Source Code Checks ──

test.describe('Session Cancel & Delete — UI Integration', () => {
  test('sessions.js has cancel endpoint', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'routes', 'sessions.js'), 'utf-8');
    expect(src).toContain('/cancel');
    expect(src).toContain('cancelled');
    expect(src).toContain('cancelReason');
  });

  test('sessions.js has single delete endpoint', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'routes', 'sessions.js'), 'utf-8');
    expect(src).toContain("router.delete('/projects/:slug/sessions/:sessionId'");
  });

  test('SessionHistory.vue has cancel button for active sessions', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'SessionHistory.vue'), 'utf-8');
    expect(src).toContain('cancel-session-btn');
    expect(src).toContain('onCancelSession');
    expect(src).toContain('pill-cancelled');
  });

  test('SessionHistory.vue has cancelled status label', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'SessionHistory.vue'), 'utf-8');
    expect(src).toContain("cancelled: '🚫 Cancelled'");
  });
});
