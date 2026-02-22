/**
 * server/middleware/auth.js — Authentication Middleware
 *
 * Optional Express middleware for Bearer token authentication.
 * When auth is disabled globally, all requests pass through.
 */

import { verifyToken, isAuthEnabled, checkProjectAccess } from '../services/auth.js';

/**
 * Optional auth — attaches req.user if valid token present.
 * Never blocks requests. Use this for routes that work with or without auth.
 */
export function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7);
    const user = verifyToken(token);
    if (user) req.user = user;
  }
  next();
}

/**
 * Required auth — blocks unauthenticated requests when auth is enabled.
 * When auth is disabled, passes through.
 */
export function requireAuth(req, res, next) {
  if (!isAuthEnabled()) return next();

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.slice(7);
  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = user;
  next();
}

/**
 * Admin-only — requires auth + admin role.
 * When auth is disabled, passes through.
 */
export function requireAdmin(req, res, next) {
  if (!isAuthEnabled()) return next();

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.slice(7);
  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  req.user = user;
  next();
}

/**
 * Project access — checks if user can access a specific project.
 * Extracts :slug from route params. When auth is disabled, passes through.
 */
export function requireProjectAccess(req, res, next) {
  if (!isAuthEnabled()) return next();

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.slice(7);
  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = user;
  const slug = req.params.slug;
  if (slug && !checkProjectAccess(slug, user)) {
    return res.status(403).json({ error: 'Access denied to this project' });
  }

  next();
}
