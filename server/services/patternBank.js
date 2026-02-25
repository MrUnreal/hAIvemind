/**
 * server/services/patternBank.js — Phase 14.1: Pattern Learning Bank
 *
 * Learns from session outcomes: which decomposition strategies worked,
 * which models succeeded for which task types, common failure→fix sequences.
 * Stores patterns as embeddable entries in the vector memory.
 * Feeds matching patterns into orchestrator.decompose() as few-shot context.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { storeVector, searchVectors, saveIndex } from './vectorMemory.js';

// ─── Pattern Categories ──────────────────────────────────────────────
export const PATTERN_TYPES = {
  DECOMPOSITION: 'decomposition',   // How a prompt was broken into tasks
  MODEL_SUCCESS: 'model-success',   // Which model succeeded for which task type
  FAILURE_FIX: 'failure-fix',       // Error patterns and their resolutions
  TASK_STRATEGY: 'task-strategy',   // Effective task descriptions that worked
  ESCALATION: 'escalation',         // When/why escalation was needed
};

/**
 * Record a successful decomposition pattern.
 * Called after a session completes successfully.
 *
 * @param {string} slug — project slug
 * @param {object} session — completed session data
 * @param {object} session.prompt — original user prompt
 * @param {Array} session.tasks — task list with outcomes
 * @param {object} session.stats — session stats (waves, splits, retries)
 */
export function recordDecompositionPattern(slug, session) {
  const id = `pat-decomp-${Date.now()}-${randomBytes(3).toString('hex')}`;

  const taskSummary = (session.tasks || []).map(t => ({
    label: t.label,
    status: t.status,
    model: t.model,
    tier: t.modelTier,
    retries: t.retries || 0,
  }));

  const totalTasks = taskSummary.length;
  const successCount = taskSummary.filter(t => t.status === 'success').length;
  const successRate = totalTasks > 0 ? successCount / totalTasks : 0;

  // Only store patterns with decent success rates
  if (successRate < 0.5) return null;

  const pattern = {
    type: PATTERN_TYPES.DECOMPOSITION,
    prompt: session.prompt,
    taskCount: totalTasks,
    tasks: taskSummary,
    successRate,
    waves: session.stats?.waves || 0,
    splits: session.stats?.splits || 0,
    timestamp: Date.now(),
  };

  // Store in vector memory for semantic retrieval
  const text = `${session.prompt} | Tasks: ${taskSummary.map(t => t.label).join(', ')} | Success: ${Math.round(successRate * 100)}%`;
  storeVector(slug, id, text, { patternType: PATTERN_TYPES.DECOMPOSITION, ...pattern });

  // Also store in flat JSON for fast enumeration
  _appendPattern(slug, id, pattern);
  saveIndex(slug);

  return { id, pattern };
}

/**
 * Record a model success pattern — which model worked for which task category.
 *
 * @param {string} slug
 * @param {object} task — completed task
 * @param {string} model — model that succeeded
 * @param {string} tier — model tier (T0-T3)
 * @param {number} retryIndex — retry at which it succeeded
 */
