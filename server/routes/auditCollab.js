/**
 * Audit & collaboration routes — audit log, collaborators, presence.
 */
import { Router } from 'express';
import { refs } from '../state.js';
import {
  getAuditLog, appendAuditEntry, getActors, clearAuditLog,
} from '../services/auditLog.js';
import {
  listCollaborators, addCollaborator, removeCollaborator, getRole, hasAccess,
  getActivity, recordActivity, clearActivity, joinPresence, leavePresence,
  getPresence, heartbeat, getRoles,
} from '../services/collaboration.js';

const router = Router();

// ────── Audit Log ──────

/** Get audit log with optional filters */
router.get('/projects/:slug/audit-log', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { action, actor, limit, offset } = req.query;
  const result = getAuditLog(req.params.slug, {
    action, actor,
    limit: limit ? parseInt(limit, 10) : undefined,
    offset: offset ? parseInt(offset, 10) : undefined,
  });
  res.json(result);
});

/** Append audit entry */
router.post('/projects/:slug/audit-log', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { action, actor, details } = req.body;
  if (!action) return res.status(400).json({ error: 'action is required' });
  const entry = appendAuditEntry(req.params.slug, { action, actor, details });
  res.status(201).json(entry);
});

/** Get unique actors */
router.get('/projects/:slug/audit-log/actors', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getActors(req.params.slug));
});

/** Clear audit log */
router.delete('/projects/:slug/audit-log', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const count = clearAuditLog(req.params.slug);
  res.json({ cleared: count });
});


/** List collaborators */
router.get('/projects/:slug/collaborators', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(listCollaborators(req.params.slug));
});

/** Add/update collaborator */
router.post('/projects/:slug/collaborators', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    const collab = addCollaborator(req.params.slug, req.body);
    res.status(201).json(collab);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Remove collaborator */
router.delete('/projects/:slug/collaborators/:userId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const removed = removeCollaborator(req.params.slug, req.params.userId);
  if (!removed) return res.status(404).json({ error: 'Collaborator not found' });
  res.json({ ok: true });
});

/** Check a user's role */
router.get('/projects/:slug/collaborators/:userId/role', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const role = getRole(req.params.slug, req.params.userId);
  res.json({ userId: req.params.userId, role });
});

/** Check access level */
router.get('/projects/:slug/collaborators/:userId/access/:requiredRole', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const allowed = hasAccess(req.params.slug, req.params.userId, req.params.requiredRole);
  res.json({ allowed });
});

/** Get activity feed */
router.get('/projects/:slug/activity', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const opts = {};
  if (req.query.userId) opts.userId = req.query.userId;
  if (req.query.action) opts.action = req.query.action;
  if (req.query.limit) opts.limit = parseInt(req.query.limit, 10);
  res.json(getActivity(req.params.slug, opts));
});

/** Record activity */
router.post('/projects/:slug/activity', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    const record = recordActivity(req.params.slug, req.body);
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Clear activity feed */
router.delete('/projects/:slug/activity', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  clearActivity(req.params.slug);
  res.json({ ok: true });
});

/** Get presence */
router.get('/projects/:slug/presence', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(getPresence(req.params.slug));
});

/** Join presence */
router.post('/projects/:slug/presence', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  res.json(joinPresence(req.params.slug, userId));
});

/** Leave presence */
router.delete('/projects/:slug/presence/:userId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  leavePresence(req.params.slug, req.params.userId);
  res.json({ ok: true });
});

/** Heartbeat */
router.post('/projects/:slug/presence/:userId/heartbeat', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  heartbeat(req.params.slug, req.params.userId);
  res.json({ ok: true });
});

/** List valid roles */
router.get('/collaboration/roles', (_req, res) => {
  res.json(getRoles());
});


export default router;
