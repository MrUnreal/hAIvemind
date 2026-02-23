/**
 * server/services/rateLimiter.js — Rate Limiting Service
 *
 * Per-user and per-project rate limits with configurable thresholds,
 * sliding window tracking, cooldown periods, and admin override.
 */

import { refs } from '../state.js';

// ─── Defaults ───────────────────────────────────────────────────────
const DEFAULT_LIMITS = {
  requestsPerMinute: 60,
  requestsPerHour: 600,
  burstLimit: 20,           // max requests in 5-second window
  cooldownMs: 5000,         // cooldown after burst exceeded
};

// ─── In-Memory Tracking ─────────────────────────────────────────────
const buckets = new Map();  // key → { hits: [{ts}], cooldownUntil }

function getBucket(key) {
  if (!buckets.has(key)) {
    buckets.set(key, { hits: [], cooldownUntil: 0 });
  }
  return buckets.get(key);
}

function pruneHits(bucket, windowMs) {
  const cutoff = Date.now() - windowMs;
  bucket.hits = bucket.hits.filter(h => h > cutoff);
}

// ─── Configuration ──────────────────────────────────────────────────

/**
 * Get rate limits for a project (with global defaults fallback).
 */
export function getLimits(slug) {
  if (slug) {
    const settings = refs.workspace?.getProjectSettings?.(slug) || {};
    return { ...DEFAULT_LIMITS, ...(settings.rateLimits || {}) };
  }
  const global = refs.workspace?.getGlobalSettings?.() || {};
  return { ...DEFAULT_LIMITS, ...(global.rateLimits || {}) };
}

/**
 * Set rate limits for a project or globally.
 */
export function setLimits(slug, limits) {
  const cleaned = {};
  if (typeof limits.requestsPerMinute === 'number' && limits.requestsPerMinute > 0)
    cleaned.requestsPerMinute = limits.requestsPerMinute;
  if (typeof limits.requestsPerHour === 'number' && limits.requestsPerHour > 0)
    cleaned.requestsPerHour = limits.requestsPerHour;
  if (typeof limits.burstLimit === 'number' && limits.burstLimit > 0)
    cleaned.burstLimit = limits.burstLimit;
  if (typeof limits.cooldownMs === 'number' && limits.cooldownMs >= 0)
    cleaned.cooldownMs = limits.cooldownMs;

  if (slug) {
    const settings = refs.workspace?.getProjectSettings?.(slug) || {};
    const merged = { ...(settings.rateLimits || {}), ...cleaned };
    refs.workspace?.updateProjectSettings?.(slug, { rateLimits: merged });
  } else {
    const global = refs.workspace?.getGlobalSettings?.() || {};
    const merged = { ...(global.rateLimits || {}), ...cleaned };
    refs.workspace?.updateGlobalSettings?.({ rateLimits: merged });
  }
  return getLimits(slug);
}

/**
 * Reset limits to defaults.
 */
export function resetLimits(slug) {
  if (slug) {
    refs.workspace?.updateProjectSettings?.(slug, { rateLimits: {} });
  } else {
    refs.workspace?.updateGlobalSettings?.({ rateLimits: {} });
  }
  return DEFAULT_LIMITS;
}

// ─── Rate Check ─────────────────────────────────────────────────────

/**
 * Check if a request is allowed under rate limits.
 * @param {string} key - identifier (e.g. 'user:123' or 'project:slug')
 * @param {object} [limitOverrides] - optional limit overrides
 * @returns {{ allowed: boolean, remaining: object, retryAfterMs?: number, reason?: string }}
 */
