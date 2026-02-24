/**
 * Hivemind radial layout — places nodes in concentric rings radiating
 * outward from a central "hive" node, creating an organic web-like feel.
 *
 * Wave 0 (roots) sits closest to center, later waves expand outward.
 * Nodes within each ring are distributed with slight jitter for organic feel.
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

  // ── Radial positioning ──
  const CX = 0;
  const CY = 0;
  const BASE_RADIUS = 250;
  const RING_GAP = 220;

  // Deterministic seeded "jitter" for organic feel
  function seededRandom(seed) {
    let x = Math.sin(seed * 9301 + 49297) * 49297;
    return x - Math.floor(x);
  }

  const nodes = [];

  // Central hive node
  nodes.push({
    id: '__start__',
    type: 'bookend',
    position: { x: CX - 50, y: CY - 50 },
    data: { label: 'HIVE', variant: 'start' },
    selectable: false,
  });

  // Place task nodes in concentric rings
  for (let depth = 0; depth <= maxDepth; depth++) {
    const ids = layers.get(depth) || [];
    const count = ids.length;
    const radius = BASE_RADIUS + depth * RING_GAP;

    // Golden-ratio angular offset per layer
    const baseAngle = (depth * 0.618033988749895 * Math.PI * 2) % (Math.PI * 2);
    const useArc = count > 6;
    const arcSpan = useArc
      ? Math.min(Math.PI * 1.7, (Math.PI * 2 / Math.max(count, 1)) * count * 1.1)
      : Math.PI * 2;
    const arcStart = useArc ? -arcSpan / 2 + baseAngle : baseAngle;
    const step = count > 1 ? arcSpan / count : 0;

    ids.forEach((id, i) => {
      const task = tasks.find(t => t.id === id);
      const angle = count === 1 ? baseAngle : arcStart + (i + 0.5) * step;

      // Organic jitter
      const jitterR = (seededRandom(i * 7 + depth * 13) - 0.5) * 40;
      const jitterA = (seededRandom(i * 11 + depth * 17) - 0.5) * 0.07;

      const x = CX + (radius + jitterR) * Math.cos(angle + jitterA) - 120;
      const y = CY + (radius + jitterR) * Math.sin(angle + jitterA) - 45;

      nodes.push({
        id,
        type: task.type === 'prompt' ? 'prompt' : 'agent',
        position: { x, y },
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

  // END node
  const endRadius = BASE_RADIUS + (maxDepth + 1) * RING_GAP;
  nodes.push({
    id: '__end__',
    type: 'bookend',
    position: { x: CX + endRadius - 50, y: CY - 25 },
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
