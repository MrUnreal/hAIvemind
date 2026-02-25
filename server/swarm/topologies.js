/**
 * server/swarm/topologies.js — Phase 16.0: Swarm Topologies
 *
 * Defines how agents are organized and communicate within a swarm.
 * Topologies: flat (existing), hierarchical, ring, star, mesh.
 *
 * Each topology manages task distribution and result aggregation.
 */

// ─── Topology Interface ──────────────────────────────────────────────
/**
 * @typedef {Object} TopologyConfig
 * @property {'flat'|'hierarchical'|'ring'|'star'|'mesh'} type
 * @property {number} [maxAgentsPerGroup=4]
 * @property {boolean} [enableConsensus=false]
 */

/**
 * Base class for swarm topologies.
 */
export class BaseTopology {
  constructor(config = {}) {
    this.type = 'base';
    this.config = config;
    /** @type {Array<{ id: string, role: string, tasks: string[] }>} */
    this.agents = [];
  }

  get name() { return this.type; }

  /**
   * Assign tasks to agents based on topology rules.
   * @param {Array} tasks — tasks to assign
   * @param {Array} runners — available runners
   * @returns {Array<{ task: object, runner: object, group?: string }>}
   */
  assign(tasks, runners) {
    throw new Error('Subclass must implement assign()');
  }

  /**
   * Get the communication pattern for this topology.
   * Returns which agents can communicate with which.
   * @returns {Array<{ from: string, to: string }>}
   */
  getCommunicationLinks() {
    return [];
  }
}

/**
 * Flat topology — all agents are equal, round-robin task assignment.
 * This is the existing behavior.
 */
export class FlatTopology extends BaseTopology {
  constructor(config) {
    super(config);
    this.type = 'flat';
  }

  assign(tasks, runners) {
    return tasks.map((task, i) => ({
      task,
      runner: runners[i % runners.length],
      group: 'default',
    }));
  }

  getCommunicationLinks() {
    // Flat: no inter-agent communication
    return [];
  }
}

/**
 * Hierarchical topology — one lead agent delegates to worker agents.
 * The lead handles planning, workers handle implementation.
 */
export class HierarchicalTopology extends BaseTopology {
  constructor(config) {
    super(config);
    this.type = 'hierarchical';
    this.maxWorkersPerLead = config.maxAgentsPerGroup || 4;
  }

  assign(tasks, runners) {
    if (runners.length < 2) return new FlatTopology(this.config).assign(tasks, runners);

    const lead = runners[0];
    const workers = runners.slice(1);
    const assignments = [];

    // Assign planning/verification tasks to leader
    const planningTasks = tasks.filter(t =>
      /\b(plan|verify|review|coordinate|orchestrat)\b/i.test(t.label)
    );
    const workerTasks = tasks.filter(t => !planningTasks.includes(t));

    for (const task of planningTasks) {
      assignments.push({ task, runner: lead, group: 'lead', role: 'leader' });
    }

    // Distribute worker tasks across workers
    for (let i = 0; i < workerTasks.length; i++) {
      const worker = workers[i % workers.length];
      assignments.push({ task: workerTasks[i], runner: worker, group: `worker-${i % workers.length}`, role: 'worker' });
    }

    return assignments;
  }

  getCommunicationLinks() {
    // Star pattern: lead ↔ each worker
    const links = [];
    for (let i = 1; i < this.agents.length; i++) {
      links.push({ from: this.agents[0]?.id, to: this.agents[i]?.id });
      links.push({ from: this.agents[i]?.id, to: this.agents[0]?.id });
    }
    return links;
  }
}

/**
 * Star topology — one central coordinator, all agents report to it.
 * Similar to hierarchical but the coordinator doesn't do work itself.
 */
export class StarTopology extends BaseTopology {
  constructor(config) {
    super(config);
    this.type = 'star';
  }

  assign(tasks, runners) {
    if (runners.length < 2) return new FlatTopology(this.config).assign(tasks, runners);

    // First runner is coordinator (doesn't get tasks)
    const workers = runners.slice(1);
    return tasks.map((task, i) => ({
      task,
      runner: workers[i % workers.length],
      group: 'star',
      coordinator: runners[0],
    }));
  }
}

/**
 * Ring topology — agents pass results to their neighbor in a ring.
 * Good for pipeline-style processing.
 */
export class RingTopology extends BaseTopology {
  constructor(config) {
    super(config);
    this.type = 'ring';
  }

  assign(tasks, runners) {
    // Assign sequentially around the ring
    return tasks.map((task, i) => ({
      task,
      runner: runners[i % runners.length],
      group: 'ring',
      predecessor: runners[(i - 1 + runners.length) % runners.length],
      successor: runners[(i + 1) % runners.length],
    }));
  }

  getCommunicationLinks() {
    const links = [];
    for (let i = 0; i < this.agents.length; i++) {
      const next = (i + 1) % this.agents.length;
      links.push({ from: this.agents[i]?.id, to: this.agents[next]?.id });
    }
    return links;
  }
}

/**
 * Mesh topology — every agent can communicate with every other agent.
 * Maximum flexibility, higher overhead.
 */
export class MeshTopology extends BaseTopology {
  constructor(config) {
    super(config);
    this.type = 'mesh';
  }

  assign(tasks, runners) {
    // Round-robin like flat, but with full communication
    return tasks.map((task, i) => ({
      task,
      runner: runners[i % runners.length],
      group: 'mesh',
    }));
  }

  getCommunicationLinks() {
    const links = [];
    for (let i = 0; i < this.agents.length; i++) {
      for (let j = i + 1; j < this.agents.length; j++) {
        links.push({ from: this.agents[i]?.id, to: this.agents[j]?.id });
        links.push({ from: this.agents[j]?.id, to: this.agents[i]?.id });
      }
    }
    return links;
  }
}

// ─── Topology Factory ────────────────────────────────────────────────
const TOPOLOGIES = {
  flat: FlatTopology,
  hierarchical: HierarchicalTopology,
  star: StarTopology,
  ring: RingTopology,
  mesh: MeshTopology,
};

/**
 * Create a topology instance.
 * @param {string} type
 * @param {object} [config]
 * @returns {BaseTopology}
 */
export function createTopology(type = 'flat', config = {}) {
  const TopologyClass = TOPOLOGIES[type] || FlatTopology;
  return new TopologyClass(config);
}

/**
 * List available topology types.
 * @returns {string[]}
 */
export function listTopologies() {
  return Object.keys(TOPOLOGIES);
}
