// @ts-check
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 8.5: Session Tags & Filtering Tests ─────────────────────────

// ── Fixture Setup ──

const SLUG = '_tags-test';
const BASE_DIR = path.join(ROOT, '.haivemind-workspace');
const PROJ_DIR = path.join(BASE_DIR, SLUG);
const SESSIONS_DIR = path.join(PROJ_DIR, '.haivemind', 'sessions');
const REGISTRY = path.join(BASE_DIR, 'projects.json');

const now = Date.now();

const fixtureSession1 = {
  id: 'tag-s1',
  projectSlug: SLUG,
  prompt: 'Build feature A',
  status: 'completed',
  createdAt: now - 60000,
  completedAt: now - 30000,
  tasks: [{ id: 't1', label: 'Task 1', status: 'success' }],
  agents: {},
  edges: [],
  tags: ['frontend', 'urgent'],
};

const fixtureSession2 = {
  id: 'tag-s2',
  projectSlug: SLUG,
  prompt: 'Fix bug B',
  status: 'failed',
  createdAt: now - 120000,
  completedAt: now - 90000,
  tasks: [{ id: 't1', label: 'Task 1', status: 'failed' }],
  agents: {},
  edges: [],
  tags: ['backend'],
};

const fixtureSession3 = {
  id: 'tag-s3',
  projectSlug: SLUG,
  prompt: 'No tags session',
  status: 'completed',
  createdAt: now - 200000,
  completedAt: now - 180000,
  tasks: [],
  agents: {},
  edges: [],
};

let registryBackup = null;

test.beforeAll(() => {
  // Backup registry
  if (existsSync(REGISTRY)) registryBackup = readFileSync(REGISTRY, 'utf-8');

  // Create project + sessions
  mkdirSync(SESSIONS_DIR, { recursive: true });
  writeFileSync(path.join(SESSIONS_DIR, 'tag-s1.json'), JSON.stringify(fixtureSession1, null, 2));
  writeFileSync(path.join(SESSIONS_DIR, 'tag-s2.json'), JSON.stringify(fixtureSession2, null, 2));
  writeFileSync(path.join(SESSIONS_DIR, 'tag-s3.json'), JSON.stringify(fixtureSession3, null, 2));

  // Register project
  const registry = existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY, 'utf-8')) : { projects: {} };
  registry.projects[SLUG] = { name: 'Tags Test', slug: SLUG, directory: PROJ_DIR, createdAt: now };
  writeFileSync(REGISTRY, JSON.stringify(registry, null, 2));
});

test.afterAll(() => {
  // Restore registry
  if (registryBackup !== null) writeFileSync(REGISTRY, registryBackup);
  else if (existsSync(REGISTRY)) {
    const r = JSON.parse(readFileSync(REGISTRY, 'utf-8'));
    delete r.projects[SLUG];
    writeFileSync(REGISTRY, JSON.stringify(r, null, 2));
  }
  // Clean up fixture
  if (existsSync(PROJ_DIR)) rmSync(PROJ_DIR, { recursive: true, force: true });
});

// ── normalizeTags() Unit Tests ──

test.describe('Tags — normalizeTags()', () => {
  test('trims and lowercases tags', async () => {
    const { normalizeTags } = await import('../server/routes/sessions.js');
    const result = normalizeTags(['  Hello  ', 'WORLD', ' Foo ']);
    expect(result).toEqual(['hello', 'world', 'foo']);
  });

  test('deduplicates tags', async () => {
    const { normalizeTags } = await import('../server/routes/sessions.js');
    const result = normalizeTags(['bug', 'BUG', 'Bug', 'feature', 'bug']);
    expect(result).toEqual(['bug', 'feature']);
  });

  test('caps at 20 tags', async () => {
    const { normalizeTags } = await import('../server/routes/sessions.js');
    const tags = Array.from({ length: 30 }, (_, i) => `tag-${i}`);
    const result = normalizeTags(tags);
    expect(result).toHaveLength(20);
  });

  test('truncates long tags to 50 chars', async () => {
    const { normalizeTags } = await import('../server/routes/sessions.js');
    const longTag = 'a'.repeat(100);
    const result = normalizeTags([longTag]);
    expect(result[0]).toHaveLength(50);
  });

  test('filters empty and non-string tags', async () => {
    const { normalizeTags } = await import('../server/routes/sessions.js');
    const result = normalizeTags(['', '  ', null, undefined, 42, 'real']);
    expect(result).toEqual(['real']);
  });
});

// ── REST API — Tag CRUD Tests ──

