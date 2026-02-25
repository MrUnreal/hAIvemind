/**
 * server/services/taskRouter.js — Phase 14.2: Intelligent Task Routing
 *
 * Replaces static T0→T0→T1→T2→T3 escalation with learned routing.
 * Tracks success rates per model per task category. Over time, routes
 * tasks directly to models that succeed at specific categories.
 *
 * Uses epsilon-greedy exploration: most of the time, pick the best-known
 * model for this category — but occasionally try alternatives to discover
 * better options.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { categorizeTask } from './patternBank.js';
import config from '../config.js';

// ─── Routing State ───────────────────────────────────────────────────
/** @type {Map<string, RoutingTable>} */
const projectTables = new Map();

/**
 * @typedef {Object} ModelRecord
 * @property {string} model
 * @property {string} tier
 * @property {number} successes
 * @property {number} failures
 * @property {number} totalDurationMs
 * @property {number} lastUsed
 */

/**
 * @typedef {Object} RoutingTable
 * @property {Object<string, Object<string, ModelRecord>>} categories — category → model → record
 * @property {number} totalDecisions
 * @property {number} explorations
 */

const DEFAULT_EPSILON = 0.15; // 15% exploration rate
const MIN_OBSERVATIONS = 3;  // Need at least 3 observations before trusting a model

/**
 * Get or create routing table for a project.
 * @param {string} slug
 * @returns {RoutingTable}
 */
function getTable(slug) {
  if (projectTables.has(slug)) return projectTables.get(slug);

  const path = join('.haivemind', 'routing', `${slug}.json`);
  let table;
  if (existsSync(path)) {
    try {
      table = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      table = null;
    }
  }
  if (!table) {
    table = { categories: {}, totalDecisions: 0, explorations: 0 };
  }

  projectTables.set(slug, table);
  return table;
}

/**
 * Persist routing table to disk.
 * @param {string} slug
 */
function saveTable(slug) {
  const table = projectTables.get(slug);
  if (!table) return;
  const path = join('.haivemind', 'routing', `${slug}.json`);
  const dir = path.replace(/[/\\][^/\\]+$/, '');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(table, null, 2));
}

/**
 * Record a task outcome for future routing.
 *
 * @param {string} slug — project slug
 * @param {string} taskLabel — task label for categorization
 * @param {string} model — model used
 * @param {string} tier — tier used
 * @param {boolean} success — whether the task succeeded
 * @param {number} [durationMs=0] — task duration
 */
export function recordOutcome(slug, taskLabel, model, tier, success, durationMs = 0) {
  const table = getTable(slug);
  const category = categorizeTask(taskLabel);

  if (!table.categories[category]) table.categories[category] = {};
  const catModels = table.categories[category];

  if (!catModels[model]) {
    catModels[model] = { model, tier, successes: 0, failures: 0, totalDurationMs: 0, lastUsed: 0 };
  }

  const record = catModels[model];
  if (success) {
    record.successes++;
  } else {
    record.failures++;
  }
  record.totalDurationMs += durationMs;
  record.lastUsed = Date.now();

  saveTable(slug);
}

/**
 * Get the recommended model for a task based on learned patterns.
 * Uses epsilon-greedy: exploit best-known model (1-ε) of the time,
 * explore alternatives (ε) of the time.
 *
 * @param {string} slug — project slug
 * @param {string} taskLabel — task label
 * @param {number} retryIndex — current retry (higher retries → higher tiers)
 * @param {object} [overrides] — per-project overrides
 * @returns {{ model: string, tier: string, reason: string, explored: boolean } | null}
 *   Returns null if insufficient data (fall back to default escalation).
 */
export function getRecommendedModel(slug, taskLabel, retryIndex, overrides) {
  const table = getTable(slug);
  const category = categorizeTask(taskLabel);
  const catModels = table.categories[category];

  // Not enough data for this category — use default escalation
  if (!catModels || Object.keys(catModels).length === 0) return null;

  // Build scored candidates
  const candidates = Object.values(catModels)
    .filter(r => (r.successes + r.failures) >= MIN_OBSERVATIONS)
    .map(r => {
      const total = r.successes + r.failures;
      const successRate = r.successes / total;
      const avgDuration = r.totalDurationMs / total;
      const modelConfig = config.models[r.model];
      const costMultiplier = modelConfig?.multiplier ?? 1;

      // Score: success rate (primary), cost efficiency (secondary), speed (tertiary)
      // Higher is better
      const score = (successRate * 100) - (costMultiplier * 5) - (avgDuration / 60000);
      return { ...r, successRate, avgDuration, score, costMultiplier };
    })
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return null;

  table.totalDecisions++;

  // Epsilon-greedy exploration
  const epsilon = overrides?.explorationRate ?? DEFAULT_EPSILON;
  const explore = Math.random() < epsilon && candidates.length > 1;

  let chosen;
  if (explore) {
    // Pick a random non-best candidate
    const alternates = candidates.slice(1);
    chosen = alternates[Math.floor(Math.random() * alternates.length)];
    table.explorations++;
  } else {
    chosen = candidates[0];
  }

  // On higher retries, force escalation if the recommended tier is too low
  const chain = overrides?.escalation || config.escalation;
  const minTier = chain[Math.min(retryIndex, chain.length - 1)];
  const tierOrder = ['T0', 'T1', 'T2', 'T3'];
  const chosenTierIdx = tierOrder.indexOf(chosen.tier);
  const minTierIdx = tierOrder.indexOf(minTier);

  if (chosenTierIdx < minTierIdx) {
    // Force minimum tier for this retry level
    return null; // Fall back to default escalation
  }

  saveTable(slug);

  return {
    model: chosen.model,
    tier: chosen.tier,
    reason: explore
      ? `[explore] Trying ${chosen.model} (${Math.round(chosen.successRate * 100)}% success on ${category} tasks)`
      : `[learned] Best model for ${category}: ${chosen.model} (${Math.round(chosen.successRate * 100)}% success, ${chosen.successes}/${chosen.successes + chosen.failures} tasks)`,
    explored: explore,
  };
}

/**
 * Get routing statistics for a project.
 * @param {string} slug
 * @returns {object}
 */
export function getRoutingStats(slug) {
  const table = getTable(slug);

  const categoryStats = {};
  for (const [category, models] of Object.entries(table.categories)) {
    const modelList = Object.values(models).map(m => ({
      model: m.model,
      tier: m.tier,
      successRate: m.successes + m.failures > 0 ? m.successes / (m.successes + m.failures) : 0,
      total: m.successes + m.failures,
      avgDuration: m.successes + m.failures > 0 ? Math.round(m.totalDurationMs / (m.successes + m.failures)) : 0,
    }));
    modelList.sort((a, b) => b.successRate - a.successRate);
    categoryStats[category] = modelList;
  }

  return {
    totalDecisions: table.totalDecisions,
    explorations: table.explorations,
    explorationRate: table.totalDecisions > 0 ? table.explorations / table.totalDecisions : 0,
    categories: categoryStats,
  };
}

/**
 * Reset routing data for a project (useful for testing).
 * @param {string} slug
 */
export function resetRouting(slug) {
  projectTables.set(slug, { categories: {}, totalDecisions: 0, explorations: 0 });
  saveTable(slug);
}
