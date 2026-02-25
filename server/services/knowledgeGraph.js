/**
 * server/services/knowledgeGraph.js — Phase 14.4: Lightweight Knowledge Graph
 *
 * Tracks relationships: file↔task, pattern↔project, error↔fix, tech↔pattern.
 * Uses adjacency lists (no heavyweight graph DB).
 * Enables queries like "what patterns apply to Express projects?"
 * and "what fixes worked for timeout errors?"
 *
 * Injected into orchestrator context for better-informed decomposition.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ─── Node Types ──────────────────────────────────────────────────────
export const NODE_TYPES = {
  FILE: 'file',
  TASK: 'task',
  PATTERN: 'pattern',
  ERROR: 'error',
  FIX: 'fix',
  TECH: 'tech',       // technology/framework
  PROJECT: 'project',
};

// ─── Edge Types ──────────────────────────────────────────────────────
export const EDGE_TYPES = {
  MODIFIED_BY: 'modified-by',      // file → task
  DEPENDS_ON: 'depends-on',        // task → task
  FIXED_BY: 'fixed-by',            // error → fix
  USES_TECH: 'uses-tech',          // project → tech
  PATTERN_OF: 'pattern-of',        // pattern → tech/project
  PRODUCED_BY: 'produced-by',      // fix → task
};

/**
 * Lightweight Knowledge Graph — adjacency list implementation.
 * Nodes are { id, type, label, metadata }.
 * Edges are { source, target, type, weight, metadata }.
 */
export class KnowledgeGraph {
  constructor() {
    /** @type {Map<string, { id: string, type: string, label: string, metadata: object }>} */
    this.nodes = new Map();
    /** @type {Map<string, Array<{ target: string, type: string, weight: number, metadata: object }>>} */
    this.adjacency = new Map();   // source → [edges]
    /** @type {Map<string, Array<{ source: string, type: string, weight: number, metadata: object }>>} */
    this.reverseAdj = new Map(); // target → [reverse edges] for fast lookups
  }

  get nodeCount() { return this.nodes.size; }
  get edgeCount() {
    let count = 0;
    for (const edges of this.adjacency.values()) count += edges.length;
    return count;
  }

  /**
   * Add or update a node.
   * @param {string} id
   * @param {string} type — one of NODE_TYPES
   * @param {string} label
   * @param {object} [metadata]
   */
  addNode(id, type, label, metadata = {}) {
    this.nodes.set(id, { id, type, label, metadata });
    if (!this.adjacency.has(id)) this.adjacency.set(id, []);
    if (!this.reverseAdj.has(id)) this.reverseAdj.set(id, []);
  }

  /**
   * Remove a node and all its edges.
   * @param {string} id
   * @returns {boolean}
   */
  removeNode(id) {
    if (!this.nodes.has(id)) return false;

    // Remove forward edges from this node
    this.adjacency.delete(id);

    // Remove reverse edges pointing to this node
    this.reverseAdj.delete(id);

    // Remove edges that reference this node from other nodes
    for (const [source, edges] of this.adjacency.entries()) {
      this.adjacency.set(source, edges.filter(e => e.target !== id));
    }
    for (const [target, edges] of this.reverseAdj.entries()) {
      this.reverseAdj.set(target, edges.filter(e => e.source !== id));
    }

    this.nodes.delete(id);
    return true;
  }

  /**
   * Add a directed edge.
   * @param {string} source — source node ID
   * @param {string} target — target node ID
   * @param {string} type — one of EDGE_TYPES
   * @param {number} [weight=1]
   * @param {object} [metadata]
   */
  addEdge(source, target, type, weight = 1, metadata = {}) {
    if (!this.adjacency.has(source)) this.adjacency.set(source, []);
    if (!this.reverseAdj.has(target)) this.reverseAdj.set(target, []);

    // Avoid duplicates
    const existing = this.adjacency.get(source);
    const dup = existing.find(e => e.target === target && e.type === type);
    if (dup) {
      dup.weight = Math.max(dup.weight, weight);
      Object.assign(dup.metadata, metadata);
      return;
    }

    existing.push({ target, type, weight, metadata });
    this.reverseAdj.get(target).push({ source, type, weight, metadata });
  }

  /**
   * Get all outgoing edges from a node.
   * @param {string} id
   * @param {string} [edgeType] — optional filter
   * @returns {Array<{ target: string, type: string, weight: number, metadata: object, node: object }>}
   */
  getEdgesFrom(id, edgeType) {
    const edges = this.adjacency.get(id) || [];
    const filtered = edgeType ? edges.filter(e => e.type === edgeType) : edges;
    return filtered.map(e => ({
      ...e,
      node: this.nodes.get(e.target) || null,
    }));
  }

