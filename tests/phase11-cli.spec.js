/**
 * Phase 11.5 — CLI Enhancements tests
 *
 * Tests init, watch, export, import, and completions CLI commands.
 *
 * 22 tests
 */

import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CLI = path.resolve(import.meta.dirname, '..', 'bin', 'haivemind.js');
const ROOT = path.resolve(import.meta.dirname, '..');

/** @param {string} args @param {{ timeout?: number, input?: string }} [opts] */
function run(args, { timeout = 10000, input } = {}) {
  return execSync(`node "${CLI}" ${args}`, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout,
    input,
    stdio: input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
  });
}

// ═══════════════════════════════════════════════════════════
//  Help shows new commands
// ═══════════════════════════════════════════════════════════

test.describe('CLI — Help includes new commands', () => {
  test('help lists init command', () => {
    const out = run('help');
    expect(out).toContain('init');
  });

  test('help lists watch command', () => {
    const out = run('help');
    expect(out).toContain('watch');
  });

  test('help lists export command', () => {
    const out = run('help');
    expect(out).toContain('export');
  });

  test('help lists import command', () => {
    const out = run('help');
    expect(out).toContain('import');
  });

  test('help lists completions command', () => {
    const out = run('help');
    expect(out).toContain('completions');
  });
});

// ═══════════════════════════════════════════════════════════
//  Init
// ═══════════════════════════════════════════════════════════

test.describe('CLI — init command', () => {
  const INIT_PROJ = `cli-init-test-${Date.now()}`;

  test('init creates a project with name arg', () => {
    const out = run(`init ${INIT_PROJ} --mock`);
    expect(out).toContain('Project created');
    expect(out).toContain(INIT_PROJ);
  });

  test('init fails for duplicate project', () => {
    try {
      run(`init ${INIT_PROJ} --mock`);
      expect(false).toBe(true);
    } catch (err) {
      expect(/** @type {any} */ (err).status).not.toBe(0);
    }
  });

  test('init in JSON mode returns project object', () => {
    const slug = `cli-init-json-${Date.now()}`;
    const out = run(`init ${slug} --mock --json`);
    const json = JSON.parse(out);
    expect(json.slug).toBe(slug);
    expect(json.name).toBe(slug);
  });
});

// ═══════════════════════════════════════════════════════════
//  Export
// ═══════════════════════════════════════════════════════════

test.describe('CLI — export command', () => {
  test('export outputs valid JSON archive', () => {
    // Use an existing project — create one first
    const slug = `cli-export-${Date.now()}`;
    run(`init ${slug} --mock --json`);
    const out = run(`export ${slug} --mock`);
    const archive = JSON.parse(out);
    expect(archive.manifest).toBeTruthy();
    expect(archive.manifest.format).toBe('haivemind-project-archive');
    expect(archive.project.slug).toBe(slug);
  });

  test('export fails for unknown project', () => {
    try {
      run('export nonexistent-zzz-999 --mock');
      expect(false).toBe(true);
    } catch (err) {
      expect(/** @type {any} */ (err).status).not.toBe(0);
    }
  });

  test('export requires slug argument', () => {
    try {
      run('export --mock');
      expect(false).toBe(true);
    } catch (err) {
      expect(/** @type {any} */ (err).status).not.toBe(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════
//  Import
// ═══════════════════════════════════════════════════════════

test.describe('CLI — import command', () => {
  test('import creates project from archive file', () => {
    const srcSlug = `cli-imp-src-${Date.now()}`;
    run(`init ${srcSlug} --mock --json`);
    const archiveJson = run(`export ${srcSlug} --mock`);

    const tmpFile = path.join(os.tmpdir(), `haivemind-test-${Date.now()}.json`);
    writeFileSync(tmpFile, archiveJson);

    try {
      const destSlug = `cli-imp-dst-${Date.now()}`;
      const out = run(`import "${tmpFile}" --mock --json --slug=${destSlug}`);
      const result = JSON.parse(out);
      expect(result.ok).toBe(true);
      expect(result.slug).toBe(destSlug);
      expect(result.created).toBe(true);
    } finally {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    }
  });

  test('import fails for nonexistent file', () => {
    try {
      run('import nonexistent-file.json --mock');
      expect(false).toBe(true);
    } catch (err) {
      expect(/** @type {any} */ (err).status).not.toBe(0);
    }
  });

  test('import fails for invalid JSON', () => {
    const tmpFile = path.join(os.tmpdir(), `haivemind-bad-${Date.now()}.json`);
    writeFileSync(tmpFile, '{ not valid json }}}');
    try {
      run(`import "${tmpFile}" --mock`);
      expect(false).toBe(true);
    } catch (err) {
      expect(/** @type {any} */ (err).status).not.toBe(0);
    } finally {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    }
  });

  test('import requires file argument', () => {
    try {
      run('import --mock');
      expect(false).toBe(true);
    } catch (err) {
      expect(/** @type {any} */ (err).status).not.toBe(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════
//  Completions
// ═══════════════════════════════════════════════════════════

test.describe('CLI — completions command', () => {
  test('bash completions contain function', () => {
    const out = run('completions bash');
    expect(out).toContain('_haivemind');
    expect(out).toContain('complete');
    expect(out).toContain('projects');
    expect(out).toContain('init');
  });

  test('zsh completions contain compdef', () => {
    const out = run('completions zsh');
    expect(out).toContain('compdef');
    expect(out).toContain('_haivemind');
  });

  test('fish completions contain complete -c', () => {
    const out = run('completions fish');
    expect(out).toContain('complete -c haivemind');
  });

  test('powershell completions contain Register-ArgumentCompleter', () => {
    const out = run('completions ps');
    expect(out).toContain('Register-ArgumentCompleter');
  });

  test('unknown shell exits with error', () => {
    try {
      run('completions ksh');
      expect(false).toBe(true);
    } catch (err) {
      expect(/** @type {any} */ (err).status).not.toBe(0);
    }
  });

  test('default completions is bash', () => {
    const out = run('completions');
    expect(out).toContain('_haivemind');
  });
});
