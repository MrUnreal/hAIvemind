# Setup Guide

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | 18+ | ES modules support required |
| **npm** | 9+ | Comes with Node.js |
| **GitHub Copilot CLI** | Latest | Must be on PATH as `copilot` |
| **GitHub Copilot subscription** | Any paid plan | Free plan works — T0 models cost 0× |

### Installing Copilot CLI

```bash
# If you have GitHub CLI (gh):
gh extension install github/gh-copilot

# The CLI should now be available as:
copilot --help
```

If your binary has a different name or path, set the `COPILOT_CMD` environment variable:

```bash
export COPILOT_CMD=/path/to/your/copilot
```

## Installation

```bash
git clone git@github.com:MrUnreal/hAIvemind.git
cd hAIvemind
npm install          # installs server + client dependencies
cp .env.example .env # configure environment
```

## Quick Start with Docker

If you prefer Docker over a local Node.js setup:

```bash
git clone git@github.com:MrUnreal/hAIvemind.git && cd hAIvemind
cp .env.example .env
docker compose up -d     # → http://localhost:3000
```

Docker commands:

| Command | Description |
|---------|-------------|
| `npm run docker:build` | Build the container image |
| `npm run docker:up` | Start in background |
| `npm run docker:down` | Stop and remove containers |

## Running

```bash
npm run dev
```

This starts both services via `concurrently`:
- **Backend** — Express + WebSocket on `http://localhost:3000`
- **Frontend** — Vite dev server on `http://localhost:5173` (proxies API to backend)

### Other scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start both server + client |
| `npm run dev:server` | Server only (with `--watch`) |
| `npm run dev:client` | Vite client only |
| `npm run dev:mock` | Demo mode with mock agents (no Copilot CLI needed) |
| `npm run build:client` | Production build of the frontend |

## Configuration

All configuration lives in [`server/config.js`](../server/config.js):

| Setting | Default | Description |
|---------|---------|-------------|
| `port` | `3000` | Server port |
| `maxConcurrency` | `10` | Max parallel agents at once |
| `swarmMaxConcurrency` | `30` | Dynamic ceiling for swarm scaling |
| `maxRetriesTotal` | `5` | Max retries per task before blocking |
| `orchestratorTier` | `T3` | Model tier used for decomposition/verification |
| `workDir` | `.haivemind-workspace` | Root directory for project workspaces |

### Environment Variables

All variables have sensible defaults. Override via `.env` or environment:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DEMO` | — | Set to `1` for mock agent mode |
| `COPILOT_CMD` | `copilot` | Path to the Copilot CLI binary |
| `HAIVEMIND_MAX_CONCURRENCY` | `10` | Max parallel agents per session |
| `HAIVEMIND_SWARM_MAX_CONCURRENCY` | `30` | Swarm dynamic ceiling |
| `HAIVEMIND_MAX_RETRIES` | `5` | Max total retries across agents |
| `HAIVEMIND_MAX_CROSS_AGENT_LOOPS` | `3` | Max verify-fix loops |
| `HAIVEMIND_AGENT_TIMEOUT_MS` | `300000` | Agent process timeout (5min) |
| `HAIVEMIND_ORCHESTRATOR_TIMEOUT_MS` | `300000` | Orchestrator call timeout |
| `HAIVEMIND_STALL_THRESHOLD_MS` | `90000` | Agent stall detection (90s) |
| `HAIVEMIND_STALL_CHECK_INTERVAL_MS` | `30000` | Stall check interval (30s) |
| `HAIVEMIND_SESSION_RETENTION_MS` | `1800000` | Completed session TTL (30min) |
| `HAIVEMIND_MAX_AGENT_OUTPUT_BYTES` | `102400` | Max output buffer per agent |
| `HAIVEMIND_SIGKILL_GRACE_MS` | `5000` | SIGKILL grace period after SIGTERM |
| `HAIVEMIND_INTERRUPT_KILL_DELAY_MS` | `3000` | Interrupt → force-kill delay |
| `HAIVEMIND_SHUTDOWN_FORCE_EXIT_MS` | `10000` | Shutdown force-exit timeout |
| `HAIVEMIND_ANALYSIS_RACE_TIMEOUT_MS` | `3000` | Workspace analysis race timeout |
| `HAIVEMIND_DEFAULT_BACKEND` | `copilot` | Agent backend (`copilot`, `ollama`, `anthropic`, `openai`) |
| `ANTHROPIC_API_KEY` | — | Required for Anthropic backend |
| `OPENAI_API_KEY` | — | Required for OpenAI backend |
| `HAIVEMIND_OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
| `HAIVEMIND_SWARM_ENABLED` | `false` | Enable multi-workspace swarm |
| `HAIVEMIND_PLUGINS_DIR` | `plugins` | Plugin directory |
| `HAIVEMIND_PLUGINS_AUTOLOAD` | `true` | Auto-load plugins on startup |
| `LOG_LEVEL` | `info` | Log level (`error`/`warn`/`info`/`debug`) |
| `LOG_FORMAT` | `pretty` | Log format (`pretty`/`json`) |

## Usage

1. Open **http://localhost:5173**
2. Create a new project (or select existing)
3. Enter a prompt describing what to build
4. Watch the DAG populate with agents executing in parallel
5. After completion, use the chat panel to send follow-up requests

## Troubleshooting

**"copilot: command not found"**
→ Ensure the Copilot CLI is installed and on your PATH. Try `which copilot` or `where copilot`.

**Port 3000 already in use**
→ Kill existing processes: `lsof -ti:3000 | xargs kill` (macOS/Linux) or `Get-NetTCPConnection -LocalPort 3000 | Stop-Process` (Windows)

**WebSocket disconnects**
→ Check that both server and client are running. The Vite dev server proxies `/ws` to the backend.

**Anthropic/OpenAI backend not working**
→ Set the API key in `.env`: `ANTHROPIC_API_KEY=sk-ant-...` or `OPENAI_API_KEY=sk-...`. The backend returns an error process if no key is configured.

**Demo mode (no API keys needed)**
→ Run `npm run dev:mock` to start with simulated agents. No Copilot CLI or API keys required.

## Multi-Provider Setup

hAIvemind supports 4 agent backends. You can switch backends at runtime via the UI settings or REST API.

| Backend | Requirement | Cost |
|---------|-------------|------|
| **Copilot** (default) | GitHub Copilot CLI on PATH | Free tier (T0) included with subscription |
| **Ollama** | [Ollama](https://ollama.ai) running locally | Free (local models) |
| **Anthropic** | `ANTHROPIC_API_KEY` in `.env` | Pay-per-use |
| **OpenAI** | `OPENAI_API_KEY` in `.env` | Pay-per-use |

Provider failover is automatic — if one backend goes down, requests route to the next healthy provider in the tier's fallback chain.
