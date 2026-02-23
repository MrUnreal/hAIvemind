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
import {
  getAuditLog, appendAuditEntry, getActors, clearAuditLog,
} from '../services/auditLog.js';
import {
  getProjectStats, getTimeSeries, getModelBreakdown,
  getWeeklyDigest, exportSessionsCsv, getTopSessions,
} from '../services/analytics.js';
import {
  getMemories, getMemory, addMemory, updateMemory,
  removeMemory, touchMemory, recallMemories, getTags,
  clearMemories, getMemoryStats,
} from '../services/agentMemory.js';
import {
  getSuggestions, getCategories, getPromptHistory,
  recordPrompt, clearHistory,
} from '../services/promptSuggestions.js';
import {
  getSystemMetrics, getLimits, setLimits, trackProcess, untrackProcess,
  getTrackedProcesses, killProcess, recordSnapshot, getSnapshots,
  getAlerts, clearAlerts, formatBytes,
} from '../services/resourceMonitor.js';
import {
  getDiffs, getDiff, addDiff, reviewHunk, bulkReview,
  revertDiff, removeDiff, clearDiffs, getReviewStats,
} from '../services/diffReview.js';
import {
  on, off, once, emit, removeAllListeners,
  getHistory as getEventHistory, clearHistory as clearEventHistory,
  getStats as getEventStats, listEvents, EVENTS, _reset as resetBus,
} from '../services/eventBus.js';
import {
  getLimits as getRateLimits, setLimits as setRateLimits, resetLimits as resetRateLimits,
  checkRate, getStatus as getRateStatus, clearBucket, clearAll as clearAllBuckets,
  listKeys as listRateKeys, getDefaults as getRateDefaults,
} from '../services/rateLimiter.js';
import {
  createSnapshot, listSnapshots, getSnapshot, restoreSnapshot,
  deleteSnapshot, updateSnapshot, diffSnapshots, clearSnapshots, getSnapshotStats,
} from '../services/workspaceSnapshots.js';
import {
  getUptime, recordLatency, getLatencyStats, recordError, getErrorStats, clearErrors,
  recordBackendCheck, getBackendHealth, getHealthScore, getThresholds, setThresholds,
  checkThresholds, getDashboard, _reset as resetHealth,
} from '../services/healthDashboard.js';

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

import { getWebhooks, getWebhook, addWebhook, removeWebhook, toggleWebhook, updateWebhook, testWebhook, getDeliveryHistory, getDeliveryStats, clearDeliveryHistory, computeSignature, verifySignature, WEBHOOK_EVENTS } from '../services/webhooks.js';

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

/** Phase 8.6 + 11.0: Test a webhook by sending a test ping */
router.post('/projects/:slug/webhooks/:id/test', async (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const result = await testWebhook(req.params.slug, req.params.id);
  if (result.error && !result.webhookId) return res.status(404).json({ error: result.error });
  res.json(result);
});

// ── Phase 11.0: Enhanced Webhook endpoints ──

/** Get a single webhook */
router.get('/projects/:slug/webhooks/:id', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const hook = getWebhook(req.params.slug, req.params.id);
  if (!hook) return res.status(404).json({ error: 'Webhook not found' });
  res.json(hook);
});

/** Update a webhook */
router.put('/projects/:slug/webhooks/:id', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    const hook = updateWebhook(req.params.slug, req.params.id, req.body);
    if (!hook) return res.status(404).json({ error: 'Webhook not found' });
    res.json(hook);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Get delivery history */
router.get('/projects/:slug/webhooks-history', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const opts = {};
  if (req.query.webhookId) opts.webhookId = req.query.webhookId;
  if (req.query.event) opts.event = req.query.event;
  if (req.query.limit) opts.limit = parseInt(req.query.limit, 10);
  res.json(getDeliveryHistory(req.params.slug, opts));
});

/** Get delivery stats */
router.get('/projects/:slug/webhooks-stats', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(getDeliveryStats(req.params.slug));
});

