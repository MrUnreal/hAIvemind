// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 6.1: Environment Configuration & Structured Logging Tests ────

test.describe('Logger — File Structure', () => {
  test('server/logger.js exists', () => {
    expect(existsSync(path.join(ROOT, 'server', 'logger.js'))).toBe(true);
  });

  test('logger exports createLogger and default', async () => {
    const mod = await import('../server/logger.js');
    expect(mod.default).toBeDefined();
    expect(typeof mod.createLogger).toBe('function');
  });

  test('logger.info/warn/error/debug are functions', async () => {
    const log = (await import('../server/logger.js')).default;
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.debug).toBe('function');
  });

  test('createLogger returns scoped logger', async () => {
    const { createLogger } = await import('../server/logger.js');
    const scoped = createLogger('test');
    expect(typeof scoped.info).toBe('function');
    expect(typeof scoped.error).toBe('function');
  });
});

test.describe('Logger — Source Analysis', () => {
  test('server/index.js uses log.info instead of console.log', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
    expect(src).toContain('log.info(');
    expect(src).not.toMatch(/console\.log\(/);
  });

  test('server/index.js uses log.warn instead of console.warn', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
    expect(src).toContain('log.warn(');
    expect(src).not.toMatch(/console\.warn\(/);
  });

  test('server modules use log.error instead of console.error', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'services', 'shutdown.js'), 'utf8');
    expect(src).toContain('log.error(');
    const indexSrc = readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
    expect(indexSrc).not.toMatch(/console\.error\(/);
  });

  test('server/index.js imports logger', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
    expect(src).toContain("from './logger.js'");
  });

  test('logger supports LOG_LEVEL env var', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'logger.js'), 'utf8');
    expect(src).toContain('LOG_LEVEL');
  });

  test('logger supports LOG_FORMAT=json mode', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'logger.js'), 'utf8');
    expect(src).toContain('LOG_FORMAT');
    expect(src).toContain('json');
  });
});

test.describe('Environment Config — .env.example', () => {
  test('.env.example exists', () => {
    expect(existsSync(path.join(ROOT, '.env.example'))).toBe(true);
  });

  test('.env.example documents PORT', () => {
    const env = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    expect(env).toContain('PORT=');
  });

  test('.env.example documents LOG_LEVEL and LOG_FORMAT', () => {
    const env = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    expect(env).toContain('LOG_LEVEL=');
    expect(env).toContain('LOG_FORMAT=');
  });

  test('.env.example documents HAIVEMIND_ prefixed vars', () => {
    const env = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    expect(env).toContain('HAIVEMIND_MAX_CONCURRENCY=');
    expect(env).toContain('HAIVEMIND_DEFAULT_BACKEND=');
    expect(env).toContain('HAIVEMIND_AGENT_TIMEOUT_MS=');
    expect(env).toContain('HAIVEMIND_SWARM_ENABLED=');
    expect(env).toContain('HAIVEMIND_PLUGINS_DIR=');
  });

  test('.env.example documents COPILOT_CMD', () => {
    const env = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    expect(env).toContain('COPILOT_CMD=');
  });
});

test.describe('Environment Config — config.js env overrides', () => {
  test('config.js loads .env file', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'config.js'), 'utf8');
    expect(src).toContain('.env');
    expect(src).toContain('readFileSync');
  });

  test('config.js has env() helper', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'config.js'), 'utf8');
    expect(src).toMatch(/function env\(/);
    expect(src).toMatch(/function envInt\(/);
    expect(src).toMatch(/function envBool\(/);
  });

  test('config uses envInt for numeric values', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'config.js'), 'utf8');
    expect(src).toContain("envInt('HAIVEMIND_MAX_CONCURRENCY'");
    expect(src).toContain("envInt('HAIVEMIND_AGENT_TIMEOUT_MS'");
    expect(src).toContain("envInt('PORT'");
  });

  test('config uses envBool for boolean values', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'config.js'), 'utf8');
    expect(src).toContain("envBool('HAIVEMIND_SWARM_ENABLED'");
    expect(src).toContain("envBool('HAIVEMIND_PLUGINS_AUTOLOAD'");
  });

  test('config uses env for string values', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'config.js'), 'utf8');
    expect(src).toContain("env('HAIVEMIND_DEFAULT_BACKEND'");
    expect(src).toContain("env('HAIVEMIND_OLLAMA_HOST'");
    expect(src).toContain("env('HAIVEMIND_PLUGINS_DIR'");
  });

  test('config defaults are unchanged', async () => {
    const cfg = (await import('../server/config.js')).default;
    expect(cfg.maxConcurrency).toBe(3);
    expect(cfg.port).toBe(3000);
    expect(cfg.defaultBackend).toBe('copilot');
    expect(cfg.plugins.dir).toBe('plugins');
    expect(cfg.swarm.enabled).toBe(false);
  });
});

test.describe('Environment Config — .gitignore', () => {
  test('.gitignore includes .env', () => {
    const gi = readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    expect(gi).toContain('.env');
  });
});

test.describe('Server Health with Logger', () => {
  test('server responds to API requests with new logger', async () => {
    const res = await fetch(`${API}/api/projects`);
    expect(res.ok).toBe(true);
  });

  test('server responds to backends endpoint', async () => {
    const res = await fetch(`${API}/api/backends`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});
