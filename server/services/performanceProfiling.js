/**
 * server/services/performanceProfiling.js — Performance Profiling
 *
 * Per-task/session timing stats, bottleneck detection, historical
 * performance trends, P50/P95/P99 latency tracking.
 *
 * Data stored in project settings under `performanceProfiles`.
 */

import { refs } from '../state.js';

// ─── Constants ──────────────────────────────────────────────────────────

export const METRIC_TYPES = ['task', 'session', 'api', 'agent', 'custom'];
const MAX_ENTRIES = 2000;

// ─── Helpers ────────────────────────────────────────────────────────────

function _genId(prefix = 'perf') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function _getProfiles(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  return settings.performanceProfiles || [];
}

function _saveProfiles(slug, profiles) {
  if (profiles.length > MAX_ENTRIES) {
    profiles.splice(0, profiles.length - MAX_ENTRIES);
  }
  refs.workspace?.updateProjectSettings?.(slug, { performanceProfiles: profiles });
}

// ─── Record Performance Data ────────────────────────────────────────────

/**
 * Record a performance measurement.
 * @param {string} slug
 * @param {object} data
 * @param {string} data.name - Operation name
 * @param {string} [data.type='custom'] - Metric type
 * @param {number} data.durationMs - Duration in milliseconds
 * @param {object} [data.metadata] - Extra context
 * @param {string} [data.taskId] - Associated task
 * @param {string} [data.sessionId] - Associated session
 * @param {boolean} [data.success=true] - Whether the operation succeeded
 * @returns {object}
 */
export function recordMetric(slug, data) {
  if (!data.name) throw new Error('Metric name is required');
  if (data.durationMs === undefined || data.durationMs === null) {
    throw new Error('durationMs is required');
  }

  const profiles = _getProfiles(slug);
  const type = METRIC_TYPES.includes(data.type) ? data.type : 'custom';

  const entry = {
    id: _genId(),
    name: data.name,
    type,
    durationMs: Number(data.durationMs),
    success: data.success !== false,
    taskId: data.taskId || null,
    sessionId: data.sessionId || null,
    metadata: data.metadata || {},
    timestamp: Date.now(),
  };

  profiles.push(entry);
  _saveProfiles(slug, profiles);
  return entry;
}

/**
 * List performance metrics with optional filtering.
 * @param {string} slug
 * @param {object} [opts]
 * @param {string} [opts.name] - Filter by operation name
 * @param {string} [opts.type] - Filter by metric type
 * @param {number} [opts.since] - Only after timestamp
 * @param {number} [opts.until] - Only before timestamp
 * @param {number} [opts.limit=100] - Max entries
 * @returns {Array}
 */
export function listMetrics(slug, opts = {}) {
  let profiles = _getProfiles(slug);

  if (opts.name) profiles = profiles.filter(p => p.name === opts.name);
  if (opts.type) profiles = profiles.filter(p => p.type === opts.type);
  if (opts.since) profiles = profiles.filter(p => p.timestamp >= opts.since);
  if (opts.until) profiles = profiles.filter(p => p.timestamp <= opts.until);

  const limit = opts.limit || 100;
  return profiles.slice(-limit);
}

/**
 * Get a single metric by ID.
 */
export function getMetric(slug, metricId) {
  const profiles = _getProfiles(slug);
  return profiles.find(p => p.id === metricId) || null;
}

// ─── Percentile Calculations ────────────────────────────────────────────

/**
 * Calculate percentile from sorted array.
 * @param {number[]} sorted - Sorted array of values
 * @param {number} p - Percentile (0-100)
 * @returns {number}
 */
function _percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Get latency percentiles for a given operation.
 * @param {string} slug
 * @param {string} name - Operation name
 * @param {object} [opts]
 * @param {number} [opts.since] - Only after timestamp
 * @returns {{ p50: number, p75: number, p90: number, p95: number, p99: number, min: number, max: number, avg: number, count: number }}
 */
export function getPercentiles(slug, name, opts = {}) {
  let profiles = _getProfiles(slug).filter(p => p.name === name);
  if (opts.since) profiles = profiles.filter(p => p.timestamp >= opts.since);

  const durations = profiles.map(p => p.durationMs).sort((a, b) => a - b);

  if (durations.length === 0) {
    return { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0, count: 0 };
  }

  const sum = durations.reduce((a, b) => a + b, 0);

  return {
    p50: _percentile(durations, 50),
    p75: _percentile(durations, 75),
    p90: _percentile(durations, 90),
    p95: _percentile(durations, 95),
    p99: _percentile(durations, 99),
    min: durations[0],
    max: durations[durations.length - 1],
    avg: Math.round(sum / durations.length),
    count: durations.length,
  };
}

