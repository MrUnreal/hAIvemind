# hAIvemind — AI Orchestrator Specification

## Vision

A Vue Flow–based web application that acts as an intelligent orchestrator for AI coding agents. The user provides a single natural-language prompt describing what they want built. The orchestrator decomposes the work into tasks, spawns CLI-based sub-agents (using cheap models first), manages retries with model escalation, handles cross-agent failure loops, and visualizes the entire execution graph in real time.

---

## Core Concepts

### Model Tiering (Based on GitHub Copilot Premium Request Multipliers)

Models are ranked by **cost (multiplier)** and **coding benchmark performance** (Aider polyglot / LM Arena coding). The orchestrator picks the cheapest tier that can handle the task, escalating only on failure.

| Tier | Multiplier | Role | Models (best→fallback) | When Used |
|------|-----------|------|------------------------|-----------|
| **T0 — Free** | 0× | First-attempt workers | GPT-4.1, GPT-4o, GPT-5 mini | Default for all sub-tasks — zero premium cost on paid plans |
| **T1 — Budget** | 0.25–0.33× | Cheap retry / simple tasks | Gemini 3 Flash (0.33×), Claude Haiku 4.5 (0.33×), GPT-5.1-Codex-Mini (0.33×), Grok Code Fast 1 (0.25×) | Quick boilerplate, small fixes, retry before escalating |
| **T2 — Standard** | 1× | Main implementation | Claude Sonnet 4.5 (1×), Gemini 2.5 Pro (1×), GPT-5.2-Codex (1×), Claude Sonnet 4 (1×) | After T0/T1 fail, or complex implementation tasks |
| **T3 — Premium** | 3× | Orchestrator & hard debugging | Claude Opus 4.6 (3×), Claude Opus 4.5 (3×) | Orchestrator (planner), retry after T2 failure |
| **T4 — Ultra** | 10× | Last resort | Claude Opus 4.1 (10×) | Extremely complex failures only, requires explicit escalation |

**Escalation strategy**: Workers start at T0 (free). On failure, retry at T0 once, then bump to T1, then T2, then T3. T4 is only used if explicitly enabled. The orchestrator itself runs at T3 (needs strong reasoning for planning).

**Cost reference** (Copilot premium requests per interaction):
- T0: 0 requests (included in paid plan)
- T1: 0.25–0.33 requests
- T2: 1 request
- T3: 3 requests
- T4: 10 requests

### Agent Lifecycle

```
PENDING → RUNNING → { SUCCESS | FAILED }
                        ↓
                   retry? → RUNNING (same or higher tier)
                        ↓
                   max retries? → BLOCKED (needs human or orchestrator decision)
```

### Cross-Agent Failure Loop ("Expected Failure")

Some failures are *expected* — e.g., a frontend agent discovers the backend API shape is wrong. The flow:

1. **Agent B** (frontend) fails and writes a structured failure report (JSON file or in-memory object) describing what it expected vs. what it got.
2. **Orchestrator** reads the failure report, identifies the upstream dependency (**Agent A** — backend).
3. **Orchestrator** re-invokes **Agent A** with the original task context **plus** the failure report from **Agent B** as additional context.
4. On **Agent A** success, **Agent B** is re-queued automatically.
5. Loop continues until resolution or max-loop-depth is hit.

---

## Architecture Overview

```
┌─────────────────────────────────────┐
│           Browser (SPA)             │
│  ┌───────────┐  ┌────────────────┐  │
│  │ Vue Flow  │  │ Detail Panel   │  │
│  │ (graph)   │  │ (streamed CLI) │  │
│  └───────────┘  └────────────────┘  │
│         ↕ WebSocket / SSE           │
├─────────────────────────────────────┤
│         Node.js Backend             │
│  ┌────────────┐ ┌────────────────┐  │
│  │ Orchestrator│ │ Agent Manager  │  │
│  │ (T1 model) │ │ (spawn CLI)    │  │
│  └────────────┘ └────────────────┘  │
│         ↕ child_process.spawn       │
├─────────────────────────────────────┤
│    CLI Agents (copilot-cli / aider  │
│    / claude-code / etc.)            │
└─────────────────────────────────────┘
```

