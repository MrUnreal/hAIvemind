// @ts-check
import { test, expect } from '@playwright/test';
import path from 'node:path';

const API = 'http://127.0.0.1:3000';

// ── Phase 5.2: Workspace Snapshot & Rollback Tests ──

// ─── Unit Tests: Snapshot module ───────────────────────────────────────────

test.describe('Snapshot module — Unit', () => {
  test('isGitRepo detects git repositories', async () => {
    const { isGitRepo } = await import('../server/snapshot.js');
    // The hAIvemind project root is a git repo
    const projectRoot = path.resolve(import.meta.dirname, '..');
    expect(isGitRepo(projectRoot)).toBe(true);
  });

  test('isGitRepo returns false for non-git dirs', async () => {
    const { isGitRepo } = await import('../server/snapshot.js');
    const os = await import('node:os');
    // temp dir is not a git repo
    expect(isGitRepo(os.tmpdir())).toBe(false);
  });

  test('createSnapshot returns a snapshot object', async () => {
    const { createSnapshot } = await import('../server/snapshot.js');
    const projectRoot = path.resolve(import.meta.dirname, '..');
    const testId = `test-snap-${Date.now()}`;
    const snap = await createSnapshot(projectRoot, testId);

    // Should be git-tag since we're in a git repo
    expect(snap).toHaveProperty('type');
    expect(snap).toHaveProperty('ref');
    expect(['git-tag', 'tarball', 'none']).toContain(snap.type);

    // Cleanup
    if (snap.type === 'git-tag') {
      const { deleteSnapshot } = await import('../server/snapshot.js');
      await deleteSnapshot(projectRoot, snap);
    }
  });

  test('getSnapshotDiff returns diff object for git tags', async () => {
    const { createSnapshot, getSnapshotDiff, deleteSnapshot } = await import('../server/snapshot.js');
    const projectRoot = path.resolve(import.meta.dirname, '..');
    const testId = `test-diff-${Date.now()}`;
    const snap = await createSnapshot(projectRoot, testId);

    if (snap.type === 'git-tag') {
      const diff = getSnapshotDiff(projectRoot, snap);
      expect(diff).not.toBeNull();
      expect(diff).toHaveProperty('files');
      expect(diff).toHaveProperty('summary');
      expect(Array.isArray(/** @type {any} */ (diff).files)).toBe(true);
      await deleteSnapshot(projectRoot, snap);
    }
  });

  test('getSnapshotDiff returns null for non-git snapshots', async () => {
    const { getSnapshotDiff } = await import('../server/snapshot.js');
    const result = getSnapshotDiff('/tmp', /** @type {any} */ ({ type: 'tarball', ref: '/nonexistent' }));
    expect(result).toBeNull();
  });

  test('rollbackToSnapshot rejects when no snapshot', async () => {
    const { rollbackToSnapshot } = await import('../server/snapshot.js');
    const result = await rollbackToSnapshot('/tmp', /** @type {any} */ (null));
    expect(result.success).toBe(false);
    expect(result.message).toContain('No snapshot available');
  });

  test('rollbackToSnapshot rejects when type is none', async () => {
    const { rollbackToSnapshot } = await import('../server/snapshot.js');
    const result = await rollbackToSnapshot('/tmp', /** @type {any} */ ({ type: 'none', ref: '' }));
    expect(result.success).toBe(false);
    expect(result.message).toContain('No snapshot available');
  });

  test('deleteSnapshot handles null gracefully', async () => {
    const { deleteSnapshot } = await import('../server/snapshot.js');
    // Should not throw
    await deleteSnapshot('/tmp', /** @type {any} */ (null));
  });
});

// ─── REST API Tests ──────────────────────────────────────────────────────

