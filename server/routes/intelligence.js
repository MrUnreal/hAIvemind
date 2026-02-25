/**
 * server/routes/intelligence.js — REST endpoints for Phase 14 intelligence subsystems
 *
 * Exposes: vector memory, pattern bank, task routing, knowledge graph.
 * All project-scoped under /projects/:slug/intelligence/*.
 */

import { Router } from 'express';
import { refs } from '../state.js';
import { searchVectors, storeVector, removeVector, getVectorStats } from '../services/vectorMemory.js';
import { recallPatterns, getPatternStats, recallModelPatterns, getPatternsAsContext } from '../services/patternBank.js';
import { getRoutingStats, resetRouting } from '../services/taskRouter.js';
import { getGraph, getGraphStats, getGraphContext, saveGraph } from '../services/knowledgeGraph.js';

const router = Router();

function requireProject(req, res) {
  if (!refs.workspace.getProject(req.params.slug)) {
    res.status(404).json({ error: 'Project not found' });
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════
//  Vector Memory — semantic search over past memories
// ═══════════════════════════════════════════════════════════════════

/** Semantic search */
router.get('/projects/:slug/intelligence/vectors/search', (req, res) => {
  if (!requireProject(req, res)) return;
  const { q, k, minSimilarity } = req.query;
  if (!q) return res.status(400).json({ error: 'Query string "q" required' });
  const results = searchVectors(
    req.params.slug, q,
    k ? parseInt(k) : 10,
    minSimilarity ? parseFloat(minSimilarity) : 0.1,
  );
  res.json(results);
});

/** Store a vector entry */
router.post('/projects/:slug/intelligence/vectors', (req, res) => {
  if (!requireProject(req, res)) return;
  const { id, text, metadata } = req.body || {};
  if (!id || !text) return res.status(400).json({ error: 'id and text required' });
  storeVector(req.params.slug, id, text, metadata || {});
  res.json({ ok: true, id });
});

/** Delete a vector entry */
router.delete('/projects/:slug/intelligence/vectors/:id', (req, res) => {
  if (!requireProject(req, res)) return;
  const removed = removeVector(req.params.slug, req.params.id);
  res.json({ ok: removed });
});

/** Vector stats */
router.get('/projects/:slug/intelligence/vectors/stats', (req, res) => {
  if (!requireProject(req, res)) return;
  res.json(getVectorStats(req.params.slug));
});

// ═══════════════════════════════════════════════════════════════════
//  Pattern Bank — learned decomposition & model patterns
// ═══════════════════════════════════════════════════════════════════

/** Recall similar patterns */
router.get('/projects/:slug/intelligence/patterns/recall', (req, res) => {
  if (!requireProject(req, res)) return;
  const { q, limit } = req.query;
  if (!q) return res.status(400).json({ error: 'Query string "q" required' });
  const results = recallPatterns(req.params.slug, q, limit ? parseInt(limit) : 5);
  res.json(results);
});

/** Get pattern context (formatted for prompts) */
router.get('/projects/:slug/intelligence/patterns/context', (req, res) => {
  if (!requireProject(req, res)) return;
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query string "q" required' });
  const context = getPatternsAsContext(req.params.slug, q);
  res.json({ context });
});

/** Model patterns for a task */
router.get('/projects/:slug/intelligence/patterns/models', (req, res) => {
  if (!requireProject(req, res)) return;
  const { task, limit } = req.query;
  if (!task) return res.status(400).json({ error: 'Query string "task" required' });
  const results = recallModelPatterns(req.params.slug, task, limit ? parseInt(limit) : 10);
  res.json(results);
});

/** Pattern stats */
router.get('/projects/:slug/intelligence/patterns/stats', (req, res) => {
  if (!requireProject(req, res)) return;
  res.json(getPatternStats(req.params.slug));
});

// ═══════════════════════════════════════════════════════════════════
//  Task Routing — learned model selection
// ═══════════════════════════════════════════════════════════════════

/** Routing stats */
router.get('/projects/:slug/intelligence/routing/stats', (req, res) => {
  if (!requireProject(req, res)) return;
  res.json(getRoutingStats(req.params.slug));
});

/** Reset routing data */
router.delete('/projects/:slug/intelligence/routing', (req, res) => {
  if (!requireProject(req, res)) return;
  resetRouting(req.params.slug);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════
//  Knowledge Graph — project relationships
// ═══════════════════════════════════════════════════════════════════

/** Graph stats */
router.get('/projects/:slug/intelligence/graph/stats', (req, res) => {
  if (!requireProject(req, res)) return;
  res.json(getGraphStats(req.params.slug));
});

/** Graph context (formatted for prompts) */
router.get('/projects/:slug/intelligence/graph/context', (req, res) => {
  if (!requireProject(req, res)) return;
  const { q } = req.query;
  const context = getGraphContext(req.params.slug, q || '');
  res.json({ context });
});

/** Related nodes */
router.get('/projects/:slug/intelligence/graph/related/:nodeId', (req, res) => {
  if (!requireProject(req, res)) return;
  const graph = getGraph(req.params.slug);
  const { depth, edgeType } = req.query;
  const results = graph.findRelated(
    req.params.nodeId,
    depth ? parseInt(depth) : 2,
    edgeType || undefined,
  );
  res.json(results);
});

/** Add a node */
router.post('/projects/:slug/intelligence/graph/nodes', (req, res) => {
  if (!requireProject(req, res)) return;
  const { id, type, label, metadata } = req.body || {};
  if (!id || !type || !label) return res.status(400).json({ error: 'id, type, and label required' });
  const graph = getGraph(req.params.slug);
  graph.addNode(id, type, label, metadata || {});
  saveGraph(req.params.slug);
  res.json({ ok: true, id });
});

/** Add an edge */
router.post('/projects/:slug/intelligence/graph/edges', (req, res) => {
  if (!requireProject(req, res)) return;
  const { source, target, type, weight, metadata } = req.body || {};
  if (!source || !target || !type) return res.status(400).json({ error: 'source, target, and type required' });
  const graph = getGraph(req.params.slug);
  graph.addEdge(source, target, type, weight || 1, metadata || {});
  saveGraph(req.params.slug);
  res.json({ ok: true });
});

export default router;