- **Frontend**: Vite + Vue 3 + Vue Flow. Single-page app.
- **Backend**: Plain Node.js (Express). No database — all state in memory for MVP.
- **Agents**: Spawned as child processes. Each agent = one CLI invocation with a prompt, a working directory, and a model flag.

---

## Data Model (In-Memory for MVP)

### Session

```js
{
  id: "uuid",
  userPrompt: "Build a REST API with a React frontend for a todo app",
  status: "running" | "completed" | "failed",
  plan: Plan,
  agents: Map<agentId, Agent>,
  createdAt: timestamp
}
```

### Plan

```js
{
  tasks: [
    {
      id: "task-1",
      label: "Scaffold Express backend",
      description: "Create Express server with /api/todos CRUD endpoints...",
      dependencies: [],            // task IDs this depends on
      agentId: null,               // assigned when spawned
      status: "pending"
    },
    {
      id: "task-2",
      label: "Implement React frontend",
      description: "Create React app consuming /api/todos...",
      dependencies: ["task-1"],
      agentId: null,
      status: "pending"
    }
  ]
}
```

### Agent

```js
{
  id: "agent-uuid",
  taskId: "task-1",
  modelTier: "T0",
  model: "gpt-4.1",
  status: "running" | "success" | "failed" | "blocked",
  retries: 0,
  prompt: "...",                     // full prompt sent to CLI
  cliCommand: "...",                 // exact CLI invocation
  output: [],                        // array of stdout/stderr chunks (streamed)
  failureReport: null | { ... },     // structured failure info
  startedAt: timestamp,
  finishedAt: timestamp | null
}
```

---

## Phase 1 — MVP (Target: working demo)

### P1.1 — Project Scaffold

- [ ] Init Vite + Vue 3 project (JavaScript, no TypeScript for speed)
- [ ] Install dependencies: `@vue-flow/core`, `@vue-flow/background`, `@vue-flow/controls`, `express`, `uuid`, `ws` (WebSocket)
- [ ] Folder structure:

```
hAIvemind/
├── client/                  # Vite + Vue 3
│   ├── src/
│   │   ├── App.vue
│   │   ├── main.js
│   │   ├── components/
│   │   │   ├── PromptInput.vue        # single text input + submit
│   │   │   ├── FlowCanvas.vue         # Vue Flow graph
│   │   │   ├── AgentNode.vue          # custom node for agents
│   │   │   └── AgentDetail.vue        # side panel with CLI stream
│   │   ├── composables/
│   │   │   ├── useWebSocket.js        # WS connection helper
│   │   │   └── useSession.js          # reactive session state
│   │   └── utils/
│   │       └── layout.js              # auto-layout helper for dagre/elk
│   └── index.html
├── server/
│   ├── index.js                       # Express + WS server entry
│   ├── orchestrator.js                # T1 model interaction, plan generation
│   ├── agentManager.js                # spawn/manage child processes
│   ├── taskRunner.js                  # task queue, dependency resolution
│   └── config.js                      # model tiers, retry limits, CLI paths
├── shared/
│   └── protocol.js                    # WS message types / event names
├── package.json
└── SPEC.md
```

### P1.2 — Backend: Orchestrator Core

**Goal**: Accept a user prompt, call T1 model to decompose into tasks, return a plan.

- [ ] `POST /api/session` — accepts `{ prompt }`, returns `{ sessionId }`
- [ ] Orchestrator calls T1 model (via CLI or API) with a system prompt:
  - *"You are a project planner. Given the user's request, decompose it into concrete implementation tasks. Output JSON: `{ tasks: [{ id, label, description, dependencies }] }`."*
- [ ] Parse the T1 response into a `Plan` object.
- [ ] Broadcast `plan:created` event over WebSocket with the full plan.

**CLI Abstraction** (MVP): Use `child_process.spawn` to run a generic command. Config maps model names to CLI invocations:

