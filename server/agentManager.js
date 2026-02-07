import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import config, { getModelForRetry } from './config.js';
import { MSG, makeMsg } from '../shared/protocol.js';
import { spawnMockAgent } from './mock.js';

/**
 * @typedef {Object} Agent
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
  /** @param {(msg: string) => void} broadcast
   *  @param {boolean} [demo=false]
   */
  constructor(broadcast, demo = false) {
    this.broadcast = broadcast;
    this.demo = demo;
    /** @type {Map<string, Agent>} */
    this.agents = new Map();
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
    const { tierName, modelName, modelConfig } = getModelForRetry(retryIndex);

    // Build human-readable escalation reason
    const reason = this._buildEscalationReason(retryIndex, tierName, modelName);

    const prompt = this._buildPrompt(task, extraContext);
    // Build copilot CLI args: --model X --prompt "text" --allow-all --add-dir <workDir>
    const fullArgs = [
      ...modelConfig.args,
      prompt,
      '--allow-all',
      '--add-dir', workDir,
    ];
    const cliCommand = `${modelConfig.cmd} ${fullArgs.map(a => `"${a}"`).join(' ')}`;

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

      const child = this.demo
        ? spawnMockAgent(task, modelName, tierName)
        : spawn(modelConfig.cmd, fullArgs, {
            cwd: workDir,
            env: { ...process.env },
          });

      agent.process = child;

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        agent.output.push(chunk);
        this.broadcast(makeMsg(MSG.AGENT_OUTPUT, {
          agentId: agent.id,
          chunk,
          stream: 'stdout',
        }));
      });

      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        agent.output.push(chunk);
        this.broadcast(makeMsg(MSG.AGENT_OUTPUT, {
          agentId: agent.id,
          chunk,
          stream: 'stderr',
        }));
      });

      child.on('close', (code) => {
        agent.finishedAt = Date.now();
        agent.status = code === 0 ? 'success' : 'failed';
        agent.process = null;

        console.log(`[agent:${agent.id.slice(0, 8)}] Exited with code ${code} → ${agent.status}`);

        this.broadcast(makeMsg(MSG.AGENT_STATUS, {
          agentId: agent.id,
          taskId: task.id,
          taskLabel: task.label,
          status: agent.status,
          model: modelName,
          modelTier: tierName,
          multiplier: modelConfig.multiplier,
          retries: retryIndex,
          reason,
        }));

        resolve(agent);
      });

      child.on('error', (err) => {
        agent.finishedAt = Date.now();
        agent.status = 'failed';
        agent.output.push(`[spawn error] ${err.message}`);
        agent.process = null;

        console.error(`[agent:${agent.id.slice(0, 8)}] Spawn error: ${err.message}`);

        this.broadcast(makeMsg(MSG.AGENT_STATUS, {
          agentId: agent.id,
          taskId: task.id,
          taskLabel: task.label,
          status: 'failed',
          model: modelName,
          modelTier: tierName,
          multiplier: modelConfig.multiplier,
          retries: retryIndex,
          reason,
        }));

        resolve(agent);
      });
    });
  }

  _buildPrompt(task, extraContext) {
    let prompt = `You are an expert software engineer. Complete the following task:\n\n`;
    prompt += `## Task: ${task.label}\n\n`;
    prompt += `${task.description}\n\n`;
    prompt += `Create or modify files as needed. Be thorough and complete.\n`;

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
}
