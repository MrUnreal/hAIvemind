// @ts-check
import { test, expect } from '@playwright/test';

const API = 'http://127.0.0.1:3000';

// ── Phase 5.1: Agent Output Diffing & Smart Summaries Tests ──

test.describe('Output Summarizer — Unit', () => {
  test('summarizeOutput extracts files changed', async () => {
    const { summarizeOutput } = await import('../server/outputSummarizer.js');
    const output = [
      'Creating file: src/utils.js\n',
      'Modified file: src/index.ts\n',
      'diff --git a/package.json b/package.json\n',
    ];
    const summary = summarizeOutput(output);
    expect(summary.filesChanged).toContain('src/utils.js');
    expect(summary.filesChanged).toContain('src/index.ts');
    expect(summary.filesChanged).toContain('package.json');
  });

  test('summarizeOutput extracts errors', async () => {
    const { summarizeOutput } = await import('../server/outputSummarizer.js');
    const output = [
      'Compiling...\n',
      'Error: Cannot find module "foo"\n',
      'TypeError: undefined is not a function\n',
      'Build complete.\n',
    ];
    const summary = summarizeOutput(output);
    expect(summary.errors.length).toBeGreaterThanOrEqual(2);
    expect(summary.errors.some(e => e.includes('Cannot find module'))).toBe(true);
    expect(summary.errors.some(e => e.includes('undefined is not a function'))).toBe(true);
  });

  test('summarizeOutput extracts warnings', async () => {
    const { summarizeOutput } = await import('../server/outputSummarizer.js');
    const output = [
      'Warning: unused variable x\n',
      'WARN deprecated package\n',
    ];
    const summary = summarizeOutput(output);
    expect(summary.warnings.length).toBeGreaterThanOrEqual(2);
  });

  test('summarizeOutput extracts test results', async () => {
    const { summarizeOutput } = await import('../server/outputSummarizer.js');
    const output = [
      'Running tests...\n',
      'Tests: 15 passed, 3 failed, 2 skipped\n',
      '✘ test should handle errors\n',
      'FAIL src/utils.test.js\n',
    ];
    const summary = summarizeOutput(output);
    expect(summary.tests.passed).toBe(15);
    expect(summary.tests.failed).toBe(3);
    expect(summary.tests.skipped).toBe(2);
  });

  test('summarizeOutput extracts commands', async () => {
    const { summarizeOutput } = await import('../server/outputSummarizer.js');
    const output = [
      '$ npm install express\n',
      '$ npm test\n',
      'Running: npx playwright test\n',
    ];
    const summary = summarizeOutput(output);
    expect(summary.commands.length).toBeGreaterThanOrEqual(2);
    expect(summary.commands.some(c => c.includes('npm install'))).toBe(true);
  });

  test('summarizeOutput builds digest', async () => {
    const { summarizeOutput } = await import('../server/outputSummarizer.js');
    const output = [
      'Creating file: src/new.js\n',
      'Error: something broke\n',
      '$ npm test\n',
      '5 passed\n',
    ];
    const summary = summarizeOutput(output);
    expect(summary.digest).toBeTruthy();
    expect(typeof summary.digest).toBe('string');
    expect(summary.digest.length).toBeGreaterThan(10);
  });

  test('summarizeOutput handles empty input', async () => {
    const { summarizeOutput } = await import('../server/outputSummarizer.js');
    const summary = summarizeOutput([]);
    expect(summary.filesChanged).toHaveLength(0);
    expect(summary.errors).toHaveLength(0);
    expect(summary.digest).toContain('No file changes');
  });

  test('summaryToContext produces concise escalation context', async () => {
    const { summarizeOutput, summaryToContext } = await import('../server/outputSummarizer.js');
    const output = [
      'Error: Cannot find module "missing-dep"\n',
      'TypeError: x is not a function\n',
      'Creating file: src/fix.js\n',
      '$ npm install missing-dep\n',
    ];
    const summary = summarizeOutput(output);
    const context = summaryToContext(summary);
    expect(context).toContain('Previous Attempt Summary');
    expect(context).toContain('Errors');
    expect(context.length).toBeLessThan(3000); // Should be compact
  });

  test('summaryToContext falls back to raw tail for thin summaries', async () => {
    const { summarizeOutput, summaryToContext } = await import('../server/outputSummarizer.js');
    const summary = summarizeOutput(['ok']);
    const context = summaryToContext(summary, 'some raw tail output...');
    expect(context).toContain('Raw Output (tail)');
  });
});

