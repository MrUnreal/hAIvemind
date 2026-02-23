/**
 * Phase 11.1 — Session Replay tests
 *
 * Tests step-by-step replay of completed sessions with timeline scrubbing,
 * filtering by step type, individual step access, and task agent retrieval.
 *
 * Uses both service-level tests (with mock session via WorkspaceManager)
 * and REST endpoint tests.
 *
 * 36 tests
 */

import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const API = 'http://localhost:3000/api';

// ═══════════════════════════════════════════════════════════
//  Service-level tests with mock session data
// ═══════════════════════════════════════════════════════════

const svcRefs = {};

test.beforeAll(async () => {
  // Set up workspace with a project and a mock session
  const WorkspaceManager = (await import('../server/workspace.js')).default;
  const { refs } = await import('../server/state.js');

  const tmpDir = mkdtempSync(join(tmpdir(), 'replay-test-'));
  const wm = new WorkspaceManager(tmpDir);
  refs.workspace = wm;

  try { wm.createProject('replay-proj'); } catch { /* exists */ }
  svcRefs.workspace = wm;
  svcRefs.slug = 'replay-proj';

  // Create a mock completed session on disk
  const sessionId = 'sess-replay-001';
  const projDir = join(tmpDir, 'replay-proj', '.haivemind', 'sessions');
  mkdirSync(projDir, { recursive: true });

  const mockSession = {
    id: sessionId,
    projectSlug: 'replay-proj',
    prompt: 'Build a test feature',
    status: 'completed',
    createdAt: 1000,
    completedAt: 5000,
    tasks: [
      { id: 't1', label: 'Setup', description: 'Initialize project', dependencies: [], status: 'success', startedAt: 1100, completedAt: 2000 },
      { id: 't2', label: 'Implement', description: 'Write code', dependencies: ['t1'], status: 'success', startedAt: 2100, completedAt: 3500 },
      { id: 't3', label: 'Test', description: 'Run tests', dependencies: ['t2'], status: 'success', startedAt: 3600, completedAt: 4500 },
    ],
    edges: [['t1', 't2'], ['t2', 't3']],
    agents: [
      { id: 'a1', taskId: 't1', taskLabel: 'Setup', model: 'gpt-4o-mini', modelTier: 'T0', status: 'success', retries: 0, startedAt: 1100, finishedAt: 2000, output: ['output1'], summary: { digest: 'Setup done' } },
      { id: 'a2', taskId: 't2', taskLabel: 'Implement', model: 'gpt-4o', modelTier: 'T1', status: 'success', retries: 1, startedAt: 2100, finishedAt: 3500, output: ['output2'], summary: { digest: 'Code written' } },
      { id: 'a3', taskId: 't3', taskLabel: 'Test', model: 'gpt-4o-mini', modelTier: 'T0', status: 'success', retries: 0, startedAt: 3600, finishedAt: 4500, output: ['output3'], summary: { digest: 'Tests pass' } },
    ],
    timeline: [
      { timestamp: 1050, type: 'TASK_STATUS', data: { taskId: 't1', status: 'running' } },
      { timestamp: 1150, type: 'AGENT_STATUS', data: { agentId: 'a1', status: 'running', taskId: 't1' } },
      { timestamp: 2000, type: 'TASK_STATUS', data: { taskId: 't1', status: 'success' } },
      { timestamp: 2150, type: 'AGENT_STATUS', data: { agentId: 'a2', status: 'running', taskId: 't2' } },
      { timestamp: 3500, type: 'TASK_STATUS', data: { taskId: 't2', status: 'success' } },
      { timestamp: 3650, type: 'VERIFICATION_STATUS', data: { status: 'pass', taskId: 't2' } },
      { timestamp: 3700, type: 'AGENT_STATUS', data: { agentId: 'a3', status: 'running', taskId: 't3' } },
      { timestamp: 4500, type: 'TASK_STATUS', data: { taskId: 't3', status: 'success' } },
    ],
    costSummary: { total: 0.05, byTier: { T0: 0.02, T1: 0.03 } },
  };

  writeFileSync(join(projDir, `${sessionId}.json`), JSON.stringify(mockSession, null, 2));
  svcRefs.sessionId = sessionId;

  // Also create an empty session (no timeline/agents) for edge cases
  const emptySession = {
    id: 'sess-replay-empty',
    projectSlug: 'replay-proj',
    prompt: 'Empty session',
    status: 'failed',
    createdAt: 100,
    completedAt: 200,
  };
  writeFileSync(join(projDir, 'sess-replay-empty.json'), JSON.stringify(emptySession, null, 2));
  svcRefs.emptySessionId = 'sess-replay-empty';
});

