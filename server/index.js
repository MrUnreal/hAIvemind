import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import config from './config.js';
import { MSG, makeMsg, parseMsg } from '../shared/protocol.js';
import AgentManager from './agentManager.js';
import { decompose, verify, plan } from './orchestrator.js';
import { decomposeMock } from './mock.js';
import TaskRunner from './taskRunner.js';
import WorkspaceManager from './workspace.js';
import { prepareSelfDevWorkspace, getWorktreeDiffSummary } from './selfDev.js';

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

function broadcast(msg) {
  const parsed = parseMsg(msg);
  if (parsed && (parsed.type === MSG.TASK_STATUS || parsed.type === MSG.AGENT_STATUS || parsed.type === MSG.VERIFICATION_STATUS)) {
    recordTimelineEvent(parsed.type, parsed.payload);
  }
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

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

  session.timeline.push({
    timestamp: Date.now(),
    type: msgType,
    data: payload || {},
  });
}

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[ws] Client connected (${clients.size} total)`);

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[ws] Client disconnected (${clients.size} total)`);
  });

  ws.on('message', (raw) => {
    const msg = parseMsg(raw.toString());
    if (!msg) return;
    handleClientMessage(msg, ws);
  });
});

// ── Sessions ──
/** @type {Map<string, object>} */
const sessions = new Map();

/** Map from taskId to sessionId for timeline attribution */
const taskToSession = new Map();

/** Active orchestrator contexts (for post-completion chat) */
const activeContexts = new Map();

async function handleClientMessage(msg, ws) {
  if (msg.type === MSG.SESSION_START) {
    const { prompt, projectSlug } = msg.payload;
    if (!prompt) {
      ws.send(makeMsg(MSG.SESSION_ERROR, { error: 'No prompt provided' }));
      return;
    }
    if (!projectSlug) {
      ws.send(makeMsg(MSG.SESSION_ERROR, { error: 'No project selected' }));
      return;
    }
    await startSession(prompt, projectSlug);
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
          console.error(`[selfdev] Failed to link project: ${err.message}`);
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
        console.error(`[planner] Research failed: ${err.message}`);
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
      console.error(`[selfdev] Error during self-dev session: ${err.message}`);
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

async function startSession(userPrompt, projectSlug) {
  // Resolve workspace for this project
  const project = workspace.getProject(projectSlug);
  if (!project) {
    broadcast(makeMsg(MSG.SESSION_ERROR, { error: `Project "${projectSlug}" not found` }));
    return;
  }

  const { sessionId, workDir, session } = workspace.startSession(projectSlug, userPrompt);
  /** @type {Array<{timestamp: number, type: 'task:status'|'agent:status'|'verify:status', data: object}>> */
  const timeline = [];
  sessions.set(sessionId, { ...session, workDir, projectSlug, timeline });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[session] New session: ${sessionId.slice(0, 8)}`);
  console.log(`[session] Project:    ${projectSlug} → ${workDir}`);
  console.log(`[session] Prompt:     "${userPrompt.slice(0, 100)}..."`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    // Step 1: Decompose prompt into tasks via orchestrator
    // Note: file tree injection disabled for now — it causes orchestrator output truncation.
    // Agents have --add-dir and can explore the codebase themselves.
    const plan = DEMO
      ? await decomposeMock(userPrompt)
      : await decompose(userPrompt, workDir);

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
    const agentManager = new AgentManager(broadcast, DEMO);
    // Filter out TaskRunner's own session:complete — we send it explicitly after verification
    const taskRunnerBroadcast = (msg) => {
      const parsed = parseMsg(msg);
      if (parsed?.type === MSG.SESSION_COMPLETE) return;
      broadcast(msg);
    };
    const taskRunner = new TaskRunner(plan, agentManager, taskRunnerBroadcast, workDir);

    // Store taskRunner reference for gate responses
    const earlyCtx = { sessionId, workDir, plan, agentManager, taskRunner, history: [] };
    activeContexts.set(projectSlug, earlyCtx);

    await taskRunner.run();

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
      });
    }

    // Session complete — keep context alive for chat
    stored.status = 'completed';
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
    });

  } catch (err) {
    console.error(`[session] Error: ${err.message}`);
    const stored = sessions.get(sessionId);
    if (stored) stored.status = 'failed';

    broadcast(makeMsg(MSG.SESSION_ERROR, {
      sessionId,
      projectSlug,
      error: err.message,
    }));

    workspace.finalizeSession(projectSlug, sessionId, { status: 'failed', timeline });
  }
}

/**
 * Verify-Fix feedback loop: verify → decompose fixes → parallel fix agents → re-verify.
 * Fix tasks are added as real nodes in the DAG for full visibility.
 * @param {object} opts - { sessionId, projectSlug, plan, edges, agentManager, workDir, maxRounds, fixCounter }
 */
async function runVerifyFixLoop({ sessionId, projectSlug, plan, edges, agentManager, workDir, maxRounds = 3, fixCounter = { n: 0 } }) {
  for (let round = 0; round < maxRounds; round++) {
    broadcast(makeMsg(MSG.VERIFICATION_STATUS, {
      sessionId,
      status: 'running',
      message: round === 0 ? 'Verifying project integrity...' : `Re-verifying after fixes (round ${round + 1})...`,
    }));

    const verifyResult = await verify(plan, workDir);

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

    console.log(`[verify-fix] Round ${round + 1} fixes applied — re-verifying...`);
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

    console.log(`[iteration ${iterNum}] Decomposing: "${message.slice(0, 80)}..."`);

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

    console.log(`[iteration ${iterNum}] ${plan.tasks.length} tasks → executing...`);

    // ── Execute with TaskRunner (suppress its session:complete) ──
    // Strip prompt-node dependency so TaskRunner can resolve the DAG
    const runnerPlan = {
      tasks: plan.tasks.map(t => ({
        ...t,
        dependencies: t.dependencies.filter(d => d !== promptNodeId),
      })),
    };
    const agentManager = new AgentManager(broadcast, DEMO);
    const filteredBroadcast = (msg) => {
      const parsed = parseMsg(msg);
      if (parsed?.type === MSG.SESSION_COMPLETE) return;
      broadcast(msg);
    };
    const taskRunner = new TaskRunner(runnerPlan, agentManager, filteredBroadcast, ctx.workDir);
    await taskRunner.run();

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

    console.log(`[iteration ${iterNum}] Complete`);

  } catch (err) {
    console.error(`[iteration ${iterNum}] Error:`, err.message);
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

/** Start a session (REST fallback for non-WS clients) */
app.post('/api/projects/:slug/sessions', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });
  startSession(prompt, req.params.slug);
  res.json({ status: 'started', project: req.params.slug });
});

// ── Utility routes ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    sessions: sessions.size,
    projects: workspace.listProjects().length,
    clients: clients.size,
  });
});

// ── Start server ──
server.listen(config.port, () => {
  const projects = workspace.listProjects();
  console.log(`\n🐝 hAIvemind server running on http://localhost:${config.port}`);
  if (DEMO) console.log('   ⚡ DEMO MODE — using mock agents');
  console.log(`   WebSocket: ws://localhost:${config.port}/ws`);
  console.log(`   Orchestrator: ${config.tierDefaults[config.orchestratorTier]} (${config.orchestratorTier})`);
  console.log(`   Escalation:   ${config.escalation.join(' → ')}`);
  console.log(`   Projects:     ${projects.length} registered`);
  if (projects.length) {
    for (const p of projects) {
      console.log(`     • ${p.slug} — ${p.name}${p.linked ? ' (linked)' : ''}`);
    }
  }
  console.log();
});
