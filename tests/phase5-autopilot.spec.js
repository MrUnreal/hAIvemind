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

// ── Phase 5.4: Auto-Pilot Mode Tests ──────────────────────────────────────

test.describe('Autopilot — Unit: autopilot.js', () => {
  test('reflectionToPromptContext handles null reflection', async () => {
    const { reflectionToPromptContext } = await import('../server/autopilot.js');
    const ctx = reflectionToPromptContext(null);
    expect(ctx).toContain('No previous session');
  });

  test('reflectionToPromptContext formats metrics', async () => {
    const { reflectionToPromptContext } = await import('../server/autopilot.js');
    const ctx = reflectionToPromptContext({
      status: 'mostly-succeeded',
      taskCount: 5,
      successCount: 4,
      retryRate: 0.2,
      durationMs: 30000,
      escalatedTasks: [{ taskId: 't1', label: 'Setup' }],
      tierUsage: { T0: 3, T1: 1, T2: 1 },
    }, { totalPremiumRequests: 2 });

    expect(ctx).toContain('mostly-succeeded');
    expect(ctx).toContain('4/5');
    expect(ctx).toContain('20%');
    expect(ctx).toContain('30.0s');
    expect(ctx).toContain('Setup');
    expect(ctx).toContain('Premium requests: 2');
  });

  test('buildAutopilotPlannerPrompt includes all sections', async () => {
    const { buildAutopilotPlannerPrompt } = await import('../server/autopilot.js');
    const prompt = buildAutopilotPlannerPrompt({
      projectSlug: 'test-project',
      roadmapText: '# Roadmap\n- Feature 1\n- Feature 2',
      reflectionContext: 'Last session: ok',
      previousPrompts: ['Implement feature A', 'Fix bug B'],
    });

    expect(prompt).toContain('test-project');
    expect(prompt).toContain('ROADMAP');
    expect(prompt).toContain('Feature 1');
    expect(prompt).toContain('LAST SESSION METRICS');
    expect(prompt).toContain('RECENT SESSIONS');
    expect(prompt).toContain('Implement feature A');
    expect(prompt).toContain('JSON');
  });

  test('buildAutopilotPlannerPrompt works without optional args', async () => {
    const { buildAutopilotPlannerPrompt } = await import('../server/autopilot.js');
    const prompt = buildAutopilotPlannerPrompt({ projectSlug: 'minimal' });
    expect(prompt).toContain('minimal');
    expect(prompt).toContain('JSON');
  });

  test('runAutopilotCycle runs sessions and returns results', async () => {
    const { runAutopilotCycle } = await import('../server/autopilot.js');

    let sessionCount = 0;
    const mockWorkspace = {
      getProject: () => ({ slug: 'test', name: 'Test', dir: ROOT }),
      getReflections: () => [],
      listSessions: () => [],
    };

    const result = await runAutopilotCycle({
      workspace: mockWorkspace,
      slug: 'test',
      runSession: async () => {
        sessionCount++;
        return { exitCode: 0, sessionId: `test-${sessionCount}`, costSummary: { totalPremiumRequests: 0 } };
      },
      planFn: null,
      config: { maxCycles: 2 },
      log: () => {},
    });

    expect(result.cycles).toBe(2);
    expect(result.decisions).toHaveLength(2);
    expect(result.stopped).toBe('completed');
    expect(sessionCount).toBe(2);
  });

  test('runAutopilotCycle stops on cost ceiling', async () => {
    const { runAutopilotCycle } = await import('../server/autopilot.js');

    const mockWorkspace = {
      getProject: () => ({ slug: 'test', name: 'Test', dir: ROOT }),
      getReflections: () => [],
      listSessions: () => [],
    };

    let callCount = 0;
    const result = await runAutopilotCycle({
      workspace: mockWorkspace,
      slug: 'test',
      runSession: async () => {
        callCount++;
        return { exitCode: 0, sessionId: `s-${callCount}`, costSummary: { totalPremiumRequests: 5 } };
      },
      planFn: null,
      config: { maxCycles: 10, costCeiling: 3 },
      log: () => {},
    });

    // First session adds 5 premium, next cycle checks and stops
    expect(result.cycles).toBeLessThanOrEqual(3);
    expect(result.stopped).toContain('cost-ceiling');
  });

  test('runAutopilotCycle stops on session error', async () => {
    const { runAutopilotCycle } = await import('../server/autopilot.js');

    const mockWorkspace = {
      getProject: () => ({ slug: 'test', name: 'Test', dir: ROOT }),
      getReflections: () => [],
      listSessions: () => [],
    };

    const result = await runAutopilotCycle({
      workspace: mockWorkspace,
      slug: 'test',
      runSession: async () => { throw new Error('build exploded'); },
      planFn: null,
      config: { maxCycles: 5 },
      log: () => {},
    });

    expect(result.cycles).toBe(1);
    expect(result.stopped).toContain('session-error');
  });
});

test.describe('Autopilot — CLI', () => {
  test('autopilot in help text', () => {
    const out = run('help');
    expect(out).toContain('autopilot');
    expect(out).toContain('--cycles');
  });

  test('autopilot without slug exits with error', () => {
    try {
      run('autopilot');
      expect(false).toBe(true);
    } catch (err) {
      expect(/** @type {any} */ (err).status).not.toBe(0);
    }
  });

  test('autopilot with unknown slug exits with error', () => {
    try {
      run('autopilot nonexistent-project-999 --mock', { timeout: 15000 });
      expect(false).toBe(true);
    } catch (err) {
      expect(/** @type {any} */ (err).status).not.toBe(0);
    }
  });

  test('autopilot completes mock cycles', () => {
    const out = run('autopilot haivemind-self-dev --mock --cycles=1', { timeout: 120000 });
    expect(out).toContain('Autopilot');
    expect(out).toContain('Cycles:');
    expect(out).toContain('complete');
  });
});

test.describe('Autopilot — Integration', () => {
  test('server/autopilot.js exists and exports expected functions', async () => {
    const mod = await import('../server/autopilot.js');
    expect(typeof mod.reflectionToPromptContext).toBe('function');
    expect(typeof mod.buildAutopilotPlannerPrompt).toBe('function');
    expect(typeof mod.runAutopilotCycle).toBe('function');
  });

  test('autopilot-log.json is written after a cycle', async () => {
    // Check if the file was created by the previous CLI test
    const fs = await import('node:fs');
    const logPath = path.join(ROOT, '.haivemind', 'autopilot-log.json');
    // It may or may not exist depending on test order, just verify our function works
    const { runAutopilotCycle } = await import('../server/autopilot.js');
    const mockWorkspace = {
      getProject: () => ({ slug: 'test', name: 'Test', dir: ROOT }),
      getReflections: () => [],
      listSessions: () => [],
    };

    await runAutopilotCycle({
      workspace: mockWorkspace,
      slug: 'test',
      runSession: async () => ({ exitCode: 0, sessionId: 'log-test', costSummary: {} }),
      planFn: null,
      config: { maxCycles: 1 },
      log: () => {},
    });

    // Verify the log file was created/updated
    expect(fs.existsSync(logPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBeGreaterThan(0);
  });
});
