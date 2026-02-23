/**
 * Webhook routes — Phase 7.8, 11.0
 */
import { Router } from 'express';
import { refs } from '../state.js';
import {
  getWebhooks, getWebhook, addWebhook, removeWebhook, toggleWebhook,
  updateWebhook, testWebhook, getDeliveryHistory, getDeliveryStats,
  clearDeliveryHistory, computeSignature, verifySignature, WEBHOOK_EVENTS,
} from '../services/webhooks.js';

const router = Router();

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


export default router;
