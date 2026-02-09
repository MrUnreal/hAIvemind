/**
 * AgentBackend — abstract base class for pluggable agent runtimes.
 *
 * Every backend must implement:
 *   get name()              → string identifier
 *   spawn(prompt, workDir, opts) → { process: ChildProcess, cliCommand: string }
 */
export default class AgentBackend {
  /**
   * @param {object} [backendConfig] — backend-specific settings
   */
  constructor(backendConfig = {}) {
    this.config = backendConfig;
  }

  /** @returns {string} Human-readable backend identifier */
  get name() {
    throw new Error('AgentBackend subclass must implement get name()');
  }

  /**
   * Spawn an agent process.
   * @param {string} prompt   — the full prompt text
   * @param {string} workDir  — working directory for the agent
   * @param {object} opts
   * @param {string} opts.model     — model name from config
   * @param {object} opts.modelConfig — full model config object
   * @param {string[]} [opts.extraArgs] — additional CLI flags
   * @returns {{ process: import('node:child_process').ChildProcess, cliCommand: string }}
   */
  spawn(prompt, workDir, opts) {
    throw new Error('AgentBackend subclass must implement spawn()');
  }
}
