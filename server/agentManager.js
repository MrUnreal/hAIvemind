import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import config, { getModelForRetry } from './config.js';
import { withTimeout } from './processTimeout.js';
import { MSG, makeMsg } from '../shared/protocol.js';
import { spawnMockAgent } from './mock.js';
import { getBackend } from './backends/index.js';
import { createSwarm } from './swarm/index.js';

import { summarizeOutput } from './outputSummarizer.js';

/**
 * @property {string} id
 * @property {string} taskId
 * @property {string} modelTier
 * @property {string} model
 * @property {'pending'|'running'|'success'|'failed'|'blocked'} status
 * @property {number} retries
 * @property {string} prompt
 * @property {string} cliCommand
 * @property {string[]} output
 * @property {object|null} failureReport
 * @property {number} startedAt
 * @property {number|null} finishedAt
 * @property {import('node:child_process').ChildProcess|null} process
 */

export default class AgentManager {
  /**
   * @param {(msg: string) => void} broadcast
   * @param {boolean} [demo=false]
   * @param {object} [opts]
   * @param {object} [opts.skills] - Persistent skills for this project
   * @param {object} [opts.overrides] - Per-project escalation/model overrides
   * @param {object} [opts.workspaceAnalysis] - Workspace analysis for context injection
   */
  constructor(broadcast, demo = false, opts = {}) {
    this.broadcast = broadcast;
    this.demo = demo;
    this.skills = opts.skills || null;
    this.overrides = opts.overrides || null;
    this.workspaceAnalysis = opts.workspaceAnalysis || null;
    this.costCeiling = opts.overrides?.costCeiling ?? null;
    this.backendName = opts.backend || config.defaultBackend || 'copilot';
    /** @type {Map<string, Agent>} */
    this.agents = new Map();

    // Multi-Workspace Swarm: create swarm manager when enabled
    this.swarm = config.swarm?.enabled ? createSwarm(config.swarm) : null;
  }

