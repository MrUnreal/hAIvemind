// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 8.6: Webhook UI Panel Tests ─────────────────────────────────

// ── REST API Tests (test endpoint) ──

test.describe('Webhook Panel — REST API', () => {
  test('test endpoint returns 404 for missing project', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent-zzz/webhooks/wh-test/test`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });

  test('GET webhooks returns 404 for missing project', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent-zzz/webhooks`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain('not found');
  });

  test('POST webhook returns 404 for missing project', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent-zzz/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    expect(res.status).toBe(404);
  });

  test('DELETE webhook returns 404 for missing project', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent-zzz/webhooks/wh-nope`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  test('PATCH webhook returns 404 for missing project', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent-zzz/webhooks/wh-nope`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(404);
  });
});

// ── Webhook Service Unit Tests ──

test.describe('Webhook Panel — Service', () => {
  // Service functions use refs.workspace from state.js — set up a real WorkspaceManager
  // so webhooks actually persist between add/toggle/remove calls.
  let cleanup;
  test.beforeAll(async () => {
    const { refs } = await import('../server/state.js');
    const { default: WorkspaceManager } = await import('../server/workspace.js');
    const { mkdirSync } = await import('node:fs');
    const testSlugDir = path.join(ROOT, '.haivemind-workspace', 'wh-test-slug', '.haivemind');
    mkdirSync(testSlugDir, { recursive: true });
    refs.workspace = new WorkspaceManager();
    cleanup = () => {
      const { rmSync } = require('node:fs');
      try { rmSync(path.join(ROOT, '.haivemind-workspace', 'wh-test-slug'), { recursive: true }); } catch {}
    };
  });
  test.afterAll(async () => {
    const { rmSync } = await import('node:fs');
    try { rmSync(path.join(ROOT, '.haivemind-workspace', 'wh-test-slug'), { recursive: true, force: true }); } catch {}
  });

  const SLUG = 'wh-test-slug';

  test('getWebhooks returns empty array for unknown project', async () => {
    const { getWebhooks } = await import('../server/services/webhooks.js');
    const result = getWebhooks('nonexistent-zzz');
    expect(result).toEqual([]);
  });

  test('addWebhook throws without URL', async () => {
    const { addWebhook } = await import('../server/services/webhooks.js');
    expect(() => addWebhook(SLUG, {})).toThrow('URL is required');
  });

  test('addWebhook throws for invalid URL', async () => {
    const { addWebhook } = await import('../server/services/webhooks.js');
    expect(() => addWebhook(SLUG, { url: 'not-a-url' })).toThrow('Invalid');
  });

  test('addWebhook creates webhook with defaults', async () => {
    const { addWebhook, removeWebhook } = await import('../server/services/webhooks.js');
    const hook = addWebhook(SLUG, { url: 'https://example.com/hook' });
    expect(hook).toHaveProperty('id');
    expect(hook.url).toBe('https://example.com/hook');
    expect(hook.enabled).toBe(true);
    expect(hook.events).toContain('session:complete');
    expect(hook.events).toContain('session:failed');
    expect(hook.deliveries).toBe(0);

    // Clean up
    removeWebhook(SLUG, hook.id);
  });

  test('toggleWebhook changes enabled state', async () => {
    const { addWebhook, toggleWebhook, removeWebhook } = await import('../server/services/webhooks.js');
    const hook = addWebhook(SLUG, { url: 'https://example.com/toggle' });
    expect(hook.enabled).toBe(true);

    const toggled = toggleWebhook(SLUG, hook.id, false);
    expect(toggled.enabled).toBe(false);

    const reToggled = toggleWebhook(SLUG, hook.id, true);
    expect(reToggled.enabled).toBe(true);

    removeWebhook(SLUG, hook.id);
  });

  test('removeWebhook returns false for missing', async () => {
    const { removeWebhook } = await import('../server/services/webhooks.js');
    expect(removeWebhook(SLUG, 'wh-ghost')).toBe(false);
  });

  test('toggleWebhook returns null for missing', async () => {
    const { toggleWebhook } = await import('../server/services/webhooks.js');
    expect(toggleWebhook(SLUG, 'wh-ghost', true)).toBeNull();
  });
});

// ── Client Component Tests ──

test.describe('Webhook Panel — Client Component', () => {
  test('WebhookPanel.vue exists and has template', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/WebhookPanel.vue'), 'utf8');
    expect(content).toContain('<template>');
    expect(content).toContain('<script setup>');
  });

  test('has add webhook form', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/WebhookPanel.vue'), 'utf8');
    expect(content).toContain('wh-add-form');
    expect(content).toContain('wh-add-btn');
    expect(content).toContain('placeholder');
  });

  test('has webhook list with actions', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/WebhookPanel.vue'), 'utf8');
    expect(content).toContain('wh-list');
    expect(content).toContain('wh-item');
    expect(content).toContain('wh-actions');
  });

  test('supports toggle, test, and delete actions', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/WebhookPanel.vue'), 'utf8');
    expect(content).toContain('toggleHook');
    expect(content).toContain('testHook');
    expect(content).toContain('deleteHook');
  });

  test('has test result display', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/WebhookPanel.vue'), 'utf8');
    expect(content).toContain('wh-test-result');
    expect(content).toContain('testResult');
  });

  test('has event picker checkboxes', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/WebhookPanel.vue'), 'utf8');
    expect(content).toContain('wh-event-check');
    expect(content).toContain('session:started');
    expect(content).toContain('session:complete');
    expect(content).toContain('session:failed');
  });

  test('shows delivery stats', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/WebhookPanel.vue'), 'utf8');
    expect(content).toContain('deliveries');
    expect(content).toContain('wh-stats');
    expect(content).toContain('wh-failures');
  });

  test('SessionHistory has webhook toggle button', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/SessionHistory.vue'), 'utf8');
    expect(content).toContain('webhook-toggle-btn');
    expect(content).toContain('WebhookPanel');
    expect(content).toContain('showWebhooks');
  });
});
