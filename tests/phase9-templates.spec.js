/**
 * Phase 9.5 — Session Templates tests
 *
 * Service unit tests, REST API tests, component source tests.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';
const SLUG = 'nonexistent-zzz';

// ────── Service unit tests ──────

test.describe('Phase 9.5 — Session Templates service', () => {
  let tmplService;
  let refs;
  let WorkspaceManager;
  let fs;
  let path;

  const TEST_DIR = '.haivemind-workspace-test-templates';
  const TEST_SLUG = 'tmpl-test-project';

  test.beforeAll(async () => {
    tmplService = await import('../server/services/sessionTemplates.js');
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

  test('getTemplates returns empty array initially', () => {
    expect(tmplService.getTemplates(TEST_SLUG)).toEqual([]);
  });

  test('addTemplate creates a template', () => {
    const tmpl = tmplService.addTemplate(TEST_SLUG, {
      name: 'Add Tests',
      prompt: 'Write unit tests for the auth module',
      description: 'Standard test template',
      category: 'test',
    });
    expect(tmpl.id).toMatch(/^tmpl-/);
    expect(tmpl.name).toBe('Add Tests');
    expect(tmpl.prompt).toBe('Write unit tests for the auth module');
    expect(tmpl.category).toBe('test');
    expect(tmpl.useCount).toBe(0);
    expect(tmpl.createdAt).toBeGreaterThan(0);
  });

  test('getTemplates returns added template', () => {
    const templates = tmplService.getTemplates(TEST_SLUG);
    expect(templates.length).toBe(1);
    expect(templates[0].name).toBe('Add Tests');
  });

  test('getTemplate returns single template by ID', () => {
    const all = tmplService.getTemplates(TEST_SLUG);
    const tmpl = tmplService.getTemplate(TEST_SLUG, all[0].id);
    expect(tmpl).not.toBeNull();
    expect(tmpl.name).toBe('Add Tests');
  });

  test('getTemplate returns null for unknown id', () => {
    expect(tmplService.getTemplate(TEST_SLUG, 'tmpl-nope')).toBeNull();
  });

  test('updateTemplate modifies fields', () => {
    const all = tmplService.getTemplates(TEST_SLUG);
    const updated = tmplService.updateTemplate(TEST_SLUG, all[0].id, {
      name: 'Add Tests v2',
      category: 'debug',
    });
    expect(updated.name).toBe('Add Tests v2');
    expect(updated.category).toBe('debug');
    expect(updated.prompt).toBe('Write unit tests for the auth module');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(updated.createdAt);
  });

  test('updateTemplate returns null for unknown id', () => {
    expect(tmplService.updateTemplate(TEST_SLUG, 'tmpl-nope', { name: 'x' })).toBeNull();
  });

  test('updateTemplate rejects invalid category', () => {
    const all = tmplService.getTemplates(TEST_SLUG);
    const updated = tmplService.updateTemplate(TEST_SLUG, all[0].id, {
      category: 'invalid-cat',
    });
    // Category should remain unchanged
    expect(updated.category).toBe('debug');
  });

  test('useTemplate increments useCount', () => {
    const all = tmplService.getTemplates(TEST_SLUG);
    const id = all[0].id;
    expect(all[0].useCount).toBe(0);
    const used = tmplService.useTemplate(TEST_SLUG, id);
    expect(used.useCount).toBe(1);
    tmplService.useTemplate(TEST_SLUG, id);
    expect(tmplService.getTemplate(TEST_SLUG, id).useCount).toBe(2);
  });

  test('useTemplate returns null for unknown id', () => {
    expect(tmplService.useTemplate(TEST_SLUG, 'tmpl-nope')).toBeNull();
  });

  test('duplicateTemplate creates copy', () => {
    const all = tmplService.getTemplates(TEST_SLUG);
    const copy = tmplService.duplicateTemplate(TEST_SLUG, all[0].id);
    expect(copy.name).toContain('(copy)');
    expect(copy.prompt).toBe(all[0].prompt);
    expect(copy.useCount).toBe(0);
    expect(copy.id).not.toBe(all[0].id);
    expect(tmplService.getTemplates(TEST_SLUG).length).toBe(2);
  });

  test('duplicateTemplate returns null for unknown id', () => {
    expect(tmplService.duplicateTemplate(TEST_SLUG, 'tmpl-nope')).toBeNull();
  });

  test('removeTemplate deletes the template', () => {
    const all = tmplService.getTemplates(TEST_SLUG);
    const ok = tmplService.removeTemplate(TEST_SLUG, all[1].id);
    expect(ok).toBe(true);
    expect(tmplService.getTemplates(TEST_SLUG).length).toBe(1);
  });

  test('removeTemplate returns false for unknown id', () => {
    expect(tmplService.removeTemplate(TEST_SLUG, 'tmpl-nope')).toBe(false);
  });

  test('CATEGORIES is exported', () => {
    expect(tmplService.CATEGORIES).toContain('feature');
    expect(tmplService.CATEGORIES).toContain('test');
    expect(tmplService.CATEGORIES).toContain('custom');
  });

  test('addTemplate defaults to custom category for invalid category', () => {
    const tmpl = tmplService.addTemplate(TEST_SLUG, {
      name: 'Unknown Cat',
      prompt: 'Do something',
      category: 'banana',
    });
    expect(tmpl.category).toBe('custom');
    tmplService.removeTemplate(TEST_SLUG, tmpl.id);
  });
});

// ────── REST API tests ──────

test.describe('Phase 9.5 — Session Templates REST endpoints', () => {
  test('GET /api/projects/:slug/templates returns 404 for unknown project', async () => {
    const res = await fetch(`${BASE}/api/projects/${SLUG}/templates`);
    expect(res.status).toBe(404);
  });

  test('GET /api/projects/:slug/templates/:id returns 404 for unknown project', async () => {
    const res = await fetch(`${BASE}/api/projects/${SLUG}/templates/tmpl-123`);
    expect(res.status).toBe(404);
  });

  test('POST /api/projects/:slug/templates returns 404 for unknown project', async () => {
    const res = await fetch(`${BASE}/api/projects/${SLUG}/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', prompt: 'test' }),
    });
    expect(res.status).toBe(404);
  });

  test('PATCH /api/projects/:slug/templates/:id returns 404 for unknown project', async () => {
    const res = await fetch(`${BASE}/api/projects/${SLUG}/templates/tmpl-123`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(res.status).toBe(404);
  });

  test('DELETE /api/projects/:slug/templates/:id returns 404 for unknown project', async () => {
    const res = await fetch(`${BASE}/api/projects/${SLUG}/templates/tmpl-123`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  test('POST /api/projects/:slug/templates/:id/use returns 404 for unknown project', async () => {
    const res = await fetch(`${BASE}/api/projects/${SLUG}/templates/tmpl-123/use`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  test('POST /api/projects/:slug/templates/:id/duplicate returns 404 for unknown project', async () => {
    const res = await fetch(`${BASE}/api/projects/${SLUG}/templates/tmpl-123/duplicate`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

// ────── Component source tests ──────

test.describe('Phase 9.5 — TemplatesPanel component', () => {
  let src;

  test.beforeAll(async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    src = readFileSync(resolve('client/src/components/TemplatesPanel.vue'), 'utf-8');
  });

  test('component has visible and projectSlug props', () => {
    expect(src).toContain('visible');
    expect(src).toContain('projectSlug');
  });

  test('fetches templates endpoint', () => {
    expect(src).toContain('/templates');
  });

  test('supports create form with name and prompt', () => {
    expect(src).toContain('form.name');
    expect(src).toContain('form.prompt');
    expect(src).toContain('saveTemplate');
  });

  test('supports category filter', () => {
    expect(src).toContain('filterCat');
    expect(src).toContain('tmpl-filter-btn');
  });

  test('supports launch action', () => {
    expect(src).toContain('launchTemplate');
    expect(src).toContain("emit('launch'");
  });

  test('supports duplicate action', () => {
    expect(src).toContain('/duplicate');
  });

  test('supports edit and delete', () => {
    expect(src).toContain('editTemplate');
    expect(src).toContain('deleteTemplate');
  });

  test('shows use count', () => {
    expect(src).toContain('useCount');
  });

  test('uses CSS variables for theming', () => {
    expect(src).toContain('var(--bg-card)');
    expect(src).toContain('var(--text-primary)');
  });

  test('has prompt preview with truncation', () => {
    expect(src).toContain('truncate');
    expect(src).toContain('tmpl-prompt-preview');
  });
});

// ────── App.vue integration tests ──────

test.describe('Phase 9.5 — App.vue integration', () => {
  let appSrc;

  test.beforeAll(async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    appSrc = readFileSync(resolve('client/src/App.vue'), 'utf-8');
  });

  test('imports TemplatesPanel', () => {
    expect(appSrc).toContain("import TemplatesPanel from './components/TemplatesPanel.vue'");
  });

  test('has Templates tab button', () => {
    expect(appSrc).toContain('📋 Templates');
  });

  test('renders TemplatesPanel in side content', () => {
    expect(appSrc).toContain('TemplatesPanel');
    expect(appSrc).toContain("sideTab === 'templates'");
  });

  test('has handleTemplateLaunch function', () => {
    expect(appSrc).toContain('handleTemplateLaunch');
  });
});
