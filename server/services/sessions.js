/**
 * Session orchestration services — Phase 6.8
 * Extracted from server/index.js.
 */

import config from '../config.js';
import { MSG, makeMsg, parseMsg } from '../../shared/protocol.js';
import AgentManager from '../agentManager.js';
import { decompose, verify } from '../orchestrator.js';
import { decomposeMock } from '../mock.js';
import TaskRunner from '../taskRunner.js';
import { createSnapshot } from '../snapshot.js';
import { writeCheckpoint, deleteCheckpoint } from '../sessionCheckpoint.js';
import { broadcast } from '../ws/broadcast.js';
import { generateReflection, extractSkills } from './analysis.js';
import { sessions, taskToSession, activeContexts, workDirLocks, refs } from '../state.js';
import log from '../logger.js';

// ── Lock helpers ──

export function acquireLock(workDir, sessionId, projectSlug) {
  const existingEntry = workDirLocks.get(workDir);
  if (existingEntry) {
    return { locked: true, holder: existingEntry };
  }
  const entry = { sessionId, projectSlug, lockedAt: Date.now() };
  workDirLocks.set(workDir, entry);
  return { locked: false };
}

export function releaseLock(workDir, sessionId) {
  const entry = workDirLocks.get(workDir);
  if (entry && entry.sessionId === sessionId) {
    workDirLocks.delete(workDir);
  }
}

// ── Session pruning ──

export function pruneCompletedSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    const { status, completedAt } = session || {};
    if (!completedAt) continue;
    const isFinished = status === 'completed' || status === 'failed';
    const isExpired = now - completedAt > config.sessionRetentionMs;
    if (isFinished && isExpired) {
      sessions.delete(sessionId);
      for (const [taskId, mappedSessionId] of taskToSession.entries()) {
        if (mappedSessionId === sessionId) {
          taskToSession.delete(taskId);
        }
      }
    }
  }
}

// ── Session orchestration ──