  /**
   * Spawn an agent for a task.
   * @param {object} task - The task object { id, label, description }
   * @param {number} retryIndex - Current retry number (determines model tier)
   * @param {string} workDir - Working directory
   * @param {string} [extraContext] - Additional context (e.g. failure reports)
   * @returns {Promise<Agent>}
   */
  spawn(task, retryIndex, workDir, extraContext = '') {
    const { tierName, modelName, modelConfig } = getModelForRetry(retryIndex, this.overrides, task.label);

    // Phase 4: Cost ceiling enforcement
    if (this.costCeiling != null) {
      let cumulativeCost = 0;
      for (const a of this.agents.values()) cumulativeCost += a.multiplier;
      const projected = cumulativeCost + modelConfig.multiplier;
      // Warn at 80% of ceiling
      if (projected >= this.costCeiling * 0.8 && projected < this.costCeiling) {
        this.broadcast(makeMsg(MSG.SESSION_WARNING, {
          type: 'cost-ceiling',
          message: `Cost approaching ceiling: ${projected}× of ${this.costCeiling}× limit`,
          current: projected,
          ceiling: this.costCeiling,
        }));
      }
      // Block if would exceed ceiling
      if (projected > this.costCeiling) {
        console.warn(`[agent] Cost ceiling exceeded: ${projected}× > ${this.costCeiling}× — blocking agent for "${task.label}"`);
        const agent = {
          id: randomUUID(),
          taskId: task.id,
          taskLabel: task.label,
          modelTier: tierName,
          model: modelName,
          multiplier: 0,
          status: 'failed',
          retries: retryIndex,
          reason: `[cost-ceiling] Would exceed limit (${projected}× > ${this.costCeiling}×)`,
          prompt: '',
          cliCommand: '',
          output: [`[cost-ceiling] Agent blocked — would push total to ${projected}× (limit: ${this.costCeiling}×)`],
          failureReport: null,
          startedAt: Date.now(),
          finishedAt: Date.now(),
          process: null,
        };
        this.agents.set(agent.id, agent);
        this.broadcast(makeMsg(MSG.AGENT_STATUS, {
          agentId: agent.id, taskId: task.id, taskLabel: task.label,
          status: 'failed', model: modelName, modelTier: tierName,
          multiplier: 0, retries: retryIndex, reason: agent.reason,
        }));
        return Promise.resolve(agent);
      }
    }

    // Build human-readable escalation reason
    const reason = this._buildEscalationReason(retryIndex, tierName, modelName);

    const prompt = this._buildPrompt(task, extraContext);
    // cliCommand is set by the backend; initialize with a placeholder
    const cliCommand = `[${this.backendName}] ${modelName} → "${task.label}"`;

    const agent = {
      id: randomUUID(),
      taskId: task.id,
      taskLabel: task.label,
      modelTier: tierName,
      model: modelName,
      multiplier: modelConfig.multiplier,
      status: 'running',
      retries: retryIndex,
      reason,
      prompt,
      cliCommand,
      output: [],
      failureReport: null,
      startedAt: Date.now(),
      finishedAt: null,
      process: null,
    };

    this.agents.set(agent.id, agent);

    this.broadcast(makeMsg(MSG.AGENT_STATUS, {
      agentId: agent.id,
      taskId: task.id,
      taskLabel: task.label,
      status: 'running',
      model: modelName,
      modelTier: tierName,
      multiplier: modelConfig.multiplier,
      retries: retryIndex,
      reason,
    }));

    return new Promise((resolve) => {
      console.log(`[agent:${agent.id.slice(0, 8)}] Spawning ${modelName} (${tierName}, ${modelConfig.multiplier}×) for task "${task.label}"`);
      console.log(`[agent:${agent.id.slice(0, 8)}] CMD: ${cliCommand.slice(0, 120)}...`);

      // Swarm path: delegate to a remote runner if swarm is enabled and has capacity
      if (this.swarm && !this.demo) {
        const runner = this.swarm.getAvailableRunner();
        if (runner) {
          console.log(`[agent:${agent.id.slice(0, 8)}] Delegating to swarm runner: ${runner.constructor.name}`);
          return runner.spawn(task, retryIndex, workDir, extraContext, this)
            .then((swarmAgent) => resolve(swarmAgent))
            .catch((err) => {
              console.warn(`[agent:${agent.id.slice(0, 8)}] Swarm runner failed, falling back to local: ${err.message}`);
              this._spawnChild(agent, task, retryIndex, workDir, extraContext, modelName, tierName, modelConfig, prompt, resolve);
            });
        }
      }

      this._spawnChild(agent, task, retryIndex, workDir, extraContext, modelName, tierName, modelConfig, prompt, resolve);
    });
  }

  /**
   * Spawn a child process locally and wire up its I/O to the agent.
   * @private
   */
  _spawnChild(agent, task, retryIndex, workDir, extraContext, modelName, tierName, modelConfig, prompt, resolve) {
    let child;
    if (this.demo) {
      child = spawnMockAgent(task, modelName, tierName);
    } else {
      const backend = getBackend(this.backendName, config.backends?.[this.backendName] || {});
      const spawned = backend.spawn(prompt, workDir, { model: modelName, modelConfig });
      child = spawned.process;
      agent.cliCommand = spawned.cliCommand;
    }

    this.attachProcess(agent, child, task, modelName, tierName, modelConfig, retryIndex).then(resolve);
  }

  /**
   * Spawn an agent locally (used by swarm LocalRunner).
   * Same as spawn() but always local — never delegates to swarm.
   * @param {object} task
   * @param {number} retryIndex
   * @param {string} workDir
   * @param {string} [extraContext]
   * @returns {Promise<Agent>}
   */
  spawnLocal(task, retryIndex, workDir, extraContext = '') {
    const { tierName, modelName, modelConfig } = getModelForRetry(retryIndex, this.overrides, task.label);
    const reason = this._buildEscalationReason(retryIndex, tierName, modelName);
    const prompt = this._buildPrompt(task, extraContext);
    const agent = this.prepareAgent(task, retryIndex, modelName, tierName, modelConfig, reason, prompt);

    return new Promise((resolve) => {
      this._spawnChild(agent, task, retryIndex, workDir, extraContext, modelName, tierName, modelConfig, prompt, resolve);
    });
  }

