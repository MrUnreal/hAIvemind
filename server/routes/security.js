/**
 * Security routes — API keys, rate limiting.
 */
import { Router } from 'express';
import { refs } from '../state.js';
import {
  getApiKeys, addApiKey, removeApiKey, rotateApiKey, toggleApiKey,
} from '../services/apiKeys.js';
import {
  getLimits as getRateLimits, setLimits as setRateLimits, resetLimits as resetRateLimits,
  checkRate, getStatus as getRateStatus, clearBucket, clearAll as clearAllBuckets,
  listKeys as listRateKeys, getDefaults as getRateDefaults,
} from '../services/rateLimiter.js';

const router = Router();

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


export default router;
