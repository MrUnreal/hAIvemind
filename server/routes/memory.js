/**
 * Memory routes — agent memory, prompt suggestions.
 */
import { Router } from 'express';
import { refs } from '../state.js';
import {
  getMemories, getMemory, addMemory, updateMemory,
  removeMemory, touchMemory, recallMemories, getTags,
  clearMemories, getMemoryStats,
} from '../services/agentMemory.js';
import {
  getSuggestions, getCategories, getPromptHistory,
  recordPrompt, clearHistory,
} from '../services/promptSuggestions.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════
//  Agent Memory (Phase 10.1)
// ═══════════════════════════════════════════════════════════════════

/** List memories */
router.get('/projects/:slug/memory', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { type, search, limit, offset } = req.query;
  res.json(getMemories(req.params.slug, {
    type, search,
    limit: limit ? parseInt(limit) : undefined,
    offset: offset ? parseInt(offset) : undefined,
  }));
});

/** Get memory stats */
router.get('/projects/:slug/memory/stats', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getMemoryStats(req.params.slug));
});

/** Get memory tags */
router.get('/projects/:slug/memory/tags', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getTags(req.params.slug));
});

/** Recall relevant memories */
router.get('/projects/:slug/memory/recall', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { q, limit } = req.query;
  res.json(recallMemories(req.params.slug, q || '', limit ? parseInt(limit) : undefined));
});

/** Get single memory */
router.get('/projects/:slug/memory/:memId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const entry = getMemory(req.params.slug, req.params.memId);
  if (!entry) return res.status(404).json({ error: 'Memory not found' });
  res.json(entry);
});

/** Add memory */
router.post('/projects/:slug/memory', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const entry = addMemory(req.params.slug, req.body);
  res.status(201).json(entry);
});

/** Update memory */
router.patch('/projects/:slug/memory/:memId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const entry = updateMemory(req.params.slug, req.params.memId, req.body);
  if (!entry) return res.status(404).json({ error: 'Memory not found' });
  res.json(entry);
});

/** Touch memory (record access) */
router.post('/projects/:slug/memory/:memId/touch', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const entry = touchMemory(req.params.slug, req.params.memId);
  if (!entry) return res.status(404).json({ error: 'Memory not found' });
  res.json(entry);
});

/** Delete memory */
router.delete('/projects/:slug/memory/:memId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const ok = removeMemory(req.params.slug, req.params.memId);
  if (!ok) return res.status(404).json({ error: 'Memory not found' });
  res.json({ ok: true });
});

/** Clear all memories */
router.delete('/projects/:slug/memory', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  clearMemories(req.params.slug);
  res.json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════
//  Smart Prompt Suggestions (Phase 10.2)
// ═════════════════════════════════════════════════════════════════

/** Get smart suggestions */
router.get('/projects/:slug/suggestions', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { query, category, limit } = req.query;
  res.json(getSuggestions(req.params.slug, {
    query, category,
    limit: limit ? parseInt(limit) : undefined,
  }));
});

/** Get suggestion categories */
router.get('/projects/:slug/suggestions/categories', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getCategories());
});

/** Get prompt history */
router.get('/projects/:slug/suggestions/history', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const limit = req.query.limit ? parseInt(req.query.limit) : undefined;
  res.json(getPromptHistory(req.params.slug, limit));
});

/** Record a prompt */
router.post('/projects/:slug/suggestions/history', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { text, sessionId } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  res.status(201).json(recordPrompt(req.params.slug, text, sessionId));
});

/** Clear prompt history */
router.delete('/projects/:slug/suggestions/history', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  clearHistory(req.params.slug);
  res.json({ ok: true });
});


export default router;