```js
// config.js
export default {
  models: {
    // T0 — Free (0× multiplier)
    "gpt-4.1":             { cmd: "claude", args: ["--model", "gpt-4.1", "--print"], multiplier: 0 },
    "gpt-4o":              { cmd: "claude", args: ["--model", "gpt-4o", "--print"], multiplier: 0 },
    "gpt-5-mini":          { cmd: "claude", args: ["--model", "gpt-5-mini", "--print"], multiplier: 0 },
    // T1 — Budget (0.25–0.33×)
    "gemini-3-flash":      { cmd: "claude", args: ["--model", "gemini-3-flash", "--print"], multiplier: 0.33 },
    "claude-haiku-4.5":    { cmd: "claude", args: ["--model", "claude-haiku-4.5", "--print"], multiplier: 0.33 },
    // T2 — Standard (1×)
    "claude-sonnet-4.5":   { cmd: "claude", args: ["--model", "claude-sonnet-4.5", "--print"], multiplier: 1 },
    "gemini-2.5-pro":      { cmd: "claude", args: ["--model", "gemini-2.5-pro", "--print"], multiplier: 1 },
    "claude-sonnet-4":     { cmd: "claude", args: ["-m", "sonnet", "--print"], multiplier: 1 },
    // T3 — Premium (3×)
    "claude-opus-4.6":     { cmd: "claude", args: ["-m", "opus", "--print"], multiplier: 3 },
    // T4 — Ultra (10×)
    "claude-opus-4.1":     { cmd: "claude", args: ["--model", "claude-opus-4.1", "--print"], multiplier: 10 },
  },
  tiers: {
    T0: "gpt-4.1",            // Free — default worker
    T1: "claude-haiku-4.5",   // Budget — cheap retry
    T2: "claude-sonnet-4.5",  // Standard — main implementation
    T3: "claude-opus-4.6",    // Premium — orchestrator + hard tasks
    T4: "claude-opus-4.1",    // Ultra — last resort (disabled by default)
    orchestrator: "claude-opus-4.6"  // Planner always uses T3
  },
  escalation: ["T0", "T0", "T1", "T2", "T3"],  // retry index → tier
  maxRetriesTotal: 5,
  maxCrossAgentLoops: 3,
  maxConcurrency: 3,
  enableT4: false   // must be explicitly enabled
};
```

### P1.3 — Backend: Agent Manager

**Goal**: Spawn CLI agents, stream their output, detect success/failure.

- [ ] `agentManager.spawn(task, modelTier)`:
  1. Build prompt string from task description + any prior failure context.
  2. Resolve CLI command from config for the given tier.
  3. `child_process.spawn(cmd, args, { cwd: workDir })`.
  4. Pipe `stdout`/`stderr` chunks → store in agent's `output[]` array **and** broadcast `agent:output` over WS.
  5. On process exit:
     - Exit code 0 → `agent:success`
     - Exit code != 0 → `agent:failed`
- [ ] Broadcast status changes: `agent:status` events.

### P1.4 — Backend: Task Runner (Dependency + Retry Logic)

**Goal**: Execute tasks respecting dependency order, retry on failure, escalate model tier.

- [ ] On `plan:created`, build a DAG of tasks.
- [ ] Tasks with no unmet dependencies are immediately eligible for execution.
- [ ] Run eligible tasks **in parallel** (configurable concurrency limit, default: 3).
- [ ] On `agent:success`:
  - Mark task complete.
  - Check if any blocked tasks now have all dependencies met → spawn them.
- [ ] On `agent:failed`:
  - If `retries < maxRetriesBeforeEscalation` → retry at same tier.
  - If `retries >= maxRetriesBeforeEscalation` and tier can escalate → retry at next tier.
  - If `retries >= maxRetriesTotal` → mark task `blocked`, broadcast `task:blocked`.
- [ ] Broadcast `task:status` on every transition.

### P1.5 — Frontend: Prompt Input

**Goal**: Single-input screen, similar to ChatGPT's initial view.

