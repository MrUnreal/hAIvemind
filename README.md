<p align="center">
  <img src="resources/logo.png" alt="hAIvemind" width="320">
</p>

<h1 align="center">hAIvemind</h1>

<p align="center">
  <strong>Many small agents. One hAIvemind. Self-evolving.</strong><br>
  Massively parallel AI coding orchestrator powered by GitHub Copilot CLI
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-ES%20Modules-339933?logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/Vue%203-Flow%20DAG-4FC08D?logo=vue.js" alt="Vue 3">
  <img src="https://img.shields.io/badge/Copilot%20CLI-Agent%20Backend-0078D4?logo=github" alt="Copilot CLI">
  <img src="https://img.shields.io/badge/Cost-Free_Tier_Default-brightgreen" alt="Free">
  <img src="https://img.shields.io/badge/Self--Evolving-🧬-blueviolet" alt="Self-Evolving">
</p>

> **Every feature in this codebase was developed by hAIvemind's own orchestrator.** No manually written code is present — the platform decomposes its own feature requests, spawns agents to implement them, verifies the results, and merges passing changes. The hAIvemind builds itself.

---

Describe what you want. The hAIvemind decomposes it, spins up parallel agents, verifies the result, fixes issues autonomously, and lets you iterate — all from a visual DAG.

```mermaid
graph LR
  A["🗣️ Your Prompt"] --> B["🧠 Orchestrator"]
  B --> P["🔬 Planner (T3)"]
  P --> B
  B --> C["🐝 Agent 1"]
  B --> D["🐝 Agent 2"]
  B --> E["🐝 Agent 3"]
  B --> F["🐝 Agent N"]
  C --> G["🧪 Verify + Test"]
  D --> G
  E --> G
  F --> G
  G -->|"Issues?"| H["🔧 Parallel Fixes"]
  H --> G
  G -->|"🚦 Gate?"| K["🤝 Human Review"]
  K --> G
  G -->|"✅ Pass"| I["💬 Iterate via Chat"]
  I --> B

  style B fill:#f5c542,color:#111
  style P fill:#e040fb,color:#fff
  style G fill:#4a9eff,color:#fff
  style K fill:#ff9800,color:#fff
  style I fill:#4caf50,color:#fff
```

## Why hAIvemind?

| Problem | hAIvemind |
|---------|-----------|
| AI agents work sequentially | **All independent tasks run simultaneously** |
| One model does everything | **4-tier model escalation** — free models first, premium only when needed |
| No visibility into what's happening | **Live DAG** with real-time status, runtime timers, streaming output |
| Verification is an afterthought | **Test-driven verify-fix loop** — generates and runs actual tests, failures become fix tasks |
| One-shot generation | **Iterative chat** — extend the DAG with follow-up requests |
| AI can't improve itself | **Self-development mode** — hAIvemind evolves its own codebase via git worktrees |

## Quick Start

```bash
git clone git@github.com:MrUnreal/hAIvemind.git
cd hAIvemind
npm install
cd client && npm install && cd ..
npm run dev
```

Or with Docker:
```bash
docker compose up
```

> Requires **Node.js 18+** and **GitHub Copilot CLI** on PATH.
> Copy `.env.example` to `.env` and customize settings.
> See [Setup Guide](docs/setup.md) for detailed instructions.

Open **http://localhost:5173** → pick a project → describe what to build → watch agents swarm.

### CLI Usage

```bash
# List projects
npx haivemind projects

# Build something
npx haivemind build my-project "Add user authentication with JWT"

# Autopilot mode
npx haivemind autopilot my-project --cycles=5

# Run tests
npm test
```

## How It Works

```mermaid
sequenceDiagram
  participant U as You
  participant P as Planner (T3)
  participant O as Orchestrator
  participant A as Agents (×N)
  participant V as Verifier

  U->>O: "Build a REST API with auth, CRUD, search"
  O->>P: Research approach, risks, affected files
  P-->>O: Plan with recommended approach
  O->>O: Decompose into parallel tasks
  O->>A: Spawn N agents simultaneously
  A-->>O: All tasks complete
  O->>V: Review + generate & run tests
  V-->>O: 2 test failures
  O->>A: Spawn 2 fix agents in parallel
  A-->>V: Re-verify
  V-->>O: All tests pass ✅
  O-->>U: Done! (iterate via chat)
```

1. **Plan** — T3 model researches the codebase, evaluates approaches, identifies risks and affected files
2. **Decompose** — Orchestrator breaks the plan into independent tasks with pre-specified interfaces
3. **Execute** — All independent tasks launch simultaneously as separate Copilot CLI processes
4. **Verify** — Orchestrator generates and runs actual tests, reviews the full codebase for integration issues
5. **Fix** — Test failures are decomposed into parallel fix tasks, added to the DAG, and executed
6. **Iterate** — Send follow-up messages to grow the DAG with new work

## Features

Every feature below was built by the hAIvemind's own orchestrator — decomposed, executed in parallel, verified, and merged autonomously.

### Core Engine
🐝 **Maximum Parallelism** — Every independent task runs at once. 7 tasks? 7 simultaneous agents.

📊 **Live DAG Visualization** — Real-time graph with status colors, runtime timers, active edge highlighting, and auto-viewport focus on running nodes.

💬 **Orchestrator Chat** — iMessage-style panel showing every agent assignment, completion, and escalation. Send follow-up requests to extend the project.

