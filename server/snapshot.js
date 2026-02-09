/**
 * Phase 5.2 — Workspace Snapshot & Rollback
 *
 * Before each session, create a lightweight snapshot of the workspace:
 *  - Git repos: create a git tag `haivemind/pre-session/<sessionId>`
 *  - Non-git repos: tarball snapshot to `.haivemind/snapshots/<sessionId>.tar.gz`
 *
 * Provides rollback to restore workspace to pre-session state.
 */

import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Check if a directory is inside a git working tree.
 * @param {string} dir
 * @returns {boolean}
 */
export function isGitRepo(dir) {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a pre-session snapshot of the workspace.
 * @param {string} workDir - The project workspace directory
 * @param {string} sessionId - Unique session identifier
 * @returns {Promise<{ type: 'git-tag' | 'tarball' | 'none', ref: string }>}
 */
export async function createSnapshot(workDir, sessionId) {
  const tagName = `haivemind/pre-session/${sessionId}`;

  if (isGitRepo(workDir)) {
    try {
      // Check for uncommitted changes — stash won't help if there's nothing to commit
      // We tag the current HEAD; dirty files in worktree are expected
      execSync(`git tag "${tagName}"`, {
        cwd: workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      console.log(`[snapshot] Created git tag: ${tagName}`);
      return { type: 'git-tag', ref: tagName };
    } catch (err) {
      console.warn(`[snapshot] Failed to create git tag: ${err?.stderr?.toString?.() || err.message}`);
      // Fall through to tarball
    }
  }

  // Non-git fallback: tarball snapshot
  try {
    const snapshotsDir = path.join(workDir, '.haivemind', 'snapshots');
    await fs.mkdir(snapshotsDir, { recursive: true });

    const tarPath = path.join(snapshotsDir, `${sessionId}.tar.gz`);

    // Use tar if available (most systems), exclude .haivemind and node_modules
    try {
      execSync(
        `tar -czf "${tarPath}" --exclude=".haivemind" --exclude="node_modules" --exclude=".git" -C "${workDir}" .`,
        { cwd: workDir, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 },
      );
      console.log(`[snapshot] Created tarball snapshot: ${tarPath}`);
      return { type: 'tarball', ref: tarPath };
    } catch {
      // tar not available on Windows — skip snapshot
      console.warn(`[snapshot] tar not available, skipping tarball snapshot`);
      return { type: 'none', ref: '' };
    }
  } catch (err) {
    console.warn(`[snapshot] Failed to create tarball: ${err.message}`);
    return { type: 'none', ref: '' };
  }
}

/**
 * Roll back a workspace to a pre-session snapshot.
 * @param {string} workDir
 * @param {{ type: 'git-tag' | 'tarball' | 'none', ref: string }} snapshot
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function rollbackToSnapshot(workDir, snapshot) {
  if (!snapshot || snapshot.type === 'none') {
    return { success: false, message: 'No snapshot available for this session' };
  }

  if (snapshot.type === 'git-tag') {
    try {
      // Hard reset to the tagged commit
      execSync(`git reset --hard "${snapshot.ref}"`, {
        cwd: workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Clean untracked files that agents may have created
      execSync('git clean -fd', {
        cwd: workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      console.log(`[snapshot] Rolled back to git tag: ${snapshot.ref}`);
      return { success: true, message: `Rolled back to ${snapshot.ref}` };
    } catch (err) {
      const msg = err?.stderr?.toString?.() || err.message;
      console.error(`[snapshot] Git rollback failed: ${msg}`);
      return { success: false, message: `Git rollback failed: ${msg}` };
    }
  }

  if (snapshot.type === 'tarball') {
    try {
      // Verify tarball exists
      await fs.access(snapshot.ref);

      // Extract tarball over the workspace (destructive)
      execSync(
        `tar -xzf "${snapshot.ref}" -C "${workDir}"`,
        { cwd: workDir, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 },
      );

      console.log(`[snapshot] Restored from tarball: ${snapshot.ref}`);
      return { success: true, message: `Restored from tarball snapshot` };
    } catch (err) {
      const msg = err?.message || 'Unknown error';
      console.error(`[snapshot] Tarball rollback failed: ${msg}`);
      return { success: false, message: `Tarball rollback failed: ${msg}` };
    }
  }

  return { success: false, message: `Unknown snapshot type: ${snapshot.type}` };
}

/**
 * Get the diff between pre-session snapshot and current state.
 * Only works for git repos.
 * @param {string} workDir
 * @param {{ type: string, ref: string }} snapshot
 * @returns {{ files: string[], summary: string } | null}
 */
export function getSnapshotDiff(workDir, snapshot) {
  if (!snapshot || snapshot.type !== 'git-tag') return null;

  try {
    const diffStat = execSync(`git diff "${snapshot.ref}" --stat`, {
      cwd: workDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    }).trim();

    const nameOnly = execSync(`git diff "${snapshot.ref}" --name-only`, {
      cwd: workDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    }).trim();

    const files = nameOnly ? nameOnly.split('\n').filter(Boolean) : [];

    // Also include untracked files
    const untracked = execSync('git ls-files --others --exclude-standard', {
      cwd: workDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    }).trim();

    if (untracked) {
      for (const f of untracked.split('\n').filter(Boolean)) {
        if (!files.includes(f)) files.push(f);
      }
    }

    return { files, summary: diffStat || 'No changes' };
  } catch {
    return null;
  }
}

/**
 * Delete a snapshot tag (cleanup).
 * @param {string} workDir
 * @param {{ type: string, ref: string }} snapshot
 */
export async function deleteSnapshot(workDir, snapshot) {
  if (!snapshot) return;

  if (snapshot.type === 'git-tag') {
    try {
      execSync(`git tag -d "${snapshot.ref}"`, {
        cwd: workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch { /* tag might not exist */ }
  }

  if (snapshot.type === 'tarball') {
    try {
      await fs.unlink(snapshot.ref);
    } catch { /* file might not exist */ }
  }
}
