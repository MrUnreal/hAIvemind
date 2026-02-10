/**
 * Plugin routes — Phase 6.8
 */

import { Router } from 'express';
import { refs } from '../state.js';

const router = Router();

router.get('/plugins', (_req, res) => {
  res.json(refs.pluginManager.list());
});

router.post('/plugins/:name/enable', async (req, res) => {
  try {
    await refs.pluginManager.enable(req.params.name);
    res.json({ ok: true, name: req.params.name, enabled: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/plugins/:name/disable', async (req, res) => {
  try {
    await refs.pluginManager.disable(req.params.name);
    res.json({ ok: true, name: req.params.name, enabled: false });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/plugins/:name/reload', async (req, res) => {
  try {
    const entry = await refs.pluginManager.reload(req.params.name);
    res.json({ ok: true, name: entry.name, version: entry.version });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
