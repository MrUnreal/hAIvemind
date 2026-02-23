/**
 * Agent config routes — cost budgets, global search, agent profiles, dashboard widgets.
 */
import { Router } from 'express';
import { refs } from '../state.js';
import {
  getBudget, setBudget, clearBudget, recordSpend, getSpendLog, clearSpendLog,
  getCurrentSpend, getAlerts as getBudgetAlerts, clearAlerts as clearBudgetAlerts,
  forecast, checkBudgetPermission, BUDGET_PERIODS,
} from '../services/costBudgets.js';
import {
  search, listSavedSearches, saveSearch, deleteSavedSearch, SEARCH_TYPES,
} from '../services/globalSearch.js';
import {
  createProfile, listProfiles, getProfile, updateProfile,
  deleteProfile, cloneProfile, getDefaultProfile, getProfileStats,
  PROFILE_ROLES, MODEL_TIERS,
} from '../services/agentProfiles.js';
import {
  createWidget, listWidgets, getWidget, updateWidget, deleteWidget,
  getLayout, updateLayout, getWidgetData, getDashboardStats,
  WIDGET_TYPES, WIDGET_SIZES,
} from '../services/dashboardWidgets.js';

const router = Router();

// ─── Phase 11.7: Cost Budgets ────────────────────────────────────────────

/** Get project budget */
router.get('/projects/:slug/budget', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getBudget(req.params.slug));
});

/** Set project budget */
router.put('/projects/:slug/budget', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  try {
    const budget = setBudget(req.params.slug, req.body);
    res.json(budget);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Clear project budget */
router.delete('/projects/:slug/budget', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(clearBudget(req.params.slug));
});

/** Get current spend for active period */
router.get('/projects/:slug/budget/spend', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getCurrentSpend(req.params.slug));
});

/** Record a spend entry */
router.post('/projects/:slug/budget/spend', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const { amount } = req.body;
  if (typeof amount !== 'number') return res.status(400).json({ error: 'amount must be a number' });
  const entry = recordSpend(req.params.slug, req.body);
  res.status(201).json(entry);
});

/** Get spend log */
router.get('/projects/:slug/budget/log', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const opts = {};
  if (req.query.since) opts.since = parseInt(req.query.since, 10);
  if (req.query.limit) opts.limit = parseInt(req.query.limit, 10);
  res.json(getSpendLog(req.params.slug, opts));
});

/** Clear spend log */
router.delete('/projects/:slug/budget/log', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(clearSpendLog(req.params.slug));
});

/** Get budget alerts */
router.get('/projects/:slug/budget/alerts', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getBudgetAlerts(req.params.slug));
});

/** Clear budget alerts */
router.delete('/projects/:slug/budget/alerts', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(clearBudgetAlerts(req.params.slug));
});

/** Get spend forecast */
router.get('/projects/:slug/budget/forecast', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(forecast(req.params.slug));
});

/** Check budget permission (can a session start?) */
router.get('/projects/:slug/budget/check', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(checkBudgetPermission(req.params.slug));
});

/** List valid budget periods */
router.get('/budget-periods', (_req, res) => {
  res.json(BUDGET_PERIODS);
});

// ─── Phase 11.8: Search & Filter ─────────────────────────────────────────

/** Global search across project data */
router.get('/projects/:slug/search', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const opts = {
    q: req.query.q || '',
    types: req.query.types ? req.query.types.split(',') : undefined,
    since: req.query.since ? parseInt(req.query.since, 10) : undefined,
    until: req.query.until ? parseInt(req.query.until, 10) : undefined,
    limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
  };
  res.json(search(req.params.slug, opts));
});

/** List saved searches */
router.get('/projects/:slug/saved-searches', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(listSavedSearches(req.params.slug));
});

/** Save a search */
router.post('/projects/:slug/saved-searches', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (!req.body.q && !req.body.name) return res.status(400).json({ error: 'Missing q or name' });
  const saved = saveSearch(req.params.slug, req.body);
  res.status(201).json(saved);
});

/** Delete a saved search */
router.delete('/projects/:slug/saved-searches/:searchId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const removed = deleteSavedSearch(req.params.slug, req.params.searchId);
  if (!removed) return res.status(404).json({ error: 'Saved search not found' });
  res.json({ ok: true });
});

