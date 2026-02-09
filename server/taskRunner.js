import config from './config.js';
import { MSG, makeMsg } from '../shared/protocol.js';

/**
 * TaskRunner manages the DAG execution of tasks with dependency resolution,
 * retry logic, model tier escalation, and dynamic DAG rewriting.
 */
export default class TaskRunner {
  /**
   * @param {object} plan - { tasks: [{ id, label, description, dependencies }] }
   * @param {import('./agentManager.js').default} agentManager
   * @param {(msg: string) => void} broadcast
   * @param {string} workDir
   * @param {object} [opts] - Optional overrides
   */
  constructor(plan, agentManager, broadcast, workDir, opts = {}) {
    this.plan = plan;
    this.agentManager = agentManager;
    this.broadcast = broadcast;
    this.workDir = workDir;
    this.overrides = opts.overrides || null;

    /** @type {Map<string, TaskState>} */
    this.taskStates = new Map();
    this.running = 0;

    /** Gate resolvers — pending human approval callbacks */
    this._gateResolvers = new Map();

    /** DAG rewrite tracking */
    this.rewrites = [];
    this._stallCheckTimer = null;

    // Initialize task states
    for (const task of plan.tasks) {
      this.taskStates.set(task.id, {
        task,
        status: task.gate ? 'gated' : 'pending',
        retries: 0,
        agentIds: [],
        failureReports: [],
        startedAt: null,
        completedAt: null,
      });
    }
  }

  /**
   * Resolve a human-in-the-loop gate (approve or reject a task).
   * @param {string} taskId
   * @param {boolean} approved
   * @param {string} [feedback] - Optional feedback/redirect instructions
   */
  resolveGate(taskId, approved, feedback) {
    const resolver = this._gateResolvers.get(taskId);
    if (resolver) {
      resolver({ approved, feedback });
      this._gateResolvers.delete(taskId);
    }
  }

  /**
   * Start executing all eligible tasks.
   */
  async run() {
    console.log(`[taskRunner] Starting execution of ${this.plan.tasks.length} tasks`);

    // Start stall detection interval
    this._stallCheckTimer = setInterval(
      () => this._checkForStalls(),
      config.stallCheckIntervalMs,
    );

    await this._scheduleEligible();
  }

  /**
   * Clean up timers (called on session end or externally).
   */
  cleanup() {
    if (this._stallCheckTimer) {
      clearInterval(this._stallCheckTimer);
      this._stallCheckTimer = null;
    }
  }

  /**
   * Find and launch tasks whose dependencies are all met.
   */
  async _scheduleEligible() {
    const eligible = [];

    for (const [taskId, state] of this.taskStates) {
      // Skip tasks that aren't actionable
      if (state.status !== 'pending' && state.status !== 'gated') continue;
      const maxConc = this.overrides?.maxConcurrency ?? config.maxConcurrency;
      if (this.running >= maxConc) continue;  // Phase 4: continue (not break) to check gated tasks

      const depsOk = state.task.dependencies.every(depId => {
        const depState = this.taskStates.get(depId);
        return depState && depState.status === 'success';
      });

      if (depsOk) {
        // Handle gated tasks — request human approval before scheduling
        if (state.status === 'gated') {
          this._requestGateApproval(state);
          continue;
        }
        eligible.push(state);
      }
    }

    const launches = eligible.map(state => this._launchTask(state));
    await Promise.allSettled(launches);
  }

  /**
   * Request human approval for a gated task.
   */
  async _requestGateApproval(state) {
    this.broadcast(makeMsg(MSG.GATE_REQUEST, {
      taskId: state.task.id,
      label: state.task.label,
      description: state.task.description,
    }));

    // Wait for human response
    const { approved, feedback } = await new Promise((resolve) => {
      this._gateResolvers.set(state.task.id, resolve);
    });

    if (approved) {
      state.status = 'pending';
      if (feedback) {
        state.task.description += `\n\n## Human Feedback\n${feedback}`;
      }
      this._broadcastTaskStatus(state);
      await this._scheduleEligible();
    } else {
      state.status = 'blocked';
      state.completedAt = Date.now();
      this._broadcastTaskStatus(state);
      this._checkCompletion();
      await this._scheduleEligible();
    }
  }