export function checkRate(key, limitOverrides = {}) {
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  const bucket = getBucket(key);
  const now = Date.now();

  // Check cooldown
  if (bucket.cooldownUntil > now) {
    return {
      allowed: false,
      remaining: { minute: 0, hour: 0, burst: 0 },
      retryAfterMs: bucket.cooldownUntil - now,
      reason: 'cooldown',
    };
  }

  // Prune old hits
  pruneHits(bucket, 3600000); // keep 1 hour

  const minuteHits = bucket.hits.filter(h => h > now - 60000).length;
  const hourHits = bucket.hits.length;
  const burstHits = bucket.hits.filter(h => h > now - 5000).length;

  // Check burst
  if (burstHits >= limits.burstLimit) {
    bucket.cooldownUntil = now + limits.cooldownMs;
    return {
      allowed: false,
      remaining: { minute: Math.max(0, limits.requestsPerMinute - minuteHits), hour: Math.max(0, limits.requestsPerHour - hourHits), burst: 0 },
      retryAfterMs: limits.cooldownMs,
      reason: 'burst',
    };
  }

  // Check per-minute
  if (minuteHits >= limits.requestsPerMinute) {
    const oldest = bucket.hits.filter(h => h > now - 60000)[0];
    return {
      allowed: false,
      remaining: { minute: 0, hour: Math.max(0, limits.requestsPerHour - hourHits), burst: Math.max(0, limits.burstLimit - burstHits) },
      retryAfterMs: oldest ? (oldest + 60000 - now) : 60000,
      reason: 'minute',
    };
  }

  // Check per-hour
  if (hourHits >= limits.requestsPerHour) {
    const oldest = bucket.hits[0];
    return {
      allowed: false,
      remaining: { minute: 0, hour: 0, burst: Math.max(0, limits.burstLimit - burstHits) },
      retryAfterMs: oldest ? (oldest + 3600000 - now) : 3600000,
      reason: 'hour',
    };
  }

  // Allowed
  bucket.hits.push(now);
  return {
    allowed: true,
    remaining: {
      minute: limits.requestsPerMinute - minuteHits - 1,
      hour: limits.requestsPerHour - hourHits - 1,
      burst: limits.burstLimit - burstHits - 1,
    },
  };
}

/**
 * Record a hit without checking (for admin/bypass use).
 */
export function recordHit(key) {
  const bucket = getBucket(key);
  bucket.hits.push(Date.now());
}

// ─── Status + Admin ─────────────────────────────────────────────────

/**
 * Get rate status for a key.
 */
export function getStatus(key) {
  const bucket = getBucket(key);
  const now = Date.now();
  pruneHits(bucket, 3600000);

  const minuteHits = bucket.hits.filter(h => h > now - 60000).length;
  const hourHits = bucket.hits.length;
  const burstHits = bucket.hits.filter(h => h > now - 5000).length;
  const inCooldown = bucket.cooldownUntil > now;

  return {
    key,
    minuteHits,
    hourHits,
    burstHits,
    inCooldown,
    cooldownRemainingMs: inCooldown ? bucket.cooldownUntil - now : 0,
  };
}

/**
 * Clear rate tracking for a key (admin override / reset).
 */
export function clearBucket(key) {
  buckets.delete(key);
  return true;
}

/**
 * Clear all rate tracking.
 */
export function clearAll() {
  buckets.clear();
  return true;
}

/**
 * List all tracked keys.
 */
export function listKeys() {
  return [...buckets.keys()];
}

/**
 * Get the default limits.
 */
export function getDefaults() {
  return { ...DEFAULT_LIMITS };
}

// ─── Express Middleware ─────────────────────────────────────────────

/**
 * Creates an Express middleware for rate limiting.
 * @param {object} opts - { keyFn?: (req) => string, limits?: object }
 */
export function rateLimitMiddleware(opts = {}) {
  const keyFn = opts.keyFn || ((req) => req.ip || 'unknown');
  const limits = opts.limits || {};

  return (req, res, next) => {
    const key = keyFn(req);
    const result = checkRate(key, limits);

    res.setHeader('X-RateLimit-Remaining-Minute', result.remaining.minute);
    res.setHeader('X-RateLimit-Remaining-Hour', result.remaining.hour);

    if (!result.allowed) {
      res.setHeader('Retry-After', Math.ceil((result.retryAfterMs || 1000) / 1000));
      return res.status(429).json({
        error: 'Rate limit exceeded',
        reason: result.reason,
        retryAfterMs: result.retryAfterMs,
      });
    }

    next();
  };
}