let getReplay, getReplaySlice, getReplayStep, getTaskAgents, getReplayStepTypes;

test.beforeAll(async () => {
  const mod = await import('../server/services/sessionReplay.js');
  getReplay = mod.getReplay;
  getReplaySlice = mod.getReplaySlice;
  getReplayStep = mod.getReplayStep;
  getTaskAgents = mod.getTaskAgents;
  getReplayStepTypes = mod.getReplayStepTypes;
});

test.describe('Session Replay — Service', () => {
  test('getReplay returns full replay with steps', () => {
    const replay = getReplay(svcRefs.slug, svcRefs.sessionId);
    expect(replay).not.toBeNull();
    expect(replay.session.id).toBe(svcRefs.sessionId);
    expect(replay.session.prompt).toBe('Build a test feature');
    expect(replay.steps.length).toBeGreaterThan(5);
    expect(replay.summary.totalSteps).toBe(replay.steps.length);
  });

  test('steps are sorted chronologically with sequential indexes', () => {
    const { steps } = getReplay(svcRefs.slug, svcRefs.sessionId);
    for (let i = 0; i < steps.length; i++) {
      expect(steps[i].index).toBe(i);
      if (i > 0) expect(steps[i].timestamp).toBeGreaterThanOrEqual(steps[i - 1].timestamp);
    }
  });

  test('first step is session:start, last is session:end', () => {
    const { steps } = getReplay(svcRefs.slug, svcRefs.sessionId);
    expect(steps[0].type).toBe('session:start');
    expect(steps[steps.length - 1].type).toBe('session:end');
  });

  test('session:start step includes prompt', () => {
    const { steps } = getReplay(svcRefs.slug, svcRefs.sessionId);
    expect(steps[0].data.prompt).toBe('Build a test feature');
  });

  test('session:end step includes status and cost', () => {
    const { steps } = getReplay(svcRefs.slug, svcRefs.sessionId);
    const last = steps[steps.length - 1];
    expect(last.data.status).toBe('completed');
    expect(last.data.costSummary.total).toBe(0.05);
  });

  test('summary includes duration and counts', () => {
    const { summary } = getReplay(svcRefs.slug, svcRefs.sessionId);
    expect(summary.durationMs).toBe(4000); // 5000 - 1000
    expect(summary.taskCount).toBe(3);
    expect(summary.agentCount).toBe(3);
    expect(summary.durationFormatted).toBe('4s');
    expect(summary.status).toBe('completed');
  });

  test('summary has step type breakdown', () => {
    const { summary } = getReplay(svcRefs.slug, svcRefs.sessionId);
    expect(summary.stepTypes['session:start']).toBe(1);
    expect(summary.stepTypes['session:end']).toBe(1);
    expect(summary.stepTypes['TASK_STATUS']).toBeGreaterThanOrEqual(3);
  });

  test('getReplay returns null for unknown session', () => {
    const replay = getReplay(svcRefs.slug, 'nonexistent-session');
    expect(replay).toBeNull();
  });

  test('getReplay returns null for unknown project', () => {
    const replay = getReplay('nonexistent-slug', svcRefs.sessionId);
    expect(replay).toBeNull();
  });

  test('empty session has minimal steps', () => {
    const replay = getReplay(svcRefs.slug, svcRefs.emptySessionId);
    expect(replay).not.toBeNull();
    // Should have at least session:start and session:end
    expect(replay.steps.length).toBeGreaterThanOrEqual(2);
    expect(replay.summary.taskCount).toBe(0);
    expect(replay.summary.agentCount).toBe(0);
  });
});