  /**
   * Launch a single task.
   */
  async _launchTask(state) {
    // Guard against double-launch from concurrent _scheduleEligible calls
    if (state.status === 'running') return;
    state.status = 'running';
    state.startedAt = Date.now();
    this.running++;
    this._broadcastTaskStatus(state);

    // Build extra context from failure reports
    const extraContext = state.failureReports
      .map(r => `Previous failure: ${r.summary}\nSuggested fix: ${r.suggestedFix}`)
      .join('\n\n');

    try {
      const agent = await this.agentManager.spawn(
        state.task,
        state.retries,
        this.workDir,
        extraContext,
      );

      state.agentIds.push(agent.id);

      if (agent.status === 'success') {
        state.status = 'success';
        state.completedAt = Date.now();
        this._broadcastTaskStatus(state);
        console.log(`[taskRunner] Task "${state.task.label}" succeeded (${agent.modelTier}, retry ${state.retries})`);
      } else {
        await this._handleFailure(state, agent);
      }
    } catch (err) {
      console.error(`[taskRunner] Task "${state.task.label}" spawn error: ${err.message}`);
      state.failureReports.push({
        failedTaskId: state.task.id,
        summary: `Agent spawn error: ${err.message}`,
        suggestedFix: 'Retry with escalated model',
        category: 'spawn-error',
      });
      state.retries++;
      if (state.retries >= config.maxRetriesTotal) {
        state.status = 'blocked';
      } else {
        state.status = 'pending';
      }
      this._broadcastTaskStatus(state);
    } finally {
      this.running--;
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

    // Stop stall checks — session is done
    this.cleanup();

    const anyBlocked = states.some(s => s.status === 'blocked');
    const costSummary = this.agentManager.getCostSummary();

    this.broadcast(makeMsg(MSG.SESSION_COMPLETE, {
      status: anyBlocked ? 'partial' : 'completed',
      costSummary,
      rewrites: this.rewrites,
    }));

    console.log('[taskRunner] Session complete:', anyBlocked ? 'PARTIAL (some blocked)' : 'SUCCESS');
    console.log('[taskRunner] Cost summary:', JSON.stringify(costSummary));
    if (this.rewrites.length) {
      console.log(`[taskRunner] DAG rewrites during session: ${this.rewrites.length}`);
    }
  }

  // ── Dynamic DAG Rewriting ──

  /**
   * Keywords that indicate a true data dependency (output of one task feeds another).
   * If a blocked task's description contains any of these, the dependency edge
   * is preserved even when the upstream task is stalled.
   */
  static DATA_DEP_KEYWORDS = [
    'uses output of', 'reads from', 'depends on data from',
    'imports from', 'requires result', 'consumes', 'reads output',
    'needs file from', 'generated by',
  ];

  /**
   * Periodically scan for stalled running tasks and attempt to unblock
   * downstream tasks by removing non-data dependency edges.
   */
  _checkForStalls() {
    const now = Date.now();

    for (const [taskId, state] of this.taskStates) {
      if (state.status !== 'running') continue;
      if (!state.startedAt) continue;

      const elapsed = now - state.startedAt;
      if (elapsed < config.stallThresholdMs) continue;

      // This task is stalled — find blocked dependents
      for (const [depId, depState] of this.taskStates) {
        if (depState.status !== 'pending') continue;
        if (!depState.task.dependencies.includes(taskId)) continue;

        // Check if this is a true data dependency — if so, don't rewrite
        if (this._hasTrueDataDependency(state, depState)) continue;

        // Safe to rewrite — remove the dependency edge
        depState.task.dependencies = depState.task.dependencies.filter(d => d !== taskId);

        const rewrite = {
          removedEdge: { from: taskId, to: depId },
          fromLabel: state.task.label,
          toLabel: depState.task.label,
          reason: `Task "${state.task.label}" stalled (${Math.round(elapsed / 1000)}s) with no detected data dependency`,
          timestamp: now,
        };
        this.rewrites.push(rewrite);

        console.log(`[taskRunner] DAG Rewrite: unblocked "${depState.task.label}" ← removed dep on stalled "${state.task.label}"`);

        // Broadcast the rewrite event
        this.broadcast(makeMsg(MSG.DAG_REWRITE, rewrite));

        // Trigger re-scheduling so the unblocked task can start
        this._scheduleEligible();
      }
    }
  }

  /**
   * Heuristic: does the blocked task's description suggest it truly needs data
   * produced by the stalled task?
   */
  _hasTrueDataDependency(stallerState, blockedState) {
    const desc = (blockedState.task.description || '').toLowerCase();
    const stallerLabel = (stallerState.task.label || '').toLowerCase();

    for (const kw of TaskRunner.DATA_DEP_KEYWORDS) {
      if (desc.includes(kw) && desc.includes(stallerLabel)) return true;
      if (desc.includes(kw)) return true;
    }
    return false;
  }
}
