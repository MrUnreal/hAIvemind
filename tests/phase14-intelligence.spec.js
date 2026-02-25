// @ts-check
import { test, expect } from '@playwright/test';

/* ════════════════════════════════════════════
   Phase 14 — Intelligence & Learning
   ════════════════════════════════════════════ */

// ─── 14.0 Vector Memory ─────────────────────────────────────────────
test.describe('Vector Memory — HNSW & Embeddings', () => {
  test('embed() produces fixed-dimension vectors', async () => {
    const { embed } = await import('../server/services/vectorMemory.js');
    const vec = embed('hello world');
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(128);
  });

  test('embed() produces normalized vectors', async () => {
    const { embed } = await import('../server/services/vectorMemory.js');
    const vec = embed('test normalization check');
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    expect(Math.abs(Math.sqrt(norm) - 1)).toBeLessThan(0.001);
  });

  test('embed() returns zero vector for empty string', async () => {
    const { embed } = await import('../server/services/vectorMemory.js');
    const vec = embed('');
    expect(vec.every(v => v === 0)).toBe(true);
  });

  test('cosineSimilarity returns 1 for identical vectors', async () => {
    const { embed, cosineSimilarity } = await import('../server/services/vectorMemory.js');
    const vec = embed('identical test');
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 5);
  });

  test('similar texts have higher similarity than dissimilar', async () => {
    const { embed, cosineSimilarity } = await import('../server/services/vectorMemory.js');
    const vecA = embed('create express api endpoint');
    const vecB = embed('build express rest route');
    const vecC = embed('deploy kubernetes cluster');
    const simAB = cosineSimilarity(vecA, vecB);
    const simAC = cosineSimilarity(vecA, vecC);
    expect(simAB).toBeGreaterThan(simAC);
  });

  test('HNSWIndex insert and search works', async () => {
    const { HNSWIndex, embed } = await import('../server/services/vectorMemory.js');
    const index = new HNSWIndex();
    index.insert('a', embed('express api server'), { label: 'express' });
    index.insert('b', embed('react frontend component'), { label: 'react' });
    index.insert('c', embed('express route handler'), { label: 'route' });
    const results = index.search(embed('api route express'), 2);
    expect(results.length).toBe(2);
    expect(['a', 'c']).toContain(results[0].id); // both are express-related
  });

  test('HNSWIndex serialization roundtrip', async () => {
    const { HNSWIndex, embed } = await import('../server/services/vectorMemory.js');
    const index = new HNSWIndex();
    index.insert('x', embed('test serialization'), { label: 'test' });
    index.insert('y', embed('another entry'), { label: 'other' });
    const json = index.toJSON();
    const restored = HNSWIndex.fromJSON(json);
    expect(restored.size).toBe(2);
    const results = restored.search(embed('serialization'), 1);
    expect(results[0].id).toBe('x');
  });

  test('HNSWIndex remove works', async () => {
    const { HNSWIndex, embed } = await import('../server/services/vectorMemory.js');
    const index = new HNSWIndex();
    index.insert('a', embed('first entry'));
    index.insert('b', embed('second entry'));
    expect(index.remove('a')).toBe(true);
    expect(index.remove('nonexistent')).toBe(false);
    const results = index.search(embed('first entry'), 10);
    expect(results.every(r => r.id !== 'a')).toBe(true);
  });

  test('HNSWIndex handles update (re-insert same id)', async () => {
    const { HNSWIndex, embed } = await import('../server/services/vectorMemory.js');
    const index = new HNSWIndex();
    index.insert('a', embed('original text'), { v: 1 });
    index.insert('a', embed('updated text'), { v: 2 });
    expect(index.size).toBe(1); // Should not duplicate
    const results = index.search(embed('updated'), 1);
    expect(results[0].data.v).toBe(2);
  });

  test('HNSWIndex minSimilarity filter works', async () => {
    const { HNSWIndex, embed } = await import('../server/services/vectorMemory.js');
    const index = new HNSWIndex();
    index.insert('a', embed('express api server'));
    index.insert('b', embed('quantum physics lecture notes'));
    const results = index.search(embed('express api'), 10, 0.5);
    // Only close matches should appear
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

// ─── 14.1 Pattern Bank ──────────────────────────────────────────────
test.describe('Pattern Bank — Learning', () => {
  test('categorizeTask identifies common categories', async () => {
    const { categorizeTask } = await import('../server/services/patternBank.js');
    expect(categorizeTask('Add unit tests for auth module')).toBe('testing');
    expect(categorizeTask('Create REST API endpoint')).toBe('api');
    expect(categorizeTask('Setup Docker CI pipeline')).toBe('devops');
    expect(categorizeTask('Build login page component')).toBe('authentication');
    expect(categorizeTask('Update README documentation')).toBe('documentation');
    expect(categorizeTask('Optimize database queries')).toBe('database');
    expect(categorizeTask('Build dashboard UI component')).toBe('frontend');
    expect(categorizeTask('Generic task without keywords')).toBe('implementation');
  });

  test('PATTERN_TYPES has all expected categories', async () => {
    const { PATTERN_TYPES } = await import('../server/services/patternBank.js');
    expect(PATTERN_TYPES).toHaveProperty('DECOMPOSITION');
    expect(PATTERN_TYPES).toHaveProperty('MODEL_SUCCESS');
    expect(PATTERN_TYPES).toHaveProperty('FAILURE_FIX');
    expect(PATTERN_TYPES).toHaveProperty('TASK_STRATEGY');
    expect(PATTERN_TYPES).toHaveProperty('ESCALATION');
  });

  test('recordDecompositionPattern skips low success rate', async () => {
    const { recordDecompositionPattern } = await import('../server/services/patternBank.js');
    const result = recordDecompositionPattern('test-project-pattern', {
      prompt: 'Build a failing project',
      tasks: [
        { label: 'Task A', status: 'failed' },
        { label: 'Task B', status: 'failed' },
      ],
      stats: { waves: 1, splits: 0 },
    });
    expect(result).toBeNull(); // < 50% success → not stored
  });

  test('getPatternsAsContext returns empty for new project', async () => {
    const { getPatternsAsContext } = await import('../server/services/patternBank.js');
    const ctx = getPatternsAsContext('nonexistent-project-slug', 'some prompt');
    expect(ctx).toBe('');
  });
});

// ─── 14.2 Task Router ───────────────────────────────────────────────
test.describe('Task Router — Learned Routing', () => {
  test('getRecommendedModel returns null with no data', async () => {
    const { getRecommendedModel, resetRouting } = await import('../server/services/taskRouter.js');
    resetRouting('test-routing-empty');
    const result = getRecommendedModel('test-routing-empty', 'Build API endpoint', 0);
    expect(result).toBeNull();
  });

  test('recordOutcome tracks success/failure', async () => {
    const { recordOutcome, getRoutingStats, resetRouting } = await import('../server/services/taskRouter.js');
    resetRouting('test-routing-record');
    recordOutcome('test-routing-record', 'Add unit tests', 'gpt-5.1', 'T0', true, 5000);
    recordOutcome('test-routing-record', 'Add unit tests', 'gpt-5.1', 'T0', true, 4000);
    recordOutcome('test-routing-record', 'Add unit tests', 'gpt-5.1', 'T0', false, 10000);
    const stats = getRoutingStats('test-routing-record');
    expect(stats.categories).toHaveProperty('testing');
    expect(stats.categories.testing[0].model).toBe('gpt-5.1');
    expect(stats.categories.testing[0].total).toBe(3);
  });

  test('getRecommendedModel returns recommendation after enough observations', async () => {
    const { recordOutcome, getRecommendedModel, resetRouting } = await import('../server/services/taskRouter.js');
    resetRouting('test-routing-recommend');
    // Record enough observations
    for (let i = 0; i < 5; i++) {
      recordOutcome('test-routing-recommend', 'Create API route', 'gpt-5.1', 'T0', true, 3000);
    }
    const result = getRecommendedModel('test-routing-recommend', 'Build API endpoint', 0);
    expect(result).not.toBeNull();
    expect(result.model).toBe('gpt-5.1');
    expect(result.reason).toContain('api');
  });
});

// ─── 14.4 Knowledge Graph ───────────────────────────────────────────
test.describe('Knowledge Graph', () => {
  test('addNode and getNodesByType work', async () => {
    const { KnowledgeGraph, NODE_TYPES } = await import('../server/services/knowledgeGraph.js');
    const graph = new KnowledgeGraph();
    graph.addNode('f1', NODE_TYPES.FILE, 'server.js');
    graph.addNode('f2', NODE_TYPES.FILE, 'index.js');
    graph.addNode('t1', NODE_TYPES.TASK, 'Build server');
    const files = graph.getNodesByType(NODE_TYPES.FILE);
    expect(files).toHaveLength(2);
  });

  test('addEdge and getEdgesFrom work', async () => {
    const { KnowledgeGraph, NODE_TYPES, EDGE_TYPES } = await import('../server/services/knowledgeGraph.js');
    const graph = new KnowledgeGraph();
    graph.addNode('f1', NODE_TYPES.FILE, 'server.js');
    graph.addNode('t1', NODE_TYPES.TASK, 'Build server');
    graph.addEdge('f1', 't1', EDGE_TYPES.MODIFIED_BY);
    const edges = graph.getEdgesFrom('f1', EDGE_TYPES.MODIFIED_BY);
    expect(edges).toHaveLength(1);
    expect(edges[0].target).toBe('t1');
  });

  test('findRelated discovers multi-hop relationships', async () => {
    const { KnowledgeGraph, NODE_TYPES, EDGE_TYPES } = await import('../server/services/knowledgeGraph.js');
    const graph = new KnowledgeGraph();
    graph.addNode('a', NODE_TYPES.FILE, 'a.js');
    graph.addNode('b', NODE_TYPES.TASK, 'task-b');
    graph.addNode('c', NODE_TYPES.FILE, 'c.js');
    graph.addEdge('a', 'b', EDGE_TYPES.MODIFIED_BY);
    graph.addEdge('b', 'c', EDGE_TYPES.DEPENDS_ON);
    const related = graph.findRelated('a', 2);
    expect(related.length).toBeGreaterThanOrEqual(2);
    expect(related.some(r => r.node?.id === 'c')).toBe(true);
  });

  test('removeNode removes edges too', async () => {
    const { KnowledgeGraph, NODE_TYPES, EDGE_TYPES } = await import('../server/services/knowledgeGraph.js');
    const graph = new KnowledgeGraph();
    graph.addNode('a', NODE_TYPES.FILE, 'a.js');
    graph.addNode('b', NODE_TYPES.TASK, 'task-b');
    graph.addEdge('a', 'b', EDGE_TYPES.MODIFIED_BY);
    graph.removeNode('a');
    expect(graph.nodeCount).toBe(1);
    expect(graph.getEdgesTo('b')).toHaveLength(0);
  });

  test('getMostConnected returns sorted by degree', async () => {
    const { KnowledgeGraph, NODE_TYPES, EDGE_TYPES } = await import('../server/services/knowledgeGraph.js');
    const graph = new KnowledgeGraph();
    graph.addNode('hub', NODE_TYPES.FILE, 'hub.js');
    graph.addNode('a', NODE_TYPES.TASK, 'task-a');
    graph.addNode('b', NODE_TYPES.TASK, 'task-b');
    graph.addNode('c', NODE_TYPES.TASK, 'task-c');
    graph.addEdge('hub', 'a', EDGE_TYPES.MODIFIED_BY);
    graph.addEdge('hub', 'b', EDGE_TYPES.MODIFIED_BY);
    graph.addEdge('hub', 'c', EDGE_TYPES.MODIFIED_BY);
    const top = graph.getMostConnected(1);
    expect(top[0].id).toBe('hub');
    expect(top[0].degree).toBe(3);
  });

  test('serialization roundtrip preserves graph', async () => {
    const { KnowledgeGraph, NODE_TYPES, EDGE_TYPES } = await import('../server/services/knowledgeGraph.js');
    const graph = new KnowledgeGraph();
    graph.addNode('a', NODE_TYPES.FILE, 'a.js');
    graph.addNode('b', NODE_TYPES.TASK, 'task-b');
    graph.addEdge('a', 'b', EDGE_TYPES.MODIFIED_BY, 2, { key: 'val' });
    const json = graph.toJSON();
    const restored = KnowledgeGraph.fromJSON(json);
    expect(restored.nodeCount).toBe(2);
    expect(restored.edgeCount).toBe(1);
    const edges = restored.getEdgesFrom('a');
    expect(edges[0].weight).toBe(2);
  });

  test('duplicate edges update weight instead of duplicating', async () => {
    const { KnowledgeGraph, NODE_TYPES, EDGE_TYPES } = await import('../server/services/knowledgeGraph.js');
    const graph = new KnowledgeGraph();
    graph.addNode('a', NODE_TYPES.FILE, 'a.js');
    graph.addNode('b', NODE_TYPES.TASK, 'task-b');
    graph.addEdge('a', 'b', EDGE_TYPES.MODIFIED_BY, 1);
    graph.addEdge('a', 'b', EDGE_TYPES.MODIFIED_BY, 5);
    expect(graph.edgeCount).toBe(1);
    const edges = graph.getEdgesFrom('a');
    expect(edges[0].weight).toBe(5);
  });
});
