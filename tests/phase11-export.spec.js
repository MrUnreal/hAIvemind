/**
 * Phase 11.4 — Export/Import tests
 *
 * Tests project export, archive validation/preview, and import
 * including conflict strategies (skip, overwrite, merge).
 *
 * 30 tests
 */

import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';
const PROJ = `export-test-${Date.now()}`;
let exportedArchive = null;

test.beforeAll(async ({ request }) => {
  // Create a project with settings and a session
  await request.post(`${API}/projects`, { data: { name: PROJ } });

  // Add some settings (collaborators, memory)
  await request.post(`${API}/projects/${PROJ}/collaborators`, {
    data: { userId: 'alice', name: 'Alice', role: 'admin' },
  });
  await request.post(`${API}/projects/${PROJ}/memory`, {
    data: { type: 'pattern', key: 'test-key', content: 'Use ESM imports', tags: ['style'] },
  });
  await request.post(`${API}/projects/${PROJ}/activity`, {
    data: { userId: 'alice', action: 'setup', detail: 'Initial setup' },
  });
});

// ═══════════════════════════════════════════════════════════
//  Export
// ═══════════════════════════════════════════════════════════

test.describe('Export', () => {
  test('GET export returns full archive', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/export`);
    expect(res.ok()).toBe(true);
    const archive = await res.json();

    expect(archive.manifest).toBeTruthy();
    expect(archive.manifest.format).toBe('haivemind-project-archive');
    expect(archive.manifest.version).toBe(1);
    expect(archive.manifest.exportedAt).toBeTruthy();
    expect(archive.manifest.sourceSlug).toBe(PROJ);

    expect(archive.project).toBeTruthy();
    expect(archive.project.name).toBe(PROJ);
    expect(archive.project.slug).toBe(PROJ);

    expect(archive.settings).toBeTruthy();
    expect(archive.sessions).toBeDefined();

    // Store for import tests
    exportedArchive = archive;
  });

  test('GET export with sessions=false excludes sessions', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/export?sessions=false`);
    const archive = await res.json();
    expect(archive.sessions).toBeUndefined();
    expect(archive.manifest.includes.sessions).toBe(false);
  });

  test('GET export with settings=false excludes settings', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/export?settings=false`);
    const archive = await res.json();
    expect(archive.settings).toBeUndefined();
    expect(archive.manifest.includes.settings).toBe(false);
  });

  test('GET export with memory=false strips memory from settings', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/export?memory=false`);
    const archive = await res.json();
    expect(archive.settings).toBeTruthy();
    expect(archive.settings.agentMemory).toBeUndefined();
    expect(archive.manifest.includes.memory).toBe(false);
  });

  test('GET export 404 for unknown project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/export`);
    expect(res.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════
//  Validate
// ═══════════════════════════════════════════════════════════

test.describe('Validate', () => {
  test('POST validate accepts valid archive', async ({ request }) => {
    const res = await request.post(`${API}/projects/import/validate`, {
      data: exportedArchive,
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.errors.length).toBe(0);
  });

  test('POST validate rejects missing manifest', async ({ request }) => {
    const res = await request.post(`${API}/projects/import/validate`, {
      data: { project: { name: 'X', slug: 'x' } },
    });
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.errors).toContain('Missing manifest');
  });

  test('POST validate rejects wrong format', async ({ request }) => {
    const res = await request.post(`${API}/projects/import/validate`, {
      data: {
        manifest: { format: 'wrong', version: 1 },
        project: { name: 'X', slug: 'x' },
      },
    });
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  test('POST validate rejects missing project', async ({ request }) => {
    const res = await request.post(`${API}/projects/import/validate`, {
      data: {
        manifest: { format: 'haivemind-project-archive', version: 1 },
      },
    });
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.errors).toContain('Missing project data');
  });

  test('POST validate rejects future version', async ({ request }) => {
    const res = await request.post(`${API}/projects/import/validate`, {
      data: {
        manifest: { format: 'haivemind-project-archive', version: 999 },
        project: { name: 'X', slug: 'x' },
      },
    });
    const body = await res.json();
    expect(body.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
//  Preview
// ═══════════════════════════════════════════════════════════

test.describe('Preview', () => {
  test('POST preview returns summary', async ({ request }) => {
    const res = await request.post(`${API}/projects/import/preview`, {
      data: exportedArchive,
    });
    expect(res.ok()).toBe(true);
    const preview = await res.json();
    expect(preview.valid).toBe(true);
    expect(preview.project.name).toBe(PROJ);
    expect(preview.contents).toBeTruthy();
    expect(preview.contents.settings).toBe(true);
    expect(typeof preview.contents.sessions).toBe('number');
  });

  test('POST preview detects conflict with existing project', async ({ request }) => {
    const res = await request.post(`${API}/projects/import/preview`, {
      data: exportedArchive,
    });
    const preview = await res.json();
    expect(preview.conflict).toBeTruthy();
    expect(preview.conflict.exists).toBe(true);
    expect(preview.conflict.slug).toBe(PROJ);
  });

  test('POST preview returns invalid for bad archive', async ({ request }) => {
    const res = await request.post(`${API}/projects/import/preview`, {
      data: { bad: 'data' },
    });
    const preview = await res.json();
    expect(preview.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
//  Import
// ═══════════════════════════════════════════════════════════

test.describe('Import', () => {
  test('POST import rejects invalid archive', async ({ request }) => {
    const res = await request.post(`${API}/projects/import`, {
      data: { archive: { bad: 'data' } },
    });
    expect(res.status()).toBe(400);
  });

  test('POST import rejects missing archive', async ({ request }) => {
    const res = await request.post(`${API}/projects/import`, {
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('POST import with skip conflict strategy returns 409', async ({ request }) => {
    const res = await request.post(`${API}/projects/import`, {
      data: {
        archive: exportedArchive,
        options: { conflictStrategy: 'skip' },
      },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  test('POST import into new slug creates project', async ({ request }) => {
    const newSlug = `imported-${Date.now()}`;
    const res = await request.post(`${API}/projects/import`, {
      data: {
        archive: exportedArchive,
        options: { targetSlug: newSlug, targetName: 'Imported Project' },
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.slug).toBe(newSlug);
    expect(body.created).toBe(true);

    // Verify project exists
    const get = await request.get(`${API}/projects/${newSlug}`);
    expect(get.ok()).toBe(true);
    const project = await get.json();
    expect(project.name).toBe('Imported Project');

    // Verify settings were imported (collaborators from original)
    const collabs = await request.get(`${API}/projects/${newSlug}/collaborators`);
    const collabList = await collabs.json();
    expect(collabList.find(c => c.userId === 'alice')).toBeTruthy();
  });

  test('POST import with merge strategy merges settings', async ({ request }) => {
    const mergeSlug = `merge-${Date.now()}`;
    // First create the project
    await request.post(`${API}/projects`, { data: { name: mergeSlug } });
    // Add a collaborator to existing project
    await request.post(`${API}/projects/${mergeSlug}/collaborators`, {
      data: { userId: 'existing-user', name: 'Existing', role: 'viewer' },
    });

    // Import with merge
    const res = await request.post(`${API}/projects/import`, {
      data: {
        archive: exportedArchive,
        options: { targetSlug: mergeSlug, conflictStrategy: 'merge' },
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.created).toBe(false);
    expect(body.warnings.length).toBeGreaterThan(0);
  });

  test('POST import with overwrite strategy replaces settings', async ({ request }) => {
    const owSlug = `overwrite-${Date.now()}`;
    await request.post(`${API}/projects`, { data: { name: owSlug } });

    const res = await request.post(`${API}/projects/import`, {
      data: {
        archive: exportedArchive,
        options: { targetSlug: owSlug, conflictStrategy: 'overwrite' },
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.created).toBe(false);
  });
});
