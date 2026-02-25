/**
 * server/services/streamingDiffs.js — Phase 20.4: Streaming Diff Preview
 *
 * Inspired by Cline: monitors file changes in real-time while agents
 * are working and broadcasts diffs to the client via WebSocket.
 * This gives users live visibility into what agents are doing.
 *
 * Uses a lightweight file watcher (fs.watch) with debouncing to avoid
 * flooding the client with too many updates.
 */

import { watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { isGitRepo } from '../snapshot.js';

/**
 * Manages real-time file change detection and diff broadcasting.
 */
export class StreamingDiffWatcher {
  /**
   * @param {string} workDir - Workspace root
   * @param {(msg: string) => void} broadcast - WebSocket broadcast function
   * @param {object} [opts]
   * @param {number} [opts.debounceMs=300] - Debounce interval
   * @param {number} [opts.maxDiffSize=10000] - Max diff size per file (chars)
   */
  constructor(workDir, broadcast, opts = {}) {
    this.workDir = workDir;
    this.broadcast = broadcast;
    this.debounceMs = opts.debounceMs ?? 300;
    this.maxDiffSize = opts.maxDiffSize ?? 10000;
    this.isGit = isGitRepo(workDir);

    /** @type {Map<string, FSWatcher>} */
    this._watchers = new Map();

    /** Debounce timers per file */
    this._debounceTimers = new Map();

    /** File content cache for computing inline diffs */
    this._fileCache = new Map();

    /** Track total changes in session for summary */
    this._changeLog = [];

    this._active = false;
  }

  /**
   * Start watching the workspace for file changes.
   * Only watches directories that are likely to contain source code.
   */
  start() {
    if (this._active) return;
    this._active = true;

    const WATCH_DIRS = [
      '.', 'src', 'lib', 'server', 'client', 'app', 'pages',
      'components', 'services', 'routes', 'middleware', 'utils',
      'helpers', 'models', 'controllers', 'views', 'api',
      'shared', 'common', 'tests', 'test', '__tests__',
    ];

    const IGNORE = new Set([
      'node_modules', '.git', '.haivemind', 'dist', 'build', 'out',
      'coverage', '.next', '.nuxt', '__pycache__',
    ]);

    for (const dir of WATCH_DIRS) {
      const fullDir = join(this.workDir, dir);
      try {
        const watcher = watch(fullDir, { recursive: false }, (eventType, filename) => {
          if (!filename || IGNORE.has(filename)) return;
          this._handleChange(join(dir, filename), eventType);
        });
        this._watchers.set(dir, watcher);
      } catch {
        // Directory doesn't exist — skip
      }
    }

    // Also watch root for config file changes
    try {
      const rootWatcher = watch(this.workDir, { recursive: false }, (eventType, filename) => {
        if (!filename) return;
        const ext = extname(filename);
        if (['.js', '.ts', '.json', '.yaml', '.yml', '.env', '.vue', '.jsx', '.tsx'].includes(ext)) {
          this._handleChange(filename, eventType);
        }
      });
      this._watchers.set('__root__', rootWatcher);
    } catch {
      // Root watch failed
    }
  }

  /**
   * Stop watching and clean up.
   */
  stop() {
    this._active = false;

    for (const [, watcher] of this._watchers) {
      try {
        watcher.close();
      } catch { /* ignore */ }
    }
    this._watchers.clear();

    for (const [, timer] of this._debounceTimers) {
      clearTimeout(timer);
    }
    this._debounceTimers.clear();
  }

  /**
   * Get a summary of all changes detected during the session.
   * @returns {{ totalChanges: number, files: string[], changeLog: Array }}
   */
  getSummary() {
    const files = [...new Set(this._changeLog.map(c => c.file))];
    return {
      totalChanges: this._changeLog.length,
      files,
      changeLog: this._changeLog.slice(-50),  // Last 50 changes
    };
  }

  /**
   * Snapshot a file's current content for later diff comparison.
   * Call this before an agent starts working on a specific file.
   *
   * @param {string} relPath - Relative path from workspace root
   */
  async snapshotFile(relPath) {
    try {
      const fullPath = join(this.workDir, relPath);
      const content = await readFile(fullPath, 'utf-8');
      this._fileCache.set(relPath, {
        content,
        hash: quickHash(content),
        timestamp: Date.now(),
      });
    } catch {
      // File doesn't exist yet — that's fine for new files
    }
  }

  // ─── Internal ──────────────────────────────────────────────────────

  /**
   * Handle a file change event (debounced).
   */
  _handleChange(relPath, eventType) {
    if (!this._active) return;

    // Normalize path separators
    relPath = relPath.replace(/\\/g, '/');

    // Clear existing debounce timer
    if (this._debounceTimers.has(relPath)) {
      clearTimeout(this._debounceTimers.get(relPath));
    }

    // Debounce — wait for file to settle
    this._debounceTimers.set(relPath, setTimeout(async () => {
      this._debounceTimers.delete(relPath);
      await this._emitDiff(relPath, eventType);
    }, this.debounceMs));
  }

  /**
   * Compute and broadcast a diff for a changed file.
   */
  async _emitDiff(relPath, eventType) {
    const fullPath = join(this.workDir, relPath);
    let diff = null;
    let newContent = null;

    try {
      const stats = await stat(fullPath);
      if (stats.isDirectory()) return;  // Skip directory events
      if (stats.size > 500_000) return;  // Skip huge files

      newContent = await readFile(fullPath, 'utf-8');
    } catch {
      // File deleted
      diff = { type: 'deleted', file: relPath };
    }

    if (newContent !== null) {
      const newHash = quickHash(newContent);
      const cached = this._fileCache.get(relPath);

      // Skip if content hasn't actually changed
      if (cached && cached.hash === newHash) return;

      if (this.isGit) {
        // Use git diff for accurate change display
        diff = this._getGitDiff(relPath);
      }

      if (!diff && cached) {
        // Compute simple inline diff
        diff = computeSimpleDiff(cached.content, newContent, relPath);
      }

      if (!diff) {
        diff = {
          type: eventType === 'rename' ? 'created' : 'modified',
          file: relPath,
          linesChanged: newContent.split('\n').length,
        };
      }

      // Update cache
      this._fileCache.set(relPath, {
        content: newContent,
        hash: newHash,
        timestamp: Date.now(),
      });
    }

    if (diff) {
      // Record in change log
      this._changeLog.push({
        file: relPath,
        type: diff.type,
        timestamp: Date.now(),
      });

      // Broadcast to client
      this.broadcast(JSON.stringify({
        type: 'file:diff',
        data: {
          ...diff,
          timestamp: Date.now(),
        },
      }));
    }
  }

  /**
   * Get git diff for a specific file.
   */
  _getGitDiff(relPath) {
    try {
      const diff = execSync(`git diff -- "${relPath}"`, {
        cwd: this.workDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 1024 * 1024,
      }).trim();

      if (!diff) {
        // Might be a new untracked file
        try {
          execSync(`git ls-files --error-unmatch "${relPath}"`, {
            cwd: this.workDir,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          return null;  // File is tracked and unchanged
        } catch {
          return { type: 'created', file: relPath };
        }
      }

      // Parse diff for summary stats
      const additions = (diff.match(/^\+[^+]/gm) || []).length;
      const deletions = (diff.match(/^-[^-]/gm) || []).length;

      const truncatedDiff = diff.length > this.maxDiffSize
        ? diff.slice(0, this.maxDiffSize) + '\n... (truncated)'
        : diff;

      return {
        type: 'modified',
        file: relPath,
        additions,
        deletions,
        patch: truncatedDiff,
      };
    } catch {
      return null;
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function quickHash(content) {
  return createHash('md5').update(content).digest('hex');
}

/**
 * Compute a simple diff between two strings (line-level).
 * Returns additions and deletions count.
 */
function computeSimpleDiff(oldContent, newContent, relPath) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  let additions = 0;
  let deletions = 0;

  // Simple LCS-based diff approximation
  const oldSet = new Set(oldLines.map((l, i) => `${i}:${l}`));
  const newSet = new Set(newLines.map((l, i) => `${i}:${l}`));

  // Lines in new not in old = additions (rough)
  for (const line of newLines) {
    if (!oldLines.includes(line)) additions++;
  }

  // Lines in old not in new = deletions (rough)
  for (const line of oldLines) {
    if (!newLines.includes(line)) deletions++;
  }

  return {
    type: 'modified',
    file: relPath,
    additions,
    deletions,
    linesChanged: additions + deletions,
  };
}
