/**
 * Session Templates — Phase 9.5
 *
 * Reusable prompt templates with presets and quick-launch support.
 * Templates are stored per-project via WorkspaceManager settings.
 */

import { refs } from '../state.js';
import { randomBytes } from 'crypto';

/**
 * @typedef {Object} SessionTemplate
 * @property {string} id
 * @property {string} name
 * @property {string} prompt — the template prompt text
 * @property {string} [description]
 * @property {string} category — e.g. 'refactor', 'feature', 'test', 'debug', 'custom'
 * @property {Object} [settings] — optional overrides (backend, escalation, etc.)
 * @property {number} useCount — how many times launched
 * @property {number} createdAt
 * @property {number} updatedAt
 */

const CATEGORIES = ['feature', 'refactor', 'test', 'debug', 'docs', 'custom'];

/**
 * Get all templates for a project.
 * @param {string} slug
 * @returns {SessionTemplate[]}
 */
export function getTemplates(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug);
  return settings?.sessionTemplates ?? [];
}

/**
 * Get a single template by ID.
 * @param {string} slug
 * @param {string} templateId
 * @returns {SessionTemplate|null}
 */
export function getTemplate(slug, templateId) {
  return getTemplates(slug).find(t => t.id === templateId) ?? null;
}

/**
 * Add a new session template.
 * @param {string} slug
 * @param {{ name: string, prompt: string, description?: string, category?: string, settings?: Object }} data
 * @returns {SessionTemplate}
 */
export function addTemplate(slug, data) {
  const templates = getTemplates(slug);
  const template = {
    id: `tmpl-${Date.now()}-${randomBytes(4).toString('hex')}`,
    name: data.name,
    prompt: data.prompt,
    description: data.description || '',
    category: CATEGORIES.includes(data.category) ? data.category : 'custom',
    settings: data.settings || {},
    useCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  templates.push(template);
  saveTemplates(slug, templates);
  return template;
}

/**
 * Update an existing template.
 * @param {string} slug
 * @param {string} templateId
 * @param {Partial<SessionTemplate>} patch
 * @returns {SessionTemplate|null}
 */
export function updateTemplate(slug, templateId, patch) {
  const templates = getTemplates(slug);
  const tmpl = templates.find(t => t.id === templateId);
  if (!tmpl) return null;
  if (patch.name != null) tmpl.name = patch.name;
  if (patch.prompt != null) tmpl.prompt = patch.prompt;
  if (patch.description != null) tmpl.description = patch.description;
  if (patch.category != null && CATEGORIES.includes(patch.category)) tmpl.category = patch.category;
  if (patch.settings != null) tmpl.settings = patch.settings;
  tmpl.updatedAt = Date.now();
  saveTemplates(slug, templates);
  return tmpl;
}

/**
 * Remove a template.
 * @param {string} slug
 * @param {string} templateId
 * @returns {boolean}
 */
export function removeTemplate(slug, templateId) {
  const templates = getTemplates(slug);
  const idx = templates.findIndex(t => t.id === templateId);
  if (idx === -1) return false;
  templates.splice(idx, 1);
  saveTemplates(slug, templates);
  return true;
}

/**
 * Increment use count (called when launching from template).
 * @param {string} slug
 * @param {string} templateId
 * @returns {SessionTemplate|null}
 */
export function useTemplate(slug, templateId) {
  const templates = getTemplates(slug);
  const tmpl = templates.find(t => t.id === templateId);
  if (!tmpl) return null;
  tmpl.useCount++;
  tmpl.updatedAt = Date.now();
  saveTemplates(slug, templates);
  return tmpl;
}

/**
 * Duplicate an existing template.
 * @param {string} slug
 * @param {string} templateId
 * @returns {SessionTemplate|null}
 */
export function duplicateTemplate(slug, templateId) {
  const tmpl = getTemplate(slug, templateId);
  if (!tmpl) return null;
  return addTemplate(slug, {
    name: `${tmpl.name} (copy)`,
    prompt: tmpl.prompt,
    description: tmpl.description,
    category: tmpl.category,
    settings: { ...tmpl.settings },
  });
}

/** Valid categories exported for reference. */
export { CATEGORIES };

// ────── Internal ──────

function saveTemplates(slug, templates) {
  refs.workspace?.updateProjectSettings?.(slug, { sessionTemplates: templates });
}