/** Clear delivery history */
router.delete('/projects/:slug/webhooks-history', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  clearDeliveryHistory(req.params.slug);
  res.json({ ok: true });
});

/** List supported webhook events */
router.get('/webhook-events', (_req, res) => {
  res.json(WEBHOOK_EVENTS);
});

/** Verify a webhook signature */
router.post('/webhook-verify', (req, res) => {
  const { body: payload, secret, signature } = req.body;
  if (!payload || !secret || !signature) {
    return res.status(400).json({ error: 'body, secret, and signature required' });
  }
  const bodyStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const sig = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  const valid = verifySignature(bodyStr, secret, sig);
  res.json({ valid });
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

// ═══════════════════════════════════════════════════════════════════
//  Session Analytics (Phase 10.0)
// ═══════════════════════════════════════════════════════════════════

/** Get aggregate project stats */
router.get('/projects/:slug/analytics/stats', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { from, to } = req.query;
  res.json(getProjectStats(req.params.slug, { from, to }));
});

/** Get time-series data */
router.get('/projects/:slug/analytics/timeseries', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const granularity = req.query.granularity || 'day';
  const periods = parseInt(req.query.periods) || 14;
  res.json(getTimeSeries(req.params.slug, granularity, periods));
});

/** Get model usage breakdown */
router.get('/projects/:slug/analytics/models', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getModelBreakdown(req.params.slug));
});

/** Get weekly digest */
router.get('/projects/:slug/analytics/digest', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getWeeklyDigest(req.params.slug));
});

/** Export sessions as CSV */
router.get('/projects/:slug/analytics/export', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { from, to } = req.query;
  const csv = exportSessionsCsv(req.params.slug, { from, to });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.slug}-sessions.csv"`);
  res.send(csv);
});

/** Get top sessions by duration or cost */
router.get('/projects/:slug/analytics/top', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const sortBy = req.query.sortBy || 'duration';
  const limit = parseInt(req.query.limit) || 10;
  res.json(getTopSessions(req.params.slug, sortBy, limit));
});

// ═══════════════════════════════════════════════════════════════════
//  Agent Memory (Phase 10.1)
// ═══════════════════════════════════════════════════════════════════

/** List memories */
router.get('/projects/:slug/memory', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { type, search, limit, offset } = req.query;
  res.json(getMemories(req.params.slug, {
    type, search,
    limit: limit ? parseInt(limit) : undefined,
    offset: offset ? parseInt(offset) : undefined,
  }));
});

/** Get memory stats */
router.get('/projects/:slug/memory/stats', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getMemoryStats(req.params.slug));
});

/** Get memory tags */
router.get('/projects/:slug/memory/tags', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getTags(req.params.slug));
});

/** Recall relevant memories */
router.get('/projects/:slug/memory/recall', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { q, limit } = req.query;
  res.json(recallMemories(req.params.slug, q || '', limit ? parseInt(limit) : undefined));
});

/** Get single memory */
router.get('/projects/:slug/memory/:memId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const entry = getMemory(req.params.slug, req.params.memId);
  if (!entry) return res.status(404).json({ error: 'Memory not found' });
  res.json(entry);
});

/** Add memory */
router.post('/projects/:slug/memory', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const entry = addMemory(req.params.slug, req.body);
  res.status(201).json(entry);
});

/** Update memory */
router.patch('/projects/:slug/memory/:memId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const entry = updateMemory(req.params.slug, req.params.memId, req.body);
  if (!entry) return res.status(404).json({ error: 'Memory not found' });
  res.json(entry);
});

/** Touch memory (record access) */
router.post('/projects/:slug/memory/:memId/touch', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const entry = touchMemory(req.params.slug, req.params.memId);
  if (!entry) return res.status(404).json({ error: 'Memory not found' });
  res.json(entry);
});

/** Delete memory */
router.delete('/projects/:slug/memory/:memId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const ok = removeMemory(req.params.slug, req.params.memId);
  if (!ok) return res.status(404).json({ error: 'Memory not found' });
  res.json({ ok: true });
});

