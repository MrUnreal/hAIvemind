/**
 * server/services/taskDependencies.js — Task Dependencies & Priority
 *
 * Dependency graph for tasks with priority levels, blocking/non-blocking
 * edges, critical path calculation, and priority-based scheduling.
 *
 * Data model (stored in project settings under `taskGraph`):
 *   {
 *     tasks: [{ id, name, priority, status, dependsOn, blockedBy, metadata, createdAt, updatedAt }],
 *     edges: [{ from, to, type }]  // type: 'blocking' | 'non-blocking'
 *   }
 */

import { refs } from '../state.js';

// ─── Constants ──────────────────────────────────────────────────────────

export const PRIORITY_LEVELS = ['critical', 'high', 'medium', 'low'];
export const TASK_STATUSES = ['pending', 'ready', 'running', 'completed', 'failed', 'skipped'];
export const EDGE_TYPES = ['blocking', 'non-blocking'];

// ─── Helpers ────────────────────────────────────────────────────────────

function _getGraph(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  return settings.taskGraph || { tasks: [], edges: [] };
}

function _saveGraph(slug, graph) {
  refs.workspace?.updateProjectSettings?.(slug, { taskGraph: graph });
}

function _genId() {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Task CRUD ──────────────────────────────────────────────────────────

/**
 * List all tasks with optional filtering.
 * @param {string} slug
 * @param {object} [opts]
 * @param {string} [opts.status] - Filter by status
 * @param {string} [opts.priority] - Filter by priority
 * @returns {Array}
 */
export function listTasks(slug, opts = {}) {
  const graph = _getGraph(slug);
  let tasks = [...graph.tasks];
  if (opts.status) tasks = tasks.filter(t => t.status === opts.status);
  if (opts.priority) tasks = tasks.filter(t => t.priority === opts.priority);
  return tasks;
}

/**
 * Get a single task by ID.
 */
export function getTask(slug, taskId) {
  const graph = _getGraph(slug);
  return graph.tasks.find(t => t.id === taskId) || null;
}

/**
 * Create a new task.
 * @param {string} slug
 * @param {object} data
 * @param {string} data.name - Task name
 * @param {string} [data.priority='medium'] - Priority level
 * @param {object} [data.metadata] - Arbitrary metadata
 * @returns {object} The created task
 */
export function createTask(slug, data) {
  if (!data.name) throw new Error('Task name is required');
  const priority = PRIORITY_LEVELS.includes(data.priority) ? data.priority : 'medium';

  const graph = _getGraph(slug);
  const task = {
    id: _genId(),
    name: data.name,
    priority,
    status: 'pending',
    dependsOn: [],      // task IDs this depends on
    blockedBy: [],       // tasks blocking this one (computed)
    metadata: data.metadata || {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  graph.tasks.push(task);
  _saveGraph(slug, graph);

  // Return with computed fields
  return _enrichTask(graph, task);
}

/**
 * Update a task's properties.
 */
export function updateTask(slug, taskId, patch) {
  const graph = _getGraph(slug);
  const idx = graph.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return null;

  const allowed = ['name', 'priority', 'status', 'metadata'];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      if (key === 'priority' && !PRIORITY_LEVELS.includes(patch[key])) continue;
      if (key === 'status' && !TASK_STATUSES.includes(patch[key])) continue;
      graph.tasks[idx][key] = patch[key];
    }
  }
  graph.tasks[idx].updatedAt = Date.now();
  _saveGraph(slug, graph);
  return _enrichTask(graph, graph.tasks[idx]);
}

/**
 * Delete a task and all its edges.
 */
export function deleteTask(slug, taskId) {
  const graph = _getGraph(slug);
  const idx = graph.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return false;

  graph.tasks.splice(idx, 1);

  // Remove all edges involving this task
  graph.edges = graph.edges.filter(e => e.from !== taskId && e.to !== taskId);

  // Remove from other tasks' dependsOn
  for (const t of graph.tasks) {
    t.dependsOn = (t.dependsOn || []).filter(d => d !== taskId);
  }

  _saveGraph(slug, graph);
  return true;
}

// ─── Dependency Edges ───────────────────────────────────────────────────

/**
 * Add a dependency edge: `to` depends on `from`.
 * @param {string} slug
 * @param {object} edge
 * @param {string} edge.from - Prerequisite task ID
 * @param {string} edge.to - Dependent task ID
 * @param {string} [edge.type='blocking'] - Edge type
 * @returns {object|null}
 */
export function addDependency(slug, edge) {
  if (!edge.from || !edge.to) throw new Error('from and to are required');
  if (edge.from === edge.to) throw new Error('Cannot depend on self');

  const graph = _getGraph(slug);
  const fromTask = graph.tasks.find(t => t.id === edge.from);
  const toTask = graph.tasks.find(t => t.id === edge.to);
  if (!fromTask || !toTask) throw new Error('Task not found');

  // Check for existing edge
  const existing = graph.edges.find(e => e.from === edge.from && e.to === edge.to);
  if (existing) throw new Error('Dependency already exists');

  // Check for circular dependency
  if (_wouldCreateCycle(graph, edge.from, edge.to)) {
    throw new Error('Would create circular dependency');
  }

  const type = EDGE_TYPES.includes(edge.type) ? edge.type : 'blocking';
  const dep = {
    id: `dep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    from: edge.from,
    to: edge.to,
    type,
    createdAt: Date.now(),
  };

  graph.edges.push(dep);

  // Update dependsOn on the dependent task
  if (!toTask.dependsOn) toTask.dependsOn = [];
  if (!toTask.dependsOn.includes(edge.from)) {
    toTask.dependsOn.push(edge.from);
  }

  _saveGraph(slug, graph);
  return dep;
}

/**
 * Remove a dependency edge.
 */
export function removeDependency(slug, depId) {
  const graph = _getGraph(slug);
  const idx = graph.edges.findIndex(e => e.id === depId);
  if (idx === -1) return false;

  const edge = graph.edges[idx];
  graph.edges.splice(idx, 1);

  // Update dependsOn
  const toTask = graph.tasks.find(t => t.id === edge.to);
  if (toTask) {
    toTask.dependsOn = (toTask.dependsOn || []).filter(d => d !== edge.from);
  }

  _saveGraph(slug, graph);
  return true;
}

/**
 * List all dependency edges for a project.
 */
export function listDependencies(slug) {
  return _getGraph(slug).edges;
}

// ─── Scheduling & Analysis ──────────────────────────────────────────────

/**
 * Get tasks sorted by priority and readiness.
 * Ready tasks (all blocking deps completed) come first, sorted by priority.
 */
export function getSchedule(slug) {
  const graph = _getGraph(slug);
  const tasks = graph.tasks.map(t => _enrichTask(graph, t));

  // Separate by readiness
  const ready = tasks.filter(t => t.isReady && t.status === 'pending');
  const blocked = tasks.filter(t => !t.isReady && t.status === 'pending');
  const active = tasks.filter(t => t.status === 'running');
  const done = tasks.filter(t => ['completed', 'failed', 'skipped'].includes(t.status));

  // Sort by priority within each bucket
  const prioOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sortByPrio = (a, b) => (prioOrder[a.priority] || 2) - (prioOrder[b.priority] || 2);

  ready.sort(sortByPrio);
  blocked.sort(sortByPrio);

  return { ready, blocked, active, done, totalCount: tasks.length };
}

/**
 * Calculate the critical path — longest chain of blocking dependencies.
 * Returns the ordered list of task IDs on the critical path.
 */
export function getCriticalPath(slug) {
  const graph = _getGraph(slug);
  if (graph.tasks.length === 0) return [];

  // Build adjacency list for blocking edges only
  const adj = {};
  const inDeg = {};
  for (const t of graph.tasks) {
    adj[t.id] = [];
    inDeg[t.id] = 0;
  }
  for (const e of graph.edges) {
    if (e.type === 'blocking' && adj[e.from] && adj[e.to] !== undefined) {
      adj[e.from].push(e.to);
      inDeg[e.to] = (inDeg[e.to] || 0) + 1;
    }
  }

  // Topological sort + longest path
  const dist = {};
  const prev = {};
  for (const id of Object.keys(adj)) {
    dist[id] = 0;
    prev[id] = null;
  }

  // Kahn's algorithm
  const queue = Object.keys(inDeg).filter(id => inDeg[id] === 0);
  const order = [];

  while (queue.length > 0) {
    const u = queue.shift();
    order.push(u);
    for (const v of adj[u]) {
      if (dist[u] + 1 > dist[v]) {
        dist[v] = dist[u] + 1;
        prev[v] = u;
      }
      inDeg[v]--;
      if (inDeg[v] === 0) queue.push(v);
    }
  }

  // Find the node with the maximum distance
  let maxNode = null;
  let maxDist = -1;
  for (const [id, d] of Object.entries(dist)) {
    if (d > maxDist) {
      maxDist = d;
      maxNode = id;
    }
  }

  if (maxDist <= 0) return [];

  // Trace back
  const path = [];
  let cur = maxNode;
  while (cur) {
    path.unshift(cur);
    cur = prev[cur];
  }

  return path;
}

/**
 * Get dependency stats for a project.
 */
export function getDependencyStats(slug) {
  const graph = _getGraph(slug);
  const statusCounts = {};
  const priorityCounts = {};

  for (const t of graph.tasks) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
  }

  return {
    totalTasks: graph.tasks.length,
    totalEdges: graph.edges.length,
    blockingEdges: graph.edges.filter(e => e.type === 'blocking').length,
    nonBlockingEdges: graph.edges.filter(e => e.type === 'non-blocking').length,
    statusCounts,
    priorityCounts,
    criticalPathLength: getCriticalPath(slug).length,
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────────

/**
 * Enrich a task with computed fields (isReady, blockingDeps, etc.)
 */
function _enrichTask(graph, task) {
  const blockingDeps = graph.edges
    .filter(e => e.to === task.id && e.type === 'blocking')
    .map(e => e.from);

  const completedStatuses = ['completed', 'skipped'];
  const isReady = blockingDeps.every(depId => {
    const depTask = graph.tasks.find(t => t.id === depId);
    return depTask && completedStatuses.includes(depTask.status);
  });

  return {
    ...task,
    blockingDeps,
    isReady,
    dependencyCount: (task.dependsOn || []).length,
    dependentCount: graph.edges.filter(e => e.from === task.id).length,
  };
}

/**
 * Check if adding edge from -> to would create a cycle.
 * Does BFS from `to` following edges to see if we can reach `from`.
 */
function _wouldCreateCycle(graph, from, to) {
  // If adding to -> from (to depends on from), check if from can reach to
  const visited = new Set();
  const queue = [from];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === to) return true;  // cycle detected: from can already reach to
    if (visited.has(current)) continue;
    visited.add(current);

    // Follow edges where current is a dependency (current -> something)
    // Actually we need to check: does `to` already have a path to `from`?
    // We're adding edge: `to` depends on `from` (from -> to)
    // Cycle exists if `to` can reach `from` via existing edges
  }

  // Correct approach: BFS from `to` following existing edges to see if `from` is reachable
  const visited2 = new Set();
  const queue2 = [to];

  while (queue2.length > 0) {
    const current = queue2.shift();
    if (current === from) return true;
    if (visited2.has(current)) continue;
    visited2.add(current);

    // Follow forward edges: current -> next
    for (const e of graph.edges) {
      if (e.from === current && !visited2.has(e.to)) {
        queue2.push(e.to);
      }
    }
  }

  return false;
}

/**
 * Reset for testing.
 */
export function _reset() {
  // Stateless — data lives in project settings
}
