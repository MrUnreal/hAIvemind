# hAIvemind Roadmap

> Features the hAIvemind will build for itself. Prioritized by impact — reliability before ambition.

## In Progress

_Phase 3 in progress! Dynamic DAG Rewriting complete._

## Recently Completed (Phase 3: Scaling & Extensibility — partial)

| Feature | Status | Notes |
|---------|--------|-------|
| **Dynamic DAG Rewriting** | ✅ Done | Stall detection in `taskRunner.js` (_checkForStalls every 30s), keyword-based data-dependency heuristic, `dag:rewrite` WS event, client edge animation + toast |

## Recently Completed (Phase 2: Intelligence & UX)

| Feature | Status | Notes |
|---------|--------|-------|
| **Persistent Skills** | ✅ Done | `.haivemind/skills.json` per project, auto-extracted from agent output, injected into `_buildPrompt()`, `decompose()`, `verify()` |
| **Escalation Control Panel** | ✅ Done | Per-project settings (escalation chain, cost ceiling, pinned models), `settings.json`, REST API, SettingsPanel.vue with tabs |
| **Self-Reflection & Metrics** | ✅ Done | Post-session analysis → `.haivemind/reflections/`, tier usage, escalation tracking, retry rates, MetricsDashboard.vue |

## Recently Completed (Phase 1: Reliability)

| Feature | Status | Notes |
|---------|--------|-------|
| **Critical Bug Fixes** | ✅ Done | Gated tasks, verify crash handling, path traversal, race conditions |
| **Process Timeouts** | ✅ Done | 5min timeout on all CLI spawns, SIGTERM→SIGKILL pattern, processTimeout.js utility |
| **Error Recovery UX** | ✅ Done | Error overlay with retry, reconnecting banner, exponential backoff, sessionError state |
| **Session Locking** | ✅ Done (self-dev) | workDirLocks Map, acquireLock/releaseLock, health endpoint shows activeLocks |
| **Memory Management** | ✅ Done (self-dev) | Session eviction (30min), agent output cap (100KB), graceful shutdown, killAll() |
| **WebSocket Resilience** | ✅ Done (self-dev) | Heartbeat ping-pong, off() handler cleanup, message queuing, reconnect:sync |

## Planned

### Phase 1: Reliability & Correctness

#### 🛡️ Process Timeouts
All CLI spawns (decompose, verify, plan, agents) wrapped with configurable timeouts. Kill on expiry instead of hanging forever.

**Why it matters:** A single hung `copilot` CLI process currently freezes the entire session with no recovery path. This is the #1 reliability risk.

**Approach:** Wrap all `spawn()` calls with a timeout (default 5min). Use `child.kill()` on expiry. Agent timeout → fail → retry with escalation. Orchestrator timeout → session error.

---

#### 🔒 Session Locking
Prevent concurrent sessions on the same project workspace. Queue or reject if another session is already writing to the same `workDir`.

**Why it matters:** Two sessions writing to the same directory simultaneously causes file conflicts and corrupted output.

**Approach:** Lock Map keyed by `workDir`. `startSession()` checks lock before proceeding, releases on completion/failure. Return clear error to client if locked.

---

#### 📡 WebSocket Resilience
Message queuing during disconnect, exponential backoff reconnect, state re-sync on reconnect, handler cleanup.

**Why it matters:** Messages sent during disconnect are silently dropped. Reconnected clients have stale state. No way to recover mid-session.

**Approach:** Buffer `send()` calls while disconnected, flush on reconnect. Add `off()` to prevent handler duplication on HMR. Emit connect/disconnect events. Server sends current session state on reconnect.

---

#### 🧹 Memory Management
Evict completed sessions from in-memory Maps. Cap agent output buffers. Clean up orphaned processes on shutdown.

**Why it matters:** `sessions`, `taskToSession`, and `agentManager.agents` Maps grow indefinitely. Long-running servers accumulate dead data.

**Approach:** Prune sessions after N minutes. `AgentManager.killAll()` for graceful shutdown. Cap output to last 100KB per agent. `process.on('SIGTERM')` cleanup handler.

---

