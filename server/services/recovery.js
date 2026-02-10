/**
 * Session recovery services — Phase 6.8
 * Startup recovery from interrupted sessions and crash-orphaned checkpoints.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { readAllCheckpoints, deleteCheckpoint } from '../sessionCheckpoint.js';
import { refs } from '../state.js';
import log from '../logger.js';

/**
 * Recover interrupted sessions from the interrupted/ directory.
 */
export async function recoverInterruptedSessions() {
  const workspace = refs.workspace;
  try {
    const interruptedDir = join(workspace.baseDir, '.haivemind', 'interrupted');
    const files = await fs.readdir(interruptedDir).catch(() => []);
    if (files.length > 0) {
      log.info(`[recovery] Found ${files.length} interrupted session(s)`);
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(join(interruptedDir, file), 'utf-8');
        const data = JSON.parse(raw);
        log.info(`  ↳ ${data.sessionId?.slice(0, 8)} (${data.projectSlug}) — ${data.incompleteTasks?.length || 0} incomplete tasks`);
      } catch { /* skip corrupt files */ }
    }
  } catch { /* no interrupted dir, fine */ }
}

/**
 * Recover crash-orphaned sessions from checkpoint files.
 * Moves running checkpoints to the interrupted/ directory for standard recovery flow.
 */
export async function recoverFromCheckpoints() {
  const workspace = refs.workspace;
  try {
    const checkpoints = await readAllCheckpoints(workspace);
    const orphaned = checkpoints.filter(cp => cp.status === 'running');
    if (orphaned.length > 0) {
      log.info(`[checkpoint] Found ${orphaned.length} crash-orphaned session(s) from checkpoints`);
      const interruptedDir = join(workspace.baseDir, '.haivemind', 'interrupted');
      await fs.mkdir(interruptedDir, { recursive: true }).catch(() => {});
      for (const cp of orphaned) {
        const filePath = join(interruptedDir, `${cp.sessionId}.json`);
        const interrupted = {
          sessionId: cp.sessionId,
          projectSlug: cp.projectSlug,
          prompt: cp.prompt,
          status: 'interrupted',
          interruptedAt: cp.checkpointedAt,
          incompleteTasks: (cp.plan?.tasks || []).filter(t => t.status !== 'done' && t.status !== 'passed').map(t => ({
            id: t.id, label: t.label, status: t.status, dependencies: t.dependencies,
          })),
          completedTasks: (cp.plan?.tasks || []).filter(t => t.status === 'done' || t.status === 'passed').map(t => ({
            id: t.id, label: t.label,
          })),
          timeline: cp.timeline || [],
        };
        await fs.writeFile(filePath, JSON.stringify(interrupted, null, 2)).catch(() => {});
        const project = workspace.getProject(cp.projectSlug);
        if (project) await deleteCheckpoint(cp.sessionId, project.dir).catch(() => {});
        log.info(`  ↳ Recovered ${cp.sessionId?.slice(0, 8)} (${cp.projectSlug}) from checkpoint`);
      }
    }
  } catch { /* no checkpoints, fine */ }
}
