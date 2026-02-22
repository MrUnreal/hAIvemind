/**
 * Phase 10.1 — Agent Memory Tests
 *
 * Tests for agent memory service (CRUD, recall, tags, stats, touch, clear),
 * REST endpoints (all 10 routes + 404s), and client component integration.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, existsSync, rmSync, readFileSync } from 'fs';

const API = 'http://localhost:3000/api';
const TEST_DIR = '.haivemind-workspace';

let WorkspaceManager, refs, memory;

test.beforeAll(async () => {
  const wsModule = await import('../server/workspace.js');
  WorkspaceManager = wsModule.default;
  const stateModule = await import('../server/state.js');
  refs = stateModule.refs;
  memory = await import('../server/services/agentMemory.js');

  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  const wm = new WorkspaceManager(TEST_DIR);
  refs.workspace = wm;
  try { wm.createProject('memory-proj'); } catch { /* exists */ }
});

test.afterAll(async () => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  1 · MEMORY SERVICE — CRUD
// ═══════════════════════════════════════════════════════════════════

test.describe('Agent Memory Service — CRUD', () => {
  test('addMemory creates entry with correct fields', () => {
    const entry = memory.addMemory('memory-proj', {
      type: 'pattern',
      key: 'test-key',
      content: 'Always use async/await',
      tags: ['style', 'async'],
    });
    expect(entry.id).toMatch(/^mem-/);
    expect(entry.type).toBe('pattern');
    expect(entry.key).toBe('test-key');
    expect(entry.content).toBe('Always use async/await');
    expect(entry.tags).toEqual(['style', 'async']);
    expect(entry.accessCount).toBe(0);
    expect(entry.createdAt).toBeTruthy();
    expect(entry.updatedAt).toBeTruthy();
  });

  test('addMemory defaults to note type for invalid type', () => {
    const entry = memory.addMemory('memory-proj', {
      type: 'invalid-type',
      content: 'fallback test',
    });
    expect(entry.type).toBe('note');
  });

  test('getMemories returns all entries', () => {
    const { entries, total } = memory.getMemories('memory-proj');
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(total).toBeGreaterThanOrEqual(2);
  });

  test('getMemories filters by type', () => {
    const { entries } = memory.getMemories('memory-proj', { type: 'pattern' });
    for (const e of entries) expect(e.type).toBe('pattern');
  });

  test('getMemories filters by search term', () => {
    const { entries } = memory.getMemories('memory-proj', { search: 'async' });
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  test('getMemory returns single entry by ID', () => {
    const added = memory.addMemory('memory-proj', { type: 'error', key: 'err1', content: 'OOM' });
    const found = memory.getMemory('memory-proj', added.id);
    expect(found).toBeTruthy();
    expect(found.id).toBe(added.id);
  });

  test('getMemory returns null for unknown ID', () => {
    expect(memory.getMemory('memory-proj', 'mem-nonexistent')).toBeNull();
  });

  test('updateMemory patches fields', () => {
    const added = memory.addMemory('memory-proj', { type: 'note', key: 'upd1', content: 'original' });
    const updated = memory.updateMemory('memory-proj', added.id, { content: 'modified', tags: ['x'] });
    expect(updated.content).toBe('modified');
    expect(updated.tags).toEqual(['x']);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(added.updatedAt).getTime());
  });

  test('updateMemory returns null for invalid ID', () => {
    expect(memory.updateMemory('memory-proj', 'mem-nope', { content: 'x' })).toBeNull();
  });

  test('removeMemory deletes entry', () => {
    const added = memory.addMemory('memory-proj', { type: 'note', key: 'del', content: 'bye' });
    expect(memory.removeMemory('memory-proj', added.id)).toBe(true);
    expect(memory.getMemory('memory-proj', added.id)).toBeNull();
  });

  test('removeMemory returns false for invalid ID', () => {
    expect(memory.removeMemory('memory-proj', 'mem-nope')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  2 · MEMORY SERVICE — Touch & Recall
// ═══════════════════════════════════════════════════════════════════

test.describe('Agent Memory Service — Touch & Recall', () => {
  test('touchMemory increments access count', () => {
    const added = memory.addMemory('memory-proj', { type: 'context', key: 'tc1', content: 'touch test' });
    expect(added.accessCount).toBe(0);
    const touched = memory.touchMemory('memory-proj', added.id);
    expect(touched.accessCount).toBe(1);
    expect(touched.lastAccessedAt).toBeTruthy();
    const again = memory.touchMemory('memory-proj', added.id);
    expect(again.accessCount).toBe(2);
  });

  test('touchMemory returns null for invalid ID', () => {
    expect(memory.touchMemory('memory-proj', 'mem-nope')).toBeNull();
  });

  test('recallMemories returns matching entries sorted by score', () => {
    memory.clearMemories('memory-proj');
    memory.addMemory('memory-proj', { type: 'pattern', key: 'auth', content: 'Use JWT for authentication' });
    memory.addMemory('memory-proj', { type: 'error', key: 'db-timeout', content: 'Database connection timeout' });
    memory.addMemory('memory-proj', { type: 'note', key: 'readme', content: 'Update readme with auth docs' });

    const results = memory.recallMemories('memory-proj', 'auth');
    expect(results.length).toBeGreaterThanOrEqual(2);
    // First result should have highest relevance to 'auth'
    expect(results[0].key).toContain('auth');
  });

  test('recallMemories respects limit', () => {
    const results = memory.recallMemories('memory-proj', 'auth', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  test('recallMemories returns empty for no match', () => {
    const results = memory.recallMemories('memory-proj', 'xyznonexistent');
    expect(results.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  3 · MEMORY SERVICE — Tags, Stats, Clear
// ═══════════════════════════════════════════════════════════════════

test.describe('Agent Memory Service — Tags, Stats, Clear', () => {
  test('getTags returns sorted unique tags', () => {
    memory.clearMemories('memory-proj');
    memory.addMemory('memory-proj', { type: 'note', key: 'a', content: 'x', tags: ['beta', 'alpha'] });
    memory.addMemory('memory-proj', { type: 'note', key: 'b', content: 'y', tags: ['alpha', 'gamma'] });
    const tags = memory.getTags('memory-proj');
    expect(tags).toEqual(['alpha', 'beta', 'gamma']);
  });

  test('getMemoryStats returns correct counts', () => {
    memory.clearMemories('memory-proj');
    memory.addMemory('memory-proj', { type: 'pattern', key: 'p1', content: 'x', tags: ['a'] });
    memory.addMemory('memory-proj', { type: 'pattern', key: 'p2', content: 'y', tags: ['b'] });
    memory.addMemory('memory-proj', { type: 'error', key: 'e1', content: 'z' });

    const stats = memory.getMemoryStats('memory-proj');
    expect(stats.total).toBe(3);
    expect(stats.byType.pattern).toBe(2);
    expect(stats.byType.error).toBe(1);
    expect(stats.totalTags).toBe(2);
    expect(stats.totalAccesses).toBe(0);
  });

  test('clearMemories removes all entries', () => {
    memory.clearMemories('memory-proj');
    const { total } = memory.getMemories('memory-proj');
    expect(total).toBe(0);
  });

  test('MEMORY_TYPES has 6 types', () => {
    expect(memory.MEMORY_TYPES).toEqual([
      'pattern', 'error', 'preference', 'convention', 'context', 'note',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  4 · REST ENDPOINTS — Agent Memory
// ═══════════════════════════════════════════════════════════════════

test.describe('REST — Agent Memory Endpoints', () => {
  const PROJ = `mem-route-${Date.now()}`;
  let createdId;

  test.beforeAll(async ({ request }) => {
    await request.post(`${API}/projects`, { data: { name: PROJ } });
  });

  test('POST /memory creates a memory entry', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/memory`, {
      data: { type: 'convention', key: 'naming', content: 'Use camelCase for variables', tags: ['style'] },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^mem-/);
    expect(body.type).toBe('convention');
    createdId = body.id;
  });

  test('GET /memory returns list', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/memory`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.entries).toBeInstanceOf(Array);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  test('GET /memory?type=convention filters by type', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/memory?type=convention`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    for (const e of body.entries) expect(e.type).toBe('convention');
  });

  test('GET /memory?search=camelCase filters by search', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/memory?search=camelCase`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.entries.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /memory/stats returns stats', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/memory/stats`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.total).toBe('number');
    expect(typeof body.totalTags).toBe('number');
    expect(body.byType).toBeTruthy();
  });

  test('GET /memory/tags returns tag list', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/memory/tags`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toBeInstanceOf(Array);
  });

  test('GET /memory/recall?q=naming returns recalled entries', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/memory/recall?q=naming`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toBeInstanceOf(Array);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /memory/:memId returns single entry', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/memory/${createdId}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.id).toBe(createdId);
  });

  test('GET /memory/:memId returns 404 for unknown', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/memory/mem-nonexistent`);
    expect(res.status()).toBe(404);
  });

  test('PATCH /memory/:memId updates entry', async ({ request }) => {
    const res = await request.patch(`${API}/projects/${PROJ}/memory/${createdId}`, {
      data: { content: 'Updated: use camelCase everywhere', tags: ['style', 'updated'] },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.content).toContain('Updated');
    expect(body.tags).toContain('updated');
  });

  test('PATCH /memory/:memId returns 404 for unknown', async ({ request }) => {
    const res = await request.patch(`${API}/projects/${PROJ}/memory/mem-nonexistent`, {
      data: { content: 'x' },
    });
    expect(res.status()).toBe(404);
  });

  test('POST /memory/:memId/touch increments access', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/memory/${createdId}/touch`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.accessCount).toBeGreaterThanOrEqual(1);
  });

  test('POST /memory/:memId/touch returns 404 for unknown', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/memory/mem-nonexistent/touch`);
    expect(res.status()).toBe(404);
  });

  test('DELETE /memory/:memId removes entry', async ({ request }) => {
    const res = await request.delete(`${API}/projects/${PROJ}/memory/${createdId}`);
    expect(res.ok()).toBe(true);
    // Verify gone
    const check = await request.get(`${API}/projects/${PROJ}/memory/${createdId}`);
    expect(check.status()).toBe(404);
  });

  test('DELETE /memory/:memId returns 404 for unknown', async ({ request }) => {
    const res = await request.delete(`${API}/projects/${PROJ}/memory/mem-nonexistent`);
    expect(res.status()).toBe(404);
  });

  test('DELETE /memory clears all memories', async ({ request }) => {
    // Add a few first
    await request.post(`${API}/projects/${PROJ}/memory`, {
      data: { type: 'note', key: 'tmp', content: 'temporary' },
    });
    const res = await request.delete(`${API}/projects/${PROJ}/memory`);
    expect(res.ok()).toBe(true);
    const after = await request.get(`${API}/projects/${PROJ}/memory`);
    const body = await after.json();
    expect(body.total).toBe(0);
  });

  test('GET /memory returns 404 for nonexistent project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/memory`);
    expect(res.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  5 · CLIENT INTEGRATION — MemoryPanel.vue
// ═══════════════════════════════════════════════════════════════════

test.describe('Client Integration — MemoryPanel.vue', () => {
  let src;

  test.beforeAll(async () => {
    src = readFileSync('client/src/components/MemoryPanel.vue', 'utf-8');
  });

  test('component has memory-panel class', () => {
    expect(src).toContain('memory-panel');
  });

  test('component supports type filter', () => {
    expect(src).toContain('filterType');
    expect(src).toContain('memory-select');
  });

  test('component supports search', () => {
    expect(src).toContain('searchQuery');
    expect(src).toContain('memory-search');
  });

  test('component supports recall', () => {
    expect(src).toContain('recallQuery');
    expect(src).toContain('doRecall');
  });

  test('component supports add/edit/delete', () => {
    expect(src).toContain('saveMemory');
    expect(src).toContain('deleteMemory');
    expect(src).toContain('startEdit');
  });

  test('component displays tags', () => {
    expect(src).toContain('memory-tag');
    expect(src).toContain('memory-tags');
  });

  test('component has clear all button', () => {
    expect(src).toContain('clearAll');
    expect(src).toContain('memory-clear-btn');
  });

  test('component has scoped styles', () => {
    expect(src).toContain('<style scoped>');
    expect(src).toContain('memory-type-badge');
  });

  test('component shows memory stats', () => {
    expect(src).toContain('memStats');
    expect(src).toContain('memory-stats');
  });

  test('component list all 6 memory types', () => {
    for (const t of ['pattern', 'error', 'preference', 'convention', 'context', 'note']) {
      expect(src).toContain(t);
    }
  });
});