  /**
   * Get all incoming edges to a node.
   * @param {string} id
   * @param {string} [edgeType]
   * @returns {Array<{ source: string, type: string, weight: number, metadata: object, node: object }>}
   */
  getEdgesTo(id, edgeType) {
    const edges = this.reverseAdj.get(id) || [];
    const filtered = edgeType ? edges.filter(e => e.type === edgeType) : edges;
    return filtered.map(e => ({
      ...e,
      node: this.nodes.get(e.source) || null,
    }));
  }

  /**
   * Find nodes by type.
   * @param {string} type
   * @returns {Array<{ id: string, type: string, label: string, metadata: object }>}
   */
  getNodesByType(type) {
    const results = [];
    for (const node of this.nodes.values()) {
      if (node.type === type) results.push(node);
    }
    return results;
  }

  /**
   * Find related nodes within N hops.
   * @param {string} startId
   * @param {number} [maxDepth=2]
   * @param {string} [edgeType] — optional edge type filter
   * @returns {Array<{ node: object, depth: number, path: string[] }>}
   */
  findRelated(startId, maxDepth = 2, edgeType) {
    const visited = new Set([startId]);
    const results = [];
    let frontier = [{ id: startId, depth: 0, path: [startId] }];

    while (frontier.length > 0) {
      const nextFrontier = [];
      for (const { id, depth, path } of frontier) {
        if (depth >= maxDepth) continue;

        const edges = this.getEdgesFrom(id, edgeType);
        for (const edge of edges) {
          if (visited.has(edge.target)) continue;
          visited.add(edge.target);
          const newPath = [...path, edge.target];
          results.push({ node: edge.node, depth: depth + 1, path: newPath });
          nextFrontier.push({ id: edge.target, depth: depth + 1, path: newPath });
        }

        // Also check reverse edges
        const revEdges = this.getEdgesTo(id, edgeType);
        for (const edge of revEdges) {
          if (visited.has(edge.source)) continue;
          visited.add(edge.source);
          const newPath = [...path, edge.source];
          results.push({ node: edge.node, depth: depth + 1, path: newPath });
          nextFrontier.push({ id: edge.source, depth: depth + 1, path: newPath });
        }
      }
      frontier = nextFrontier;
    }

    return results;
  }

  /**
   * Get the most connected nodes (by degree).
   * @param {number} [limit=10]
   * @returns {Array<{ id: string, label: string, type: string, degree: number }>}
   */
  getMostConnected(limit = 10) {
    const degrees = [];
    for (const [id, node] of this.nodes.entries()) {
      const outDegree = (this.adjacency.get(id) || []).length;
      const inDegree = (this.reverseAdj.get(id) || []).length;
      degrees.push({ id, label: node.label, type: node.type, degree: outDegree + inDegree });
    }
    return degrees.sort((a, b) => b.degree - a.degree).slice(0, limit);
  }

  // ─── Persistence ─────────────────────────────────────────────────
  toJSON() {
    const edges = [];
    for (const [source, edgeList] of this.adjacency.entries()) {
      for (const edge of edgeList) {
        edges.push({ source, ...edge });
      }
    }
    return {
      nodes: [...this.nodes.values()],
      edges,
    };
  }

  static fromJSON(json) {
    const graph = new KnowledgeGraph();
    for (const node of json.nodes || []) {
      graph.addNode(node.id, node.type, node.label, node.metadata || {});
    }
    for (const edge of json.edges || []) {
      graph.addEdge(edge.source, edge.target, edge.type, edge.weight || 1, edge.metadata || {});
    }
    return graph;
  }

  save(filePath) {
    const dir = filePath.replace(/[/\\][^/\\]+$/, '');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(this.toJSON(), null, 2));
  }

  static load(filePath) {
    if (!existsSync(filePath)) return null;
    try {
      const json = JSON.parse(readFileSync(filePath, 'utf8'));
      return KnowledgeGraph.fromJSON(json);
    } catch {
      return null;
    }
  }
}

// ─── Project-Scoped Knowledge Graph ──────────────────────────────────
/** @type {Map<string, KnowledgeGraph>} */
const projectGraphs = new Map();

/**
 * Get or create the knowledge graph for a project.
 * @param {string} slug
 * @returns {KnowledgeGraph}
 */
