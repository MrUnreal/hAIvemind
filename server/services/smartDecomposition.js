/**
 * server/services/smartDecomposition.js — Smart Decomposition
 *
 * ML-inspired task decomposition heuristics, complexity estimation,
 * parallel-vs-sequential auto-detection, sub-task merging.
 *
 * Data stored in project settings under `decompositions`.
 */

import { refs } from '../state.js';

// ─── Constants ──────────────────────────────────────────────────────────

export const COMPLEXITY_LEVELS = ['trivial', 'simple', 'moderate', 'complex', 'epic'];
export const EXECUTION_MODES = ['sequential', 'parallel', 'mixed'];

const COMPLEXITY_WEIGHTS = {
  trivial: 1,
  simple: 2,
  moderate: 4,
  complex: 8,
  epic: 16,
};

// Keyword heuristics for complexity estimation
const COMPLEXITY_SIGNALS = {
  high: ['refactor', 'migrate', 'redesign', 'architecture', 'security', 'authentication',
    'database', 'schema', 'deploy', 'infrastructure', 'performance', 'optimize', 'scale'],
  medium: ['integrate', 'implement', 'feature', 'api', 'endpoint', 'service',
    'component', 'module', 'test', 'validation'],
  low: ['fix', 'update', 'add', 'remove', 'rename', 'typo', 'docs', 'comment',
    'style', 'format', 'lint', 'config', 'env'],
};

// ─── Helpers ────────────────────────────────────────────────────────────

function _genId(prefix = 'dec') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function _getDecompositions(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  return settings.decompositions || [];
}

function _saveDecompositions(slug, decs) {
  if (decs.length > 500) decs.splice(0, decs.length - 500);
  refs.workspace?.updateProjectSettings?.(slug, { decompositions: decs });
}

// ─── Complexity Estimation ──────────────────────────────────────────────

/**
 * Estimate complexity of a task description.
 * @param {string} description
 * @returns {{ level: string, score: number, signals: string[], reasoning: string }}
 */
export function estimateComplexity(description) {
  const lower = (description || '').toLowerCase();
  const signals = [];
  let score = 0;

  // Keyword signals
  for (const keyword of COMPLEXITY_SIGNALS.high) {
    if (lower.includes(keyword)) {
      score += 3;
      signals.push(`high:${keyword}`);
    }
  }
  for (const keyword of COMPLEXITY_SIGNALS.medium) {
    if (lower.includes(keyword)) {
      score += 2;
      signals.push(`med:${keyword}`);
    }
  }
  for (const keyword of COMPLEXITY_SIGNALS.low) {
    if (lower.includes(keyword)) {
      score += 1;
      signals.push(`low:${keyword}`);
    }
  }

  // Length heuristic: longer descriptions often mean more complex tasks
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  if (wordCount > 50) { score += 4; signals.push('length:long'); }
  else if (wordCount > 20) { score += 2; signals.push('length:medium'); }

  // Determine level
  let level;
  if (score <= 2) level = 'trivial';
  else if (score <= 5) level = 'simple';
  else if (score <= 10) level = 'moderate';
  else if (score <= 18) level = 'complex';
  else level = 'epic';

  const reasoning = `Score ${score} based on ${signals.length} signals: ${signals.slice(0, 5).join(', ')}`;

  return { level, score, signals, reasoning };
}

// ─── Decomposition ──────────────────────────────────────────────────────

/**
 * Decompose a task into sub-tasks with heuristic analysis.
 * @param {string} slug
 * @param {object} data
 * @param {string} data.name - Task name
 * @param {string} data.description - Full description
 * @param {string[]} [data.hints] - Optional decomposition hints
 * @returns {object} The decomposition record
 */
export function decompose(slug, data) {
  if (!data.name) throw new Error('Task name is required');
  if (!data.description) throw new Error('Description is required');

  const complexity = estimateComplexity(data.description);
  const subtasks = _generateSubtasks(data.description, data.hints || [], complexity);
  const executionMode = _detectExecutionMode(subtasks);

  const dec = {
    id: _genId(),
    name: data.name,
    description: data.description,
    complexity,
    subtasks,
    executionMode,
    totalWeight: subtasks.reduce((sum, st) => sum + (COMPLEXITY_WEIGHTS[st.complexity] || 2), 0),
    estimatedParallelism: _calculateParallelism(subtasks, executionMode),
    createdAt: Date.now(),
  };

  const decs = _getDecompositions(slug);
  decs.push(dec);
  _saveDecompositions(slug, decs);

  return dec;
}

/**
 * Generate sub-tasks from description using heuristics.
 */
function _generateSubtasks(description, hints, complexity) {
  const subtasks = [];
  const lower = description.toLowerCase();

  // Use hints if provided
  if (hints.length > 0) {
    for (const hint of hints) {
      const est = estimateComplexity(hint);
      subtasks.push({
        id: _genId('st'),
        name: hint,
        complexity: est.level,
        weight: COMPLEXITY_WEIGHTS[est.level] || 2,
        canParallelize: !_hasDependencySignals(hint, hints),
        order: subtasks.length,
      });
    }
    return subtasks;
  }

  // Auto-detect from sentence structure
  const sentences = description.split(/[.;]\s*/).filter(s => s.trim().length > 5);

  if (sentences.length <= 1) {
    // Single sentence — decompose by complexity
    if (complexity.level === 'trivial' || complexity.level === 'simple') {
      subtasks.push({
        id: _genId('st'),
        name: description.trim(),
        complexity: complexity.level,
        weight: COMPLEXITY_WEIGHTS[complexity.level],
        canParallelize: false,
        order: 0,
      });
    } else {
      // Produce analysis, implementation, testing phases
      const phases = ['Analyze requirements', 'Implement changes', 'Write tests', 'Review & refine'];
      for (let i = 0; i < phases.length; i++) {
        subtasks.push({
          id: _genId('st'),
          name: phases[i],
          complexity: i === 1 ? complexity.level : 'simple',
          weight: COMPLEXITY_WEIGHTS[i === 1 ? complexity.level : 'simple'],
          canParallelize: false,
          order: i,
        });
      }
    }
  } else {
    // Multiple sentences — each gets a subtask
    for (let i = 0; i < sentences.length; i++) {
      const est = estimateComplexity(sentences[i]);
      subtasks.push({
        id: _genId('st'),
        name: sentences[i].trim(),
        complexity: est.level,
        weight: COMPLEXITY_WEIGHTS[est.level] || 2,
        canParallelize: !lower.includes('then') && !lower.includes('after'),
        order: i,
      });
    }
  }

  return subtasks;
}