export async function startSession(userPrompt, projectSlug, predefinedPlan) {
  const workspace = refs.workspace;
  const DEMO = refs.DEMO;

  const project = workspace.getProject(projectSlug);
  if (!project) {
    broadcast(makeMsg(MSG.SESSION_ERROR, { error: `Project "${projectSlug}" not found` }));
    return;
  }

  const skills = workspace.getSkills(projectSlug);
  const settings = workspace.getProjectSettings(projectSlug);
  const overrides = {
    escalation: settings.escalation,
    maxRetriesTotal: settings.maxRetriesTotal,
    pinnedModels: settings.pinnedModels,
    costCeiling: settings.costCeiling ?? null,
    maxConcurrency: settings.maxConcurrency ?? null,
  };

  const { sessionId, workDir, session } = workspace.startSession(projectSlug, userPrompt);
  const lockResult = acquireLock(workDir, sessionId, projectSlug);
  if (lockResult.locked) {
    const lockedAt = new Date(lockResult.holder.lockedAt);
    const hh = String(lockedAt.getHours()).padStart(2, '0');
    const mm = String(lockedAt.getMinutes()).padStart(2, '0');
    const ss = String(lockedAt.getSeconds()).padStart(2, '0');
    const startedAt = `${hh}:${mm}:${ss}`;
    broadcast(makeMsg(MSG.SESSION_ERROR, {
      sessionId,
      projectSlug,
      error: `Another session is already running on this workspace (started ${startedAt}, project: ${lockResult.holder.projectSlug})`,
    }));
    return;
  }

  const timeline = [];
  sessions.set(sessionId, { ...session, workDir, projectSlug, timeline });

  // Phase 5.2: Create pre-session workspace snapshot
  let snapshot = { type: 'none', ref: '' };
  try {
    snapshot = await createSnapshot(workDir, sessionId);
  } catch (err) {
    log.warn(`[session] Snapshot creation failed: ${err.message}`);
  }
  const stored0Pre = sessions.get(sessionId);
  if (stored0Pre) stored0Pre.snapshot = snapshot;

  log.info(`\n${'='.repeat(60)}`);
  log.info(`[session] New session: ${sessionId.slice(0, 8)}`);
  log.info(`[session] Project:    ${projectSlug} → ${workDir}`);
  log.info(`[session] Prompt:     "${userPrompt.slice(0, 100)}..."`);
  log.info(`${'='.repeat(60)}\n`);

  try {
    // Step 1 & 2: Parallel Pipeline — analyze workspace AND prepare decomposition concurrently
    // "Hive mind" approach: start both immediately, feed analysis results if they arrive in time.
    let workspaceAnalysis = null;

    const plan = predefinedPlan || await (async () => {
      if (DEMO) {
        return decomposeMock(userPrompt);
      }

      // Fire workspace analysis and decomposition in parallel
      const analysisPromise = (async () => {
        try {
          const { analyzeWorkspace } = await import('../workspaceAnalyzer.js');
          const result = await analyzeWorkspace(workDir);
          log.info(`[session] Workspace analysis: ${result.summary}`);
          return result;
        } catch (err) {
          log.warn(`[session] Workspace analysis failed (non-fatal): ${err.message}`);
          return null;
        }
      })();

      // Race: try to get analysis within 3s, then decompose with whatever we have
      const analysisOrTimeout = await Promise.race([
        analysisPromise,
        new Promise(resolve => setTimeout(() => resolve(null), 3000)),
      ]);

      // If analysis came back fast, use it immediately
      if (analysisOrTimeout) {
        workspaceAnalysis = analysisOrTimeout;
        log.info('[session] Parallel pipeline: analysis completed before decomposition — injecting context');
      }

      // Start decomposition (with analysis if we got it, without if we didn't)
      const decomposePromise = decompose(userPrompt, workDir, { skills, workspaceAnalysis });

      // If analysis is still running, await it in background for session metadata
      if (!workspaceAnalysis) {
        analysisPromise.then(result => {
          if (result) {
            workspaceAnalysis = result;
            log.info('[session] Parallel pipeline: analysis completed after decomposition started');
          }
        }).catch(() => {});
      }

      return decomposePromise;
    })();

    const stored0 = sessions.get(sessionId);
    if (stored0) stored0.workspaceAnalysis = workspaceAnalysis;

    const stored = sessions.get(sessionId);
    stored.plan = plan;
    stored.status = 'running';

    if (Array.isArray(plan.tasks)) {
      for (const task of plan.tasks) {
        if (task?.id) taskToSession.set(task.id, sessionId);
      }
    }

    const edges = [];
    for (const task of plan.tasks) {
      for (const depId of task.dependencies) {
        edges.push({ id: `${depId}->${task.id}`, source: depId, target: task.id });
      }
    }

    broadcast(makeMsg(MSG.PLAN_CREATED, {
      sessionId,
      projectSlug,
      tasks: plan.tasks,
      edges,
    }));

    const agentManager = new AgentManager(broadcast, DEMO, { skills, overrides, workspaceAnalysis });
    const taskRunnerBroadcast = (msg) => {
      const parsed = parseMsg(msg);
      if (parsed?.type === MSG.SESSION_COMPLETE) return;
      if (parsed?.type === MSG.DAG_REWRITE) {
        const { fromLabel, toLabel, reason } = parsed.payload || {};
        broadcast(makeMsg(MSG.CHAT_RESPONSE, {
          projectSlug,
          role: 'assistant',
          content: `⚡ **DAG Rewrite**: Unblocked task "${toLabel}" — removed dependency on stalled task "${fromLabel}"\n\n_${reason}_`,
        }));
      }
      broadcast(msg);
    };
    const taskRunner = new TaskRunner(plan, agentManager, taskRunnerBroadcast, workDir, {
      overrides,
      orchestratorFn: DEMO ? null : decompose,
    });

    const earlyCtx = { sessionId, workDir, plan, agentManager, taskRunner, history: [] };
    activeContexts.set(projectSlug, earlyCtx);

    await taskRunner.run();
    const swarmStats = taskRunner.getSwarmStats();
    taskRunner.cleanup();

    // Step 3: Verify & Fix Loop
    if (!DEMO) {
      await runVerifyFixLoop({
        sessionId,
        projectSlug,
        plan,
        edges,
        agentManager,
        workDir,
        maxRounds: 3,
        fixCounter: { n: 0 },
        skills,
      });
    }

    stored.status = 'completed';
    stored.completedAt = Date.now();
    const costSummaryData = agentManager.getCostSummary?.() || null;

    activeContexts.set(projectSlug, {
      sessionId,
      workDir,
      plan,
      agentManager,
      history: [],
    });

    broadcast(makeMsg(MSG.SESSION_COMPLETE, {
      sessionId,
      projectSlug,
      costSummary: costSummaryData,
      swarmStats,
    }));

    workspace.finalizeSession(projectSlug, sessionId, {
      status: 'completed',
      tasks: plan.tasks,
      edges,
      agents: agentManager.getSessionSnapshot(),
      costSummary: costSummaryData,
      timeline,
      snapshot,
    });
    releaseLock(workDir, sessionId);

    // Phase 6.7: Delete checkpoint — session is done
    const proj = workspace.getProject(projectSlug);
    if (proj) deleteCheckpoint(sessionId, proj.dir).catch(() => {});

    // Phase 2: Post-session analysis
    try {
      const reflection = generateReflection(plan, agentManager, costSummaryData, session);
      workspace.saveReflection(projectSlug, sessionId, reflection);
      broadcast(makeMsg(MSG.REFLECTION_CREATED, { projectSlug, sessionId, reflection }));

      const discoveredSkills = extractSkills(agentManager);
      if (Object.values(discoveredSkills).some(arr => arr.length > 0)) {
        const merged = workspace.saveSkills(projectSlug, discoveredSkills);
        broadcast(makeMsg(MSG.SKILLS_UPDATE, { projectSlug, skills: merged }));
        log.info(`[skills] Updated skills for "${projectSlug}": ${JSON.stringify(discoveredSkills)}`);
      }
    } catch (reflErr) {
      log.warn(`[reflection] Post-session analysis failed: ${reflErr.message}`);
    }

  } catch (err) {
    log.error(`[session] Error: ${err.message}`);
    const stored = sessions.get(sessionId);
    if (stored) {
      stored.status = 'failed';
      stored.completedAt = Date.now();
    }

    broadcast(makeMsg(MSG.SESSION_ERROR, {
      sessionId,
      projectSlug,
      error: err.message,
    }));

    workspace.finalizeSession(projectSlug, sessionId, { status: 'failed', timeline, snapshot });
    releaseLock(workDir, sessionId);

    // Phase 6.7: Delete checkpoint — session failed
    const projFailed = workspace.getProject(projectSlug);
    if (projFailed) deleteCheckpoint(sessionId, projFailed.dir).catch(() => {});
  }
}

