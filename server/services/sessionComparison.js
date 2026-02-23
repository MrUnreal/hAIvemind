/**
 * Session Comparison Service — Phase 12.4
 *
 * Side-by-side session diff, outcome comparison, strategy effectiveness scoring,
 * and A/B-style analysis between sessions within a project.
 */

// ─── Constants ──────────────────────────────────────────────────────────

export const COMPARISON_OUTCOMES = ['a-better', 'b-better', 'tie', 'inconclusive'];
export const DIFF_CATEGORIES = ['tasks', 'duration', 'cost', 'messages', 'errors'];

// ─── Workspace ref (from shared state) ──────────────────────────────────

import { refs } from '../state.js';

// ─── Helpers ────────────────────────────────────────────────────────────

function _genId(prefix = 'cmp') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function _getComparisons(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  return settings.sessionComparisons || [];
}

function _saveComparisons(slug, comps) {
  if (comps.length > 200) comps.splice(0, comps.length - 200);
  refs.workspace?.updateProjectSettings?.(slug, { sessionComparisons: comps });
}

function _getSession(slug, sessionId) {
  const sessions = refs.workspace?.listSessions?.(slug) || [];
  return sessions.find(s => s.id === sessionId) || null;
}

// ─── Session Diff ───────────────────────────────────────────────────────

/**
 * Compute a structured diff between two sessions.
 * @param {object} sessionA
 * @param {object} sessionB
 * @returns {{ categories: object, summary: string }}
 */
function _computeDiff(sessionA, sessionB) {
  const categories = {};

  // Duration diff
  const durA = sessionA.duration || sessionA.durationMs || 0;
  const durB = sessionB.duration || sessionB.durationMs || 0;
  categories.duration = {
    a: durA,
    b: durB,
    delta: durB - durA,
    winner: durA < durB ? 'a' : durB < durA ? 'b' : 'tie',
  };

  // Task counts
  const tasksA = sessionA.taskCount || (sessionA.tasks || []).length || 0;
  const tasksB = sessionB.taskCount || (sessionB.tasks || []).length || 0;
  categories.tasks = {
    a: tasksA,
    b: tasksB,
    delta: tasksB - tasksA,
    winner: tasksA > tasksB ? 'a' : tasksB > tasksA ? 'b' : 'tie',
  };

  // Message counts
  const msgsA = sessionA.messageCount || (sessionA.messages || []).length || 0;
  const msgsB = sessionB.messageCount || (sessionB.messages || []).length || 0;
  categories.messages = {
    a: msgsA,
    b: msgsB,
    delta: msgsB - msgsA,
    winner: 'tie', // fewer messages isn't necessarily better
  };

  // Cost
  const costA = sessionA.cost || 0;
  const costB = sessionB.cost || 0;
  categories.cost = {
    a: costA,
    b: costB,
    delta: costB - costA,
    winner: costA < costB ? 'a' : costB < costA ? 'b' : 'tie',
  };

  // Error counts
  const errA = sessionA.errorCount || (sessionA.errors || []).length || 0;
  const errB = sessionB.errorCount || (sessionB.errors || []).length || 0;
  categories.errors = {
    a: errA,
    b: errB,
    delta: errB - errA,
    winner: errA < errB ? 'a' : errB < errA ? 'b' : 'tie',
  };

  const aWins = Object.values(categories).filter(c => c.winner === 'a').length;
  const bWins = Object.values(categories).filter(c => c.winner === 'b').length;
  const overall = aWins > bWins ? 'a-better' : bWins > aWins ? 'b-better' : 'tie';
  const summary = `A wins ${aWins} categories, B wins ${bWins} categories → ${overall}`;

  return { categories, overall, summary };
}

// ─── Effectiveness Score ────────────────────────────────────────────────

/**
 * Score a session's effectiveness on 0–100 scale.
 * Heuristic: more tasks + lower cost + fewer errors = better.
 */
