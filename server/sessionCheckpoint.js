/**
 * Session Checkpoint Middleware — Phase 6.7
 *
 * Periodically serializes in-flight session state to disk so that
 * crash recovery (kill -9, OOM) is possible, not just graceful SIGTERM.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import log from './logger.js';

const CHECKPOINT_DIR_NAME = 'checkpoints';

/**
 * Get the checkpoint directory for a project.
 * @param {string} projectDir - Absolute path to the project directory
 * @returns {string}
 */
function checkpointDir(projectDir) {
  return join(projectDir, '.haivemind', CHECKPOINT_DIR_NAME);
}

/**
 * Write a checkpoint for one running session.
 * @param {string} sessionId
 * @param {object} session - The session Map entry
 * @param {string} projectDir - The project's root directory
 */
export async function writeCheckpoint(sessionId, session, projectDir) {
  if (!session || !projectDir) return;

  const dir = checkpointDir(projectDir);
  await fs.mkdir(dir, { recursive: true });

  const checkpoint = {
    sessionId,
    projectSlug: session.projectSlug,
    status: session.status,
    prompt: session.prompt || session.userPrompt || '',
    checkpointedAt: Date.now(),
    startedAt: session.startedAt || null,
    workDir: session.workDir,
    snapshot: session.snapshot || null,
    plan: session.plan ? {
      tasks: (session.plan.tasks || []).map(t => ({
        id: t.id,
        label: t.label,
        status: t.status,
        dependencies: t.dependencies,
      })),
    } : null,
    timeline: (session.timeline || []).slice(-200), // Last 200 events
  };

  const filePath = join(dir, `${sessionId}.json`);
  await fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2));
}

/**
 * Delete a checkpoint (session completed or failed).
 * @param {string} sessionId
 * @param {string} projectDir
 */
export async function deleteCheckpoint(sessionId, projectDir) {
  if (!projectDir) return;
  try {
    const filePath = join(checkpointDir(projectDir), `${sessionId}.json`);
    await fs.unlink(filePath);
  } catch {
    // File may not exist — that's fine
  }
}

/**
 * Read all checkpoint files across all projects.
 * @param {object} workspace - The WorkspaceManager instance
 * @returns {Promise<object[]>} Array of checkpoint data objects
 */
export async function readAllCheckpoints(workspace) {
  const results = [];
  for (const project of workspace.listProjects()) {
    const dir = checkpointDir(project.dir);
    let files;
    try {
      files = await fs.readdir(dir);
    } catch {
      continue; // No checkpoint dir for this project — skip
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(join(dir, file), 'utf-8');
        results.push(JSON.parse(raw));
      } catch {
        // Skip corrupt checkpoint files
      }
    }
  }
  return results;
}

/**
 * Flush checkpoints for all running sessions.
 * @param {Map} sessions - The sessions Map
 * @param {object} workspace - The WorkspaceManager instance
 */
export async function flushAllCheckpoints(sessions, workspace) {
  const promises = [];
  for (const [sessionId, session] of sessions.entries()) {
    if (session.status !== 'running') continue;
    const project = workspace.getProject(session.projectSlug);
    if (!project) continue;
    promises.push(
      writeCheckpoint(sessionId, session, project.dir).catch(err => {
        log.warn(`[checkpoint] Failed to write checkpoint for ${sessionId.slice(0, 8)}: ${err.message}`);
      })
    );
  }
  await Promise.allSettled(promises);
}

/**
 * Start the periodic checkpoint timer.
 * @param {Map} sessions
 * @param {object} workspace
 * @param {number} [intervalMs=30000]
 * @returns {{ intervalId: NodeJS.Timer, flush: () => Promise<void> }}
 */
export function startCheckpointTimer(sessions, workspace, intervalMs = 30000) {
  const flush = () => flushAllCheckpoints(sessions, workspace);
  const intervalId = setInterval(flush, intervalMs);
  return { intervalId, flush };
}
