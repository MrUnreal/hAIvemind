/**
 * server/services/healthDashboard.js — Health Dashboard
 *
 * Production health monitoring: uptime, error rates, latency percentiles,
 * backend availability tracking, alert thresholds, and system health scoring.
 */

import { refs } from '../state.js';

// ─── State ──────────────────────────────────────────────────────────
const startTime = Date.now();
const latencies = [];           // { ts, ms, endpoint }
const errors = [];              // { ts, message, endpoint }
const backendChecks = new Map(); // backend → { status, lastCheck, uptime, failures }
const MAX_LATENCIES = 500;
const MAX_ERRORS = 200;

// ─── Uptime ─────────────────────────────────────────────────────────

/**
 * Get server uptime in various formats.
 */
export function getUptime() {
  const uptimeMs = Date.now() - startTime;
  const seconds = Math.floor(uptimeMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  return {
    ms: uptimeMs,
    seconds,
    minutes,
    hours,
    days,
    startedAt: new Date(startTime).toISOString(),
    formatted: `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`,
  };
}

// ─── Latency Tracking ───────────────────────────────────────────────

/**
 * Record a request latency.
 * @param {string} endpoint
 * @param {number} ms - latency in milliseconds
 */
export function recordLatency(endpoint, ms) {
  latencies.push({ ts: Date.now(), ms, endpoint });
  if (latencies.length > MAX_LATENCIES) latencies.shift();
}

/**
 * Get latency percentiles.
 * @param {object} opts - { endpoint?, windowMs? }
 */
export function getLatencyStats(opts = {}) {
  let data = [...latencies];
  if (opts.endpoint) data = data.filter(l => l.endpoint === opts.endpoint);
  if (opts.windowMs) {
    const cutoff = Date.now() - opts.windowMs;
    data = data.filter(l => l.ts > cutoff);
  }

  if (!data.length) return { count: 0, p50: 0, p90: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 };

  const sorted = data.map(d => d.ms).sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);

  return {
    count,
    p50: sorted[Math.floor(count * 0.5)] || 0,
    p90: sorted[Math.floor(count * 0.9)] || 0,
    p95: sorted[Math.floor(count * 0.95)] || 0,
    p99: sorted[Math.floor(count * 0.99)] || 0,
    avg: Math.round(sum / count),
    min: sorted[0],
    max: sorted[count - 1],
  };
}

// ─── Error Tracking ─────────────────────────────────────────────────

/**
 * Record an error.
 */
export function recordError(message, endpoint = 'unknown') {
  errors.push({ ts: Date.now(), message: String(message).slice(0, 500), endpoint });
  if (errors.length > MAX_ERRORS) errors.shift();
}

/**
 * Get error rate and recent errors.
 * @param {object} opts - { windowMs?, limit? }
 */
export function getErrorStats(opts = {}) {
  let data = [...errors];
  if (opts.windowMs) {
    const cutoff = Date.now() - opts.windowMs;
    data = data.filter(e => e.ts > cutoff);
  }
  const limit = opts.limit || 20;

  // Group by endpoint
  const byEndpoint = {};
  for (const e of data) {
    byEndpoint[e.endpoint] = (byEndpoint[e.endpoint] || 0) + 1;
  }

  return {
    total: data.length,
    byEndpoint,
    recent: data.slice(-limit).reverse(),
  };
}

/**
 * Clear error history.
 */
export function clearErrors() {
  errors.length = 0;
}

// ─── Backend Health ─────────────────────────────────────────────────

/**
 * Record a backend check result.
 * @param {string} backend - backend name
 * @param {boolean} available
 * @param {number} [latencyMs]
 */
export function recordBackendCheck(backend, available, latencyMs = 0) {
  if (!backendChecks.has(backend)) {
    backendChecks.set(backend, {
      status: 'unknown', totalChecks: 0, failures: 0,
      lastCheck: null, lastLatency: 0, history: [],
    });
  }
  const entry = backendChecks.get(backend);
  entry.status = available ? 'healthy' : 'unhealthy';
  entry.totalChecks++;
  if (!available) entry.failures++;
  entry.lastCheck = new Date().toISOString();
  entry.lastLatency = latencyMs;
  entry.history.push({ ts: Date.now(), available, latencyMs });
  if (entry.history.length > 50) entry.history.shift();
}

/**
 * Get backend availability.
 */
