/**
 * Phase 10.4 — Diff Review Tests
 *
 * Tests for diff review service (CRUD, hunk review, bulk review, revert,
 * stats), REST endpoints, and client component integration.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, existsSync, rmSync, readFileSync } from 'fs';

const API = 'http://localhost:3000/api';
const TEST_DIR = '.haivemind-workspace';

let WorkspaceManager, refs, diffReview;

test.beforeAll(async () => {
  const wsModule = await import('../server/workspace.js');
  WorkspaceManager = wsModule.default;
  const stateModule = await import('../server/state.js');
  refs = stateModule.refs;
  diffReview = await import('../server/services/diffReview.js');

  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  const wm = new WorkspaceManager(TEST_DIR);
  refs.workspace = wm;
  try { wm.createProject('diff-proj'); } catch { /* exists */ }
});

test.afterAll(async () => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  1 · DIFF SERVICE — REVIEW_STATUSES constant
// ═══════════════════════════════════════════════════════════════════

test.describe('Diff Review — Constants', () => {
  test('REVIEW_STATUSES includes expected values', () => {
    expect(diffReview.REVIEW_STATUSES).toEqual(['pending', 'approved', 'rejected', 'reverted']);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  2 · DIFF SERVICE — addDiff + getDiffs + getDiff
// ═══════════════════════════════════════════════════════════════════

test.describe('Diff Review — CRUD', () => {
  const SLUG = 'diff-proj';

  test('addDiff creates a diff entry', () => {
    diffReview.clearDiffs(SLUG);
    const d = diffReview.addDiff(SLUG, {
      file: 'src/index.js',
      hunks: [
        { header: '@@ -1,3 +1,4 @@', lines: ['+import foo;'] },
        { header: '@@ -10,2 +11,3 @@', lines: ['-old', '+new'] },
      ],
      sessionId: 'sess-1',
      before: 'old code',
      after: 'new code',
    });
    expect(d.id).toMatch(/^diff-/);
    expect(d.file).toBe('src/index.js');
    expect(d.hunks).toHaveLength(2);
    expect(d.hunks[0].id).toBe('hunk-0');
    expect(d.hunks[1].id).toBe('hunk-1');
    expect(d.hunks[0].status).toBe('pending');
    expect(d.status).toBe('pending');
    expect(d.before).toBe('old code');
    expect(d.after).toBe('new code');
    expect(d.sessionId).toBe('sess-1');
    expect(d.createdAt).toBeTruthy();
  });

  test('getDiffs returns all diffs', () => {
    const { diffs, total } = diffReview.getDiffs(SLUG);
    expect(total).toBeGreaterThanOrEqual(1);
    expect(diffs[0].file).toBe('src/index.js');
  });

  test('getDiffs filters by status', () => {
    const { diffs } = diffReview.getDiffs(SLUG, { status: 'approved' });
    expect(diffs).toHaveLength(0);
  });

  test('getDiffs filters by file', () => {
    const { diffs } = diffReview.getDiffs(SLUG, { file: 'index.js' });
    expect(diffs.length).toBeGreaterThanOrEqual(1);
  });

  test('getDiff returns a single diff by ID', () => {
    const { diffs } = diffReview.getDiffs(SLUG);
    const d = diffReview.getDiff(SLUG, diffs[0].id);
    expect(d).toBeTruthy();
    expect(d.file).toBe('src/index.js');
  });

  test('getDiff returns null for unknown ID', () => {
    const d = diffReview.getDiff(SLUG, 'nonexistent');
    expect(d).toBeNull();
  });

  test('addDiff defaults file to unknown', () => {
    const d = diffReview.addDiff(SLUG, {});
    expect(d.file).toBe('unknown');
    expect(d.hunks).toHaveLength(0);
    expect(d.before).toBe('');
    expect(d.after).toBe('');
  });

  test('addDiff caps at 200 diffs', () => {
    diffReview.clearDiffs(SLUG);
    for (let i = 0; i < 205; i++) {
      diffReview.addDiff(SLUG, { file: `f${i}.js` });
    }
    const { total } = diffReview.getDiffs(SLUG);
    expect(total).toBeLessThanOrEqual(200);
    diffReview.clearDiffs(SLUG);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  3 · DIFF SERVICE — reviewHunk
// ═══════════════════════════════════════════════════════════════════

test.describe('Diff Review — Hunk Review', () => {
  const SLUG = 'diff-proj';
  let diffId;

  test.beforeAll(() => {
    diffReview.clearDiffs(SLUG);
    const d = diffReview.addDiff(SLUG, {
      file: 'app.js',
      hunks: [
        { header: '@@ hunk 0 @@', lines: ['+a'] },
        { header: '@@ hunk 1 @@', lines: ['+b'] },
      ],
    });
    diffId = d.id;
  });

  test('reviewHunk approves a single hunk', () => {
    const d = diffReview.reviewHunk(SLUG, diffId, 'hunk-0', 'approved');
    expect(d).toBeTruthy();
    expect(d.hunks[0].status).toBe('approved');
    expect(d.hunks[1].status).toBe('pending');
    expect(d.status).toBe('pending');
  });

  test('reviewHunk rejects a single hunk', () => {
    const d = diffReview.reviewHunk(SLUG, diffId, 'hunk-1', 'rejected');
    expect(d).toBeTruthy();
    expect(d.hunks[1].status).toBe('rejected');
    // All reviewed → diff status should update (mixed = approved)
    expect(d.status).toBe('approved');
    expect(d.reviewedAt).toBeTruthy();
    expect(d.reviewedBy).toBe('user');
  });

  test('reviewHunk returns null for invalid status', () => {
    const r = diffReview.reviewHunk(SLUG, diffId, 'hunk-0', 'invalid');
    expect(r).toBeNull();
  });

  test('reviewHunk returns null for unknown diff', () => {
    const r = diffReview.reviewHunk(SLUG, 'bad-id', 'hunk-0', 'approved');
    expect(r).toBeNull();
  });

  test('reviewHunk returns null for unknown hunk', () => {
    const r = diffReview.reviewHunk(SLUG, diffId, 'hunk-99', 'approved');
    expect(r).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  4 · DIFF SERVICE — bulkReview
// ═══════════════════════════════════════════════════════════════════

test.describe('Diff Review — Bulk Review', () => {
  const SLUG = 'diff-proj';
  let diffId;

  test.beforeAll(() => {
    diffReview.clearDiffs(SLUG);
    const d = diffReview.addDiff(SLUG, {
      file: 'bulk.js',
      hunks: [
        { header: '@@ 0 @@', lines: ['+x'] },
        { header: '@@ 1 @@', lines: ['+y'] },
        { header: '@@ 2 @@', lines: ['+z'] },
      ],
    });
    diffId = d.id;
  });

  test('bulkReview approves all hunks', () => {
    const d = diffReview.bulkReview(SLUG, diffId, 'approved');
    expect(d).toBeTruthy();
    expect(d.status).toBe('approved');
    expect(d.hunks.every(h => h.status === 'approved')).toBe(true);
    expect(d.reviewedBy).toBe('user');
  });

  test('bulkReview rejects all hunks', () => {
    const d = diffReview.bulkReview(SLUG, diffId, 'rejected', 'admin');
    expect(d).toBeTruthy();
    expect(d.status).toBe('rejected');
    expect(d.hunks.every(h => h.status === 'rejected')).toBe(true);
    expect(d.reviewedBy).toBe('admin');
  });

  test('bulkReview returns null for invalid status', () => {
    const r = diffReview.bulkReview(SLUG, diffId, 'bogus');
    expect(r).toBeNull();
  });

  test('bulkReview returns null for unknown diff', () => {
    const r = diffReview.bulkReview(SLUG, 'no-such', 'approved');
    expect(r).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  5 · DIFF SERVICE — revertDiff + removeDiff + clearDiffs
// ═══════════════════════════════════════════════════════════════════

test.describe('Diff Review — Revert / Remove / Clear', () => {
  const SLUG = 'diff-proj';

  test('revertDiff marks as reverted', () => {
    diffReview.clearDiffs(SLUG);
    const d = diffReview.addDiff(SLUG, {
      file: 'rev.js',
      hunks: [{ header: '@@', lines: ['+r'] }],
    });
    const res = diffReview.revertDiff(SLUG, d.id);
    expect(res.status).toBe('reverted');
    expect(res.hunks[0].status).toBe('reverted');
    expect(res.revertedAt).toBeTruthy();
  });

  test('revertDiff returns null for unknown diff', () => {
    expect(diffReview.revertDiff(SLUG, 'nope')).toBeNull();
  });

  test('removeDiff removes a diff', () => {
    const d = diffReview.addDiff(SLUG, { file: 'rm.js' });
    expect(diffReview.removeDiff(SLUG, d.id)).toBe(true);
    expect(diffReview.getDiff(SLUG, d.id)).toBeNull();
  });

  test('removeDiff returns false for unknown diff', () => {
    expect(diffReview.removeDiff(SLUG, 'nope')).toBe(false);
  });

  test('clearDiffs removes all diffs', () => {
    diffReview.addDiff(SLUG, { file: 'a.js' });
    diffReview.addDiff(SLUG, { file: 'b.js' });
    diffReview.clearDiffs(SLUG);
    const { total } = diffReview.getDiffs(SLUG);
    expect(total).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  6 · DIFF SERVICE — getReviewStats
// ═══════════════════════════════════════════════════════════════════

test.describe('Diff Review — Stats', () => {
  const SLUG = 'diff-proj';

  test('getReviewStats returns correct counts', () => {
    diffReview.clearDiffs(SLUG);
    diffReview.addDiff(SLUG, { file: 'a.js', hunks: [{ header: '@@', lines: [] }] });
    diffReview.addDiff(SLUG, { file: 'b.js', hunks: [{ header: '@@', lines: [] }] });
    const { diffs } = diffReview.getDiffs(SLUG);
    diffReview.bulkReview(SLUG, diffs[0].id, 'approved');

    const stats = diffReview.getReviewStats(SLUG);
    expect(stats.total).toBe(2);
    expect(stats.byStatus.approved).toBe(1);
    expect(stats.byStatus.pending).toBe(1);
    expect(stats.totalHunks).toBe(2);
    expect(stats.pendingHunks).toBe(1);
    expect(stats.filesChanged).toBe(2);
  });

  test('getReviewStats on empty returns zeros', () => {
    diffReview.clearDiffs(SLUG);
    const stats = diffReview.getReviewStats(SLUG);
    expect(stats.total).toBe(0);
    expect(stats.totalHunks).toBe(0);
    expect(stats.filesChanged).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  7 · REST ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

const PROJ = `diff-rest-${Date.now()}`;

test.describe('Diff Review — REST Endpoints', () => {
  let request;
  let createdDiffId;

  test.beforeAll(async ({ playwright }) => {
    request = await playwright.request.newContext();
    const res = await request.post(`${API}/projects`, { data: { name: PROJ } });
    expect(res.status()).toBe(201);
  });

  test('GET /diffs returns empty initially', async () => {
    const res = await request.get(`${API}/projects/${PROJ}/diffs`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.diffs).toHaveLength(0);
  });

  test('POST /diffs — adds a diff', async () => {
    const res = await request.post(`${API}/projects/${PROJ}/diffs`, {
      data: {
        file: 'rest.js',
        hunks: [
          { header: '@@ -1,2 +1,3 @@', lines: ['+line'] },
        ],
        before: 'before',
        after: 'after',
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.id).toMatch(/^diff-/);
    expect(body.file).toBe('rest.js');
    createdDiffId = body.id;
  });

  test('GET /diffs returns created diff', async () => {
    const res = await request.get(`${API}/projects/${PROJ}/diffs`);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.diffs[0].id).toBe(createdDiffId);
  });

  test('GET /diffs/:id returns single diff', async () => {
    const res = await request.get(`${API}/projects/${PROJ}/diffs/${createdDiffId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.file).toBe('rest.js');
  });

  test('GET /diffs/:id 404 for unknown', async () => {
    const res = await request.get(`${API}/projects/${PROJ}/diffs/nonexistent`);
    expect(res.status()).toBe(404);
  });

  test('GET /diffs/stats returns stats', async () => {
    const res = await request.get(`${API}/projects/${PROJ}/diffs/stats`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.byStatus.pending).toBe(1);
  });

  test('POST /diffs/:id/hunks/:hunkId/review — approve hunk', async () => {
    const res = await request.post(
      `${API}/projects/${PROJ}/diffs/${createdDiffId}/hunks/hunk-0/review`,
      { data: { status: 'approved' } },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.hunks[0].status).toBe('approved');
  });

  test('POST /diffs/:id/bulk-review — reject all hunks', async () => {
    const res = await request.post(
      `${API}/projects/${PROJ}/diffs/${createdDiffId}/bulk-review`,
      { data: { status: 'rejected' } },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('rejected');
  });

  test('POST /diffs/:id/revert — revert diff', async () => {
    const res = await request.post(
      `${API}/projects/${PROJ}/diffs/${createdDiffId}/revert`,
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('reverted');
  });

  test('DELETE /diffs/:id — remove single diff', async () => {
    // Add a new one to delete
    const add = await request.post(`${API}/projects/${PROJ}/diffs`, {
      data: { file: 'del.js' },
    });
    const { id } = await add.json();
    const res = await request.delete(`${API}/projects/${PROJ}/diffs/${id}`);
    expect(res.ok()).toBeTruthy();
  });

  test('DELETE /diffs — clear all', async () => {
    await request.post(`${API}/projects/${PROJ}/diffs`, {
      data: { file: 'clear.js' },
    });
    const res = await request.delete(`${API}/projects/${PROJ}/diffs`);
    expect(res.ok()).toBeTruthy();
    const list = await request.get(`${API}/projects/${PROJ}/diffs`);
    const body = await list.json();
    expect(body.total).toBe(0);
  });

  test('GET /diffs 404 for nonexistent project', async () => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/diffs`);
    expect(res.status()).toBe(404);
  });

  test('GET /diffs?status=pending filters', async () => {
    await request.post(`${API}/projects/${PROJ}/diffs`, { data: { file: 'f.js' } });
    const res = await request.get(`${API}/projects/${PROJ}/diffs?status=pending`);
    const body = await res.json();
    expect(body.diffs.every(d => d.status === 'pending')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  8 · CLIENT COMPONENT — DiffReviewPanel.vue integration
// ═══════════════════════════════════════════════════════════════════

test.describe('Diff Review — Client Component', () => {
  let src;

  test.beforeAll(() => {
    src = readFileSync('client/src/components/DiffReviewPanel.vue', 'utf-8');
  });

  test('has status filter select', () => {
    expect(src).toContain('v-model="filterStatus"');
    expect(src).toContain('All Statuses');
  });

  test('renders diff cards with expand/collapse', () => {
    expect(src).toContain('diff-card');
    expect(src).toContain('expandedDiff');
    expect(src).toContain('▼ Expand');
    expect(src).toContain('▲ Collapse');
  });

  test('has per-hunk approve/reject buttons', () => {
    expect(src).toContain('hunk-approve');
    expect(src).toContain('hunk-reject');
    expect(src).toContain('doReviewHunk');
  });

  test('has bulk review buttons', () => {
    expect(src).toContain('doBulkReview');
    expect(src).toContain('Approve All');
    expect(src).toContain('Reject All');
  });

  test('has revert button', () => {
    expect(src).toContain('doRevert');
    expect(src).toContain('Revert');
  });

  test('has clear all button', () => {
    expect(src).toContain('clearAll');
    expect(src).toContain('Clear All Diffs');
  });

  test('displays before/after panels', () => {
    expect(src).toContain('Before');
    expect(src).toContain('After');
    expect(src).toContain('diff-sides');
  });

  test('shows stats bar', () => {
    expect(src).toContain('diff-stats');
    expect(src).toContain('pending');
    expect(src).toContain('approved');
    expect(src).toContain('rejected');
    expect(src).toContain('filesChanged');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  9 · APP.VUE — Integration
// ═══════════════════════════════════════════════════════════════════

test.describe('Diff Review — App Integration', () => {
  let appSrc;

  test.beforeAll(() => {
    appSrc = readFileSync('client/src/App.vue', 'utf-8');
  });

  test('App.vue imports DiffReviewPanel', () => {
    expect(appSrc).toContain("import DiffReviewPanel from './components/DiffReviewPanel.vue'");
  });

  test('App.vue has Diffs tab button', () => {
    expect(appSrc).toContain('📝 Diffs');
    expect(appSrc).toContain("sideTab === 'diffs'");
  });

  test('App.vue renders DiffReviewPanel component', () => {
    expect(appSrc).toContain('<DiffReviewPanel');
  });
});
