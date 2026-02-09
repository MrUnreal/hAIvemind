import { spawn } from 'node:child_process';
import AgentBackend from './base.js';

/**
 * OllamaBackend — spawns agents via Ollama CLI for local LLM inference.
 *
 * Command pattern:
 *   ollama run <model> "<prompt>"
 *
 * Config options:
 *   host  — Ollama server URL (default: http://localhost:11434)
 *   model — override model name (falls back to opts.model)
 */
export default class OllamaBackend extends AgentBackend {
  get name() {
    return 'ollama';
  }

  /**
   * @param {string} prompt
   * @param {string} workDir
   * @param {object} opts
   * @param {string} opts.model — model name
   * @returns {{ process: import('node:child_process').ChildProcess, cliCommand: string }}
   */
  spawn(prompt, workDir, opts) {
    const model = this.config.model || opts.model || 'codellama';
    const cmd = 'ollama';
    const args = ['run', model, prompt];
    const cliCommand = `${cmd} run ${model} "<prompt>"`;

    const env = { ...process.env };
    if (this.config.host) {
      env.OLLAMA_HOST = this.config.host;
    }

    const child = spawn(cmd, args, {
      cwd: workDir,
      env,
    });

    return { process: child, cliCommand };
  }
}
