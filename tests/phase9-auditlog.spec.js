/**
 * Phase 9.6 — Audit Log tests
 *
 * Service unit tests, REST API tests, component source tests.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';
const SLUG = 'nonexistent-zzz';

// ────── Service unit tests ──────

test.describe('Phase 9.6 — Audit Log service', () => {
  let auditLog;
  let refs;
  let WorkspaceManager;
  let fs;
  let path;

  const TEST_DIR = '.haivemind-workspace-test-audit';
  const TEST_SLUG = 'audit-test-project';

  test.beforeAll(async () => {
    auditLog = await import('../server/services/auditLog.js');
    const stateMod = await import('../server/state.js');
    refs = stateMod.refs;
    const wsMod = await import('../server/workspace.js');
    WorkspaceManager = wsMod.default;
    fs = await import('fs');
    path = await import('path');

    const dir = path.default.resolve(TEST_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const wm = new WorkspaceManager(TEST_DIR);
    wm.createProject(TEST_SLUG, { slug: TEST_SLUG });
    refs.workspace = wm;
  });

  test.afterAll(async () => {
    const fsMod = await import('fs');
    try { fsMod.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* */ }
  });

  test('getAuditLog returns empty initially', () => {
    const result = auditLog.getAuditLog(TEST_SLUG);
    expect(result.entries).toEqual([]);
    expect(result.total).toBe(0);
  });

  test('appendAuditEntry creates an entry', () => {
    const entry = auditLog.appendAuditEntry(TEST_SLUG, {
      action: 'session.start',
      actor: 'user',
      details: { prompt: 'test' },
    });
    expect(entry.id).toMatch(/^aud-/);
    expect(entry.action).toBe('session.start');
    expect(entry.actor).toBe('user');
    expect(entry.details.prompt).toBe('test');
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  test('entries are ordered newest first', () => {
    auditLog.appendAuditEntry(TEST_SLUG, { action: 'session.complete', actor: 'system' });
    const result = auditLog.getAuditLog(TEST_SLUG);
    expect(result.entries.length).toBe(2);
    expect(result.entries[0].action).toBe('session.complete');
    expect(result.entries[1].action).toBe('session.start');
  });

  test('filter by action', () => {
    const result = auditLog.getAuditLog(TEST_SLUG, { action: 'session.start' });
    expect(result.total).toBe(1);
    expect(result.entries[0].action).toBe('session.start');
  });

  test('filter by actor', () => {
    const result = auditLog.getAuditLog(TEST_SLUG, { actor: 'user' });
    expect(result.total).toBe(1);
    expect(result.entries[0].actor).toBe('user');
  });

  test('pagination with limit and offset', () => {
    // Add more entries
    for (let i = 0; i < 5; i++) {
      auditLog.appendAuditEntry(TEST_SLUG, { action: 'custom', actor: 'bot' });
    }
    const page1 = auditLog.getAuditLog(TEST_SLUG, { limit: 3, offset: 0 });
    expect(page1.entries.length).toBe(3);
    expect(page1.total).toBe(7);
    const page2 = auditLog.getAuditLog(TEST_SLUG, { limit: 3, offset: 3 });
    expect(page2.entries.length).toBe(3);
    const page3 = auditLog.getAuditLog(TEST_SLUG, { limit: 3, offset: 6 });
    expect(page3.entries.length).toBe(1);
  });

  test('getActors returns unique actors', () => {
    const actors = auditLog.getActors(TEST_SLUG);
    expect(actors).toContain('user');
    expect(actors).toContain('system');
    expect(actors).toContain('bot');
    expect(new Set(actors).size).toBe(actors.length);
  });

  test('defaults actor to system', () => {
    const entry = auditLog.appendAuditEntry(TEST_SLUG, { action: 'custom' });
    expect(entry.actor).toBe('system');
  });

  test('defaults action to custom', () => {
    const entry = auditLog.appendAuditEntry(TEST_SLUG, {});
    expect(entry.action).toBe('custom');
  });

  test('clearAuditLog removes all entries', () => {
    const count = auditLog.clearAuditLog(TEST_SLUG);
    expect(count).toBeGreaterThan(0);
    const result = auditLog.getAuditLog(TEST_SLUG);
    expect(result.total).toBe(0);
  });

  test('ACTIONS and MAX_ENTRIES are exported', () => {
    expect(auditLog.ACTIONS).toContain('session.start');
    expect(auditLog.ACTIONS).toContain('custom');
    expect(auditLog.MAX_ENTRIES).toBe(500);
  });

  test('entries are capped at MAX_ENTRIES', () => {
    // Add 510 entries
    for (let i = 0; i < 510; i++) {
      auditLog.appendAuditEntry(TEST_SLUG, { action: 'custom', actor: 'stress' });
    }
    const result = auditLog.getAuditLog(TEST_SLUG, { limit: 600 });
    expect(result.total).toBeLessThanOrEqual(500);
    auditLog.clearAuditLog(TEST_SLUG);
  });
});

