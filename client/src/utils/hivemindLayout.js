/**
 * Hivemind balanced layout — left-to-right column flow.
 * Each wave/depth is a column. Columns are vertically centered
 * against the tallest column for a balanced, symmetric look.
 * Slight organic jitter keeps it from feeling like a rigid grid.
 */

export function hivemindLayout(tasks, edgeList) {
  // ── Build dependency layers (topological sort) ──
  const incoming = new Map();
  for (const t of tasks) {
    incoming.set(t.id, new Set(t.dependencies || []));
  }

  const depthMap = new Map();
  const queue = [];
  for (const [id, deps] of incoming) {
    if (deps.size === 0) {
      depthMap.set(id, 0);
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const id = queue.shift();
    const depth = depthMap.get(id);
    for (const t of tasks) {
      if (t.dependencies?.includes(id)) {
        const newDepth = depth + 1;
        depthMap.set(t.id, Math.max(depthMap.get(t.id) || 0, newDepth));
        incoming.get(t.id).delete(id);
        if (incoming.get(t.id).size === 0) {
          queue.push(t.id);
        }
      }
    }
  }

  // Group tasks by wave/layer
  const layers = new Map();
  for (const [id, depth] of depthMap) {
    if (!layers.has(depth)) layers.set(depth, []);
    layers.get(depth).push(id);
  }

  const maxDepth = Math.max(0, ...depthMap.values());

  // ── Layout constants ──
  const NODE_W = 240;
  const NODE_H = 90;
  const X_GAP = 100;
  const Y_GAP = 30;

  // Deterministic seeded "jitter" for organic feel
  function seededRandom(seed) {
    let x = Math.sin(seed * 9301 + 49297) * 49297;
    return x - Math.floor(x);
  }

  // Find tallest column to center everything against
  let maxColHeight = 0;
  for (let d = 0; d <= maxDepth; d++) {
    const count = (layers.get(d) || []).length;
    const h = count * NODE_H + (count - 1) * Y_GAP;
    if (h > maxColHeight) maxColHeight = h;
  }

  const nodes = [];

  // ── HIVE node (START) — left of first column ──
  const rootCount = (layers.get(0) || []).length;
  const rootColH = rootCount * NODE_H + (rootCount - 1) * Y_GAP;
  const rootOffY = (maxColHeight - rootColH) / 2;
  nodes.push({
    id: '__start__',
    type: 'bookend',
    position: { x: -X_GAP - 50, y: maxColHeight / 2 - 50 },
    data: { label: 'HIVE', variant: 'start' },
    selectable: false,
  });

  // ── Place task nodes column by column ──
  for (let depth = 0; depth <= maxDepth; depth++) {
    const ids = layers.get(depth) || [];
    const count = ids.length;
    const colHeight = count * NODE_H + (count - 1) * Y_GAP;
    const offsetY = (maxColHeight - colHeight) / 2;
    const x = depth * (NODE_W + X_GAP);

    ids.forEach((id, i) => {
      const task = tasks.find(t => t.id === id);
      const baseY = offsetY + i * (NODE_H + Y_GAP);

      // Subtle organic jitter
      const jX = (seededRandom(i * 7 + depth * 13) - 0.5) * 16;
      const jY = (seededRandom(i * 11 + depth * 17) - 0.5) * 10;

      nodes.push({
        id,
        type: task.type === 'prompt' ? 'prompt' : 'agent',
        position: { x: x + jX, y: baseY + jY },
        data: {
          label: task.label,
          taskId: task.id,
          description: task.description,
          status: task.type === 'prompt' ? 'prompt' : 'pending',
          prompt: task.prompt || null,
          wave: depth,
          totalWaves: maxDepth + 1,
        },
      });
    });
  }

  // ── END node — right of last column ──
  nodes.push({
    id: '__end__',
    type: 'bookend',
    position: { x: (maxDepth + 1) * (NODE_W + X_GAP) + X_GAP / 2, y: maxColHeight / 2 - 25 },
    data: { label: 'DONE', variant: 'end' },
    selectable: false,
  });

  // ── Build edges ──
  const rootTasks = tasks
    .filter(t => !t.dependencies || t.dependencies.length === 0)
    .map(t => t.id);
  const depTargets = new Set(tasks.flatMap(t => t.dependencies || []));
  const leafTasks = tasks.filter(t => !depTargets.has(t.id)).map(t => t.id);

  const flowEdges = edgeList.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'default',
    animated: false,
    style: { stroke: 'rgba(74, 158, 255, 0.18)', strokeWidth: 1.5 },
  }));

  for (const rootId of rootTasks) {
    flowEdges.push({
      id: `__start__->${rootId}`,
      source: '__start__',
      target: rootId,
      type: 'default',
      animated: false,
      style: { stroke: 'rgba(245, 197, 66, 0.3)', strokeWidth: 2 },
    });
  }

  for (const leafId of leafTasks) {
    flowEdges.push({
      id: `${leafId}->__end__`,
      source: leafId,
      target: '__end__',
      type: 'default',
      animated: false,
      style: { stroke: 'rgba(138, 138, 245, 0.25)', strokeWidth: 1.5 },
    });
  }

  return { nodes, edges: flowEdges };
}
