/**
 * Session routes — Phase 6.8
 * Session list, get, summaries, rollback, diff, REST start.
 */

import { Router } from 'express';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { MSG, makeMsg } from '../../shared/protocol.js';
import { summarizeOutput } from '../outputSummarizer.js';
import { rollbackToSnapshot, getSnapshotDiff } from '../snapshot.js';
import { readAllCheckpoints } from '../sessionCheckpoint.js';
import { workDirLocks, refs } from '../state.js';
import { broadcast } from '../ws/broadcast.js';
import { startSession } from '../services/sessions.js';
import log from '../logger.js';

const router = Router();

/** List sessions for a project */
router.get('/projects/:slug/sessions', (req, res) => {
  const sessionList = refs.workspace.listSessions(req.params.slug);
  res.json(sessionList.map(s => {
    const agentCount = s.agents ? Object.keys(s.agents).length : 0;
    const totalCost = s.costSummary?.totalPremiumRequests || 0;
    const taskSummary = Array.isArray(s.tasks)
      ? s.tasks.map(t => {
          let status = 'pending';
          if (s.agents) {
            const agents = Object.values(s.agents).filter(a => a.taskId === t.id);
            if (agents.length > 0) {
              const latest = agents.sort((a, b) => (b.retries || 0) - (a.retries || 0))[0];
              status = latest.status || 'pending';
            }
          }
          return { label: t.label, status };
        })
      : [];

    return {
      id: s.id,
      prompt: s.prompt,
      status: s.status,
      startedAt: s.createdAt,
      completedAt: s.completedAt,
      costSummary: s.costSummary,
      taskCount: Array.isArray(s.tasks) ? s.tasks.length : 0,
      agentCount,
      totalCost,
      taskSummary,
    };
  }));
});

/** Get a single session with full data */
router.get('/projects/:slug/sessions/:sessionId', (req, res) => {
  const session = refs.workspace.getSession(req.params.slug, req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

/** Phase 5.1: Get per-task output summaries */
router.get('/projects/:slug/sessions/:sessionId/summaries', (req, res) => {
  const session = refs.workspace.getSession(req.params.slug, req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const taskSummaries = {};
  const agents = session.agents || {};

  for (const [agentId, agent] of Object.entries(agents)) {
    const taskId = agent.taskId;
    if (!taskId) continue;

    const summary = agent.summary || (agent.output?.length > 0 ? summarizeOutput(agent.output) : null);

    if (!taskSummaries[taskId]) {
      taskSummaries[taskId] = {
        taskId,
        taskLabel: (session.tasks || []).find(t => t.id === taskId)?.label || taskId,
        agents: [],
      };
    }

    taskSummaries[taskId].agents.push({
      agentId,
      model: agent.model,
      modelTier: agent.modelTier,
      status: agent.status,
      retries: agent.retries,
      summary,
    });
  }

  res.json(Object.values(taskSummaries));
});

/** Phase 5.2: Rollback a session's workspace changes */
router.post('/projects/:slug/sessions/:sessionId/rollback', async (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const session = refs.workspace.getSession(req.params.slug, req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (!session.snapshot || session.snapshot.type === 'none') {
    return res.status(400).json({ error: 'No snapshot available for this session' });
  }

  const workDir = project.dir;
  const lockEntry = workDirLocks.get(workDir);
  if (lockEntry) {
    return res.status(409).json({ error: 'Cannot rollback while a session is running on this workspace' });
  }

  const result = await rollbackToSnapshot(workDir, session.snapshot);
  if (result.success) {
    res.json({ rolledBack: true, message: result.message });
  } else {
    res.status(500).json({ error: result.message });
  }
});

/** Phase 5.2 + 6.4: Get diff between pre-session snapshot and current state */
router.get('/projects/:slug/sessions/:sessionId/diff', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const session = refs.workspace.getSession(req.params.slug, req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (!session.snapshot || session.snapshot.type !== 'git-tag') {
    return res.json({ files: [], summary: 'No git snapshot available for diff' });
  }

  const patches = req.query.patches === 'true';
  const diff = getSnapshotDiff(project.dir, session.snapshot, { patches });
  res.json(diff || { files: [], summary: 'Unable to compute diff' });
});

/** Start a session (REST fallback for non-WS clients) */
router.post('/projects/:slug/sessions', async (req, res) => {
  const { prompt, templateId } = req.body;
  if (!prompt && !templateId) return res.status(400).json({ error: 'No prompt provided' });
  startSession(prompt || `Build from template: ${templateId}`, req.params.slug);
  res.json({ status: 'started', project: req.params.slug });
});

// ═══════════════════════════════════════════════════════════
//  Session Checkpoints (Phase 6.7)
// ═══════════════════════════════════════════════════════════

/** Get all session checkpoints (crash-recovery data) */
router.get('/checkpoints', async (_req, res) => {
  try {
    const checkpoints = await readAllCheckpoints(refs.workspace);
    res.json(checkpoints);
  } catch (err) {
    res.status(500).json({ error: `Failed to read checkpoints: ${err.message}` });
  }
});

// ═══════════════════════════════════════════════════════════
//  Interrupted Sessions (Phase 5.0)
// ═══════════════════════════════════════════════════════════

/** List all interrupted sessions */
router.get('/interrupted-sessions', async (req, res) => {
  try {
    const interruptedDir = join(refs.workspace.baseDir, '.haivemind', 'interrupted');
    const files = await fs.readdir(interruptedDir).catch(() => []);
    const results = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(join(interruptedDir, file), 'utf-8');
        results.push(JSON.parse(raw));
      } catch { /* skip */ }
    }
    res.json(results);
  } catch {
    res.json([]);
  }
});

/** Discard an interrupted session */
router.post('/interrupted-sessions/:id/discard', async (req, res) => {
  try {
    const interruptedDir = join(refs.workspace.baseDir, '.haivemind', 'interrupted');
    const filePath = join(interruptedDir, `${req.params.id}.json`);
    await fs.unlink(filePath);
    res.json({ discarded: true });
  } catch (err) {
    res.status(404).json({ error: 'Interrupted session not found' });
  }
});

/** Resume an interrupted session */
router.post('/interrupted-sessions/:id/resume', async (req, res) => {
  try {
    const interruptedDir = join(refs.workspace.baseDir, '.haivemind', 'interrupted');
    const filePath = join(interruptedDir, `${req.params.id}.json`);
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);

    await fs.unlink(filePath).catch(() => {});

    const incompleteTasks = data.incompleteTasks || [];
    if (incompleteTasks.length === 0) {
      return res.json({ resumed: false, reason: 'No incomplete tasks' });
    }

    const resumePrompt = `Resume interrupted session: ${data.prompt}\n\nThe following tasks were incomplete and need to be re-executed:\n${incompleteTasks.map(t => `- ${t.label} (was: ${t.status})`).join('\n')}`;

    broadcast(makeMsg(MSG.SESSION_RESUMED, { originalSessionId: data.sessionId, projectSlug: data.projectSlug }));

    startSession(resumePrompt, data.projectSlug).catch(err => {
      log.error(`[recovery] Failed to resume session ${data.sessionId}: ${err.message}`);
    });

    res.json({ resumed: true, projectSlug: data.projectSlug, incompleteTasks: incompleteTasks.length });
  } catch (err) {
    res.status(404).json({ error: 'Interrupted session not found' });
  }
});

export default router;