/** List searchable types */
router.get('/search-types', (_req, res) => {
  res.json(SEARCH_TYPES);
});


// ─── Phase 12.7 — Agent Profiles ─────────────────────────────────────────

/** Create an agent profile */
router.post('/projects/:slug/agent-profiles', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  try {
    const prof = createProfile(req.params.slug, req.body);
    res.status(201).json(prof);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** List agent profiles */
router.get('/projects/:slug/agent-profiles', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(listProfiles(req.params.slug, req.query));
});

/** Get default profile for a role (before :profId to avoid matching "default") */
router.get('/projects/:slug/agent-profiles/default/:role', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const prof = getDefaultProfile(req.params.slug, req.params.role);
  if (!prof) return res.status(404).json({ error: 'No default profile for this role' });
  res.json(prof);
});

/** Get a single agent profile */
router.get('/projects/:slug/agent-profiles/:profId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const prof = getProfile(req.params.slug, req.params.profId);
  if (!prof) return res.status(404).json({ error: 'Profile not found' });
  res.json(prof);
});

/** Update an agent profile */
router.patch('/projects/:slug/agent-profiles/:profId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const prof = updateProfile(req.params.slug, req.params.profId, req.body);
  if (!prof) return res.status(404).json({ error: 'Profile not found' });
  res.json(prof);
});

/** Delete an agent profile */
router.delete('/projects/:slug/agent-profiles/:profId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const removed = deleteProfile(req.params.slug, req.params.profId);
  if (!removed) return res.status(404).json({ error: 'Profile not found' });
  res.json(removed);
});

/** Clone an agent profile */
router.post('/projects/:slug/agent-profiles/:profId/clone', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const cloned = cloneProfile(req.params.slug, req.params.profId, req.body.name);
  if (!cloned) return res.status(404).json({ error: 'Profile not found' });
  res.status(201).json(cloned);
});

/** Agent profile stats */
router.get('/projects/:slug/agent-profile-stats', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getProfileStats(req.params.slug));
});

/** Available profile roles */
router.get('/profile-roles', (_req, res) => { res.json(PROFILE_ROLES); });

/** Available model tiers */
router.get('/model-tiers', (_req, res) => { res.json(MODEL_TIERS); });

// ── Phase 12.8 — Dashboard Widgets ──────────────────────────────────────

/** Create widget */
router.post('/projects/:slug/dashboard/widgets', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  try {
    const w = createWidget(req.params.slug, req.body);
    res.status(201).json(w);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** List widgets */
router.get('/projects/:slug/dashboard/widgets', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(listWidgets(req.params.slug));
});

/** Get single widget */
router.get('/projects/:slug/dashboard/widgets/:wid', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const w = getWidget(req.params.slug, req.params.wid);
  if (!w) return res.status(404).json({ error: 'Widget not found' });
  res.json(w);
});

/** Update widget */
router.patch('/projects/:slug/dashboard/widgets/:wid', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const w = updateWidget(req.params.slug, req.params.wid, req.body);
  if (!w) return res.status(404).json({ error: 'Widget not found' });
  res.json(w);
});

/** Delete widget */
router.delete('/projects/:slug/dashboard/widgets/:wid', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const w = deleteWidget(req.params.slug, req.params.wid);
  if (!w) return res.status(404).json({ error: 'Widget not found' });
  res.json(w);
});

/** Get dashboard layout */
router.get('/projects/:slug/dashboard/layout', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getLayout(req.params.slug));
});

/** Update dashboard layout */
router.patch('/projects/:slug/dashboard/layout', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(updateLayout(req.params.slug, req.body));
});

/** Get widget data */
router.get('/projects/:slug/dashboard/widgets/:wid/data', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const data = getWidgetData(req.params.slug, req.params.wid);
  if (!data) return res.status(404).json({ error: 'Widget not found' });
  res.json(data);
});

/** Dashboard stats */
router.get('/projects/:slug/dashboard/stats', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getDashboardStats(req.params.slug));
});

/** Available widget types */
router.get('/widget-types', (_req, res) => { res.json(WIDGET_TYPES); });

/** Available widget sizes */
router.get('/widget-sizes', (_req, res) => { res.json(WIDGET_SIZES); });


export default router;