/**
 * Check if a step has dependency signals relative to other hints.
 */
function _hasDependencySignals(hint, allHints) {
  const lower = hint.toLowerCase();
  return lower.includes('after') || lower.includes('depends on') ||
    lower.includes('then') || lower.includes('once');
}

/**
 * Detect whether subtasks can run sequentially, in parallel, or mixed.
 */
function _detectExecutionMode(subtasks) {
  if (subtasks.length <= 1) return 'sequential';
  const parallelCount = subtasks.filter(st => st.canParallelize).length;
  if (parallelCount === subtasks.length) return 'parallel';
  if (parallelCount === 0) return 'sequential';
  return 'mixed';
}

/**
 * Calculate effective parallelism factor.
 */
function _calculateParallelism(subtasks, mode) {
  if (mode === 'sequential') return 1;
  if (mode === 'parallel') return subtasks.length;
  const parallelCount = subtasks.filter(st => st.canParallelize).length;
  return Math.max(1, Math.round(parallelCount / 2) + 1);
}

// ─── Decomposition CRUD ─────────────────────────────────────────────────

/**
 * List all decompositions.
 */
export function listDecompositions(slug) {
  return _getDecompositions(slug);
}

/**
 * Get a decomposition by ID.
 */
export function getDecomposition(slug, decId) {
  return _getDecompositions(slug).find(d => d.id === decId) || null;
}

/**
 * Delete a decomposition.
 */
export function deleteDecomposition(slug, decId) {
  const decs = _getDecompositions(slug);
  const idx = decs.findIndex(d => d.id === decId);
  if (idx === -1) return false;
  decs.splice(idx, 1);
  _saveDecompositions(slug, decs);
  return true;
}

// ─── Sub-task Merging ───────────────────────────────────────────────────

/**
 * Merge two sub-tasks within a decomposition.
 * @param {string} slug
 * @param {string} decId - Decomposition ID
 * @param {string} subtask1Id
 * @param {string} subtask2Id
 * @param {string} [mergedName] - Optional name for merged task
 * @returns {object|null}
 */
export function mergeSubtasks(slug, decId, subtask1Id, subtask2Id, mergedName) {
  const decs = _getDecompositions(slug);
  const dec = decs.find(d => d.id === decId);
  if (!dec) return null;

  const idx1 = dec.subtasks.findIndex(st => st.id === subtask1Id);
  const idx2 = dec.subtasks.findIndex(st => st.id === subtask2Id);
  if (idx1 === -1 || idx2 === -1) return null;

  const st1 = dec.subtasks[idx1];
  const st2 = dec.subtasks[idx2];

  // Merged task takes higher complexity and combined weight
  const merged = {
    id: _genId('st'),
    name: mergedName || `${st1.name} + ${st2.name}`,
    complexity: COMPLEXITY_WEIGHTS[st1.complexity] >= COMPLEXITY_WEIGHTS[st2.complexity]
      ? st1.complexity : st2.complexity,
    weight: st1.weight + st2.weight,
    canParallelize: st1.canParallelize && st2.canParallelize,
    order: Math.min(st1.order, st2.order),
    mergedFrom: [subtask1Id, subtask2Id],
  };

  // Remove originals and insert merged
  dec.subtasks = dec.subtasks.filter(st => st.id !== subtask1Id && st.id !== subtask2Id);
  dec.subtasks.push(merged);
  dec.subtasks.sort((a, b) => a.order - b.order);

  // Recalculate
  dec.totalWeight = dec.subtasks.reduce((sum, st) => sum + st.weight, 0);
  dec.executionMode = _detectExecutionMode(dec.subtasks);
  dec.estimatedParallelism = _calculateParallelism(dec.subtasks, dec.executionMode);

  _saveDecompositions(slug, decs);
  return dec;
}

// ─── Stats ──────────────────────────────────────────────────────────────

/**
 * Get decomposition stats for a project.
 */
export function getDecompositionStats(slug) {
  const decs = _getDecompositions(slug);

  const complexityCounts = {};
  let totalSubtasks = 0;
  let totalWeight = 0;

  for (const d of decs) {
    complexityCounts[d.complexity.level] = (complexityCounts[d.complexity.level] || 0) + 1;
    totalSubtasks += d.subtasks.length;
    totalWeight += d.totalWeight;
  }

  return {
    totalDecompositions: decs.length,
    totalSubtasks,
    totalWeight,
    complexityCounts,
    avgSubtasksPerDecomposition: decs.length ? Math.round(totalSubtasks / decs.length) : 0,
  };
}

/**
 * Reset for testing.
 */
export function _reset() {
  // Stateless
}
