// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
function read(f) { return readFileSync(path.join(ROOT, f), 'utf8'); }

/* ════════════════════════════════════════════
   Phase 16 — Swarm Intelligence
   ════════════════════════════════════════════ */

test.describe('Swarm Topologies', () => {
  test('listTopologies returns all types', async () => {
    const { listTopologies } = await import('../server/swarm/topologies.js');
    const types = listTopologies();
    expect(types).toContain('flat');
    expect(types).toContain('hierarchical');
    expect(types).toContain('ring');
    expect(types).toContain('star');
    expect(types).toContain('mesh');
    expect(types.length).toBe(5);
  });

  test('FlatTopology round-robins tasks', async () => {
    const { FlatTopology } = await import('../server/swarm/topologies.js');
    const topo = new FlatTopology();
    const tasks = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
    const runners = [{ id: 'r1' }, { id: 'r2' }];
    const assignments = topo.assign(tasks, runners);
    expect(assignments).toHaveLength(3);
    expect(assignments[0].runner.id).toBe('r1');
    expect(assignments[1].runner.id).toBe('r2');
    expect(assignments[2].runner.id).toBe('r1');
  });

  test('HierarchicalTopology separates planning tasks', async () => {
    const { HierarchicalTopology } = await import('../server/swarm/topologies.js');
    const topo = new HierarchicalTopology({});
    const tasks = [
      { id: 't1', label: 'Verify & test' },
      { id: 't2', label: 'Build API' },
      { id: 't3', label: 'Create UI page' },
    ];
    const runners = [{ id: 'lead' }, { id: 'w1' }, { id: 'w2' }];
    const assignments = topo.assign(tasks, runners);
    // Verify task should go to lead
    const verifyAssignment = assignments.find(a => a.task.id === 't1');
    expect(verifyAssignment.runner.id).toBe('lead');
    expect(verifyAssignment.role).toBe('leader');
  });

  test('RingTopology assigns predecessor/successor', async () => {
    const { RingTopology } = await import('../server/swarm/topologies.js');
    const topo = new RingTopology();
    const tasks = [{ id: 't1' }, { id: 't2' }];
    const runners = [{ id: 'r1' }, { id: 'r2' }];
    const assignments = topo.assign(tasks, runners);
    expect(assignments[0]).toHaveProperty('predecessor');
    expect(assignments[0]).toHaveProperty('successor');
  });

  test('StarTopology keeps first runner as coordinator', async () => {
    const { StarTopology } = await import('../server/swarm/topologies.js');
    const topo = new StarTopology();
    const tasks = [{ id: 't1' }, { id: 't2' }];
    const runners = [{ id: 'coord' }, { id: 'w1' }, { id: 'w2' }];
    const assignments = topo.assign(tasks, runners);
    // Workers should not include coordinator
    for (const a of assignments) {
      expect(a.runner.id).not.toBe('coord');
      expect(a.coordinator.id).toBe('coord');
    }
  });

  test('createTopology factory works', async () => {
    const { createTopology } = await import('../server/swarm/topologies.js');
    const flat = createTopology('flat');
    expect(flat.name).toBe('flat');
    const mesh = createTopology('mesh');
    expect(mesh.name).toBe('mesh');
    const unknown = createTopology('nonexistent');
    expect(unknown.name).toBe('flat'); // Falls back to flat
  });
});

test.describe('Consensus Protocol', () => {
  test('resolveConsensus picks quality-ranked winner', async () => {
    const { resolveConsensus } = await import('../server/swarm/consensus.js');
    const result = resolveConsensus([
      { agentId: 'a1', taskId: 't1', output: 'simple output', model: 'gpt-5.1', tier: 'T0', multiplier: 0, status: 'success' },
      { agentId: 'a2', taskId: 't1', output: 'detailed comprehensive output with more content', model: 'claude-sonnet', tier: 'T2', multiplier: 1, status: 'success' },
    ]);
    expect(result.winnerId).toBe('a2'); // T2 > T0
    expect(result.strategy).toBe('quality-ranked');
    expect(result.confidence).toBeGreaterThan(0);
  });

  test('resolveConsensus handles all-failed outputs', async () => {
    const { resolveConsensus } = await import('../server/swarm/consensus.js');
    const result = resolveConsensus([
      { agentId: 'a1', taskId: 't1', output: 'error', model: 'gpt-5.1', tier: 'T0', multiplier: 0, status: 'failed' },
      { agentId: 'a2', taskId: 't1', output: 'error too', model: 'claude', tier: 'T2', multiplier: 1, status: 'failed' },
    ]);
    expect(result.confidence).toBe(0);
    expect(result.winnerId).toBe('a2'); // Higher tier failure picked
  });

  test('resolveConsensus handles single output', async () => {
    const { resolveConsensus } = await import('../server/swarm/consensus.js');
    const result = resolveConsensus([
      { agentId: 'a1', taskId: 't1', output: 'only output', model: 'gpt-5.1', tier: 'T0', multiplier: 0, status: 'success' },
    ]);
    expect(result.winnerId).toBe('a1');
    expect(result.confidence).toBe(1);
  });

  test('resolveConsensus handles empty array', async () => {
    const { resolveConsensus } = await import('../server/swarm/consensus.js');
    const result = resolveConsensus([]);
    expect(result.winnerId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  test('majority-vote strategy prefers agreement', async () => {
    const { resolveConsensus } = await import('../server/swarm/consensus.js');
    const result = resolveConsensus([
      { agentId: 'a1', output: 'create file server.js with express', tier: 'T0', status: 'success' },
      { agentId: 'a2', output: 'create file server.js with express app', tier: 'T0', status: 'success' },
      { agentId: 'a3', output: 'completely different approach to build the thing', tier: 'T0', status: 'success' },
    ], 'majority-vote');
    expect(result.strategy).toBe('majority-vote');
    // a1 or a2 should win (they agree more with each other than with a3)
    expect(['a1', 'a2']).toContain(result.winnerId);
  });

  test('listStrategies returns all strategies', async () => {
    const { listStrategies } = await import('../server/swarm/consensus.js');
    expect(listStrategies()).toEqual(['majority-vote', 'quality-ranked', 'merge']);
  });
});
