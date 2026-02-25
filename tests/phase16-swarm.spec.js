// @ts-check
import { test, expect } from '@playwright/test';

/* ════════════════════════════════════════════
   Phase 16 — Swarm Intelligence
   ════════════════════════════════════════════ */

test.describe('Swarm Topologies', () => {
  test('listTopologies returns all 5 types', async () => {
    const { listTopologies } = await import('../server/swarm/topologies.js');
    const types = listTopologies();
    expect(types).toEqual(expect.arrayContaining(['flat', 'hierarchical', 'ring', 'star', 'mesh']));
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
    for (const a of assignments) {
      expect(a.runner.id).not.toBe('coord');
      expect(a.coordinator.id).toBe('coord');
    }
  });

  test('createTopology factory works with fallback', async () => {
    const { createTopology } = await import('../server/swarm/topologies.js');
    expect(createTopology('flat').name).toBe('flat');
    expect(createTopology('mesh').name).toBe('mesh');
    expect(createTopology('nonexistent').name).toBe('flat');
  });
});

test.describe('Consensus Protocol', () => {
  test('quality-ranked picks higher-tier winner', async () => {
    const { resolveConsensus } = await import('../server/swarm/consensus.js');
    const result = resolveConsensus([
      { agentId: 'a1', taskId: 't1', output: 'simple output', model: 'gpt-5.1', tier: 'T0', multiplier: 0, status: 'success' },
      { agentId: 'a2', taskId: 't1', output: 'detailed comprehensive output with more content', model: 'claude-sonnet', tier: 'T2', multiplier: 1, status: 'success' },
    ]);
    expect(result.winnerId).toBe('a2');
    expect(result.strategy).toBe('quality-ranked');
    expect(result.confidence).toBeGreaterThan(0);
  });

  test('handles edge cases (all-failed, single, empty)', async () => {
    const { resolveConsensus } = await import('../server/swarm/consensus.js');

    // All-failed → confidence 0, picks higher tier
    const failed = resolveConsensus([
      { agentId: 'a1', taskId: 't1', output: 'error', model: 'gpt-5.1', tier: 'T0', multiplier: 0, status: 'failed' },
      { agentId: 'a2', taskId: 't1', output: 'error too', model: 'claude', tier: 'T2', multiplier: 1, status: 'failed' },
    ]);
    expect(failed.confidence).toBe(0);
    expect(failed.winnerId).toBe('a2');

    // Single output → confidence 1
    const single = resolveConsensus([
      { agentId: 'a1', taskId: 't1', output: 'only output', model: 'gpt-5.1', tier: 'T0', multiplier: 0, status: 'success' },
    ]);
    expect(single.winnerId).toBe('a1');
    expect(single.confidence).toBe(1);

    // Empty → null winner
    const empty = resolveConsensus([]);
    expect(empty.winnerId).toBeNull();
    expect(empty.confidence).toBe(0);
  });

  test('majority-vote prefers agreement', async () => {
    const { resolveConsensus } = await import('../server/swarm/consensus.js');
    const result = resolveConsensus([
      { agentId: 'a1', output: 'create file server.js with express', tier: 'T0', status: 'success' },
      { agentId: 'a2', output: 'create file server.js with express app', tier: 'T0', status: 'success' },
      { agentId: 'a3', output: 'completely different approach to build the thing', tier: 'T0', status: 'success' },
    ], 'majority-vote');
    expect(result.strategy).toBe('majority-vote');
    expect(['a1', 'a2']).toContain(result.winnerId);
  });

  test('listStrategies returns all strategies', async () => {
    const { listStrategies } = await import('../server/swarm/consensus.js');
    expect(listStrategies()).toEqual(['majority-vote', 'quality-ranked', 'merge']);
  });
});
