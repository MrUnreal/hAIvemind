/**
 * Project routes — Phase 6.8
 * Project CRUD, skills, reflections, settings, workspace analysis.
 */

import { Router } from 'express';
import { MSG, makeMsg } from '../../shared/protocol.js';
import { refs } from '../state.js';
import { broadcast } from '../ws/broadcast.js';

const router = Router();

/** List all projects */
router.get('/projects', (req, res) => {
  res.json(refs.workspace.listProjects());
});

/** Get a single project */
router.get('/projects/:slug', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(project);
});

/** Create a new project */
router.post('/projects', (req, res) => {
  const { name, description, slug } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const project = refs.workspace.createProject(name, { description, slug });
    res.status(201).json(project);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

/** Link an existing directory as a project */
router.post('/projects/link', (req, res) => {
  const { name, directory } = req.body;
  if (!name || !directory) {
    return res.status(400).json({ error: 'Name and directory are required' });
  }
  try {
    const project = refs.workspace.linkProject(name, directory);
    res.status(201).json(project);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

/** Delete a project */
router.delete('/projects/:slug', (req, res) => {
  try {
    refs.workspace.deleteProject(req.params.slug);
    res.json({ deleted: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ── Skills ──

router.get('/projects/:slug/skills', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(refs.workspace.getSkills(req.params.slug));
});

router.put('/projects/:slug/skills', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const merged = refs.workspace.saveSkills(req.params.slug, req.body);
  broadcast(makeMsg(MSG.SKILLS_UPDATE, { projectSlug: req.params.slug, skills: merged }));
  res.json(merged);
});

// ── Reflections ──

router.get('/projects/:slug/reflections', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const limit = parseInt(req.query.limit) || 20;
  res.json(refs.workspace.getReflections(req.params.slug, limit));
});

// ── Settings ──

router.get('/projects/:slug/settings', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(refs.workspace.getProjectSettings(req.params.slug));
});

router.put('/projects/:slug/settings', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const updated = refs.workspace.updateProjectSettings(req.params.slug, req.body);
  broadcast(makeMsg(MSG.SETTINGS_UPDATE, { projectSlug: req.params.slug, settings: updated }));
  res.json(updated);
});

// ── Phase 7.6: Cost Analytics ──

router.get('/projects/:slug/cost-history', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const sessions = refs.workspace.listSessions(req.params.slug);
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);

  // Build per-session cost entries sorted newest-first, take limit
  const entries = sessions
    .filter(s => s.status === 'completed' || s.status === 'failed')
    .slice(0, limit)
    .map(s => {
      // Extract per-tier costs from agents
      const tierCounts = { T0: 0, T1: 0, T2: 0, T3: 0 };
      if (s.agents) {
        for (const agent of Object.values(s.agents)) {
          const tier = agent.modelTier || 'T0';
          tierCounts[tier] = (tierCounts[tier] || 0) + 1;
        }
      }
      // Also check costSummary.byTier if available
      if (s.costSummary?.byTier) {
        for (const [tier, data] of Object.entries(s.costSummary.byTier)) {
          if (data.count) tierCounts[tier] = data.count;
        }
      }

      return {
        sessionId: s.id,
        prompt: (s.prompt || '').slice(0, 80),
        status: s.status,
        createdAt: s.createdAt,
        totalCost: s.costSummary?.totalPremiumRequests || 0,
        tiers: tierCounts,
        taskCount: Array.isArray(s.tasks) ? s.tasks.length : 0,
      };
    })
    .reverse(); // chronological order for charting

  // Aggregate totals
  const totals = { T0: 0, T1: 0, T2: 0, T3: 0, total: 0 };
  for (const e of entries) {
    for (const [tier, count] of Object.entries(e.tiers)) {
      totals[tier] = (totals[tier] || 0) + count;
    }
    totals.total += e.totalCost;
  }

  res.json({ entries, totals, count: entries.length });
});

// ── Workspace Analysis ──

router.get('/projects/:slug/analysis', async (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    const { analyzeWorkspace } = await import('../workspaceAnalyzer.js');
    const analysis = await analyzeWorkspace(project.dir);
    res.json({
      summary: analysis.summary,
      fileTree: analysis.fileTree,
      techStack: analysis.techStack,
      entryPoints: analysis.entryPoints,
      dependencies: analysis.dependencies,
      conventions: analysis.conventions,
    });
  } catch (err) {
    res.status(500).json({ error: `Analysis failed: ${err.message}` });
  }
});

export default router;