/**
 * Verify-Fix feedback loop.
 */
export async function runVerifyFixLoop({ sessionId, projectSlug, plan, edges, agentManager, workDir, maxRounds = 3, fixCounter = { n: 0 }, skills }) {
  for (let round = 0; round < maxRounds; round++) {
    broadcast(makeMsg(MSG.VERIFICATION_STATUS, {
      sessionId,
      status: 'running',
      message: round === 0 ? 'Verifying project integrity...' : `Re-verifying after fixes (round ${round + 1})...`,
    }));

    const verifyResult = await verify(plan, workDir, { skills });

    if (verifyResult.passed || !verifyResult.followUpTasks?.length) {
      broadcast(makeMsg(MSG.VERIFICATION_STATUS, {
        sessionId,
        status: verifyResult.passed ? 'passed' : 'warning',
        message: verifyResult.passed
          ? 'All checks passed ✅'
          : `Verification found issues but no actionable fixes: ${verifyResult.issues?.join('; ')}`,
        issues: verifyResult.issues || [],
      }));
      return;
    }

    broadcast(makeMsg(MSG.VERIFICATION_STATUS, {
      sessionId,
      status: 'fixing',
      message: `Found ${verifyResult.issues.length} issue(s) — spawning ${verifyResult.followUpTasks.length} parallel fix agent(s)...`,
      issues: verifyResult.issues,
    }));

    const fixTasks = verifyResult.followUpTasks.map(t => ({
      ...t,
      id: `fix-${++fixCounter.n}-${t.id}`,
      dependencies: t.dependencies.map(d => `fix-${fixCounter.n}-${d}`),
    }));

    for (const task of fixTasks) {
      if (task?.id) taskToSession.set(task.id, sessionId);
    }

    const depTargets = new Set(plan.tasks.flatMap(t => t.dependencies || []));
    const leafTaskIds = plan.tasks
      .filter(t => t.type !== 'prompt' && !depTargets.has(t.id))
      .map(t => t.id);

    for (const task of fixTasks) {
      if (task.dependencies.length === 0) {
        task.dependencies = [...leafTaskIds];
      }
    }

    const newEdges = [];
    for (const task of fixTasks) {
      for (const depId of (task.dependencies || [])) {
        newEdges.push({ id: `${depId}->${task.id}`, source: depId, target: task.id });
      }
    }

    plan.tasks.push(...fixTasks);
    edges.push(...newEdges);

    broadcast(makeMsg(MSG.PLAN_CREATED, {
      sessionId,
      projectSlug,
      tasks: fixTasks,
      edges: newEdges,
      append: true,
    }));

    const runnerPlan = { tasks: fixTasks };
    const filteredBroadcast = (msg) => {
      const parsed = parseMsg(msg);
      if (parsed?.type === MSG.SESSION_COMPLETE) return;
      broadcast(msg);
    };
    const fixRunner = new TaskRunner(runnerPlan, agentManager, filteredBroadcast, workDir);
    await fixRunner.run();
    fixRunner.cleanup();

    log.info(`[verify-fix] Round ${round + 1} fixes applied — re-verifying...`);
  }

  broadcast(makeMsg(MSG.VERIFICATION_STATUS, {
    sessionId,
    status: 'warning',
    message: `Verification loop exhausted after ${maxRounds} rounds — some issues may remain`,
  }));
}

