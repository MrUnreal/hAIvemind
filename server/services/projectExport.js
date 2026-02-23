/**
 * server/services/projectExport.js — Export/Import Service
 *
 * Portable project archives:
 *   - Export: gathers project metadata, settings, sessions, and memory
 *     into a single JSON archive with manifest
 *   - Import: restores a project from an archive, creating or merging
 *     into the target instance
 *
 * Archive format (JSON):
 *   { manifest, project, settings, sessions }
 */

import { refs } from '../state.js';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FORMAT_VERSION = 1;

// ─── Export ──────────────────────────────────────────────────────────

/**
 * Export a project as a portable JSON archive.
 * @param {string} slug
 * @param {object} [opts]
 * @param {boolean} [opts.includeSessions=true]
 * @param {boolean} [opts.includeMemory=true]
 * @param {boolean} [opts.includeSettings=true]
 * @returns {{ manifest, project, settings?, sessions? }}
 */
export function exportProject(slug, opts = {}) {
  const {
    includeSessions = true,
    includeMemory = true,
    includeSettings = true,
  } = opts;

  const ws = refs.workspace;
  if (!ws) throw new Error('Workspace not initialised');

  const project = ws.getProject(slug);
  if (!project) return null;

  // Start building archive
  const archive = {
    manifest: {
      format: 'haivemind-project-archive',
      version: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      sourceSlug: slug,
      includes: {
        settings: includeSettings,
        sessions: includeSessions,
        memory: includeMemory,
      },
    },
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description || '',
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      sessionCount: project.sessionCount,
      totalCost: project.totalCost,
    },
  };

  // Settings
  if (includeSettings) {
    const settings = ws.getProjectSettings(slug);
    // Strip internal fields that shouldn't transfer
    const { updatedAt: _u, ...transferable } = settings;
    archive.settings = transferable;

    // If memory is excluded, strip it from settings too
    if (!includeMemory) {
      delete archive.settings.agentMemory;
    }
  }

  // Sessions
  if (includeSessions) {
    const sessionList = ws.listSessions(slug);
    archive.sessions = sessionList.map(meta => {
      try {
        const full = ws.getSession(slug, meta.id);
        return full;
      } catch {
        return { id: meta.id, error: 'unreadable' };
      }
    });
  }

  archive.manifest.projectName = project.name;
  archive.manifest.sessionCount = archive.sessions?.length || 0;
  archive.manifest.settingsIncluded = includeSettings;

  return archive;
}

// ─── Validate ────────────────────────────────────────────────────────

/**
 * Validate an archive before import.
 * @param {object} archive
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateArchive(archive) {
  const errors = [];

  if (!archive || typeof archive !== 'object') {
    return { valid: false, errors: ['Archive is not a valid object'] };
  }

  if (!archive.manifest) errors.push('Missing manifest');
  else {
    if (archive.manifest.format !== 'haivemind-project-archive') {
      errors.push(`Unknown format: ${archive.manifest.format}`);
    }
    if (typeof archive.manifest.version !== 'number') {
      errors.push('Missing or invalid version');
    }
    if (archive.manifest.version > FORMAT_VERSION) {
      errors.push(`Archive version ${archive.manifest.version} is newer than supported (${FORMAT_VERSION})`);
    }
  }

  if (!archive.project) errors.push('Missing project data');
  else {
    if (!archive.project.name) errors.push('Missing project name');
    if (!archive.project.slug) errors.push('Missing project slug');
  }

  return { valid: errors.length === 0, errors };
}

// ─── Import ──────────────────────────────────────────────────────────

/**
 * Import a project from a portable archive.
 *
 * @param {object} archive - The archive object
 * @param {object} [opts]
 * @param {string} [opts.targetSlug] - Override slug (default: use archive slug)
 * @param {string} [opts.targetName] - Override name (default: use archive name)
 * @param {'skip'|'overwrite'|'merge'} [opts.conflictStrategy='skip'] - Existing project handling
 * @param {boolean} [opts.importSessions=true]
 * @param {boolean} [opts.importSettings=true]
 * @returns {{ ok: boolean, slug: string, created: boolean, sessionsImported: number, warnings: string[] }}
 */