export function getGraph(slug) {
  if (projectGraphs.has(slug)) return projectGraphs.get(slug);

  const filePath = join('.haivemind', 'graph', `${slug}.json`);
  let graph = KnowledgeGraph.load(filePath);
  if (!graph) graph = new KnowledgeGraph();

  projectGraphs.set(slug, graph);
  return graph;
}

/**
 * Persist a project's knowledge graph to disk.
 * @param {string} slug
 */
export function saveGraph(slug) {
  const graph = projectGraphs.get(slug);
  if (!graph) return;
  const filePath = join('.haivemind', 'graph', `${slug}.json`);
  graph.save(filePath);
}

/**
 * Record a session's task→file relationships in the knowledge graph.
 *
 * @param {string} slug
 * @param {Array} tasks — completed tasks with file lists
 * @param {object} [techStack] — detected technology stack
 */
export function recordSessionKnowledge(slug, tasks, techStack) {
  const graph = getGraph(slug);

  // Add project node
  graph.addNode(`proj:${slug}`, NODE_TYPES.PROJECT, slug);

  // Add tech stack nodes
  if (techStack) {
    for (const tech of techStack.frameworks || []) {
      const techId = `tech:${tech.toLowerCase()}`;
      graph.addNode(techId, NODE_TYPES.TECH, tech);
      graph.addEdge(`proj:${slug}`, techId, EDGE_TYPES.USES_TECH);
    }
    if (techStack.language) {
      const langId = `tech:${techStack.language.toLowerCase()}`;
      graph.addNode(langId, NODE_TYPES.TECH, techStack.language);
      graph.addEdge(`proj:${slug}`, langId, EDGE_TYPES.USES_TECH);
    }
  }

  // Add task + file nodes and their relationships
  for (const task of tasks || []) {
    const taskId = `task:${task.id}`;
    graph.addNode(taskId, NODE_TYPES.TASK, task.label, {
      status: task.status,
      model: task.model,
      tier: task.modelTier,
    });

    // Task dependencies
    for (const dep of task.dependencies || []) {
      graph.addEdge(taskId, `task:${dep}`, EDGE_TYPES.DEPENDS_ON);
    }

    // Files modified by this task
    for (const file of task.affectedFiles || []) {
      const fileId = `file:${file}`;
      graph.addNode(fileId, NODE_TYPES.FILE, file);
      graph.addEdge(fileId, taskId, EDGE_TYPES.MODIFIED_BY);
    }
  }

  saveGraph(slug);
}

/**
 * Query the knowledge graph for relevant context.
 * Returns a compact string for injection into orchestrator prompts.
 *
 * @param {string} slug
 * @param {string} query — for guiding what context to surface
 * @returns {string}
 */
export function getGraphContext(slug, query) {
  const graph = getGraph(slug);
  if (graph.nodeCount === 0) return '';

  const lines = ['## Project Knowledge Graph'];

  // Show tech stack
  const techs = graph.getNodesByType(NODE_TYPES.TECH);
  if (techs.length > 0) {
    lines.push(`Technologies: ${techs.map(t => t.label).join(', ')}`);
  }

  // Show most-connected files (likely core files)
  const connected = graph.getMostConnected(5);
  const coreFiles = connected.filter(n => n.type === NODE_TYPES.FILE);
  if (coreFiles.length > 0) {
    lines.push(`Core files (most modified): ${coreFiles.map(f => f.label).join(', ')}`);
  }

  // Show error→fix patterns
  const errors = graph.getNodesByType(NODE_TYPES.ERROR);
  if (errors.length > 0) {
    const recentErrors = errors.slice(0, 3);
    for (const err of recentErrors) {
      const fixes = graph.getEdgesFrom(err.id, EDGE_TYPES.FIXED_BY);
      if (fixes.length > 0) {
        lines.push(`Known issue: "${err.label}" → Fix: ${fixes[0].node?.label || 'unknown'}`);
      }
    }
  }

  return lines.length > 1 ? lines.join('\n') + '\n' : '';
}

/**
 * Get knowledge graph statistics.
 * @param {string} slug
 * @returns {object}
 */
export function getGraphStats(slug) {
  const graph = getGraph(slug);
  const nodesByType = {};
  for (const node of graph.nodes.values()) {
    nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
  }
  return {
    nodes: graph.nodeCount,
    edges: graph.edgeCount,
    nodesByType,
    mostConnected: graph.getMostConnected(5),
  };
}
