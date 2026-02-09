import { spawn } from 'node:child_process';

/**
 * DockerRunner — spawns agents inside Docker containers.
 *
 * Command pattern:
 *   docker run --rm -v <workDir>:/workspace -w /workspace <image> <agentCmd>
 *
 * The agent command itself is built by the backend (copilot, ollama, etc.),
 * but DockerRunner wraps it in a container invocation.
 */
export default class DockerRunner {
  /**
   * @param {object} opts
   * @param {string} opts.image         — Docker image (e.g. 'haivemind/agent:latest')
   * @param {number} [opts.maxContainers=2] — max simultaneous containers
   * @param {string} [opts.dockerHost]  — DOCKER_HOST env override
   * @param {string} [opts.network]     — Docker network to attach to
   */
  constructor(opts = {}) {
    this.type = 'docker';
    this.image = opts.image || 'haivemind/agent:latest';
    this.maxContainers = opts.maxContainers ?? 2;
    this.dockerHost = opts.dockerHost || null;
    this.network = opts.network || null;
    this.running = 0;
  }

  /** Available container slots. */
  capacity() {
    return Math.max(0, this.maxContainers - this.running);
  }

  /**
   * Spawn an agent inside a Docker container.
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
      // Build the agent command that would normally run locally
      const agent = agentManager.prepareAgent(task, retryIndex, workDir, extraContext);

      const dockerArgs = [
        'run', '--rm',
        '-v', `${workDir}:/workspace`,
        '-w', '/workspace',
      ];
      if (this.network) {
        dockerArgs.push('--network', this.network);
      }
      dockerArgs.push(this.image);
      // Pass the agent's CLI command as the container entrypoint args
      dockerArgs.push('sh', '-c', agent.cliCommand);

      const cliCommand = `docker ${dockerArgs.join(' ')}`;
      agent.cliCommand = cliCommand;

      const env = { ...process.env };
      if (this.dockerHost) {
        env.DOCKER_HOST = this.dockerHost;
      }

      const child = spawn('docker', dockerArgs, { cwd: workDir, env });
      return await agentManager.attachProcess(agent, child, task);
    } finally {
      this.running--;
    }
  }
}
