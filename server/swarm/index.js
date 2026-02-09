import config from '../config.js';
import LocalRunner from './localRunner.js';
import DockerRunner from './dockerRunner.js';
import SSHRunner from './sshRunner.js';

export { default as LocalRunner } from './localRunner.js';
export { default as DockerRunner } from './dockerRunner.js';
export { default as SSHRunner } from './sshRunner.js';

const RUNNER_TYPES = {
  local: LocalRunner,
  docker: DockerRunner,
  ssh: SSHRunner,
};

/**
 * SwarmManager — distributes agent work across a pool of runners.
 */
export default class SwarmManager {
  constructor() {
    /** @type {Array<LocalRunner|DockerRunner|SSHRunner>} */
    this.runners = [];
  }

  /**
   * Register a runner in the pool.
   * @param {LocalRunner|DockerRunner|SSHRunner} runner
   */
  addRunner(runner) {
    this.runners.push(runner);
  }

  /** Sum of all runner capacities. */
  totalCapacity() {
    return this.runners.reduce((sum, r) => sum + r.capacity(), 0);
  }

  /**
   * Get the runner with the most available capacity.
   * @returns {LocalRunner|DockerRunner|SSHRunner|null}
   */
  getAvailableRunner() {
    let best = null;
    let bestCap = 0;
    for (const runner of this.runners) {
      const cap = runner.capacity();
      if (cap > bestCap) {
        bestCap = cap;
        best = runner;
      }
    }
    return best;
  }

  /** Descriptive summary for logging. */
  describe() {
    return this.runners.map(r => `${r.type}(cap=${r.capacity()})`).join(', ');
  }
}

/**
 * Factory: create a SwarmManager from config.
 * Always includes a local runner. Adds docker/ssh runners when configured.
 *
 * @param {object} [swarmConfig] — config.swarm override
 * @returns {SwarmManager}
 */
export function createSwarm(swarmConfig) {
  const cfg = swarmConfig || config.swarm || {};
  const swarm = new SwarmManager();

  // Always include a local runner
  swarm.addRunner(new LocalRunner({ maxSlots: config.maxConcurrency }));

  // Add configured remote runners
  if (cfg.runners && Array.isArray(cfg.runners)) {
    for (const entry of cfg.runners) {
      const RunnerClass = RUNNER_TYPES[entry.type];
      if (!RunnerClass) {
        console.warn(`[swarm] Unknown runner type: "${entry.type}" — skipping`);
        continue;
      }
      if (entry.type === 'local') continue; // already added
      try {
        swarm.addRunner(new RunnerClass(entry));
      } catch (err) {
        console.warn(`[swarm] Failed to create ${entry.type} runner: ${err.message}`);
      }
    }
  }

  console.log(`[swarm] Pool: ${swarm.describe()} — total capacity: ${swarm.totalCapacity()}`);
  return swarm;
}
