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
npm install
```

This installs both server and client dependencies.

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
| `maxConcurrency` | `3` | Max parallel agents at once |
| `maxRetriesTotal` | `5` | Max retries per task before blocking |
| `orchestratorTier` | `T3` | Model tier used for decomposition/verification |
| `workDir` | `.haivemind-workspace` | Root directory for project workspaces |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COPILOT_CMD` | `copilot` | Path to the Copilot CLI binary |
| `DEMO` | — | Set to `1` for mock agent mode |

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
