<p align="center">
  <img src="resources/logo.png" alt="hAIvemind" width="300">
</p>

<h1 align="center">hAIvemind</h1>

<p align="center">
  <strong>Massively parallel AI agent orchestrator</strong><br>
  Many small agents, one hivemind — powered by GitHub Copilot CLI
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-ES%20Modules-339933?logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/Vue%203-Flow%20DAG-4FC08D?logo=vue.js" alt="Vue 3">
  <img src="https://img.shields.io/badge/Copilot%20CLI-Agent%20Backend-0078D4?logo=github" alt="Copilot CLI">
</p>

---

## What is hAIvemind?

hAIvemind is an orchestration platform that decomposes complex coding tasks into many small, parallel subtasks — each executed by an independent AI agent (GitHub Copilot CLI). A central orchestrator plans the work with maximum parallelism, assigns agents, verifies results, and iterates until the project is complete.

**Philosophy:** Many small agents controlled by a hivemind orchestrator. Start from nothing, build in parallel, verify holistically, fix collaboratively.

## How It Works

```
User Prompt
    │
    ▼
┌──────────────┐
│  Orchestrator │  ← T3 model (architect)
│  Decompose    │
└──────┬───────┘
       │ Parallelism-first plan
       ▼
┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐
│A1│ │A2│ │A3│ │A4│ │A5│ │A6│ │A7│  ← T0 agents (free)
└──┘ └──┘ └──┘ └──┘ └──┘ └──┘ └──┘
       │ All run simultaneously
       ▼
┌──────────────┐
│   Verify &   │  ← Orchestrator reviews
│  Fix Loop    │  ← Spawns parallel fix agents
└──────┬───────┘
       │
       ▼
   ✅ Done (or iterate via chat)
```

1. **Decompose** — The orchestrator (high-tier model) breaks your request into independent tasks, pre-specifying interfaces so agents can build in parallel without waiting for each other.
2. **Execute** — All independent tasks launch simultaneously as separate Copilot CLI agents. Each agent gets its own workspace directory.
3. **Verify** — After all agents finish, the orchestrator reviews the entire codebase for integration issues.
4. **Fix** — If verification finds issues, they're decomposed into parallel fix tasks and executed by more agents.
5. **Iterate** — Send follow-up messages via chat to extend the DAG with new tasks, building on previous work.

## Architecture

```
┌─────────────────────────────────────────┐
│              Vue 3 Frontend              │
│  ┌───────────┐  ┌──────────────────┐    │
│  │ VueFlow   │  │ Orchestrator     │    │
│  │ DAG View  │  │ Chat (iMessage)  │    │
│  └───────────┘  └──────────────────┘    │
└────────────────┬────────────────────────┘
                 │ WebSocket
┌────────────────┴────────────────────────┐
│           Express Backend                │
│  ┌──────────────┐  ┌────────────────┐   │
│  │ Orchestrator  │  │  TaskRunner    │   │
│  │ (decompose,   │  │  (DAG exec,   │   │
│  │  verify)      │  │   retry,      │   │
│  └──────────────┘  │   escalate)    │   │
│                     └────────────────┘   │
│  ┌──────────────┐  ┌────────────────┐   │
│  │ AgentManager  │  │  Workspace     │   │
│  │ (spawn CLI)   │  │  Manager       │   │
│  └──────────────┘  └────────────────┘   │
└─────────────────────────────────────────┘
           │
           ▼  child_process.spawn
    ┌─────────────┐
    │ copilot CLI  │  × N parallel agents
    └─────────────┘
```

## Model Tiering

| Tier | Models | Cost | Use Case |
|------|--------|------|----------|
| **T0** | gpt-5.1, gpt-5, gpt-5.2 | Free (0×) | Default for all agents |
| **T1** | claude-haiku-4.5, gemini-3-pro | 0.33× | Budget retries |
| **T2** | claude-sonnet-4.5, gpt-5.1-codex | 1× | Escalation for complex tasks |
| **T3** | claude-opus-4.5 | 3× | Orchestrator only |

**Escalation chain:** T0 → T0 → T1 → T2 → T3. Failed agents automatically retry with increasingly capable models.

## Features

- **Maximum parallelism** — All independent tasks execute simultaneously
- **Visual DAG** — Real-time directed acyclic graph showing task status, dependencies, and flow
- **Iterative development** — Chat with the orchestrator to extend the project after initial build
- **Smart retry & escalation** — Failed tasks retry with escalated model tiers
- **Per-project workspaces** — Each project gets isolated workspace directories
- **Session history** — Browse and reload past sessions
- **Zero premium cost by default** — T0 models are included free with GitHub Copilot

## Getting Started

### Prerequisites

- **Node.js** 18+
- **GitHub Copilot CLI** (`copilot` command on PATH)
  - Requires an active [GitHub Copilot](https://github.com/features/copilot) subscription
  - Install: `gh extension install github/gh-copilot` then use `copilot` or configure `COPILOT_CMD`

### Install & Run

```bash
git clone git@github.com:MrUnreal/hAIvemind.git
cd hAIvemind
npm install
npm run dev
```

This starts both the backend (port 3000) and frontend (port 5173) via `concurrently`.

### Usage

1. Open http://localhost:5173
2. Create or select a project
3. Enter a prompt describing what you want to build
4. Watch agents work in parallel on the DAG view
5. After completion, send follow-up messages to iterate

## Project Structure

```
hAIvemind/
├── server/
│   ├── index.js          # Express + WebSocket server, session lifecycle
│   ├── orchestrator.js   # Decomposition, verification, failure analysis
│   ├── taskRunner.js     # DAG execution, retry, escalation
│   ├── agentManager.js   # Copilot CLI agent spawning
│   ├── config.js         # Model tiers, escalation config
│   └── workspace.js      # Per-project workspace isolation
├── client/
│   └── src/
│       ├── App.vue                  # Root app with workspace layout
│       ├── components/
│       │   ├── FlowCanvas.vue       # VueFlow DAG visualization
│       │   ├── AgentNode.vue        # Task node component
│       │   ├── BookendNode.vue      # START/END nodes
│       │   ├── PromptNode.vue       # Iteration bridge nodes
│       │   ├── OrchestratorChat.vue # iMessage-style chat
│       │   ├── AgentDetail.vue      # Agent output viewer
│       │   ├── ProjectPicker.vue    # Project selection
│       │   ├── PromptInput.vue      # Initial prompt entry
│       │   └── SessionHistory.vue   # Past session browser
│       ├── composables/
│       │   ├── useSession.js        # Reactive session state
│       │   ├── useWebSocket.js      # Singleton WebSocket
│       │   └── useProjects.js       # Project management
│       └── utils/
│           └── layout.js            # DAG layout algorithm
├── shared/
│   └── protocol.js       # WebSocket message types
├── resources/
│   └── logo.png          # Project logo
└── package.json
```

## License

MIT
