import config from './config.js';
import { MSG, makeMsg } from '../shared/protocol.js';

/**
 * TaskRunner manages the DAG execution of tasks with dependency resolution,
 * retry logic, and model tier escalation.
 */
export default class TaskRunner {
  /**
   * @param {object} plan - { tasks: [{ id, label, description, dependencies }] }
   * @param {import('./agentManager.js').default} agentManager
   * @param {(msg: string) => void} broadcast
   * @param {string} workDir
   */
  constructor(plan, agentManager, broadcast, workDir) {
    this.plan = plan;
    this.agentManager = agentManager;
    this.broadcast = broadcast;
    this.workDir = workDir;

    /** @type {Map<string, TaskState>} */
    this.taskStates = new Map();
    this.running = 0;

    // Initialize task states
    for (const task of plan.tasks) {
      this.taskStates.set(task.id, {
        task,
        status: 'pending',
        retries: 0,
        agentIds: [],
        failureReports: [],
        startedAt: null,
        completedAt: null,
      });
    }
  }

  /**
   * Start executing all eligible tasks.
   */
  async run() {
    console.log(`[taskRunner] Starting execution of ${this.plan.tasks.length} tasks`);
    await this._scheduleEligible();
  }

  /**
   * Find and launch tasks whose dependencies are all met.
   */
  async _scheduleEligible() {
    const eligible = [];

    for (const [taskId, state] of this.taskStates) {
      if (state.status !== 'pending') continue;
      if (this.running >= config.maxConcurrency) break;

      const depsOk = state.task.dependencies.every(depId => {
        const depState = this.taskStates.get(depId);
        return depState && depState.status === 'success';
      });

      if (depsOk) {
        eligible.push(state);
      }
    }

    const launches = eligible.map(state => this._launchTask(state));
    await Promise.allSettled(launches);
  }

  /**
   * Launch a single task.
   */
  async _launchTask(state) {
    state.status = 'running';
    state.startedAt = Date.now();
    this.running++;
    this._broadcastTaskStatus(state);

    // Build extra context from failure reports
    const extraContext = state.failureReports
      .map(r => `Previous failure: ${r.summary}\nSuggested fix: ${r.suggestedFix}`)
      .join('\n\n');

    const agent = await this.agentManager.spawn(
      state.task,
      state.retries,
      this.workDir,
      extraContext,
    );

    state.agentIds.push(agent.id);
    this.running--;

    if (agent.status === 'success') {
      state.status = 'success';
      state.completedAt = Date.now();
      this._broadcastTaskStatus(state);
      console.log(`[taskRunner] Task "${state.task.label}" succeeded (${agent.modelTier}, retry ${state.retries})`);
    } else {
      await this._handleFailure(state, agent);
    }

    // Check if all done
    this._checkCompletion();

    // Schedule next batch
    await this._scheduleEligible();
  }

  /**
   * Handle a failed agent — retry or block.
   */
  async _handleFailure(state, agent) {
    state.retries++;
    const fullOutput = agent.output.join('');

    console.log(`[taskRunner] Task "${state.task.label}" failed (retry ${state.retries}/${config.maxRetriesTotal})`);

    if (state.retries >= config.maxRetriesTotal) {
      state.status = 'blocked';
      this._broadcastTaskStatus(state);
      console.log(`[taskRunner] Task "${state.task.label}" BLOCKED after ${state.retries} retries`);
      return;
    }

    // Store a simple failure report
    state.failureReports.push({
      failedTaskId: state.task.id,
      summary: `Agent exited with failure. Last output: ${fullOutput.slice(-500)}`,
      suggestedFix: 'Retry with escalated model',
      category: 'unknown',
    });

    // Re-queue as pending for next schedule pass
    state.status = 'pending';
    this._broadcastTaskStatus(state);
  }

  _broadcastTaskStatus(state) {
    this.broadcast(makeMsg(MSG.TASK_STATUS, {
      taskId: state.task.id,
      status: state.status,
      retries: state.retries,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      modelTier: state.retries > 0
        ? this._getTierForRetry(state.retries)
        : 'T0',
    }));
  }

  _getTierForRetry(retryIndex) {
    const idx = Math.min(retryIndex, config.escalation.length - 1);
    return config.escalation[idx];
  }

  _checkCompletion() {
    const states = [...this.taskStates.values()];
    const allDone = states.every(s => s.status === 'success' || s.status === 'blocked');
    if (!allDone) return;

    const anyBlocked = states.some(s => s.status === 'blocked');
    const costSummary = this.agentManager.getCostSummary();

    this.broadcast(makeMsg(MSG.SESSION_COMPLETE, {
      status: anyBlocked ? 'partial' : 'completed',
      costSummary,
    }));

    console.log('[taskRunner] Session complete:', anyBlocked ? 'PARTIAL (some blocked)' : 'SUCCESS');
    console.log('[taskRunner] Cost summary:', JSON.stringify(costSummary));
  }
}