function _scoreSession(session) {
  const tasks = session.taskCount || (session.tasks || []).length || 0;
  const errors = session.errorCount || (session.errors || []).length || 0;
  const cost = session.cost || 0;
  const duration = session.duration || session.durationMs || 0;

  let score = 50; // baseline
  score += Math.min(tasks * 5, 25); // up to +25 for tasks
  score -= Math.min(errors * 10, 30); // penalty for errors
  score -= Math.min(cost * 2, 15); // penalty for cost
  if (duration > 0 && duration < 60000) score += 5; // fast bonus
  if (duration > 300000) score -= 5; // slow penalty

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Compare two sessions and store the comparison.
 * Sessions can be specified by ID (looks up from disk) or inline data objects.
 */
export function compareSessions(slug, data = {}) {
  const { sessionIdA, sessionIdB, sessionA: inlineA, sessionB: inlineB, label, notes } = data;

  const sessionA = inlineA || (sessionIdA ? _getSession(slug, sessionIdA) : null);
  const sessionB = inlineB || (sessionIdB ? _getSession(slug, sessionIdB) : null);
  if (!sessionA) throw new Error(`Session A not found: ${sessionIdA || 'inline missing'}`);
  if (!sessionB) throw new Error(`Session B not found: ${sessionIdB || 'inline missing'}`);

  const idA = sessionIdA || inlineA?.id || 'inline-a';
  const idB = sessionIdB || inlineB?.id || 'inline-b';

  const diff = _computeDiff(sessionA, sessionB);
  const scoreA = _scoreSession(sessionA);
  const scoreB = _scoreSession(sessionB);

  const comparison = {
    id: _genId(),
    sessionIdA: idA,
    sessionIdB: idB,
    diff,
    scoreA,
    scoreB,
    outcome: diff.overall,
    label: label || null,
    notes: notes || null,
    createdAt: Date.now(),
  };

  const comps = _getComparisons(slug);
  comps.push(comparison);
  _saveComparisons(slug, comps);

  return comparison;
}

/**
 * Quick diff without storing — read-only comparison.
 */
export function quickDiff(slug, data = {}) {
  const { sessionIdA, sessionIdB, sessionA: inlineA, sessionB: inlineB } = data;

  const sessionA = inlineA || (sessionIdA ? _getSession(slug, sessionIdA) : null);
  const sessionB = inlineB || (sessionIdB ? _getSession(slug, sessionIdB) : null);
  if (!sessionA) throw new Error(`Session A not found: ${sessionIdA || 'inline missing'}`);
  if (!sessionB) throw new Error(`Session B not found: ${sessionIdB || 'inline missing'}`);

  return {
    diff: _computeDiff(sessionA, sessionB),
    scoreA: _scoreSession(sessionA),
    scoreB: _scoreSession(sessionB),
  };
}

/**
 * List saved comparisons for a project.
 */
export function listComparisons(slug) {
  return _getComparisons(slug);
}

/**
 * Get a single comparison by ID.
 */
export function getComparison(slug, compId) {
  return _getComparisons(slug).find(c => c.id === compId) || null;
}

/**
 * Delete a saved comparison.
 */
export function deleteComparison(slug, compId) {
  const comps = _getComparisons(slug);
  const idx = comps.findIndex(c => c.id === compId);
  if (idx === -1) return null;
  const removed = comps.splice(idx, 1)[0];
  _saveComparisons(slug, comps);
  return removed;
}

/**
 * Score a single session's effectiveness.
 */
export function scoreSession(slug, sessionId) {
  const session = _getSession(slug, sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  return { sessionId, score: _scoreSession(session), session };
}

/**
 * Get aggregate comparison stats for a project.
 */
export function getComparisonStats(slug) {
  const comps = _getComparisons(slug);
  const outcomes = {};
  for (const c of comps) {
    outcomes[c.outcome] = (outcomes[c.outcome] || 0) + 1;
  }
  const avgScoreA = comps.length ? Math.round(comps.reduce((s, c) => s + c.scoreA, 0) / comps.length) : 0;
  const avgScoreB = comps.length ? Math.round(comps.reduce((s, c) => s + c.scoreB, 0) / comps.length) : 0;

  return {
    total: comps.length,
    outcomes,
    avgScoreA,
    avgScoreB,
  };
}