export function importProject(archive, opts = {}) {
  const {
    targetSlug,
    targetName,
    conflictStrategy = 'skip',
    importSessions = true,
    importSettings = true,
  } = opts;

  const ws = refs.workspace;
  if (!ws) throw new Error('Workspace not initialised');

  // Validate first
  const validation = validateArchive(archive);
  if (!validation.valid) {
    return { ok: false, slug: null, errors: validation.errors, warnings: [] };
  }

  const slug = targetSlug || archive.project.slug;
  const name = targetName || archive.project.name;
  const warnings = [];
  let created = false;

  // Check if project exists
  const existing = ws.getProject(slug);

  if (existing) {
    if (conflictStrategy === 'skip') {
      return {
        ok: false,
        slug,
        created: false,
        sessionsImported: 0,
        warnings: [`Project "${slug}" already exists — skipped (use conflictStrategy=overwrite or merge)`],
      };
    }
    // overwrite or merge: project already exists, we proceed
    warnings.push(`Project "${slug}" already exists — using ${conflictStrategy} strategy`);
  } else {
    // Create the project
    ws.createProject(name, { slug, description: archive.project.description || '' });
    created = true;
  }

  // Import settings
  if (importSettings && archive.settings) {
    if (conflictStrategy === 'overwrite' || created) {
      ws.updateProjectSettings(slug, archive.settings);
    } else if (conflictStrategy === 'merge') {
      // Shallow merge: archive settings fill in missing keys
      const current = ws.getProjectSettings(slug);
      const merged = { ...archive.settings, ...current };
      ws.updateProjectSettings(slug, merged);
      warnings.push('Settings merged (existing values take precedence)');
    }
  }

  // Import sessions
  let sessionsImported = 0;
  if (importSessions && archive.sessions?.length) {
    const existingSessions = new Set(
      ws.listSessions(slug).map(s => s.id)
    );

    for (const session of archive.sessions) {
      if (!session?.id || session.error) {
        warnings.push(`Skipped unreadable session ${session?.id || '(unknown)'}`);
        continue;
      }

      if (existingSessions.has(session.id)) {
        if (conflictStrategy === 'skip' || conflictStrategy === 'merge') {
          // Don't overwrite existing sessions
          continue;
        }
        // overwrite: fall through
      }

      try {
        // Write session directly to disk
        const project = ws.getProject(slug);
        const sessionsDir = join(project.dir, '.haivemind', 'sessions');
        if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });
        writeFileSync(
          join(sessionsDir, `${session.id}.json`),
          JSON.stringify(session, null, 2),
        );
        sessionsImported++;
      } catch (err) {
        warnings.push(`Failed to import session ${session.id}: ${err.message}`);
      }
    }
  }

  return {
    ok: true,
    slug,
    created,
    sessionsImported,
    warnings,
  };
}

// ─── Preview ─────────────────────────────────────────────────────────

/**
 * Get a summary of what an archive contains without importing.
 * @param {object} archive
 * @returns {object}
 */
export function previewArchive(archive) {
  const validation = validateArchive(archive);
  if (!validation.valid) return { valid: false, errors: validation.errors };

  const manifest = archive.manifest;
  const project = archive.project;
  const sessionCount = archive.sessions?.length || 0;
  const hasSettings = !!archive.settings;
  const hasMemory = !!(archive.settings?.agentMemory?.length);
  const memoryCount = archive.settings?.agentMemory?.length || 0;

  // Check for conflicts
  const ws = refs.workspace;
  const existingProject = ws?.getProject(project.slug) || null;

  return {
    valid: true,
    format: manifest.format,
    version: manifest.version,
    exportedAt: manifest.exportedAt,
    project: {
      name: project.name,
      slug: project.slug,
      description: project.description || '',
      createdAt: project.createdAt,
    },
    contents: {
      sessions: sessionCount,
      settings: hasSettings,
      memory: hasMemory,
      memoryEntries: memoryCount,
    },
    conflict: existingProject ? {
      exists: true,
      name: existingProject.name,
      slug: existingProject.slug,
    } : null,
  };
}

// ─── Reset (test helper) ────────────────────────────────────────────

export function _reset() {
  // Stateless service — nothing to reset, but keep interface consistent
}
