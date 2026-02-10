import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import { MSG, makeMsg, parseMsg } from '../shared/protocol.js';
import AgentManager from './agentManager.js';
import { decompose, verify, plan } from './orchestrator.js';
import { decomposeMock } from './mock.js';
import TaskRunner from './taskRunner.js';
import WorkspaceManager from './workspace.js';
import { summarizeOutput } from './outputSummarizer.js';
import { createSnapshot, rollbackToSnapshot, getSnapshotDiff } from './snapshot.js';
import PluginManager from './pluginManager.js';
import log, { createLogger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

const DEMO = process.env.DEMO === '1' || process.argv.includes('--mock');

// ── Workspace manager (singleton) ──
const workspace = new WorkspaceManager();

// ── Express app ──
const app = express();
app.use(express.json());

const server = createServer(app);

// ── WebSocket server ──
const wss = new WebSocketServer({ server, path: '/ws' });

/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

const heartbeatInterval = setInterval(() => {
  for (const ws of clients) {
    if (!ws.isAlive) {
      ws.terminate();
      clients.delete(ws);
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

function broadcast(msg) {
  const parsed = parseMsg(msg);
  if (parsed && (parsed.type === MSG.TASK_STATUS || parsed.type === MSG.AGENT_STATUS || parsed.type === MSG.VERIFICATION_STATUS)) {
    recordTimelineEvent(parsed.type, parsed.payload);
  }
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

// ── Plugin Manager (Phase 5.7) ──
const pluginManager = new PluginManager({
  pluginsDir: resolve(process.cwd(), config.plugins?.dir || 'plugins'),
  config,
  broadcast,
  makeMsg,
  workspace,
});
export { pluginManager };

/**
 * Record timeline events for a session.
 * @param {string} msgType
 * @param {any} payload
 */
function recordTimelineEvent(msgType, payload) {
  let sessionId;

  if (msgType === MSG.VERIFICATION_STATUS) {
    sessionId = payload?.sessionId;
  } else if (msgType === MSG.TASK_STATUS || msgType === MSG.AGENT_STATUS) {
    const taskId = payload?.taskId;
    if (!taskId) return;
    sessionId = taskToSession.get(taskId);
  }

  if (!sessionId) return;

  const session = sessions.get(sessionId);
  if (!session || !session.timeline) return;

  // Phase 5.0: Ring-buffer — cap timeline at 5000 events
  if (session.timeline.length >= 5000) {
    session.timeline.shift();
  }

  session.timeline.push({
    timestamp: Date.now(),
    type: msgType,
    data: payload || {},
  });
}

wss.on('connection', (ws) => {
  clients.add(ws);
  log.info(`[ws] Client connected (${clients.size} total)`);

  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('close', () => {
    clients.delete(ws);
    log.info(`[ws] Client disconnected (${clients.size} total)`);
  });

  ws.on('message', (raw) => {
    const msg = parseMsg(raw.toString());
    if (!msg) return;
    handleClientMessage(msg, ws);
  });
});

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// ── Sessions ──
/** @type {Map<string, object>} */
const sessions = new Map();

/** Map from taskId to sessionId for timeline attribution */
const taskToSession = new Map();

/** Active orchestrator contexts (for post-completion chat) */
const activeContexts = new Map();

const workDirLocks = new Map();

let pruneIntervalId = null;

function pruneCompletedSessions() {
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

function acquireLock(workDir, sessionId, projectSlug) {
  const existingEntry = workDirLocks.get(workDir);
  if (existingEntry) {
    return { locked: true, holder: existingEntry };
  }

  const entry = { sessionId, projectSlug, lockedAt: Date.now() };
  workDirLocks.set(workDir, entry);
  return { locked: false };
}

function releaseLock(workDir, sessionId) {
  const entry = workDirLocks.get(workDir);
  if (entry && entry.sessionId === sessionId) {
    workDirLocks.delete(workDir);
  }
}

async function handleClientMessage(msg, ws) {
  if (msg.type === MSG.SESSION_START) {
    const { prompt, projectSlug, templateId, variables } = msg.payload || {};
    if (!prompt) {
      ws.send(makeMsg(MSG.SESSION_ERROR, { error: 'No prompt provided' }));
      return;
    }
    if (!projectSlug) {
      ws.send(makeMsg(MSG.SESSION_ERROR, { error: 'No project selected' }));
      return;
    }

    let predefinedPlan;
    if (templateId) {
      // Sanitize templateId — alphanumeric, hyphens, and underscores only
      if (!/^[a-zA-Z0-9_-]+$/.test(templateId)) {
        ws.send(makeMsg(MSG.SESSION_ERROR, { error: 'Invalid template ID (alphanumeric, hyphens, underscores only)' }));
        return;
      }
      try {
        const templatesDir = resolve(process.cwd(), 'templates');
        const templatePath = join(templatesDir, `${templateId}.json`);
        const raw = await fs.readFile(templatePath, 'utf8');
        const template = JSON.parse(raw);

        if (!Array.isArray(template.tasks)) {
          ws.send(makeMsg(MSG.SESSION_ERROR, { error: `Template "${templateId}" is invalid (missing tasks array)` }));
          return;
        }

        const vars = variables && typeof variables === 'object' ? variables : {};
        const tasks = template.tasks.map((task) => {
          const t = { ...task };
          if (typeof t.description === 'string' && vars && Object.keys(vars).length > 0) {
            let desc = t.description;
            for (const [key, value] of Object.entries(vars)) {
              const token = `{{${key}}}`;
              if (desc.includes(token)) {
                const replacement = value == null ? '' : String(value);
                desc = desc.split(token).join(replacement);
              }
            }
            t.description = desc;
          }
          return t;
        });

        predefinedPlan = { ...template, tasks };
      } catch (err) {
        log.error(`[session] Failed to load template "${templateId}": ${err.message}`);
        ws.send(makeMsg(MSG.SESSION_ERROR, { error: `Failed to load template "${templateId}"` }));
        return;
      }
    }

    await startSession(prompt, projectSlug, predefinedPlan);
  }
  if (msg.type === MSG.SELFDEV_START) {
    const { featureName, prompt, usePlanner } = msg.payload || {};
    if (!prompt) {
      ws.send(makeMsg(MSG.SESSION_ERROR, { error: 'No prompt provided' }));
      return;
    }
    if (!featureName) {
      ws.send(makeMsg(MSG.SESSION_ERROR, { error: 'No featureName provided' }));
      return;
    }
    const repoRoot = process.cwd();
    const projectSlug = `selfdev-${featureName}`;

    // Create a dedicated project pointing at the repo root
    let project = workspace.getProject(projectSlug);
    if (!project) {
      try {
        project = workspace.linkProject(projectSlug, repoRoot);
      } catch (err) {
        // If slug collision, just reuse existing
        project = workspace.getProject(projectSlug);
        if (!project) {
          log.error(`[selfdev] Failed to link project: ${err.message}`);
          ws.send(makeMsg(MSG.SESSION_ERROR, { error: err.message }));
          return;
        }
      }
    }

    // Planner mode: research before implementing
    if (usePlanner) {
      try {
        broadcast(makeMsg(MSG.CHAT_RESPONSE, {
          projectSlug,
          role: 'assistant',
          content: `🔬 Planner mode: researching "${featureName}" with T3 model...`,
        }));
        const research = await plan(prompt, repoRoot);
        broadcast(makeMsg(MSG.PLAN_RESEARCH, { projectSlug, research }));
        broadcast(makeMsg(MSG.CHAT_RESPONSE, {
          projectSlug,
          role: 'assistant',
          content: `📋 **Plan: ${research.summary}**\n\n` +
            `Approach: ${research.approach}\n` +
            `Complexity: ${research.complexity} (~${research.estimatedTasks} tasks)\n` +
            `Recommendation: ${research.recommendation}\n` +
            `Risks: ${research.risks?.join(', ') || 'None identified'}\n` +
            `Files: ${[...(research.affectedFiles || []), ...(research.newFiles || [])].join(', ')}`,
        }));

        if (research.recommendation === 'defer' || research.recommendation === 'redesign') {
          broadcast(makeMsg(MSG.CHAT_RESPONSE, {
            projectSlug,
            role: 'assistant',
            content: `⚠️ Planner recommends **${research.recommendation}**: ${research.reasoning}`,
          }));
          return;
        }
      } catch (err) {
        log.error(`[planner] Research failed: ${err.message}`);
        broadcast(makeMsg(MSG.CHAT_RESPONSE, {
          projectSlug,
          role: 'assistant',
          content: `⚠️ Planner research failed, proceeding directly to implementation...`,
        }));
      }
    }

    try {
      await startSession(prompt, projectSlug);
    } catch (err) {
      log.error(`[selfdev] Error during self-dev session: ${err.message}`);
      ws.send(makeMsg(MSG.SESSION_ERROR, { error: err.message }));
      return;
    }
    // Report changes
    broadcast(makeMsg(MSG.SELFDEV_DIFF, { featureName, projectSlug }));
  }
  if (msg.type === MSG.CHAT_MESSAGE) {
    const { message, projectSlug } = msg.payload;
    if (message && projectSlug) {
      await handleChatMessage(message, projectSlug);
    }
  }
  if (msg.type === MSG.RECONNECT_SYNC) {
    const { projectSlug } = msg.payload || {};
    const ctx = activeContexts.get(projectSlug);
    if (ctx) {
      const session = sessions.get(ctx.sessionId);
      ws.send(makeMsg(MSG.RECONNECT_SYNC, {
        projectSlug,
        plan: ctx.plan,
        tasks: ctx.taskStatuses,
        sessionStatus: session?.status,
      }));
    }
  }
  if (msg.type === MSG.GATE_RESPONSE) {
    const { taskId, approved, feedback } = msg.payload || {};
    // Forward gate response to active task runner
    for (const [, ctx] of activeContexts) {
      if (ctx.taskRunner) {
        ctx.taskRunner.resolveGate(taskId, approved, feedback);
      }
    }
  }
}

async function startSession(userPrompt, projectSlug, predefinedPlan) {
  // Resolve workspace for this project
  const project = workspace.getProject(projectSlug);
  if (!project) {
    broadcast(makeMsg(MSG.SESSION_ERROR, { error: `Project "${projectSlug}" not found` }));
    return;
  }

  // Phase 2: Load persistent skills and project settings
  const skills = workspace.getSkills(projectSlug);
  const settings = workspace.getProjectSettings(projectSlug);
  const overrides = {
    escalation: settings.escalation,
    maxRetriesTotal: settings.maxRetriesTotal,
    pinnedModels: settings.pinnedModels,
    // Phase 4: Wire up settings that were previously ignored
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

  /** @type {Array<{timestamp: number, type: 'task:status'|'agent:status'|'verify:status', data: object}>> */
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
    // Step 1: Analyze workspace for context injection (Phase 4)
    let workspaceAnalysis = null;
    if (!DEMO && !predefinedPlan) {
      try {
        const { analyzeWorkspace } = await import('./workspaceAnalyzer.js');
        workspaceAnalysis = await analyzeWorkspace(workDir);
        log.info(`[session] Workspace analysis: ${workspaceAnalysis.summary}`);
      } catch (err) {
        log.warn(`[session] Workspace analysis failed (non-fatal): ${err.message}`);
      }
    }

    // Store analysis on session for agent prompt injection
    const stored0 = sessions.get(sessionId);
    if (stored0) stored0.workspaceAnalysis = workspaceAnalysis;

    // Step 2: Decompose prompt into tasks via orchestrator
    const plan = predefinedPlan || (DEMO
      ? await decomposeMock(userPrompt)
      : await decompose(userPrompt, workDir, { skills, workspaceAnalysis }));

    const stored = sessions.get(sessionId);
    stored.plan = plan;
    stored.status = 'running';

    // Index tasks for timeline attribution
    if (Array.isArray(plan.tasks)) {
      for (const task of plan.tasks) {
        if (task?.id) taskToSession.set(task.id, sessionId);
      }
    }

    // Build edges for the graph from dependencies
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

    // Step 2: Execute tasks via TaskRunner
    const agentManager = new AgentManager(broadcast, DEMO, { skills, overrides, workspaceAnalysis });
    // Filter out TaskRunner's own session:complete — we send it explicitly after verification
    // Also intercept DAG_REWRITE to add a chat message
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
    const taskRunner = new TaskRunner(plan, agentManager, taskRunnerBroadcast, workDir, { overrides });

    // Store taskRunner reference for gate responses
    const earlyCtx = { sessionId, workDir, plan, agentManager, taskRunner, history: [] };
    activeContexts.set(projectSlug, earlyCtx);

    await taskRunner.run();
    taskRunner.cleanup(); // Stop stall-check interval

    // Step 3: Verify & Fix Loop — orchestrator reviews and spawns parallel fix agents
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

    // Session complete — keep context alive for chat
    stored.status = 'completed';
    stored.completedAt = Date.now();
    const costSummaryData = agentManager.getCostSummary?.() || null;

    // Store context for post-completion chat
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
    }));

    // Persist session result into the workspace
    workspace.finalizeSession(projectSlug, sessionId, {
      status: 'completed',
      tasks: plan.tasks,
      edges,
      agents: agentManager.getSessionSnapshot(),
      costSummary: costSummaryData,
      timeline,
      snapshot, // Phase 5.2: Pre-session snapshot metadata for rollback
    });
    releaseLock(workDir, sessionId);

    // Phase 2: Post-session analysis — extract skills and generate reflection
    try {
      const reflection = generateReflection(plan, agentManager, costSummaryData, session);
      workspace.saveReflection(projectSlug, sessionId, reflection);
      broadcast(makeMsg(MSG.REFLECTION_CREATED, { projectSlug, sessionId, reflection }));

      // Extract and save discovered skills from agent outputs
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
  }
}

/**
 * Verify-Fix feedback loop: verify → decompose fixes → parallel fix agents → re-verify.
 * Fix tasks are added as real nodes in the DAG for full visibility.
 * @param {object} opts - { sessionId, projectSlug, plan, edges, agentManager, workDir, maxRounds, fixCounter }
 */
async function runVerifyFixLoop({ sessionId, projectSlug, plan, edges, agentManager, workDir, maxRounds = 3, fixCounter = { n: 0 }, skills }) {
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
      return; // Done — passed or no fixes possible
    }

    // ── Found issues → spawn parallel fix agents ──
    broadcast(makeMsg(MSG.VERIFICATION_STATUS, {
      sessionId,
      status: 'fixing',
      message: `Found ${verifyResult.issues.length} issue(s) — spawning ${verifyResult.followUpTasks.length} parallel fix agent(s)...`,
      issues: verifyResult.issues,
    }));

    // Namespace fix task IDs to avoid collisions
    const fixTasks = verifyResult.followUpTasks.map(t => ({
      ...t,
      id: `fix-${++fixCounter.n}-${t.id}`,
      dependencies: t.dependencies.map(d => `fix-${fixCounter.n}-${d}`),
    }));

    // Index fix tasks for timeline attribution
    for (const task of fixTasks) {
      if (task?.id) taskToSession.set(task.id, sessionId);
    }

    // Find current leaf task IDs (tasks nobody depends on)
    const depTargets = new Set(plan.tasks.flatMap(t => t.dependencies || []));
    const leafTaskIds = plan.tasks
      .filter(t => t.type !== 'prompt' && !depTargets.has(t.id))
      .map(t => t.id);

    // Root fix tasks (no internal deps) → depend on all previous leaves
    for (const task of fixTasks) {
      if (task.dependencies.length === 0) {
        task.dependencies = [...leafTaskIds];
      }
    }

    // Build edges for new fix tasks
    const newEdges = [];
    for (const task of fixTasks) {
      for (const depId of (task.dependencies || [])) {
        newEdges.push({ id: `${depId}->${task.id}`, source: depId, target: task.id });
      }
    }

    // Append to plan and broadcast
    plan.tasks.push(...fixTasks);
    edges.push(...newEdges);

    broadcast(makeMsg(MSG.PLAN_CREATED, {
      sessionId,
      projectSlug,
      tasks: fixTasks,
      edges: newEdges,
      append: true,
    }));

    // Execute fix tasks in parallel (suppress TaskRunner session:complete)
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

  // Exhausted rounds
  broadcast(makeMsg(MSG.VERIFICATION_STATUS, {
    sessionId,
    status: 'warning',
    message: `Verification loop exhausted after ${maxRounds} rounds — some issues may remain`,
  }));
}

/**
 * Handle a follow-up chat message — decompose into new tasks, extend the DAG, execute.
 */
async function handleChatMessage(message, projectSlug) {
  const ctx = activeContexts.get(projectSlug);
  if (!ctx) {
    broadcast(makeMsg(MSG.CHAT_RESPONSE, {
      projectSlug,
      role: 'assistant',
      content: 'No active session for this project. Start a new session first.',
    }));
    return;
  }

  ctx.iterationCount = (ctx.iterationCount || 0) + 1;
  const iterNum = ctx.iterationCount;
  const promptNodeId = `__prompt_${iterNum}__`;

  // Notify client: iteration starting
  broadcast(makeMsg(MSG.ITERATION_START, {
    projectSlug,
    iterationId: iterNum,
    prompt: message,
  }));

  try {
    // ── Find current leaf tasks (no other task depends on them) ──
    const dependedOn = new Set();
    for (const t of ctx.plan.tasks) {
      for (const dep of (t.dependencies || [])) {
        dependedOn.add(dep);
      }
    }
    const leafTaskIds = ctx.plan.tasks
      .filter(t => t.type !== 'prompt' && !dependedOn.has(t.id))
      .map(t => t.id);

    // ── Decompose the message with prior-work context ──
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

    // ── Namespace task IDs so they don't collide with previous iterations ──
    for (const task of plan.tasks) {
      const oldId = task.id;
      task.id = `iter-${iterNum}-${oldId}`;
      task.dependencies = task.dependencies.map(d => `iter-${iterNum}-${d}`);
    }

    // ── Create the prompt node (bridge between iterations) ──
    const promptNode = {
      id: promptNodeId,
      type: 'prompt',
      label: message.length > 50 ? message.slice(0, 47) + '...' : message,
      prompt: message,
      description: message,
      dependencies: leafTaskIds,
    };

    // Root tasks of new iteration → depend on the prompt node
    const rootTasks = plan.tasks.filter(t => t.dependencies.length === 0);
    for (const task of rootTasks) {
      task.dependencies.push(promptNodeId);
    }

    // ── Build edges ──
    const allNewTasks = [promptNode, ...plan.tasks];

    // Index iteration tasks for timeline attribution
    for (const task of allNewTasks) {
      if (task?.id) taskToSession.set(task.id, ctx.sessionId);
    }

    const allNewEdges = [];
    for (const task of allNewTasks) {
      for (const depId of (task.dependencies || [])) {
        allNewEdges.push({ id: `${depId}->${task.id}`, source: depId, target: task.id });
      }
    }

    // ── Broadcast appended plan ──
    broadcast(makeMsg(MSG.PLAN_CREATED, {
      sessionId: ctx.sessionId,
      projectSlug,
      tasks: allNewTasks,
      edges: allNewEdges,
      append: true,
      iterationId: iterNum,
    }));

    log.info(`[iteration ${iterNum}] ${plan.tasks.length} tasks → executing...`);

    // ── Execute with TaskRunner (suppress its session:complete) ──
    // Strip prompt-node dependency so TaskRunner can resolve the DAG
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
    taskRunner.cleanup(); // Stop stall-check interval

    // ── Verify & Fix Loop ──
    if (!DEMO) {
      // Merge iteration tasks into ctx.plan before verifying so the loop sees the full DAG
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

    // ── Update context for next iteration ──
    ctx.history.push({ role: 'user', content: message });
    ctx.history.push({ role: 'assistant', content: `Completed ${plan.tasks.length} tasks for: ${message}` });

    // ── Broadcast iteration complete ──
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
  }
}

// ═══════════════════════════════════════════════════════════
//  Phase 2: Post-session analysis helpers
// ═══════════════════════════════════════════════════════════

/**
 * Generate a reflection summary from a completed session.
 */
function generateReflection(plan, agentManager, costSummary, session) {
  const agents = [...agentManager.agents.values()];
  const tasks = plan.tasks.filter(t => t.type !== 'prompt');

  const succeeded = agents.filter(a => a.status === 'success');
  const failed = agents.filter(a => a.status === 'failed');
  const totalRetries = agents.reduce((sum, a) => sum + a.retries, 0);
  const duration = session.createdAt
    ? Date.now() - session.createdAt
    : null;

  // Identify which tiers were used
  const tierUsage = {};
  for (const agent of agents) {
    tierUsage[agent.modelTier] = (tierUsage[agent.modelTier] || 0) + 1;
  }

  // Identify tasks that needed escalation (retries > 0 on their last agent)
  const escalatedTasks = [];
  const taskAgents = {};
  for (const agent of agents) {
    if (!taskAgents[agent.taskId] || agent.retries > taskAgents[agent.taskId].retries) {
      taskAgents[agent.taskId] = agent;
    }
  }
  for (const [taskId, agent] of Object.entries(taskAgents)) {
    if (agent.retries > 0) {
      const task = tasks.find(t => t.id === taskId);
      escalatedTasks.push({
        taskId,
        label: task?.label || taskId,
        retriesNeeded: agent.retries,
        finalTier: agent.modelTier,
      });
    }
  }

  return {
    status: failed.length > succeeded.length ? 'mostly-failed' : 'mostly-succeeded',
    durationMs: duration,
    taskCount: tasks.length,
    agentCount: agents.length,
    successCount: succeeded.length,
    failCount: failed.length,
    retryRate: agents.length > 0 ? +(totalRetries / agents.length).toFixed(2) : 0,
    tierUsage,
    escalatedTasks,
    costSummary: costSummary || null,
  };
}

/**
 * Extract discoverable skills from agent output (build/test/lint commands).
 */
function extractSkills(agentManager) {
  const allOutput = [...agentManager.agents.values()]
    .flatMap(a => a.output)
    .join('\n');

  const skills = {
    buildCommands: [],
    testCommands: [],
    lintCommands: [],
    patterns: [],
  };

  // Match common command patterns from agent outputs
  const buildPatterns = [
    /(?:npm|yarn|pnpm)\s+run\s+build/g,
    /(?:npm|yarn|pnpm)\s+run\s+dev/g,
    /tsc\b/g,
    /vite\s+build/g,
    /webpack\b/g,
    /cargo\s+build/g,
    /go\s+build/g,
    /make\b(?:\s+\w+)?/g,
    /python\s+setup\.py\s+build/g,
    /pip\s+install/g,
  ];

  const testPatterns = [
    /(?:npm|yarn|pnpm)\s+(?:run\s+)?test/g,
    /(?:npx\s+)?(?:jest|vitest|mocha|playwright|pytest|cargo\s+test|go\s+test)/g,
    /node\s+--test/g,
  ];

  const lintPatterns = [
    /(?:npm|yarn|pnpm)\s+run\s+lint/g,
    /(?:npx\s+)?(?:eslint|prettier|biome|rustfmt)/g,
  ];

  for (const pat of buildPatterns) {
    const matches = allOutput.match(pat);
    if (matches) skills.buildCommands.push(...matches);
  }
  for (const pat of testPatterns) {
    const matches = allOutput.match(pat);
    if (matches) skills.testCommands.push(...matches);
  }
  for (const pat of lintPatterns) {
    const matches = allOutput.match(pat);
    if (matches) skills.lintCommands.push(...matches);
  }

  // Deduplicate
  skills.buildCommands = [...new Set(skills.buildCommands)];
  skills.testCommands = [...new Set(skills.testCommands)];
  skills.lintCommands = [...new Set(skills.lintCommands)];

  return skills;
}

// ═══════════════════════════════════════════════════════════
//  REST API — Project management
// ═══════════════════════════════════════════════════════════

/** List all projects */
app.get('/api/projects', (req, res) => {
  res.json(workspace.listProjects());
});

/** Get a single project */
app.get('/api/projects/:slug', (req, res) => {
  const project = workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(project);
});

/** Create a new project */
app.post('/api/projects', (req, res) => {
  const { name, description, slug } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const project = workspace.createProject(name, { description, slug });
    res.status(201).json(project);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

/** Link an existing directory as a project */
app.post('/api/projects/link', (req, res) => {
  const { name, directory } = req.body;
  if (!name || !directory) {
    return res.status(400).json({ error: 'Name and directory are required' });
  }
  try {
    const project = workspace.linkProject(name, directory);
    res.status(201).json(project);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

/** Delete a project */
app.delete('/api/projects/:slug', (req, res) => {
  try {
    workspace.deleteProject(req.params.slug);
    res.json({ deleted: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/** List sessions for a project */
app.get('/api/projects/:slug/sessions', (req, res) => {
  const sessionList = workspace.listSessions(req.params.slug);
  // Return lightweight list (no full agent output)
  res.json(sessionList.map(s => {
    const agentCount = s.agents ? Object.keys(s.agents).length : 0;
    const totalCost = s.costSummary?.totalPremiumRequests || 0;
    const taskSummary = Array.isArray(s.tasks)
      ? s.tasks.map(t => {
          // Find the latest agent for this task to get its status
          let status = 'pending';
          if (s.agents) {
            const agents = Object.values(s.agents).filter(a => a.taskId === t.id);
            if (agents.length > 0) {
              const latest = agents.sort((a, b) => (b.retries || 0) - (a.retries || 0))[0];
              status = latest.status || 'pending';
            }
          }
          return { label: t.label, status };
        })
      : [];

    return {
      id: s.id,
      prompt: s.prompt,
      status: s.status,
      startedAt: s.createdAt,
      completedAt: s.completedAt,
      costSummary: s.costSummary,
      taskCount: Array.isArray(s.tasks) ? s.tasks.length : 0,
      agentCount,
      totalCost,
      taskSummary,
    };
  }));
});

/** Get a single session with full data (DAG, agents, outputs) */
app.get('/api/projects/:slug/sessions/:sessionId', (req, res) => {
  const session = workspace.getSession(req.params.slug, req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

/** Phase 5.1: Get per-task output summaries for a session */
app.get('/api/projects/:slug/sessions/:sessionId/summaries', (req, res) => {
  const session = workspace.getSession(req.params.slug, req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const taskSummaries = {};
  const agents = session.agents || {};

  for (const [agentId, agent] of Object.entries(agents)) {
    const taskId = agent.taskId;
    if (!taskId) continue;

    // Use stored summary or generate on-the-fly
    const summary = agent.summary || (agent.output?.length > 0 ? summarizeOutput(agent.output) : null);

    if (!taskSummaries[taskId]) {
      taskSummaries[taskId] = {
        taskId,
        taskLabel: (session.tasks || []).find(t => t.id === taskId)?.label || taskId,
        agents: [],
      };
    }

    taskSummaries[taskId].agents.push({
      agentId,
      model: agent.model,
      modelTier: agent.modelTier,
      status: agent.status,
      retries: agent.retries,
      summary,
    });
  }

  res.json(Object.values(taskSummaries));
});

/** Phase 5.2: Rollback a session's workspace changes */
app.post('/api/projects/:slug/sessions/:sessionId/rollback', async (req, res) => {
  const project = workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const session = workspace.getSession(req.params.slug, req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (!session.snapshot || session.snapshot.type === 'none') {
    return res.status(400).json({ error: 'No snapshot available for this session' });
  }

  const workDir = project.dir;
  // Don't allow rollback if a session is currently running on this workspace
  const lockEntry = workDirLocks.get(workDir);
  if (lockEntry) {
    return res.status(409).json({ error: 'Cannot rollback while a session is running on this workspace' });
  }

  const result = await rollbackToSnapshot(workDir, session.snapshot);
  if (result.success) {
    res.json({ rolledBack: true, message: result.message });
  } else {
    res.status(500).json({ error: result.message });
  }
});

/** Phase 5.2: Get diff between pre-session snapshot and current state */
app.get('/api/projects/:slug/sessions/:sessionId/diff', (req, res) => {
  const project = workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const session = workspace.getSession(req.params.slug, req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (!session.snapshot || session.snapshot.type !== 'git-tag') {
    return res.json({ files: [], summary: 'No git snapshot available for diff' });
  }

  const diff = getSnapshotDiff(project.dir, session.snapshot);
  res.json(diff || { files: [], summary: 'Unable to compute diff' });
});

/** Start a session (REST fallback for non-WS clients) */
app.post('/api/projects/:slug/sessions', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });
  startSession(prompt, req.params.slug);
  res.json({ status: 'started', project: req.params.slug });
});

// ═══════════════════════════════════════════════════════════
//  REST API — Phase 2: Skills, Reflections, Settings
// ═══════════════════════════════════════════════════════════

/** Get project skills */
app.get('/api/projects/:slug/skills', (req, res) => {
  const project = workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(workspace.getSkills(req.params.slug));
});

/** Update project skills (merge) */
app.put('/api/projects/:slug/skills', (req, res) => {
  const project = workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const merged = workspace.saveSkills(req.params.slug, req.body);
  broadcast(makeMsg(MSG.SKILLS_UPDATE, { projectSlug: req.params.slug, skills: merged }));
  res.json(merged);
});

/** Get project reflections */
app.get('/api/projects/:slug/reflections', (req, res) => {
  const project = workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const limit = parseInt(req.query.limit) || 20;
  res.json(workspace.getReflections(req.params.slug, limit));
});

/** Get project settings */
app.get('/api/projects/:slug/settings', (req, res) => {
  const project = workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(workspace.getProjectSettings(req.params.slug));
});

/** Update project settings (shallow merge) */
app.put('/api/projects/:slug/settings', (req, res) => {
  const project = workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const updated = workspace.updateProjectSettings(req.params.slug, req.body);
  broadcast(makeMsg(MSG.SETTINGS_UPDATE, { projectSlug: req.params.slug, settings: updated }));
  res.json(updated);
});

// Phase 4: Workspace analysis endpoint
app.get('/api/projects/:slug/analysis', async (req, res) => {
  const project = workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    const { analyzeWorkspace } = await import('./workspaceAnalyzer.js');
    const analysis = await analyzeWorkspace(project.dir);
    res.json({
      summary: analysis.summary,
      fileTree: analysis.fileTree,
      techStack: analysis.techStack,
      entryPoints: analysis.entryPoints,
      dependencies: analysis.dependencies,
      conventions: analysis.conventions,
    });
  } catch (err) {
    res.status(500).json({ error: `Analysis failed: ${err.message}` });
  }
});

// ── Utility routes ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    sessions: sessions.size,
    projects: workspace.listProjects().length,
    clients: clients.size,
    activeLocks: workDirLocks.size,
  });
});

app.get('/api/templates', async (req, res) => {
  try {
    const entries = await readdir(TEMPLATES_DIR, { withFileTypes: true });
    const templates = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry) => {
          try {
            const content = await readFile(join(TEMPLATES_DIR, entry.name), 'utf8');
            const parsed = JSON.parse(content);
            const { name, description, stack, variables, tasks } = parsed;
            const id = entry.name.replace(/\.json$/, '');
            return { id, name, description, stack, variables, tasks };
          } catch (err) {
            log.error(`[templates] Failed to load template ${entry.name}:`, err.message);
            return null;
          }
        }),
    );

    res.json(templates.filter(Boolean));
  } catch (err) {
    log.error('[templates] Error reading templates directory:', err.message);
    res.status(500).json({ error: 'Failed to load templates' });
  }
});

// POST /api/templates — create a new template
app.post('/api/templates', async (req, res) => {
  try {
    const { name, description, stack, variables, tasks } = req.body || {};
    if (!name || !tasks || !Array.isArray(tasks)) {
      return res.status(400).json({ error: 'name and tasks[] are required' });
    }
    // Derive id from name
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!id) return res.status(400).json({ error: 'Invalid template name' });

    const filePath = join(TEMPLATES_DIR, `${id}.json`);
    // Don't overwrite existing templates
    if (existsSync(filePath)) {
      return res.status(409).json({ error: 'Template already exists', id });
    }

    const template = { name, description: description || '', stack: stack || '', variables: variables || [], tasks };
    await fs.writeFile(filePath, JSON.stringify(template, null, 2), 'utf8');
    log.info(`[templates] Created template: ${id}`);
    res.status(201).json({ id, ...template });
  } catch (err) {
    log.error('[templates] Error creating template:', err.message);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// ── Backend REST API (Phase 5.8) ──
import { listBackends } from './backends/index.js';
import SwarmManager, { createSwarm } from './swarm/index.js';

app.get('/api/backends', (_req, res) => {
  const names = listBackends();
  const result = names.map(name => ({
    name,
    active: name === config.defaultBackend,
    config: config.backends?.[name] || {},
  }));
  res.json(result);
});

app.get('/api/backends/active', (_req, res) => {
  res.json({ name: config.defaultBackend });
});

app.put('/api/backends/active', (req, res) => {
  const { name } = req.body || {};
  if (!name || !listBackends().includes(name)) {
    return res.status(400).json({ error: `Unknown backend: "${name}". Available: ${listBackends().join(', ')}` });
  }
  config.defaultBackend = name;
  res.json({ ok: true, name });
});

app.get('/api/backends/:name', (req, res) => {
  const { name } = req.params;
  if (!listBackends().includes(name)) {
    return res.status(404).json({ error: `Backend "${name}" not found` });
  }
  res.json({ name, config: config.backends?.[name] || {} });
});

app.put('/api/backends/:name', (req, res) => {
  const { name } = req.params;
  if (!listBackends().includes(name)) {
    return res.status(404).json({ error: `Backend "${name}" not found` });
  }
  if (!config.backends) config.backends = {};
  config.backends[name] = { ...(config.backends[name] || {}), ...(req.body || {}) };
  res.json({ ok: true, name, config: config.backends[name] });
});

// ── Swarm REST API (Phase 5.8) ──
let swarmInstance = config.swarm?.enabled ? createSwarm(config.swarm) : null;

app.get('/api/swarm', (_req, res) => {
  res.json({
    enabled: !!config.swarm?.enabled,
    totalCapacity: swarmInstance?.totalCapacity() ?? 0,
    runners: swarmInstance?.runners.map((r, i) => ({
      index: i,
      type: r.type,
      capacity: r.capacity(),
    })) ?? [],
    description: swarmInstance?.describe() ?? 'disabled',
  });
});

app.put('/api/swarm', (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled === 'boolean') {
    if (!config.swarm) config.swarm = { enabled: false, runners: [] };
    config.swarm.enabled = enabled;
    if (enabled && !swarmInstance) {
      swarmInstance = createSwarm(config.swarm);
    } else if (!enabled) {
      swarmInstance = null;
    }
  }
  res.json({
    ok: true,
    enabled: !!config.swarm?.enabled,
    totalCapacity: swarmInstance?.totalCapacity() ?? 0,
  });
});

app.get('/api/swarm/runners', (_req, res) => {
  if (!swarmInstance) return res.json([]);
  res.json(swarmInstance.runners.map((r, i) => ({
    index: i,
    type: r.type,
    capacity: r.capacity(),
  })));
});

// ── Plugin REST API (Phase 5.7) ──
app.get('/api/plugins', (_req, res) => {
  res.json(pluginManager.list());
});

app.post('/api/plugins/:name/enable', async (req, res) => {
  try {
    await pluginManager.enable(req.params.name);
    res.json({ ok: true, name: req.params.name, enabled: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/api/plugins/:name/disable', async (req, res) => {
  try {
    await pluginManager.disable(req.params.name);
    res.json({ ok: true, name: req.params.name, enabled: false });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/api/plugins/:name/reload', async (req, res) => {
  try {
    const entry = await pluginManager.reload(req.params.name);
    res.json({ ok: true, name: entry.name, version: entry.version });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ── Serve built client in production (when client/dist exists) ──
const clientDist = join(__dirname, '..', 'client', 'dist');
import('node:fs').then(({ existsSync }) => {
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    // SPA fallback — serve index.html for any non-API route
    app.get(/^(?!\/api|\/ws).*/, (_req, res) => {
      res.sendFile(join(clientDist, 'index.html'));
    });
    log.info('[server] Serving built client from client/dist/');
  }
});

// ── Start server ──
server.listen(config.port, () => {
  const projects = workspace.listProjects();
  log.info(`\n🐝 hAIvemind server running on http://localhost:${config.port}`);
  if (DEMO) log.info('   ⚡ DEMO MODE — using mock agents');
  log.info(`   WebSocket: ws://localhost:${config.port}/ws`);
  log.info(`   Orchestrator: ${config.tierDefaults[config.orchestratorTier]} (${config.orchestratorTier})`);
  log.info(`   Escalation:   ${config.escalation.join(' → ')}`);
  log.info(`   Projects:     ${projects.length} registered`);
  if (projects.length) {
    for (const p of projects) {
      log.info(`     • ${p.slug} — ${p.name}${p.linked ? ' (linked)' : ''}`);
    }
  }
  log.info();

  // Phase 5.7: Load plugins at startup
  if (config.plugins?.autoLoad !== false) {
    pluginManager.loadAll().catch(err => {
      log.warn(`[plugins] Auto-load failed: ${err.message}`);
    });
  }
});

pruneIntervalId = setInterval(pruneCompletedSessions, 5 * 60 * 1000);

// ── Phase 5.0: Interrupted session recovery on startup ──
(async function recoverInterruptedSessions() {
  try {
    const interruptedDir = join(workspace.baseDir, '.haivemind', 'interrupted');
    const files = await fs.readdir(interruptedDir).catch(() => []);
    if (files.length > 0) {
      log.info(`[recovery] Found ${files.length} interrupted session(s)`);
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(join(interruptedDir, file), 'utf-8');
        const data = JSON.parse(raw);
        log.info(`  ↳ ${data.sessionId?.slice(0, 8)} (${data.projectSlug}) — ${data.incompleteTasks?.length || 0} incomplete tasks`);
      } catch { /* skip corrupt files */ }
    }
  } catch { /* no interrupted dir, fine */ }
})();

// ── Phase 5.0: Interrupted sessions REST API ──
app.get('/api/interrupted-sessions', async (req, res) => {
  try {
    const interruptedDir = join(workspace.baseDir, '.haivemind', 'interrupted');
    const files = await fs.readdir(interruptedDir).catch(() => []);
    const results = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(join(interruptedDir, file), 'utf-8');
        results.push(JSON.parse(raw));
      } catch { /* skip */ }
    }
    res.json(results);
  } catch {
    res.json([]);
  }
});

app.post('/api/interrupted-sessions/:id/discard', async (req, res) => {
  try {
    const interruptedDir = join(workspace.baseDir, '.haivemind', 'interrupted');
    const filePath = join(interruptedDir, `${req.params.id}.json`);
    await fs.unlink(filePath);
    res.json({ discarded: true });
  } catch (err) {
    res.status(404).json({ error: 'Interrupted session not found' });
  }
});

app.post('/api/interrupted-sessions/:id/resume', async (req, res) => {
  try {
    const interruptedDir = join(workspace.baseDir, '.haivemind', 'interrupted');
    const filePath = join(interruptedDir, `${req.params.id}.json`);
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);

    // Delete the interrupted file since we're resuming
    await fs.unlink(filePath).catch(() => {});

    // Re-submit incomplete tasks as a new session
    const incompleteTasks = data.incompleteTasks || [];
    if (incompleteTasks.length === 0) {
      return res.json({ resumed: false, reason: 'No incomplete tasks' });
    }

    const resumePrompt = `Resume interrupted session: ${data.prompt}\n\nThe following tasks were incomplete and need to be re-executed:\n${incompleteTasks.map(t => `- ${t.label} (was: ${t.status})`).join('\n')}`;

    // Start a new session with the resume prompt
    broadcast(makeMsg(MSG.SESSION_RESUMED, { originalSessionId: data.sessionId, projectSlug: data.projectSlug }));

    // Fire and forget — the session runs asynchronously
    startSession(resumePrompt, data.projectSlug).catch(err => {
      log.error(`[recovery] Failed to resume session ${data.sessionId}: ${err.message}`);
    });

    res.json({ resumed: true, projectSlug: data.projectSlug, incompleteTasks: incompleteTasks.length });
  } catch (err) {
    res.status(404).json({ error: 'Interrupted session not found' });
  }
});

async function gracefulShutdown() {
  log.info('\n🛑 Graceful shutdown initiated...');

  // 1. Warn connected clients
  broadcast(makeMsg(MSG.SHUTDOWN_WARNING, { message: 'Server is shutting down', timestamp: Date.now() }));

  // 2. Persist all active (running) sessions to disk
  const interruptedDir = join(workspace.baseDir, '.haivemind', 'interrupted');
  await fs.mkdir(interruptedDir, { recursive: true }).catch(() => {});

  let savedCount = 0;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.status !== 'running') continue;

    try {
      // Mark session as interrupted
      session.status = 'interrupted';

      // Build interrupted state
      const incompleteTasks = session.plan?.tasks?.filter(t => t.status !== 'done' && t.status !== 'passed') || [];
      const snapshot = {
        sessionId,
        projectSlug: session.projectSlug,
        prompt: session.prompt || session.userPrompt || '',
        status: 'interrupted',
        interruptedAt: Date.now(),
        incompleteTasks: incompleteTasks.map(t => ({
          id: t.id,
          label: t.label,
          status: t.status,
          dependencies: t.dependencies,
        })),
        completedTasks: (session.plan?.tasks || [])
          .filter(t => t.status === 'done' || t.status === 'passed')
          .map(t => ({ id: t.id, label: t.label })),
        timeline: (session.timeline || []).slice(-100), // Last 100 events only
      };

      const filePath = join(interruptedDir, `${sessionId}.json`);
      await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2));
      savedCount++;
      log.info(`  💾 Saved interrupted session: ${sessionId.slice(0, 8)} (${incompleteTasks.length} incomplete tasks)`);

      // Release workspace lock
      if (session.workDir) {
        releaseLock(session.workDir, sessionId);
      }
    } catch (err) {
      log.error(`  ❌ Failed to save session ${sessionId.slice(0, 8)}: ${err.message}`);
    }
  }

  if (savedCount > 0) {
    log.info(`  📁 ${savedCount} session(s) saved to ${interruptedDir}`);
  }

  // 3. Kill all running agents across all active contexts
  const killPromises = [];
  for (const [, ctx] of activeContexts) {
    if (ctx.agentManager) {
      killPromises.push(ctx.agentManager.killAll());
    }
    // Clean up task runner intervals
    if (ctx.taskRunner?.cleanup) {
      try { ctx.taskRunner.cleanup(); } catch { /* already cleaned */ }
    }
  }

  // Wait for agent kills with a timeout
  if (killPromises.length > 0) {
    log.info(`  🔪 Killing ${killPromises.length} agent manager(s)...`);
    await Promise.allSettled(killPromises);
  }

  // 4. Clear intervals
  clearInterval(pruneIntervalId);
  clearInterval(heartbeatInterval);

  // 4.5 Notify plugins of shutdown
  await pluginManager.emit('onShutdown').catch(() => {});

  // 5. Close connections
  wss.close();
  server.close(() => {
    log.info('  ✅ Server shutdown complete\n');
    process.exit(0);
  });

  // Force exit after 10 seconds if graceful close hangs
  setTimeout(() => {
    log.error('  ⚠️  Forced exit after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
