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
  haivemind ${coloured(C.green, 'dashboard')} <slug> "<prompt>"        Build with live terminal dashboard
  haivemind ${coloured(C.green, 'intelligence')} <slug>                Show intelligence/learning stats
  haivemind ${coloured(C.green, 'providers')}                          Show provider health status
  haivemind ${coloured(C.green, 'security-scan')} "<text>"             Scan text for injections/credentials
  haivemind ${coloured(C.green, 'replay')} <slug> <sessionId>          Show session detail
  haivemind ${coloured(C.green, 'init')} [name]                        Create a new project (interactive)
  haivemind ${coloured(C.green, 'watch')} <slug> [--ext=js,ts]         Watch for file changes and trigger builds
  haivemind ${coloured(C.green, 'export')} <slug>                      Export project archive to stdout
  haivemind ${coloured(C.green, 'import')} <file>                      Import project from archive file
  haivemind ${coloured(C.green, 'completions')} [bash|zsh|fish|ps]     Print shell completions
  haivemind ${coloured(C.green, 'help')}                               Show this help

${coloured(C.bold, 'Flags:')}
  --mock       Run in demo/mock mode (no real agents)
  --json       Output JSON instead of human-readable text
  --cycles=N   Max autopilot cycles (default: 3)
  --ext=...    File extensions to watch (default: js,ts,vue,json,md)
  --debounce=N Watch debounce in ms (default: 500)
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

// ── Init — Interactive Project Creation ───────────────────────────────────

