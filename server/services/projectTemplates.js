/**
 * Project Templates Service — Phase 11.2
 *
 * Predefined project archetypes with starter prompts, conventions, and
 * recommended settings. Templates can be used when creating new projects
 * to pre-configure settings, task templates, and initial session prompts.
 *
 * Built-in templates: api-server, cli-tool, library, web-app, fullstack, monorepo
 * Custom templates: saved per-workspace via global settings
 */

import { refs } from '../state.js';

/** Built-in project templates */
const BUILTIN_TEMPLATES = [
  {
    id: 'api-server',
    name: 'API Server',
    description: 'REST/GraphQL API backend with auth, database, and testing',
    category: 'backend',
    stack: ['Node.js', 'Express', 'Database'],
    conventions: {
      structure: 'src/ with routes/, controllers/, models/, middleware/',
      testing: 'Jest or Vitest with supertest for API testing',
      style: 'ESM modules, async/await, environment-based config',
    },
    settings: {
      defaultBackend: 'copilot',
      costCeiling: 1.0,
    },
    starterPrompts: [
      'Set up the project structure with Express, environment config, and health endpoint',
      'Add database connection with migration system and seed data',
      'Create CRUD endpoints for the main resource with validation',
      'Add JWT authentication with login/register and protected routes',
      'Write integration tests for all endpoints',
    ],
    tags: ['api', 'backend', 'rest', 'server'],
  },
  {
    id: 'cli-tool',
    name: 'CLI Tool',
    description: 'Command-line application with argument parsing and output formatting',
    category: 'tool',
    stack: ['Node.js', 'Commander/Yargs'],
    conventions: {
      structure: 'bin/ entry point, src/commands/ for subcommands, lib/ for shared logic',
      testing: 'Unit tests for each command, integration tests for full CLI runs',
      style: 'ESM, clean exit codes, colored output with chalk',
    },
    settings: {
      defaultBackend: 'copilot',
      costCeiling: 0.5,
    },
    starterPrompts: [
      'Set up CLI entry point with argument parser and help text',
      'Implement the main command with input validation',
      'Add subcommands for common operations',
      'Add output formatting (JSON, table, plain text)',
      'Write tests for CLI argument parsing and command execution',
    ],
    tags: ['cli', 'tool', 'terminal', 'command-line'],
  },
  {
    id: 'library',
    name: 'Library / Package',
    description: 'Reusable library with TypeScript, bundling, and npm publishing',
    category: 'library',
    stack: ['TypeScript', 'Rollup/tsup', 'npm'],
    conventions: {
      structure: 'src/ with index.ts barrel export, separate modules for concerns',
      testing: 'Comprehensive unit tests, type tests, 90%+ coverage target',
      style: 'TypeScript strict mode, ESM + CJS dual publishing, semantic versioning',
    },
    settings: {
      defaultBackend: 'copilot',
      costCeiling: 0.5,
    },
    starterPrompts: [
      'Set up TypeScript project with tsconfig, bundler, and package.json',
      'Implement core API with TypeScript types and JSDoc',
      'Add comprehensive unit tests with coverage reporting',
      'Set up build pipeline for ESM and CJS output',
      'Add README with API documentation and usage examples',
    ],
    tags: ['library', 'package', 'npm', 'typescript'],
  },
  {
    id: 'web-app',
    name: 'Web Application',
    description: 'Single-page application with modern framework and build tooling',
    category: 'frontend',
    stack: ['React/Vue/Svelte', 'Vite', 'CSS'],
    conventions: {
      structure: 'src/ with components/, pages/, hooks/, stores/, utils/',
      testing: 'Component tests with Testing Library, E2E with Playwright',
      style: 'Functional components, composition API, CSS modules or Tailwind',
    },
    settings: {
      defaultBackend: 'copilot',
      costCeiling: 1.0,
    },
    starterPrompts: [
      'Set up project with Vite, chosen framework, and dev server',
      'Create layout with navigation, routing, and responsive design',
      'Build main feature page with state management',
      'Add form handling with validation and error states',
      'Write component tests and E2E tests for critical paths',
    ],
    tags: ['web', 'frontend', 'spa', 'ui'],
  },
  {
    id: 'fullstack',
    name: 'Full-Stack Application',
    description: 'Complete web application with frontend, backend API, and database',
    category: 'fullstack',
    stack: ['React/Vue', 'Node.js/Express', 'PostgreSQL/MongoDB'],
    conventions: {
      structure: 'Monorepo or client/ + server/ split, shared types',
      testing: 'Unit tests per layer, integration tests for API, E2E for flows',
      style: 'TypeScript throughout, shared validation schemas, Docker compose for local dev',
    },
    settings: {
      defaultBackend: 'copilot',
      costCeiling: 2.0,
    },
    starterPrompts: [
      'Set up monorepo structure with client and server packages',
      'Create backend API with database schema and migrations',
      'Build frontend with routing, auth, and API integration',
      'Add shared types and validation between client and server',
      'Write E2E tests for complete user flows',
    ],
    tags: ['fullstack', 'web', 'api', 'database'],
  },
  {
    id: 'monorepo',
    name: 'Monorepo',
    description: 'Multi-package repository with shared tooling and workspace management',
    category: 'infrastructure',
    stack: ['pnpm/npm workspaces', 'Turborepo/Nx', 'TypeScript'],
    conventions: {
      structure: 'packages/ directory with independent packages, shared config at root',
      testing: 'Per-package test suites, CI runs only affected packages',
      style: 'Shared tsconfig, eslint config, and prettier at root level',
    },
    settings: {
      defaultBackend: 'copilot',
      costCeiling: 1.5,
    },
    starterPrompts: [
      'Set up monorepo with workspace package manager and build tool',
      'Create shared packages (config, types, utils)',
      'Add application packages that consume shared packages',
      'Configure CI to build and test only changed packages',
      'Set up versioning and publishing workflow',
    ],
    tags: ['monorepo', 'workspace', 'packages', 'infrastructure'],
  },
];

