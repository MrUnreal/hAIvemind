/**
 * Phase 9.4 — API Key Management tests
 *
 * Service unit tests, REST API tests, component source tests.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';
const SLUG = 'nonexistent-zzz';

// ────── Service unit tests ──────

test.describe('Phase 9.4 — API Key service', () => {
  let apiKeys;
  let refs;
  let WorkspaceManager;
  let fs;
  let path;
  let wm;

  const TEST_DIR = '.haivemind-workspace-test-apikeys';
  const TEST_SLUG = 'apikey-test-project';

  test.beforeAll(async () => {
    const apiMod = await import('../server/services/apiKeys.js');
    apiKeys = apiMod;
    const stateMod = await import('../server/state.js');
    refs = stateMod.refs;
    const wsMod = await import('../server/workspace.js');
    WorkspaceManager = wsMod.default;
    fs = await import('fs');
    path = await import('path');

    // Setup test workspace
    const dir = path.default.resolve(TEST_DIR);
    fs.mkdirSync(dir, { recursive: true });
    wm = new WorkspaceManager(TEST_DIR);
    wm.createProject(TEST_SLUG, { slug: TEST_SLUG });
    refs.workspace = wm;
  });

  test.afterAll(async () => {
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  test('getApiKeys returns empty array initially', () => {
    const keys = apiKeys.getApiKeys(TEST_SLUG);
    expect(keys).toEqual([]);
  });

  test('addApiKey creates a key entry with masking', () => {
    const entry = apiKeys.addApiKey(TEST_SLUG, {
      backend: 'openai',
      label: 'My OpenAI Key',
      key: 'sk-test1234567890abcdef',
    });
    expect(entry.id).toMatch(/^key-/);
    expect(entry.backend).toBe('openai');
    expect(entry.label).toBe('My OpenAI Key');
    expect(entry.maskedKey).toContain('…');
    expect(entry.maskedKey).not.toContain('test1234567890');
    expect(entry.maskedKey.endsWith('cdef')).toBe(true);
    expect(entry.keyHash).toBeTruthy();
    expect(entry.active).toBe(true);
    expect(entry.createdAt).toBeGreaterThan(0);
    expect(entry.rotatedAt).toBeNull();
  });

  test('getApiKeys returns added keys', () => {
    const keys = apiKeys.getApiKeys(TEST_SLUG);
    expect(keys.length).toBeGreaterThanOrEqual(1);
    expect(keys[0].backend).toBe('openai');
  });

  test('toggleApiKey flips active state', () => {
    const keys = apiKeys.getApiKeys(TEST_SLUG);
    const id = keys[0].id;
    expect(keys[0].active).toBe(true);
    apiKeys.toggleApiKey(TEST_SLUG, id);
    const updated = apiKeys.getApiKeys(TEST_SLUG);
    expect(updated[0].active).toBe(false);
    // Toggle back
    apiKeys.toggleApiKey(TEST_SLUG, id);
    expect(apiKeys.getApiKeys(TEST_SLUG)[0].active).toBe(true);
  });

  test('rotateApiKey updates hash and maskedKey', () => {
    const keys = apiKeys.getApiKeys(TEST_SLUG);
    const id = keys[0].id;
    const oldHash = keys[0].keyHash;
    const entry = apiKeys.rotateApiKey(TEST_SLUG, id, 'sk-newkey9876543210wxyz');
    expect(entry).not.toBeNull();
    expect(entry.keyHash).not.toBe(oldHash);
    expect(entry.maskedKey.endsWith('wxyz')).toBe(true);
    expect(entry.rotatedAt).toBeGreaterThan(0);
  });

  test('getRuntimeKey retrieves active key for backend', () => {
    const rtKey = apiKeys.getRuntimeKey(TEST_SLUG, 'openai');
    expect(rtKey).toBe('sk-newkey9876543210wxyz');
  });

  test('getRuntimeKey returns null for unknown backend', () => {
    expect(apiKeys.getRuntimeKey(TEST_SLUG, 'nonexistent')).toBeNull();
  });

  test('removeApiKey deletes the entry', () => {
    const keys = apiKeys.getApiKeys(TEST_SLUG);
    const id = keys[0].id;
    const ok = apiKeys.removeApiKey(TEST_SLUG, id);
    expect(ok).toBe(true);
    expect(apiKeys.getApiKeys(TEST_SLUG).length).toBe(0);
  });

  test('removeApiKey returns false for unknown id', () => {
    expect(apiKeys.removeApiKey(TEST_SLUG, 'key-nope')).toBe(false);
  });

  test('rotateApiKey returns null for unknown id', () => {
    expect(apiKeys.rotateApiKey(TEST_SLUG, 'key-nope', 'abc')).toBeNull();
  });

  test('toggleApiKey returns false for unknown id', () => {
    expect(apiKeys.toggleApiKey(TEST_SLUG, 'key-nope')).toBe(false);
  });

  test('maskKey handles short keys gracefully', () => {
    const entry = apiKeys.addApiKey(TEST_SLUG, {
      backend: 'custom',
      label: 'Short',
      key: 'abc',
    });
    expect(entry.maskedKey).toBe('****');
    apiKeys.removeApiKey(TEST_SLUG, entry.id);
  });

  test('cleanupApiKeys clears runtime keys', () => {
    apiKeys.addApiKey(TEST_SLUG, { backend: 'anthropic', label: 'x', key: 'sk-anthropic-key-12345678' });
    expect(apiKeys.getRuntimeKey(TEST_SLUG, 'anthropic')).toBeTruthy();
    apiKeys.cleanupApiKeys(TEST_SLUG);
    expect(apiKeys.getRuntimeKey(TEST_SLUG, 'anthropic')).toBeNull();
  });
});

// ────── REST API tests ──────

test.describe('Phase 9.4 — API Key REST endpoints', () => {
  test('GET /api/projects/:slug/api-keys returns 404 for unknown project', async () => {
    const res = await fetch(`${BASE}/api/projects/${SLUG}/api-keys`);
    expect(res.status).toBe(404);
  });

  test('POST /api/projects/:slug/api-keys returns 404 for unknown project', async () => {
    const res = await fetch(`${BASE}/api/projects/${SLUG}/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: 'openai', key: 'sk-test' }),
    });
    expect(res.status).toBe(404);
  });

  test('DELETE /api/projects/:slug/api-keys/:keyId returns 404 for unknown project', async () => {
    const res = await fetch(`${BASE}/api/projects/${SLUG}/api-keys/key-123`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  test('POST /api/projects/:slug/api-keys/:keyId/rotate returns 404 for unknown project', async () => {
    const res = await fetch(`${BASE}/api/projects/${SLUG}/api-keys/key-123/rotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'new-key' }),
    });
    expect(res.status).toBe(404);
  });

  test('PATCH /api/projects/:slug/api-keys/:keyId/toggle returns 404 for unknown project', async () => {
    const res = await fetch(`${BASE}/api/projects/${SLUG}/api-keys/key-123/toggle`, { method: 'PATCH' });
    expect(res.status).toBe(404);
  });
});

// ────── Component source tests ──────

test.describe('Phase 9.4 — ApiKeyPanel component', () => {
  let src;

  test.beforeAll(async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    src = readFileSync(resolve('client/src/components/ApiKeyPanel.vue'), 'utf-8');
  });

  test('component has visible and projectSlug props', () => {
    expect(src).toContain('visible');
    expect(src).toContain('projectSlug');
  });

  test('fetches api-keys endpoint', () => {
    expect(src).toContain('/api-keys');
  });

  test('supports add key form with backend selection', () => {
    expect(src).toContain('newBackend');
    expect(src).toContain('newKey');
    expect(src).toContain('addKey');
  });

  test('supports key rotation', () => {
    expect(src).toContain('rotate');
    expect(src).toContain('rotateKeyValue');
    expect(src).toContain('confirmRotate');
  });

  test('supports key deletion', () => {
    expect(src).toContain('deleteKey');
  });

  test('supports toggle active/inactive', () => {
    expect(src).toContain('toggleKey');
  });

  test('shows masked key display', () => {
    expect(src).toContain('maskedKey');
    expect(src).toContain('apikey-masked');
  });

  test('has eye toggle for new key visibility', () => {
    expect(src).toContain('showNewKey');
    expect(src).toContain('password');
  });

  test('supports multiple backends', () => {
    expect(src).toContain('copilot');
    expect(src).toContain('ollama');
    expect(src).toContain('openai');
    expect(src).toContain('anthropic');
  });

  test('uses CSS variables for theming', () => {
    expect(src).toContain('var(--bg-card)');
    expect(src).toContain('var(--text-primary)');
    expect(src).toContain('var(--btn-bg)');
  });

  test('has timeAgo helper', () => {
    expect(src).toContain('timeAgo');
  });
});

// ────── App.vue integration tests ──────

test.describe('Phase 9.4 — App.vue integration', () => {
  let appSrc;

  test.beforeAll(async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    appSrc = readFileSync(resolve('client/src/App.vue'), 'utf-8');
  });

  test('imports ApiKeyPanel', () => {
    expect(appSrc).toContain("import ApiKeyPanel from './components/ApiKeyPanel.vue'");
  });

  test('has Keys tab button', () => {
    expect(appSrc).toContain('🔑 Keys');
  });

  test('renders ApiKeyPanel in side content', () => {
    expect(appSrc).toContain('ApiKeyPanel');
    expect(appSrc).toContain("sideTab === 'keys'");
  });
});
