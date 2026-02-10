/**
 * Health check route — Phase 6.8
 */

import { Router } from 'express';
import { sessions, clients, workDirLocks, refs } from '../state.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    sessions: sessions.size,
    projects: refs.workspace.listProjects().length,
    clients: clients.size,
    activeLocks: workDirLocks.size,
  });
});

export default router;