/**
 * List all available project templates (built-in + custom).
 * @param {{ category?: string, tag?: string }} opts
 * @returns {object[]}
 */
export function listProjectTemplates(opts = {}) {
  let templates = [...BUILTIN_TEMPLATES, ...getCustomTemplates()];
  if (opts.category) templates = templates.filter(t => t.category === opts.category);
  if (opts.tag) templates = templates.filter(t => t.tags?.includes(opts.tag));
  return templates.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    stack: t.stack,
    starterPrompts: t.starterPrompts || [],
    tags: t.tags,
    builtin: BUILTIN_TEMPLATES.some(b => b.id === t.id),
  }));
}

/**
 * Get a full project template by ID.
 * @param {string} templateId
 * @returns {object|null}
 */
export function getProjectTemplate(templateId) {
  const all = [...BUILTIN_TEMPLATES, ...getCustomTemplates()];
  const found = all.find(t => t.id === templateId);
  if (!found) return null;
  return { ...found, builtin: BUILTIN_TEMPLATES.some(b => b.id === found.id) };
}

/**
 * Create a custom project template.
 * @param {object} template
 * @returns {object}
 */
export function createProjectTemplate(template) {
  if (!template.name) throw new Error('Template name is required');
  if (!template.id) {
    template.id = `custom-${template.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${Date.now().toString(36)}`;
  }
  // Don't allow overwriting built-in templates
  if (BUILTIN_TEMPLATES.some(b => b.id === template.id)) {
    throw new Error('Cannot overwrite built-in template');
  }

  const custom = getCustomTemplates();
  // Replace if same ID exists
  const idx = custom.findIndex(t => t.id === template.id);
  const entry = {
    id: template.id,
    name: template.name,
    description: template.description || '',
    category: template.category || 'custom',
    stack: template.stack || [],
    conventions: template.conventions || {},
    settings: template.settings || {},
    starterPrompts: template.starterPrompts || [],
    tags: template.tags || [],
    createdAt: Date.now(),
  };

  if (idx >= 0) {
    custom[idx] = entry;
  } else {
    custom.push(entry);
  }

  saveCustomTemplates(custom);
  return entry;
}

/**
 * Delete a custom project template.
 * @param {string} templateId
 * @returns {boolean}
 */
export function deleteProjectTemplate(templateId) {
  if (BUILTIN_TEMPLATES.some(b => b.id === templateId)) {
    throw new Error('Cannot delete built-in template');
  }
  const custom = getCustomTemplates();
  const idx = custom.findIndex(t => t.id === templateId);
  if (idx === -1) return false;
  custom.splice(idx, 1);
  saveCustomTemplates(custom);
  return true;
}

/**
 * Apply a project template's settings to a project.
 * @param {string} slug - Project slug
 * @param {string} templateId - Template to apply
 * @returns {object} Applied settings
 */
export function applyProjectTemplate(slug, templateId) {
  const template = getProjectTemplate(templateId);
  if (!template) throw new Error('Template not found');

  const patch = {};
  if (template.settings) patch.templateSettings = template.settings;
  if (template.conventions) patch.conventions = template.conventions;
  if (template.starterPrompts) patch.starterPrompts = template.starterPrompts;
  patch.appliedTemplate = {
    id: template.id,
    name: template.name,
    appliedAt: Date.now(),
  };

  refs.workspace?.updateProjectSettings?.(slug, patch);
  return patch;
}

/**
 * List all unique categories from available templates.
 * @returns {string[]}
 */
export function listTemplateCategories() {
  const all = [...BUILTIN_TEMPLATES, ...getCustomTemplates()];
  return [...new Set(all.map(t => t.category).filter(Boolean))];
}

/**
 * Get tags with their frequency counts.
 * @returns {{ tag: string, count: number }[]}
 */
export function listTemplateTags() {
  const all = [...BUILTIN_TEMPLATES, ...getCustomTemplates()];
  const tagMap = {};
  for (const t of all) {
    for (const tag of (t.tags || [])) {
      tagMap[tag] = (tagMap[tag] || 0) + 1;
    }
  }
  return Object.entries(tagMap)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

// ── Internal: custom template persistence ──

function getCustomTemplates() {
  try {
    const settings = refs.workspace?.getGlobalSettings?.() || {};
    return settings.projectTemplates || [];
  } catch {
    return [];
  }
}

function saveCustomTemplates(templates) {
  refs.workspace?.updateGlobalSettings?.({ projectTemplates: templates });
}