// ─── Bottleneck Detection ───────────────────────────────────────────────

/**
 * Detect bottlenecks — operations with P95 above threshold.
 * @param {string} slug
 * @param {object} [opts]
 * @param {number} [opts.thresholdMs=5000] - P95 threshold
 * @param {number} [opts.minSamples=3] - Minimum samples to consider
 * @returns {Array<{ name: string, p95: number, avg: number, count: number }>}
 */
export function detectBottlenecks(slug, opts = {}) {
  const threshold = opts.thresholdMs || 5000;
  const minSamples = opts.minSamples || 3;

  const profiles = _getProfiles(slug);

  // Group by operation name
  const groups = {};
  for (const p of profiles) {
    if (!groups[p.name]) groups[p.name] = [];
    groups[p.name].push(p.durationMs);
  }

  const bottlenecks = [];
  for (const [name, durations] of Object.entries(groups)) {
    if (durations.length < minSamples) continue;
    durations.sort((a, b) => a - b);
    const p95 = _percentile(durations, 95);
    if (p95 >= threshold) {
      const sum = durations.reduce((a, b) => a + b, 0);
      bottlenecks.push({
        name,
        p95,
        avg: Math.round(sum / durations.length),
        count: durations.length,
        max: durations[durations.length - 1],
      });
    }
  }

  bottlenecks.sort((a, b) => b.p95 - a.p95);
  return bottlenecks;
}

// ─── Trends ─────────────────────────────────────────────────────────────

/**
 * Get performance trend for an operation over time.
 * Groups metrics into time buckets and returns avg/p95 per bucket.
 * @param {string} slug
 * @param {string} name - Operation name
 * @param {object} [opts]
 * @param {number} [opts.bucketMs=3600000] - Bucket size (default: 1 hour)
 * @param {number} [opts.since] - Only after timestamp
 * @returns {Array<{ bucketStart: number, avg: number, p95: number, count: number }>}
 */
export function getTrend(slug, name, opts = {}) {
  const bucketMs = opts.bucketMs || 3600000;
  let profiles = _getProfiles(slug).filter(p => p.name === name);
  if (opts.since) profiles = profiles.filter(p => p.timestamp >= opts.since);

  if (profiles.length === 0) return [];

  // Group into buckets
  const buckets = {};
  for (const p of profiles) {
    const bucketStart = Math.floor(p.timestamp / bucketMs) * bucketMs;
    if (!buckets[bucketStart]) buckets[bucketStart] = [];
    buckets[bucketStart].push(p.durationMs);
  }

  const trend = [];
  for (const [start, durations] of Object.entries(buckets)) {
    durations.sort((a, b) => a - b);
    const sum = durations.reduce((a, b) => a + b, 0);
    trend.push({
      bucketStart: Number(start),
      avg: Math.round(sum / durations.length),
      p95: _percentile(durations, 95),
      count: durations.length,
    });
  }

  trend.sort((a, b) => a.bucketStart - b.bucketStart);
  return trend;
}

// ─── Summary Stats ──────────────────────────────────────────────────────

/**
 * Get overall performance summary.
 */
export function getPerformanceSummary(slug) {
  const profiles = _getProfiles(slug);

  const typeCounts = {};
  const opCounts = {};
  let totalDuration = 0;
  let successCount = 0;

  for (const p of profiles) {
    typeCounts[p.type] = (typeCounts[p.type] || 0) + 1;
    opCounts[p.name] = (opCounts[p.name] || 0) + 1;
    totalDuration += p.durationMs;
    if (p.success) successCount++;
  }

  // Top 5 slowest operations (by avg)
  const opAvgs = {};
  for (const p of profiles) {
    if (!opAvgs[p.name]) opAvgs[p.name] = { total: 0, count: 0 };
    opAvgs[p.name].total += p.durationMs;
    opAvgs[p.name].count++;
  }
  const slowest = Object.entries(opAvgs)
    .map(([name, { total, count }]) => ({ name, avg: Math.round(total / count), count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);

  return {
    totalMetrics: profiles.length,
    totalDurationMs: totalDuration,
    successRate: profiles.length ? Math.round((successCount / profiles.length) * 100) : 0,
    typeCounts,
    uniqueOperations: Object.keys(opCounts).length,
    slowestOperations: slowest,
  };
}

/**
 * Clear all performance data.
 */
export function clearMetrics(slug) {
  _saveProfiles(slug, []);
}

/**
 * Reset for testing.
 */
export function _reset() {
  // Stateless
}
