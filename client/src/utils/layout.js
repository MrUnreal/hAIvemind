/**
 * Simple auto-layout for a DAG of nodes.
 * Places nodes in columns based on dependency depth (topological layers).
 * Adds synthetic START and END nodes for visual clarity.
 */
export function layoutNodes(tasks, edges) {
  // Build adjacency: for each task, which tasks depend on it
  const depthMap = new Map();
  const incoming = new Map();

  for (const t of tasks) {
    incoming.set(t.id, new Set(t.dependencies || []));
    depthMap.set(t.id, 0);
  }

  // Topological layering via Kahn's algorithm
  const queue = [];
  for (const [id, deps] of incoming) {
    if (deps.size === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const id = queue.shift();
    const depth = depthMap.get(id);

    for (const t of tasks) {
      if (t.dependencies?.includes(id)) {
        const newDepth = depth + 1;
        depthMap.set(t.id, Math.max(depthMap.get(t.id), newDepth));
        incoming.get(t.id).delete(id);
        if (incoming.get(t.id).size === 0) {
          queue.push(t.id);
        }
      }
    }
  }

  // Group by depth
  const layers = new Map();
  for (const [id, depth] of depthMap) {
    if (!layers.has(depth)) layers.set(depth, []);
    layers.get(depth).push(id);
  }

  const maxDepth = Math.max(0, ...depthMap.values());

  // Find root and leaf tasks
  const rootTasks = tasks.filter(t => !t.dependencies || t.dependencies.length === 0).map(t => t.id);
  const allDeps = new Set(tasks.flatMap(t => t.dependencies || []));
  const allTargets = new Set();
  for (const t of tasks) {
    for (const d of (t.dependencies || [])) {
      allTargets.add(t.id);
    }
  }
  // Leaf tasks = tasks that no other task depends on
  const depTargets = new Set(tasks.flatMap(t => t.dependencies || []));
  const leafTasks = tasks.filter(t => !depTargets.has(t.id)).map(t => t.id);

  // Position nodes
  const NODE_WIDTH = 260;
  const NODE_HEIGHT = 80;
  const X_GAP = 80;
  const Y_GAP = 40;
  const nodes = [];

  // START node at depth -1
  const startLayerHeight = rootTasks.length * (NODE_HEIGHT + Y_GAP);
  nodes.push({
    id: '__start__',
    type: 'bookend',
    position: { x: 40 - NODE_WIDTH - X_GAP, y: Math.max(0, (startLayerHeight / 2) - 20) },
    data: { label: 'START', variant: 'start' },
    selectable: false,
  });

  for (const [depth, ids] of layers) {
    const x = depth * (NODE_WIDTH + X_GAP) + 40;
    ids.forEach((id, i) => {
      const task = tasks.find(t => t.id === id);
      const y = i * (NODE_HEIGHT + Y_GAP) + 40;
      const nodeType = task.type === 'prompt' ? 'prompt' : 'agent';
      nodes.push({
        id,
        type: nodeType,
        position: { x, y },
        data: {
          label: task.label,
          taskId: task.id,
          description: task.description,
          status: task.type === 'prompt' ? 'prompt' : 'pending',
          prompt: task.prompt || null,
        },
      });
    });
  }

  // END node after last depth
  const lastLayerIds = layers.get(maxDepth) || [];
  const lastLayerHeight = lastLayerIds.length * (NODE_HEIGHT + Y_GAP);
  nodes.push({
    id: '__end__',
    type: 'bookend',
    position: { x: (maxDepth + 1) * (NODE_WIDTH + X_GAP) + 40, y: Math.max(0, (lastLayerHeight / 2) - 20) },
    data: { label: 'END', variant: 'end' },
    selectable: false,
  });

  // Task edges
  const flowEdges = edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: true,
    style: { stroke: '#555' },
  }));

  // START → root tasks
  for (const rootId of rootTasks) {
    flowEdges.push({
      id: `__start__->${rootId}`,
      source: '__start__',
      target: rootId,
      animated: false,
      style: { stroke: '#333', strokeDasharray: '4 4' },
    });
  }

  // Leaf tasks → END
  for (const leafId of leafTasks) {
    flowEdges.push({
      id: `${leafId}->__end__`,
      source: leafId,
      target: '__end__',
      animated: false,
      style: { stroke: '#333', strokeDasharray: '4 4' },
    });
  }

  return { nodes, edges: flowEdges };
}
