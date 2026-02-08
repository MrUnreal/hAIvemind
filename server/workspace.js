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
      const meta = this._readProjectMeta(entry.slug);
      return { ...entry, ...meta, dir: join(this.baseDir, entry.slug) };
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

    const meta = this._readProjectMeta(slug);
    return { ...entry, ...meta, dir: join(this.baseDir, slug) };
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
