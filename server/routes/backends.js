/**
 * Backend & Swarm routes — Phase 6.8
 */

import { Router } from 'express';
import config from '../config.js';
import { listBackends } from '../backends/index.js';
import { createSwarm } from '../swarm/index.js';
import { refs } from '../state.js';

const router = Router();

router.get('/backends', (_req, res) => {
  const names = listBackends();
  const result = names.map(name => ({
    name,
    active: name === config.defaultBackend,
    config: config.backends?.[name] || {},
  }));
  res.json(result);
});

router.get('/backends/active', (_req, res) => {
  res.json({ name: config.defaultBackend });
});

router.put('/backends/active', (req, res) => {
  const { name } = req.body || {};
  if (!name || !listBackends().includes(name)) {
    return res.status(400).json({ error: `Unknown backend: "${name}". Available: ${listBackends().join(', ')}` });
  }
  config.defaultBackend = name;
  res.json({ ok: true, name });
});

router.get('/backends/:name', (req, res) => {
  const { name } = req.params;
  if (!listBackends().includes(name)) {
    return res.status(404).json({ error: `Backend "${name}" not found` });
  }
  res.json({ name, config: config.backends?.[name] || {} });
});

router.put('/backends/:name', (req, res) => {
  const { name } = req.params;
  if (!listBackends().includes(name)) {
    return res.status(404).json({ error: `Backend "${name}" not found` });
  }
  if (!config.backends) config.backends = {};
  config.backends[name] = { ...(config.backends[name] || {}), ...(req.body || {}) };
  res.json({ ok: true, name, config: config.backends[name] });
});

// ── Swarm ──

router.get('/swarm', (_req, res) => {
  res.json({
    enabled: !!config.swarm?.enabled,
    totalCapacity: refs.swarmInstance?.totalCapacity() ?? 0,
    runners: refs.swarmInstance?.runners.map((r, i) => ({
      index: i,
      type: r.type,
      capacity: r.capacity(),
    })) ?? [],
    description: refs.swarmInstance?.describe() ?? 'disabled',
  });
});

router.put('/swarm', (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled === 'boolean') {
    if (!config.swarm) config.swarm = { enabled: false, runners: [] };
    config.swarm.enabled = enabled;
    if (enabled && !refs.swarmInstance) {
      refs.swarmInstance = createSwarm(config.swarm);
    } else if (!enabled) {
      refs.swarmInstance = null;
    }
  }
  res.json({
    ok: true,
    enabled: !!config.swarm?.enabled,
    totalCapacity: refs.swarmInstance?.totalCapacity() ?? 0,
  });
});

router.get('/swarm/runners', (_req, res) => {
  if (!refs.swarmInstance) return res.json([]);
  res.json(refs.swarmInstance.runners.map((r, i) => ({
    index: i,
    type: r.type,
    capacity: r.capacity(),
  })));
});

export default router;
