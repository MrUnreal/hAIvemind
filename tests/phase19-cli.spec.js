// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
function read(f) { return readFileSync(path.join(ROOT, f), 'utf8'); }

/* ════════════════════════════════════════════
   Phase 19 — Enhanced CLI & Terminal Dashboard
   ════════════════════════════════════════════ */

// ─── 19.0 CLI Expansion ─────────────────────────────────────────────
test.describe('CLI — New Commands', () => {
  test('registers all new commands with help and completions', () => {
    const src = read('bin/haivemind.js');
    // Dispatch map
    for (const cmd of ['dashboard:', 'intelligence:', 'providers:', "'security-scan':"]) {
      expect(src).toContain(cmd);
    }
    // Shell completions
    expect(src).toMatch(/COMMANDS\s*=.*dashboard/);
    expect(src).toMatch(/COMMANDS\s*=.*security-scan/);
  });

  test('command functions import correct modules', () => {
    const src = read('bin/haivemind.js');
    // Intelligence
    expect(src).toContain('async function cmdIntelligence');
    expect(src).toContain('getVectorStats');
    expect(src).toContain('getRoutingStats');
    // Providers
    expect(src).toContain('async function cmdProviders');
    expect(src).toContain('TIER_PROVIDER_MAP');
    // Security
    expect(src).toContain('async function cmdSecurityScan');
    expect(src).toContain('scanForInjection');
    // Dashboard
    expect(src).toContain('async function cmdDashboard');
    expect(src).toContain('TerminalDashboard');
  });
});

// ─── 19.1 Terminal Dashboard Module ──────────────────────────────────
test.describe('Terminal Dashboard', () => {
  test('constructor initializes state', async () => {
    const { TerminalDashboard } = await import('../server/services/cliDashboard.js');
    const dash = new TerminalDashboard({ slug: 'test-project' });
    expect(dash.slug).toBe('test-project');
    expect(dash.tasks).toEqual([]);
    expect(dash.agents).toEqual([]);
    expect(dash.status).toBe('initializing');
  });

  test('updateTasks, updateAgent, addLog, updateCost manage state', async () => {
    const { TerminalDashboard } = await import('../server/services/cliDashboard.js');
    const dash = new TerminalDashboard({ slug: 'test' });

    // Tasks
    dash.updateTasks([
      { id: 't1', label: 'Build API', status: 'done' },
      { id: 't2', label: 'Add tests', status: 'running' },
    ]);
    expect(dash.tasks).toHaveLength(2);
    expect(dash.tasks[0].label).toBe('Build API');

    // Agents — add then update
    dash.updateAgent('agent-1', 'running', 'T0', 'Build API');
    expect(dash.agents).toHaveLength(1);
    expect(dash.agents[0].status).toBe('running');
    dash.updateAgent('agent-1', 'complete', 'T0', 'Build API');
    expect(dash.agents).toHaveLength(1);
    expect(dash.agents[0].status).toBe('complete');

    // Logs — capped at 100
    for (let i = 0; i < 110; i++) dash.addLog(`Log ${i}`);
    expect(dash.logs.length).toBeLessThanOrEqual(100);
    expect(dash.logs[dash.logs.length - 1].msg).toBe('Log 109');

    // Cost
    dash.updateCost({ totalAgents: 5, totalPremiumRequests: 0, tierCounts: { T0: 5 } });
    expect(dash.costSummary.totalAgents).toBe(5);
  });

  test('createDashboardBroadcast handles message types', async () => {
    const { TerminalDashboard, createDashboardBroadcast } = await import('../server/services/cliDashboard.js');
    const { MSG } = await import('../shared/protocol.js');
    const dash = new TerminalDashboard({ slug: 'test' });
    const broadcast = createDashboardBroadcast(dash, MSG);

    broadcast({ type: MSG.PLAN_CREATED, payload: { tasks: [{ id: 't1', label: 'Test' }] } });
    expect(dash.tasks).toHaveLength(1);

    broadcast({ type: MSG.TASK_STATUS, payload: { taskId: 't1', status: 'done' } });
    expect(dash.tasks[0].status).toBe('done');

    broadcast({ type: MSG.SESSION_COMPLETE, payload: { costSummary: { totalAgents: 3 } } });
    expect(dash.status).toBe('completed');
    expect(dash.costSummary.totalAgents).toBe(3);
  });

  test('agentHistory tracked for sparkline', async () => {
    const { TerminalDashboard } = await import('../server/services/cliDashboard.js');
    const dash = new TerminalDashboard({ slug: 'test' });
    dash.updateAgent('a1', 'running', 'T0', 'task1');
    dash.updateAgent('a2', 'running', 'T0', 'task2');
    dash.updateAgent('a1', 'complete', 'T0', 'task1');
    expect(dash.agentHistory).toEqual([1, 2, 1]);
  });
});
