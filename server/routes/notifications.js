/**
 * Notification routes — notifications, channels, digest.
 */
import { Router } from 'express';
import { refs } from '../state.js';
import {
  getNotifications, addNotification, markRead, markAllRead,
  deleteNotification, clearNotifications, getUnreadCount,
} from '../services/notifications.js';
import {
  listChannels, getChannel, addChannel, updateChannel, removeChannel,
  toggleChannel, sendNotification, getDigest, flushDigest, testChannel,
  CHANNEL_TYPES, DELIVERY_MODES,
} from '../services/notificationChannels.js';

const router = Router();

/** List notifications for a project */
router.get('/projects/:slug/notifications', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json({
    notifications: getNotifications(req.params.slug),
    unread: getUnreadCount(req.params.slug),
  });
});

/** Add a notification */
router.post('/projects/:slug/notifications', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  if (!req.body.title || !req.body.type) {
    return res.status(400).json({ error: 'title and type are required' });
  }
  const notif = addNotification(req.params.slug, req.body);
  res.status(201).json(notif);
});

/** Mark a notification as read */
router.patch('/projects/:slug/notifications/:notifId/read', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const ok = markRead(req.params.slug, req.params.notifId);
  if (!ok) return res.status(404).json({ error: 'Notification not found' });
  res.json({ success: true });
});

/** Mark all notifications as read */
router.post('/projects/:slug/notifications/read-all', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const count = markAllRead(req.params.slug);
  res.json({ marked: count });
});

/** Delete a notification */
router.delete('/projects/:slug/notifications/:notifId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const ok = deleteNotification(req.params.slug, req.params.notifId);
  if (!ok) return res.status(404).json({ error: 'Notification not found' });
  res.json({ success: true });
});

/** Clear all notifications */
router.delete('/projects/:slug/notifications', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const count = clearNotifications(req.params.slug);
  res.json({ cleared: count });
});


// ─── Phase 11.6: Notification Channels ──────────────────────────────────

/** List notification channels for a project */
router.get('/projects/:slug/channels', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(listChannels(req.params.slug));
});

/** Get a single channel */
router.get('/projects/:slug/channels/:channelId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const channel = getChannel(req.params.slug, req.params.channelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  res.json(channel);
});

/** Add a notification channel */
router.post('/projects/:slug/channels', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  try {
    const channel = addChannel(req.params.slug, req.body);
    res.status(201).json(channel);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Update a channel */
router.put('/projects/:slug/channels/:channelId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  try {
    const channel = updateChannel(req.params.slug, req.params.channelId, req.body);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    res.json(channel);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Remove a channel */
router.delete('/projects/:slug/channels/:channelId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const removed = removeChannel(req.params.slug, req.params.channelId);
  if (!removed) return res.status(404).json({ error: 'Channel not found' });
  res.json({ ok: true });
});

/** Toggle channel enabled/disabled */
router.post('/projects/:slug/channels/:channelId/toggle', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const channel = toggleChannel(req.params.slug, req.params.channelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  res.json(channel);
});

/** Test a channel */
router.post('/projects/:slug/channels/:channelId/test', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const result = testChannel(req.params.slug, req.params.channelId);
  if (!result) return res.status(404).json({ error: 'Channel not found' });
  res.json(result);
});

/** Send a notification to all matching channels */
router.post('/projects/:slug/notify', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const { action, detail, level } = req.body;
  if (!action) return res.status(400).json({ error: 'Missing action' });
  const results = sendNotification(req.params.slug, { action, detail, level, project: req.params.slug });
  res.json(results);
});

/** Get digest buffer */
router.get('/projects/:slug/channels/:channelId/digest', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getDigest(req.params.slug, req.params.channelId));
});

/** Flush digest buffer */
router.post('/projects/:slug/channels/:channelId/digest/flush', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const flushed = flushDigest(req.params.slug, req.params.channelId);
  res.json(flushed);
});

/** List channel types and delivery modes */
router.get('/notification-meta', (_req, res) => {
  res.json({ types: CHANNEL_TYPES, modes: DELIVERY_MODES });
});


export default router;
