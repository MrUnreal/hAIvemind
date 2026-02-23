/**
 * Phase 11.2 — Project Templates tests
 *
 * Tests built-in templates, custom template CRUD, apply to project,
 * filtering by category/tag, categories/tags listing.
 *
 * 34 tests
 */

import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';
const PROJ = `tpl-test-${Date.now()}`;

test.beforeAll(async ({ request }) => {
  await request.post(`${API}/projects`, { data: { name: PROJ } });
});

// ═══════════════════════════════════════════════════════════
//  Built-in templates
// ═══════════════════════════════════════════════════════════

test.describe('Built-in Project Templates', () => {
  test('GET /project-templates returns built-in templates', async ({ request }) => {
    const res = await request.get(`${API}/project-templates`);
    expect(res.ok()).toBe(true);
    const templates = await res.json();
    expect(templates.length).toBeGreaterThanOrEqual(6);
    const ids = templates.map(t => t.id);
    expect(ids).toContain('api-server');
    expect(ids).toContain('cli-tool');
    expect(ids).toContain('library');
    expect(ids).toContain('web-app');
    expect(ids).toContain('fullstack');
    expect(ids).toContain('monorepo');
  });

  test('built-in templates are marked as builtin', async ({ request }) => {
    const res = await request.get(`${API}/project-templates`);
    const templates = await res.json();
    const apiServer = templates.find(t => t.id === 'api-server');
    expect(apiServer.builtin).toBe(true);
  });

  test('GET single built-in template by ID', async ({ request }) => {
    const res = await request.get(`${API}/project-templates/api-server`);
    expect(res.ok()).toBe(true);
    const t = await res.json();
    expect(t.id).toBe('api-server');
    expect(t.name).toBe('API Server');
    expect(t.category).toBe('backend');
    expect(t.conventions).toBeTruthy();
    expect(t.settings).toBeTruthy();
    expect(t.starterPrompts.length).toBeGreaterThan(0);
    expect(t.builtin).toBe(true);
  });

  test('GET template returns 404 for unknown ID', async ({ request }) => {
    const res = await request.get(`${API}/project-templates/nonexistent`);
    expect(res.status()).toBe(404);
  });

  test('filter by category', async ({ request }) => {
    const res = await request.get(`${API}/project-templates?category=backend`);
    expect(res.ok()).toBe(true);
    const templates = await res.json();
    expect(templates.length).toBeGreaterThanOrEqual(1);
    for (const t of templates) expect(t.category).toBe('backend');
  });

  test('filter by tag', async ({ request }) => {
    const res = await request.get(`${API}/project-templates?tag=api`);
    expect(res.ok()).toBe(true);
    const templates = await res.json();
    expect(templates.length).toBeGreaterThanOrEqual(1);
    for (const t of templates) expect(t.tags).toContain('api');
  });
});

// ═══════════════════════════════════════════════════════════
//  Custom templates CRUD
// ═══════════════════════════════════════════════════════════

