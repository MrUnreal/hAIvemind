#!/usr/bin/env node

/**
 * Phase 5.3 — hAIvemind CLI (Headless Operation)
 *
 * Usage:
 *   node bin/haivemind.js projects                         List all projects
 *   node bin/haivemind.js status <slug>                    Show project sessions
 *   node bin/haivemind.js build <slug> "<prompt>"          Run a session headlessly
 *   node bin/haivemind.js replay <slug> <sessionId>        Show session details
 *   node bin/haivemind.js --json ...                       JSON output mode
 *   node bin/haivemind.js --mock ...                       Mock/demo mode
 *
 * Reuses the same orchestrator/agentManager/taskRunner as the web UI —
 * just a different I/O surface (stdout/stderr instead of WebSocket).
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Colour helpers ─────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

function coloured(colour, text) {
  return `${colour}${text}${C.reset}`;
}

// ── Arg parsing (zero-deps) ───────────────────────────────────────────────

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      flags[key] = rest.length ? rest.join('=') : true;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

const { flags, positional } = parseArgs(process.argv.slice(2));
const JSON_MODE = !!flags.json;
const MOCK = !!flags.mock;
const command = positional[0] || 'help';

// ── Import backend modules (lazy, after arg parse) ────────────────────────

async function loadBackend() {
  // Ensure we load from project root
  process.chdir(ROOT);

  if (MOCK) {
    process.argv.push('--mock');
  }

  const { default: WorkspaceManager } = await import('../server/workspace.js');
  const { default: config } = await import('../server/config.js');
  const { MSG } = await import('../shared/protocol.js');

  return { WorkspaceManager, config, MSG };
}

async function loadOrchestration() {
  const { decompose, verify } = await import('../server/orchestrator.js');
  const { decomposeMock } = await import('../server/mock.js');
  const { default: AgentManager } = await import('../server/agentManager.js');
  const { default: TaskRunner } = await import('../server/taskRunner.js');
  const { createSnapshot } = await import('../server/snapshot.js');
  const { summarizeOutput, summaryToContext } = await import('../server/outputSummarizer.js');

  return { decompose, decomposeMock, verify, AgentManager, TaskRunner, createSnapshot, summarizeOutput, summaryToContext };
}

// ── Output helpers ────────────────────────────────────────────────────────

function out(obj) {
  if (JSON_MODE) {
    console.log(JSON.stringify(obj, null, 2));
  }
}

function log(msg) {
  if (!JSON_MODE) {
    console.log(msg);
  }
}

function logErr(msg) {
  console.error(coloured(C.red, `✗ ${msg}`));
}

// ── Commands ──────────────────────────────────────────────────────────────

async function cmdHelp() {
  log(`
${coloured(C.bold + C.cyan, 'hAIvemind CLI')} — headless session orchestrator

${coloured(C.bold, 'Usage:')}
  haivemind ${coloured(C.green, 'projects')}                           List all projects
  haivemind ${coloured(C.green, 'status')} <slug>                      Show project sessions
  haivemind ${coloured(C.green, 'build')} <slug> "<prompt>"            Run a session headlessly
  haivemind ${coloured(C.green, 'autopilot')} <slug>                    Run continuous self-improvement
  haivemind ${coloured(C.green, 'replay')} <slug> <sessionId>          Show session detail
  haivemind ${coloured(C.green, 'help')}                               Show this help

${coloured(C.bold, 'Flags:')}
  --mock       Run in demo/mock mode (no real agents)
  --json       Output JSON instead of human-readable text
  --cycles=N   Max autopilot cycles (default: 3)
`);
}

async function cmdProjects() {
  const { WorkspaceManager } = await loadBackend();
  const workspace = new WorkspaceManager();
  const projects = workspace.listProjects();

  if (JSON_MODE) {
    out(projects);
    return;
  }

  log(coloured(C.bold, `\n  Projects (${projects.length}):\n`));
  for (const p of projects) {
    const linked = p.linked ? coloured(C.green, '●') : coloured(C.dim, '○');
    const sessions = (p.sessions || []).length;
    log(`  ${linked} ${coloured(C.bold, p.slug)}  ${coloured(C.dim, `(${sessions} sessions)`)}`);
  }
  log('');
}

async function cmdStatus() {
  const slug = positional[1];
  if (!slug) { logErr('Usage: haivemind status <project-slug>'); process.exit(1); }

  const { WorkspaceManager } = await loadBackend();
  const workspace = new WorkspaceManager();
  const project = workspace.getProject(slug);

  if (!project) { logErr(`Project "${slug}" not found`); process.exit(1); }

  const sessions = workspace.listSessions(slug);

  if (JSON_MODE) {
    out({ project: { slug: project.slug, name: project.name, linked: project.linked }, sessions });
    return;
  }

  log(coloured(C.bold, `\n  ${project.name}`));
  log(`  ${coloured(C.dim, project.dir || 'no directory linked')}\n`);

  if (sessions.length === 0) {
    log('  No sessions yet.\n');
    return;
  }

  for (const s of sessions.slice(-20)) {
    const icon = s.status === 'completed' ? coloured(C.green, '✓')
      : s.status === 'failed' ? coloured(C.red, '✗')
        : coloured(C.yellow, '…');
    const tasks = s.tasks ? ` (${s.tasks.length} tasks)` : '';
    log(`  ${icon} ${coloured(C.dim, s.id.slice(0, 8))}  ${s.prompt?.slice(0, 60) || '(no prompt)'}${tasks}`);
  }
  log('');
}

async function cmdReplay() {
  const slug = positional[1];
  const sessionId = positional[2];
  if (!slug || !sessionId) { logErr('Usage: haivemind replay <slug> <sessionId>'); process.exit(1); }

  const { WorkspaceManager } = await loadBackend();
  const workspace = new WorkspaceManager();
  const session = workspace.getSession(slug, sessionId);

  if (!session) { logErr(`Session "${sessionId}" not found in "${slug}"`); process.exit(1); }

  if (JSON_MODE) {
    out(session);
    return;
  }

  log(coloured(C.bold, `\n  Session ${session.id}`));
  log(`  Status: ${session.status}`);
  log(`  Prompt: ${session.prompt || '(none)'}`);
  if (session.tasks) {
    log(`\n  ${coloured(C.bold, 'Tasks:')}`);
    for (const t of session.tasks) {
      const icon = t.status === 'done' ? coloured(C.green, '✓')
        : t.status === 'failed' ? coloured(C.red, '✗')
          : coloured(C.yellow, '…');
      log(`    ${icon} ${t.label || t.id}`);
    }
  }
  if (session.costSummary) {
    log(`\n  Cost: ${JSON.stringify(session.costSummary)}`);
  }
  log('');
}

async function cmdBuild() {
  const slug = positional[1];
  const prompt = positional[2];
  if (!slug || !prompt) {
    logErr('Usage: haivemind build <slug> "<prompt>"');
    process.exit(1);
  }

  const { WorkspaceManager, MSG } = await loadBackend();
  const { decompose, decomposeMock, verify, AgentManager, TaskRunner, createSnapshot } = await loadOrchestration();

  const DEMO = MOCK;
  const workspace = new WorkspaceManager();
  const project = workspace.getProject(slug);
  if (!project) { logErr(`Project "${slug}" not found`); process.exit(1); }

  // ─── broadcast shim — writes to stdout instead of WebSocket ──────
  function broadcast(msgObj) {
    const type = msgObj?.type || msgObj?.t;
    const payload = msgObj?.payload || msgObj?.p;

    if (JSON_MODE) {
      console.log(JSON.stringify({ event: type, ...payload }));
      return;
    }

    switch (type) {
      case MSG.PLAN_CREATED:
        log(coloured(C.bold + C.cyan, '\n  ═══ Plan Created ═══'));
        for (const t of payload?.tasks || []) {
          log(`    → ${coloured(C.white, t.label || t.id)}`);
        }
        log('');
        break;

      case MSG.TASK_STATUS: {
        const s = payload?.status;
        const icon = s === 'done' ? coloured(C.green, '✓')
          : s === 'failed' ? coloured(C.red, '✗')
            : s === 'running' ? coloured(C.yellow, '▸')
              : coloured(C.dim, '·');
        log(`  ${icon} [task] ${payload?.label || payload?.taskId || '?'}  →  ${s}`);
        break;
      }

      case MSG.AGENT_STATUS: {
        const s = payload?.status;
        const icon = s === 'complete' ? coloured(C.green, '●')
          : s === 'failed' ? coloured(C.red, '●')
            : coloured(C.blue, '○');
        log(`    ${icon} [agent] ${payload?.agentId?.slice(0, 8) || '?'}  ${s}  ${coloured(C.dim, payload?.tier || '')}`);
        break;
      }

      case MSG.AGENT_OUTPUT:
        // Stream raw agent output in dim
        if (payload?.chunk) {
          const lines = payload.chunk.split('\n').filter(Boolean);
          for (const line of lines.slice(-3)) {
            process.stdout.write(coloured(C.dim, `      │ ${line}\n`));
          }
        }
        break;

      case MSG.VERIFY_STATUS:
        if (payload?.status) {
          log(`  ${coloured(C.magenta, '⟐')} [verify] ${payload.status}`);
        }
        break;

      case MSG.SESSION_COMPLETE:
        log(coloured(C.bold + C.green, '\n  ═══ Session Complete ═══'));
        if (payload?.costSummary) {
          log(`  Agents: ${payload.costSummary.totalAgents}, Premium: ${payload.costSummary.totalPremiumRequests}`);
        }
        log('');
        break;

      case MSG.SESSION_ERROR:
        logErr(`Session error: ${payload?.error || 'unknown'}`);
        break;

      default:
        // Other events — silent in human mode
        break;
    }
  }

  // ─── Run the same orchestration loop as the web server ──────────
  const startTime = Date.now();

  log(coloured(C.bold + C.cyan, `\n  hAIvemind build: ${slug}`));
  log(`  Prompt: ${prompt}`);
  log(`  Mode: ${DEMO ? 'mock' : 'live'}\n`);

  let exitCode = 0;

  try {
    // 1. Start session
    const { sessionId, workDir, session } = workspace.startSession(slug, prompt);
    log(`  Session: ${coloured(C.dim, sessionId)}`);
    log(`  WorkDir: ${coloured(C.dim, workDir)}\n`);

    // 2. Snapshot
    const snapshot = await createSnapshot(workDir, sessionId);
    if (snapshot.type !== 'none') {
      log(`  Snapshot: ${coloured(C.green, snapshot.type)} (${snapshot.ref})`);
    }

    // 3. Load project skills + settings
    const skills = workspace.getSkills(slug);
    const overrides = workspace.getProjectSettings(slug);

    // 4. Decompose
    log(coloured(C.yellow, '  Decomposing prompt...'));
    let plan;
    if (DEMO) {
      plan = await decomposeMock(prompt);
    } else {
      plan = await decompose(prompt, workDir, { skills });
    }

    const tasks = plan.tasks || [];
    const edges = [];
    for (const t of tasks) {
      for (const dep of (t.dependencies || [])) {
        edges.push({ source: dep, target: t.id });
      }
    }

    broadcast({ type: MSG.PLAN_CREATED, payload: { tasks, edges } });

    // 5. Create agent manager + task runner
    const agentManager = new AgentManager(broadcast, DEMO, { skills, overrides });
    const taskRunner = new TaskRunner(plan, agentManager, broadcast, workDir, { overrides });

    // 6. Run DAG
    await taskRunner.run();

    // 7. Verify (up to 3 rounds, non-mock only)
    if (!DEMO) {
      for (let round = 0; round < 3; round++) {
        broadcast({ type: MSG.VERIFY_STATUS, payload: { status: 'running', round } });
        const result = await verify(plan, workDir, { skills });

        if (result.passed) {
          broadcast({ type: MSG.VERIFY_STATUS, payload: { status: 'passed' } });
          break;
        } else {
          broadcast({ type: MSG.VERIFY_STATUS, payload: { status: 'fixing', issues: result.issues } });
          // Spawn fix agents for follow-up tasks
          for (const fixTask of (result.followUpTasks || [])) {
            await agentManager.spawn(fixTask, 0, workDir);
          }
        }
      }
    }

    // 8. Gather cost summary
    const costSummary = agentManager.getCostSummary();

    // 9. Finalize
    const finalTasks = tasks.map(t => ({ ...t }));
    const agents = agentManager.getSessionSnapshot();

    workspace.finalizeSession(slug, sessionId, {
      status: 'completed',
      tasks: finalTasks,
      edges,
      agents,
      costSummary,
      snapshot,
    });

    broadcast({ type: MSG.SESSION_COMPLETE, payload: { costSummary } });

    // Check for any failed tasks
    const failedTasks = finalTasks.filter(t => t.status === 'failed');
    if (failedTasks.length > 0) {
      exitCode = 1;
    }

    // Cleanup
    taskRunner.cleanup();
    await agentManager.killAll();

  } catch (err) {
    logErr(err.message || String(err));
    exitCode = 1;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(coloured(C.dim, `  Elapsed: ${elapsed}s\n`));

  if (JSON_MODE) {
    out({ exitCode, elapsed: parseFloat(elapsed) });
  }

  process.exit(exitCode);
}

// ── Auto-Pilot ────────────────────────────────────────────────────────────

async function cmdAutopilot() {
  const slug = positional[1];
  const maxCycles = parseInt(flags.cycles || '3', 10);

  if (!slug) {
    logErr('Usage: haivemind autopilot <slug> [--cycles=N] [--mock]');
    process.exit(1);
  }

  const { WorkspaceManager, MSG } = await loadBackend();
  const { decompose, decomposeMock, verify, AgentManager, TaskRunner, createSnapshot } = await loadOrchestration();
  const { runAutopilotCycle } = await import('../server/autopilot.js');

  const DEMO = MOCK;
  const workspace = new WorkspaceManager();
  const project = workspace.getProject(slug);
  if (!project) { logErr(`Project "${slug}" not found`); process.exit(1); }

  log(coloured(C.bold + C.cyan, `\n  hAIvemind Autopilot: ${slug}`));
  log(`  Max cycles: ${maxCycles}`);
  log(`  Mode: ${DEMO ? 'mock' : 'live'}\n`);

  // session runner — reuses the same orchestration as cmdBuild
  async function runSession(_slug, prompt) {
    const skills = workspace.getSkills(_slug);
    const overrides = workspace.getProjectSettings(_slug);
    const { sessionId, workDir } = workspace.startSession(_slug, prompt);

    const snapshot = await createSnapshot(workDir, sessionId);
    const broadcastNoop = () => {}; // silent in autopilot

    let plan;
    if (DEMO) {
      plan = await decomposeMock(prompt);
    } else {
      plan = await decompose(prompt, workDir, { skills });
    }

    const agentManager = new AgentManager(broadcastNoop, DEMO, { skills, overrides });
    const taskRunner = new TaskRunner(plan, agentManager, broadcastNoop, workDir, { overrides });

    await taskRunner.run();
    const costSummary = agentManager.getCostSummary();
    const finalTasks = (plan.tasks || []).map(t => ({ ...t }));
    const edges = [];
    for (const t of plan.tasks || []) {
      for (const dep of (t.dependencies || [])) {
        edges.push({ source: dep, target: t.id });
      }
    }

    workspace.finalizeSession(_slug, sessionId, {
      status: 'completed',
      tasks: finalTasks,
      edges,
      agents: agentManager.getSessionSnapshot(),
      costSummary,
      snapshot,
    });

    taskRunner.cleanup();
    await agentManager.killAll();

    const failedTasks = finalTasks.filter(t => t.status === 'failed');
    return {
      exitCode: failedTasks.length > 0 ? 1 : 0,
      sessionId,
      costSummary,
    };
  }

  const result = await runAutopilotCycle({
    workspace,
    slug,
    runSession,
    planFn: null, // Use fallback planner (no T3 call in MVP)
    config: { maxCycles },
    log: (msg) => log(coloured(C.dim, msg)),
  });

  log(coloured(C.bold + C.green, `\n  Autopilot complete`));
  log(`  Cycles: ${result.cycles}`);
  log(`  Stopped: ${result.stopped}\n`);

  if (JSON_MODE) {
    out(result);
  }

  process.exit(0);
}

// ── Dispatch ──────────────────────────────────────────────────────────────

const commands = {
  help: cmdHelp,
  projects: cmdProjects,
  status: cmdStatus,
  build: cmdBuild,
  replay: cmdReplay,
  autopilot: cmdAutopilot,
};

const handler = commands[command];
if (!handler) {
  logErr(`Unknown command: "${command}". Run "haivemind help" for usage.`);
  process.exit(1);
}

handler().catch(err => {
  logErr(err.message || String(err));
  process.exit(1);
});
