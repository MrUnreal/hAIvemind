# hAIvemind Roadmap

> Features the hAIvemind will build for itself. Prioritized by impact — reliability before ambition.

## In Progress

| Feature | Status | Notes |
|---------|--------|-------|
| **Session Locking** | \ud83d\udee1\ufe0f Planned next | Prevent concurrent sessions on the same project workspace |

## Recently Completed (Phase 1: Reliability)

| Feature | Status | Notes |
|---------|--------|-------|
| **Critical Bug Fixes** | \u2705 Done | Gated tasks, verify crash handling, path traversal, race conditions |
| **Process Timeouts** | \u2705 Done | 5min timeout on all CLI spawns, SIGTERM\u2192SIGKILL pattern, processTimeout.js utility |
| **Error Recovery UX** | \u2705 Done | Error overlay with retry, reconnecting banner, exponential backoff, sessionError state |

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

### Phase 2: Intelligence & UX

#### 🧠 Persistent Skills
Agents learn reusable scripts (lint, test, deploy) per project. Skills survive across sessions.

**Why it matters:** Every session starts cold. Agents re-learn the project's toolchain from scratch.

**Approach:** Store discovered build/test/lint commands as `.haivemind/skills.json`. Feed to agents as prior knowledge in `_buildPrompt()`.

---

#### 🎛️ Escalation Control Panel
UI to customize the escalation chain per project. Pin tasks to models, set cost ceilings, force free-tier-only mode.

**Why it matters:** Different projects have different quality/cost tradeoffs.

**Approach:** Per-project settings in `workspace.js`, REST API, Vue component.

---

#### 📊 Self-Reflection & Metrics
After each session, capture what worked, what failed, time/cost profiles, and lessons learned.

**Why it matters:** Without reflection data, the hAIvemind can't improve its own decomposition or model selection.

**Approach:** Post-session analysis stored in `.haivemind/reflections/`. Feeds into persistent skills and prompt improvements.

---

### Phase 3: Scaling & Extensibility

#### 🔀 Dynamic DAG Rewriting
Detect blocked dependency chains mid-execution and restructure the DAG on the fly.

**Why it matters:** Some tasks that seemed sequential can be parallelized once prior work reveals the shape.

**Approach:** Monitor in `taskRunner.js`. When a task exceeds a time threshold with no true data dependency on its blocker, fork it.

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
