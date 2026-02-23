// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function read(f) { return readFileSync(path.join(ROOT, f), 'utf8'); }

/* ════════════════════════════════════════════
   Hardening — Bug fixes & Safety Guards
   ════════════════════════════════════════════ */

test.describe('PromptInput — stuck Planning guard', () => {
  test('PromptInput resets planning on WS disconnect', () => {
    const src = read('client/src/components/PromptInput.vue');
    // Watch on connected prop must reset planning
    expect(src).toContain('!connected && planning.value');
    expect(src).toContain('planning.value = false');
  });

  test('PromptInput has safety timeout for planning state', () => {
    const src = read('client/src/components/PromptInput.vue');
    // 30-second timeout to auto-reset stuck planning state
    expect(src).toContain('planningTimeout');
    expect(src).toContain('30000');
    expect(src).toContain('clearTimeout(planningTimeout)');
  });

  test('PromptInput cleans up timeout on unmount', () => {
    const src = read('client/src/components/PromptInput.vue');
    expect(src).toContain('onUnmounted');
    expect(src).toMatch(/onUnmounted\(\s*\(\)\s*=>\s*clearTimeout/);
  });
});

test.describe('Orchestrator — plan validation', () => {
  test('decompose validates tasks array exists', () => {
    const src = read('server/orchestrator.js');
    expect(src).toContain('Array.isArray(plan.tasks)');
    expect(src).toContain('missing "tasks" array');
  });

  test('decompose validates each task has id and label', () => {
    const src = read('server/orchestrator.js');
    expect(src).toContain('!t.id || !t.label');
    expect(src).toContain('Task missing id or label');
  });

  test('decompose sets defaults for missing description and dependencies', () => {
    const src = read('server/orchestrator.js');
    expect(src).toContain("if (!t.description) t.description = t.label");
    expect(src).toContain("if (!Array.isArray(t.dependencies)) t.dependencies = []");
  });
});

test.describe('TaskRunner — gate deadlock prevention', () => {
  test('gate approval has timeout to prevent deadlock', () => {
    const src = read('server/taskRunner.js');
    expect(src).toContain('GATE_TIMEOUT_MS');
    expect(src).toContain('Auto-approved after 10 minute timeout');
  });

  test('gate timeout clears resolver from map', () => {
    const src = read('server/taskRunner.js');
    // Must delete from _gateResolvers on timeout
    expect(src).toContain('this._gateResolvers.delete(state.task.id)');
  });

  test('gate response clears timeout timer', () => {
    const src = read('server/taskRunner.js');
    expect(src).toMatch(/clearTimeout\(timer\)/);
  });
});

test.describe('TaskRunner — circular dependency warning', () => {
  test('circular deps broadcast SESSION_WARNING', () => {
    const src = read('server/taskRunner.js');
    expect(src).toContain('Circular or unresolvable dependencies');
    expect(src).toContain('MSG.SESSION_WARNING');
  });

  test('circular deps log warning to console', () => {
    const src = read('server/taskRunner.js');
    expect(src).toMatch(/console\.warn.*Circular/);
  });
});

test.describe('TaskRunner — scheduling re-entrancy guard', () => {
  test('_scheduleEligible has re-entrancy guard', () => {
    const src = read('server/taskRunner.js');
    expect(src).toContain('this._scheduling');
    expect(src).toContain('if (this._scheduling) return');
  });

  test('re-entrancy flag initialized in constructor', () => {
    const src = read('server/taskRunner.js');
    expect(src).toContain('this._scheduling = false');
  });

  test('re-entrancy flag is always reset via finally block', () => {
    const src = read('server/taskRunner.js');
    // Must use try/finally to ensure flag is reset even on error
    expect(src).toMatch(/finally\s*\{\s*\n\s*this\._scheduling\s*=\s*false/);
  });
});
