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

/** Phase 7.3: Full-text search across all sessions */
router.get('/sessions/search', (req, res) => {
  const q = req.query.q || '';
  const projectSlug = req.query.project || undefined;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  if (!q.trim()) {
    return res.json({ results: [], total: 0 });
  }

  const result = refs.workspace.searchSessions(q, { projectSlug, limit });
  res.json(result);
});

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
//  Phase 7.7: Session Export
// ═══════════════════════════════════════════════════════════

/** Export a session as JSON or Markdown */
router.get('/projects/:slug/sessions/:sessionId/export', (req, res) => {
  const session = refs.workspace.getSession(req.params.slug, req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const format = (req.query.format || 'json').toLowerCase();

  if (format === 'markdown' || format === 'md') {
    const md = sessionToMarkdown(session, req.params.slug);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="session-${session.id}.md"`);
    return res.send(md);
  }

  // Default: JSON export
  const exportData = {
    exported: new Date().toISOString(),
    project: req.params.slug,
    session: {
      id: session.id,
      prompt: session.prompt,
      status: session.status,
      createdAt: session.createdAt,
      completedAt: session.completedAt,
      tasks: (session.tasks || []).map(t => ({
        id: t.id,
        label: t.label,
        status: t.status,
        dependencies: t.dependencies,
      })),
      agents: Object.entries(session.agents || {}).map(([id, a]) => ({
        id,
        taskId: a.taskId,
        model: a.model,
        modelTier: a.modelTier,
        status: a.status,
        retries: a.retries,
      })),
      costSummary: session.costSummary || null,
      edges: session.edges || [],
    },
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="session-${session.id}.json"`);
  res.json(exportData);
});

/**
 * Convert a session to a Markdown report.
 * @param {object} session
 * @param {string} projectSlug
 * @returns {string}
 */
function sessionToMarkdown(session, projectSlug) {
  const lines = [];
  const status = session.status === 'completed' ? '✅ Completed' :
                 session.status === 'failed' ? '❌ Failed' :
                 session.status || 'unknown';
  const created = session.createdAt ? new Date(session.createdAt).toISOString() : 'N/A';
  const completed = session.completedAt ? new Date(session.completedAt).toISOString() : 'N/A';
  const duration = session.createdAt && session.completedAt
    ? Math.round((session.completedAt - session.createdAt) / 1000)
    : null;

  lines.push(`# Session Report`);
  lines.push('');
  lines.push(`**Project:** ${projectSlug}`);
  lines.push(`**Session ID:** ${session.id}`);
  lines.push(`**Status:** ${status}`);
  lines.push(`**Created:** ${created}`);
  lines.push(`**Completed:** ${completed}`);
  if (duration !== null) lines.push(`**Duration:** ${duration}s`);
  lines.push('');
  lines.push(`## Prompt`);
  lines.push('');
  lines.push(`> ${(session.prompt || '').replace(/\n/g, '\n> ')}`);
  lines.push('');

  // Tasks
  const tasks = session.tasks || [];
  if (tasks.length > 0) {
    lines.push(`## Tasks (${tasks.length})`);
    lines.push('');
    lines.push('| # | Task | Status | Dependencies |');
    lines.push('|---|------|--------|--------------|');
    tasks.forEach((t, i) => {
      const deps = Array.isArray(t.dependencies) && t.dependencies.length > 0
        ? t.dependencies.join(', ')
        : '—';
      const statusIcon = t.status === 'success' ? '✅' : t.status === 'failed' ? '❌' : '⬜';
      lines.push(`| ${i + 1} | ${t.label || t.id} | ${statusIcon} ${t.status || 'pending'} | ${deps} |`);
    });
    lines.push('');
  }

  // Agents
  const agents = session.agents || {};
  const agentEntries = Object.entries(agents);
  if (agentEntries.length > 0) {
    lines.push(`## Agents (${agentEntries.length})`);
    lines.push('');
    lines.push('| Agent | Task | Model | Tier | Status | Retries |');
    lines.push('|-------|------|-------|------|--------|---------|');
    for (const [id, a] of agentEntries) {
      const taskLabel = tasks.find(t => t.id === a.taskId)?.label || a.taskId || '—';
      lines.push(`| ${id.slice(0, 8)} | ${taskLabel} | ${a.model || '—'} | ${a.modelTier || '—'} | ${a.status || '—'} | ${a.retries || 0} |`);
    }
    lines.push('');
  }

  // Cost
  const cost = session.costSummary;
  if (cost) {
    lines.push(`## Cost Summary`);
    lines.push('');
    lines.push(`- **Total Premium Requests:** ${cost.totalPremiumRequests || 0}`);
    if (cost.byTier) {
      for (const [tier, data] of Object.entries(cost.byTier)) {
        lines.push(`- **${tier}:** ${data.count || 0} requests`);
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Exported from hAIvemind on ${new Date().toISOString()}*`);

  return lines.join('\n');
}

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

// ═══════════════════════════════════════════════════════════
//  Phase 8.0: Session Comparison
// ═══════════════════════════════════════════════════════════

/** Compare two sessions side-by-side */
router.get('/sessions/compare', (req, res) => {
  const { a, b, projectA, projectB } = req.query;
  if (!a || !b) return res.status(400).json({ error: 'Both session IDs (a, b) are required' });

  const slugA = projectA || req.query.project;
  const slugB = projectB || req.query.project;
  if (!slugA || !slugB) return res.status(400).json({ error: 'Project slug(s) required (project or projectA+projectB)' });

  const sessionA = refs.workspace.getSession(slugA, a);
  const sessionB = refs.workspace.getSession(slugB, b);
  if (!sessionA) return res.status(404).json({ error: `Session ${a} not found in ${slugA}` });
  if (!sessionB) return res.status(404).json({ error: `Session ${b} not found in ${slugB}` });

  res.json(compareSessions(sessionA, sessionB, slugA, slugB));
});

/**
 * Compare two sessions and produce a structured diff.
 * @param {object} a
 * @param {object} b
 * @param {string} slugA
 * @param {string} slugB
 * @returns {object}
 */
export function compareSessions(a, b, slugA, slugB) {
  const tasksA = a.tasks || [];
  const tasksB = b.tasks || [];
  const agentsA = Object.entries(a.agents || {});
  const agentsB = Object.entries(b.agents || {});

  // Task overlap analysis
  const labelsA = new Set(tasksA.map(t => t.label));
  const labelsB = new Set(tasksB.map(t => t.label));
  const sharedLabels = [...labelsA].filter(l => labelsB.has(l));
  const onlyA = [...labelsA].filter(l => !labelsB.has(l));
  const onlyB = [...labelsB].filter(l => !labelsA.has(l));

  // Cost comparison
  const costA = a.costSummary || {};
  const costB = b.costSummary || {};
  const premiumA = costA.totalPremiumRequests || 0;
  const premiumB = costB.totalPremiumRequests || 0;

  // Model usage comparison
  const modelsA = {};
  for (const [, ag] of agentsA) {
    const tier = ag.modelTier || 'unknown';
    modelsA[tier] = (modelsA[tier] || 0) + 1;
  }
  const modelsB = {};
  for (const [, ag] of agentsB) {
    const tier = ag.modelTier || 'unknown';
    modelsB[tier] = (modelsB[tier] || 0) + 1;
  }

  // Duration comparison
  const durationA = a.createdAt && a.completedAt ? a.completedAt - a.createdAt : null;
  const durationB = b.createdAt && b.completedAt ? b.completedAt - b.createdAt : null;

  return {
    sessions: {
      a: { id: a.id, project: slugA, prompt: a.prompt, status: a.status, createdAt: a.createdAt },
      b: { id: b.id, project: slugB, prompt: b.prompt, status: b.status, createdAt: b.createdAt },
    },
    tasks: {
      countA: tasksA.length,
      countB: tasksB.length,
      shared: sharedLabels,
      onlyA,
      onlyB,
      overlapPct: labelsA.size + labelsB.size > 0
        ? Math.round((sharedLabels.length * 2) / (labelsA.size + labelsB.size) * 100)
        : 0,
    },
    cost: {
      premiumA,
      premiumB,
      delta: premiumB - premiumA,
      byTierA: costA.byTier || {},
      byTierB: costB.byTier || {},
    },
    models: {
      a: modelsA,
      b: modelsB,
    },
    duration: {
      a: durationA,
      b: durationB,
      deltaMs: durationA != null && durationB != null ? durationB - durationA : null,
    },
    agents: {
      countA: agentsA.length,
      countB: agentsB.length,
    },
  };
}

export { sessionToMarkdown };
export default router;
