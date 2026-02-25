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
  test('haivemind.js registers all new commands', () => {
    const src = read('bin/haivemind.js');
    expect(src).toContain('dashboard:');
    expect(src).toContain('intelligence:');
    expect(src).toContain('providers:');
    expect(src).toContain("'security-scan':");
  });

  test('help text lists new commands', () => {
    const src = read('bin/haivemind.js');
    expect(src).toContain("'dashboard'");
    expect(src).toContain("'intelligence'");
    expect(src).toContain("'providers'");
    expect(src).toContain("'security-scan'");
  });

  test('shell completions include new commands', () => {
    const src = read('bin/haivemind.js');
    // The COMMANDS string should include all new commands
    expect(src).toMatch(/COMMANDS\s*=.*dashboard/);
    expect(src).toMatch(/COMMANDS\s*=.*intelligence/);
    expect(src).toMatch(/COMMANDS\s*=.*providers/);
    expect(src).toMatch(/COMMANDS\s*=.*security-scan/);
  });

  test('cmdIntelligence function exists and imports correctly', () => {
    const src = read('bin/haivemind.js');
    expect(src).toContain('async function cmdIntelligence');
    expect(src).toContain('getVectorStats');
    expect(src).toContain('getRoutingStats');
    expect(src).toContain('getGraph');
  });

  test('cmdProviders function exists and imports correctly', () => {
    const src = read('bin/haivemind.js');
    expect(src).toContain('async function cmdProviders');
    expect(src).toContain('getProviderHealthStatus');
    expect(src).toContain('TIER_PROVIDER_MAP');
    expect(src).toContain('registry');
  });

  test('cmdSecurityScan function uses promptGuard and credentialRedactor', () => {
    const src = read('bin/haivemind.js');
    expect(src).toContain('async function cmdSecurityScan');
    expect(src).toContain('scanForInjection');
    expect(src).toContain('credentialRedactor');
    expect(src).toContain("redact(text)");
  });

  test('cmdDashboard function creates TerminalDashboard', () => {
    const src = read('bin/haivemind.js');
    expect(src).toContain('async function cmdDashboard');
    expect(src).toContain('TerminalDashboard');
    expect(src).toContain('createDashboardBroadcast');
  });
});

// ─── 19.1 Terminal Dashboard Module ──────────────────────────────────
test.describe('Terminal Dashboard', () => {
  test('cliDashboard.js exports TerminalDashboard class', async () => {
    const mod = await import('../server/services/cliDashboard.js');
    expect(mod.TerminalDashboard).toBeDefined();
    expect(typeof mod.TerminalDashboard).toBe('function');
  });

  test('TerminalDashboard constructor initializes state', async () => {
    const { TerminalDashboard } = await import('../server/services/cliDashboard.js');
    const dash = new TerminalDashboard({ slug: 'test-project' });
    expect(dash.slug).toBe('test-project');
    expect(dash.tasks).toEqual([]);
    expect(dash.agents).toEqual([]);
    expect(dash.status).toBe('initializing');
  });

  test('updateTasks stores task list', async () => {
    const { TerminalDashboard } = await import('../server/services/cliDashboard.js');
    const dash = new TerminalDashboard({ slug: 'test' });
    dash.updateTasks([
      { id: 't1', label: 'Build API', status: 'done' },
      { id: 't2', label: 'Add tests', status: 'running' },
    ]);
    expect(dash.tasks).toHaveLength(2);
    expect(dash.tasks[0].label).toBe('Build API');
  });

  test('updateAgent adds and updates agents', async () => {
    const { TerminalDashboard } = await import('../server/services/cliDashboard.js');
    const dash = new TerminalDashboard({ slug: 'test' });
    dash.updateAgent('agent-1', 'running', 'T0', 'Build API');
    expect(dash.agents).toHaveLength(1);
    expect(dash.agents[0].status).toBe('running');

    dash.updateAgent('agent-1', 'complete', 'T0', 'Build API');
    expect(dash.agents).toHaveLength(1);
    expect(dash.agents[0].status).toBe('complete');
  });

  test('addLog appends and caps log entries', async () => {
    const { TerminalDashboard } = await import('../server/services/cliDashboard.js');
    const dash = new TerminalDashboard({ slug: 'test' });
    for (let i = 0; i < 110; i++) {
      dash.addLog(`Log entry ${i}`);
    }
    expect(dash.logs.length).toBeLessThanOrEqual(100);
    expect(dash.logs[dash.logs.length - 1].msg).toBe('Log entry 109');
  });

  test('updateCost stores cost summary', async () => {
    const { TerminalDashboard } = await import('../server/services/cliDashboard.js');
    const dash = new TerminalDashboard({ slug: 'test' });
    dash.updateCost({ totalAgents: 5, totalPremiumRequests: 0, tierCounts: { T0: 5 } });
    expect(dash.costSummary.totalAgents).toBe(5);
    expect(dash.costSummary.tierCounts.T0).toBe(5);
  });

  test('createDashboardBroadcast handles message types', async () => {
    const { TerminalDashboard, createDashboardBroadcast } = await import('../server/services/cliDashboard.js');
    const { MSG } = await import('../shared/protocol.js');
    const dash = new TerminalDashboard({ slug: 'test' });
    const broadcast = createDashboardBroadcast(dash, MSG);

    // PLAN_CREATED
    broadcast({ type: MSG.PLAN_CREATED, payload: { tasks: [{ id: 't1', label: 'Test' }] } });
    expect(dash.tasks).toHaveLength(1);

    // TASK_STATUS
    broadcast({ type: MSG.TASK_STATUS, payload: { taskId: 't1', status: 'done' } });
    expect(dash.tasks[0].status).toBe('done');

    // SESSION_COMPLETE
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
    expect(dash.agentHistory.length).toBe(3);
    expect(dash.agentHistory[0]).toBe(1); // 1 running after first add
    expect(dash.agentHistory[1]).toBe(2); // 2 running after second add
    expect(dash.agentHistory[2]).toBe(1); // 1 running after first complete
  });
});

// ─── 19.0 Provider Failover Export ───────────────────────────────────
test.describe('Provider Failover Exports', () => {
  test('TIER_PROVIDER_MAP is exported', async () => {
    const { TIER_PROVIDER_MAP } = await import('../server/services/providerFailover.js');
    expect(TIER_PROVIDER_MAP).toBeDefined();
    expect(TIER_PROVIDER_MAP).toHaveProperty('T0');
    expect(TIER_PROVIDER_MAP).toHaveProperty('T3');
  });

  test('getProviderHealthStatus is exported', async () => {
    const { getProviderHealthStatus } = await import('../server/services/providerFailover.js');
    expect(typeof getProviderHealthStatus).toBe('function');
    const status = getProviderHealthStatus();
    expect(typeof status).toBe('object');
  });
});
