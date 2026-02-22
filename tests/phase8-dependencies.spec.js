// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 8.4: Dependency Visualization Tests ─────────────────────────

// ── Fixture Data ──

const linearSession = {
  id: 'dep-linear',
  tasks: [
    { id: 't1', label: 'Setup project', status: 'success', dependencies: [] },
    { id: 't2', label: 'Build core', status: 'success', dependencies: ['t1'] },
    { id: 't3', label: 'Write tests', status: 'success', dependencies: ['t2'] },
  ],
  edges: [
    { source: 't1', target: 't2' },
    { source: 't2', target: 't3' },
  ],
  agents: {
    a1: { taskId: 't1', modelTier: 'T0', retries: 0 },
    a2: { taskId: 't2', modelTier: 'T1', retries: 1 },
    a3: { taskId: 't3', modelTier: 'T0', retries: 0 },
  },
};

const parallelSession = {
  id: 'dep-parallel',
  tasks: [
    { id: 't1', label: 'Root task', status: 'success', dependencies: [] },
    { id: 't2', label: 'Branch A', status: 'success', dependencies: ['t1'] },
    { id: 't3', label: 'Branch B', status: 'success', dependencies: ['t1'] },
    { id: 't4', label: 'Branch C', status: 'success', dependencies: ['t1'] },
    { id: 't5', label: 'Merge', status: 'success', dependencies: ['t2', 't3', 't4'] },
  ],
  edges: [
    { source: 't1', target: 't2' },
    { source: 't1', target: 't3' },
    { source: 't1', target: 't4' },
    { source: 't2', target: 't5' },
    { source: 't3', target: 't5' },
    { source: 't4', target: 't5' },
  ],
  agents: {},
};

const diamondSession = {
  id: 'dep-diamond',
  tasks: [
    { id: 'a', label: 'Start', status: 'success', dependencies: [] },
    { id: 'b', label: 'Left path', status: 'success', dependencies: ['a'] },
    { id: 'c', label: 'Right path', status: 'failed', dependencies: ['a'] },
    { id: 'd', label: 'End', status: 'success', dependencies: ['b', 'c'] },
  ],
  edges: [
    { source: 'a', target: 'b' },
    { source: 'a', target: 'c' },
    { source: 'b', target: 'd' },
    { source: 'c', target: 'd' },
  ],
  agents: {},
};

const emptySession = { id: 'dep-empty', tasks: [], edges: [], agents: {} };

// ── analyzeDependencies() Unit Tests ──