// ────── REST API tests ──────

test.describe('Phase 9.6 — Audit Log REST endpoints', () => {
  test('GET /api/projects/:slug/audit-log returns 404 for unknown project', async () => {
    const res = await fetch(`${BASE}/api/projects/${SLUG}/audit-log`);
    expect(res.status).toBe(404);
  });

  test('POST /api/projects/:slug/audit-log returns 404 for unknown project', async () => {
    const res = await fetch(`${BASE}/api/projects/${SLUG}/audit-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test' }),
    });
    expect(res.status).toBe(404);
  });

  test('GET /api/projects/:slug/audit-log/actors returns 404 for unknown project', async () => {
    const res = await fetch(`${BASE}/api/projects/${SLUG}/audit-log/actors`);
    expect(res.status).toBe(404);
  });

  test('DELETE /api/projects/:slug/audit-log returns 404 for unknown project', async () => {
    const res = await fetch(`${BASE}/api/projects/${SLUG}/audit-log`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

// ────── Component source tests ──────

test.describe('Phase 9.6 — AuditLogPanel component', () => {
  let src;

  test.beforeAll(async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    src = readFileSync(resolve('client/src/components/AuditLogPanel.vue'), 'utf-8');
  });

  test('component has visible and projectSlug props', () => {
    expect(src).toContain('visible');
    expect(src).toContain('projectSlug');
  });

  test('fetches audit-log endpoint', () => {
    expect(src).toContain('/audit-log');
  });

  test('supports action and actor filters', () => {
    expect(src).toContain('filterAction');
    expect(src).toContain('filterActor');
  });

  test('has pagination controls', () => {
    expect(src).toContain('prevPage');
    expect(src).toContain('nextPage');
    expect(src).toContain('PAGE_SIZE');
  });

  test('supports clear all', () => {
    expect(src).toContain('clearLog');
    expect(src).toContain('Clear All');
  });

  test('has action icons and classes', () => {
    expect(src).toContain('actionIcon');
    expect(src).toContain('actionClass');
    expect(src).toContain('success');
    expect(src).toContain('danger');
  });

  test('shows details as JSON', () => {
    expect(src).toContain('JSON.stringify');
    expect(src).toContain('audit-details');
  });

  test('uses CSS variables for theming', () => {
    expect(src).toContain('var(--bg-card)');
    expect(src).toContain('var(--text-primary)');
  });

  test('has timeAgo helper', () => {
    expect(src).toContain('timeAgo');
  });
});

// ────── App.vue integration tests ──────

test.describe('Phase 9.6 — App.vue integration', () => {
  let appSrc;

  test.beforeAll(async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    appSrc = readFileSync(resolve('client/src/App.vue'), 'utf-8');
  });

  test('imports AuditLogPanel', () => {
    expect(appSrc).toContain("import AuditLogPanel from './components/AuditLogPanel.vue'");
  });

  test('has Audit tab button', () => {
    expect(appSrc).toContain('📜 Audit');
  });

  test('renders AuditLogPanel in side content', () => {
    expect(appSrc).toContain('AuditLogPanel');
    expect(appSrc).toContain("sideTab === 'audit'");
  });
});
