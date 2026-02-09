import { spawn } from 'node:child_process';

/**
 * SSHRunner — spawns agents on remote machines via SSH.
 *
 * Workflow:
 *   1. rsync workDir → remote:remoteWorkDir  (before spawn)
 *   2. ssh user@host "cd <remoteWorkDir> && <agentCmd>"
 *   3. rsync remote:remoteWorkDir → workDir   (after spawn)
 */
export default class SSHRunner {
  /**
   * @param {object} opts
   * @param {string} opts.host           — remote hostname / IP
   * @param {string} [opts.user='root']  — SSH user
   * @param {string} [opts.keyPath]      — path to SSH private key
   * @param {number} [opts.maxSlots=2]   — max simultaneous remote agents
   * @param {string} [opts.remoteWorkDir='/tmp/haivemind'] — remote working directory
   */
  constructor(opts = {}) {
    this.type = 'ssh';
    this.host = opts.host;
    this.user = opts.user || 'root';
    this.keyPath = opts.keyPath || null;
    this.maxSlots = opts.maxSlots ?? 2;
    this.remoteWorkDir = opts.remoteWorkDir || '/tmp/haivemind';
    this.running = 0;

    if (!this.host) throw new Error('SSHRunner requires opts.host');
  }

  /** Available remote slots. */
  capacity() {
    return Math.max(0, this.maxSlots - this.running);
  }

  /**
   * Sync local workDir to remote, run agent via SSH, sync back.
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
      const agent = agentManager.prepareAgent(task, retryIndex, workDir, extraContext);

      // Sync local → remote
      await this._rsync(workDir, `${this.user}@${this.host}:${this.remoteWorkDir}`);

      // Build SSH command
      const sshArgs = this._sshArgs();
      sshArgs.push(`${this.user}@${this.host}`);
      sshArgs.push(`cd ${this.remoteWorkDir} && ${agent.cliCommand}`);

      const cliCommand = `ssh ${sshArgs.join(' ')}`;
      agent.cliCommand = cliCommand;

      const child = spawn('ssh', sshArgs, { cwd: workDir, env: { ...process.env } });
      const result = await agentManager.attachProcess(agent, child, task);

      // Sync remote → local (pull results back)
      await this._rsync(`${this.user}@${this.host}:${this.remoteWorkDir}/`, workDir);

      return result;
    } finally {
      this.running--;
    }
  }

  /** @private Build common SSH args (key, strict host checking off for automation) */
  _sshArgs() {
    const args = ['-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes'];
    if (this.keyPath) args.push('-i', this.keyPath);
    return args;
  }

  /**
   * @private Run rsync between source and destination.
   * @returns {Promise<void>}
   */
  _rsync(src, dest) {
    return new Promise((resolve, reject) => {
      const args = ['-azq', '--delete'];
      if (this.keyPath) {
        args.push('-e', `ssh -i ${this.keyPath} -o StrictHostKeyChecking=no`);
      }
      args.push(src.endsWith('/') ? src : `${src}/`, dest);

      const proc = spawn('rsync', args, { stdio: 'pipe' });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`rsync exited with code ${code}`));
      });
      proc.on('error', reject);
    });
  }
}