test.describe('Dependency Visualization — analyzeDependencies()', () => {
  test('returns empty graph for empty session', async () => {
    const { analyzeDependencies } = await import('../server/routes/sessions.js');
    const result = analyzeDependencies(emptySession);

    expect(result.layers).toHaveLength(0);
    expect(result.criticalPath).toHaveLength(0);
    expect(result.bottlenecks).toHaveLength(0);
    expect(result.stats.depth).toBe(0);
    expect(result.stats.width).toBe(0);
    expect(result.stats.parallelism).toBe(0);
  });

  test('returns empty graph for session with no tasks key', async () => {
    const { analyzeDependencies } = await import('../server/routes/sessions.js');
    const result = analyzeDependencies({ id: 'no-tasks' });

    expect(result.layers).toHaveLength(0);
    expect(result.stats.depth).toBe(0);
  });

  test('computes linear chain correctly', async () => {
    const { analyzeDependencies } = await import('../server/routes/sessions.js');
    const result = analyzeDependencies(linearSession);

    expect(result.layers).toHaveLength(3);
    expect(result.layers[0]).toHaveLength(1);
    expect(result.layers[0][0].id).toBe('t1');
    expect(result.layers[1]).toHaveLength(1);
    expect(result.layers[1][0].id).toBe('t2');
    expect(result.layers[2]).toHaveLength(1);
    expect(result.layers[2][0].id).toBe('t3');

    expect(result.stats.depth).toBe(3);
    expect(result.stats.width).toBe(1);
  });

  test('computes parallel branches correctly', async () => {
    const { analyzeDependencies } = await import('../server/routes/sessions.js');
    const result = analyzeDependencies(parallelSession);

    // Layer 0: root, Layer 1: three branches, Layer 2: merge
    expect(result.layers).toHaveLength(3);
    expect(result.layers[0]).toHaveLength(1);
    expect(result.layers[1]).toHaveLength(3);
    expect(result.layers[2]).toHaveLength(1);

    expect(result.stats.depth).toBe(3);
    expect(result.stats.width).toBe(3);
    expect(result.stats.parallelism).toBeGreaterThan(1);
  });

  test('critical path follows longest path (linear chain = full path)', async () => {
    const { analyzeDependencies } = await import('../server/routes/sessions.js');
    const result = analyzeDependencies(linearSession);

    expect(result.criticalPath).toHaveLength(3);
    expect(result.criticalPath[0].id).toBe('t1');
    expect(result.criticalPath[1].id).toBe('t2');
    expect(result.criticalPath[2].id).toBe('t3');
  });

  test('critical path through diamond goes full depth', async () => {
    const { analyzeDependencies } = await import('../server/routes/sessions.js');
    const result = analyzeDependencies(diamondSession);

    expect(result.criticalPath).toHaveLength(3);
    expect(result.criticalPath[0].id).toBe('a');
    // Middle node is either 'b' or 'c' (both equal depth)
    expect(['b', 'c']).toContain(result.criticalPath[1].id);
    expect(result.criticalPath[2].id).toBe('d');
  });

  test('detects bottlenecks with high fan-out', async () => {
    const { analyzeDependencies } = await import('../server/routes/sessions.js');
    const result = analyzeDependencies(parallelSession);

    // t1 has fan-out of 3
    const bn = result.bottlenecks.find(b => b.id === 't1');
    expect(bn).toBeTruthy();
    expect(bn.fanOut).toBe(3);
    expect(bn.reason).toBe('high fan-out');
  });

  test('detects bottlenecks with high fan-in', async () => {
    const { analyzeDependencies } = await import('../server/routes/sessions.js');
    const result = analyzeDependencies(parallelSession);

    // t5 has fan-in of 3
    const bn = result.bottlenecks.find(b => b.id === 't5');
    expect(bn).toBeTruthy();
    expect(bn.fanIn).toBe(3);
  });

  test('no bottlenecks in simple linear chain', async () => {
    const { analyzeDependencies } = await import('../server/routes/sessions.js');
    const result = analyzeDependencies(linearSession);

    expect(result.bottlenecks).toHaveLength(0);
  });

  test('includes edge list in output', async () => {
    const { analyzeDependencies } = await import('../server/routes/sessions.js');
    const result = analyzeDependencies(linearSession);

    expect(result.edges).toHaveLength(2);
    expect(result.edges[0]).toEqual({ source: 't1', target: 't2' });
    expect(result.edges[1]).toEqual({ source: 't2', target: 't3' });
  });

  test('agent tier info is included in layer nodes', async () => {
    const { analyzeDependencies } = await import('../server/routes/sessions.js');
    const result = analyzeDependencies(linearSession);

    const node1 = result.layers[0][0];
    expect(node1.tier).toBe('T0');
    expect(node1.retries).toBe(0);

    const node2 = result.layers[1][0];
    expect(node2.tier).toBe('T1');
    expect(node2.retries).toBe(1);
  });

  test('nodes include status and label', async () => {
    const { analyzeDependencies } = await import('../server/routes/sessions.js');
    const result = analyzeDependencies(diamondSession);

    const failedNode = result.layers[1].find(n => n.id === 'c');
    expect(failedNode).toBeTruthy();
    expect(failedNode.status).toBe('failed');
    expect(failedNode.label).toBe('Right path');
  });

  test('handles single task session', async () => {
    const { analyzeDependencies } = await import('../server/routes/sessions.js');
    const result = analyzeDependencies({
      id: 'single',
      tasks: [{ id: 't1', label: 'Solo', status: 'success' }],
      edges: [],
      agents: {},
    });

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]).toHaveLength(1);
    expect(result.criticalPath).toHaveLength(1);
    expect(result.stats.depth).toBe(1);
    expect(result.stats.width).toBe(1);
    expect(result.stats.parallelism).toBe(1);
  });

  test('handles all-parallel tasks (no edges)', async () => {
    const { analyzeDependencies } = await import('../server/routes/sessions.js');
    const result = analyzeDependencies({
      id: 'all-parallel',
      tasks: [
        { id: 'a', label: 'A', status: 'success' },
        { id: 'b', label: 'B', status: 'success' },
        { id: 'c', label: 'C', status: 'success' },
      ],
      edges: [],
      agents: {},
    });

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]).toHaveLength(3);
    expect(result.stats.depth).toBe(1);
    expect(result.stats.width).toBe(3);
    expect(result.stats.parallelism).toBe(3);
    expect(result.criticalPath).toHaveLength(1); // any single node
  });

  test('ignores edges referencing nonexistent tasks', async () => {
    const { analyzeDependencies } = await import('../server/routes/sessions.js');
    const result = analyzeDependencies({
      id: 'bad-edges',
      tasks: [
        { id: 't1', label: 'Real', status: 'success' },
      ],
      edges: [
        { source: 't1', target: 'ghost' },
        { source: 'phantom', target: 't1' },
      ],
      agents: {},
    });

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]).toHaveLength(1);
    expect(result.edges).toHaveLength(2); // edges are returned as-is
  });

  test('parallelism ratio is computed correctly', async () => {
    const { analyzeDependencies } = await import('../server/routes/sessions.js');
    const result = analyzeDependencies(parallelSession);

    // 5 tasks / 3 layers ≈ 1.67
    expect(result.stats.parallelism).toBeCloseTo(1.67, 1);
  });
});