### Phase 2: Intelligence & UX ✅

#### 🧠 Persistent Skills ✅
Agents learn reusable scripts (lint, test, deploy) per project. Skills survive across sessions.

**Implementation:** Skills stored in `.haivemind/skills.json`. Auto-extracted from agent output (regex matching build/test/lint commands). Injected into `_buildPrompt()`, `decompose()`, and `verify()`. REST API: `GET/PUT /api/projects/:slug/skills`. UI: SettingsPanel.vue Skills tab with chip editor.

---

#### 🎛️ Escalation Control Panel ✅
UI to customize the escalation chain per project. Pin tasks to models, set cost ceilings, force free-tier-only mode.

**Implementation:** Per-project settings in `.haivemind/settings.json`. `getModelForRetry()` accepts overrides + pinnedModels. REST API: `GET/PUT /api/projects/:slug/settings`. UI: SettingsPanel.vue Escalation tab with chain editor, number inputs, save/reset.

---

#### 📊 Self-Reflection & Metrics ✅
After each session, capture what worked, what failed, time/cost profiles, and lessons learned.

**Implementation:** `generateReflection()` in `index.js` runs post-session. Stores in `.haivemind/reflections/<sessionId>.json`. Tracks: success/fail counts, retry rates, tier usage, escalated tasks, cost breakdown. REST API: `GET /api/projects/:slug/reflections`. UI: MetricsDashboard.vue with aggregate stats, tier bar charts, and per-session reflection cards.

---

### Phase 3: Scaling & Extensibility

#### 🔀 Dynamic DAG Rewriting ✅
Detect blocked dependency chains mid-execution and restructure the DAG on the fly.

**Implementation:** `taskRunner.js` runs `_checkForStalls()` every 30s. When a running task exceeds `stallThresholdMs` (90s) and has pending dependents with no detected data dependency (keyword heuristic), the dependency edge is removed and the blocked task is unblocked. Broadcasts `dag:rewrite` WS event. Client animates edge removal (dashed amber line → remove) and shows toast notification. Config: `stallThresholdMs`, `stallCheckIntervalMs` in `config.js`. `cleanup()` method stops interval on session end.

---

#### 🔌 Pluggable Agent Backends
Swap Copilot CLI for any agent runtime: Codex, Aider, Open Interpreter, local LLMs via Ollama.

**Why it matters:** Lock-in to one CLI tool limits model choice and capabilities.

**Approach:** Agent backend interface — `spawn(prompt, workDir) → { stdout, exitCode }`. Copilot CLI is one implementation.

---

#### 🌐 Multi-Workspace Swarm
Spawn agents across multiple machines or containers.

**Why it matters:** Local CPU/memory limits cap parallelism.

**Approach:** Agent manager abstraction — local subprocess vs. remote Docker/SSH agent.

---

## Completed

- ✅ **Maximum Parallelism** — All independent tasks run simultaneously
- ✅ **Live DAG Visualization** — Status colors, runtime timers, edge highlighting, auto-focus
- ✅ **Orchestrator Chat** — iMessage-style panel with task attribution
- ✅ **Test-Driven Verification** — Generate and run actual tests, failures become fix tasks
- ✅ **Planner Mode** — T3 research before decomposition
- ✅ **Smart Escalation** — T0 → T0 → T1 → T2 → T3
- ✅ **Human-in-the-Loop Gates** — Tasks pause for approval
- ✅ **Streaming Agent Output** — Live stdout/stderr broadcast
- ✅ **Self-Development Mode** — Evolves own codebase
- ✅ **Project Isolation** — Per-project workspaces and session history
- ✅ **Session Replay** — Timeline scrubber for past sessions
- ✅ **Project Templates** — Pre-built task DAGs for common stacks (Express, React, CLI)
- ✅ **Persistent Skills** — Per-project learned commands, injected into prompts
- ✅ **Escalation Control Panel** — Per-project model/cost configuration
- ✅ **Self-Reflection & Metrics** — Post-session analysis with aggregate dashboards
- ✅ **Dynamic DAG Rewriting** — Stall detection + automatic dependency edge removal