/** Clear all memories */
router.delete('/projects/:slug/memory', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  clearMemories(req.params.slug);
  res.json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════
//  Smart Prompt Suggestions (Phase 10.2)
// ═════════════════════════════════════════════════════════════════

/** Get smart suggestions */
router.get('/projects/:slug/suggestions', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { query, category, limit } = req.query;
  res.json(getSuggestions(req.params.slug, {
    query, category,
    limit: limit ? parseInt(limit) : undefined,
  }));
});

/** Get suggestion categories */
router.get('/projects/:slug/suggestions/categories', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getCategories());
});

/** Get prompt history */
router.get('/projects/:slug/suggestions/history', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const limit = req.query.limit ? parseInt(req.query.limit) : undefined;
  res.json(getPromptHistory(req.params.slug, limit));
});

/** Record a prompt */
router.post('/projects/:slug/suggestions/history', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { text, sessionId } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  res.status(201).json(recordPrompt(req.params.slug, text, sessionId));
});

/** Clear prompt history */
router.delete('/projects/:slug/suggestions/history', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  clearHistory(req.params.slug);
  res.json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════
//  Resource Monitor (Phase 10.3)
// ═════════════════════════════════════════════════════════════════

/** Get system metrics (global, no project needed) */
router.get('/resources/system', (_req, res) => {
  res.json(getSystemMetrics());
});

/** Get resource snapshots */
router.get('/resources/snapshots', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : undefined;
  res.json(getSnapshots(limit));
});

/** Record a snapshot */
router.post('/resources/snapshots', (_req, res) => {
  res.json(recordSnapshot());
});

/** Get resource alerts */
router.get('/resources/alerts', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : undefined;
  res.json(getAlerts(limit));
});

/** Clear alerts */
router.delete('/resources/alerts', (_req, res) => {
  clearAlerts();
  res.json({ ok: true });
});

/** Get tracked processes */
router.get('/resources/processes', (_req, res) => {
  res.json(getTrackedProcesses());
});

/** Track a process */
router.post('/resources/processes', (req, res) => {
  const { pid, label, slug } = req.body;
  if (!pid) return res.status(400).json({ error: 'pid required' });
  trackProcess(pid, label || `Process ${pid}`, slug);
  res.status(201).json({ ok: true, pid });
});

/** Kill a tracked process */
router.delete('/resources/processes/:pid', (req, res) => {
  const pid = parseInt(req.params.pid);
  if (isNaN(pid)) return res.status(400).json({ error: 'invalid pid' });
  res.json(killProcess(pid));
});

/** Get resource limits for a project */
router.get('/projects/:slug/resources/limits', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getLimits(req.params.slug));
});

/** Set resource limits for a project */
router.put('/projects/:slug/resources/limits', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(setLimits(req.params.slug, req.body));
});

// ═════════════════════════════════════════════════════════════════
//  Diff Review (Phase 10.4)
// ═════════════════════════════════════════════════════════════════

/** List diffs for a project */
router.get('/projects/:slug/diffs', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { sessionId, status, file } = req.query;
  res.json(getDiffs(req.params.slug, { sessionId, status, file }));
});

/** Get review stats */
router.get('/projects/:slug/diffs/stats', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getReviewStats(req.params.slug));
});

/** Get single diff */
router.get('/projects/:slug/diffs/:diffId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const diff = getDiff(req.params.slug, req.params.diffId);
  if (!diff) return res.status(404).json({ error: 'Diff not found' });
  res.json(diff);
});

/** Add a diff */
router.post('/projects/:slug/diffs', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.status(201).json(addDiff(req.params.slug, req.body));
});

/** Review a hunk */
router.post('/projects/:slug/diffs/:diffId/hunks/:hunkId/review', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const result = reviewHunk(req.params.slug, req.params.diffId, req.params.hunkId, req.body.status, req.body.reviewer);
  if (!result) return res.status(404).json({ error: 'Diff or hunk not found' });
  res.json(result);
});

