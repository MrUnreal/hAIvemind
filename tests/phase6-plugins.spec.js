// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

function read(f) { return readFileSync(path.join(ROOT, f), 'utf8'); }

/* ════════════════════════════════════════════
   Phase 6.5 — Plugin & Backend Management UI
   ════════════════════════════════════════════ */

test.describe('Phase 6.5 — SettingsPanel tabs', () => {
  test('SettingsPanel has plugins tab', () => {
    const src = read('client/src/components/SettingsPanel.vue');
    expect(src).toContain("id: 'plugins'");
    expect(src).toContain('Plugins');
  });

  test('SettingsPanel has backends tab', () => {
    const src = read('client/src/components/SettingsPanel.vue');
    expect(src).toContain("id: 'backends'");
    expect(src).toContain('Backends');
  });
});

test.describe('Phase 6.5 — Plugins UI', () => {
  test('plugins tab content exists with plugin-list', () => {
    const src = read('client/src/components/SettingsPanel.vue');
    expect(src).toContain('plugin-list');
    expect(src).toContain('plugin-card');
  });

  test('plugins tab has enable/disable toggle', () => {
    const src = read('client/src/components/SettingsPanel.vue');
    expect(src).toContain('togglePlugin');
    expect(src).toContain('toggle-plugin-btn');
  });

  test('plugins tab has reload button', () => {
    const src = read('client/src/components/SettingsPanel.vue');
    expect(src).toContain('reloadPlugin');
    expect(src).toContain('reload-plugin-btn');
  });

  test('plugins tab shows plugin name and version', () => {
    const src = read('client/src/components/SettingsPanel.vue');
    expect(src).toContain('plugin-name');
    expect(src).toContain('plugin-version');
  });

  test('plugins tab shows enabled/disabled status', () => {
    const src = read('client/src/components/SettingsPanel.vue');
    expect(src).toContain('plugin-status');
    expect(src).toContain("'enabled'");
    expect(src).toContain("'disabled'");
  });

  test('fetchPlugins fetches from /api/plugins', () => {
    const src = read('client/src/components/SettingsPanel.vue');
    expect(src).toContain("fetch('/api/plugins')");
  });

  test('togglePlugin calls enable/disable endpoints', () => {
    const src = read('client/src/components/SettingsPanel.vue');
    expect(src).toContain('/api/plugins/');
    expect(src).toContain('enable');
    expect(src).toContain('disable');
  });
});

test.describe('Phase 6.5 — Backends UI', () => {
  test('backends tab has backend list', () => {
    const src = read('client/src/components/SettingsPanel.vue');
    expect(src).toContain('backend-list');
    expect(src).toContain('backend-card');
  });

  test('backends tab has active backend selector', () => {
    const src = read('client/src/components/SettingsPanel.vue');
    expect(src).toContain('activeBackend');
    expect(src).toContain('switchBackend');
  });

  test('backends tab shows active indicator', () => {
    const src = read('client/src/components/SettingsPanel.vue');
    expect(src).toContain('backend-active');
    expect(src).toContain('✓ Active');
  });

  test('backends tab has swarm section', () => {
    const src = read('client/src/components/SettingsPanel.vue');
    expect(src).toContain('swarm-section');
    expect(src).toContain('swarm-toggle');
    expect(src).toContain('swarmStatus');
  });

  test('swarm toggle calls PUT /api/swarm', () => {
    const src = read('client/src/components/SettingsPanel.vue');
    expect(src).toContain("'/api/swarm'");
    expect(src).toContain('toggleSwarm');
  });

  test('runner list displays runner cards', () => {
    const src = read('client/src/components/SettingsPanel.vue');
    expect(src).toContain('runner-list');
    expect(src).toContain('runner-card');
    expect(src).toContain('runner-type');
    expect(src).toContain('runner-capacity');
  });

  test('fetchBackends fetches backends and swarm data', () => {
    const src = read('client/src/components/SettingsPanel.vue');
    expect(src).toContain("fetch('/api/backends')");
    expect(src).toContain("fetch('/api/backends/active')");
    expect(src).toContain("fetch('/api/swarm')");
    expect(src).toContain("fetch('/api/swarm/runners')");
  });
});

test.describe('Phase 6.5 — Lazy loading', () => {
  test('tabs lazy-load data on activation', () => {
    const src = read('client/src/components/SettingsPanel.vue');
    expect(src).toContain("tab === 'plugins'");
    expect(src).toContain('fetchPlugins');
    expect(src).toContain("tab === 'backends'");
    expect(src).toContain('fetchBackends');
  });
});

test.describe('Phase 6.5 — Integration', () => {
  test('server responds to GET /api/plugins', async ({ request }) => {
    const res = await request.get(`${API}/api/plugins`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('server responds to GET /api/backends', async ({ request }) => {
    const res = await request.get(`${API}/api/backends`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('server responds to GET /api/backends/active', async ({ request }) => {
    const res = await request.get(`${API}/api/backends/active`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('name');
  });

  test('server responds to GET /api/swarm', async ({ request }) => {
    const res = await request.get(`${API}/api/swarm`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('enabled');
  });

  test('server responds to GET /api/swarm/runners', async ({ request }) => {
    const res = await request.get(`${API}/api/swarm/runners`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBeTruthy();
  });
});
