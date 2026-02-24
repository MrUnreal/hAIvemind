/**
 * server/services/analytics.js — Session Analytics Service
 *
 * Per-project session statistics: success rate, average duration,
 * cost trends, weekly digests, CSV export.
 */

import { refs } from '../state.js';

// ─── Stats Computation ──────────────────────────────────────────────

/**
 * Compute aggregate stats for a project's sessions.
 * @param {string} slug
 * @param {object} opts - { from?, to?, limit? }
 * @returns {object} { total, completed, failed, successRate, avgDuration, totalCost, sessions }
 */
export function getProjectStats(slug, opts = {}) {
  const sessions = refs.workspace?.listSessions?.(slug) || [];
  const { from, to } = opts;

  let filtered = sessions;
  if (from) filtered = filtered.filter(s => new Date(s.startedAt || s.createdAt) >= new Date(from));
  if (to) filtered = filtered.filter(s => new Date(s.startedAt || s.createdAt) <= new Date(to));

  const completed = filtered.filter(s => s.status === 'complete' || s.status === 'completed');
  const failed = filtered.filter(s => s.status === 'failed' || s.status === 'error');
  const durations = filtered
    .filter(s => (s.startedAt || s.createdAt) && s.completedAt)
    .map(s => new Date(s.completedAt) - new Date(s.startedAt || s.createdAt));

  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const totalCost = filtered.reduce((sum, s) => sum + (s.cost || s.premiumRequests || 0), 0);
  const successRate = filtered.length ? Math.round((completed.length / filtered.length) * 100) : 0;

  return {
    total: filtered.length,
    completed: completed.length,
    failed: failed.length,
    inProgress: filtered.filter(s => s.status === 'running' || s.status === 'in-progress').length,
    successRate,
    avgDurationMs: avgDuration,
    avgDurationHuman: humanDuration(avgDuration),
    totalCost,
    costPerSession: filtered.length ? Math.round((totalCost / filtered.length) * 100) / 100 : 0,
  };
}

/**
 * Get daily/weekly time-series data for session counts and costs.
 * @param {string} slug
 * @param {string} granularity - 'day' | 'week'
 * @param {number} periods - how many periods back
 * @returns {Array<{ period, sessions, completed, failed, cost }>}
 */
export function getTimeSeries(slug, granularity = 'day', periods = 14) {
  const sessions = refs.workspace?.listSessions?.(slug) || [];
  const now = Date.now();
  const msPerPeriod = granularity === 'week' ? 7 * 86400000 : 86400000;
  const buckets = [];

  for (let i = periods - 1; i >= 0; i--) {
    const start = now - (i + 1) * msPerPeriod;
    const end = now - i * msPerPeriod;
    const inBucket = sessions.filter(s => {
      const t = new Date(s.startedAt || s.createdAt).getTime();
      return t >= start && t < end;
    });

    buckets.push({
      period: new Date(start).toISOString().slice(0, granularity === 'week' ? 10 : 10),
      periodEnd: new Date(end).toISOString().slice(0, 10),
      sessions: inBucket.length,
      completed: inBucket.filter(s => s.status === 'complete' || s.status === 'completed').length,
      failed: inBucket.filter(s => s.status === 'failed' || s.status === 'error').length,
      cost: inBucket.reduce((sum, s) => sum + (s.cost || s.premiumRequests || 0), 0),
    });
  }

  return buckets;
}

/**
 * Get per-model usage breakdown.
 * @param {string} slug
 * @returns {Array<{ model, count, totalCost }>}
 */
export function getModelBreakdown(slug) {
  const sessions = refs.workspace?.listSessions?.(slug) || [];
  const models = {};

  for (const s of sessions) {
    // Try session-level model, then look at task-level tiers
    let model = s.model || s.backend;
    if (!model && s.tasks?.length) {
      // Aggregate models from tasks
      const taskModels = s.tasks.map(t => t.modelTier || t.model).filter(Boolean);
      model = taskModels[0] || null;
    }
    if (!model && s.costSummary?.tierBreakdown) {
      // Use tier breakdown keys
      const tiers = Object.keys(s.costSummary.tierBreakdown);
      model = tiers[0] || null;
    }
    model = model || 'default';
    if (!models[model]) models[model] = { model, count: 0, totalCost: 0 };
    models[model].count++;
    models[model].totalCost += s.cost || s.premiumRequests || 0;
  }

  return Object.values(models).sort((a, b) => b.count - a.count);
}

/**
 * Generate a weekly digest summary for the past week.
 * @param {string} slug
 * @returns {object}
 */
export function getWeeklyDigest(slug) {
  const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const stats = getProjectStats(slug, { from: oneWeekAgo });
  const prevWeekStart = new Date(Date.now() - 14 * 86400000).toISOString();
  const prevStats = getProjectStats(slug, { from: prevWeekStart, to: oneWeekAgo });

  return {
    period: 'last_7_days',
    current: stats,
    previous: prevStats,
    trends: {
      sessionsDelta: stats.total - prevStats.total,
      successRateDelta: stats.successRate - prevStats.successRate,
      costDelta: stats.totalCost - prevStats.totalCost,
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Export sessions as CSV string.
 * @param {string} slug
 * @param {object} opts - { from?, to? }
 * @returns {string} CSV text
 */
export function exportSessionsCsv(slug, opts = {}) {
  const sessions = refs.workspace?.listSessions?.(slug) || [];
  const { from, to } = opts;

  let filtered = sessions;
  if (from) filtered = filtered.filter(s => new Date(s.startedAt || s.createdAt) >= new Date(from));
  if (to) filtered = filtered.filter(s => new Date(s.startedAt || s.createdAt) <= new Date(to));

  const headers = ['id', 'status', 'prompt', 'model', 'startedAt', 'completedAt', 'durationMs', 'cost', 'tasks'];
  const rows = filtered.map(s => {
    const dur = (s.startedAt || s.createdAt) && s.completedAt
      ? new Date(s.completedAt) - new Date(s.startedAt || s.createdAt)
      : '';
    return [
      s.id || '',
      s.status || '',
      csvEscape(s.prompt || ''),
      s.model || s.backend || '',
      s.startedAt || s.createdAt || '',
      s.completedAt || '',
      dur,
      s.cost || s.premiumRequests || 0,
      s.tasks?.length || 0,
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Get top-N longest/costliest sessions.
 * @param {string} slug
 * @param {string} sortBy - 'duration' | 'cost'
 * @param {number} limit
 * @returns {Array}
 */
export function getTopSessions(slug, sortBy = 'duration', limit = 10) {
  const sessions = refs.workspace?.listSessions?.(slug) || [];

  const withMeta = sessions.map(s => ({
    id: s.id,
    status: s.status,
    prompt: (s.prompt || '').slice(0, 100),
    model: s.model || s.backend,
    startedAt: s.startedAt || s.createdAt,
    durationMs: (s.startedAt || s.createdAt) && s.completedAt
      ? new Date(s.completedAt) - new Date(s.startedAt || s.createdAt)
      : 0,
    cost: s.cost || s.premiumRequests || 0,
  }));

  if (sortBy === 'cost') {
    withMeta.sort((a, b) => b.cost - a.cost);
  } else {
    withMeta.sort((a, b) => b.durationMs - a.durationMs);
  }

  return withMeta.slice(0, limit);
}

// ─── Helpers ─────────────────────────────────────────────────────────
function humanDuration(ms) {
  if (!ms) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function csvEscape(str) {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
