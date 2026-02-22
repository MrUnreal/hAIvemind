/**
 * server/services/promptSuggestions.js — Smart Prompt Suggestions
 *
 * Context-aware prompt autocomplete based on project state,
 * recent sessions, agent memory, and common patterns.
 */

import { refs } from '../state.js';

// ─── Built-in Suggestion Templates ──────────────────────────────────
const BUILTIN_SUGGESTIONS = [
  { text: 'Fix all lint errors and warnings', category: 'fix', tags: ['lint', 'cleanup'] },
  { text: 'Add unit tests for untested modules', category: 'test', tags: ['testing'] },
  { text: 'Refactor to reduce code duplication', category: 'refactor', tags: ['cleanup', 'DRY'] },
  { text: 'Update dependencies to latest versions', category: 'maintenance', tags: ['deps'] },
  { text: 'Add error handling and input validation', category: 'fix', tags: ['robustness'] },
  { text: 'Improve TypeScript types and interfaces', category: 'refactor', tags: ['types'] },
  { text: 'Add API documentation with JSDoc comments', category: 'docs', tags: ['documentation'] },
  { text: 'Optimize database queries for performance', category: 'performance', tags: ['db', 'optimization'] },
  { text: 'Add logging and monitoring instrumentation', category: 'observability', tags: ['logging'] },
  { text: 'Implement caching layer for frequent queries', category: 'performance', tags: ['cache'] },
  { text: 'Add CI/CD pipeline configuration', category: 'devops', tags: ['ci', 'automation'] },
  { text: 'Create README with setup instructions', category: 'docs', tags: ['documentation'] },
  { text: 'Add environment variable validation on startup', category: 'fix', tags: ['config', 'validation'] },
  { text: 'Implement rate limiting for API endpoints', category: 'security', tags: ['api'] },
  { text: 'Add integration tests for critical workflows', category: 'test', tags: ['testing', 'e2e'] },
];

// ─── Suggestion Categories ──────────────────────────────────────────
export const CATEGORIES = [
  'fix', 'feature', 'refactor', 'test', 'docs',
  'performance', 'security', 'devops', 'maintenance', 'observability',
];

// ─── Core Functions ─────────────────────────────────────────────────

/**
 * Get prompt suggestions for a project.
 * Combines built-in templates, recent session history, and agent memory
 * to produce context-aware suggestions.
 *
 * @param {string} slug — project slug
 * @param {object} opts — { query?, category?, limit? }
 * @returns {{ suggestions: Array, sources: object }}
 */
export function getSuggestions(slug, opts = {}) {
  const limit = opts.limit || 10;
  const query = (opts.query || '').toLowerCase();
  const category = opts.category || '';

  const all = [];

  // 1. Built-in suggestions
  for (const s of BUILTIN_SUGGESTIONS) {
    all.push({ ...s, source: 'builtin', score: 1 });
  }

  // 2. Session-history derived suggestions
  const sessionSuggestions = deriveFromSessions(slug);
  all.push(...sessionSuggestions);

  // 3. Agent-memory derived suggestions
  const memorySuggestions = deriveFromMemory(slug);
  all.push(...memorySuggestions);

  // 4. Filter by category
  let filtered = category
    ? all.filter(s => s.category === category)
    : all;

  // 5. Filter by query (fuzzy match on text + tags)
  if (query) {
    filtered = filtered.filter(s => {
      const haystack = `${s.text} ${(s.tags || []).join(' ')} ${s.category}`.toLowerCase();
      return query.split(/\s+/).every(term => haystack.includes(term));
    });
    // Boost exact matches
    for (const s of filtered) {
      if (s.text.toLowerCase().includes(query)) s.score += 5;
      if ((s.tags || []).some(t => t.includes(query))) s.score += 3;
    }
  }

  // 6. Score & sort
  filtered.sort((a, b) => b.score - a.score);

  // 7. Deduplicate by normalized text
  const seen = new Set();
  const deduped = [];
  for (const s of filtered) {
    const key = s.text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(s);
    }
  }

  const suggestions = deduped.slice(0, limit).map(({ score, ...rest }) => rest);

  return {
    suggestions,
    sources: {
      builtin: suggestions.filter(s => s.source === 'builtin').length,
      sessions: suggestions.filter(s => s.source === 'session').length,
      memory: suggestions.filter(s => s.source === 'memory').length,
    },
  };
}

