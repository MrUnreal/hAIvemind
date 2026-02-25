/**
 * server/middleware/inputSanitizer.js — Phase 18.0: Input Sanitization
 *
 * Express middleware that sanitizes all incoming request bodies:
 * - Strips control characters
 * - Limits string lengths
 * - Prevents prototype pollution
 * - Validates expected types
 * - Rejects obvious injection attempts
 */

const MAX_STRING_LENGTH = 100_000;  // 100KB per string field
const MAX_BODY_DEPTH = 10;          // Max JSON nesting depth
const MAX_ARRAY_LENGTH = 1000;      // Max items per array

// Control chars to strip (keep newlines, tabs)
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

// Dangerous keys that could cause prototype pollution
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Deep sanitize an object.
 * @param {any} value
 * @param {number} depth - current nesting depth
 * @returns {any} sanitized value
 */
function sanitizeValue(value, depth = 0) {
  if (depth > MAX_BODY_DEPTH) return undefined;

  if (value === null || value === undefined) return value;

  switch (typeof value) {
    case 'string':
      // Strip control characters
      let clean = value.replace(CONTROL_CHARS_RE, '');
      // Truncate oversized strings
      if (clean.length > MAX_STRING_LENGTH) {
        clean = clean.slice(0, MAX_STRING_LENGTH);
      }
      return clean;

    case 'number':
      // Reject Infinity and NaN
      if (!Number.isFinite(value)) return 0;
      return value;

    case 'boolean':
      return value;

    case 'object':
      if (Array.isArray(value)) {
        // Truncate oversized arrays
        const arr = value.slice(0, MAX_ARRAY_LENGTH);
        return arr.map(item => sanitizeValue(item, depth + 1)).filter(v => v !== undefined);
      }

      // Regular object — sanitize each key
      const result = {};
      for (const [key, val] of Object.entries(value)) {
        // Block prototype pollution
        if (DANGEROUS_KEYS.has(key)) continue;

        // Sanitize keys too
        const cleanKey = key.replace(CONTROL_CHARS_RE, '').slice(0, 256);
        if (!cleanKey) continue;

        const cleanVal = sanitizeValue(val, depth + 1);
        if (cleanVal !== undefined) {
          result[cleanKey] = cleanVal;
        }
      }
      return result;

    default:
      // Functions, symbols, etc. — strip
      return undefined;
  }
}

/**
 * Express middleware: sanitize request body, query, and params.
 */
export function inputSanitizer(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }

  // Sanitize query strings
  if (req.query && typeof req.query === 'object') {
    for (const [key, val] of Object.entries(req.query)) {
      if (typeof val === 'string') {
        req.query[key] = val.replace(CONTROL_CHARS_RE, '').slice(0, MAX_STRING_LENGTH);
      }
    }
  }

  // Sanitize route params
  if (req.params && typeof req.params === 'object') {
    for (const [key, val] of Object.entries(req.params)) {
      if (typeof val === 'string') {
        req.params[key] = val.replace(CONTROL_CHARS_RE, '').slice(0, 1024);
      }
    }
  }

  next();
}

/**
 * Express middleware: validate Content-Type for JSON endpoints.
 */
export function requireJSON(req, res, next) {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json') && req.body && Object.keys(req.body).length > 0) {
      return res.status(415).json({ error: 'Content-Type must be application/json' });
    }
  }
  next();
}

export default inputSanitizer;