🧪 **Test-Driven Verification** — Verify step generates and runs actual tests (`node --check`, smoke tests, `npm test`). Test failures become fix tasks automatically. Up to 3 verify-fix rounds.

🔬 **Planner Mode** — Before coding, a T3 model researches the codebase, evaluates multiple approaches, identifies risks and affected files. Planning is separate from execution.

⬆️ **Smart Escalation** — `T0 → T0 → T1 → T2 → T3`. Starts free, upgrades only when needed. [Model details →](docs/model-tiering.md)

🤝 **Human-in-the-Loop Gates** — Mark tasks as requiring human approval before proceeding. The DAG pauses at gate nodes, you review, approve or redirect with feedback.

📁 **Project Isolation** — Each project gets its own workspace directory and session history. Link existing repos or create fresh projects.

### Operations (Phase 5)
🛡️ **Graceful Shutdown & Recovery** — `SIGTERM`/`SIGINT` handlers flush sessions to disk. On restart, interrupted sessions can be resumed or discarded.

📝 **Smart Output Summaries** — Post-run structured summaries (files changed, errors, test results). Summaries replace raw output on escalation to stay within token limits.

⏪ **Workspace Rollback** — Pre-session git snapshots, one-click rollback, file-level diff preview before undoing changes.

⌨️ **CLI Mode** — `haivemind build <project> "prompt"` for headless/CI use. Color-coded streaming output, `--json` mode, exit codes.

🤖 **Auto-Pilot** — `haivemind autopilot <slug>` runs reflect→plan→build cycles autonomously with safety rails (cost ceiling, max cycles, mandatory tests).

🐳 **Distribution** — `Dockerfile`, `docker-compose.yml`, `npm start` for production. One-command deploy.

🔌 **Plugin System** — Load/unload/enable/disable plugins with lifecycle hooks (`beforeSession`, `afterSession`, `afterPlan`, `onShutdown`). REST API + Settings UI.

⚙️ **Backend & Swarm REST** — Switch backends (Copilot/Ollama) and toggle swarm mode at runtime without restart.

### Production Readiness (Phase 6)
🧪 **CI Pipeline** — GitHub Actions workflow, Playwright auto-server, `npm test` / `npm run test:ci` scripts.

📋 **Structured Logging** — Leveled logger (error/warn/info/debug), timestamp-prefixed, JSON mode for production (`LOG_FORMAT=json`).

🌐 **Environment Config** — `.env` file support, all config overridable via `HAIVEMIND_*` env vars. No hardcoded values.

📑 **Template Gallery** — Browse, preview, and create project templates from the UI. Variable substitution and stack badges.

⚡ **Real-Time Agent Streaming** — Throttled `AGENT_STREAM` with progressive terminal rendering, output search/filter, raw/summary toggle.

🔍 **Session Diff Viewer** — Per-file unified diffs with syntax highlighting. Workspace overview showing tech stack, file tree, conventions.

🔌 **Plugin & Backend UI** — Settings panel with enable/disable/reload toggles, backend selector, swarm capacity display.

🤖 **Autopilot Web UI** — Start/stop autopilot from the browser, cycle history, reasoning, cost tracking, real-time progress.

📡 **Scoped WebSocket Channels** — Per-project subscriptions, session checkpointing for crash recovery, zero cross-project noise.

🧬 **Self-Development Mode** — hAIvemind evolves its own codebase. New features are developed in isolated git worktrees, verified, diffed, and merged — the platform builds itself.

## Screenshots

<p align="center">
  <img src="resources/platform-demo/workflow.png" alt="DAG workflow" width="700"><br>
  <em>Live DAG — 7 agents executing in parallel</em>
</p>

## Docs

| Page | Description |
|------|-------------|
| [Setup Guide](docs/setup.md) | Prerequisites, installation, configuration |
| [Architecture](docs/architecture.md) | System design, component breakdown, data flow |
| [Model Tiering](docs/model-tiering.md) | All supported models, tiers, costs, escalation chain |
| [Project Structure](docs/project-structure.md) | File-by-file codebase reference |
| [Roadmap](docs/roadmap.md) | Feature backlog and status tracking |
| [Definition of Done](docs/definition-of-done.md) | Quality standards and self-dev rules |

## Roadmap

| Phase | Status | Highlights |
|-------|--------|------------|
| Foundation | ✅ | Parallel agents, DAG visualization, chat, verify-fix loops, gates |
| Phase 1: Reliability | ✅ | Process timeouts, error recovery, session locking, memory management |
| Phase 2: Intelligence | ✅ | Persistent skills, escalation control, self-reflection metrics |
| Phase 3: Extensibility | ✅ | DAG rewriting, pluggable backends, multi-workspace swarm |
| Phase 4: Hardening | ✅ | Workspace analysis, cost ceilings, per-project concurrency |
| Phase 5: Autonomy | ✅ | Graceful shutdown, CLI, autopilot, plugins, Docker distribution |
| Phase 6: Production | ✅ 7/8 | CI, logging, templates, streaming, diff viewer, plugin UI, autopilot UI, WS channels |
| Phase 6.8: Decomposition | 🔄 | Server modularization into routes/services/ws |

See [docs/roadmap.md](docs/roadmap.md) for the full feature backlog and [ROADMAP-PHASE6.md](ROADMAP-PHASE6.md) for Phase 6 details.

## License

MIT
