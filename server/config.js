// Model configuration and tiering based on GitHub Copilot premium request multipliers
// Uses the real `copilot` CLI (GitHub Copilot Coding Agent)
//
// CLI: copilot --model <model> --prompt <text> --allow-all --silent
//
// Multiplier source: https://docs.github.com/en/copilot/concepts/billing/copilot-requests#model-multipliers
// Coding rankings informed by: Aider polyglot leaderboard, LM Arena coding

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Load .env (no external dependency) ──
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val;  // don't override real env
  }
}

/** Read an env var with an optional default. */
function env(key, fallback) { return process.env[key] ?? fallback; }
function envInt(key, fallback) { const v = process.env[key]; return v != null ? Number(v) : fallback; }
function envBool(key, fallback) { const v = process.env[key]; return v != null ? v === 'true' || v === '1' : fallback; }

// ── Resolve the copilot binary path ──
const COPILOT_CMD = env('COPILOT_CMD', 'copilot');

const config = {
  models: {
    // ════════════════════════════════════════════════════════════════
    // T0 — Free (0× multiplier, included in all paid Copilot plans)
    // These cost NOTHING. Use them aggressively.
    // ════════════════════════════════════════════════════════════════
    'gpt-5.1':            { cmd: COPILOT_CMD, args: ['--model', 'gpt-5.1', '--prompt'],            multiplier: 0,    tier: 'T0' },
    'gpt-5':              { cmd: COPILOT_CMD, args: ['--model', 'gpt-5', '--prompt'],              multiplier: 0,    tier: 'T0' },
    'gpt-5.2':            { cmd: COPILOT_CMD, args: ['--model', 'gpt-5.2', '--prompt'],            multiplier: 0,    tier: 'T0' },

    // ════════════════════════════════════════════════════════════════
    // T1 — Budget (0.33× multiplier)
    // Very cheap. Good for boilerplate, simple fixes, retries.
    // ════════════════════════════════════════════════════════════════
    'claude-haiku-4.5':   { cmd: COPILOT_CMD, args: ['--model', 'claude-haiku-4.5', '--prompt'],   multiplier: 0.33, tier: 'T1' },
    'gemini-3-pro-preview': { cmd: COPILOT_CMD, args: ['--model', 'gemini-3-pro-preview', '--prompt'], multiplier: 0.33, tier: 'T1' },

    // ════════════════════════════════════════════════════════════════
    // T2 — Standard (1× multiplier)
    // Main workhorses. Strong coding ability, reasonable cost.
    // ════════════════════════════════════════════════════════════════
    'claude-sonnet-4.5':  { cmd: COPILOT_CMD, args: ['--model', 'claude-sonnet-4.5', '--prompt'],  multiplier: 1,    tier: 'T2' },
    'claude-sonnet-4':    { cmd: COPILOT_CMD, args: ['--model', 'claude-sonnet-4', '--prompt'],    multiplier: 1,    tier: 'T2' },
    'gpt-5.1-codex':      { cmd: COPILOT_CMD, args: ['--model', 'gpt-5.1-codex', '--prompt'],      multiplier: 1,    tier: 'T2' },
    'gpt-5.1-codex-max':  { cmd: COPILOT_CMD, args: ['--model', 'gpt-5.1-codex-max', '--prompt'],  multiplier: 1,    tier: 'T2' },
    'gpt-5.2-codex':      { cmd: COPILOT_CMD, args: ['--model', 'gpt-5.2-codex', '--prompt'],      multiplier: 1,    tier: 'T2' },

    // ════════════════════════════════════════════════════════════════
    // T3 — Premium (3× multiplier)
    // Heavy hitters. Use for orchestration, complex debugging, and
    // tasks that lower tiers can't solve.
    // ════════════════════════════════════════════════════════════════
    'claude-opus-4.5':    { cmd: COPILOT_CMD, args: ['--model', 'claude-opus-4.5', '--prompt'],    multiplier: 3,    tier: 'T3' },
  },

  // ── Default model for each tier (pick the best coder at that price) ──
  tierDefaults: {
    T0: 'gpt-5.1',            // Strong baseline, free
    T1: 'claude-haiku-4.5',   // Best budget coder
    T2: 'claude-sonnet-4.5',  // Top-tier coding at 1×
    T3: 'claude-opus-4.5',    // Orchestrator / last-resort worker
  },

  // Escalation path: retry index → tier to use
  // retry 0,1 = T0 (free), retry 2 = T1 (budget), retry 3 = T2, retry 4 = T3 (cap)
  escalation: ['T0', 'T0', 'T1', 'T2', 'T3'],

  // The orchestrator / planner model tier
  orchestratorTier: 'T3',

  maxRetriesTotal: envInt('HAIVEMIND_MAX_RETRIES', 5),
  maxCrossAgentLoops: envInt('HAIVEMIND_MAX_CROSS_AGENT_LOOPS', 3),
  maxConcurrency: envInt('HAIVEMIND_MAX_CONCURRENCY', 3),

  // Working directory for agent outputs
  workDir: '.haivemind-workspace',

  // Server
  port: envInt('PORT', 3000),

  agentTimeoutMs: envInt('HAIVEMIND_AGENT_TIMEOUT_MS', 300000),
  orchestratorTimeoutMs: envInt('HAIVEMIND_ORCHESTRATOR_TIMEOUT_MS', 300000),
  sessionRetentionMs: envInt('HAIVEMIND_SESSION_RETENTION_MS', 30 * 60 * 1000),
  maxAgentOutputBytes: envInt('HAIVEMIND_MAX_AGENT_OUTPUT_BYTES', 100 * 1024),

  // DAG Rewriting — stall detection
  stallThresholdMs: envInt('HAIVEMIND_STALL_THRESHOLD_MS', 90000),
  stallCheckIntervalMs: envInt('HAIVEMIND_STALL_CHECK_INTERVAL_MS', 30000),

  // Pluggable Agent Backends
  defaultBackend: env('HAIVEMIND_DEFAULT_BACKEND', 'copilot'),
  backends: {
    copilot: {},           // uses model configs above
    ollama: {              // local LLM via Ollama
      host: env('HAIVEMIND_OLLAMA_HOST', 'http://localhost:11434'),
      model: env('HAIVEMIND_OLLAMA_MODEL', 'codellama'),
    },
  },

  // Multi-Workspace Swarm
  swarm: {
    enabled: envBool('HAIVEMIND_SWARM_ENABLED', false),
    runners: [],           // e.g. [{ type: 'docker', image: 'haivemind/agent', maxContainers: 4 }]
  },

  // Plugin System (Phase 5.7)
  plugins: {
    dir: env('HAIVEMIND_PLUGINS_DIR', 'plugins'),
    autoLoad: envBool('HAIVEMIND_PLUGINS_AUTOLOAD', true),
  },
};