async function cmdInit() {
  const { WorkspaceManager } = await loadBackend();
  const workspace = new WorkspaceManager();

  let name = positional[1] || '';
  let description = '';

  // Interactive prompt only if stdin is a TTY and name not provided
  if (!name && process.stdin.isTTY) {
    const { createInterface } = await import('node:readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(resolve => rl.question(q, resolve));

    name = await ask(coloured(C.cyan, '  Project name: '));
    if (!name.trim()) {
      logErr('Project name is required');
      rl.close();
      process.exit(1);
    }
    if (!JSON_MODE) {
      description = await ask(coloured(C.cyan, '  Description (optional): '));
    }
    rl.close();
  }

  if (!name) {
    logErr('Usage: haivemind init <name>');
    process.exit(1);
  }

  try {
    // Suppress workspace console.log noise in JSON mode
    const origLog = console.log;
    if (JSON_MODE) console.log = () => {};

    const project = workspace.createProject(name.trim(), {
      description: description.trim() || undefined,
    });

    if (JSON_MODE) console.log = origLog;

    if (JSON_MODE) {
      out(project);
    } else {
      log('');
      log(coloured(C.green, `  ✓ Project created: ${project.slug}`));
      log(coloured(C.dim, `    ${project.dir}`));
      log('');
      log(`  Next steps:`);
      log(`    haivemind build ${project.slug} "your prompt"`);
      log(`    haivemind watch ${project.slug}`);
      log('');
    }
  } catch (err) {
    logErr(err.message);
    process.exit(1);
  }
}

// ── Watch — File-Change Trigger ──────────────────────────────────────────

async function cmdWatch() {
  const slug = positional[1];
  if (!slug) {
    logErr('Usage: haivemind watch <slug> [--ext=js,ts] [--debounce=500]');
    process.exit(1);
  }

  const { WorkspaceManager } = await loadBackend();
  const { watch: fsWatch } = await import('node:fs');
  const { join: joinPath, extname } = await import('node:path');
  const workspace = new WorkspaceManager();
  const project = workspace.getProject(slug);

  if (!project) { logErr(`Project "${slug}" not found`); process.exit(1); }

  const extensions = new Set(
    (flags.ext || 'js,ts,vue,json,md').split(',').map(e => `.${e.replace(/^\./, '')}`)
  );
  const debounceMs = parseInt(flags.debounce || '500', 10);
  const watchDir = project.dir;

  log(coloured(C.bold + C.cyan, `\n  hAIvemind Watch: ${slug}`));
  log(`  Directory: ${coloured(C.dim, watchDir)}`);
  log(`  Extensions: ${[...extensions].join(', ')}`);
  log(`  Debounce: ${debounceMs}ms`);
  log(coloured(C.dim, '  Press Ctrl+C to stop\n'));

  let debounceTimer = null;
  let changeCount = 0;
  const pendingChanges = new Set();

  function handleChange(eventType, filename) {
    if (!filename) return;
    // Skip .haivemind internal files and node_modules
    if (filename.includes('.haivemind') || filename.includes('node_modules')) return;
    const ext = extname(filename);
    if (!extensions.has(ext)) return;

    pendingChanges.add(filename);
    clearTimeout(debounceTimer);

    debounceTimer = setTimeout(() => {
      changeCount++;
      const files = [...pendingChanges];
      pendingChanges.clear();

      log(coloured(C.yellow, `  [${changeCount}] Change detected: ${files.join(', ')}`));

      if (JSON_MODE) {
        out({ event: 'change', files, count: changeCount, timestamp: Date.now() });
      }
    }, debounceMs);
  }

  try {
    fsWatch(watchDir, { recursive: true }, handleChange);
  } catch (err) {
    logErr(`Watch failed: ${err.message}`);
    process.exit(1);
  }

  // Keep alive
  process.on('SIGINT', () => {
    log(coloured(C.dim, `\n  Stopped after ${changeCount} change events\n`));
    process.exit(0);
  });

  // Return a promise that never resolves (keeps the process alive)
  await new Promise(() => {});
}

// ── Export — Project Archive ─────────────────────────────────────────────

async function cmdExport() {
  const slug = positional[1];
  if (!slug) {
    logErr('Usage: haivemind export <slug>');
    process.exit(1);
  }

  const { WorkspaceManager } = await loadBackend();
  const workspace = new WorkspaceManager();
  const { refs } = await import('../server/state.js');
  refs.workspace = workspace;

  const { exportProject } = await import('../server/services/projectExport.js');
  const archive = exportProject(slug);

  if (!archive) {
    logErr(`Project "${slug}" not found`);
    process.exit(1);
  }

  // Always output JSON (the archive IS JSON)
  console.log(JSON.stringify(archive, null, 2));
}

// ── Import — Project Archive ─────────────────────────────────────────────

async function cmdImport() {
  const filePath = positional[1];
  if (!filePath) {
    logErr('Usage: haivemind import <archive-file.json>');
    process.exit(1);
  }

  const { readFileSync: readFs } = await import('node:fs');
  const { resolve: resolvePath } = await import('node:path');

  let archive;
  try {
    const raw = readFs(resolvePath(filePath), 'utf-8');
    archive = JSON.parse(raw);
  } catch (err) {
    logErr(`Failed to read archive: ${err.message}`);
    process.exit(1);
  }

  const { WorkspaceManager } = await loadBackend();
  const workspace = new WorkspaceManager();
  const { refs } = await import('../server/state.js');
  refs.workspace = workspace;

  const { importProject, validateArchive } = await import('../server/services/projectExport.js');

  const validation = validateArchive(archive);
  if (!validation.valid) {
    logErr(`Invalid archive: ${validation.errors.join(', ')}`);
    process.exit(1);
  }

  // Suppress console.log from workspace during import in JSON mode
  const origLog = console.log;
  if (JSON_MODE) console.log = () => {};

  const result = importProject(archive, {
    conflictStrategy: flags.strategy || 'skip',
    targetSlug: flags.slug || undefined,
    targetName: flags.name || undefined,
  });

  if (JSON_MODE) console.log = origLog;

  if (JSON_MODE) {
    out(result);
  } else {
    if (result.ok) {
      log(coloured(C.green, `  ✓ Imported: ${result.slug}`));
      log(`    Created: ${result.created}`);
      log(`    Sessions imported: ${result.sessionsImported}`);
      if (result.warnings.length) {
        for (const w of result.warnings) log(coloured(C.yellow, `    ⚠ ${w}`));
      }
    } else {
      logErr(`Import failed: ${result.warnings?.join(', ') || 'unknown error'}`);
      process.exit(1);
    }
  }
}

// ── Shell Completions ────────────────────────────────────────────────────

async function cmdCompletions() {
  const shell = positional[1] || 'bash';

  const COMMANDS = 'projects status build dashboard autopilot replay init watch export import intelligence providers security-scan completions help';

  const scripts = {
    bash: `# hAIvemind bash completions — add to ~/.bashrc
_haivemind() {
  local cur=\${COMP_WORDS[COMP_CWORD]}
  local commands="${COMMANDS}"
  COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
}
complete -F _haivemind haivemind`,

    zsh: `# hAIvemind zsh completions — add to ~/.zshrc
_haivemind() {
  local commands=(${COMMANDS.split(' ').map(c => `'${c}'`).join(' ')})
  _describe 'command' commands
}
compdef _haivemind haivemind`,

    fish: `# hAIvemind fish completions — save to ~/.config/fish/completions/haivemind.fish
${COMMANDS.split(' ').map(c => `complete -c haivemind -n '__fish_use_subcommand' -a '${c}'`).join('\n')}`,

    ps: `# hAIvemind PowerShell completions — add to $PROFILE
Register-ArgumentCompleter -CommandName haivemind -ScriptBlock {
  param($wordToComplete)
  @(${COMMANDS.split(' ').map(c => `'${c}'`).join(',')}) | Where-Object { $_ -like "$wordToComplete*" }
}`,
  };

  const script = scripts[shell];
  if (!script) {
    logErr(`Unknown shell: ${shell}. Supported: bash, zsh, fish, ps`);
    process.exit(1);
  }

  console.log(script);
}

// ── Dispatch ──────────────────────────────────────────────────────────────

// ── Dashboard — Live Terminal Dashboard ──────────────────────────────────

async function cmdDashboard() {
  const slug = positional[1];
  const prompt = positional[2];
  if (!slug || !prompt) {
    logErr('Usage: haivemind dashboard <slug> "<prompt>"');
    process.exit(1);
  }

  const { WorkspaceManager, MSG } = await loadBackend();
  const { decompose, decomposeMock, verify, AgentManager, TaskRunner, createSnapshot } = await loadOrchestration();
  const { TerminalDashboard, createDashboardBroadcast } = await import('../server/services/cliDashboard.js');

  const DEMO = MOCK;
  const workspace = new WorkspaceManager();
  const project = workspace.getProject(slug);
  if (!project) { logErr(`Project "${slug}" not found`); process.exit(1); }

  const dashboard = new TerminalDashboard({ slug });
  const broadcast = createDashboardBroadcast(dashboard, MSG);

  dashboard.start();
  dashboard.updateStatus('running');

  let exitCode = 0;

  try {
    const { sessionId, workDir } = workspace.startSession(slug, prompt);
    dashboard.addLog(`Session ${sessionId.slice(0, 8)}`);

    const snapshot = await createSnapshot(workDir, sessionId);
    if (snapshot.type !== 'none') dashboard.addLog(`Snapshot: ${snapshot.type}`);

    const skills = workspace.getSkills(slug);
    const overrides = workspace.getProjectSettings(slug);

    dashboard.addLog('Decomposing...');
    let plan;
    if (DEMO) {
      plan = await decomposeMock(prompt);
    } else {
      plan = await decompose(prompt, workDir, { skills });
    }

    const tasks = plan.tasks || [];
    const edges = [];
    for (const t of tasks) {
      for (const dep of (t.dependencies || [])) edges.push({ source: dep, target: t.id });
    }

    broadcast({ type: MSG.PLAN_CREATED, payload: { tasks, edges } });

    const agentManager = new AgentManager(broadcast, DEMO, { skills, overrides });
    const taskRunner = new TaskRunner(plan, agentManager, broadcast, workDir, { overrides });

    await taskRunner.run();

    if (!DEMO) {
      for (let round = 0; round < 3; round++) {
        broadcast({ type: MSG.VERIFY_STATUS, payload: { status: 'running', round } });
        const result = await verify(plan, workDir, { skills });
        if (result.passed) {
          broadcast({ type: MSG.VERIFY_STATUS, payload: { status: 'passed' } });
          break;
        }
        for (const fixTask of (result.followUpTasks || [])) {
          await agentManager.spawn(fixTask, 0, workDir);
        }
      }
    }

    const costSummary = agentManager.getCostSummary();
    const finalTasks = tasks.map(t => ({ ...t }));
    workspace.finalizeSession(slug, sessionId, {
      status: 'completed', tasks: finalTasks, edges,
      agents: agentManager.getSessionSnapshot(), costSummary, snapshot,
    });

    broadcast({ type: MSG.SESSION_COMPLETE, payload: { costSummary } });

    const failedTasks = finalTasks.filter(t => t.status === 'failed');
    if (failedTasks.length > 0) exitCode = 1;

    taskRunner.cleanup();
    await agentManager.killAll();
  } catch (err) {
    dashboard.addLog(`ERROR: ${err.message}`);
    dashboard.updateStatus('failed');
    exitCode = 1;
  }

  // Keep dashboard visible for 2 seconds before exit
  await new Promise(r => setTimeout(r, 2000));
  dashboard.stop();
  process.exit(exitCode);
}

// ── Intelligence — Show Learning Stats ───────────────────────────────────

async function cmdIntelligence() {
  const slug = positional[1];
  if (!slug) { logErr('Usage: haivemind intelligence <slug>'); process.exit(1); }

  const { getVectorStats } = await import('../server/services/vectorMemory.js');
  const { getRoutingStats } = await import('../server/services/taskRouter.js');
  const { getGraphStats } = await import('../server/services/knowledgeGraph.js');

  const vectorStats = getVectorStats(slug);
  const routingStats = getRoutingStats(slug);
  let graphStats;
  try {
    const { getGraph } = await import('../server/services/knowledgeGraph.js');
    const graph = getGraph(slug);
    graphStats = graph ? { nodes: graph.nodeCount, edges: graph.edgeCount, mostConnected: graph.getMostConnected(3) } : null;
  } catch {
    graphStats = null;
  }

  if (JSON_MODE) {
    out({ vectorMemory: vectorStats, taskRouting: routingStats, knowledgeGraph: graphStats });
    return;
  }

  log(coloured(C.bold + C.cyan, `\n  Intelligence Stats: ${slug}\n`));

  // Vector Memory
  log(coloured(C.bold, '  Vector Memory'));
  if (vectorStats) {
    log(`    Vectors: ${vectorStats.size || 0}`);
    log(`    Dimensions: ${vectorStats.dimensions || 128}`);
  } else {
    log(coloured(C.dim, '    No vector index for this project'));
  }
  log('');

  // Task Routing
  log(coloured(C.bold, '  Task Routing'));
  log(`    Total decisions: ${routingStats.totalDecisions || 0}`);
  log(`    Explorations: ${routingStats.explorations || 0}`);
  const cats = routingStats.categories || {};
  for (const [cat, models] of Object.entries(cats)) {
    log(`    ${coloured(C.cyan, cat)}:`);
    for (const m of models) {
      const rate = Math.round((m.successRate || 0) * 100);
      const color = rate >= 80 ? C.green : rate >= 50 ? C.yellow : C.red;
      log(`      ${coloured(color, `${rate}%`)} ${m.model} (${m.total} tasks, avg ${Math.round(m.avgDuration || 0)}ms)`);
    }
  }
  log('');

  // Knowledge Graph
  log(coloured(C.bold, '  Knowledge Graph'));
  if (graphStats) {
    log(`    Nodes: ${graphStats.nodes}`);
    log(`    Edges: ${graphStats.edges}`);
    if (graphStats.mostConnected?.length) {
      log('    Most connected:');
      for (const n of graphStats.mostConnected) {
        log(`      ${n.id} (${n.degree} connections)`);
      }
    }
  } else {
    log(coloured(C.dim, '    No knowledge graph for this project'));
  }
  log('');
}

// ── Providers — Show Provider Health ─────────────────────────────────────

async function cmdProviders() {
  const { getProviderHealthStatus, TIER_PROVIDER_MAP } = await import('../server/services/providerFailover.js');
  const { registry } = await import('../server/backends/index.js');

  const status = getProviderHealthStatus();

  if (JSON_MODE) {
    out({ providers: status, tierMap: Object.fromEntries(Object.entries(TIER_PROVIDER_MAP).map(([k, v]) => [k, v])), registeredBackends: [...registry.keys()] });
    return;
  }

  log(coloured(C.bold + C.cyan, '\n  Provider Status\n'));

  // Registered backends
  log(coloured(C.bold, '  Registered Backends'));
  for (const name of registry.keys()) {
    log(`    ${coloured(C.green, '●')} ${name}`);
  }
  log('');

  // Provider health
  log(coloured(C.bold, '  Provider Health'));
  if (Object.keys(status).length === 0) {
    log(coloured(C.dim, '    No provider activity yet'));
  } else {
    for (const [name, health] of Object.entries(status)) {
      const icon = health.healthy ? coloured(C.green, '●') : coloured(C.red, '●');
      log(`    ${icon} ${name} — ${health.successes}/${health.successes + health.failures} success${health.cooldownUntil ? coloured(C.yellow, ' (cooling down)') : ''}`);
    }
  }
  log('');

  // Tier mapping
  log(coloured(C.bold, '  Tier → Provider Map'));
  for (const [tier, providers] of Object.entries(TIER_PROVIDER_MAP)) {
    log(`    ${tier}: ${providers.join(' → ')}`);
  }
  log('');
}

// ── Security Scan — Check Text for Injections/Credentials ────────────────

async function cmdSecurityScan() {
  const text = positional[1];
  if (!text) { logErr('Usage: haivemind security-scan "<text>"'); process.exit(1); }

  const { scanForInjection, sanitizePrompt, scanAgentOutput } = await import('../server/services/promptGuard.js');
  const { redact, containsCredentials } = await import('../server/services/credentialRedactor.js');

  const injectionResult = scanForInjection(text);
  const credentialResult = redact(text);
  const outputResult = scanAgentOutput(text);

  if (JSON_MODE) {
    out({ injection: injectionResult, credentials: credentialResult, outputLeaks: outputResult });
    return;
  }

  log(coloured(C.bold + C.cyan, '\n  Security Scan Results\n'));

  // Injection Analysis
  log(coloured(C.bold, '  Prompt Injection'));
  if (injectionResult.safe) {
    log(`    ${coloured(C.green, '✓')} No injection detected`);
  } else {
    log(`    ${coloured(C.red, '✗')} Risk score: ${injectionResult.riskScore.toFixed(2)}`);
    for (const threat of injectionResult.threats) {
      log(`      ${coloured(C.red, '!')} [${threat.category}] ${threat.pattern} (severity: ${threat.severity})`);
    }
  }
  log('');

  // Credential Analysis
  log(coloured(C.bold, '  Credentials'));
  if (credentialResult.redactionCount === 0) {
    log(`    ${coloured(C.green, '✓')} No credentials detected`);
  } else {
    log(`    ${coloured(C.red, '✗')} ${credentialResult.redactionCount} credential(s) found`);
    for (const t of credentialResult.redactedTypes) {
      log(`      ${coloured(C.yellow, '!')} ${t}`);
    }
    log(`    Redacted output: ${credentialResult.text.slice(0, 100)}`);
  }
  log('');

  // Output Leak Analysis
  log(coloured(C.bold, '  Output Leaks'));
  if (outputResult.safe) {
    log(`    ${coloured(C.green, '✓')} No leaks detected`);
  } else {
    for (const leak of outputResult.leaks) {
      log(`      ${coloured(C.red, '!')} ${leak}`);
    }
  }
  log('');
}

// ── Actual Dispatch ──────────────────────────────────────────────────

const commands = {
  help: cmdHelp,
  projects: cmdProjects,
  status: cmdStatus,
  build: cmdBuild,
  dashboard: cmdDashboard,
  replay: cmdReplay,
  autopilot: cmdAutopilot,
  intelligence: cmdIntelligence,
  providers: cmdProviders,
  'security-scan': cmdSecurityScan,
  init: cmdInit,
  watch: cmdWatch,
  export: cmdExport,
  import: cmdImport,
  completions: cmdCompletions,
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