  /**
   * Create an agent object and broadcast its status WITHOUT spawning a process.
   * Used by swarm runners (Docker/SSH) that manage their own processes.
   *
   * Overloaded signatures:
   *   prepareAgent(task, retryIndex, workDir, extraContext) — resolves model internally
   *   prepareAgent(task, retryIndex, modelName, tierName, modelConfig, reason, prompt) — explicit model
   *
   * @returns {Agent}
   */
  prepareAgent(task, retryIndex, arg3, arg4, arg5, arg6, arg7) {
    let modelName, tierName, modelConfig, reason, prompt;

    if (typeof arg5 === 'object' && arg5 !== null) {
      // Explicit signature: (task, retryIndex, modelName, tierName, modelConfig, reason, prompt)
      modelName = arg3;
      tierName = arg4;
      modelConfig = arg5;
      reason = arg6;
      prompt = arg7;
    } else {
      // Simple signature: (task, retryIndex, workDir, extraContext)
      const resolved = getModelForRetry(retryIndex, this.overrides, task.label);
      modelName = resolved.modelName;
      tierName = resolved.tierName;
      modelConfig = resolved.modelConfig;
      reason = this._buildEscalationReason(retryIndex, tierName, modelName);
      prompt = this._buildPrompt(task, arg4 || '');
    }
    const agent = {
      id: randomUUID(),
      taskId: task.id,
      taskLabel: task.label,
      modelTier: tierName,
      model: modelName,
      multiplier: modelConfig.multiplier,
      status: 'running',
      retries: retryIndex,
      reason,
      prompt,
      cliCommand: `[swarm] ${modelName} → "${task.label}"`,
      output: [],
      failureReport: null,
      startedAt: Date.now(),
      finishedAt: null,
      process: null,
    };

    this.agents.set(agent.id, agent);

    this.broadcast(makeMsg(MSG.AGENT_STATUS, {
      agentId: agent.id,
      taskId: task.id,
      taskLabel: task.label,
      status: 'running',
      model: modelName,
      modelTier: tierName,
      multiplier: modelConfig.multiplier,
      retries: retryIndex,
      reason,
    }));

    return agent;
  }