export function recordModelSuccess(slug, task, model, tier, retryIndex) {
  const id = `pat-model-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const category = categorizeTask(task.label);

  const pattern = {
    type: PATTERN_TYPES.MODEL_SUCCESS,
    taskLabel: task.label,
    taskCategory: category,
    model,
    tier,
    retryIndex,
    firstAttemptSuccess: retryIndex === 0,
    timestamp: Date.now(),
  };

  const text = `${category} task "${task.label}" succeeded with ${model} (${tier}) on retry ${retryIndex}`;
  storeVector(slug, id, text, { patternType: PATTERN_TYPES.MODEL_SUCCESS, ...pattern });
  _appendPattern(slug, id, pattern);

  return { id, pattern };
}

/**
 * Record a failure→fix pattern.
 *
 * @param {string} slug
 * @param {object} task
 * @param {string} errorSummary — condensed error description
 * @param {string} fixDescription — what resolved it
 * @param {string} fixModel — model that performed the fix
 */
export function recordFailureFix(slug, task, errorSummary, fixDescription, fixModel) {
  const id = `pat-fix-${Date.now()}-${randomBytes(3).toString('hex')}`;

  const pattern = {
    type: PATTERN_TYPES.FAILURE_FIX,
    taskLabel: task.label,
    taskCategory: categorizeTask(task.label),
    error: errorSummary,
    fix: fixDescription,
    fixModel,
    timestamp: Date.now(),
  };

  const text = `Error in "${task.label}": ${errorSummary} | Fixed by: ${fixDescription}`;
  storeVector(slug, id, text, { patternType: PATTERN_TYPES.FAILURE_FIX, ...pattern });
  _appendPattern(slug, id, pattern);

  return { id, pattern };
}

/**
 * Recall relevant patterns for a new prompt.
 * Used to provide few-shot context to the orchestrator's decompose().
 *
 * @param {string} slug
 * @param {string} prompt — the new user prompt
 * @param {number} [limit=5]
 * @returns {Array<{ id: string, similarity: number, data: object }>}
 */
export function recallPatterns(slug, prompt, limit = 5) {
  return searchVectors(slug, prompt, limit, 0.15);
}

/**
 * Recall patterns specifically for model routing decisions.
 *
 * @param {string} slug
 * @param {string} taskLabel
 * @param {number} [limit=10]
 * @returns {Array<{ model: string, tier: string, successRate: number, category: string }>}
 */
export function recallModelPatterns(slug, taskLabel, limit = 10) {
  const category = categorizeTask(taskLabel);
  const results = searchVectors(slug, `${category} ${taskLabel}`, limit * 2, 0.1);

  // Filter to model-success patterns and aggregate
  const modelStats = new Map();

  for (const r of results) {
    if (r.data?.patternType !== PATTERN_TYPES.MODEL_SUCCESS) continue;
    const key = `${r.data.model}|${r.data.tier}`;
    if (!modelStats.has(key)) {
      modelStats.set(key, { model: r.data.model, tier: r.data.tier, category: r.data.taskCategory, successes: 0, total: 0 });
    }
    const stats = modelStats.get(key);
    stats.successes++;
    stats.total++;
  }

  return [...modelStats.values()]
    .map(s => ({ ...s, successRate: s.successes / s.total }))
    .sort((a, b) => b.successRate - a.successRate)
    .slice(0, limit);
}

/**
 * Format recalled patterns as context for orchestrator prompts.
 *
 * @param {string} slug
 * @param {string} prompt
 * @returns {string} — formatted context block, or empty string
 */
export function getPatternsAsContext(slug, prompt) {
  const patterns = recallPatterns(slug, prompt, 5);
  if (patterns.length === 0) return '';

  const lines = ['## Learned Patterns (from previous sessions)'];

  for (const p of patterns) {
    const d = p.data;
    if (d.patternType === PATTERN_TYPES.DECOMPOSITION) {
      const taskNames = (d.tasks || []).map(t => t.label).join(', ');
      lines.push(`- Similar prompt decomposed into ${d.taskCount} tasks (${Math.round(d.successRate * 100)}% success): ${taskNames}`);
    } else if (d.patternType === PATTERN_TYPES.FAILURE_FIX) {
      lines.push(`- Error pattern: "${d.error}" → Fixed by: ${d.fix}`);
    } else if (d.patternType === PATTERN_TYPES.TASK_STRATEGY) {
      lines.push(`- Effective strategy: ${d.text || d.taskLabel}`);
    }
  }

  return lines.length > 1 ? lines.join('\n') + '\n' : '';
}

/**
 * Get pattern statistics for a project.
 * @param {string} slug
 * @returns {object}
 */
export function getPatternStats(slug) {
  const patterns = _loadPatterns(slug);
  const byType = {};
  for (const p of patterns) {
    byType[p.type] = (byType[p.type] || 0) + 1;
  }
  return {
    total: patterns.length,
    byType,
    oldestTimestamp: patterns.length > 0 ? patterns[patterns.length - 1].timestamp : null,
    newestTimestamp: patterns.length > 0 ? patterns[0].timestamp : null,
  };
}

// ─── Task Categorization ─────────────────────────────────────────────
const CATEGORY_PATTERNS = [
  [/\b(tests?|specs?|jest|vitest|mocha|cypress|unittest)\b/i, 'testing'],
  [/\b(docs?|readme|comments?|jsdoc|typedoc|documentation)\b/i, 'documentation'],
  [/\b(deploy|docker|ci|cd|pipeline|workflow|helm|k8s|kubernetes)\b/i, 'devops'],
  [/\b(setup|init|scaffold|bootstrap|install|config)\b/i, 'setup'],
  [/\b(auth|login|signup|jwt|oauth|session|password)\b/i, 'authentication'],
  [/\b(api|endpoints?|routes?|rest|graphql|handler)\b/i, 'api'],
  [/\b(database|db|sql|schema|migration|models?|prisma|mongoose)\b/i, 'database'],
  [/\b(ui|components?|view|page|layout|styles?|css|tailwind)\b/i, 'frontend'],
  [/\b(security|vulnerability|audit|sanitize|validate|xss|csrf)\b/i, 'security'],
  [/\b(refactor|clean|optimize|performance|speed)\b/i, 'refactoring'],
  [/\b(websocket|socket|real.?time|stream|sse|pubsub)\b/i, 'realtime'],
  [/\b(verify|validate|check|lint|format)\b/i, 'verification'],
];

/**
 * Categorize a task based on its label.
 * @param {string} label
 * @returns {string}
 */
export function categorizeTask(label) {
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(label)) return category;
  }
  return 'implementation';
}

// ─── Flat Pattern Store (JSON) ───────────────────────────────────────
function _getPatternPath(slug) {
  return join('.haivemind', 'patterns', `${slug}.json`);
}

function _loadPatterns(slug) {
  const path = _getPatternPath(slug);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
}

function _appendPattern(slug, id, pattern) {
  const patterns = _loadPatterns(slug);
  patterns.unshift({ id, ...pattern });
  // Cap at 1000 patterns per project
  if (patterns.length > 1000) patterns.length = 1000;

  const path = _getPatternPath(slug);
  const dir = path.replace(/[/\\][^/\\]+$/, '');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(patterns, null, 2));
}