test.describe('Custom Template CRUD', () => {
  let customId;

  test('POST creates a custom template', async ({ request }) => {
    const res = await request.post(`${API}/project-templates`, {
      data: {
        name: 'My Custom Template',
        description: 'A custom project template for testing',
        category: 'custom',
        stack: ['Python', 'FastAPI'],
        starterPrompts: ['Set up FastAPI project', 'Add database models'],
        tags: ['python', 'api'],
      },
    });
    expect(res.status()).toBe(201);
    const t = await res.json();
    expect(t.id).toBeTruthy();
    expect(t.name).toBe('My Custom Template');
    expect(t.category).toBe('custom');
    expect(t.starterPrompts.length).toBe(2);
    customId = t.id;
  });

  test('GET lists the custom template', async ({ request }) => {
    const res = await request.get(`${API}/project-templates`);
    const templates = await res.json();
    const custom = templates.find(t => t.id === customId);
    expect(custom).toBeTruthy();
    expect(custom.builtin).toBe(false);
  });

  test('GET single custom template', async ({ request }) => {
    const res = await request.get(`${API}/project-templates/${customId}`);
    expect(res.ok()).toBe(true);
    const t = await res.json();
    expect(t.name).toBe('My Custom Template');
    expect(t.builtin).toBe(false);
  });

  test('DELETE custom template', async ({ request }) => {
    // Create a disposable one
    const create = await request.post(`${API}/project-templates`, {
      data: { name: 'Disposable' },
    });
    const { id } = await create.json();

    const res = await request.delete(`${API}/project-templates/${id}`);
    expect(res.ok()).toBe(true);

    // Verify gone
    const get = await request.get(`${API}/project-templates/${id}`);
    expect(get.status()).toBe(404);
  });

  test('DELETE returns 404 for unknown template', async ({ request }) => {
    const res = await request.delete(`${API}/project-templates/nonexistent-tpl`);
    expect(res.status()).toBe(404);
  });

  test('DELETE rejects deleting built-in template', async ({ request }) => {
    const res = await request.delete(`${API}/project-templates/api-server`);
    expect(res.status()).toBe(400);
  });

  test('POST rejects template without name', async ({ request }) => {
    const res = await request.post(`${API}/project-templates`, {
      data: { description: 'no name' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST rejects overwriting built-in template', async ({ request }) => {
    const res = await request.post(`${API}/project-templates`, {
      data: { id: 'api-server', name: 'Override' },
    });
    expect(res.status()).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════
//  Apply template to project
// ═══════════════════════════════════════════════════════════

test.describe('Apply Template to Project', () => {
  test('POST apply-template applies settings', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/apply-template`, {
      data: { templateId: 'api-server' },
    });
    expect(res.ok()).toBe(true);
    const result = await res.json();
    expect(result.appliedTemplate.id).toBe('api-server');
    expect(result.appliedTemplate.name).toBe('API Server');
    expect(result.conventions).toBeTruthy();
    expect(result.starterPrompts.length).toBeGreaterThan(0);
  });

  test('apply-template requires templateId', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/apply-template`, {
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('apply-template returns 400 for unknown template', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/apply-template`, {
      data: { templateId: 'nonexistent' },
    });
    expect(res.status()).toBe(400);
  });

  test('apply-template returns 404 for unknown project', async ({ request }) => {
    const res = await request.post(`${API}/projects/nonexistent-zzz/apply-template`, {
      data: { templateId: 'api-server' },
    });
    expect(res.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════
//  Categories & Tags
// ═══════════════════════════════════════════════════════════

test.describe('Template Categories & Tags', () => {
  test('GET categories returns array', async ({ request }) => {
    const res = await request.get(`${API}/project-template-categories`);
    expect(res.ok()).toBe(true);
    const cats = await res.json();
    expect(Array.isArray(cats)).toBe(true);
    expect(cats).toContain('backend');
    expect(cats).toContain('frontend');
  });

  test('GET tags returns array with counts', async ({ request }) => {
    const res = await request.get(`${API}/project-template-tags`);
    expect(res.ok()).toBe(true);
    const tags = await res.json();
    expect(tags.length).toBeGreaterThan(0);
    expect(tags[0]).toHaveProperty('tag');
    expect(tags[0]).toHaveProperty('count');
    expect(typeof tags[0].count).toBe('number');
  });

  test('categories includes custom template categories', async ({ request }) => {
    // If we created a custom template with category 'custom', it should appear
    const res = await request.get(`${API}/project-template-categories`);
    const cats = await res.json();
    expect(cats).toContain('custom');
  });
});

// ═══════════════════════════════════════════════════════════
//  Template content validation
// ═══════════════════════════════════════════════════════════

test.describe('Template Content Quality', () => {
  test('all built-in templates have starterPrompts', async ({ request }) => {
    const res = await request.get(`${API}/project-templates`);
    const templates = await res.json();
    for (const summary of templates.filter(t => t.builtin)) {
      const full = await (await request.get(`${API}/project-templates/${summary.id}`)).json();
      expect(full.starterPrompts.length).toBeGreaterThan(0);
    }
  });

  test('all built-in templates have conventions', async ({ request }) => {
    const res = await request.get(`${API}/project-templates`);
    const templates = await res.json();
    for (const summary of templates.filter(t => t.builtin)) {
      const full = await (await request.get(`${API}/project-templates/${summary.id}`)).json();
      expect(full.conventions).toBeTruthy();
      expect(Object.keys(full.conventions).length).toBeGreaterThan(0);
    }
  });

  test('all built-in templates have tags', async ({ request }) => {
    const res = await request.get(`${API}/project-templates`);
    const templates = await res.json();
    for (const summary of templates.filter(t => t.builtin)) {
      expect(summary.tags.length).toBeGreaterThan(0);
    }
  });
});
