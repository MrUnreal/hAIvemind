import config from './config.js';
import { MSG, makeMsg } from '../shared/protocol.js';
import { summarizeOutput, summaryToContext } from './outputSummarizer.js';

/**
 * TaskRunner manages the DAG execution of tasks with dependency resolution,
 * retry logic, model tier escalation, dynamic DAG rewriting, speculative
 * execution, wave tracking, and automatic task splitting.
 *
 * Philosophy: "hive mind swarms a problem" — maximize parallelism at every level.
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
    this.orchestratorFn = opts.orchestratorFn || null; // For task splitting

    /** @type {Map<string, TaskState>} */
    this.taskStates = new Map();
    this.running = 0;

    /** Gate resolvers — pending human approval callbacks */
    this._gateResolvers = new Map();

    /** DAG rewrite tracking */
    this.rewrites = [];
    this._stallCheckTimer = null;

    /** Wave tracking */
    this._currentWave = 0;
    this._waveMap = new Map(); // taskId → wave number
    this._lastBroadcastedWave = -1;

    /** Speculative execution tracking */
    this._speculativeTasks = new Set(); // taskIds started speculatively

    /** Task splitting tracking */
    this._splitTasks = new Set(); // taskIds that have been split

    /** Dynamic concurrency tracking */
    this._peakConcurrency = 0;

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

    // Pre-compute waves for progress tracking
    this._computeWaves();
  }

  /**
   * Pre-compute DAG waves for progress tracking.
   * Wave 0 = root tasks (no deps), Wave N = tasks whose all deps are in Wave < N.
   */
  _computeWaves() {
    const waves = new Map();
    const remaining = new Set(this.plan.tasks.map(t => t.id));
    let wave = 0;

    while (remaining.size > 0) {
      const thisWave = [];
      for (const taskId of remaining) {
        const state = this.taskStates.get(taskId);
        if (!state) continue;
        const deps = state.task.dependencies || [];
        const allDepsResolved = deps.every(d => !remaining.has(d) || waves.has(d));
        const depsInEarlierWave = deps.every(d => {
          const w = waves.get(d);
          return w !== undefined && w < wave;
        });
        if (deps.length === 0 || (allDepsResolved && depsInEarlierWave)) {
          thisWave.push(taskId);
        }
      }
      if (thisWave.length === 0) {
        // Remaining tasks have circular deps or unresolvable — assign to current wave
        for (const taskId of remaining) {
          waves.set(taskId, wave);
          this._waveMap.set(taskId, wave);
        }
        break;
      }
      for (const taskId of thisWave) {
        waves.set(taskId, wave);
        this._waveMap.set(taskId, wave);
        remaining.delete(taskId);
      }
      wave++;
    }

    this._totalWaves = wave + (remaining.size > 0 ? 0 : 1);
    console.log(`[taskRunner] DAG has ${this._totalWaves} wave(s) across ${this.plan.tasks.length} tasks`);
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
    console.log(`[taskRunner] Starting execution of ${this.plan.tasks.length} tasks (${this._totalWaves} waves)`);
    console.log(`[taskRunner] Swarm config: base=${config.maxConcurrency}, ceiling=${config.swarmMaxConcurrency}, speculative=${config.speculativeExecution}, splitting=${config.taskSplitEnabled}`);

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
    if (this._peakConcurrency > 0) {
      console.log(`[taskRunner] Peak concurrency reached: ${this._peakConcurrency}`);
    }
  }

  /**
   * Get swarm execution statistics (called after run() completes).
   */
  getSwarmStats() {
    const states = [...this.taskStates.values()];
    return {
      totalTasks: states.length,
      totalWaves: this._totalWaves,
      peakConcurrency: this._peakConcurrency,
      speculativeLaunches: this._speculativeTasks.size,
      taskSplits: this._splitTasks.size,
      dagRewrites: this.rewrites.length,
    };
  }

  /**
   * Calculate dynamic concurrency limit based on current eligible count.
   * Swarm Scaling: more eligible tasks → higher concurrency cap.
   */
  _dynamicConcurrencyLimit(eligibleCount) {
    const baseCap = this.overrides?.maxConcurrency ?? config.maxConcurrency;
    const swarmCap = config.swarmMaxConcurrency;

    // Scale up: allow up to swarmMaxConcurrency when we have many eligible tasks
    // Use a smooth curve: base + log2(eligible) * 2
    if (eligibleCount <= baseCap) return baseCap;

    const scaled = Math.min(
      baseCap + Math.ceil(Math.log2(eligibleCount + 1) * 2),
      swarmCap,
    );
    return scaled;
  }

  /**
   * Find and launch tasks whose dependencies are all met.
   * Includes speculative execution for tasks with soft dependencies.
   */
  async _scheduleEligible() {
    const eligible = [];
    const speculative = [];

    // Count total eligible first (before concurrency cap) for dynamic scaling
    let totalEligible = 0;
    for (const [, state] of this.taskStates) {
      if (state.status !== 'pending' && state.status !== 'gated') continue;
      const depsOk = state.task.dependencies.every(depId => {
        const depState = this.taskStates.get(depId);
        return depState && depState.status === 'success';
      });
      if (depsOk) totalEligible++;
    }

    // Dynamic concurrency: scale based on how many tasks are ready
    const maxConc = this._dynamicConcurrencyLimit(totalEligible);

    // Broadcast scaling events when concurrency changes dynamically
    if (totalEligible > (this.overrides?.maxConcurrency ?? config.maxConcurrency)) {
      this.broadcast(makeMsg(MSG.SWARM_SCALING, {
        currentConcurrency: this.running,
        dynamicLimit: maxConc,
        eligibleTasks: totalEligible,
        reason: `Scaling up: ${totalEligible} eligible tasks → cap raised to ${maxConc}`,
      }));
    }

    for (const [taskId, state] of this.taskStates) {
      // Skip tasks that aren't actionable
      if (state.status !== 'pending' && state.status !== 'gated') continue;
      if ((this.running + eligible.length + speculative.length) >= maxConc) break;

      const deps = state.task.dependencies || [];
      const depStates = deps.map(depId => this.taskStates.get(depId));
      const allDepsOk = depStates.every(ds => ds && ds.status === 'success');

      if (allDepsOk) {
        // Handle gated tasks — request human approval before scheduling
        if (state.status === 'gated') {
          this._requestGateApproval(state);
          continue;
        }
        eligible.push(state);
        continue;
      }

      // ── Speculative Execution ──
      // If speculative execution is enabled, check if this task can start early
      if (config.speculativeExecution && state.status === 'pending' && deps.length > 0) {
        const doneDeps = depStates.filter(ds => ds && ds.status === 'success').length;
        const runningDeps = depStates.filter(ds => ds && ds.status === 'running').length;
        const failedDeps = depStates.filter(ds => ds && (ds.status === 'blocked' || ds.status === 'failed')).length;

        // Don't speculate if any dep has hard-failed
        if (failedDeps > 0) continue;

        const fractionDone = deps.length > 0 ? doneDeps / deps.length : 1;
        const allRemainingRunning = (doneDeps + runningDeps) === deps.length;

        // Speculate if: enough deps are done AND all remaining are actively running
        // AND no remaining deps have true data dependencies
        if (fractionDone >= config.speculativeThreshold && allRemainingRunning) {
          const incompleteDeps = deps.filter(depId => {
            const ds = this.taskStates.get(depId);
            return ds && ds.status !== 'success';
          });

          // Check if blocking deps are soft (no true data dependency)
          const allSoft = incompleteDeps.every(depId => {
            const ds = this.taskStates.get(depId);
            return ds && !this._hasTrueDataDependency(ds, state);
          });

          if (allSoft) {
            speculative.push(state);
          }
        }
      }
    }

    // Launch all eligible + speculative tasks simultaneously
    const allLaunches = [];

    for (const state of eligible) {
      allLaunches.push(this._launchTask(state));
    }

    for (const state of speculative) {
      this._speculativeTasks.add(state.task.id);
      this.broadcast(makeMsg(MSG.SPECULATIVE_START, {
        taskId: state.task.id,
        label: state.task.label,
        pendingDeps: state.task.dependencies.filter(depId => {
          const ds = this.taskStates.get(depId);
          return ds && ds.status !== 'success';
        }),
        reason: 'Soft dependencies still running — starting speculatively',
      }));
      console.log(`[taskRunner] ⚡ Speculative launch: "${state.task.label}" (${state.task.dependencies.length - state.task.dependencies.filter(d => this.taskStates.get(d)?.status === 'success').length} deps still running)`);
      allLaunches.push(this._launchTask(state));
    }

    // Track peak concurrency
    const newConcurrency = this.running + allLaunches.length;
    if (newConcurrency > this._peakConcurrency) {
      this._peakConcurrency = newConcurrency;
    }

    // Broadcast wave progress
    this._broadcastWaveProgress();

    await Promise.allSettled(allLaunches);
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
   * Broadcast execution wave progress to the client.
   */
  _broadcastWaveProgress() {
    // Determine current active wave (lowest wave number with running/pending tasks)
    let currentWave = -1;
    const waveStats = {};

    for (const [taskId, state] of this.taskStates) {
      const wave = this._waveMap.get(taskId);
      if (wave === undefined) continue;
      if (!waveStats[wave]) {
        waveStats[wave] = { total: 0, running: 0, completed: 0, pending: 0, blocked: 0, speculative: 0 };
      }
      waveStats[wave].total++;
      if (state.status === 'success') waveStats[wave].completed++;
      else if (state.status === 'running') {
        waveStats[wave].running++;
        if (this._speculativeTasks.has(taskId)) waveStats[wave].speculative++;
      }
      else if (state.status === 'blocked') waveStats[wave].blocked++;
      else waveStats[wave].pending++;
    }

    // Find the active wave
    for (let w = 0; w < this._totalWaves; w++) {
      const ws = waveStats[w];
      if (ws && (ws.running > 0 || ws.pending > 0)) {
        currentWave = w;
        break;
      }
    }

    if (currentWave >= 0 && currentWave !== this._lastBroadcastedWave) {
      this._lastBroadcastedWave = currentWave;
      const ws = waveStats[currentWave] || {};
      this.broadcast(makeMsg(MSG.SWARM_WAVE, {
        currentWave,
        totalWaves: this._totalWaves,
        waveStats: ws,
        allWaves: waveStats,
        peakConcurrency: this._peakConcurrency,
      }));
      console.log(`[taskRunner] 🌊 Wave ${currentWave + 1}/${this._totalWaves}: ${ws.running || 0} running, ${ws.completed || 0} done, ${ws.pending || 0} pending${ws.speculative ? `, ${ws.speculative} speculative` : ''}`);
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

    // Build extra context from failure reports — use structured summaries (Phase 5.1)
    const extraContext = state.failureReports
      .map(r => {
        if (r.outputSummary) {
          return summaryToContext(r.outputSummary);
        }
        return `Previous failure: ${r.summary}\nSuggested fix: ${r.suggestedFix}`;
      })
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
   * Handle a failed agent — retry, split, or block.
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

    // Phase 5.1: Generate structured summary from agent output
    const summary = summarizeOutput(agent.output);
    agent.summary = summary; // Store on agent for snapshot persistence

    // Store a failure report with structured summary
    state.failureReports.push({
      failedTaskId: state.task.id,
      summary: summary.digest || `Agent exited with failure. Last output: ${fullOutput.slice(-500)}`,
      suggestedFix: summary.errors.length > 0
        ? `Fix these errors: ${summary.errors.slice(0, 3).join('; ')}`
        : 'Retry with escalated model',
      category: summary.errors.length > 0 ? 'error' : (summary.tests.failed > 0 ? 'test-failure' : 'unknown'),
      outputSummary: summary,
    });

    // ── Task Splitting: Swarm a failed task ──
    // After N retries, try splitting the task into smaller sub-tasks instead of just escalating.
    // This embodies "hive mind swarms a problem" — if one agent can't do it, send multiple.
    if (config.taskSplitEnabled
      && state.retries === config.taskSplitAfterRetries
      && !this._splitTasks.has(state.task.id)
      && this.orchestratorFn) {
      const subtasks = await this._trySplitTask(state, summary);
      if (subtasks && subtasks.length > 0) {
        // Successfully split — subtasks replace this task
        return;
      }
      // Split failed — fall through to normal retry
    }

    // Re-queue as pending for next schedule pass
    state.status = 'pending';
    this._broadcastTaskStatus(state);
  }

  /**
   * Attempt to split a failing task into smaller sub-tasks.
   * "If one bee can't handle it, send the swarm."
   *
   * @param {TaskState} state - The failing task's state
   * @param {object} summary - Output summary from the failed attempt
   * @returns {Array|null} Sub-tasks if split succeeded, null otherwise
   */
  async _trySplitTask(state, summary) {
    try {
      this._splitTasks.add(state.task.id);
      console.log(`[taskRunner] 🔀 Attempting to split task "${state.task.label}" into sub-tasks...`);

      const splitPrompt = `A coding task has failed ${state.retries} times. Break it into 2-4 smaller, independent sub-tasks that can run in PARALLEL.

## Original Task
Label: ${state.task.label}
Description: ${state.task.description}

## Failure Summary
${summary.digest || 'Unknown failure'}
Errors: ${summary.errors?.slice(0, 5).join('; ') || 'none captured'}

## Rules
- Each sub-task should be a focused unit of work (ONE file, ONE concern)
- Sub-tasks should be as INDEPENDENT as possible (maximum parallelism)
- Pre-spec interfaces between sub-tasks so they can run simultaneously
- Keep the same overall goal — just decompose into parallel pieces
- 2-4 sub-tasks is ideal — don't over-decompose

Output ONLY valid JSON (no markdown):
{
  "tasks": [
    { "id": "sub-1", "label": "...", "description": "...", "dependencies": [] }
  ]
}`;

      const splitPlan = await this.orchestratorFn(splitPrompt, this.workDir);
      if (!splitPlan?.tasks?.length || splitPlan.tasks.length < 2) {
        console.log(`[taskRunner] Split produced ${splitPlan?.tasks?.length || 0} tasks — not enough, skipping`);
        return null;
      }

      // Remap sub-task IDs to avoid collisions
      const parentId = state.task.id;
      const subtasks = splitPlan.tasks.map(t => ({
        ...t,
        id: `${parentId}-split-${t.id}`,
        dependencies: t.dependencies.map(d => `${parentId}-split-${d}`),
      }));

      // Root sub-tasks inherit the parent's dependencies
      const parentDeps = state.task.dependencies || [];
      for (const st of subtasks) {
        if (st.dependencies.length === 0) {
          st.dependencies = [...parentDeps];
        }
      }

      // Mark the original task as split (success by delegation)
      state.status = 'success';
      state.completedAt = Date.now();
      this._broadcastTaskStatus(state);

      // Update downstream tasks: anything that depended on parentId now depends on ALL sub-task leaf nodes
      const subTaskIds = new Set(subtasks.map(st => st.id));
      const subTaskDependedOn = new Set(subtasks.flatMap(st => st.dependencies).filter(d => subTaskIds.has(d)));
      const subLeafIds = subtasks.filter(st => !subTaskDependedOn.has(st.id)).map(st => st.id);

      for (const [, depState] of this.taskStates) {
        const idx = depState.task.dependencies.indexOf(parentId);
        if (idx !== -1) {
          depState.task.dependencies.splice(idx, 1, ...subLeafIds);
        }
      }

      // Add sub-tasks to the plan and task states
      for (const st of subtasks) {
        this.plan.tasks.push(st);
        this.taskStates.set(st.id, {
          task: st,
          status: 'pending',
          retries: 0,
          agentIds: [],
          failureReports: [],
          startedAt: null,
          completedAt: null,
        });
      }

      // Build edges for broadcasting
      const newEdges = [];
      for (const st of subtasks) {
        for (const depId of st.dependencies) {
          newEdges.push({ id: `${depId}->${st.id}`, source: depId, target: st.id });
        }
      }

      // Broadcast the split
      this.broadcast(makeMsg(MSG.TASK_SPLIT, {
        originalTaskId: parentId,
        originalLabel: state.task.label,
        subtasks: subtasks.map(st => ({ id: st.id, label: st.label })),
        reason: `Task failed ${state.retries} times — swarming with ${subtasks.length} parallel sub-tasks`,
      }));

      // Broadcast new tasks to UI
      this.broadcast(makeMsg(MSG.PLAN_CREATED, {
        tasks: subtasks,
        edges: newEdges,
        append: true,
        splitFrom: parentId,
      }));

      console.log(`[taskRunner] 🔀 Split "${state.task.label}" into ${subtasks.length} sub-tasks: ${subtasks.map(st => st.label).join(', ')}`);

      // Recompute waves with new tasks
      this._computeWaves();

      return subtasks;
    } catch (err) {
      console.warn(`[taskRunner] Task split failed for "${state.task.label}": ${err.message}`);
      return null;
    }
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

    // Swarm stats
    const swarmStats = {
      totalTasks: states.length,
      totalWaves: this._totalWaves,
      peakConcurrency: this._peakConcurrency,
      speculativeLaunches: this._speculativeTasks.size,
      taskSplits: this._splitTasks.size,
      dagRewrites: this.rewrites.length,
    };

    this.broadcast(makeMsg(MSG.SESSION_COMPLETE, {
      status: anyBlocked ? 'partial' : 'completed',
      costSummary,
      rewrites: this.rewrites,
      swarmStats,
    }));

    console.log('[taskRunner] Session complete:', anyBlocked ? 'PARTIAL (some blocked)' : 'SUCCESS');
    console.log('[taskRunner] Cost summary:', JSON.stringify(costSummary));
    console.log(`[taskRunner] Swarm stats: ${swarmStats.totalTasks} tasks, ${swarmStats.totalWaves} waves, peak ${swarmStats.peakConcurrency} concurrent, ${swarmStats.speculativeLaunches} speculative, ${swarmStats.taskSplits} splits, ${swarmStats.dagRewrites} rewrites`);
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