export function getBackendHealth() {
  const result = {};
  for (const [name, entry] of backendChecks) {
    result[name] = {
      status: entry.status,
      uptime: entry.totalChecks ? ((entry.totalChecks - entry.failures) / entry.totalChecks * 100).toFixed(1) + '%' : 'N/A',
      totalChecks: entry.totalChecks,
      failures: entry.failures,
      lastCheck: entry.lastCheck,
      lastLatency: entry.lastLatency,
    };
  }
  return result;
}

// ─── Health Score ────────────────────────────────────────────────────

/**
 * Calculate overall health score (0-100).
 */
export function getHealthScore() {
  let score = 100;
  const issues = [];

  // Latency penalty
  const latencyStats = getLatencyStats({ windowMs: 300000 }); // 5 min
  if (latencyStats.p95 > 5000) { score -= 20; issues.push('High p95 latency'); }
  else if (latencyStats.p95 > 2000) { score -= 10; issues.push('Elevated p95 latency'); }

  // Error rate penalty
  const errorStats = getErrorStats({ windowMs: 300000 });
  if (errorStats.total > 50) { score -= 30; issues.push('High error rate'); }
  else if (errorStats.total > 10) { score -= 15; issues.push('Elevated error rate'); }

  // Backend health penalty
  const backends = getBackendHealth();
  for (const [name, info] of Object.entries(backends)) {
    if (info.status === 'unhealthy') { score -= 15; issues.push(`${name} unhealthy`); }
  }

  return {
    score: Math.max(0, score),
    status: score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : 'critical',
    issues,
    checkedAt: new Date().toISOString(),
  };
}

// ─── Alert Thresholds ───────────────────────────────────────────────

const DEFAULT_THRESHOLDS = {
  maxP95LatencyMs: 5000,
  maxErrorsPerMinute: 10,
  minHealthScore: 50,
  maxBackendFailures: 5,
};

/**
 * Get alert thresholds.
 */
export function getThresholds() {
  const global = refs.workspace?.getGlobalSettings?.() || {};
  return { ...DEFAULT_THRESHOLDS, ...(global.healthThresholds || {}) };
}

/**
 * Set alert thresholds.
 */
export function setThresholds(thresholds) {
  const cleaned = {};
  if (typeof thresholds.maxP95LatencyMs === 'number' && thresholds.maxP95LatencyMs > 0)
    cleaned.maxP95LatencyMs = thresholds.maxP95LatencyMs;
  if (typeof thresholds.maxErrorsPerMinute === 'number' && thresholds.maxErrorsPerMinute > 0)
    cleaned.maxErrorsPerMinute = thresholds.maxErrorsPerMinute;
  if (typeof thresholds.minHealthScore === 'number' && thresholds.minHealthScore >= 0)
    cleaned.minHealthScore = thresholds.minHealthScore;
  if (typeof thresholds.maxBackendFailures === 'number' && thresholds.maxBackendFailures > 0)
    cleaned.maxBackendFailures = thresholds.maxBackendFailures;

  const global = refs.workspace?.getGlobalSettings?.() || {};
  const merged = { ...(global.healthThresholds || {}), ...cleaned };
  refs.workspace?.updateGlobalSettings?.({ healthThresholds: merged });
  return getThresholds();
}

/**
 * Check thresholds and return violated ones.
 */
export function checkThresholds() {
  const th = getThresholds();
  const violations = [];

  const latency = getLatencyStats({ windowMs: 60000 });
  if (latency.p95 > th.maxP95LatencyMs) {
    violations.push({ threshold: 'maxP95LatencyMs', value: latency.p95, limit: th.maxP95LatencyMs });
  }

  const errs = getErrorStats({ windowMs: 60000 });
  if (errs.total > th.maxErrorsPerMinute) {
    violations.push({ threshold: 'maxErrorsPerMinute', value: errs.total, limit: th.maxErrorsPerMinute });
  }

  const health = getHealthScore();
  if (health.score < th.minHealthScore) {
    violations.push({ threshold: 'minHealthScore', value: health.score, limit: th.minHealthScore });
  }

  return { violations, thresholds: th, healthy: violations.length === 0 };
}

// ─── Full Dashboard ─────────────────────────────────────────────────

/**
 * Get full health dashboard.
 */
export function getDashboard() {
  return {
    uptime: getUptime(),
    health: getHealthScore(),
    latency: getLatencyStats(),
    errors: getErrorStats({ limit: 10 }),
    backends: getBackendHealth(),
    thresholds: checkThresholds(),
  };
}

// ─── Reset (for tests) ─────────────────────────────────────────────

export function _reset() {
  latencies.length = 0;
  errors.length = 0;
  backendChecks.clear();
}
