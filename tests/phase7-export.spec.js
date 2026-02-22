// @ts-check
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 7.7: Export Sessions Tests ───────────────────────────────────

// ── REST API (uses running server's existing projects) ──

test.describe('Export Sessions — REST API', () => {
  test('export returns 404 for nonexistent project', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent-zzz/sessions/x/export?format=json`);
    expect(res.status).toBe(404);
  });

  test('export returns 404 for nonexistent session', async () => {
    const res = await fetch(`${API}/api/projects`);
    const projects = await res.json();
    if (projects.length === 0) return;
    const slug = projects[0].slug;
    const res2 = await fetch(`${API}/api/projects/${slug}/sessions/nonexistent-sess/export?format=json`);
    expect(res2.status).toBe(404);
  });

  test('export route exists and is wired correctly', async () => {
    // Even with bad project, we get a structured 404 — not a 500 or generic error
    const res = await fetch(`${API}/api/projects/no-project/sessions/no-session/export`);
    expect([404, 200]).toContain(res.status);
    const data = await res.json();
    expect(data).toHaveProperty('error');
  });
});

// ── Fixture-based unit tests (direct WorkspaceManager) ──

test.describe('Export Sessions — Unit Tests', () => {
  const fixtureDir = path.join(ROOT, 'projects', '_export-test');
  const sessionsDir = path.join(fixtureDir, '.haivemind', 'sessions');

  const sessionData = {
    id: 'session-e1',
    projectSlug: '_export-test',
    prompt: 'Build a REST API with authentication',
    status: 'completed',
    createdAt: Date.now() - 86400000,
    completedAt: Date.now() - 86300000,
    tasks: [
      { id: 't1', label: 'Create auth middleware', status: 'success', dependencies: [] },
      { id: 't2', label: 'Create user routes', status: 'success', dependencies: ['t1'] },
      { id: 't3', label: 'Write integration tests', status: 'success', dependencies: ['t1', 't2'] },
    ],
    agents: {
      'a1': { taskId: 't1', model: 'gpt-4o-mini', modelTier: 'T0', status: 'success', retries: 0 },
      'a2': { taskId: 't2', model: 'gpt-4o-mini', modelTier: 'T0', status: 'success', retries: 0 },
      'a3': { taskId: 't3', model: 'gpt-4o', modelTier: 'T2', status: 'success', retries: 1 },
    },
    edges: [
      { id: 'e1', source: 't1', target: 't2' },
      { id: 'e2', source: 't1', target: 't3' },
      { id: 'e3', source: 't2', target: 't3' },
    ],
    costSummary: {
      totalPremiumRequests: 1,
      byTier: { T0: { count: 2 }, T2: { count: 1 } },
    },
  };

  test.beforeAll(() => {
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(path.join(fixtureDir, '.haivemind', 'project.json'), JSON.stringify({
      id: 'export-test-id',
      slug: '_export-test',
      name: 'Export Test Project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
    writeFileSync(path.join(sessionsDir, 'session-e1.json'), JSON.stringify(sessionData));

    // Register in projects.json so getSession can find it
    const registryPath = path.join(ROOT, 'projects', 'projects.json');
    let registry = { projects: {} };
    if (existsSync(registryPath)) {
      try { registry = JSON.parse(readFileSync(registryPath, 'utf-8')); } catch { /* */ }
    }
    registry.projects['_export-test'] = {
      id: 'export-test-id',
      name: 'Export Test Project',
      slug: '_export-test',
      createdAt: Date.now(),
    };
    writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  });

  test.afterAll(() => {
    try { rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* */ }
    const registryPath = path.join(ROOT, 'projects', 'projects.json');
    if (existsSync(registryPath)) {
      try {
        const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
        delete registry.projects['_export-test'];
        writeFileSync(registryPath, JSON.stringify(registry, null, 2));
      } catch { /* */ }
    }
  });

  test('fixture session is readable by WorkspaceManager', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    const session = ws.getSession('_export-test', 'session-e1');
    expect(session).toBeTruthy();
    expect(session.id).toBe('session-e1');
  });

  test('session has all expected fields for export', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    const session = ws.getSession('_export-test', 'session-e1');
    expect(session.prompt).toBe('Build a REST API with authentication');
    expect(session.status).toBe('completed');
    expect(session.tasks.length).toBe(3);
    expect(Object.keys(session.agents).length).toBe(3);
    expect(session.edges.length).toBe(3);
    expect(session.costSummary).toBeTruthy();
  });

  test('returns null for nonexistent session', async () => {
    const mod = await import('../server/workspace.js');
    const ws = new mod.default(path.join(ROOT, 'projects'));
    const session = ws.getSession('_export-test', 'nonexistent');
    expect(session).toBeFalsy();
  });
});

// ── sessionToMarkdown unit tests ──

test.describe('Export Sessions — Markdown Generation', () => {
  let sessionToMarkdown;

  test.beforeAll(async () => {
    const mod = await import('../server/routes/sessions.js');
    sessionToMarkdown = mod.sessionToMarkdown;
  });

  const session = {
    id: 'session-e1',
    prompt: 'Build a REST API with authentication',
    status: 'completed',
    createdAt: Date.now() - 86400000,
    completedAt: Date.now() - 86300000,
    tasks: [
      { id: 't1', label: 'Create auth middleware', status: 'success', dependencies: [] },
      { id: 't2', label: 'Create user routes', status: 'success', dependencies: ['t1'] },
      { id: 't3', label: 'Write integration tests', status: 'success', dependencies: ['t1', 't2'] },
    ],
    agents: {
      'a1': { taskId: 't1', model: 'gpt-4o-mini', modelTier: 'T0', status: 'success', retries: 0 },
      'a2': { taskId: 't2', model: 'gpt-4o-mini', modelTier: 'T0', status: 'success', retries: 0 },
      'a3': { taskId: 't3', model: 'gpt-4o', modelTier: 'T2', status: 'success', retries: 1 },
    },
    costSummary: {
      totalPremiumRequests: 1,
      byTier: { T0: { count: 2 }, T2: { count: 1 } },
    },
  };

  test('generates Session Report header', () => {
    const md = sessionToMarkdown(session, '_export-test');
    expect(md).toContain('# Session Report');
  });

  test('includes project slug and session ID', () => {
    const md = sessionToMarkdown(session, '_export-test');
    expect(md).toContain('_export-test');
    expect(md).toContain('session-e1');
  });

  test('shows completed status', () => {
    const md = sessionToMarkdown(session, '_export-test');
    expect(md).toContain('Completed');
  });

  test('includes prompt section', () => {
    const md = sessionToMarkdown(session, '_export-test');
    expect(md).toContain('## Prompt');
    expect(md).toContain('Build a REST API with authentication');
  });

  test('includes task table with correct count', () => {
    const md = sessionToMarkdown(session, '_export-test');
    expect(md).toContain('## Tasks (3)');
    expect(md).toContain('Create auth middleware');
    expect(md).toContain('Create user routes');
    expect(md).toContain('Write integration tests');
  });

  test('includes agent table with correct count', () => {
    const md = sessionToMarkdown(session, '_export-test');
    expect(md).toContain('## Agents (3)');
    expect(md).toContain('gpt-4o-mini');
    expect(md).toContain('gpt-4o');
  });

  test('includes cost summary', () => {
    const md = sessionToMarkdown(session, '_export-test');
    expect(md).toContain('## Cost Summary');
    expect(md).toContain('Total Premium Requests');
  });

  test('includes footer', () => {
    const md = sessionToMarkdown(session, '_export-test');
    expect(md).toContain('Exported from hAIvemind');
  });

  test('includes duration when both timestamps present', () => {
    const md = sessionToMarkdown(session, '_export-test');
    expect(md).toContain('Duration');
  });

  test('handles session with no tasks gracefully', () => {
    const emptySession = { ...session, tasks: [], agents: {} };
    const md = sessionToMarkdown(emptySession, 'test');
    expect(md).toContain('# Session Report');
    // No Tasks section when empty
    expect(md).not.toContain('## Tasks');
  });

  test('handles session with no cost summary', () => {
    const noCostSession = { ...session, costSummary: null };
    const md = sessionToMarkdown(noCostSession, 'test');
    expect(md).toContain('# Session Report');
    expect(md).not.toContain('## Cost Summary');
  });
});

// ── Client Integration ──

test.describe('Export Sessions — Client Integration', () => {
  test('SessionHistory.vue has export buttons', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'components', 'SessionHistory.vue'),
      'utf-8',
    );
    expect(content).toContain('export-btn');
    expect(content).toContain('onExport');
    expect(content).toContain("'json'");
    expect(content).toContain("'markdown'");
  });

  test('SessionHistory.vue has export function with download logic', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'components', 'SessionHistory.vue'),
      'utf-8',
    );
    expect(content).toContain('async function onExport');
    expect(content).toContain('blob');
    expect(content).toContain('download');
    expect(content).toContain('createObjectURL');
  });

  test('export buttons have distinct format labels', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'components', 'SessionHistory.vue'),
      'utf-8',
    );
    expect(content).toContain('📥 JSON');
    expect(content).toContain('📝 MD');
  });
});
