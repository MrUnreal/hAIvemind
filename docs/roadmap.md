# hAIvemind Roadmap

> Features the hAIvemind will build for itself. Items move to the main feature list in the README once implemented and verified.

## In Progress

These features have been started via self-development sessions:

| Feature | Status | Notes |
|---------|--------|-------|
| **Session Replay** | ✅ Implemented | Timeline scrubber, event log, DAG state at any point in time |
| **Project Templates** | 🔧 In Progress | Pre-built decomposition patterns for common stacks |

## Planned

### 🧠 Persistent Skills
Agents learn reusable scripts (lint, test, deploy) per project. Skills survive across sessions so the hAIvemind doesn't re-discover how to build/run your stack every time.

**Why it matters:** Currently every session starts cold. Agents re-learn the project's toolchain from scratch — wasteful when the project hasn't changed.

**Approach:** Store discovered build/test/lint commands as `.haivemind/skills.json`. Feed them to agents as prior knowledge in `_buildPrompt()`.

---

### 🎛️ Escalation Control Panel
UI to customize the escalation chain per project. Pin certain tasks to specific models, set cost ceilings, or force free-tier-only mode.

**Why it matters:** Different projects have different quality/cost tradeoffs. A throwaway prototype shouldn't burn T3 credits.

**Approach:** Per-project settings in `workspace.js`, exposed via REST API, wired to a Vue component with dropdowns and toggles.

---

### 🔀 Dynamic DAG Rewriting
Orchestrator detects blocked dependency chains mid-execution and restructures the DAG on the fly — splitting, merging, or reordering tasks without restarting.

**Why it matters:** Sometimes a task that seemed sequential can be parallelized once prior work reveals the actual shape of the code.

**Approach:** Monitor DAG execution in `taskRunner.js`. When a task exceeds a time threshold and has no true data dependency on its blocker, fork it.

---

### 🌐 Multi-Workspace Swarm
Spawn agents across multiple machines or containers. Distribute work across a cluster, not just local processes.

**Why it matters:** Local CPU/memory limits cap parallelism. Distributing agents unlocks true horizontal scaling.

**Approach:** Agent manager abstraction layer — local subprocess vs. remote Docker/SSH agent. Orchestrator doesn't care where agents run.

---

### 🔌 Pluggable Agent Backends
Swap Copilot CLI for any agent runtime: Codex, Aider, Open Interpreter, local LLMs via Ollama. Mix backends in the same session.

**Why it matters:** Lock-in to one CLI tool limits model choice and capabilities.

**Approach:** Agent backend interface in `agentManager.js` — `spawn(prompt, workDir) → { stdout, exitCode }`. Copilot CLI is one implementation.

---

### 📦 Project Templates
Pre-built skill packs for common stacks (Express API, React app, CLI tool). Hit the ground running with known-good decomposition patterns.

**Why it matters:** Decomposing "create a REST API" from scratch wastes an orchestrator call. Templates provide instant task graphs.

**Approach:** JSON templates in `templates/` directory, loaded by server, optionally selected in the UI. Variable substitution for project-specific values.

---

## Completed

Features that have been fully implemented and verified:

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
