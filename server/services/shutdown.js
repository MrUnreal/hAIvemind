/**
 * Graceful shutdown service — Phase 6.8
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { MSG, makeMsg } from '../../shared/protocol.js';
import { sessions, activeContexts, refs } from '../state.js';
import { broadcastGlobal } from '../ws/broadcast.js';
import { releaseLock } from './sessions.js';
import log from '../logger.js';

export async function gracefulShutdown() {
  log.info('\n🛑 Graceful shutdown initiated...');
  const workspace = refs.workspace;

  // 1. Warn connected clients
  broadcastGlobal(makeMsg(MSG.SHUTDOWN_WARNING, { message: 'Server is shutting down', timestamp: Date.now() }));

  // 2. Persist all active (running) sessions to disk
  const interruptedDir = join(workspace.baseDir, '.haivemind', 'interrupted');
  await fs.mkdir(interruptedDir, { recursive: true }).catch(() => {});

  let savedCount = 0;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.status !== 'running') continue;

    try {
      session.status = 'interrupted';

      const incompleteTasks = session.plan?.tasks?.filter(t => t.status !== 'done' && t.status !== 'passed') || [];
      const snapshot = {
        sessionId,
        projectSlug: session.projectSlug,
        prompt: session.prompt || session.userPrompt || '',
        status: 'interrupted',
        interruptedAt: Date.now(),
        incompleteTasks: incompleteTasks.map(t => ({
          id: t.id,
          label: t.label,
          status: t.status,
          dependencies: t.dependencies,
        })),
        completedTasks: (session.plan?.tasks || [])
          .filter(t => t.status === 'done' || t.status === 'passed')
          .map(t => ({ id: t.id, label: t.label })),
        timeline: (session.timeline || []).slice(-100),
      };

      const filePath = join(interruptedDir, `${sessionId}.json`);
      await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2));
      savedCount++;
      log.info(`  💾 Saved interrupted session: ${sessionId.slice(0, 8)} (${incompleteTasks.length} incomplete tasks)`);

      if (session.workDir) {
        releaseLock(session.workDir, sessionId);
      }
    } catch (err) {
      log.error(`  ❌ Failed to save session ${sessionId.slice(0, 8)}: ${err.message}`);
    }
  }

  if (savedCount > 0) {
    log.info(`  📁 ${savedCount} session(s) saved to ${interruptedDir}`);
  }

  // 3. Kill all running agents
  const killPromises = [];
  for (const [, ctx] of activeContexts) {
    if (ctx.agentManager) {
      killPromises.push(ctx.agentManager.killAll());
    }
    if (ctx.taskRunner?.cleanup) {
      try { ctx.taskRunner.cleanup(); } catch { /* already cleaned */ }
    }
  }

  if (killPromises.length > 0) {
    log.info(`  🔪 Killing ${killPromises.length} agent manager(s)...`);
    await Promise.allSettled(killPromises);
  }

  // 4. Clear intervals
  clearInterval(refs.pruneIntervalId);
  clearInterval(refs.heartbeatInterval);
  if (refs.checkpointTimer) {
    clearInterval(refs.checkpointTimer.intervalId);
    await refs.checkpointTimer.flush().catch(() => {});
  }

  // 4.5 Notify plugins of shutdown
  if (refs.pluginManager) {
    await refs.pluginManager.emit('onShutdown').catch(() => {});
  }

  // 5. Close connections
  if (refs.wss) refs.wss.close();
  if (refs.server) {
    refs.server.close(() => {
      log.info('  ✅ Server shutdown complete\n');
      process.exit(0);
    });
  }

  // Force exit after 10 seconds if graceful close hangs
  setTimeout(() => {
    log.error('  ⚠️  Forced exit after timeout');
    process.exit(1);
  }, 10000).unref();
}
