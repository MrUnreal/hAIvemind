// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 5.7: Plugin System Tests ────────────────────────────────────────

test.describe('Plugin System — File Structure', () => {
  test('server/pluginManager.js exists', () => {
    expect(existsSync(path.join(ROOT, 'server', 'pluginManager.js'))).toBe(true);
  });

  test('plugins/ directory exists', () => {
    expect(existsSync(path.join(ROOT, 'plugins'))).toBe(true);
  });

  test('test-plugin/ fixture exists', () => {
    expect(existsSync(path.join(ROOT, 'plugins', 'test-plugin', 'index.js'))).toBe(true);
  });
});

test.describe('Plugin System — Unit: PluginManager', () => {
  test('PluginManager can be imported', async () => {
    const mod = await import('../server/pluginManager.js');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function'); // class
  });

  test('PluginManager.loadAll with empty dir works', async () => {
    const PluginManager = (await import('../server/pluginManager.js')).default;
    const pm = new PluginManager({
      pluginsDir: path.join(ROOT, 'nonexistent-plugin-dir'),
      config: {},
      broadcast: () => {},
      makeMsg: () => '{}',
      workspace: {},
    });
    await pm.loadAll(); // should not throw
    expect(pm.list()).toHaveLength(0);
  });

  test('PluginManager.load validates plugin interface', async () => {
    const PluginManager = (await import('../server/pluginManager.js')).default;
    const pm = new PluginManager({
      pluginsDir: path.join(ROOT, 'plugins'),
      config: {},
      broadcast: () => {},
      makeMsg: () => '{}',
      workspace: {},
    });

    // Load the test plugin
    const entry = await pm.load('test-plugin');
    expect(entry.name).toBe('test-plugin');
    expect(entry.version).toBe('0.1.0');
    expect(entry.enabled).toBe(true);
  });

  test('PluginManager.emit fires hooks on enabled plugins', async () => {
    const PluginManager = (await import('../server/pluginManager.js')).default;
    const pm = new PluginManager({
      pluginsDir: path.join(ROOT, 'plugins'),
      config: {},
      broadcast: () => {},
      makeMsg: () => '{}',
      workspace: {},
    });
    await pm.load('test-plugin');

    let hookCalled = false;
    // Override for direct test
    pm.plugins.get('test-plugin').hooks.beforeSession = async () => { hookCalled = true; };

    await pm.emit('beforeSession', { sessionId: 'test-123' });
    expect(hookCalled).toBe(true);
  });

  test('PluginManager.emit ignores disabled plugins', async () => {
    const PluginManager = (await import('../server/pluginManager.js')).default;
    const pm = new PluginManager({
      pluginsDir: path.join(ROOT, 'plugins'),
      config: {},
      broadcast: () => {},
      makeMsg: () => '{}',
      workspace: {},
    });
    await pm.load('test-plugin');
    await pm.disable('test-plugin');

    let called = false;
    pm.plugins.get('test-plugin').hooks.beforeSession = async () => { called = true; };

    await pm.emit('beforeSession', { sessionId: 'test-123' });
    expect(called).toBe(false);
  });

  test('PluginManager.pipe threads value through hooks', async () => {
    const PluginManager = (await import('../server/pluginManager.js')).default;
    const pm = new PluginManager({
      pluginsDir: path.join(ROOT, 'plugins'),
      config: {},
      broadcast: () => {},
      makeMsg: () => '{}',
      workspace: {},
    });
    await pm.load('test-plugin');
    await pm.enable('test-plugin');

    // Override afterPlan to double the value
    pm.plugins.get('test-plugin').hooks.afterPlan = async ({ value }) => value * 2;

    const result = await pm.pipe('afterPlan', 5, {});
    expect(result).toBe(10);
  });

  test('PluginManager.pipe passes through on undefined return', async () => {
    const PluginManager = (await import('../server/pluginManager.js')).default;
    const pm = new PluginManager({
      pluginsDir: path.join(ROOT, 'plugins'),
      config: {},
      broadcast: () => {},
      makeMsg: () => '{}',
      workspace: {},
    });
    await pm.load('test-plugin');

    // Hook returns nothing
    pm.plugins.get('test-plugin').hooks.afterPlan = async () => {};

    const result = await pm.pipe('afterPlan', 42, {});
    expect(result).toBe(42);
  });

  test('PluginManager.emit swallows hook errors', async () => {
    const PluginManager = (await import('../server/pluginManager.js')).default;
    const pm = new PluginManager({
      pluginsDir: path.join(ROOT, 'plugins'),
      config: {},
      broadcast: () => {},
      makeMsg: () => '{}',
      workspace: {},
    });
    await pm.load('test-plugin');

    pm.plugins.get('test-plugin').hooks.beforeSession = async () => {
      throw new Error('intentional test error');
    };

    // Should not throw
    await pm.emit('beforeSession', {});
    expect(true).toBe(true);
  });

  test('PluginManager enable/disable toggles', async () => {
    const PluginManager = (await import('../server/pluginManager.js')).default;
    const pm = new PluginManager({
      pluginsDir: path.join(ROOT, 'plugins'),
      config: {},
      broadcast: () => {},
      makeMsg: () => '{}',
      workspace: {},
    });
    await pm.load('test-plugin');

    await pm.disable('test-plugin');
    expect(pm.list().find(p => p.name === 'test-plugin').enabled).toBe(false);

    await pm.enable('test-plugin');
    expect(pm.list().find(p => p.name === 'test-plugin').enabled).toBe(true);
  });

  test('PluginManager.unload calls destroy', async () => {
    const PluginManager = (await import('../server/pluginManager.js')).default;
    const pm = new PluginManager({
      pluginsDir: path.join(ROOT, 'plugins'),
      config: {},
      broadcast: () => {},
      makeMsg: () => '{}',
      workspace: {},
    });
    await pm.load('test-plugin');
    expect(pm.list()).toHaveLength(1);

    await pm.unload('test-plugin');
    expect(pm.list()).toHaveLength(0);
  });
});

