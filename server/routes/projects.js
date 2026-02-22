/**
 * Project routes — Phase 6.8
 * Project CRUD, skills, reflections, settings, workspace analysis.
 */

import { Router } from 'express';
import { MSG, makeMsg } from '../../shared/protocol.js';
import { refs } from '../state.js';
import { broadcast } from '../ws/broadcast.js';
import { validateRetrySettings, buildRetryPolicy } from '../services/retryPolicy.js';
import {
  getSchedules, addSchedule, updateSchedule, removeSchedule,
  getQueue, enqueue, dequeue,
} from '../services/scheduler.js';
import { computeBenchmarks } from '../services/benchmarks.js';
import {
  getNotifications, addNotification, markRead, markAllRead,
  deleteNotification, clearNotifications, getUnreadCount,
} from '../services/notifications.js';
import {
  getApiKeys, addApiKey, removeApiKey, rotateApiKey, toggleApiKey,
} from '../services/apiKeys.js';
import {
  getTemplates, getTemplate, addTemplate, updateTemplate,
  removeTemplate, useTemplate, duplicateTemplate,
} from '../services/sessionTemplates.js';

const router = Router();

/** List all projects */
router.get('/projects', (req, res) => {
  res.json(refs.workspace.listProjects());
});

/** Get a single project */
router.get('/projects/:slug', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(project);
});

/** Create a new project */
router.post('/projects', (req, res) => {
  const { name, description, slug } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const project = refs.workspace.createProject(name, { description, slug });
    res.status(201).json(project);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

/** Link an existing directory as a project */
router.post('/projects/link', (req, res) => {
  const { name, directory } = req.body;
  if (!name || !directory) {
    return res.status(400).json({ error: 'Name and directory are required' });
  }
  try {
    const project = refs.workspace.linkProject(name, directory);
    res.status(201).json(project);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

/** Delete a project */
router.delete('/projects/:slug', (req, res) => {
  try {
    refs.workspace.deleteProject(req.params.slug);
    res.json({ deleted: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ── Skills ──

router.get('/projects/:slug/skills', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(refs.workspace.getSkills(req.params.slug));
});

router.put('/projects/:slug/skills', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const merged = refs.workspace.saveSkills(req.params.slug, req.body);
  broadcast(makeMsg(MSG.SKILLS_UPDATE, { projectSlug: req.params.slug, skills: merged }));
  res.json(merged);
});

// ── Reflections ──

router.get('/projects/:slug/reflections', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const limit = parseInt(req.query.limit) || 20;
  res.json(refs.workspace.getReflections(req.params.slug, limit));
});

// ── Settings ──

router.get('/projects/:slug/settings', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(refs.workspace.getProjectSettings(req.params.slug));
});

router.put('/projects/:slug/settings', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const updated = refs.workspace.updateProjectSettings(req.params.slug, req.body);
  broadcast(makeMsg(MSG.SETTINGS_UPDATE, { projectSlug: req.params.slug, settings: updated }));
  res.json(updated);
});

// ── Phase 7.6: Cost Analytics ──

router.get('/projects/:slug/cost-history', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const sessions = refs.workspace.listSessions(req.params.slug);
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);

  // Build per-session cost entries sorted newest-first, take limit
  const entries = sessions
    .filter(s => s.status === 'completed' || s.status === 'failed')
    .slice(0, limit)
    .map(s => {
      // Extract per-tier costs from agents
      const tierCounts = { T0: 0, T1: 0, T2: 0, T3: 0 };
      if (s.agents) {
        for (const agent of Object.values(s.agents)) {
          const tier = agent.modelTier || 'T0';
          tierCounts[tier] = (tierCounts[tier] || 0) + 1;
        }
      }
      // Also check costSummary.byTier if available
      if (s.costSummary?.byTier) {
        for (const [tier, data] of Object.entries(s.costSummary.byTier)) {
          if (data.count) tierCounts[tier] = data.count;
        }
      }

      return {
        sessionId: s.id,
        prompt: (s.prompt || '').slice(0, 80),
        status: s.status,
        createdAt: s.createdAt,
        totalCost: s.costSummary?.totalPremiumRequests || 0,
        tiers: tierCounts,
        taskCount: Array.isArray(s.tasks) ? s.tasks.length : 0,
      };
    })
    .reverse(); // chronological order for charting

  // Aggregate totals
  const totals = { T0: 0, T1: 0, T2: 0, T3: 0, total: 0 };
  for (const e of entries) {
    for (const [tier, count] of Object.entries(e.tiers)) {
      totals[tier] = (totals[tier] || 0) + count;
    }
    totals.total += e.totalCost;
  }

  res.json({ entries, totals, count: entries.length });
});

// ── Workspace Analysis ──

router.get('/projects/:slug/analysis', async (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    const { analyzeWorkspace } = await import('../workspaceAnalyzer.js');
    const analysis = await analyzeWorkspace(project.dir);
    res.json({
      summary: analysis.summary,
      fileTree: analysis.fileTree,
      techStack: analysis.techStack,
      entryPoints: analysis.entryPoints,
      dependencies: analysis.dependencies,
      conventions: analysis.conventions,
    });
  } catch (err) {
    res.status(500).json({ error: `Analysis failed: ${err.message}` });
  }
});

// ═══════════════════════════════════════════════════════════
//  Phase 7.8: Webhook Notifications
// ═══════════════════════════════════════════════════════════

import { getWebhooks, addWebhook, removeWebhook, toggleWebhook } from '../services/webhooks.js';

/** List webhooks for a project */
router.get('/projects/:slug/webhooks', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(getWebhooks(req.params.slug));
});

/** Add a webhook */
router.post('/projects/:slug/webhooks', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    const webhook = addWebhook(req.params.slug, req.body);
    res.status(201).json(webhook);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Delete a webhook */
router.delete('/projects/:slug/webhooks/:id', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const removed = removeWebhook(req.params.slug, req.params.id);
  if (!removed) return res.status(404).json({ error: 'Webhook not found' });
  res.json({ ok: true });
});

/** Toggle a webhook enabled/disabled */
router.patch('/projects/:slug/webhooks/:id', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) required' });
  const hook = toggleWebhook(req.params.slug, req.params.id, enabled);
  if (!hook) return res.status(404).json({ error: 'Webhook not found' });
  res.json(hook);
});

