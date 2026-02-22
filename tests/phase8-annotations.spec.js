// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

// ── Phase 8.2: Agent Output Annotations Tests ─────────────────────────

// ── annotateFilePaths() Unit Tests ──

test.describe('Agent Output Annotations — annotateFilePaths()', () => {
  /** @type {import('../client/src/utils/fileAnnotations.js')} */
  let mod;

  test.beforeAll(async () => {
    mod = await import('../client/src/utils/fileAnnotations.js');
  });

  test('annotates simple JS file path', () => {
    const html = 'Created src/index.js successfully';
    const result = mod.annotateFilePaths(html);
    expect(result).toContain('class="file-annotation"');
    expect(result).toContain('data-path="src/index.js"');
  });

  test('annotates path with line number', () => {
    const html = 'Error at src/server.ts:42';
    const result = mod.annotateFilePaths(html);
    expect(result).toContain('data-path="src/server.ts"');
    expect(result).toContain('data-line="42"');
  });

  test('annotates path with line and column', () => {
    const html = 'Warning src/utils.js:10:5 something';
    const result = mod.annotateFilePaths(html);
    expect(result).toContain('data-path="src/utils.js"');
    expect(result).toContain('data-line="10"');
    expect(result).toContain('data-col="5"');
  });

  test('annotates relative path with ./', () => {
    const html = 'Modified ./server/routes/sessions.js';
    const result = mod.annotateFilePaths(html);
    expect(result).toContain('data-path="./server/routes/sessions.js"');
  });

  test('annotates Vue file', () => {
    const html = 'Compiled App.vue with warnings';
    const result = mod.annotateFilePaths(html);
    expect(result).toContain('data-path="App.vue"');
  });

  test('annotates Python file', () => {
    const html = 'File server/main.py:100';
    const result = mod.annotateFilePaths(html);
    expect(result).toContain('data-path="server/main.py"');
    expect(result).toContain('data-line="100"');
  });

  test('annotates multiple files in same text', () => {
    const html = 'Modified src/a.js and src/b.ts';
    const result = mod.annotateFilePaths(html);
    expect(result).toContain('data-path="src/a.js"');
    expect(result).toContain('data-path="src/b.ts"');
  });

  test('returns empty string for empty input', () => {
    expect(mod.annotateFilePaths('')).toBe('');
    expect(mod.annotateFilePaths(null)).toBe(null);
    expect(mod.annotateFilePaths(undefined)).toBe(undefined);
  });

  test('does not annotate non-file-path text', () => {
    const html = 'Hello world, no files here';
    const result = mod.annotateFilePaths(html);
    expect(result).not.toContain('file-annotation');
  });

  test('includes title attribute for tooltip', () => {
    const html = 'Error in src/app.ts:25';
    const result = mod.annotateFilePaths(html);
    expect(result).toContain('title="Click to view src/app.ts:25"');
  });

  test('handles JSON file paths', () => {
    const html = 'Reading package.json for config';
    const result = mod.annotateFilePaths(html);
    expect(result).toContain('data-path="package.json"');
  });

  test('handles nested directory paths', () => {
    const html = 'Writing client/src/components/MyWidget.vue';
    const result = mod.annotateFilePaths(html);
    expect(result).toContain('data-path="client/src/components/MyWidget.vue"');
  });
});

// ── extractFileRefs() Unit Tests ──

test.describe('Agent Output Annotations — extractFileRefs()', () => {
  /** @type {import('../client/src/utils/fileAnnotations.js')} */
  let mod;

  test.beforeAll(async () => {
    mod = await import('../client/src/utils/fileAnnotations.js');
  });

  test('extracts file paths from text', () => {
    const refs = mod.extractFileRefs('Modified src/index.js and tests/app.spec.js');
    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(refs.find(r => r.path === 'src/index.js')).toBeTruthy();
    expect(refs.find(r => r.path === 'tests/app.spec.js')).toBeTruthy();
  });

  test('extracts line numbers', () => {
    const refs = mod.extractFileRefs('Error at src/server.ts:42');
    const match = refs.find(r => r.path === 'src/server.ts');
    expect(match).toBeTruthy();
    expect(match.line).toBe(42);
  });

  test('extracts column numbers', () => {
    const refs = mod.extractFileRefs('src/utils.js:10:5');
    const match = refs.find(r => r.path === 'src/utils.js');
    expect(match).toBeTruthy();
    expect(match.line).toBe(10);
    expect(match.col).toBe(5);
  });

  test('deduplicates identical refs', () => {
    const refs = mod.extractFileRefs('src/a.js and src/a.js again');
    const aRefs = refs.filter(r => r.path === 'src/a.js');
    expect(aRefs.length).toBe(1);
  });

  test('returns empty array for empty input', () => {
    expect(mod.extractFileRefs('')).toEqual([]);
    expect(mod.extractFileRefs(null)).toEqual([]);
  });
});

// ── Client Integration ──

test.describe('Agent Output Annotations — Client Integration', () => {
  test('fileAnnotations.js utility exists', () => {
    const fp = path.join(ROOT, 'client', 'src', 'utils', 'fileAnnotations.js');
    expect(existsSync(fp)).toBe(true);
  });

  test('fileAnnotations.js exports annotateFilePaths and extractFileRefs', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'utils', 'fileAnnotations.js'), 'utf-8');
    expect(src).toContain('export function annotateFilePaths');
    expect(src).toContain('export function extractFileRefs');
  });

  test('AgentDetail.vue imports and uses annotateFilePaths', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'AgentDetail.vue'), 'utf-8');
    expect(src).toContain('annotateFilePaths');
    expect(src).toContain('fileAnnotations');
  });

  test('AgentDetail.vue has file-annotation CSS', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'AgentDetail.vue'), 'utf-8');
    expect(src).toContain('.file-annotation');
    expect(src).toContain('cursor: pointer');
  });

  test('WorkspaceOverview.vue uses annotated file tree', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'WorkspaceOverview.vue'), 'utf-8');
    expect(src).toContain('annotateFilePaths');
    expect(src).toContain('annotatedTree');
    expect(src).toContain('v-html');
  });

  test('WorkspaceOverview.vue has file-annotation CSS', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'WorkspaceOverview.vue'), 'utf-8');
    expect(src).toContain('.file-annotation');
  });
});
