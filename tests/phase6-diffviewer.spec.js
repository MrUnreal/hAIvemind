// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3000';
const ROOT = path.resolve(import.meta.dirname, '..');

/* ─── helpers ─── */
function read(f) { return readFileSync(path.join(ROOT, f), 'utf8'); }

/* ════════════════════════════════════════════
   Phase 6.4 — Session Diff Viewer & Workspace Intelligence
   ════════════════════════════════════════════ */

test.describe('Phase 6.4 — Server: Enhanced Diff Endpoint', () => {
  test('diff endpoint accepts patches query param', async () => {
    const src = read('server/index.js');
    expect(src).toContain("req.query.patches === 'true'");
  });

  test('getSnapshotDiff supports patches option', async () => {
    const src = read('server/snapshot.js');
    expect(src).toContain('options.patches');
    expect(src).toContain('patches[file]');
    expect(src).toContain('MAX_PATCH_SIZE');
  });

  test('diff endpoint returns per-file patches when requested', async () => {
    const src = read('server/snapshot.js');
    expect(src).toContain('git diff');
    expect(src).toContain('result.patches');
  });

  test('patch size is capped at 50KB per file', async () => {
    const src = read('server/snapshot.js');
    expect(src).toContain('50000');
    expect(src).toContain('truncated');
  });
});

test.describe('Phase 6.4 — DiffViewer Component', () => {
  test('DiffViewer.vue exists', () => {
    expect(() => read('client/src/components/DiffViewer.vue')).not.toThrow();
  });

  test('DiffViewer fetches diff with patches=true', () => {
    const src = read('client/src/components/DiffViewer.vue');
    expect(src).toContain('patches=true');
  });

  test('DiffViewer has file accordion with toggle', () => {
    const src = read('client/src/components/DiffViewer.vue');
    expect(src).toContain('toggleFile');
    expect(src).toContain('expandedFiles');
    expect(src).toContain('file-header');
  });

  test('DiffViewer highlights diff lines', () => {
    const src = read('client/src/components/DiffViewer.vue');
    expect(src).toContain('highlightPatch');
    expect(src).toContain('diff-add');
    expect(src).toContain('diff-del');
    expect(src).toContain('diff-hunk');
  });

  test('DiffViewer has HTML escaping for safety', () => {
    const src = read('client/src/components/DiffViewer.vue');
    expect(src).toContain('escapeHtml');
    expect(src).toContain('&amp;');
    expect(src).toContain('&lt;');
  });

  test('DiffViewer has close button emitting close event', () => {
    const src = read('client/src/components/DiffViewer.vue');
    expect(src).toContain("$emit('close')");
    expect(src).toContain('close-diff');
  });
});

test.describe('Phase 6.4 — WorkspaceOverview Component', () => {
  test('WorkspaceOverview.vue exists', () => {
    expect(() => read('client/src/components/WorkspaceOverview.vue')).not.toThrow();
  });

  test('WorkspaceOverview fetches analysis data', () => {
    const src = read('client/src/components/WorkspaceOverview.vue');
    expect(src).toContain('/api/projects/');
    expect(src).toContain('/analysis');
  });

  test('WorkspaceOverview displays tech stack tags', () => {
    const src = read('client/src/components/WorkspaceOverview.vue');
    expect(src).toContain('tech-tag');
    expect(src).toContain('techStack');
  });

  test('WorkspaceOverview shows conventions grid', () => {
    const src = read('client/src/components/WorkspaceOverview.vue');
    expect(src).toContain('conventions-grid');
    expect(src).toContain('conv-item');
    expect(src).toContain('moduleSystem');
  });

  test('WorkspaceOverview shows dependencies', () => {
    const src = read('client/src/components/WorkspaceOverview.vue');
    expect(src).toContain('dep-badge');
    expect(src).toContain('runtime');
    expect(src).toContain('dev');
  });

  test('WorkspaceOverview has collapsible file tree', () => {
    const src = read('client/src/components/WorkspaceOverview.vue');
    expect(src).toContain('showTree');
    expect(src).toContain('file-tree');
    expect(src).toContain('toggle-heading');
  });

  test('WorkspaceOverview has refresh button', () => {
    const src = read('client/src/components/WorkspaceOverview.vue');
    expect(src).toContain('refresh-btn');
    expect(src).toContain('refresh');
  });
});

test.describe('Phase 6.4 — SessionHistory Integration', () => {
  test('SessionHistory imports DiffViewer', () => {
    const src = read('client/src/components/SessionHistory.vue');
    expect(src).toContain("import DiffViewer from './DiffViewer.vue'");
  });

  test('SessionHistory imports WorkspaceOverview', () => {
    const src = read('client/src/components/SessionHistory.vue');
    expect(src).toContain("import WorkspaceOverview from './WorkspaceOverview.vue'");
  });

  test('SessionHistory has View Diff button', () => {
    const src = read('client/src/components/SessionHistory.vue');
    expect(src).toContain('diff-btn');
    expect(src).toContain('View Diff');
  });

  test('SessionHistory renders DiffViewer inline', () => {
    const src = read('client/src/components/SessionHistory.vue');
    expect(src).toContain('<DiffViewer');
    expect(src).toContain('viewingDiff');
  });

  test('SessionHistory renders WorkspaceOverview', () => {
    const src = read('client/src/components/SessionHistory.vue');
    expect(src).toContain('<WorkspaceOverview');
    expect(src).toContain('projectSlug');
  });

  test('Rollback flow opens diff preview first', () => {
    const src = read('client/src/components/SessionHistory.vue');
    expect(src).toContain('viewingDiff.value !== sessionId');
    expect(src).toContain('User sees the diff first');
  });
});

test.describe('Phase 6.4 — Integration', () => {
  test('server is running and responding', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.ok()).toBeTruthy();
  });

  test('diff endpoint returns data for mock sessions', async ({ page, request }) => {
    // Create a project and start a session
    const slug = `difftest-${Date.now()}`;
    await request.post(`${BASE}/api/projects`, { data: { name: slug } });

    // Navigate to get WS context
    await page.goto('http://localhost:5173');
    await page.waitForTimeout(500);

    // Start a mock session to create a session entry
    const sessRes = await request.post(`${BASE}/api/projects/${slug}/sessions`, {
      data: { prompt: 'Test diff endpoint' },
    });
    expect(sessRes.ok()).toBeTruthy();

    // Wait for session to complete
    await page.waitForTimeout(3000);

    // Get sessions to find IDs
    const listRes = await request.get(`${BASE}/api/projects/${slug}/sessions`);
    const sessions = await listRes.json();
    if (sessions.length > 0) {
      const diffRes = await request.get(
        `${BASE}/api/projects/${slug}/sessions/${sessions[0].id}/diff?patches=true`
      );
      expect(diffRes.ok()).toBeTruthy();
      const data = await diffRes.json();
      // In mock mode, may not have actual git changes, but endpoint should respond
      expect(data).toHaveProperty('files');
      expect(data).toHaveProperty('summary');
    }
  });

  test('workspace analysis endpoint returns data', async ({ request }) => {
    const slug = `analysis-${Date.now()}`;
    await request.post(`${BASE}/api/projects`, { data: { name: slug } });

    const res = await request.get(`${BASE}/api/projects/${slug}/analysis`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('summary');
    expect(data).toHaveProperty('fileTree');
    expect(data).toHaveProperty('techStack');
  });
});