/** Bulk review all hunks */
router.post('/projects/:slug/diffs/:diffId/bulk-review', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const result = bulkReview(req.params.slug, req.params.diffId, req.body.status, req.body.reviewer);
  if (!result) return res.status(404).json({ error: 'Diff not found' });
  res.json(result);
});

/** Revert a diff */
router.post('/projects/:slug/diffs/:diffId/revert', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const result = revertDiff(req.params.slug, req.params.diffId);
  if (!result) return res.status(404).json({ error: 'Diff not found' });
  res.json(result);
});

/** Delete a diff */
router.delete('/projects/:slug/diffs/:diffId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const ok = removeDiff(req.params.slug, req.params.diffId);
  if (!ok) return res.status(404).json({ error: 'Diff not found' });
  res.json({ ok: true });
});

/** Clear all diffs */
router.delete('/projects/:slug/diffs', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  clearDiffs(req.params.slug);
  res.json({ ok: true });
});

// ─── Event Bus ─────────────────────────────────────────────────

/** Emit an event */
router.post('/events/emit', async (req, res) => {
  const { event, data } = req.body;
  if (!event) return res.status(400).json({ error: 'event is required' });
  const result = await emit(event, data || {});
  res.json(result);
});

/** Get event history */
router.get('/events/history', (req, res) => {
  const opts = {};
  if (req.query.event) opts.event = req.query.event;
  if (req.query.limit) opts.limit = parseInt(req.query.limit, 10);
  res.json(getEventHistory(opts));
});

/** Get event bus stats */
router.get('/events/stats', (req, res) => {
  res.json(getEventStats());
});

/** List registered events */
router.get('/events', (req, res) => {
  res.json({ events: listEvents(), wellKnown: EVENTS });
});

/** Clear event history */
router.delete('/events/history', (req, res) => {
  clearEventHistory();
  res.json({ ok: true });
});

// ─── Rate Limiting ─────────────────────────────────────────────

/** Get rate limits for a project */
router.get('/projects/:slug/rate-limits', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getRateLimits(req.params.slug));
});

/** Set rate limits for a project */
router.put('/projects/:slug/rate-limits', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(setRateLimits(req.params.slug, req.body));
});

/** Reset rate limits to defaults */
router.delete('/projects/:slug/rate-limits', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(resetRateLimits(req.params.slug));
});

/** Check rate for a key */
router.post('/rate/check', (req, res) => {
  const { key, limits } = req.body;
  if (!key) return res.status(400).json({ error: 'key is required' });
  res.json(checkRate(key, limits || {}));
});

/** Get status for a key */
router.get('/rate/status/:key', (req, res) => {
  res.json(getRateStatus(req.params.key));
});

/** Clear a specific rate bucket */
router.delete('/rate/buckets/:key', (req, res) => {
  clearBucket(req.params.key);
  res.json({ ok: true });
});

/** Clear all rate buckets */
router.delete('/rate/buckets', (req, res) => {
  clearAllBuckets();
  res.json({ ok: true });
});

/** List tracked rate keys */
router.get('/rate/keys', (req, res) => {
  res.json({ keys: listRateKeys() });
});

/** Get default rate limits */
router.get('/rate/defaults', (req, res) => {
  res.json(getRateDefaults());
});

// ─── Workspace Snapshots ───────────────────────────────────────

/** List snapshots */
router.get('/projects/:slug/snapshots', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const opts = {};
  if (req.query.limit) opts.limit = parseInt(req.query.limit, 10);
  if (req.query.auto !== undefined) opts.auto = req.query.auto === 'true';
  res.json(listSnapshots(req.params.slug, opts));
});

/** Create snapshot */
router.post('/projects/:slug/snapshots', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(createSnapshot(req.params.slug, req.body));
});

/** Get snapshot stats */
router.get('/projects/:slug/snapshots/stats', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getSnapshotStats(req.params.slug));
});

