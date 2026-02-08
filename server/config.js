// Model configuration and tiering based on GitHub Copilot premium request multipliers
// Uses the real `copilot` CLI (GitHub Copilot Coding Agent)
//
// CLI: copilot --model <model> --prompt <text> --allow-all --silent
//
// Multiplier source: https://docs.github.com/en/copilot/concepts/billing/copilot-requests#model-multipliers
// Coding rankings informed by: Aider polyglot leaderboard, LM Arena coding

// ── Resolve the copilot binary path ──
const COPILOT_CMD = process.env.COPILOT_CMD || 'copilot';

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

  maxRetriesTotal: 5,
  maxCrossAgentLoops: 3,
  maxConcurrency: 3,

  // Working directory for agent outputs
  workDir: '.haivemind-workspace',

  // Server
  port: Number(process.env.PORT) || 3000,
};

/**
 * Get the model config for a given retry count.
 * @param {number} retryIndex - Current retry index (0-based)
 * @returns {{ tierName: string, modelName: string, modelConfig: object }}
 */
export function getModelForRetry(retryIndex) {
  const idx = Math.min(retryIndex, config.escalation.length - 1);
  const tierName = config.escalation[idx];
  const modelName = config.tierDefaults[tierName];
  return { tierName, modelName, modelConfig: config.models[modelName] };
}

/**
 * List all models in a specific tier.
 */
export function getModelsInTier(tierName) {
  return Object.entries(config.models)
    .filter(([, cfg]) => cfg.tier === tierName)
    .map(([name, cfg]) => ({ name, ...cfg }));
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