- [ ] `PromptInput.vue` — textarea + "Build" button.
- [ ] On submit, `POST /api/session` with the prompt.
- [ ] Transition to the flow canvas view.

### P1.6 — Frontend: Flow Canvas (Vue Flow)

**Goal**: Visualize the task DAG in real time.

- [ ] `FlowCanvas.vue` wraps `<VueFlow>` with background and controls.
- [ ] Listen to WS events:
  - `plan:created` → generate nodes + edges from the plan. Auto-layout using dagre (simple left-to-right or top-to-bottom).
  - `agent:status` → update node color/state indicator.
  - `task:status` → update node border/badge (pending/running/success/failed/blocked).
- [ ] Custom node `AgentNode.vue`:
  - Shows task label, current status (color-coded), model tier badge, retry count.
  - Animated pulse/spinner when `running`.
  - Click opens `AgentDetail` panel.
- [ ] Node colors:
  - Pending: gray
  - Running: blue (animated border)
  - Success: green
  - Failed: red
  - Blocked: orange

### P1.7 — Frontend: Agent Detail Panel

**Goal**: Click a node → see live CLI output.

- [ ] `AgentDetail.vue` — side drawer or bottom panel.
- [ ] Shows:
  - Task label + description
  - Model used, tier, retry count
  - CLI command that was run
  - **Streaming console output** — auto-scrolling `<pre>` block. New chunks from `agent:output` WS events are appended live.
  - Status badge
- [ ] Close button to dismiss.

---

## Phase 2 — Cross-Agent Failure Loops

### P2.1 — Failure Report Protocol

- [ ] When an agent fails, the orchestrator (T1) analyzes the agent's output to produce a structured failure report:

```js
{
  failedTaskId: "task-2",
  summary: "Frontend could not consume /api/todos — endpoint returns { items } but frontend expects { todos }",
  upstreamTaskId: "task-1",         // null if no upstream blame
  suggestedFix: "Rename response key from 'items' to 'todos' in the backend endpoint",
  rawOutput: "..."                   // last N lines of agent stderr/stdout
}
```

- [ ] This is generated by calling T1 with the failed agent's output + task context.

### P2.2 — Re-Invocation Loop

- [ ] If `upstreamTaskId` is identified, orchestrator:
  1. Re-spawns the upstream task's agent with original prompt **+ failure report appended**.
  2. On upstream success, automatically re-queues the originally failed downstream task.
  3. Tracks loop depth per task pair. Aborts after `maxCrossAgentLoops`.
- [ ] Vue Flow visualization: add a dashed "fix" edge from the failed node back to the upstream node, colored orange. Animate during re-invocation.

### P2.3 — Orchestrator Consolidation Step

- [ ] After all tasks succeed, orchestrator runs a final T1 call:
  - *"All tasks completed. Review the outputs and produce a summary of what was built and any remaining issues."*
- [ ] Display summary in a special "Summary" node at the end of the graph.

---

## Phase 3 — Enhancements (Post-MVP)

### P3.1 — User Interaction

- [ ] Allow orchestrator to pause and ask the user clarifying questions before or during execution.
- [ ] Display question as a special node; user answers in the detail panel; orchestrator resumes.

### P3.2 — Persistent State

- [ ] Replace in-memory state with SQLite or file-based JSON persistence.
- [ ] Allow resuming sessions after server restart.

### P3.3 — Model Configuration UI

- [ ] Settings panel to configure model tiers, CLI paths, retry limits.
- [ ] Per-task model override (drag-and-drop tier badge).

### P3.4 — File Watching & Verification

- [ ] After agent completes, run automated checks (lint, test, build) as verification agents.
- [ ] Display verification results on the graph.

### P3.5 — Cost Tracking

- [ ] Track token usage / cost per agent invocation.
- [ ] Display cumulative cost on the graph and per-node.

### P3.6 — Multi-Project Workspace

- [ ] Support multiple simultaneous sessions.
- [ ] Session list sidebar.

---

## WebSocket Protocol (MVP)

