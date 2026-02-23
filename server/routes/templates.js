/**
 * Template routes — session templates, project templates.
 */
import { Router } from 'express';
import { refs } from '../state.js';
import {
  getTemplates, getTemplate, addTemplate, updateTemplate,
  removeTemplate, useTemplate, duplicateTemplate,
} from '../services/sessionTemplates.js';
import {
  listProjectTemplates, getProjectTemplate, createProjectTemplate,
  deleteProjectTemplate, applyProjectTemplate, listTemplateCategories,
  listTemplateTags,
} from '../services/projectTemplates.js';

const router = Router();

// ────── Session Templates ──────

/** List templates */
router.get('/projects/:slug/templates', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(getTemplates(req.params.slug));
});

/** Get single template */
router.get('/projects/:slug/templates/:templateId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const tmpl = getTemplate(req.params.slug, req.params.templateId);
  if (!tmpl) return res.status(404).json({ error: 'Template not found' });
  res.json(tmpl);
});

/** Create template */
router.post('/projects/:slug/templates', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { name, prompt, description, category, settings } = req.body;
  if (!name || !prompt) {
    return res.status(400).json({ error: 'name and prompt are required' });
  }
  const tmpl = addTemplate(req.params.slug, { name, prompt, description, category, settings });
  res.status(201).json(tmpl);
});

/** Update template */
router.patch('/projects/:slug/templates/:templateId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const tmpl = updateTemplate(req.params.slug, req.params.templateId, req.body);
  if (!tmpl) return res.status(404).json({ error: 'Template not found' });
  res.json(tmpl);
});

/** Delete template */
router.delete('/projects/:slug/templates/:templateId', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const ok = removeTemplate(req.params.slug, req.params.templateId);
  if (!ok) return res.status(404).json({ error: 'Template not found' });
  res.json({ success: true });
});

/** Use (launch) template — increments useCount */
router.post('/projects/:slug/templates/:templateId/use', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const tmpl = useTemplate(req.params.slug, req.params.templateId);
  if (!tmpl) return res.status(404).json({ error: 'Template not found' });
  res.json(tmpl);
});

/** Duplicate template */
router.post('/projects/:slug/templates/:templateId/duplicate', (req, res) => {
  if (!refs.workspace.getProject(req.params.slug)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const tmpl = duplicateTemplate(req.params.slug, req.params.templateId);
  if (!tmpl) return res.status(404).json({ error: 'Template not found' });
  res.status(201).json(tmpl);
});


/** List project templates */
router.get('/project-templates', (req, res) => {
  const opts = {};
  if (req.query.category) opts.category = req.query.category;
  if (req.query.tag) opts.tag = req.query.tag;
  res.json(listProjectTemplates(opts));
});

/** Get a single project template */
router.get('/project-templates/:id', (req, res) => {
  const t = getProjectTemplate(req.params.id);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  res.json(t);
});

/** Create a custom project template */
router.post('/project-templates', (req, res) => {
  try {
    const t = createProjectTemplate(req.body);
    res.status(201).json(t);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Delete a custom project template */
router.delete('/project-templates/:id', (req, res) => {
  try {
    const removed = deleteProjectTemplate(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Template not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Apply a project template to a project */
router.post('/projects/:slug/apply-template', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const { templateId } = req.body;
  if (!templateId) return res.status(400).json({ error: 'templateId required' });
  try {
    const result = applyProjectTemplate(req.params.slug, templateId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** List template categories */
router.get('/project-template-categories', (_req, res) => {
  res.json(listTemplateCategories());
});

/** List template tags */
router.get('/project-template-tags', (_req, res) => {
  res.json(listTemplateTags());
});


export default router;
