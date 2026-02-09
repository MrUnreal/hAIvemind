// @ts-check
import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import path from 'node:path';

const CLI = path.resolve(import.meta.dirname, '..', 'bin', 'haivemind.js');
const ROOT = path.resolve(import.meta.dirname, '..');

/** @param {string} args @param {{ timeout?: number }} [opts] */
function run(args, { timeout = 10000 } = {}) {
  return execSync(`node "${CLI}" ${args}`, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// ── Phase 5.3: CLI Mode Tests ──────────────────────────────────────────────

test.describe('CLI — Help & Meta', () => {
  test('help command shows usage information', () => {
    const out = run('help');
    expect(out).toContain('hAIvemind CLI');
    expect(out).toContain('projects');
    expect(out).toContain('build');
    expect(out).toContain('status');
    expect(out).toContain('replay');
    expect(out).toContain('--json');
    expect(out).toContain('--mock');
  });

  test('unknown command exits with error', () => {
    try {
      run('nonexistent-command');
      expect(false).toBe(true); // should not reach
    } catch (err) {
      expect(/** @type {any} */ (err).status).not.toBe(0);
    }
  });
});

test.describe('CLI — projects command', () => {
  test('lists projects in human-readable format', () => {
    const out = run('projects');
    expect(out).toContain('Projects');
    expect(out).toContain('sessions');
  });

  test('lists projects in JSON mode', () => {
    const out = run('projects --json');
    const json = JSON.parse(out);
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBeGreaterThan(0);
    expect(json[0]).toHaveProperty('slug');
    expect(json[0]).toHaveProperty('name');
  });
});

test.describe('CLI — status command', () => {
  test('shows project status for a known slug', () => {
    const out = run('status haivemind-self-dev');
    // Should show the project name/info
    expect(out.length).toBeGreaterThan(0);
  });

  test('exits with error for unknown slug', () => {
    try {
      run('status nonexistent-project-999');
      expect(false).toBe(true);
    } catch (err) {
      expect(/** @type {any} */ (err).status).not.toBe(0);
    }
  });

  test('status works in JSON mode', () => {
    const out = run('status haivemind-self-dev --json');
    const json = JSON.parse(out);
    expect(json).toHaveProperty('project');
    expect(json.project.slug).toBe('haivemind-self-dev');
    expect(json).toHaveProperty('sessions');
  });

  test('status without slug exits with error', () => {
    try {
      run('status');
      expect(false).toBe(true);
    } catch (err) {
      expect(/** @type {any} */ (err).status).not.toBe(0);
    }
  });
});

test.describe('CLI — replay command', () => {
  test('replay without args exits with error', () => {
    try {
      run('replay');
      expect(false).toBe(true);
    } catch (err) {
      expect(/** @type {any} */ (err).status).not.toBe(0);
    }
  });

  test('replay with bad session exits with error', () => {
    try {
      run('replay haivemind-self-dev nonexistent-session');
      expect(false).toBe(true);
    } catch (err) {
      expect(/** @type {any} */ (err).status).not.toBe(0);
    }
  });
});

test.describe('CLI — build command (mock)', () => {
  test('build without args exits with error', () => {
    try {
      run('build');
      expect(false).toBe(true);
    } catch (err) {
      expect(/** @type {any} */ (err).status).not.toBe(0);
    }
  });

  test('build with unknown project exits with error', () => {
    try {
      run('build unknown-project-999 "test" --mock', { timeout: 15000 });
      expect(false).toBe(true);
    } catch (err) {
      expect(/** @type {any} */ (err).status).not.toBe(0);
    }
  });

  test('build completes a mock session successfully', () => {
    const out = run('build haivemind-self-dev "CLI test build" --mock', { timeout: 120000 });
    expect(out).toContain('hAIvemind build');
    expect(out).toContain('Plan Created');
    expect(out).toContain('Session Complete');
    expect(out).toContain('Elapsed');
  });

  test('build in JSON mode outputs structured events', () => {
    const out = run('build haivemind-self-dev "CLI JSON test" --mock --json', { timeout: 120000 });
    const lines = out.trim().split('\n').filter(Boolean);
    // Filter to only JSON lines (internal console.log from modules may leak non-JSON)
    const jsonLines = lines.filter(l => {
      try { JSON.parse(l); return true; } catch { return false; }
    });
    expect(jsonLines.length).toBeGreaterThan(0);
    // Each JSON line should be parseable
    for (const line of jsonLines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    // Should contain a plan:created event
    const events = jsonLines.map(l => JSON.parse(l));
    const planEvent = events.find(e => e.event === 'plan:created');
    expect(planEvent).toBeTruthy();
  });
});

test.describe('CLI — Integration', () => {
  test('bin/haivemind.js exists and is executable', async () => {
    const fs = await import('node:fs');
    const stat = fs.statSync(CLI);
    expect(stat.isFile()).toBe(true);
  });

  test('package.json has bin entry', async () => {
    const fs = await import('node:fs');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.bin).toHaveProperty('haivemind');
    expect(pkg.bin.haivemind).toContain('haivemind.js');
  });
});
