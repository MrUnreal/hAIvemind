import config from '../config.js';

/**
 * LocalRunner — runs agents as local child processes.
 * Wraps the existing AgentManager.spawn() behaviour.
 */
export default class LocalRunner {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxSlots] — override maxConcurrency
   */
  constructor(opts = {}) {
    this.type = 'local';
    this.maxSlots = opts.maxSlots ?? config.maxConcurrency;
    this.running = 0;
  }

  /** Available local execution slots. */
  capacity() {
    return Math.max(0, this.maxSlots - this.running);
  }

  /**
   * Spawn an agent locally (delegates to agentManager.spawn).
   * The AgentManager calls runner.spawn() and we simply track counts.
   * Actual process creation is still handled by AgentManager + backend.
   *
   * @param {object} task
   * @param {number} retryIndex
   * @param {string} workDir
   * @param {string} extraContext
   * @param {import('../agentManager.js').default} agentManager
   * @returns {Promise<import('../agentManager.js').Agent>}
   */
  async spawn(task, retryIndex, workDir, extraContext, agentManager) {
    this.running++;
    try {
      return await agentManager.spawnLocal(task, retryIndex, workDir, extraContext);
    } finally {
      this.running--;
    }
  }
}
