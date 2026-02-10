// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 6.2: Template Gallery & Builder Tests ────────────────────────

test.describe('Template Gallery — REST API', () => {
  test('GET /api/templates returns array', async () => {
    const res = await fetch(`${API}/api/templates`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(3);
  });

  test('templates have expected schema', async () => {
    const res = await fetch(`${API}/api/templates`);
    const data = await res.json();
    for (const tpl of data) {
      expect(tpl.id).toBeDefined();
      expect(tpl.name).toBeDefined();
      expect(Array.isArray(tpl.tasks)).toBe(true);
    }
  });

  test('templates include cli-tool, express-api, react-app', async () => {
    const res = await fetch(`${API}/api/templates`);
    const data = await res.json();
    const ids = data.map(t => t.id);
    expect(ids).toContain('cli-tool');
    expect(ids).toContain('express-api');
    expect(ids).toContain('react-app');
  });

  test('templates have variables array', async () => {
    const res = await fetch(`${API}/api/templates`);
    const data = await res.json();
    for (const tpl of data) {
      expect(Array.isArray(tpl.variables)).toBe(true);
    }
  });
});

test.describe('Template Creation — POST /api/templates', () => {
  const testId = 'test-template-' + Date.now();
  const testFile = path.join(ROOT, 'templates', `${testId}.json`);

  test.afterAll(() => {
    // Clean up test template
    try { unlinkSync(testFile); } catch { /* ignore */ }
  });

  test('POST /api/templates creates a template', async () => {
    const res = await fetch(`${API}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: testId,
        description: 'Test template',
        stack: 'test',
        variables: [{ name: 'testVar', label: 'Test Variable', default: 'hello' }],
        tasks: [{ id: 'task1', label: 'Test Task', description: 'Test', dependencies: [] }],
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe(testId);
    expect(data.name).toBe(testId);
  });

  test('POST /api/templates rejects duplicate', async () => {
    const res = await fetch(`${API}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'CLI Tool',
        tasks: [{ id: 'a', label: 'A' }],
      }),
    });
    expect(res.status).toBe(409);
  });

  test('POST /api/templates rejects missing tasks', async () => {
    const res = await fetch(`${API}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Invalid Template' }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /api/templates rejects missing name', async () => {
    const res = await fetch(`${API}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: [{ id: 'a', label: 'A' }] }),
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

  test('TemplateGallery fetches /api/templates and emits select', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'TemplateGallery.vue'), 'utf8');
    expect(src).toContain('/api/templates');
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
    await page.goto('/');
    // Wait for connection
    await page.waitForSelector('.status-dot.green', { timeout: 10000 });
    // Create a project to get to prompt page
    const createInput = page.locator('input[placeholder*="project name"]');
    await createInput.fill('template-test-' + Date.now());
    await page.click('button:has-text("Create")');
    await page.waitForTimeout(1000);
    // Navigate to new session
    const newBtn = page.locator('button:has-text("New Session"), button:has-text("Start Session")').first();
    if (await newBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await newBtn.click();
    }
    // Should see the prompt page with template gallery
    await expect(page.locator('.template-gallery').first()).toBeVisible({ timeout: 10000 });
  });
});