test.describe('Output Summaries — Integration', () => {
  test('summarizer is importable from agentManager', async () => {
    const mod = await import('../server/agentManager.js');
    const AgentManager = mod.default;
    const am = new AgentManager(() => {}, true, {});
    // getSessionSnapshot should return summary field
    const snapshot = am.getSessionSnapshot();
    expect(snapshot).toBeDefined();
    expect(typeof snapshot).toBe('object');
  });

  test('taskRunner imports summarizer without error', async () => {
    const mod = await import('../server/taskRunner.js');
    expect(mod.default).toBeDefined();
  });
});

test.describe('Per-Task Summaries — REST API', () => {
  test('GET /summaries returns 404 for non-existent session', async ({ request }) => {
    const res = await request.get(`${API}/api/projects/haivemind-self-dev/sessions/nonexistent/summaries`);
    expect(res.status()).toBe(404);
  });

  test('GET /summaries returns array for existing session', async ({ request }) => {
    // Find a project with sessions
    const projectsRes = await request.get(`${API}/api/projects`);
    const projects = await projectsRes.json();
    const linked = projects.find(p => p.linked === true);
    if (!linked) {
      test.skip();
      return;
    }

    const sessionsRes = await request.get(`${API}/api/projects/${linked.slug}/sessions`);
    if (!sessionsRes.ok()) { test.skip(); return; }
    const sessions = await sessionsRes.json();
    if (sessions.length === 0) { test.skip(); return; }

    const latest = sessions[0];
    const sid = latest.sessionId || latest.id;
    const summRes = await request.get(`${API}/api/projects/${linked.slug}/sessions/${sid}/summaries`);
    expect(summRes.ok()).toBe(true);

    const data = await summRes.json();
    expect(Array.isArray(data)).toBe(true);

    // Each entry should have taskId, taskLabel, agents
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('taskId');
      expect(data[0]).toHaveProperty('taskLabel');
      expect(data[0]).toHaveProperty('agents');
      expect(Array.isArray(data[0].agents)).toBe(true);
    }
  });

  test('summaries endpoint returns structured summary data', async ({ request }) => {
    const projectsRes = await request.get(`${API}/api/projects`);
    const projects = await projectsRes.json();
    const linked = projects.find(p => p.linked === true);
    if (!linked) { test.skip(); return; }

    const sessionsRes = await request.get(`${API}/api/projects/${linked.slug}/sessions`);
    if (!sessionsRes.ok()) { test.skip(); return; }
    const sessions = await sessionsRes.json();
    if (sessions.length === 0) { test.skip(); return; }

    const latest = sessions[0];
    const sid = latest.sessionId || latest.id;
    const summRes = await request.get(`${API}/api/projects/${linked.slug}/sessions/${sid}/summaries`);
    const data = await summRes.json();

    // Verify agents within summaries have the expected shape
    for (const taskSummary of data) {
      for (const agent of taskSummary.agents) {
        expect(agent).toHaveProperty('agentId');
        expect(agent).toHaveProperty('status');
        // summary can be null if no output
        if (agent.summary) {
          expect(agent.summary).toHaveProperty('filesChanged');
          expect(agent.summary).toHaveProperty('errors');
          expect(agent.summary).toHaveProperty('digest');
          expect(Array.isArray(agent.summary.filesChanged)).toBe(true);
          expect(Array.isArray(agent.summary.errors)).toBe(true);
          expect(typeof agent.summary.digest).toBe('string');
        }
      }
    }
  });
});
