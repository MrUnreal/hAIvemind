/**
 * Event bus routes.
 */
import { Router } from 'express';
import {
  emit, getHistory as getEventHistory, clearHistory as clearEventHistory,
  getStats as getEventStats, listEvents, EVENTS,
} from '../services/eventBus.js';

const router = Router();

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


export default router;
