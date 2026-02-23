/**
 * Phase 10.7 — Workspace Snapshots Tests
 *
 * Tests for workspace snapshot service (create, list, get, restore, diff,
 * delete, stats, clear), REST endpoints, and edge cases.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, existsSync, rmSync } from 'fs';

const API = 'http://localhost:3000/api';
const TEST_DIR = '.haivemind-workspace';

let WorkspaceManager, refs, snapshots;

test.beforeAll(async () => {
  const wsModule = await import('../server/workspace.js');
  WorkspaceManager = wsModule.default;
  const stateModule = await import('../server/state.js');
  refs = stateModule.refs;
  snapshots = await import('../server/services/workspaceSnapshots.js');

  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  const wm = new WorkspaceManager(TEST_DIR);
  refs.workspace = wm;
  try { wm.createProject('snap-proj'); } catch { /* exists */ }
});

test.afterAll(async () => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  1 · SNAPSHOT SERVICE — Create + List
// ═══════════════════════════════════════════════════════════════════

test.describe('Workspace Snapshots — Create + List', () => {
  const SLUG = 'snap-proj';

  test.beforeAll(() => snapshots.clearSnapshots(SLUG));

  test('createSnapshot returns snapshot metadata', () => {
    const s = snapshots.createSnapshot(SLUG, { name: 'Test Snap', description: 'desc' });
    expect(s.id).toMatch(/^snap-/);
    expect(s.name).toBe('Test Snap');
    expect(s.description).toBe('desc');
    expect(s.auto).toBe(false);
    expect(s.createdAt).toBeTruthy();
  });

  test('createSnapshot auto-names when no name given', () => {
    const s = snapshots.createSnapshot(SLUG);
    expect(s.name).toMatch(/^Snapshot/);
  });

  test('listSnapshots returns created snapshots', () => {
    const { snapshots: list, total } = snapshots.listSnapshots(SLUG);
    expect(total).toBeGreaterThanOrEqual(2);
    expect(list[0].id).toMatch(/^snap-/);
  });

  test('createSnapshot with auto flag', () => {
    const s = snapshots.createSnapshot(SLUG, { auto: true });
    expect(s.auto).toBe(true);
  });

  test('listSnapshots filters by auto', () => {
    const { snapshots: list } = snapshots.listSnapshots(SLUG, { auto: true });
    expect(list.every(s => s.auto === true)).toBe(true);
  });

  test('listSnapshots respects limit', () => {
    const { snapshots: list } = snapshots.listSnapshots(SLUG, { limit: 1 });
    expect(list).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  2 · SNAPSHOT SERVICE — Get + Update
// ═══════════════════════════════════════════════════════════════════

test.describe('Workspace Snapshots — Get + Update', () => {
  const SLUG = 'snap-proj';
  let snapId;

  test.beforeAll(() => {
    snapshots.clearSnapshots(SLUG);
    const s = snapshots.createSnapshot(SLUG, { name: 'Get Test' });
    snapId = s.id;
  });

  test('getSnapshot returns full snapshot with data', () => {
    const s = snapshots.getSnapshot(SLUG, snapId);
    expect(s).toBeTruthy();
    expect(s.name).toBe('Get Test');
    expect(s.data).toBeTruthy();
    expect(s.data.capturedAt).toBeTruthy();
  });

  test('getSnapshot returns null for unknown ID', () => {
    expect(snapshots.getSnapshot(SLUG, 'nope')).toBeNull();
  });

  test('updateSnapshot renames a snapshot', () => {
    const s = snapshots.updateSnapshot(SLUG, snapId, { name: 'Renamed', description: 'new desc' });
    expect(s.name).toBe('Renamed');
    expect(s.description).toBe('new desc');
  });

  test('updateSnapshot returns null for unknown ID', () => {
    expect(snapshots.updateSnapshot(SLUG, 'nope', { name: 'x' })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  3 · SNAPSHOT SERVICE — Restore
// ═══════════════════════════════════════════════════════════════════

test.describe('Workspace Snapshots — Restore', () => {
  const SLUG = 'snap-proj';

  test('restoreSnapshot restores settings and creates backup', () => {
    snapshots.clearSnapshots(SLUG);
    // Change a setting
    refs.workspace.updateProjectSettings(SLUG, { customKey: 'original' });
    const snap = snapshots.createSnapshot(SLUG, { name: 'Before Change' });
    // Change the setting
    refs.workspace.updateProjectSettings(SLUG, { customKey: 'changed' });

    // Restore
    const result = snapshots.restoreSnapshot(SLUG, snap.id);
    expect(result.restored).toBe(true);
    expect(result.backupId).toMatch(/^snap-/);
    expect(result.snapshotName).toBe('Before Change');

    // Verify restored
    const settings = refs.workspace.getProjectSettings(SLUG);
    expect(settings.customKey).toBe('original');
  });

  test('restoreSnapshot returns null for unknown ID', () => {
    expect(snapshots.restoreSnapshot(SLUG, 'nope')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  4 · SNAPSHOT SERVICE — Diff
// ═══════════════════════════════════════════════════════════════════

test.describe('Workspace Snapshots — Diff', () => {
  const SLUG = 'snap-proj';
  let snap1Id, snap2Id;

  test.beforeAll(() => {
    snapshots.clearSnapshots(SLUG);
    refs.workspace.updateProjectSettings(SLUG, { keyA: 'a', keyB: 'same' });
    snap1Id = snapshots.createSnapshot(SLUG, { name: 'Snap 1' }).id;
    refs.workspace.updateProjectSettings(SLUG, { keyA: 'changed', keyC: 'new' });
    snap2Id = snapshots.createSnapshot(SLUG, { name: 'Snap 2' }).id;
  });

  test('diffSnapshots shows changes', () => {
    const diff = snapshots.diffSnapshots(SLUG, snap1Id, snap2Id);
    expect(diff).toBeTruthy();
    expect(diff.snapshot1.name).toBe('Snap 1');
    expect(diff.snapshot2.name).toBe('Snap 2');
    expect(diff.changed).toContain('keyA');
    expect(diff.totalDifferences).toBeGreaterThan(0);
  });

  test('diffSnapshots returns null for unknown snapshot', () => {
    expect(snapshots.diffSnapshots(SLUG, snap1Id, 'nope')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  5 · SNAPSHOT SERVICE — Delete + Clear + Stats
// ═══════════════════════════════════════════════════════════════════

test.describe('Workspace Snapshots — Delete + Clear + Stats', () => {
  const SLUG = 'snap-proj';

  test('deleteSnapshot removes a snapshot', () => {
    snapshots.clearSnapshots(SLUG);
    const s = snapshots.createSnapshot(SLUG, { name: 'Del Me' });
    expect(snapshots.deleteSnapshot(SLUG, s.id)).toBe(true);
    expect(snapshots.getSnapshot(SLUG, s.id)).toBeNull();
  });

  test('deleteSnapshot returns false for unknown ID', () => {
    expect(snapshots.deleteSnapshot(SLUG, 'nope')).toBe(false);
  });

  test('clearSnapshots removes all', () => {
    snapshots.createSnapshot(SLUG);
    snapshots.createSnapshot(SLUG);
    snapshots.clearSnapshots(SLUG);
    const { total } = snapshots.listSnapshots(SLUG);
    expect(total).toBe(0);
  });

  test('getSnapshotStats returns correct counts', () => {
    snapshots.clearSnapshots(SLUG);
    snapshots.createSnapshot(SLUG);
    snapshots.createSnapshot(SLUG, { auto: true });
    const stats = snapshots.getSnapshotStats(SLUG);
    expect(stats.total).toBe(2);
    expect(stats.auto).toBe(1);
    expect(stats.manual).toBe(1);
    expect(stats.newest).toBeTruthy();
    expect(stats.oldest).toBeTruthy();
    expect(stats.maxSnapshots).toBe(50);
  });

  test('caps at MAX_SNAPSHOTS', () => {
    snapshots.clearSnapshots(SLUG);
    for (let i = 0; i < 55; i++) snapshots.createSnapshot(SLUG);
    const { total } = snapshots.listSnapshots(SLUG);
    expect(total).toBeLessThanOrEqual(50);
    snapshots.clearSnapshots(SLUG);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  6 · REST ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

const PROJ = `snap-rest-${Date.now()}`;

test.describe('Workspace Snapshots — REST Endpoints', () => {
  let request;
  let createdSnapId;

  test.beforeAll(async ({ playwright }) => {
    request = await playwright.request.newContext();
    const res = await request.post(`${API}/projects`, { data: { name: PROJ } });
    expect(res.status()).toBe(201);
  });

  test('GET /snapshots returns empty initially', async () => {
    const res = await request.get(`${API}/projects/${PROJ}/snapshots`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.snapshots).toHaveLength(0);
  });

  test('POST /snapshots creates a snapshot', async () => {
    const res = await request.post(`${API}/projects/${PROJ}/snapshots`, {
      data: { name: 'REST Snap', description: 'via API' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.id).toMatch(/^snap-/);
    expect(body.name).toBe('REST Snap');
    createdSnapId = body.id;
  });

  test('GET /snapshots lists snapshots', async () => {
    const res = await request.get(`${API}/projects/${PROJ}/snapshots`);
    const body = await res.json();
    expect(body.total).toBe(1);
  });

  test('GET /snapshots/:id returns single', async () => {
    const res = await request.get(`${API}/projects/${PROJ}/snapshots/${createdSnapId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.name).toBe('REST Snap');
    expect(body.data).toBeTruthy();
  });

  test('GET /snapshots/:id 404 for unknown', async () => {
    const res = await request.get(`${API}/projects/${PROJ}/snapshots/nonexistent`);
    expect(res.status()).toBe(404);
  });

  test('PUT /snapshots/:id updates', async () => {
    const res = await request.put(`${API}/projects/${PROJ}/snapshots/${createdSnapId}`, {
      data: { name: 'Updated Name' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.name).toBe('Updated Name');
  });

  test('GET /snapshots/stats returns stats', async () => {
    const res = await request.get(`${API}/projects/${PROJ}/snapshots/stats`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.total).toBe(1);
  });

  test('POST /snapshots/:id/restore restores', async () => {
    const res = await request.post(`${API}/projects/${PROJ}/snapshots/${createdSnapId}/restore`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.restored).toBe(true);
    expect(body.backupId).toMatch(/^snap-/);
  });

  test('GET /snapshots/diff compares', async () => {
    // Create a second snapshot
    const s2 = await request.post(`${API}/projects/${PROJ}/snapshots`, {
      data: { name: 'Snap 2' },
    });
    const { id: snap2Id } = await s2.json();
    const res = await request.get(`${API}/projects/${PROJ}/snapshots/diff?snap1=${createdSnapId}&snap2=${snap2Id}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.totalDifferences).toBe('number');
  });

  test('GET /snapshots/diff 400 without params', async () => {
    const res = await request.get(`${API}/projects/${PROJ}/snapshots/diff`);
    expect(res.status()).toBe(400);
  });

  test('DELETE /snapshots/:id deletes', async () => {
    const s = await request.post(`${API}/projects/${PROJ}/snapshots`, { data: { name: 'Del' } });
    const { id } = await s.json();
    const res = await request.delete(`${API}/projects/${PROJ}/snapshots/${id}`);
    expect(res.ok()).toBeTruthy();
  });

  test('DELETE /snapshots clears all', async () => {
    const res = await request.delete(`${API}/projects/${PROJ}/snapshots`);
    expect(res.ok()).toBeTruthy();
    const list = await request.get(`${API}/projects/${PROJ}/snapshots`);
    const body = await list.json();
    expect(body.total).toBe(0);
  });

  test('GET /snapshots 404 for nonexistent project', async () => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/snapshots`);
    expect(res.status()).toBe(404);
  });
});