/**
 * Get the model config for a given retry count.
 * @param {number} retryIndex - Current retry index (0-based)
 * @param {object} [overrides] - Per-project overrides { escalation, pinnedModels }
 * @param {string} [taskLabel] - Task label for pinned model matching
 * @returns {{ tierName: string, modelName: string, modelConfig: object }}
 */
export function getModelForRetry(retryIndex, overrides, taskLabel) {
  // Check for pinned model first
  if (taskLabel && overrides?.pinnedModels) {
    for (const [pattern, modelName] of Object.entries(overrides.pinnedModels)) {
      if (taskLabel.toLowerCase().includes(pattern.toLowerCase()) && config.models[modelName]) {
        const modelConfig = config.models[modelName];
        return { tierName: modelConfig.tier, modelName, modelConfig };
      }
    }
  }

  const chain = overrides?.escalation || config.escalation;
  const maxRetries = overrides?.maxRetriesTotal || config.maxRetriesTotal;
  const idx = Math.min(retryIndex, chain.length - 1);
  const tierName = chain[idx];
  const modelName = config.tierDefaults[tierName];
  return { tierName, modelName, modelConfig: config.models[modelName] };
}

/**
 * Get the orchestrator model config.
 */
export function getOrchestratorModel() {
  const tierName = config.orchestratorTier;
  const modelName = config.tierDefaults[tierName];
  return { tierName, modelName, modelConfig: config.models[modelName] };
}

export default config;
