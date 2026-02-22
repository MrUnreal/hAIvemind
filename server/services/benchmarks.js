/**
 * Performance Benchmarks Service — Phase 8.8
 *
 * Analyzes session history to track duration/cost trends, detect regressions,
 * and compare model performance across sessions.
 */

/**
 * Compute benchmarks from a list of sessions.
 * @param {object[]} sessions - Array of session objects (from workspace.listSessions)
 * @returns {object} Benchmark data
 */
export function computeBenchmarks(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return {
      totalSessions: 0,
      trends: { duration: [], cost: [], taskCount: [] },
      averages: { duration: 0, cost: 0, taskCount: 0 },
      regressions: [],
      modelComparison: [],
      summary: { fastest: null, slowest: null, cheapest: null, costliest: null },
    };
  }

  // Sort by creation time ascending
  const sorted = [...sessions]
    .filter(s => s.status === 'completed' || s.status === 'failed')
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  // ── Trend data ──
  const trends = {
    duration: [],
    cost: [],
    taskCount: [],
  };

  for (const s of sorted) {
    const duration = (s.completedAt != null && s.createdAt != null)
      ? (s.completedAt - s.createdAt)
      : null;
    const cost = s.costSummary?.totalPremiumRequests || 0;
    const taskCount = Array.isArray(s.tasks) ? s.tasks.length : 0;

    trends.duration.push({
      sessionId: s.id,
      timestamp: s.createdAt,
      value: duration,
      status: s.status,
    });
    trends.cost.push({
      sessionId: s.id,
      timestamp: s.createdAt,
      value: cost,
    });
    trends.taskCount.push({
      sessionId: s.id,
      timestamp: s.createdAt,
      value: taskCount,
    });
  }

  // ── Averages ──
  const durations = trends.duration.filter(d => d.value !== null).map(d => d.value);
  const costs = trends.cost.map(c => c.value);
  const taskCounts = trends.taskCount.map(t => t.value);

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const averages = {
    duration: Math.round(avg(durations)),
    cost: Math.round(avg(costs) * 100) / 100,
    taskCount: Math.round(avg(taskCounts) * 10) / 10,
  };

  // ── Regression detection ──
  // A "regression" is when the last 3 sessions are >50% worse than the average of all prior ones
  const regressions = detectRegressions(trends);

  // ── Model comparison ──
  const modelComparison = compareModels(sorted);

  // ── Summary stats ──
  const withDuration = sorted.filter(s => s.completedAt != null && s.createdAt != null);
  const summary = {
    fastest: withDuration.length
      ? withDuration.reduce((a, b) => ((a.completedAt - a.createdAt) < (b.completedAt - b.createdAt) ? a : b)).id
      : null,
    slowest: withDuration.length
      ? withDuration.reduce((a, b) => ((a.completedAt - a.createdAt) > (b.completedAt - b.createdAt) ? a : b)).id
      : null,
    cheapest: costs.length
      ? sorted[costs.indexOf(Math.min(...costs))]?.id || null
      : null,
    costliest: costs.length
      ? sorted[costs.indexOf(Math.max(...costs))]?.id || null
      : null,
  };

  return {
    totalSessions: sorted.length,
    trends,
    averages,
    regressions,
    modelComparison,
    summary,
  };
}

/**
 * Detect performance regressions across trends.
 * Rules: If the last 3 data points average is >50% worse than prior average, flag it.
 * @param {object} trends
 * @returns {object[]} Array of regression alerts
 */
export function detectRegressions(trends) {
  const regressions = [];
  const WINDOW = 3;
  const THRESHOLD = 1.5; // 50% worse

  for (const [metric, data] of Object.entries(trends)) {
    const values = data.filter(d => d.value !== null).map(d => d.value);
    if (values.length < WINDOW + 2) continue; // Need enough data

    const recent = values.slice(-WINDOW);
    const prior = values.slice(0, -WINDOW);
    const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
    const avgPrior = prior.reduce((a, b) => a + b, 0) / prior.length;

    if (avgPrior > 0 && avgRecent > avgPrior * THRESHOLD) {
      regressions.push({
        metric,
        severity: avgRecent > avgPrior * 2 ? 'high' : 'medium',
        avgRecent: Math.round(avgRecent * 100) / 100,
        avgPrior: Math.round(avgPrior * 100) / 100,
        changePercent: Math.round(((avgRecent - avgPrior) / avgPrior) * 100),
        message: `${metric} increased ${Math.round(((avgRecent - avgPrior) / avgPrior) * 100)}% in recent sessions`,
      });
    }
  }

  return regressions;
}

/**
 * Compare model/tier performance across sessions.
 * @param {object[]} sessions
 * @returns {object[]} Model comparison data
 */
export function compareModels(sessions) {
  const modelStats = {};

  for (const s of sessions) {
    if (!s.costSummary?.tierBreakdown) continue;
    for (const [tier, count] of Object.entries(s.costSummary.tierBreakdown)) {
      if (!modelStats[tier]) {
        modelStats[tier] = {
          tier,
          sessions: 0,
          totalRequests: 0,
          successCount: 0,
          failureCount: 0,
          totalDuration: 0,
          durationSamples: 0,
        };
      }
      modelStats[tier].sessions++;
      modelStats[tier].totalRequests += count;
      if (s.status === 'completed') modelStats[tier].successCount++;
      if (s.status === 'failed') modelStats[tier].failureCount++;
      if (s.completedAt != null && s.createdAt != null) {
        modelStats[tier].totalDuration += (s.completedAt - s.createdAt);
        modelStats[tier].durationSamples++;
      }
    }
  }

  return Object.values(modelStats).map(m => ({
    tier: m.tier,
    sessions: m.sessions,
    totalRequests: m.totalRequests,
    avgRequestsPerSession: Math.round((m.totalRequests / m.sessions) * 10) / 10,
    successRate: m.sessions > 0
      ? Math.round((m.successCount / m.sessions) * 100)
      : 0,
    avgDuration: m.durationSamples > 0
      ? Math.round(m.totalDuration / m.durationSamples)
      : null,
  }));
}

/**
 * Format milliseconds into human-readable duration.
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (ms == null || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}
