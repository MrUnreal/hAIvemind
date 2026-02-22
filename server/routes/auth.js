/**
 * server/routes/auth.js — Authentication Routes
 *
 * POST /auth/register   — Register a new user
 * POST /auth/login      — Authenticate and get token
 * POST /auth/logout     — Revoke current token
 * GET  /auth/me         — Get current user info
 * GET  /auth/status     — Auth enabled/disabled status
 * POST /auth/enable     — Enable auth (admin)
 * POST /auth/disable    — Disable auth (admin)
 * GET  /auth/users      — List users (admin)
 * DELETE /auth/users/:id — Remove user (admin)
 * PATCH /auth/users/:id/role — Update user role (admin)
 * GET  /projects/:slug/acl — Get project ACL
 * PUT  /projects/:slug/acl — Set project ACL
 */

import { Router } from 'express';
import {
  registerUser,
  authenticateUser,
  verifyToken,
  revokeToken,
  getUsers,
  removeUser,
  updateUserRole,
  isAuthEnabled,
  enableAuth,
  disableAuth,
  getProjectAcl,
  setProjectAcl,
  cleanupExpiredTokens,
} from '../services/auth.js';
import { requireAuth, requireAdmin, optionalAuth } from '../middleware/auth.js';
import { refs } from '../state.js';

const router = Router();

// ─── Auth Status ─────────────────────────────────────────────────────
router.get('/auth/status', (_req, res) => {
  res.json({ enabled: isAuthEnabled() });
});

// ─── Register ────────────────────────────────────────────────────────
router.post('/auth/register', (req, res) => {
  try {
    const { username, password, role } = req.body;
    const user = registerUser(username, password, role);
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Login ───────────────────────────────────────────────────────────
router.post('/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const result = authenticateUser(username, password);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ─── Logout ──────────────────────────────────────────────────────────
router.post('/auth/logout', (req, res) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    revokeToken(header.slice(7));
  }
  res.json({ ok: true });
});

// ─── Me ──────────────────────────────────────────────────────────────
router.get('/auth/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// ─── Enable/Disable Auth (admin or first-time) ──────────────────────
router.post('/auth/enable', requireAdmin, (_req, res) => {
  res.json(enableAuth());
});

router.post('/auth/disable', requireAdmin, (_req, res) => {
  res.json(disableAuth());
});

// ─── User Management (admin) ────────────────────────────────────────
router.get('/auth/users', requireAdmin, (_req, res) => {
  res.json(getUsers());
});

router.delete('/auth/users/:id', requireAdmin, (req, res) => {
  const ok = removeUser(req.params.id);
  if (!ok) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

router.patch('/auth/users/:id/role', requireAdmin, (req, res) => {
  try {
    const user = updateUserRole(req.params.id, req.body.role);
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Cleanup ─────────────────────────────────────────────────────────
router.post('/auth/cleanup', requireAdmin, (_req, res) => {
  const count = cleanupExpiredTokens();
  res.json({ cleaned: count });
});

// ─── Project ACL ─────────────────────────────────────────────────────
router.get('/projects/:slug/acl', optionalAuth, (req, res) => {
  const project = refs.workspace?.getProject?.(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(getProjectAcl(req.params.slug));
});

router.put('/projects/:slug/acl', requireAuth, (req, res) => {
  const project = refs.workspace?.getProject?.(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const acl = setProjectAcl(req.params.slug, req.body);
  res.json(acl);
});

export default router;