/**
 * Get available suggestion categories.
 */
export function getCategories() {
  return CATEGORIES;
}

/**
 * Get prompt history — recent prompts used in the project.
 * @param {string} slug
 * @param {number} limit
 * @returns {Array<{text: string, timestamp: string, sessionId: string}>}
 */
export function getPromptHistory(slug, limit = 20) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const history = settings.promptHistory || [];
  return history.slice(0, limit);
}

/**
 * Record a prompt in history.
 * @param {string} slug
 * @param {string} text
 * @param {string} sessionId
 */
export function recordPrompt(slug, text, sessionId = '') {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const history = settings.promptHistory || [];

  history.unshift({
    text: text.slice(0, 500), // cap length
    timestamp: new Date().toISOString(),
    sessionId,
  });

  // Cap at 100 entries
  if (history.length > 100) history.length = 100;

  refs.workspace?.updateProjectSettings?.(slug, { promptHistory: history });
  return history[0];
}

/**
 * Clear prompt history for a project.
 */
export function clearHistory(slug) {
  refs.workspace?.updateProjectSettings?.(slug, { promptHistory: [] });
  return true;
}

// ─── Internal Helpers ────────────────────────────────────────────────

/**
 * Derive suggestions from recent session history.
 */
function deriveFromSessions(slug) {
  const suggestions = [];
  try {
    const sessions = refs.workspace?.listSessions?.(slug) || [];
    const recent = sessions.slice(0, 10);

    // Find failed sessions → suggest retry
    const failed = recent.filter(s => s.status === 'failed' || s.status === 'error');
    for (const s of failed.slice(0, 3)) {
      const prompt = s.prompt || s.task || '';
      if (prompt) {
        suggestions.push({
          text: `Retry: ${prompt.slice(0, 200)}`,
          category: 'fix',
          tags: ['retry', 'failed'],
          source: 'session',
          score: 8,
          sessionId: s.id,
        });
      }
    }

    // Find patterns in recent prompts
    const prompts = recent.map(s => s.prompt || s.task || '').filter(Boolean);
    if (prompts.length >= 3) {
      // Detect common prefixes/keywords
      const words = {};
      for (const p of prompts) {
        for (const w of p.toLowerCase().split(/\s+/)) {
          if (w.length > 3) words[w] = (words[w] || 0) + 1;
        }
      }
      const frequent = Object.entries(words)
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      if (frequent.length) {
        suggestions.push({
          text: `Continue work on: ${frequent.map(([w]) => w).join(', ')}`,
          category: 'feature',
          tags: frequent.map(([w]) => w),
          source: 'session',
          score: 6,
        });
      }
    }
  } catch { /* workspace not ready */ }

  return suggestions;
}

/**
 * Derive suggestions from agent memory.
 */
function deriveFromMemory(slug) {
  const suggestions = [];
  try {
    const settings = refs.workspace?.getProjectSettings?.(slug) || {};
    const memories = settings.agentMemory || [];

    // Error memories → suggest fixing
    const errors = memories.filter(m => m.type === 'error').slice(0, 3);
    for (const m of errors) {
      suggestions.push({
        text: `Fix known issue: ${(m.key || m.content || '').slice(0, 150)}`,
        category: 'fix',
        tags: ['error', ...(m.tags || [])],
        source: 'memory',
        score: 7,
      });
    }

    // Convention memories → suggest enforcement
    const conventions = memories.filter(m => m.type === 'convention').slice(0, 2);
    for (const c of conventions) {
      suggestions.push({
        text: `Enforce convention: ${(c.key || c.content || '').slice(0, 150)}`,
        category: 'refactor',
        tags: ['convention', ...(c.tags || [])],
        source: 'memory',
        score: 4,
      });
    }
  } catch { /* memory not ready */ }

  return suggestions;
}
