<p align="center">
  <img src="resources/logo.png" alt="hAIvemind" width="320">
</p>

<h1 align="center">hAIvemind</h1>

<p align="center">
  <strong>Many small agents. One hivemind. Self-evolving.</strong><br>
  Massively parallel AI coding orchestrator powered by GitHub Copilot CLI
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-ES%20Modules-339933?logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/Vue%203-Flow%20DAG-4FC08D?logo=vue.js" alt="Vue 3">
  <img src="https://img.shields.io/badge/Copilot%20CLI-Agent%20Backend-0078D4?logo=github" alt="Copilot CLI">
  <img src="https://img.shields.io/badge/Cost-Free_Tier_Default-brightgreen" alt="Free">
  <img src="https://img.shields.io/badge/Self--Evolving-🧬-blueviolet" alt="Self-Evolving">
</p>

> **Every feature in this codebase was developed by hAIvemind's own orchestrator.** No manually written code is present — the platform decomposes its own feature requests, spawns agents to implement them, verifies the results, and merges passing changes. The hivemind builds itself.

---

Describe what you want. The hivemind decomposes it, spins up parallel agents, verifies the result, fixes issues autonomously, and lets you iterate — all from a visual DAG.

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
npm run dev
```

> Requires **Node.js 18+** and **GitHub Copilot CLI** on PATH.
> See [Setup Guide](docs/setup.md) for detailed instructions.

Open **http://localhost:5173** → pick a project → describe what to build → watch agents swarm.

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

Every feature below was built by the hivemind's own orchestrator — decomposed, executed in parallel, verified, and merged autonomously.

🐝 **Maximum Parallelism** — Every independent task runs at once. 7 tasks? 7 simultaneous agents.

📊 **Live DAG Visualization** — Real-time graph with status colors, runtime timers, active edge highlighting, and auto-viewport focus on running nodes.

💬 **Orchestrator Chat** — iMessage-style panel showing every agent assignment, completion, and escalation. Send follow-up requests to extend the project.

🧪 **Test-Driven Verification** — Verify step generates and runs actual tests (`node --check`, smoke tests, `npm test`). Test failures become fix tasks automatically. Up to 3 verify-fix rounds.

🔬 **Planner Mode** — Before coding, a T3 model researches the codebase, evaluates multiple approaches, identifies risks and affected files. Planning is separate from execution.

⬆️ **Smart Escalation** — `T0 → T0 → T1 → T2 → T3`. Starts free, upgrades only when needed. [Model details →](docs/model-tiering.md)

🤝 **Human-in-the-Loop Gates** — Mark tasks as requiring human approval before proceeding. The DAG pauses at gate nodes, you review, approve or redirect with feedback.

⚡ **Streaming Agent Output** — Live stdout/stderr per agent, broadcast in real-time over WebSocket. Watch agents think, not just finish.

🧬 **Self-Development Mode** — hAIvemind evolves its own codebase. New features are developed in isolated git worktrees, verified, diffed, and merged — the platform builds itself.

📁 **Project Isolation** — Each project gets its own workspace directory and session history. Link existing repos or create fresh projects.

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

## Roadmap

Features the hivemind will build for itself next:

🧠 **Persistent Skills** — Agents learn reusable scripts (lint, test, deploy) per project. Skills survive across sessions so the hivemind doesn't re-discover how to build/run your stack every time.

🎛️ **Escalation Control Panel** — UI to customize the escalation chain per project. Pin certain tasks to specific models, set cost ceilings, or force free-tier-only mode.

🔀 **Dynamic DAG Rewriting** — Orchestrator detects blocked dependency chains mid-execution and restructures the DAG on the fly — splitting, merging, or reordering tasks without restarting.

🌐 **Multi-Workspace Swarm** — Spawn agents across multiple machines or containers. Distribute work across a cluster, not just local processes.

🔌 **Pluggable Agent Backends** — Swap Copilot CLI for any agent runtime: Codex, Aider, Open Interpreter, local LLMs via Ollama. Mix backends in the same session.

📜 **Session Replay** — Full timeline scrubber for past sessions. Replay the DAG execution frame-by-frame, inspect every agent's output at any point.

📦 **Project Templates** — Pre-built skill packs for common stacks (Express API, React app, CLI tool). Hit the ground running with known-good decomposition patterns.

## License

MIT
