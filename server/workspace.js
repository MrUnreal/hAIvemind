import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import config from './config.js';

/**
 * WorkspaceManager handles per-project isolation.
 *
 * Directory structure:
 *   <baseDir>/
 *     projects.json              ← project registry
 *     <project-slug>/
 *       .haivemind/
 *         project.json           ← project metadata
 *         sessions/
 *           <session-id>.json    ← session history & logs
 *       src/                     ← agent-generated code lives here
 *       ...                      ← everything the agents create
 */

const DEFAULT_BASE = resolve(process.cwd(), config.workDir);

export default class WorkspaceManager {
  /**
   * @param {string} [baseDir] - Root directory for all projects.
   */
  constructor(baseDir = DEFAULT_BASE) {
    this.baseDir = baseDir;
    this.registryPath = join(this.baseDir, 'projects.json');
    this._ensureDir(this.baseDir);
    this._registry = this._loadRegistry();
  }

  // ═══════════════════════════════════════════════════════════
  //  Projects
  // ═══════════════════════════════════════════════════════════

  /**
   * Create a new project workspace.
   * @param {string} name - Human-readable project name
   * @param {object} [opts]
   * @param {string} [opts.description]
   * @param {string} [opts.slug] - Custom slug (auto-generated from name if omitted)
   * @returns {Project}
   */
  createProject(name, opts = {}) {
    const slug = opts.slug || this._slugify(name);

    if (this._registry.projects[slug]) {
      throw new Error(`Project "${slug}" already exists`);
    }

    const projectDir = join(this.baseDir, slug);
    const metaDir = join(projectDir, '.haivemind');
    const sessionsDir = join(metaDir, 'sessions');

    this._ensureDir(projectDir);
    this._ensureDir(metaDir);
    this._ensureDir(sessionsDir);

    const project = {
      id: randomUUID(),
      slug,
      name,
      description: opts.description || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionCount: 0,
      totalCost: 0,
    };

    // Write project metadata
    writeFileSync(join(metaDir, 'project.json'), JSON.stringify(project, null, 2));

    // Register
    this._registry.projects[slug] = {
      id: project.id,
      name: project.name,
      slug,
      dir: projectDir,
      createdAt: project.createdAt,
    };
    this._saveRegistry();

    console.log(`[workspace] Created project "${name}" → ${projectDir}`);
    return { ...project, dir: projectDir };
  }

  /**
   * List all projects.
   * @returns {Project[]}
   */
  listProjects() {
    return Object.values(this._registry.projects).map(entry => {
      const meta = entry.linked ? {} : this._readProjectMeta(entry.slug);
      const dir = this._getProjectDir(entry.slug);
      return { ...meta, ...entry, dir };
    });
  }

  /**
   * Get a project by slug.
   * @param {string} slug
   * @returns {Project|null}
   */
  getProject(slug) {
    const entry = this._registry.projects[slug];
    if (!entry) return null;

    const meta = entry.linked ? {} : this._readProjectMeta(slug);
    const dir = this._getProjectDir(slug);
    return { ...meta, ...entry, dir };
  }

