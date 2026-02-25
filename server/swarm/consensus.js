/**
 * server/swarm/consensus.js — Phase 16.1: Consensus Protocol
 *
 * When multiple agents work on overlapping concerns, consensus
 * ensures they agree on interfaces, shared types, and contracts.
 *
 * Strategies:
 * - majority-vote: accept the output that most agents agree on
 * - quality-ranked: pick the highest-quality output (by model tier)
 * - merge: combine non-conflicting outputs
 */

/**
 * @typedef {Object} AgentOutput
 * @property {string} agentId
 * @property {string} taskId
 * @property {string} output — raw text output
 * @property {string} model
 * @property {string} tier — T0-T3
 * @property {number} multiplier
 * @property {'success'|'failed'} status
 */

/**
 * @typedef {Object} ConsensusResult
 * @property {string} strategy — strategy used
 * @property {string} winnerId — agent ID whose output was selected
 * @property {string} output — winning output
 * @property {number} confidence — 0-1 confidence score
 * @property {Array<{ agentId: string, score: number }>} scores
 */

const TIER_QUALITY = { T0: 1, T1: 2, T2: 3, T3: 4 };

/**
 * Run consensus across multiple agent outputs.
 *
 * @param {AgentOutput[]} outputs — competing agent outputs
 * @param {string} [strategy='quality-ranked'] — consensus strategy
 * @returns {ConsensusResult}
 */
export function resolveConsensus(outputs, strategy = 'quality-ranked') {
  if (!outputs || outputs.length === 0) {
    return { strategy, winnerId: null, output: '', confidence: 0, scores: [] };
  }

  // Filter to successful outputs
  const successful = outputs.filter(o => o.status === 'success');
  if (successful.length === 0) {
    // All failed — pick highest tier failure for the best error info
    const sorted = [...outputs].sort((a, b) => (TIER_QUALITY[b.tier] || 0) - (TIER_QUALITY[a.tier] || 0));
    return {
      strategy,
      winnerId: sorted[0].agentId,
      output: sorted[0].output,
      confidence: 0,
      scores: sorted.map(o => ({ agentId: o.agentId, score: 0 })),
    };
  }

  if (successful.length === 1) {
    return {
      strategy,
      winnerId: successful[0].agentId,
      output: successful[0].output,
      confidence: 1,
      scores: [{ agentId: successful[0].agentId, score: 1 }],
    };
  }

  switch (strategy) {
    case 'majority-vote': return _majorityVote(successful);
    case 'quality-ranked': return _qualityRanked(successful);
    case 'merge': return _mergeOutputs(successful);
    default: return _qualityRanked(successful);
  }
}

/**
 * Majority vote: find the output that most agents agree on.
 * Uses simple text similarity (Jaccard over words).
 */
function _majorityVote(outputs) {
  const similarities = outputs.map((a, i) => {
    let totalSim = 0;
    for (let j = 0; j < outputs.length; j++) {
      if (i === j) continue;
      totalSim += _jaccardSimilarity(a.output, outputs[j].output);
    }
    return { agentId: a.agentId, output: a.output, score: totalSim / (outputs.length - 1) };
  });

  similarities.sort((a, b) => b.score - a.score);

  return {
    strategy: 'majority-vote',
    winnerId: similarities[0].agentId,
    output: similarities[0].output,
    confidence: similarities[0].score,
    scores: similarities.map(s => ({ agentId: s.agentId, score: s.score })),
  };
}

/**
 * Quality-ranked: prefer higher-tier model output.
 * Tiebreaker: output length (longer = more thorough).
 */
function _qualityRanked(outputs) {
  const scored = outputs.map(o => ({
    agentId: o.agentId,
    output: o.output,
    score: (TIER_QUALITY[o.tier] || 1) * 10 + Math.min(o.output.length / 1000, 5),
  }));

  scored.sort((a, b) => b.score - a.score);
  const maxScore = scored[0].score;

  return {
    strategy: 'quality-ranked',
    winnerId: scored[0].agentId,
    output: scored[0].output,
    confidence: scored.length > 1 ? scored[0].score / (scored[0].score + scored[1].score) : 1,
    scores: scored.map(s => ({ agentId: s.agentId, score: s.score / maxScore })),
  };
}

/**
 * Merge: combine non-conflicting outputs.
 * Simple approach — take the longest output that contains content from others.
 */
function _mergeOutputs(outputs) {
  // Sort by length descending
  const sorted = [...outputs].sort((a, b) => b.output.length - a.output.length);

  // The longest output is likely the most comprehensive
  const base = sorted[0];

  // Check how much of each other output is covered by the base
  const coverage = sorted.map(o => {
    const words = new Set(o.output.toLowerCase().split(/\s+/));
    const baseWords = new Set(base.output.toLowerCase().split(/\s+/));
    let covered = 0;
    for (const w of words) if (baseWords.has(w)) covered++;
    return { agentId: o.agentId, coverage: words.size > 0 ? covered / words.size : 0 };
  });

  return {
    strategy: 'merge',
    winnerId: base.agentId,
    output: base.output,
    confidence: coverage.reduce((sum, c) => sum + c.coverage, 0) / coverage.length,
    scores: coverage.map(c => ({ agentId: c.agentId, score: c.coverage })),
  };
}

/**
 * Jaccard similarity between two text strings (word-level).
 */
function _jaccardSimilarity(textA, textB) {
  const setA = new Set(textA.toLowerCase().split(/\s+/));
  const setB = new Set(textB.toLowerCase().split(/\s+/));
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * List available consensus strategies.
 * @returns {string[]}
 */
export function listStrategies() {
  return ['majority-vote', 'quality-ranked', 'merge'];
}
