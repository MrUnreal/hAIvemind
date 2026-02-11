/**
 * Health check route — Phase 7.2 (enhanced)
 */

import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessions, clients, workDirLocks, refs } from '../state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const startTime = Date.now();

// Read version once at startup
let version = '0.0.0';
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
  version = pkg.version || version;
} catch { /* ignore */ }

const router = Router();

/** Basic health check — lightweight for load balancers */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    sessions: sessions.size,
    projects: refs.workspace.listProjects().length,
    clients: clients.size,
    activeLocks: workDirLocks.size,
  });
});

/** Detailed system info — for dashboards and debugging */
router.get('/health/details', (req, res) => {
  const mem = process.memoryUsage();
  const projectList = refs.workspace.listProjects();

  // Per-project session counts
  const projectStats = projectList.map(p => ({
    slug: p.slug,
    name: p.name,
    sessions: refs.workspace.listSessions(p.slug).length,
    linked: !!p.dir,
  }));

  res.json({
    status: 'ok',
    version,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    startedAt: new Date(startTime).toISOString(),
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    memory: {
      rss: Math.round(mem.rss / 1048576),
      heapUsed: Math.round(mem.heapUsed / 1048576),
      heapTotal: Math.round(mem.heapTotal / 1048576),
      external: Math.round(mem.external / 1048576),
      unit: 'MB',
    },
    runtime: {
      sessions: sessions.size,
      clients: clients.size,
      activeLocks: workDirLocks.size,
      projectCount: projectList.length,
    },
    projects: projectStats,
  });
});

export default router;
