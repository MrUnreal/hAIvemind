import { spawn } from 'node:child_process';
import AgentBackend from './base.js';

/**
 * CopilotBackend — spawns agents via GitHub Copilot CLI.
 *
 * Command pattern:
 *   copilot --model <model> --prompt "<text>" --allow-all --add-dir <workDir>
 */
export default class CopilotBackend extends AgentBackend {
  get name() {
    return 'copilot';
  }

  /**
   * @param {string} prompt
   * @param {string} workDir
   * @param {object} opts
   * @param {string} opts.model
   * @param {object} opts.modelConfig — { cmd, args, multiplier, tier }
   * @returns {{ process: import('node:child_process').ChildProcess, cliCommand: string }}
   */
  spawn(prompt, workDir, opts) {
    const { modelConfig } = opts;
    const fullArgs = [
      ...modelConfig.args,
      prompt,
      '--allow-all',
      '--add-dir', workDir,
    ];
    const cliCommand = `${modelConfig.cmd} ${fullArgs.map(a => `"${a}"`).join(' ')}`;

    const child = spawn(modelConfig.cmd, fullArgs, {
      cwd: workDir,
      env: { ...process.env },
    });

    return { process: child, cliCommand };
  }
}