test.describe('Tags — REST API', () => {
  test('GET tags returns 404 for nonexistent session', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent-zzz/sessions/nope/tags`);
    expect(res.status).toBe(404);
  });

  test('PUT tags returns 400 for non-array', async () => {
    const res = await fetch(`${API}/api/projects/any-slug/sessions/any-id/tags`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: 'not-array' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('array');
  });

  test('POST tags returns 400 for non-array', async () => {
    const res = await fetch(`${API}/api/projects/any-slug/sessions/any-id/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: 'string' }),
    });
    expect(res.status).toBe(400);
  });

  test('DELETE tag returns 404 for missing session', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent-zzz/sessions/nope/tags/test`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  test('GET project tags route is wired', async () => {
    const res = await fetch(`${API}/api/projects/any-slug/tags`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('tags');
    expect(Array.isArray(data.tags)).toBe(true);
  });

  test('session list route supports status filter', async () => {
    const res = await fetch(`${API}/api/projects/any-slug/sessions?status=completed`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('session list route supports tag filter', async () => {
    const res = await fetch(`${API}/api/projects/any-slug/sessions?tag=frontend`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('session list route supports date range filter', async () => {
    const res = await fetch(`${API}/api/projects/any-slug/sessions?from=1000&to=9999999999999`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});

// ── Filtering via WorkspaceManager (direct unit tests) ──

test.describe('Tags — Filtering & Aggregation', () => {
  test('listSessions returns sessions with tags', async () => {
    const WorkspaceManager = (await import('../server/workspace.js')).default;
    const ws = new WorkspaceManager();
    const all = ws.listSessions(SLUG);
    expect(all.length).toBe(3);
    const s1 = all.find(s => s.id === 'tag-s1');
    expect(s1.tags).toContain('frontend');
  });

  test('filter sessions by status', async () => {
    const WorkspaceManager = (await import('../server/workspace.js')).default;
    const ws = new WorkspaceManager();
    const all = ws.listSessions(SLUG);
    const completed = all.filter(s => s.status === 'completed');
    expect(completed.length).toBe(2);
    const failed = all.filter(s => s.status === 'failed');
    expect(failed.length).toBe(1);
    expect(failed[0].id).toBe('tag-s2');
  });

  test('filter sessions by tag', async () => {
    const WorkspaceManager = (await import('../server/workspace.js')).default;
    const ws = new WorkspaceManager();
    const all = ws.listSessions(SLUG);
    const withFrontend = all.filter(s => (s.tags || []).includes('frontend'));
    expect(withFrontend.length).toBe(1);
    expect(withFrontend[0].id).toBe('tag-s1');
  });

  test('filter sessions by date range', async () => {
    const WorkspaceManager = (await import('../server/workspace.js')).default;
    const ws = new WorkspaceManager();
    const all = ws.listSessions(SLUG);
    const from = now - 130000;
    const to = now - 50000;
    const filtered = all.filter(s => s.createdAt >= from && s.createdAt <= to);
    const ids = filtered.map(s => s.id);
    expect(ids).toContain('tag-s1');
    expect(ids).toContain('tag-s2');
    expect(ids).not.toContain('tag-s3');
  });

  test('aggregate unique tags across sessions', async () => {
    const WorkspaceManager = (await import('../server/workspace.js')).default;
    const ws = new WorkspaceManager();
    const all = ws.listSessions(SLUG);
    const tagSet = new Set();
    for (const s of all) for (const t of (s.tags || [])) tagSet.add(t);
    expect(tagSet.has('frontend')).toBe(true);
    expect(tagSet.has('urgent')).toBe(true);
    expect(tagSet.has('backend')).toBe(true);
  });
});

// ── Workspace.updateSession() Unit Tests ──

test.describe('Tags — updateSession()', () => {
  test('updateSession merges patch into session', async () => {
    const WorkspaceManager = (await import('../server/workspace.js')).default;
    const ws = new WorkspaceManager();
    const session = ws.getSession(SLUG, 'tag-s3');
    expect(session).toBeTruthy();
    expect(session.tags).toBeUndefined();

    const updated = ws.updateSession(SLUG, 'tag-s3', { tags: ['new-tag'] });
    expect(updated).toBeTruthy();
    expect(updated.tags).toEqual(['new-tag']);

    // Read back to verify persistence
    const session2 = ws.getSession(SLUG, 'tag-s3');
    expect(session2.tags).toEqual(['new-tag']);

    // Clean up
    ws.updateSession(SLUG, 'tag-s3', { tags: undefined });
  });

  test('updateSession returns null for nonexistent session', async () => {
    const WorkspaceManager = (await import('../server/workspace.js')).default;
    const ws = new WorkspaceManager();
    const result = ws.updateSession(SLUG, 'nope', { tags: [] });
    expect(result).toBeNull();
  });

  test('updateSession returns null for nonexistent project', async () => {
    const WorkspaceManager = (await import('../server/workspace.js')).default;
    const ws = new WorkspaceManager();
    const result = ws.updateSession('nonexistent-xxx', 'nope', { tags: [] });
    expect(result).toBeNull();
  });
});

// ── Client Component Tests ──

test.describe('Tags — Client Components', () => {
  test('SessionHistory has filter bar', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/SessionHistory.vue'), 'utf8');
    expect(content).toContain('filter-bar');
    expect(content).toContain('filter-select');
    expect(content).toContain('filterStatus');
    expect(content).toContain('filterTag');
  });

  test('SessionHistory has tag chip UI', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/SessionHistory.vue'), 'utf8');
    expect(content).toContain('tag-chip');
    expect(content).toContain('tag-add-btn');
    expect(content).toContain('tag-remove');
    expect(content).toContain('tag-input');
  });

  test('SessionHistory has tag management functions', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/SessionHistory.vue'), 'utf8');
    expect(content).toContain('addTag');
    expect(content).toContain('removeTag');
    expect(content).toContain('startAddTag');
  });

  test('SessionHistory has allTags computed', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/SessionHistory.vue'), 'utf8');
    expect(content).toContain('allTags');
    expect(content).toContain('clear-filters');
  });

  test('filter bar includes status dropdown', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/SessionHistory.vue'), 'utf8');
    expect(content).toContain('All statuses');
    expect(content).toContain('Completed');
    expect(content).toContain('Failed');
  });
});
