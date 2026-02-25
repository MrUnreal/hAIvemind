/**
 * server/services/crossProjectLearning.js — Phase 20.3: Cross-Project Learning
 *
 * Inspired by CrewAI's Unified Memory: allows patterns, failure fixes,
 * and model routing insights learned in one project to inform work on
 * other projects. Uses a global vector memory index alongside per-project
 * indices for cross-pollination.
 *
 * Key insight: many patterns are universal (e.g., "Express route handlers
 * need error handling", "React components should have PropTypes"). These
 * shouldn't be locked to one project.
 */

import { storeVector, searchVectors, saveIndex } from './vectorMemory.js';
import { recallPatterns, categorizeTask } from './patternBank.js';

const GLOBAL_SLUG = '__global__';

/**
 * Promote a project-specific pattern to the global knowledge base.
 * Called when a pattern has proven itself (high similarity recall,
 * successful reuse, or explicit user promotion).
 *
 * @param {string} sourceSlug - Source project
 * @param {string} patternId - Pattern ID to promote
 * @param {string} text - Pattern text for embedding
 * @param {object} metadata - Pattern metadata
 * @returns {{ id: string, promoted: boolean }}
 */
export function promoteToGlobal(sourceSlug, patternId, text, metadata = {}) {
  const globalId = `global-${sourceSlug}-${patternId}`;

  // Check if already promoted
  const existing = searchVectors(GLOBAL_SLUG, text, 1, 0.95);
  if (existing.length > 0) {
    return { id: existing[0].id, promoted: false };
  }

  storeVector(GLOBAL_SLUG, globalId, text, {
    ...metadata,
    sourceProject: sourceSlug,
    promotedAt: Date.now(),
    crossProject: true,
  });

  saveIndex(GLOBAL_SLUG);
  return { id: globalId, promoted: true };
}

/**
 * Search for relevant patterns across ALL projects.
 * Returns merged results from the target project AND global patterns,
 * deduplicated by similarity.
 *
 * @param {string} slug - Target project (gets priority)
 * @param {string} query - Search query
 * @param {number} [limit=10]
 * @param {number} [minSimilarity=0.15]
 * @returns {Array<{ id: string, similarity: number, data: object, source: string }>}
 */
export function searchCrossProject(slug, query, limit = 10, minSimilarity = 0.15) {
  // Get project-specific results
  const projectResults = searchVectors(slug, query, limit, minSimilarity)
    .map(r => ({ ...r, source: slug }));

  // Get global results
  const globalResults = searchVectors(GLOBAL_SLUG, query, limit, minSimilarity)
    .map(r => ({ ...r, source: 'global' }));

  // Merge, dedup by similarity (if two results are > 0.9 similar, keep the higher one)
  const merged = [...projectResults];

  for (const gr of globalResults) {
    const isDuplicate = merged.some(pr => {
      // Simple text overlap check — if metadata texts are very similar, skip
      const prText = pr.data?.text || pr.id;
      const grText = gr.data?.text || gr.id;
      return stringSimilarity(prText, grText) > 0.8;
    });

    if (!isDuplicate) {
      merged.push(gr);
    }
  }

  // Sort by similarity, take top N
  return merged
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Auto-promote high-value patterns from a project.
 * Called after a session completes successfully.
 * Promotes patterns that are:
 *  - High success rate (> 80%)
 *  - Universal (not project-specific)
 *  - Failure→fix patterns (always useful)
 *
 * @param {string} slug
 * @returns {{ promoted: number, skipped: number }}
 */
export function autoPromotePatterns(slug) {
  let promoted = 0;
  let skipped = 0;

  // Get recent project patterns
  const recentPatterns = recallPatterns(slug, '', 50);

  for (const pattern of recentPatterns) {
    const d = pattern.data;

    // Skip project-specific patterns (paths, filenames, etc.)
    if (isProjectSpecific(d)) {
      skipped++;
      continue;
    }

    // Promote failure→fix patterns (universally useful)
    if (d.patternType === 'failure-fix' && d.error && d.fix) {
      const text = `Error: ${d.error} | Fix: ${d.fix} | Category: ${d.taskCategory || 'unknown'}`;
      const result = promoteToGlobal(slug, pattern.id, text, d);
      if (result.promoted) promoted++;
      else skipped++;
      continue;
    }

    // Promote high-success decomposition patterns
    if (d.patternType === 'decomposition' && d.successRate >= 0.8) {
      const text = `Prompt: ${d.prompt} | ${d.taskCount} tasks | ${Math.round(d.successRate * 100)}% success`;
      const result = promoteToGlobal(slug, pattern.id, text, d);
      if (result.promoted) promoted++;
      else skipped++;
      continue;
    }

    // Promote model success patterns
    if (d.patternType === 'model-success' && d.firstAttemptSuccess) {
      const text = `${d.taskCategory} tasks work well with ${d.model} (${d.tier})`;
      const result = promoteToGlobal(slug, pattern.id, text, d);
      if (result.promoted) promoted++;
      else skipped++;
    }
  }

  return { promoted, skipped };
}

/**
 * Get cross-project learning statistics.
 * @returns {{ globalPatterns: number, projectsContributing: Set<string> }}
 */
export function getCrossProjectStats() {
  const globalResults = searchVectors(GLOBAL_SLUG, '', 1000, 0);
  const contributingProjects = new Set();

  for (const r of globalResults) {
    if (r.data?.sourceProject) {
      contributingProjects.add(r.data.sourceProject);
    }
  }

  return {
    globalPatterns: globalResults.length,
    contributingProjects: [...contributingProjects],
  };
}

/**
 * Get cross-project context for a prompt.
 * Called during decomposition to inject global learnings.
 *
 * @param {string} slug - Current project
 * @param {string} prompt - User prompt
 * @returns {string} - Formatted context block
 */
export function getCrossProjectContext(slug, prompt) {
  const results = searchCrossProject(slug, prompt, 5, 0.2);
  const globalOnly = results.filter(r => r.source === 'global');

  if (globalOnly.length === 0) return '';

  const lines = ['## Learnings from Other Projects'];

  for (const r of globalOnly) {
    const d = r.data;
    if (d.patternType === 'failure-fix') {
      lines.push(`- Avoid: "${d.error}" → Use: ${d.fix}`);
    } else if (d.patternType === 'decomposition') {
      lines.push(`- Similar task decomposed into ${d.taskCount} tasks with ${Math.round((d.successRate || 0) * 100)}% success`);
    } else if (d.patternType === 'model-success') {
      lines.push(`- ${d.taskCategory} tasks: ${d.model} (${d.tier}) recommended`);
    }
  }

  return lines.length > 1 ? lines.join('\n') + '\n' : '';
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Check if a pattern is too project-specific to be useful globally.
 */
function isProjectSpecific(data) {
  if (!data) return true;

  const text = JSON.stringify(data).toLowerCase();

  // Patterns containing specific file paths are project-specific
  if (/\b(src\/|lib\/|app\/|pages\/|components\/|server\/|client\/)\w{3,}/.test(text)) {
    // But generic paths like "src/index.js" are fine
    if (/\b(src\/(index|main|app)\.\w+)\b/.test(text)) return false;
    return true;
  }

  return false;
}

/**
 * Simple string similarity (Jaccard over word tokens).
 */
function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  const tokensA = new Set(a.toLowerCase().split(/\W+/).filter(t => t.length > 2));
  const tokensB = new Set(b.toLowerCase().split(/\W+/).filter(t => t.length > 2));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  return intersection / (tokensA.size + tokensB.size - intersection);
}
