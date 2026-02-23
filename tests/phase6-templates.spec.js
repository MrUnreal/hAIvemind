// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 6.2: Template Gallery & Builder Tests ────────────────────────

test.describe('Template Gallery — REST API', () => {
  test('GET /api/project-templates returns array', async () => {
    const res = await fetch(`${API}/api/project-templates`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(3);
  });

  test('project templates have expected schema', async () => {
    const res = await fetch(`${API}/api/project-templates`);
    const data = await res.json();
    for (const tpl of data) {
      expect(tpl.id).toBeDefined();
      expect(tpl.name).toBeDefined();
      expect(typeof tpl.description).toBe('string');
    }
  });

  test('project templates include cli-tool, api-server, web-app', async () => {
    const res = await fetch(`${API}/api/project-templates`);
    const data = await res.json();
    const ids = data.map(t => t.id);
    expect(ids).toContain('cli-tool');
    expect(ids).toContain('api-server');
    expect(ids).toContain('web-app');
  });

  test('project templates have category and stack', async () => {
    const res = await fetch(`${API}/api/project-templates`);
    const data = await res.json();
    for (const tpl of data) {
      expect(tpl.category).toBeDefined();
      expect(tpl.stack).toBeDefined();
    }
  });
});

test.describe('Template Creation — POST /api/project-templates', () => {
  const testId = 'test-template-' + Date.now();

  test.afterAll(async () => {
    // Clean up test template via API
    try {
      await fetch(`${API}/api/project-templates/${testId}`, { method: 'DELETE' });
    } catch { /* ignore */ }
  });

  test('POST /api/project-templates creates a custom template', async () => {
    const res = await fetch(`${API}/api/project-templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: testId,
        name: testId,
        description: 'Test template',
        stack: ['test'],
        category: 'custom',
        tags: ['test'],
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe(testId);
    expect(data.name).toBe(testId);
  });

  test('POST /api/project-templates rejects overwriting built-in', async () => {
    const res = await fetch(`${API}/api/project-templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'cli-tool',
        name: 'CLI Tool Override',
      }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /api/project-templates rejects missing name', async () => {
    const res = await fetch(`${API}/api/project-templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'no name' }),
    });
    expect(res.status).toBe(400);
  });
});

test.describe('Template Gallery — Vue Components', () => {
  test('TemplateGallery.vue exists', () => {
    expect(existsSync(path.join(ROOT, 'client', 'src', 'components', 'TemplateGallery.vue'))).toBe(true);
  });

  test('TemplateForm.vue exists', () => {
    expect(existsSync(path.join(ROOT, 'client', 'src', 'components', 'TemplateForm.vue'))).toBe(true);
  });

  test('PromptInput.vue imports TemplateGallery', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'PromptInput.vue'), 'utf8');
    expect(src).toContain('TemplateGallery');
    expect(src).toContain('TemplateForm');
  });

  test('PromptInput.vue emits template payload', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'PromptInput.vue'), 'utf8');
    expect(src).toContain('templateId');
    expect(src).toContain('templateVars');
  });

  test('TemplateGallery fetches /api/project-templates and emits select', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'TemplateGallery.vue'), 'utf8');
    expect(src).toContain('/api/project-templates');
    expect(src).toContain("emit('select'");
  });

  test('TemplateForm shows variables and tasks', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'TemplateForm.vue'), 'utf8');
    expect(src).toContain('variables');
    expect(src).toContain('tasks');
    expect(src).toContain('update:variables');
  });

  test('App.vue onSubmit handles template payload', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'App.vue'), 'utf8');
    expect(src).toContain('templateId');
    expect(src).toContain('projectSlug');
  });
});

test.describe('Template Gallery — UI Integration', () => {
  test('template gallery renders on prompt page', async ({ page }) => {
    const slug = 'tpl-ui-' + Date.now();
    // Create project via API to skip wizard flow
    await fetch(`${API}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: slug }),
    });
    await page.goto('/');
    await page.waitForSelector('.status-dot.green', { timeout: 10000 });
    // Click on the project to select it
    const proj = page.locator(`text=${slug}`).first();
    await proj.click({ timeout: 5000 });
    await page.waitForTimeout(500);
    // Navigate to new session
    const newBtn = page.locator('button:has-text("New Session"), button:has-text("Start Session")').first();
    if (await newBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await newBtn.click();
    }
    // Template gallery should appear (renders if project-templates endpoint returns data)
    await expect(page.locator('.template-gallery').first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Template Session Start — Project Template Fallback', () => {
  test('project templates listing includes starterPrompts', async () => {
    const res = await fetch(`${API}/api/project-templates`);
    const data = await res.json();
    const apiServer = data.find(t => t.id === 'api-server');
    expect(apiServer).toBeDefined();
    expect(Array.isArray(apiServer.starterPrompts)).toBe(true);
    expect(apiServer.starterPrompts.length).toBeGreaterThan(0);
  });

  test('handlers.js imports getProjectTemplate for fallback', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'ws', 'handlers.js'), 'utf8');
    expect(src).toContain("import { getProjectTemplate }");
    expect(src).toContain("getProjectTemplate(templateId)");
  });

  test('handlers.js falls back to project template when file template missing', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'ws', 'handlers.js'), 'utf8');
    // Should try file first, then fall back
    expect(src).toContain('fs.readFile(templatePath');
    expect(src).toContain('getProjectTemplate(templateId)');
    // Should convert starterPrompts to tasks
    expect(src).toContain('starterPrompts');
    expect(src).toContain('phase-');
  });

  test('TemplateForm.vue shows starterPrompts as Build Phases', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'TemplateForm.vue'), 'utf8');
    expect(src).toContain('starterPrompts');
    expect(src).toContain('Build Phases');
  });

  test('TemplateGallery.vue displays stack as joined string', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'TemplateGallery.vue'), 'utf8');
    expect(src).toContain("tpl.stack.join");
    expect(src).toContain("' · '");
  });
});
