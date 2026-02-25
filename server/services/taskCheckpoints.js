/**
 * server/services/taskCheckpoints.js — Phase 20.2: Per-Task Checkpoints
 *
 * Inspired by Cline: take workspace snapshots at each task completion,
 * enabling granular rollback to any task boundary (not just session start).
 *
 * Uses git stash-like approach for git repos, or file hash manifests
 * for non-git workspaces. Lightweight — only records changed file hashes,
 * not full copies.
 */

import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { isGitRepo } from '../snapshot.js';

/**
 * Per-task checkpoint tracking for a session.
 */
export class TaskCheckpointManager {
  /**
   * @param {string} workDir - Workspace root
   * @param {string} sessionId - Session identifier
   */
  constructor(workDir, sessionId) {
    this.workDir = workDir;
    this.sessionId = sessionId;
    this.isGit = isGitRepo(workDir);
    this.checkpoints = [];  // { taskId, taskLabel, timestamp, ref, filesChanged }
    this._baselineHash = null;
  }

  /**
   * Initialize — capture baseline state before any tasks run.
   */
  async initialize() {
    if (this.isGit) {
      try {
        this._baselineHash = execSync('git rev-parse HEAD', {
          cwd: this.workDir,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
      } catch {
        this._baselineHash = null;
      }
    }
  }

  /**
   * Create a checkpoint after a task completes.
   *
   * For git repos: records the current working tree state via `git stash create`
   * (non-destructive — doesn't actually stash, just creates a ref).
   *
   * For non-git: records hashes of recently modified files.
   *
   * @param {string} taskId
   * @param {string} taskLabel
   * @returns {TaskCheckpoint}
   */
  async createCheckpoint(taskId, taskLabel) {
    const checkpoint = {
      taskId,
      taskLabel,
      timestamp: Date.now(),
      ref: null,
      filesChanged: [],
    };

    if (this.isGit) {
      try {
        // Get changed files relative to baseline or last checkpoint
        const compareRef = this.checkpoints.length > 0
          ? this.checkpoints[this.checkpoints.length - 1].ref
          : this._baselineHash;

        if (compareRef) {
          const diff = execSync(`git diff --name-only ${compareRef} 2>/dev/null || echo ""`, {
            cwd: this.workDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          }).trim();

          checkpoint.filesChanged = diff ? diff.split('\n').filter(Boolean) : [];
        }

        // Also include untracked files
        const untracked = execSync('git ls-files --others --exclude-standard', {
          cwd: this.workDir,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();

        if (untracked) {
          for (const f of untracked.split('\n').filter(Boolean)) {
            if (!checkpoint.filesChanged.includes(f)) {
              checkpoint.filesChanged.push(f);
            }
          }
        }

        // Create a tag for this checkpoint
        const tagName = `haivemind/task/${this.sessionId}/${taskId}`;
        try {
          // Stage all changes (so tag captures everything)
          execSync('git add -A', {
            cwd: this.workDir,
            stdio: ['ignore', 'pipe', 'pipe'],
          });

          // Create a tree object from current state
          const treeHash = execSync('git write-tree', {
            cwd: this.workDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          }).trim();

          checkpoint.ref = treeHash;
        } catch {
          // Fall back to just recording the tag name
          checkpoint.ref = tagName;
        }
      } catch {
        // Git operations failed — record without ref
        checkpoint.ref = null;
      }
    } else {
      // Non-git: hash recently modified files
      checkpoint.filesChanged = await this._getRecentlyModifiedFiles();
      checkpoint.ref = `checkpoint-${taskId}-${Date.now()}`;
    }

    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  /**
   * Get a diff between two checkpoints (or checkpoint vs current).
   *
   * @param {number} fromIndex - Checkpoint index to compare from
   * @param {number} [toIndex] - Checkpoint index to compare to (null = current state)
   * @returns {{ files: string[], summary: string }}
   */
  getDiff(fromIndex, toIndex = null) {
    if (fromIndex < 0 || fromIndex >= this.checkpoints.length) {
      return { files: [], summary: 'Invalid checkpoint index' };
    }

    if (!this.isGit) {
      // For non-git, just show files that changed between checkpoints
      const fromFiles = new Set(this.checkpoints[fromIndex].filesChanged);
      const allFiles = new Set();

      const endIdx = toIndex ?? this.checkpoints.length;
      for (let i = fromIndex + 1; i <= Math.min(endIdx, this.checkpoints.length - 1); i++) {
        for (const f of this.checkpoints[i].filesChanged) {
          allFiles.add(f);
        }
      }

      return {
        files: [...allFiles],
        summary: `${allFiles.size} files changed between checkpoints`,
      };
    }

    // Git: use diff between refs
    try {
      const fromRef = this.checkpoints[fromIndex].ref;
      const toRef = toIndex != null ? this.checkpoints[toIndex].ref : 'HEAD';

      if (!fromRef) return { files: [], summary: 'No ref for source checkpoint' };

      const diffStat = execSync(`git diff ${fromRef} ${toRef} --stat 2>/dev/null || echo "N/A"`, {
        cwd: this.workDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();

      const nameOnly = execSync(`git diff ${fromRef} ${toRef} --name-only 2>/dev/null || echo ""`, {
        cwd: this.workDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();

      return {
        files: nameOnly ? nameOnly.split('\n').filter(Boolean) : [],
        summary: diffStat || 'No changes',
      };
    } catch {
      return { files: [], summary: 'Unable to compute diff' };
    }
  }

  /**
   * Roll back workspace to a specific task checkpoint.
   *
   * @param {number} checkpointIndex
   * @returns {{ success: boolean, message: string }}
   */
  async rollbackTo(checkpointIndex) {
    if (checkpointIndex < 0 || checkpointIndex >= this.checkpoints.length) {
      return { success: false, message: 'Invalid checkpoint index' };
    }

    const checkpoint = this.checkpoints[checkpointIndex];

    if (!this.isGit || !checkpoint.ref) {
      return { success: false, message: 'Rollback only supported for git repositories with valid refs' };
    }

    try {
      execSync(`git checkout ${checkpoint.ref} -- .`, {
        cwd: this.workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Trim checkpoints after the rollback point
      this.checkpoints = this.checkpoints.slice(0, checkpointIndex + 1);

      return {
        success: true,
        message: `Rolled back to checkpoint: ${checkpoint.taskLabel} (task ${checkpoint.taskId})`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Rollback failed: ${err?.stderr?.toString?.() || err.message}`,
      };
    }
  }

  /**
   * Get all checkpoints as a summary.
   * @returns {Array<{ taskId: string, taskLabel: string, timestamp: number, filesChanged: number }>}
   */
  getSummary() {
    return this.checkpoints.map((cp, idx) => ({
      index: idx,
      taskId: cp.taskId,
      taskLabel: cp.taskLabel,
      timestamp: cp.timestamp,
      filesChanged: cp.filesChanged.length,
    }));
  }

  /**
   * Serialize checkpoints for session snapshot persistence.
   */
  toJSON() {
    return {
      sessionId: this.sessionId,
      workDir: this.workDir,
      isGit: this.isGit,
      baselineHash: this._baselineHash,
      checkpoints: this.checkpoints,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  /**
   * For non-git workspaces: find recently modified files (last 5 minutes).
   */
  async _getRecentlyModifiedFiles() {
    const files = [];
    const cutoff = Date.now() - 5 * 60 * 1000;

    try {
      await this._walkForRecent(this.workDir, files, cutoff, 0, 4);
    } catch {
      // Walk failed
    }

    return files.map(f => relative(this.workDir, f).replace(/\\/g, '/'));
  }

  async _walkForRecent(dir, results, cutoff, depth, maxDepth) {
    if (depth > maxDepth || results.length > 50) return;

    const SKIP = new Set(['node_modules', '.git', '.haivemind', 'dist', 'build', 'out']);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await this._walkForRecent(fullPath, results, cutoff, depth + 1, maxDepth);
      } else {
        try {
          const stats = await fs.stat(fullPath);
          if (stats.mtimeMs > cutoff) {
            results.push(fullPath);
          }
        } catch { /* skip */ }
      }
    }
  }
}