/** Diff two snapshots */
router.get('/projects/:slug/snapshots/diff', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { snap1, snap2 } = req.query;
  if (!snap1 || !snap2) return res.status(400).json({ error: 'snap1 and snap2 required' });
  const result = diffSnapshots(req.params.slug, snap1, snap2);
  if (!result) return res.status(404).json({ error: 'Snapshot not found' });
  res.json(result);
});

/** Get single snapshot */
router.get('/projects/:slug/snapshots/:snapId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const snap = getSnapshot(req.params.slug, req.params.snapId);
  if (!snap) return res.status(404).json({ error: 'Snapshot not found' });
  res.json(snap);
});

/** Update snapshot */
router.put('/projects/:slug/snapshots/:snapId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const snap = updateSnapshot(req.params.slug, req.params.snapId, req.body);
  if (!snap) return res.status(404).json({ error: 'Snapshot not found' });
  res.json(snap);
});

/** Restore snapshot */
router.post('/projects/:slug/snapshots/:snapId/restore', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const result = restoreSnapshot(req.params.slug, req.params.snapId);
  if (!result) return res.status(404).json({ error: 'Snapshot not found' });
  res.json(result);
});

/** Delete snapshot */
router.delete('/projects/:slug/snapshots/:snapId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const ok = deleteSnapshot(req.params.slug, req.params.snapId);
  if (!ok) return res.status(404).json({ error: 'Snapshot not found' });
  res.json({ ok: true });
});

/** Clear all snapshots */
router.delete('/projects/:slug/snapshots', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  clearSnapshots(req.params.slug);
  res.json({ ok: true });
});

// ─── Health Dashboard ───────────────────────────────────────────

/** Full health dashboard */
router.get('/health/dashboard', (req, res) => {
  res.json(getDashboard());
});

/** Uptime */
router.get('/health/uptime', (req, res) => {
  res.json(getUptime());
});

/** Health score */
router.get('/health/score', (req, res) => {
  res.json(getHealthScore());
});

/** Latency stats */
router.get('/health/latency', (req, res) => {
  const opts = {};
  if (req.query.endpoint) opts.endpoint = req.query.endpoint;
  if (req.query.windowMs) opts.windowMs = parseInt(req.query.windowMs, 10);
  res.json(getLatencyStats(opts));
});

/** Record latency */
router.post('/health/latency', (req, res) => {
  const { endpoint, ms } = req.body;
  if (!endpoint || typeof ms !== 'number') {
    return res.status(400).json({ error: 'endpoint and ms required' });
  }
  recordLatency(endpoint, ms);
  res.json({ ok: true });
});

/** Error stats */
router.get('/health/errors', (req, res) => {
  const opts = {};
  if (req.query.windowMs) opts.windowMs = parseInt(req.query.windowMs, 10);
  if (req.query.limit) opts.limit = parseInt(req.query.limit, 10);
  res.json(getErrorStats(opts));
});

/** Record error */
router.post('/health/errors', (req, res) => {
  const { message, endpoint } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  recordError(message, endpoint);
  res.json({ ok: true });
});

/** Clear errors */
router.delete('/health/errors', (req, res) => {
  clearErrors();
  res.json({ ok: true });
});

/** Backend health */
router.get('/health/backends', (req, res) => {
  res.json(getBackendHealth());
});

/** Record backend check */
router.post('/health/backends', (req, res) => {
  const { backend, available, latencyMs } = req.body;
  if (!backend || typeof available !== 'boolean') {
    return res.status(400).json({ error: 'backend and available required' });
  }
  recordBackendCheck(backend, available, latencyMs || 0);
  res.json({ ok: true });
});

/** Get thresholds */
router.get('/health/thresholds', (req, res) => {
  res.json(getThresholds());
});

/** Set thresholds */
router.put('/health/thresholds', (req, res) => {
  res.json(setThresholds(req.body));
});