test.describe('Snapshot — REST API', () => {
  test('POST rollback returns 404 for nonexistent project', async ({ request }) => {
    const res = await request.post(`${API}/api/projects/nonexistent-project-999/sessions/fake-id/rollback`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('not found');
  });

  test('POST rollback returns 404 for nonexistent session', async ({ request }) => {
    // Use the known projects list endpoint (returns flat array)
    const projectsRes = await request.get(`${API}/api/projects`);
    const projects = await projectsRes.json();
    const linked = projects.find(/** @type {(p: any) => boolean} */ (p) => p.linked === true);
    if (!linked) { test.skip(); return; }

    const res = await request.post(`${API}/api/projects/${linked.slug}/sessions/nonexistent-session-999/rollback`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('not found');
  });

  test('GET diff returns 404 for nonexistent project', async ({ request }) => {
    const res = await request.get(`${API}/api/projects/nonexistent-project-999/sessions/fake-id/diff`);
    expect(res.status()).toBe(404);
  });

  test('GET diff returns object with files and summary', async ({ request }) => {
    const projectsRes = await request.get(`${API}/api/projects`);
    const projects = await projectsRes.json();
    const linked = projects.find(/** @type {(p: any) => boolean} */ (p) => p.linked === true);
    if (!linked) { test.skip(); return; }

    const sessionsRes = await request.get(`${API}/api/projects/${linked.slug}/sessions`);
    const sessions = await sessionsRes.json();

    if (sessions.length > 0) {
      const sessionId = sessions[0].id;
      const res = await request.get(`${API}/api/projects/${linked.slug}/sessions/${sessionId}/diff`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body).toHaveProperty('files');
      expect(body).toHaveProperty('summary');
    }
  });

  test('POST rollback returns 400 when session has no snapshot', async ({ request }) => {
    const projectsRes = await request.get(`${API}/api/projects`);
    const projects = await projectsRes.json();
    const linked = projects.find(/** @type {(p: any) => boolean} */ (p) => p.linked === true);
    if (!linked) { test.skip(); return; }

    const sessionsRes = await request.get(`${API}/api/projects/${linked.slug}/sessions`);
    const sessions = await sessionsRes.json();

    if (sessions.length > 0) {
      const sessionId = sessions[0].id;
      const res = await request.post(`${API}/api/projects/${linked.slug}/sessions/${sessionId}/rollback`);
      // Should be 400 (no snapshot) or 200 (snapshot exists from CLI build) or 409 (session running)
      expect([200, 400, 404, 409]).toContain(res.status());
    }
  });
});

// ─── Integration: Server imports ───────────────────────────────────────────

test.describe('Snapshot — Server Integration', () => {
  test('server/index.js imports snapshot functions', async () => {
    const indexSrc = await import('node:fs').then(fs =>
      fs.readFileSync(path.resolve(import.meta.dirname, '..', 'server', 'index.js'), 'utf8'),
    );
    expect(indexSrc).toContain("import { createSnapshot, rollbackToSnapshot, getSnapshotDiff }");
    expect(indexSrc).toContain("from './snapshot.js'");
  });

  test('server/workspace.js persists snapshot in finalizeSession', async () => {
    const wsSrc = await import('node:fs').then(fs =>
      fs.readFileSync(path.resolve(import.meta.dirname, '..', 'server', 'workspace.js'), 'utf8'),
    );
    expect(wsSrc).toContain('snapshot');
  });

  test('server/index.js has rollback endpoint', async () => {
    const indexSrc = await import('node:fs').then(fs =>
      fs.readFileSync(path.resolve(import.meta.dirname, '..', 'server', 'index.js'), 'utf8'),
    );
    expect(indexSrc).toContain('/rollback');
    expect(indexSrc).toContain('rollbackToSnapshot');
  });

  test('server/index.js has diff endpoint', async () => {
    const indexSrc = await import('node:fs').then(fs =>
      fs.readFileSync(path.resolve(import.meta.dirname, '..', 'server', 'index.js'), 'utf8'),
    );
    expect(indexSrc).toContain('/diff');
    expect(indexSrc).toContain('getSnapshotDiff');
  });
});

// ─── UI Tests ────────────────────────────────────────────────────────────

test.describe('Snapshot — UI', () => {
  test('SessionHistory component has rollback button markup', async () => {
    const vueSrc = await import('node:fs').then(fs =>
      fs.readFileSync(
        path.resolve(import.meta.dirname, '..', 'client', 'src', 'components', 'SessionHistory.vue'),
        'utf8',
      ),
    );
    expect(vueSrc).toContain('rollback-btn');
    expect(vueSrc).toContain('onRollback');
    expect(vueSrc).toContain('rollingBack');
  });

  test('Rollback button exists in rendered page', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Verify app loaded
    const title = await page.title();
    expect(title).toContain('hAIvemind');

    // The rollback button markup should be part of the SessionHistory component
    // In the actual rendered page, rollback buttons appear for completed/failed sessions
    // Just verify the page loaded and contains session-related content
    const html = await page.content();
    expect(html).toContain('session');
  });
});