/** Phase 8.6: Test a webhook by sending a test event */
router.post('/projects/:slug/webhooks/:id/test', async (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const hooks = getWebhooks(req.params.slug);
  const hook = hooks.find(h => h.id === req.params.id);
  if (!hook) return res.status(404).json({ error: 'Webhook not found' });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const body = JSON.stringify({
      event: 'webhook:test',
      project: req.params.slug,
      timestamp: new Date().toISOString(),
      payload: { message: 'Test delivery from hAIvemind', webhookId: hook.id },
    });

    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'hAIvemind-Webhook/1.0', 'X-hAIvemind-Event': 'webhook:test' };
    if (hook.secret) headers['X-hAIvemind-Secret'] = hook.secret;

    const result = await fetch(hook.url, { method: 'POST', headers, body, signal: controller.signal });
    clearTimeout(timer);
    res.json({ success: result.ok, status: result.status, statusText: result.statusText });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  Phase 8.3: Smart Retry Policies
// ═══════════════════════════════════════════════════════════

/** Get retry policy for a project (merged with defaults) */
router.get('/projects/:slug/retry-policy', (req, res) => {
  const settings = refs.workspace.getProjectSettings(req.params.slug);
  res.json(buildRetryPolicy(settings));
});

/** Update retry policy for a project */
router.put('/projects/:slug/retry-policy', (req, res) => {
  const { valid, policy, errors } = validateRetrySettings(req.body);
  if (!valid) return res.status(400).json({ error: errors.join('; ') });

  const settings = refs.workspace.getProjectSettings(req.params.slug);
  const merged = { ...settings, ...policy };
  refs.workspace.updateProjectSettings(req.params.slug, merged);
  res.json(buildRetryPolicy(merged));
});

// ═══════════════════════════════════════════════════════════
//  Benchmarks — Phase 8.8
// ═══════════════════════════════════════════════════════════

/** Get performance benchmarks for a project */
router.get('/projects/:slug/benchmarks', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const sessions = refs.workspace.listSessions(req.params.slug);
  res.json(computeBenchmarks(sessions));
});

// ═══════════════════════════════════════════════════════════
//  Schedules — Phase 8.7
// ═══════════════════════════════════════════════════════════

/** List schedules for a project */
router.get('/projects/:slug/schedules', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getSchedules(req.params.slug));
});