/** Check thresholds */
router.get('/health/thresholds/check', (req, res) => {
  res.json(checkThresholds());
});

// ═══════════════════════════════════════════════════════════
//  Phase 11.1: Session Replay
// ═══════════════════════════════════════════════════════════

import { getReplay, getReplaySlice, getReplayStep, getTaskAgents, getReplayStepTypes } from '../services/sessionReplay.js';

/** Get full session replay */
router.get('/projects/:slug/sessions/:sessionId/replay', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const replay = getReplay(req.params.slug, req.params.sessionId);
  if (!replay) return res.status(404).json({ error: 'Session not found' });
  res.json(replay);
});

/** Get replay step slice (for timeline scrubbing) */
router.get('/projects/:slug/sessions/:sessionId/replay/slice', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const opts = {};
  if (req.query.from) opts.from = parseInt(req.query.from, 10);
  if (req.query.to) opts.to = parseInt(req.query.to, 10);
  if (req.query.type) opts.type = req.query.type;
  const result = getReplaySlice(req.params.slug, req.params.sessionId, opts);
  if (!result) return res.status(404).json({ error: 'Session not found' });
  res.json(result);
});

/** Get a single replay step by index */
router.get('/projects/:slug/sessions/:sessionId/replay/step/:index', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const step = getReplayStep(req.params.slug, req.params.sessionId, parseInt(req.params.index, 10));
  if (!step) return res.status(404).json({ error: 'Session not found' });
  res.json(step);
});

/** Get agent outputs for a specific task in replay */
router.get('/projects/:slug/sessions/:sessionId/replay/task/:taskId/agents', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const agents = getTaskAgents(req.params.slug, req.params.sessionId, req.params.taskId);
  if (!agents) return res.status(404).json({ error: 'Session not found' });
  res.json(agents);
});

/** Get available step types in a session replay */
router.get('/projects/:slug/sessions/:sessionId/replay/types', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const types = getReplayStepTypes(req.params.slug, req.params.sessionId);
  if (!types) return res.status(404).json({ error: 'Session not found' });
  res.json(types);
});

// ═══════════════════════════════════════════════════════════
//  Phase 11.2: Project Templates
// ═══════════════════════════════════════════════════════════

import { listProjectTemplates, getProjectTemplate, createProjectTemplate, deleteProjectTemplate, applyProjectTemplate, listTemplateCategories, listTemplateTags } from '../services/projectTemplates.js';

/** List project templates */
router.get('/project-templates', (req, res) => {
  const opts = {};
  if (req.query.category) opts.category = req.query.category;
  if (req.query.tag) opts.tag = req.query.tag;
  res.json(listProjectTemplates(opts));
});

/** Get a single project template */
router.get('/project-templates/:id', (req, res) => {
  const t = getProjectTemplate(req.params.id);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  res.json(t);
});

/** Create a custom project template */
router.post('/project-templates', (req, res) => {
  try {
    const t = createProjectTemplate(req.body);
    res.status(201).json(t);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Delete a custom project template */
router.delete('/project-templates/:id', (req, res) => {
  try {
    const removed = deleteProjectTemplate(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Template not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Apply a project template to a project */
router.post('/projects/:slug/apply-template', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const { templateId } = req.body;
  if (!templateId) return res.status(400).json({ error: 'templateId required' });
  try {
    const result = applyProjectTemplate(req.params.slug, templateId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** List template categories */
router.get('/project-template-categories', (_req, res) => {
  res.json(listTemplateCategories());
});

/** List template tags */
router.get('/project-template-tags', (_req, res) => {
  res.json(listTemplateTags());
});

// ═══════════════════════════════════════════════════════════
//  Phase 11.3: Collaboration
// ═══════════════════════════════════════════════════════════

import { listCollaborators, addCollaborator, removeCollaborator, getRole, hasAccess, getActivity, recordActivity, clearActivity, joinPresence, leavePresence, getPresence, heartbeat, getRoles } from '../services/collaboration.js';

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