/**
 * Handle a follow-up chat message — decompose into new tasks, extend the DAG, execute.
 */
export async function handleChatMessage(message, projectSlug) {
  const workspace = refs.workspace;
  const DEMO = refs.DEMO;

  const ctx = activeContexts.get(projectSlug);
  if (!ctx) {
    broadcast(makeMsg(MSG.CHAT_RESPONSE, {
      projectSlug,
      role: 'assistant',
      content: 'No active session for this project. Start a new session first.',
    }));
    return;
  }

  // Concurrency guard: reject if an iteration is already running
  if (ctx.iterating) {
    broadcast(makeMsg(MSG.CHAT_RESPONSE, {
      projectSlug,
      role: 'assistant',
      content: 'An iteration is already in progress. Please wait for it to finish.',
    }));
    return;
  }
  ctx.iterating = true;

  ctx.iterationCount = (ctx.iterationCount || 0) + 1;
  const iterNum = ctx.iterationCount;
  const promptNodeId = `__prompt_${iterNum}__`;

  broadcast(makeMsg(MSG.ITERATION_START, {
    projectSlug,
    iterationId: iterNum,
    prompt: message,
  }));

  try {
    const dependedOn = new Set();
    for (const t of ctx.plan.tasks) {
      for (const dep of (t.dependencies || [])) {
        dependedOn.add(dep);
      }
    }
    const leafTaskIds = ctx.plan.tasks
      .filter(t => t.type !== 'prompt' && !dependedOn.has(t.id))
      .map(t => t.id);

    const taskSummary = ctx.plan.tasks
      .filter(t => t.type !== 'prompt')
      .map(t => `- ${t.label}: ${t.description}`)
      .join('\n');

    const contextPrompt =
      `The project already has the following completed work:\n${taskSummary}\n\n` +
      `The user now requests:\n${message}\n\n` +
      `Decompose ONLY the new work needed. Do NOT recreate tasks that have already been done.`;

    log.info(`[iteration ${iterNum}] Decomposing: "${message.slice(0, 80)}..."`);

    const plan = DEMO
      ? await decomposeMock(contextPrompt)
      : await decompose(contextPrompt, ctx.workDir);

    for (const task of plan.tasks) {
      const oldId = task.id;
      task.id = `iter-${iterNum}-${oldId}`;
      task.dependencies = task.dependencies.map(d => `iter-${iterNum}-${d}`);
    }

    const promptNode = {
      id: promptNodeId,
      type: 'prompt',
      label: message.length > 50 ? message.slice(0, 47) + '...' : message,
      prompt: message,
      description: message,
      dependencies: leafTaskIds,
    };

    const rootTasks = plan.tasks.filter(t => t.dependencies.length === 0);
    for (const task of rootTasks) {
      task.dependencies.push(promptNodeId);
    }

    const allNewTasks = [promptNode, ...plan.tasks];

    for (const task of allNewTasks) {
      if (task?.id) taskToSession.set(task.id, ctx.sessionId);
    }

    const allNewEdges = [];
    for (const task of allNewTasks) {
      for (const depId of (task.dependencies || [])) {
        allNewEdges.push({ id: `${depId}->${task.id}`, source: depId, target: task.id });
      }
    }

    broadcast(makeMsg(MSG.PLAN_CREATED, {
      sessionId: ctx.sessionId,
      projectSlug,
      tasks: allNewTasks,
      edges: allNewEdges,
      append: true,
      iterationId: iterNum,
    }));

    log.info(`[iteration ${iterNum}] ${plan.tasks.length} tasks → executing...`);

    const runnerPlan = {
      tasks: plan.tasks.map(t => ({
        ...t,
        dependencies: t.dependencies.filter(d => d !== promptNodeId),
      })),
    };
    const iterSkills = workspace.getSkills(projectSlug);
    const iterSettings = workspace.getProjectSettings(projectSlug);
    const iterOverrides = {
      escalation: iterSettings.escalation,
      maxRetriesTotal: iterSettings.maxRetriesTotal,
      pinnedModels: iterSettings.pinnedModels,
    };
    const agentManager = new AgentManager(broadcast, DEMO, { skills: iterSkills, overrides: iterOverrides });
    const filteredBroadcast = (msg) => {
      const parsed = parseMsg(msg);
      if (parsed?.type === MSG.SESSION_COMPLETE) return;
      if (parsed?.type === MSG.DAG_REWRITE) {
        const { fromLabel, toLabel, reason } = parsed.payload || {};
        broadcast(makeMsg(MSG.CHAT_RESPONSE, {
          projectSlug: ctx.plan.projectSlug,
          role: 'assistant',
          content: `⚡ **DAG Rewrite**: Unblocked task "${toLabel}" — removed dependency on stalled task "${fromLabel}"\n\n_${reason}_`,
        }));
      }
      broadcast(msg);
    };
    const taskRunner = new TaskRunner(runnerPlan, agentManager, filteredBroadcast, ctx.workDir);
    await taskRunner.run();
    taskRunner.cleanup();

    if (!DEMO) {
      ctx.plan.tasks.push(promptNode, ...plan.tasks);
      const iterEdges = [...allNewEdges];

      await runVerifyFixLoop({
        sessionId: ctx.sessionId,
        projectSlug,
        plan: ctx.plan,
        edges: iterEdges,
        agentManager,
        workDir: ctx.workDir,
        maxRounds: 3,
        fixCounter: { n: 0 },
      });
    } else {
      ctx.plan.tasks.push(promptNode, ...plan.tasks);
    }

    ctx.history.push({ role: 'user', content: message });
    ctx.history.push({ role: 'assistant', content: `Completed ${plan.tasks.length} tasks for: ${message}` });

    const iterCostSummary = agentManager.getCostSummary?.() || null;
    broadcast(makeMsg(MSG.ITERATION_COMPLETE, {
      projectSlug,
      iterationId: iterNum,
      costSummary: iterCostSummary,
    }));

    log.info(`[iteration ${iterNum}] Complete`);

  } catch (err) {
    log.error(`[iteration ${iterNum}] Error:`, err.message);
    broadcast(makeMsg(MSG.CHAT_RESPONSE, {
      projectSlug,
      role: 'assistant',
      content: `Error during iteration: ${err.message}`,
    }));
    broadcast(makeMsg(MSG.ITERATION_COMPLETE, {
      projectSlug,
      iterationId: iterNum,
      error: err.message,
    }));
  } finally {
    ctx.iterating = false;
  }
}
