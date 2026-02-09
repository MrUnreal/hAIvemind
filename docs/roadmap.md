# hAIvemind Roadmap

> Features the hAIvemind will build for itself. Prioritized by impact — reliability before ambition.

---

## All Phases Complete

All three original phases have shipped. The sections below document what was built and when.

### Phase 3: Scaling & Extensibility ✅

| Feature | Notes |
|---------|-------|
| **Dynamic DAG Rewriting** | Stall detection in `taskRunner.js` (`_checkForStalls` every 30 s), keyword-based data-dependency heuristic, `dag:rewrite` WS event, client edge animation + toast |
| **Pluggable Agent Backends** | `server/backends/` — abstract `AgentBackend` base class, `CopilotBackend`, `OllamaBackend`, registry with `getBackend()`/`registerBackend()`/`listBackends()`, config-driven `defaultBackend` selection |
| **Multi-Workspace Swarm** | `server/swarm/` — `LocalRunner`, `DockerRunner`, `SSHRunner`, `SwarmManager` with capacity-based scheduling, `prepareAgent()`/`attachProcess()` in AgentManager for remote process wiring, config-driven `swarm.enabled` + `swarm.runners[]` |

### Phase 2: Intelligence & UX ✅

| Feature | Notes |
|---------|-------|
| **Persistent Skills** | `.haivemind/skills.json` per project, auto-extracted from agent output, injected into `_buildPrompt()`, `decompose()`, `verify()` |
| **Escalation Control Panel** | Per-project settings (escalation chain, cost ceiling, pinned models), `settings.json`, REST API, SettingsPanel.vue with tabs |
| **Self-Reflection & Metrics** | Post-session analysis → `.haivemind/reflections/`, tier usage, escalation tracking, retry rates, MetricsDashboard.vue |

### Phase 1: Reliability ✅

| Feature | Notes |
|---------|-------|
| **Critical Bug Fixes** | Gated tasks, verify crash handling, path traversal, race conditions |
| **Process Timeouts** | 5 min timeout on all CLI spawns, SIGTERM→SIGKILL pattern, `processTimeout.js` utility |
| **Error Recovery UX** | Error overlay with retry, reconnecting banner, exponential backoff, sessionError state |
| **Session Locking** | `workDirLocks` Map, `acquireLock`/`releaseLock`, health endpoint shows `activeLocks` |
| **Memory Management** | Session eviction (30 min), agent output cap (100 KB), graceful shutdown, `killAll()` |
| **WebSocket Resilience** | Heartbeat ping-pong, `off()` handler cleanup, message queuing, `reconnect:sync` |

### Foundation (Pre-Phase)

- **Maximum Parallelism** — All independent tasks run simultaneously
- **Live DAG Visualization** — Status colors, runtime timers, edge highlighting, auto-focus
- **Orchestrator Chat** — iMessage-style panel with task attribution
- **Test-Driven Verification** — Generate and run actual tests, failures become fix tasks
- **Planner Mode** — T3 research before decomposition
- **Smart Escalation** — T0 → T0 → T1 → T2 → T3
- **Human-in-the-Loop Gates** — Tasks pause for approval
- **Streaming Agent Output** — Live stdout/stderr broadcast
- **Self-Development Mode** — Evolves own codebase
- **Project Isolation** — Per-project workspaces and session history
- **Session Replay** — Timeline scrubber for past sessions
- **Project Templates** — Pre-built task DAGs for common stacks (Express, React, CLI)
- **Iterative Sessions** — Follow-up chat decomposes new tasks appended to existing DAG

---

## Phase 4: Hardening & Production Readiness (Proposed)

> These features address real gaps discovered during the Phase 1–3 audit.
> Ordered by severity — broken promises and safety gaps first, then polish.

### 4.1 — Enforce Cost Ceiling _(severity: high)_

The settings UI lets users set a `costCeiling` per project, but the runtime ignores it entirely.
A runaway verify-fix loop or large decomposition can burn unlimited premium requests.

