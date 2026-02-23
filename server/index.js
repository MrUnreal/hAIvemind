/**
 * hAIvemind — AI Orchestrator Server
 *
 * Thin wiring: imports modules, creates singletons, mounts routes,
 * starts WS/HTTP, and registers shutdown handlers.
 *
 * All business logic lives in:
 *   routes/    — Express route handlers
 *   services/  — Session orchestration, analysis, recovery, shutdown
 *   ws/        — WebSocket setup, broadcast, message handling
 *   state.js   — Shared mutable state
 */

import express from 'express';
import { createServer } from 'node:http';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import config from './config.js';
import { makeMsg } from '../shared/protocol.js';
import WorkspaceManager from './workspace.js';
import PluginManager from './pluginManager.js';
import log from './logger.js';
import { startCheckpointTimer } from './sessionCheckpoint.js';
import { createSwarm } from './swarm/index.js';

// ── State ──
import { sessions, refs } from './state.js';

// ── Routes ──
import healthRouter from './routes/health.js';
import projectsRouter from './routes/projects.js';
import sessionsRouter from './routes/sessions.js';
import templatesRouter from './routes/templates.js';
import backendsRouter from './routes/backends.js';
import pluginsRouter from './routes/plugins.js';
import autopilotRouter from './routes/autopilot.js';
import authRouter from './routes/auth.js';

// ── WebSocket ──
import { createWss } from './ws/setup.js';

// ── Services ──
import { recoverInterruptedSessions, recoverFromCheckpoints } from './services/recovery.js';
import { gracefulShutdown } from './services/shutdown.js';
import { pruneCompletedSessions } from './services/sessions.js';
import { cleanupExpiredTokens } from './services/auth.js';
import { pruneStale as pruneRateBuckets } from './services/rateLimiter.js';
import { broadcast } from './ws/broadcast.js';

// ── Paths ──
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Singletons ──
const DEMO = process.env.DEMO === '1' || process.argv.includes('--mock');
const workspace = new WorkspaceManager();
const app = express();
app.use(express.json());
const server = createServer(app);

// ── WebSocket server ──
const { wss, heartbeatInterval } = createWss(server);

// ── Plugin Manager ──
const pluginManager = new PluginManager({
  pluginsDir: resolve(process.cwd(), config.plugins?.dir || 'plugins'),
  config,
  broadcast,
  makeMsg,
  workspace,
});
export { pluginManager };

// ── Swarm ──
let swarmInstance = config.swarm?.enabled ? createSwarm(config.swarm) : null;

// ── Populate shared refs (read at call time by all modules) ──
refs.workspace = workspace;
refs.server = server;
refs.wss = wss;
refs.DEMO = DEMO;
refs.TEMPLATES_DIR = join(__dirname, '..', 'templates');
refs.heartbeatInterval = heartbeatInterval;
refs.pluginManager = pluginManager;
refs.swarmInstance = swarmInstance;

// ── Mount API routes ──
app.use('/api', healthRouter);
app.use('/api', projectsRouter);
app.use('/api', sessionsRouter);
app.use('/api', templatesRouter);
app.use('/api', backendsRouter);
app.use('/api', pluginsRouter);
app.use('/api', autopilotRouter);
app.use('/api', authRouter);

// ── Global Express error handler (must be after all routes) ──
app.use((err, _req, res, _next) => {
  log.error(`[server] Unhandled route error: ${err?.message || err}`);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Serve built client in production ──
const clientDist = join(__dirname, '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/ws).*/, (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });
  log.info('[server] Serving built client from client/dist/');
}

// ── Start ──
server.listen(config.port, () => {
  const projects = workspace.listProjects();
  log.info(`\n🐝 hAIvemind server running on http://localhost:${config.port}`);
  if (DEMO) log.info('   ⚡ DEMO MODE — using mock agents');
  log.info(`   WebSocket: ws://localhost:${config.port}/ws`);
  log.info(`   Orchestrator: ${config.tierDefaults[config.orchestratorTier]} (${config.orchestratorTier})`);
  log.info(`   Escalation:   ${config.escalation.join(' → ')}`);
  log.info(`   Projects:     ${projects.length} registered`);
  if (projects.length) {
    for (const p of projects) {
      log.info(`     • ${p.slug} — ${p.name}${p.linked ? ' (linked)' : ''}`);
    }
  }
  log.info();

  // Load plugins at startup
  if (config.plugins?.autoLoad !== false) {
    pluginManager.loadAll().catch(err => {
      log.warn(`[plugins] Auto-load failed: ${err.message}`);
    });
  }
});

// ── Intervals ──
refs.pruneIntervalId = setInterval(pruneCompletedSessions, 5 * 60 * 1000);
refs.tokenCleanupId = setInterval(cleanupExpiredTokens, 60 * 60 * 1000); // hourly
refs.rateBucketPruneId = setInterval(pruneRateBuckets, 10 * 60 * 1000); // every 10 min
const checkpointTimer = startCheckpointTimer(sessions, workspace, 30000);
refs.checkpointTimer = checkpointTimer;

// ── Recovery ──
recoverInterruptedSessions();
recoverFromCheckpoints();

// ── Graceful shutdown ──
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// ── Crash-safety handlers ──
process.on('unhandledRejection', (err) => {
  log.error(`[server] Unhandled rejection: ${err?.message || err}`);
});
process.on('uncaughtException', (err) => {
  log.error(`[server] Uncaught exception: ${err?.message || err}`);
  gracefulShutdown();
});