  /**
   * Delete a project and its workspace.
   * @param {string} slug
   */
  deleteProject(slug) {
    const entry = this._registry.projects[slug];
    if (!entry) throw new Error(`Project "${slug}" not found`);

    const projectDir = join(this.baseDir, slug);
    if (existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true });
    }

    delete this._registry.projects[slug];
    this._saveRegistry();
    console.log(`[workspace] Deleted project "${slug}"`);
  }

  // ═══════════════════════════════════════════════════════════
  //  Sessions (scoped to a project)
  // ═══════════════════════════════════════════════════════════

  /**
   * Start a new session within a project.
   * @param {string} slug - Project slug
   * @param {string} prompt - User prompt
   * @returns {{ sessionId: string, workDir: string, session: object }}
   */
  startSession(slug, prompt) {
    const entry = this._registry.projects[slug];
    if (!entry) throw new Error(`Project "${slug}" not found`);

    const sessionId = randomUUID();
    const projectDir = this._getProjectDir(slug);
    const sessionsDir = join(projectDir, '.haivemind', 'sessions');

    const session = {
      id: sessionId,
      projectSlug: slug,
      prompt,
      status: 'planning',
      createdAt: Date.now(),
      completedAt: null,
      tasks: [],
      costSummary: null,
    };

    writeFileSync(
      join(sessionsDir, `${sessionId}.json`),
      JSON.stringify(session, null, 2),
    );

    // Update project metadata
    const meta = this._readProjectMeta(slug);
    meta.sessionCount++;
    meta.updatedAt = Date.now();
    this._writeProjectMeta(slug, meta);

    console.log(`[workspace] Session ${sessionId.slice(0, 8)} started in project "${slug}"`);

    // The work directory IS the project root — agents write directly into it
    return { sessionId, workDir: projectDir, session };
  }

  /**
   * Finalize a session (mark complete, store summary).
   * @param {string} slug
   * @param {string} sessionId
   * @param {object} summary - { status, tasks, costSummary }
   */
  finalizeSession(slug, sessionId, summary) {
    const projectDir = this._getProjectDir(slug);
    const sessionFile = join(projectDir, '.haivemind', 'sessions', `${sessionId}.json`);

    if (!existsSync(sessionFile)) return;

    const session = JSON.parse(readFileSync(sessionFile, 'utf-8'));
    session.status = summary.status || 'completed';
    session.completedAt = Date.now();
    session.tasks = summary.tasks || [];
    session.edges = summary.edges || [];
    session.agents = summary.agents || {};
    session.costSummary = summary.costSummary || null;
    session.timeline = summary.timeline || [];
    session.snapshot = summary.snapshot || null; // Phase 5.2: Pre-session snapshot metadata

    writeFileSync(sessionFile, JSON.stringify(session, null, 2));

    // Update project totals
    const meta = this._readProjectMeta(slug);
    if (summary.costSummary?.totalPremiumRequests) {
      meta.totalCost = (meta.totalCost || 0) + summary.costSummary.totalPremiumRequests;
    }
    meta.updatedAt = Date.now();
    this._writeProjectMeta(slug, meta);
  }

  /**
   * Get a single session by ID.
   */
  getSession(slug, sessionId) {
    const entry = this._registry.projects[slug];
    if (!entry) return null;
    const dir = this._getProjectDir(slug);
    const sessionFile = join(dir, '.haivemind', 'sessions', `${sessionId}.json`);
    if (!existsSync(sessionFile)) return null;
    try {
      return JSON.parse(readFileSync(sessionFile, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * List sessions for a project.
   * @param {string} slug
   * @returns {object[]}
   */
  listSessions(slug) {
    const sessionsDir = join(this._getProjectDir(slug), '.haivemind', 'sessions');
    if (!existsSync(sessionsDir)) return [];

    return readdirSync(sessionsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          return JSON.parse(readFileSync(join(sessionsDir, f), 'utf-8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // ═══════════════════════════════════════════════════════════
  //  Persistent Skills
  // ═══════════════════════════════════════════════════════════

  /**
   * Get discovered skills for a project.
   * @param {string} slug
   * @returns {object} skills object (empty defaults if none)
   */
  getSkills(slug) {
    const dir = this._getProjectDir(slug);
    const skillsPath = join(dir, '.haivemind', 'skills.json');
    if (existsSync(skillsPath)) {
      try {
        return JSON.parse(readFileSync(skillsPath, 'utf-8'));
      } catch {
        return this._defaultSkills();
      }
    }
    return this._defaultSkills();
  }

  /**
   * Save/merge skills for a project.
   * @param {string} slug
   * @param {object} newSkills - partial skills to merge
   */
  saveSkills(slug, newSkills) {
    const dir = this._getProjectDir(slug);
    const skillsPath = join(dir, '.haivemind', 'skills.json');
    const existing = this.getSkills(slug);

    // Merge arrays (deduplicate), overwrite scalars
    for (const key of ['buildCommands', 'testCommands', 'lintCommands', 'deployCommands', 'patterns']) {
      if (Array.isArray(newSkills[key])) {
        const merged = [...(existing[key] || []), ...newSkills[key]];
        existing[key] = [...new Set(merged)];
      }
    }
    existing.updatedAt = Date.now();

    writeFileSync(skillsPath, JSON.stringify(existing, null, 2));
    return existing;
  }

  _defaultSkills() {
    return {
      buildCommands: [],
      testCommands: [],
      lintCommands: [],
      deployCommands: [],
      patterns: [],
      updatedAt: null,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Self-Reflection & Metrics
  // ═══════════════════════════════════════════════════════════

  /**
   * Save a reflection for a completed session.
   * @param {string} slug
   * @param {string} sessionId
   * @param {object} reflection
   */
  saveReflection(slug, sessionId, reflection) {
    const dir = this._getProjectDir(slug);
    const reflectionsDir = join(dir, '.haivemind', 'reflections');
    this._ensureDir(reflectionsDir);

    const data = {
      sessionId,
      createdAt: Date.now(),
      ...reflection,
    };
    writeFileSync(
      join(reflectionsDir, `${sessionId}.json`),
      JSON.stringify(data, null, 2),
    );
    return data;
  }

  /**
   * Get all reflections for a project (newest first).
   * @param {string} slug
   * @param {number} [limit=20]
   * @returns {object[]}
   */
  getReflections(slug, limit = 20) {
    const dir = this._getProjectDir(slug);
    const reflectionsDir = join(dir, '.haivemind', 'reflections');
    if (!existsSync(reflectionsDir)) return [];

    return readdirSync(reflectionsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          return JSON.parse(readFileSync(join(reflectionsDir, f), 'utf-8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, limit);
  }

  // ═══════════════════════════════════════════════════════════
  //  Project Settings (escalation overrides, etc.)
  // ═══════════════════════════════════════════════════════════

  /**
   * Get per-project settings.
   * @param {string} slug
   * @returns {object}
   */
  getProjectSettings(slug) {
    const dir = this._getProjectDir(slug);
    const settingsPath = join(dir, '.haivemind', 'settings.json');
    if (existsSync(settingsPath)) {
      try {
        return JSON.parse(readFileSync(settingsPath, 'utf-8'));
      } catch {
        return this._defaultSettings();
      }
    }
    return this._defaultSettings();
  }

  /**
   * Update per-project settings (shallow merge).
   * @param {string} slug
   * @param {object} patch
   * @returns {object} updated settings
   */
  updateProjectSettings(slug, patch) {
    const dir = this._getProjectDir(slug);
    const settingsPath = join(dir, '.haivemind', 'settings.json');
    const existing = this.getProjectSettings(slug);
    const updated = { ...existing, ...patch, updatedAt: Date.now() };
    writeFileSync(settingsPath, JSON.stringify(updated, null, 2));
    return updated;
  }

  _defaultSettings() {
    return {
      escalation: null,         // null = use global default, or ['T0','T0','T1','T2','T3']
      maxRetriesTotal: null,    // null = use global default
      maxConcurrency: null,     // null = use global default
      costCeiling: null,        // null = unlimited, or max premium requests per session
      pinnedModels: {},         // taskLabel pattern → model name override
      updatedAt: null,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  External project linking (for existing repos)
  // ═══════════════════════════════════════════════════════════

  /**
   * Link an existing directory as a project.
   * This lets agents work directly inside an existing repo/folder.
   * @param {string} name - Project name
   * @param {string} externalDir - Absolute path to the existing directory
   * @returns {Project}
   */
  linkProject(name, externalDir) {
    const absDir = resolve(externalDir);
    if (!existsSync(absDir)) {
      throw new Error(`Directory does not exist: ${absDir}`);
    }

    const slug = this._slugify(name);
    if (this._registry.projects[slug]) {
      throw new Error(`Project "${slug}" already exists`);
    }

    // Create .haivemind metadata inside the external dir
    const metaDir = join(absDir, '.haivemind');
    const sessionsDir = join(metaDir, 'sessions');
    this._ensureDir(metaDir);
    this._ensureDir(sessionsDir);

    const project = {
      id: randomUUID(),
      slug,
      name,
      description: `Linked: ${absDir}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionCount: 0,
      totalCost: 0,
      linked: true,
    };

    writeFileSync(join(metaDir, 'project.json'), JSON.stringify(project, null, 2));

    // Register with an absolute dir (not under baseDir)
    this._registry.projects[slug] = {
      id: project.id,
      name: project.name,
      slug,
      dir: absDir,
      createdAt: project.createdAt,
      linked: true,
    };
    this._saveRegistry();

    console.log(`[workspace] Linked project "${name}" → ${absDir}`);
    return { ...project, dir: absDir };
  }

  // ═══════════════════════════════════════════════════════════
  //  Internals
  // ═══════════════════════════════════════════════════════════

  _slugify(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'project';
  }

  _ensureDir(dir) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  _loadRegistry() {
    if (existsSync(this.registryPath)) {
      try {
        return JSON.parse(readFileSync(this.registryPath, 'utf-8'));
      } catch {
        return { projects: {} };
      }
    }
    return { projects: {} };
  }

  _saveRegistry() {
    writeFileSync(this.registryPath, JSON.stringify(this._registry, null, 2));
  }

  /** Resolve the root directory for a project (linked → external dir, created → baseDir/slug) */
  _getProjectDir(slug) {
    const entry = this._registry.projects[slug];
    return entry?.linked ? entry.dir : join(this.baseDir, slug);
  }

  _readProjectMeta(slug) {
    const dir = this._getProjectDir(slug);
    const metaPath = join(dir, '.haivemind', 'project.json');
    if (existsSync(metaPath)) {
      try {
        return JSON.parse(readFileSync(metaPath, 'utf-8'));
      } catch {
        return {};
      }
    }
    return {};
  }

  _writeProjectMeta(slug, meta) {
    const dir = this._getProjectDir(slug);
    const metaPath = join(dir, '.haivemind', 'project.json');
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }
}