/** Create a schedule */
router.post('/projects/:slug/schedules', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  try {
    const schedule = addSchedule(req.params.slug, req.body);
    res.status(201).json(schedule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Update a schedule */
router.patch('/projects/:slug/schedules/:scheduleId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  try {
    const updated = updateSchedule(req.params.slug, req.params.scheduleId, req.body);
    if (!updated) return res.status(404).json({ error: 'Schedule not found' });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Delete a schedule */
router.delete('/projects/:slug/schedules/:scheduleId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const removed = removeSchedule(req.params.slug, req.params.scheduleId);
  if (!removed) return res.status(404).json({ error: 'Schedule not found' });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
//  Queue — Phase 8.7
// ═══════════════════════════════════════════════════════════

/** Get the current execution queue */
router.get('/queue', (_req, res) => {
  res.json(getQueue());
});

/** Enqueue a session manually */
router.post('/projects/:slug/queue', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  if (!req.body.prompt) return res.status(400).json({ error: 'Prompt is required' });
  const entry = enqueue(req.params.slug, req.body.prompt, {
    priority: req.body.priority,
    scheduleId: req.body.scheduleId,
  });
  res.status(201).json(entry);
});

/** Remove a queue entry */
router.delete('/queue/:entryId', (req, res) => {
  const removed = dequeue(req.params.entryId);
  if (!removed) return res.status(404).json({ error: 'Queue entry not found' });
  res.json({ success: true });
});

/* ═══ Notifications (Phase 9.2) ═══ */

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

// ────── API Keys ──────

/** List API keys (masked) */
router.get('/projects/:slug/api-keys', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getApiKeys(req.params.slug));
});

/** Add API key */
router.post('/projects/:slug/api-keys', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { backend, label, key } = req.body;
  if (!backend || !key) {
    return res.status(400).json({ error: 'backend and key are required' });
  }
  const entry = addApiKey(req.params.slug, { backend, label, key });
  res.status(201).json(entry);
});

/** Remove API key */
router.delete('/projects/:slug/api-keys/:keyId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const ok = removeApiKey(req.params.slug, req.params.keyId);
  if (!ok) return res.status(404).json({ error: 'API key not found' });
  res.json({ success: true });
});

/** Rotate API key */
router.post('/projects/:slug/api-keys/:keyId/rotate', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'key is required' });
  const entry = rotateApiKey(req.params.slug, req.params.keyId, key);
  if (!entry) return res.status(404).json({ error: 'API key not found' });
  res.json(entry);
});

/** Toggle API key active/inactive */
router.patch('/projects/:slug/api-keys/:keyId/toggle', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const ok = toggleApiKey(req.params.slug, req.params.keyId);
  if (!ok) return res.status(404).json({ error: 'API key not found' });
  res.json({ success: true });
});

// ────── Session Templates ──────

/** List templates */
router.get('/projects/:slug/templates', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getTemplates(req.params.slug));
});

/** Get single template */
router.get('/projects/:slug/templates/:templateId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const tmpl = getTemplate(req.params.slug, req.params.templateId);
  if (!tmpl) return res.status(404).json({ error: 'Template not found' });
  res.json(tmpl);
});

/** Create template */
router.post('/projects/:slug/templates', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { name, prompt, description, category, settings } = req.body;
  if (!name || !prompt) {
    return res.status(400).json({ error: 'name and prompt are required' });
  }
  const tmpl = addTemplate(req.params.slug, { name, prompt, description, category, settings });
  res.status(201).json(tmpl);
});

/** Update template */
router.patch('/projects/:slug/templates/:templateId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const tmpl = updateTemplate(req.params.slug, req.params.templateId, req.body);
  if (!tmpl) return res.status(404).json({ error: 'Template not found' });
  res.json(tmpl);
});

/** Delete template */
router.delete('/projects/:slug/templates/:templateId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const ok = removeTemplate(req.params.slug, req.params.templateId);
  if (!ok) return res.status(404).json({ error: 'Template not found' });
  res.json({ success: true });
});

/** Use (launch) template — increments useCount */
router.post('/projects/:slug/templates/:templateId/use', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const tmpl = useTemplate(req.params.slug, req.params.templateId);
  if (!tmpl) return res.status(404).json({ error: 'Template not found' });
  res.json(tmpl);
});

/** Duplicate template */
router.post('/projects/:slug/templates/:templateId/duplicate', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const tmpl = duplicateTemplate(req.params.slug, req.params.templateId);
  if (!tmpl) return res.status(404).json({ error: 'Template not found' });
  res.status(201).json(tmpl);
});

export default router;