test.describe('Session Replay — Slicing & Scrubbing', () => {
  test('getReplaySlice returns subset of steps', () => {
    const result = getReplaySlice(svcRefs.slug, svcRefs.sessionId, { from: 0, to: 3 });
    expect(result).not.toBeNull();
    expect(result.steps.length).toBe(3);
    expect(result.total).toBeGreaterThan(3);
  });

  test('getReplaySlice with type filter', () => {
    const result = getReplaySlice(svcRefs.slug, svcRefs.sessionId, { type: 'TASK_STATUS' });
    expect(result).not.toBeNull();
    expect(result.steps.length).toBeGreaterThanOrEqual(3);
    for (const step of result.steps) {
      expect(step.type).toBe('TASK_STATUS');
    }
  });

  test('getReplaySlice returns null for unknown session', () => {
    expect(getReplaySlice(svcRefs.slug, 'nope')).toBeNull();
  });

  test('getReplayStep returns specific step', () => {
    const step = getReplayStep(svcRefs.slug, svcRefs.sessionId, 0);
    expect(step).not.toBeNull();
    expect(step.type).toBe('session:start');
    expect(step.index).toBe(0);
  });

  test('getReplayStep returns error for out-of-range index', () => {
    const result = getReplayStep(svcRefs.slug, svcRefs.sessionId, 9999);
    expect(result.error).toBe('Index out of range');
    expect(result.total).toBeGreaterThan(0);
  });

  test('getReplayStep returns null for unknown session', () => {
    expect(getReplayStep(svcRefs.slug, 'nope', 0)).toBeNull();
  });
});

test.describe('Session Replay — Task Agents', () => {
  test('getTaskAgents returns agents for a task', () => {
    const agents = getTaskAgents(svcRefs.slug, svcRefs.sessionId, 't1');
    expect(agents).not.toBeNull();
    expect(agents.length).toBe(1);
    expect(agents[0].id).toBe('a1');
    expect(agents[0].model).toBe('gpt-4o-mini');
    expect(agents[0].summary.digest).toBe('Setup done');
  });

  test('getTaskAgents includes retry count', () => {
    const agents = getTaskAgents(svcRefs.slug, svcRefs.sessionId, 't2');
    expect(agents[0].retries).toBe(1);
  });

  test('getTaskAgents returns empty array for unknown task', () => {
    const agents = getTaskAgents(svcRefs.slug, svcRefs.sessionId, 'nonexistent');
    expect(agents).toEqual([]);
  });

  test('getTaskAgents returns null for unknown session', () => {
    expect(getTaskAgents(svcRefs.slug, 'nope', 't1')).toBeNull();
  });
});

test.describe('Session Replay — Step Types', () => {
  test('getReplayStepTypes returns array of unique types', () => {
    const types = getReplayStepTypes(svcRefs.slug, svcRefs.sessionId);
    expect(Array.isArray(types)).toBe(true);
    expect(types).toContain('session:start');
    expect(types).toContain('session:end');
    expect(types).toContain('TASK_STATUS');
    expect(types).toContain('AGENT_STATUS');
    // No duplicates
    expect(new Set(types).size).toBe(types.length);
  });

  test('getReplayStepTypes returns null for unknown session', () => {
    expect(getReplayStepTypes(svcRefs.slug, 'nope')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
//  REST endpoint tests
// ═══════════════════════════════════════════════════════════

const REST_PROJ = `replay-rest-${Date.now()}`;

test.beforeAll(async ({ request }) => {
  await request.post(`${API}/projects`, { data: { name: REST_PROJ } });
});

test.describe('Session Replay — REST endpoints', () => {
  test('GET replay returns 404 for nonexistent project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/sessions/xxx/replay`);
    expect(res.status()).toBe(404);
  });

  test('GET replay returns 404 for nonexistent session', async ({ request }) => {
    const res = await request.get(`${API}/projects/${REST_PROJ}/sessions/nonexistent/replay`);
    expect(res.status()).toBe(404);
  });

  test('GET replay/slice returns 404 for nonexistent project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/sessions/xxx/replay/slice`);
    expect(res.status()).toBe(404);
  });

  test('GET replay/step returns 404 for nonexistent project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/sessions/xxx/replay/step/0`);
    expect(res.status()).toBe(404);
  });

  test('GET replay/task agents returns 404 for nonexistent project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/sessions/xxx/replay/task/t1/agents`);
    expect(res.status()).toBe(404);
  });

  test('GET replay/types returns 404 for nonexistent project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/sessions/xxx/replay/types`);
    expect(res.status()).toBe(404);
  });
});