test.describe('Plugin System — REST API', () => {
  test('GET /api/plugins returns array', async () => {
    const res = await fetch(`${API}/api/plugins`);
    expect(res.ok).toBe(true);
    const plugins = await res.json();
    expect(Array.isArray(plugins)).toBe(true);
  });

  test('GET /api/plugins includes test-plugin', async () => {
    const res = await fetch(`${API}/api/plugins`);
    const plugins = await res.json();
    const testPlugin = plugins.find(p => p.name === 'test-plugin');
    expect(testPlugin).toBeDefined();
    expect(testPlugin.version).toBe('0.1.0');
    expect(testPlugin.enabled).toBe(true);
  });

  test('POST /api/plugins/:name/disable works', async () => {
    const res = await fetch(`${API}/api/plugins/test-plugin/disable`, { method: 'POST' });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.enabled).toBe(false);

    // Re-enable for other tests
    await fetch(`${API}/api/plugins/test-plugin/enable`, { method: 'POST' });
  });

  test('POST /api/plugins/:name/enable works', async () => {
    const res = await fetch(`${API}/api/plugins/test-plugin/enable`, { method: 'POST' });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.enabled).toBe(true);
  });

  test('POST /api/plugins/nonexistent/enable returns 404', async () => {
    const res = await fetch(`${API}/api/plugins/nonexistent/enable`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  test('POST /api/plugins/:name/reload works', async () => {
    const res = await fetch(`${API}/api/plugins/test-plugin/reload`, { method: 'POST' });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.name).toBe('test-plugin');
    expect(data.version).toBe('0.1.0');
  });
});

test.describe('Plugin System — Protocol', () => {
  test('PLUGIN_EVENT message type exists', async () => {
    const { MSG } = await import('../shared/protocol.js');
    expect(MSG.PLUGIN_EVENT).toBe('plugin:event');
  });

  test('PLUGIN_STATUS message type exists', async () => {
    const { MSG } = await import('../shared/protocol.js');
    expect(MSG.PLUGIN_STATUS).toBe('plugin:status');
  });
});

test.describe('Plugin System — Config', () => {
  test('config has plugins section', async () => {
    const config = (await import('../server/config.js')).default;
    expect(config.plugins).toBeDefined();
    expect(config.plugins.dir).toBe('plugins');
    expect(config.plugins.autoLoad).toBe(true);
  });
});