  /**
   * Attach a child process's I/O to an agent and return a promise
   * that resolves when the process exits.
   * Used by swarm runners that create their own child processes.
   *
   * Can be called as:
   *   attachProcess(agent, child, task) — pulls model info from agent object
   *   attachProcess(agent, child, task, modelName, tierName, modelConfig, retryIndex) — explicit
   *
   * @param {Agent} agent
   * @param {import('node:child_process').ChildProcess} child
   * @param {object} task
   * @param {string} [modelName]
   * @param {string} [tierName]
   * @param {object} [modelConfig]
   * @param {number} [retryIndex]
   * @returns {Promise<Agent>}
   */
  attachProcess(agent, child, task, modelName, tierName, modelConfig, retryIndex) {
    // Default to agent's stored values if not provided explicitly
    modelName = modelName ?? agent.model;
    tierName = tierName ?? agent.modelTier;
    modelConfig = modelConfig ?? { multiplier: agent.multiplier };
    retryIndex = retryIndex ?? agent.retries;
    agent.process = child;

    return new Promise((resolve) => {
      /** @type {NodeJS.Timeout | null} */
      let timeoutId = null;
      let settled = false;

      const clearAgentTimeout = () => {
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      };

      const onClose = (code) => {
        if (settled) return;
        settled = true;
        clearAgentTimeout();
        agent.finishedAt = Date.now();
        agent.status = code === 0 ? 'success' : 'failed';
        agent.process = null;
        console.log(`[agent:${agent.id.slice(0, 8)}] Exited with code ${code} → ${agent.status}`);
        this.broadcast(makeMsg(MSG.AGENT_STATUS, {
          agentId: agent.id, taskId: task.id, taskLabel: task.label,
          status: agent.status, model: modelName, modelTier: tierName,
          multiplier: modelConfig.multiplier, retries: retryIndex,
          reason: agent.reason,
        }));
        resolve(agent);
      };

      const onError = (err) => {
        if (settled) return;
        settled = true;
        clearAgentTimeout();
        agent.finishedAt = Date.now();
        agent.status = 'failed';
        agent.output.push(`[spawn error] ${err.message}`);
        agent.process = null;
        console.error(`[agent:${agent.id.slice(0, 8)}] Spawn error: ${err.message}`);
        this.broadcast(makeMsg(MSG.AGENT_STATUS, {
          agentId: agent.id, taskId: task.id, taskLabel: task.label,
          status: 'failed', model: modelName, modelTier: tierName,
          multiplier: modelConfig.multiplier, retries: retryIndex,
          reason: agent.reason,
        }));
        resolve(agent);
      };

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        let totalBytes = agent.output.reduce((acc, s) => acc + s.length, 0);
        while (totalBytes + chunk.length > config.maxAgentOutputBytes && agent.output.length > 0) {
          totalBytes -= agent.output.shift().length;
        }
        agent.output.push(chunk);
        this.broadcast(makeMsg(MSG.AGENT_OUTPUT, { agentId: agent.id, chunk, stream: 'stdout' }));
      });

      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        let totalBytes = agent.output.reduce((acc, s) => acc + s.length, 0);
        while (totalBytes + chunk.length > config.maxAgentOutputBytes && agent.output.length > 0) {
          totalBytes -= agent.output.shift().length;
        }
        agent.output.push(chunk);
        this.broadcast(makeMsg(MSG.AGENT_OUTPUT, { agentId: agent.id, chunk, stream: 'stderr' }));
      });

      child.on('close', onClose);
      child.on('error', onError);

      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        const minutes = config.agentTimeoutMs / 60000;
        const timeoutMessage = `Agent timed out after ${minutes} minutes`;
        agent.finishedAt = Date.now();
        agent.status = 'failed';
        agent.output.push(timeoutMessage);
        agent.process = null;
        child.removeAllListeners('close');
        child.removeAllListeners('error');
        try { child.kill('SIGTERM'); } catch { /* already exited */ }
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already exited */ } }, 5000);
        console.warn(`[agent:${agent.id.slice(0, 8)}] ${timeoutMessage}`);
        this.broadcast(makeMsg(MSG.AGENT_STATUS, {
          agentId: agent.id, taskId: task.id, taskLabel: task.label,
          status: 'failed', model: modelName, modelTier: tierName,
          multiplier: modelConfig.multiplier, retries: retryIndex,
          reason: agent.reason,
        }));
        resolve(agent);
      }, config.agentTimeoutMs);
    });
  }

  _buildPrompt(task, extraContext) {
    let prompt = `You are an expert software engineer. Complete the following task:\n\n`;
    prompt += `## Task: ${task.label}\n\n`;
    prompt += `${task.description}\n\n`;
    prompt += `Modify existing files in place when they exist. Only create new files when necessary. Be thorough and complete.\n`;

    if (task.affectedFiles?.length) {
      prompt += `\n## Key Files\nFocus on these files: ${task.affectedFiles.join(', ')}\n`;
    }

    // Phase 2: Inject persistent skills as prior knowledge
    if (this.skills) {
      const skillLines = [];
      if (this.skills.buildCommands?.length) skillLines.push(`Build: ${this.skills.buildCommands.join(', ')}`);
      if (this.skills.testCommands?.length) skillLines.push(`Test: ${this.skills.testCommands.join(', ')}`);
      if (this.skills.lintCommands?.length) skillLines.push(`Lint: ${this.skills.lintCommands.join(', ')}`);
      if (this.skills.deployCommands?.length) skillLines.push(`Deploy: ${this.skills.deployCommands.join(', ')}`);
      if (this.skills.patterns?.length) skillLines.push(`Patterns: ${this.skills.patterns.join('; ')}`);

      if (skillLines.length > 0) {
        prompt += `\n## Project Knowledge (from previous sessions)\n${skillLines.join('\n')}\n`;
      }
    }

    // Phase 4: Inject compact workspace analysis
    if (this.workspaceAnalysis && typeof this.workspaceAnalysis.toPromptContext === 'function') {
      prompt += '\n' + this.workspaceAnalysis.toPromptContext() + '\n';
    }

    if (extraContext) {
      prompt += `\n## Additional Context (from previous failures)\n\n${extraContext}\n`;
    }

    return prompt;
  }

  _buildEscalationReason(retryIndex, tierName, modelName) {
    if (retryIndex === 0) {
      return `First attempt → using ${modelName} (${tierName}, free tier)`;
    }
    const prevTier = config.escalation[Math.min(retryIndex - 1, config.escalation.length - 1)];
    if (tierName === prevTier) {
      return `Retry #${retryIndex} → same tier ${tierName}, using ${modelName}`;
    }
    return `Retry #${retryIndex} → escalated from ${prevTier} to ${tierName}, using ${modelName} (${config.models[modelName].multiplier}× cost)`;
  }

  getAgent(agentId) {
    return this.agents.get(agentId);
  }

  getAgentsByTask(taskId) {
    return [...this.agents.values()].filter(a => a.taskId === taskId);
  }

  /** Get full session data for persistence (tasks → agents → outputs) */
  getSessionSnapshot() {
    const agents = {};
    for (const [id, agent] of this.agents) {
      // Phase 5.1: Generate summary if not already present
      const summary = agent.summary || (agent.output.length > 0 ? summarizeOutput(agent.output) : null);
      agents[id] = {
        id: agent.id,
        taskId: agent.taskId,
        model: agent.model,
        modelTier: agent.modelTier,
        multiplier: agent.multiplier,
        status: agent.status,
        retries: agent.retries,
        reason: agent.reason,
        startedAt: agent.startedAt,
        finishedAt: agent.finishedAt,
        output: agent.output,
        summary, // Phase 5.1: Structured summary alongside raw output
      };
    }
    return agents;
  }

  /** Get cost summary */
  getCostSummary() {
    let totalMultiplier = 0;
    for (const agent of this.agents.values()) {
      totalMultiplier += agent.multiplier;
    }
    return {
      totalAgents: this.agents.size,
      totalPremiumRequests: totalMultiplier,
      byTier: ['T0', 'T1', 'T2', 'T3'].reduce((acc, tier) => {
        const agents = [...this.agents.values()].filter(a => a.modelTier === tier);
        acc[tier] = { count: agents.length, cost: agents.reduce((s, a) => s + a.multiplier, 0) };
        return acc;
      }, {}),
    };
  }

  async killAll() {
    const killPromises = [];
    for (const agent of this.agents.values()) {
      if (agent.process !== null && !agent.process.killed) {
        killPromises.push(new Promise((resolve) => {
          const proc = agent.process;
          const pid = proc.pid;

          // Try graceful SIGTERM first
          try {
            // Kill process group if possible (negative pid)
            if (pid && process.platform !== 'win32') {
              process.kill(-pid, 'SIGTERM');
            } else {
              proc.kill('SIGTERM');
            }
          } catch { /* already exited */ }

          // Force SIGKILL after 3 seconds
          const forceKill = setTimeout(() => {
            try {
              if (pid && process.platform !== 'win32') {
                process.kill(-pid, 'SIGKILL');
              } else {
                proc.kill('SIGKILL');
              }
            } catch { /* already exited */ }
            resolve();
          }, 3000);
          forceKill.unref();

          // Resolve early if process exits on its own
          proc.once('exit', () => {
            clearTimeout(forceKill);
            resolve();
          });

          // Safety timeout
          setTimeout(() => resolve(), 5000).unref();
        }));

        agent.status = 'interrupted';
        agent.finishedAt = Date.now();
      }
    }
    await Promise.allSettled(killPromises);
    return killPromises.length;
  }
}