**Approach:**
- Pass `costCeiling` through the overrides object in `startSession()`
- In `AgentManager.spawn()`, sum cumulative multiplier. If adding the next agent would exceed the ceiling, fail the task with a clear `cost-ceiling-exceeded` status instead of spawning
- Broadcast a `session:warning` event so the UI can show a toast before the hard cutoff
- Gate the ceiling check _before_ process creation — don't spawn then regret

---

### 4.2 — Enforce Per-Project Max Concurrency _(severity: high)_

The settings UI lets users set `maxConcurrency` per project, but `TaskRunner._scheduleEligible()` reads only the global config value. A user who sets concurrency to 1 still gets 3 parallel agents.

**Approach:**
- Include `maxConcurrency` in the session overrides object
- `TaskRunner` reads `this.overrides.maxConcurrency ?? config.maxConcurrency` in `_scheduleEligible()`
- Also fix the early `break` in the scheduling loop — switch to `continue` so later independent tasks aren't starved when the concurrency cap is hit

---

### 4.3 — Graceful Shutdown & Session Recovery _(severity: medium)_

No `SIGTERM`/`SIGINT` handler exists. A restart orphans child processes, leaks timers, and loses all in-memory state. Active sessions vanish with no trace.

**Approach:**
- `process.on('SIGTERM')` → `agentManager.killAll()`, flush active session snapshots to disk (`.haivemind/interrupted/<sessionId>.json`), clear intervals/timeouts
- On startup, scan for interrupted sessions and expose them in the UI as "interrupted — resume or discard"
- Cap `session.timeline` at 5 000 events (ring-buffer style) to prevent OOM during long fix loops

---

### 4.4 — Dead Code Cleanup _(severity: low)_

Two protocol message types are defined but never used:
- `AGENT_RETRY` (`agent:retry`) — no handler on server, no emitter on client
- `AGENT_STREAM` (`agent:stream`) — never emitted anywhere

**Approach:**
- Remove both from `shared/protocol.js`
- If manual retry-from-UI is desired later, add it as a new feature with proper handler, not a dead wire type

---

### 4.5 — Agent Output Diffing & Smart Summaries _(severity: medium)_

Agent output is captured raw but never analyzed. When a task fails and escalates, the full stdout/stderr is passed as context, which is noisy and can exceed prompt windows.

**Approach:**
- Post-run, extract a structured summary from agent output: files changed, errors encountered, warnings, test results
- On escalation, pass the _summary_ rather than raw output — reduces noise and keeps context within token limits
- Store summaries alongside raw output in the session snapshot for replay

---

### 4.6 — REST API for Backend & Swarm Management _(severity: low)_

Backends and swarm runners are configured at startup via `config.js` but can't be inspected or changed at runtime. Adding an Ollama backend or a new Docker runner requires a restart.

**Approach:**
- `GET /api/backends` — list registered backends
- `POST /api/backends/:name` — register a custom backend at runtime
- `GET /api/swarm` — list runners with current capacity
- `POST /api/swarm/runners` — add a runner (docker/ssh config) at runtime
- `DELETE /api/swarm/runners/:id` — remove a runner

---

### 4.7 — Workspace Snapshot & Rollback _(severity: medium)_

If an agent writes bad code and the verify step passes (false positive), there's no way to undo. The user must manually `git reset`.

**Approach:**
- Before each session, create a lightweight git stash or tag (`haivemind/pre-session/<id>`)
- Expose a "Rollback" button in the session history UI that resets the workspace to the pre-session snapshot
- For non-git workspaces, fall back to a tarball snapshot in `.haivemind/snapshots/`

---

### 4.8 — Multi-User & Auth _(severity: low, future)_

Currently single-user, no auth. Fine for local dev, but blocks team usage or hosted deployment.

**Approach:**
- Optional auth middleware (Bearer token or OAuth)
- User identity attached to sessions for audit trail
- Project-level access control (owner / collaborator / viewer)
- _Defer until there's a real multi-user deployment need_