All messages are JSON: `{ type: string, payload: object }`

### Server → Client

| Type | Payload | When |
|------|---------|------|
| `plan:created` | `{ sessionId, tasks: [...], edges: [...] }` | After T1 decomposes prompt |
| `task:status` | `{ taskId, status, retries, modelTier }` | Any task state change |
| `agent:status` | `{ agentId, taskId, status, model }` | Agent starts, succeeds, fails |
| `agent:output` | `{ agentId, chunk: string, stream: "stdout"\|"stderr" }` | Each CLI output chunk |
| `session:complete` | `{ sessionId, summary }` | All tasks done |
| `session:error` | `{ sessionId, error }` | Unrecoverable error |

### Client → Server

| Type | Payload | When |
|------|---------|------|
| `session:start` | `{ prompt }` | User submits prompt |
| `agent:retry` | `{ agentId }` | Manual retry from UI (future) |

---

## Implementation Notes for Coding Agent

### Key Constraints

1. **JavaScript only** — no TypeScript. Use JSDoc comments for clarity where helpful.
2. **No build step for server** — plain Node.js with ES modules (`"type": "module"` in package.json).
3. **Minimal dependencies** — only what's listed. No state management library (use Vue 3 reactivity). No CSS framework (minimal inline styles or a single CSS file is fine).
4. **CLI-agnostic** — the `config.js` model map means any CLI tool (claude, copilot, aider, openai CLI) can be plugged in. For MVP, just support `claude` CLI as the default since it's the simplest (`claude -m <model> --print "<prompt>"`).
5. **Working directory** — each session creates a temp working directory. All agents within a session share it (they're building the same project).

### Orchestrator Prompt Engineering

The T1 decomposition prompt should instruct the model to:
- Output valid JSON only
- Create tasks with clear, atomic descriptions
- Identify dependencies between tasks
- Keep tasks practical (1 file or 1 concern per task where possible)

Example system prompt for decomposition:
```
You are a senior software architect acting as a project planner.
Given a user's project request, decompose it into concrete, implementable tasks.

Rules:
- Each task should be a single, focused unit of work (one file, one feature, one concern).
- Identify dependencies: if task B needs task A's output, list A in B's dependencies.
- Tasks with no dependencies can run in parallel.
- Be specific in descriptions: include file names, function signatures, API shapes.
- Output ONLY valid JSON matching this schema:
{
  "tasks": [
    {
      "id": "task-N",
      "label": "Short human-readable label",
      "description": "Detailed implementation instructions...",
      "dependencies": ["task-M", ...]
    }
  ]
}
```

### Agent Prompt Template

When spawning a worker agent, the prompt should include:
1. The task description from the plan
2. The shared working directory path
3. Context from completed dependency tasks (what files they created)
4. Any failure reports from downstream tasks (for re-invocation)

### Suggested Implementation Order within Each Phase

**Phase 1 step order:**
1. P1.1 — Scaffold (5 min)
2. P1.2 — Orchestrator core + config (can stub T1 call with hardcoded plan for testing)
3. P1.3 — Agent manager (test with simple echo commands first)
4. P1.4 — Task runner (wire up the DAG execution)
5. P1.5 — Prompt input UI
6. P1.6 — Flow canvas (connect to WS, render plan)
7. P1.7 — Agent detail panel (stream output)
8. End-to-end test: submit prompt → see graph → see agents run → see output

**Phase 2 step order:**
1. P2.1 — Failure report generation
2. P2.2 — Re-invocation loop + graph visualization
3. P2.3 — Consolidation summary

---

## Success Criteria (MVP)

- [ ] User types a project description and clicks "Build"
- [ ] Graph appears showing decomposed tasks with dependency edges
- [ ] Tasks execute in correct dependency order, in parallel where possible
- [ ] Each node updates its color/status in real time
- [ ] Clicking a node shows live-streamed CLI output
- [ ] Failed tasks retry automatically, escalating model tier
- [ ] Session completes when all tasks succeed (or are blocked)