// ── REST API Tests ──

test.describe('Dependency Visualization — REST API', () => {
  test('returns 404 for nonexistent session', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent-zzz/sessions/nope/dependencies`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain('not found');
  });

  test('route is wired and responds', async () => {
    const res = await fetch(`${API}/api/projects/any-slug/sessions/any-id/dependencies`);
    // Either 404 (project not found) or 200 — route exists
    expect([200, 404]).toContain(res.status);
    const data = await res.json();
    expect(data).toBeDefined();
  });
});

// ── Client Component Tests ──

test.describe('Dependency Visualization — Client Component', () => {
  test('DependencyGraph.vue exists', () => {
    const filePath = path.join(ROOT, 'client/src/components/DependencyGraph.vue');
    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('<template>');
    expect(content).toContain('<script setup>');
  });

  test('renders layer visualization markup', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/DependencyGraph.vue'), 'utf8');
    expect(content).toContain('dep-layers');
    expect(content).toContain('dep-layer');
    expect(content).toContain('dep-node');
  });

  test('fetches from dependency endpoint', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/DependencyGraph.vue'), 'utf8');
    expect(content).toContain('/dependencies');
    expect(content).toContain('fetch');
  });

  test('supports critical path highlighting', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/DependencyGraph.vue'), 'utf8');
    expect(content).toContain('critical');
    expect(content).toContain('on-critical-path');
  });

  test('supports bottleneck highlighting', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/DependencyGraph.vue'), 'utf8');
    expect(content).toContain('bottleneck');
    expect(content).toContain('is-bottleneck');
  });

  test('displays stats section', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/DependencyGraph.vue'), 'utf8');
    expect(content).toContain('dep-stats');
    expect(content).toContain('Depth');
    expect(content).toContain('Width');
    expect(content).toContain('Parallelism');
  });

  test('SessionHistory includes dependency button', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/SessionHistory.vue'), 'utf8');
    expect(content).toContain('dep-btn');
    expect(content).toContain('DependencyGraph');
    expect(content).toContain('showDepGraph');
  });

  test('DependencyGraph has close functionality', () => {
    const content = readFileSync(path.join(ROOT, 'client/src/components/DependencyGraph.vue'), 'utf8');
    expect(content).toContain("$emit('close')");
    expect(content).toContain('close-btn');
  });
});
