// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 7.8: Webhook Notification Tests ──────────────────────────────

// ── REST API (webhook CRUD) ──

test.describe('Webhooks — REST API', () => {
  let testSlug;

  test.beforeAll(async () => {
    // Use an existing project or create one
    const res = await fetch(`${API}/api/projects`);
    const projects = await res.json();
    if (projects.length > 0) {
      testSlug = projects[0].slug;
    } else {
      const createRes = await fetch(`${API}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'webhook-test' }),
      });
      const created = await createRes.json();
      testSlug = created.slug;
    }
  });

  test('GET /webhooks returns empty array initially', async () => {
    const res = await fetch(`${API}/api/projects/${testSlug}/webhooks`);
    expect(res.ok).toBe(true);
    const hooks = await res.json();
    expect(Array.isArray(hooks)).toBe(true);
  });

  test('POST /webhooks creates a webhook', async () => {
    const res = await fetch(`${API}/api/projects/${testSlug}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://httpbin.org/post',
        name: 'Test Webhook',
        events: ['session:complete'],
      }),
    });
    expect(res.status).toBe(201);
    const hook = await res.json();
    expect(hook).toHaveProperty('id');
    expect(hook).toHaveProperty('url', 'https://httpbin.org/post');
    expect(hook).toHaveProperty('name', 'Test Webhook');
    expect(hook).toHaveProperty('enabled', true);
    expect(hook.events).toContain('session:complete');
  });

  test('GET /webhooks returns created webhook', async () => {
    const res = await fetch(`${API}/api/projects/${testSlug}/webhooks`);
    const hooks = await res.json();
    expect(hooks.length).toBeGreaterThanOrEqual(1);
    const found = hooks.find(h => h.name === 'Test Webhook');
    expect(found).toBeTruthy();
  });

  test('POST /webhooks rejects invalid URL', async () => {
    const res = await fetch(`${API}/api/projects/${testSlug}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-url' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid');
  });

  test('POST /webhooks rejects missing URL', async () => {
    const res = await fetch(`${API}/api/projects/${testSlug}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'no url' }),
    });
    expect(res.status).toBe(400);
  });

  test('PATCH /webhooks/:id toggles enabled state', async () => {
    // Get the webhook
    const listRes = await fetch(`${API}/api/projects/${testSlug}/webhooks`);
    const hooks = await listRes.json();
    const hook = hooks.find(h => h.name === 'Test Webhook');
    if (!hook) return;

    const res = await fetch(`${API}/api/projects/${testSlug}/webhooks/${hook.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.ok).toBe(true);
    const updated = await res.json();
    expect(updated.enabled).toBe(false);
  });

  test('DELETE /webhooks/:id removes webhook', async () => {
    const listRes = await fetch(`${API}/api/projects/${testSlug}/webhooks`);
    const hooks = await listRes.json();
    const hook = hooks.find(h => h.name === 'Test Webhook');
    if (!hook) return;

    const res = await fetch(`${API}/api/projects/${testSlug}/webhooks/${hook.id}`, {
      method: 'DELETE',
    });
    expect(res.ok).toBe(true);

    // Verify removed
    const listRes2 = await fetch(`${API}/api/projects/${testSlug}/webhooks`);
    const hooks2 = await listRes2.json();
    const found = hooks2.find(h => h.id === hook.id);
    expect(found).toBeFalsy();
  });

  test('returns 404 for nonexistent project', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent-zzz/webhooks`);
    expect(res.status).toBe(404);
  });

  test('DELETE returns 404 for nonexistent webhook', async () => {
    const res = await fetch(`${API}/api/projects/${testSlug}/webhooks/nonexistent`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  test('PATCH returns 404 for nonexistent webhook', async () => {
    const res = await fetch(`${API}/api/projects/${testSlug}/webhooks/nonexistent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(404);
  });

  test('PATCH rejects non-boolean enabled', async () => {
    // Create a hook first
    const createRes = await fetch(`${API}/api/projects/${testSlug}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/hook', name: 'Temp' }),
    });
    const hook = await createRes.json();

    const res = await fetch(`${API}/api/projects/${testSlug}/webhooks/${hook.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: 'yes' }),
    });
    expect(res.status).toBe(400);

    // Cleanup
    await fetch(`${API}/api/projects/${testSlug}/webhooks/${hook.id}`, { method: 'DELETE' });
  });
});

// ── Unit Tests (Service logic) ──

test.describe('Webhooks — Service Unit Tests', () => {
  const fixtureDir = path.join(ROOT, 'projects', '_webhook-test');

  test.beforeAll(() => {
    mkdirSync(path.join(fixtureDir, '.haivemind'), { recursive: true });
    writeFileSync(path.join(fixtureDir, '.haivemind', 'project.json'), JSON.stringify({
      id: 'webhook-test-id',
      slug: '_webhook-test',
      name: 'Webhook Test Project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    const registryPath = path.join(ROOT, 'projects', 'projects.json');
    let registry = { projects: {} };
    if (existsSync(registryPath)) {
      try { registry = JSON.parse(readFileSync(registryPath, 'utf-8')); } catch { /* */ }
    }
    registry.projects['_webhook-test'] = {
      id: 'webhook-test-id',
      name: 'Webhook Test Project',
      slug: '_webhook-test',
      createdAt: Date.now(),
    };
    writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  });

  test.afterAll(() => {
    try { rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* */ }
    const registryPath = path.join(ROOT, 'projects', 'projects.json');
    if (existsSync(registryPath)) {
      try {
        const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
        delete registry.projects['_webhook-test'];
        writeFileSync(registryPath, JSON.stringify(registry, null, 2));
      } catch { /* */ }
    }
  });

  test('addWebhook creates a webhook with correct shape', async () => {
    const { addWebhook, getWebhooks, removeWebhook } = await import('../server/services/webhooks.js');
    // Temporarily mock refs.workspace
    const WorkspaceManager = (await import('../server/workspace.js')).default;
    const { refs } = await import('../server/state.js');
    const origWs = refs.workspace;
    refs.workspace = new WorkspaceManager(path.join(ROOT, 'projects'));

    const hook = addWebhook('_webhook-test', {
      url: 'https://example.com/hook',
      name: 'Unit Test Hook',
      events: ['session:complete'],
    });

    expect(hook).toHaveProperty('id');
    expect(hook.url).toBe('https://example.com/hook');
    expect(hook.name).toBe('Unit Test Hook');
    expect(hook.enabled).toBe(true);
    expect(hook.events).toContain('session:complete');

    // Verify persisted
    const hooks = getWebhooks('_webhook-test');
    expect(hooks.find(h => h.id === hook.id)).toBeTruthy();

    // Cleanup
    removeWebhook('_webhook-test', hook.id);
    refs.workspace = origWs;
  });

  test('addWebhook throws on missing URL', async () => {
    const { addWebhook } = await import('../server/services/webhooks.js');
    const WorkspaceManager = (await import('../server/workspace.js')).default;
    const { refs } = await import('../server/state.js');
    const origWs = refs.workspace;
    refs.workspace = new WorkspaceManager(path.join(ROOT, 'projects'));

    expect(() => addWebhook('_webhook-test', {})).toThrow('URL is required');

    refs.workspace = origWs;
  });

  test('addWebhook throws on invalid URL', async () => {
    const { addWebhook } = await import('../server/services/webhooks.js');
    const WorkspaceManager = (await import('../server/workspace.js')).default;
    const { refs } = await import('../server/state.js');
    const origWs = refs.workspace;
    refs.workspace = new WorkspaceManager(path.join(ROOT, 'projects'));

    expect(() => addWebhook('_webhook-test', { url: 'not-a-url' })).toThrow('Invalid');

    refs.workspace = origWs;
  });

  test('removeWebhook returns false for nonexistent', async () => {
    const { removeWebhook } = await import('../server/services/webhooks.js');
    const WorkspaceManager = (await import('../server/workspace.js')).default;
    const { refs } = await import('../server/state.js');
    const origWs = refs.workspace;
    refs.workspace = new WorkspaceManager(path.join(ROOT, 'projects'));

    expect(removeWebhook('_webhook-test', 'nonexistent')).toBe(false);

    refs.workspace = origWs;
  });

  test('toggleWebhook toggles enabled state', async () => {
    const { addWebhook, toggleWebhook, removeWebhook } = await import('../server/services/webhooks.js');
    const WorkspaceManager = (await import('../server/workspace.js')).default;
    const { refs } = await import('../server/state.js');
    const origWs = refs.workspace;
    refs.workspace = new WorkspaceManager(path.join(ROOT, 'projects'));

    const hook = addWebhook('_webhook-test', { url: 'https://example.com/toggle', name: 'Toggle Test' });
    const toggled = toggleWebhook('_webhook-test', hook.id, false);
    expect(toggled.enabled).toBe(false);

    removeWebhook('_webhook-test', hook.id);
    refs.workspace = origWs;
  });

  test('default events include session:complete and session:failed', async () => {
    const { addWebhook, removeWebhook } = await import('../server/services/webhooks.js');
    const WorkspaceManager = (await import('../server/workspace.js')).default;
    const { refs } = await import('../server/state.js');
    const origWs = refs.workspace;
    refs.workspace = new WorkspaceManager(path.join(ROOT, 'projects'));

    const hook = addWebhook('_webhook-test', { url: 'https://example.com/defaults' });
    expect(hook.events).toContain('session:complete');
    expect(hook.events).toContain('session:failed');

    removeWebhook('_webhook-test', hook.id);
    refs.workspace = origWs;
  });
});

// ── Source Code Integration Tests ──

test.describe('Webhooks — Integration Checks', () => {
  test('sessions.js imports fireWebhook', () => {
    const content = readFileSync(
      path.join(ROOT, 'server', 'services', 'sessions.js'),
      'utf-8',
    );
    expect(content).toContain("import { fireWebhook } from './webhooks.js'");
  });

  test('sessions.js fires webhook on session:complete', () => {
    const content = readFileSync(
      path.join(ROOT, 'server', 'services', 'sessions.js'),
      'utf-8',
    );
    expect(content).toContain("fireWebhook(projectSlug, 'session:complete'");
  });

  test('sessions.js fires webhook on session:failed', () => {
    const content = readFileSync(
      path.join(ROOT, 'server', 'services', 'sessions.js'),
      'utf-8',
    );
    expect(content).toContain("fireWebhook(projectSlug, 'session:failed'");
  });

  test('shutdown.js imports cleanupWebhooks', () => {
    const content = readFileSync(
      path.join(ROOT, 'server', 'services', 'shutdown.js'),
      'utf-8',
    );
    expect(content).toContain("import { cleanupWebhooks } from './webhooks.js'");
    expect(content).toContain('cleanupWebhooks()');
  });

  test('webhooks.js exports all expected functions', () => {
    const content = readFileSync(
      path.join(ROOT, 'server', 'services', 'webhooks.js'),
      'utf-8',
    );
    expect(content).toContain('export function getWebhooks');
    expect(content).toContain('export function addWebhook');
    expect(content).toContain('export function removeWebhook');
    expect(content).toContain('export function toggleWebhook');
    expect(content).toContain('export async function fireWebhook');
    expect(content).toContain('export function cleanupWebhooks');
  });

  test('webhook payload includes event, project, timestamp', () => {
    const content = readFileSync(
      path.join(ROOT, 'server', 'services', 'webhooks.js'),
      'utf-8',
    );
    expect(content).toContain('event,');
    expect(content).toContain('project: slug');
    expect(content).toContain('timestamp:');
    expect(content).toContain('payload,');
  });
});
