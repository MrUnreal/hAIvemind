import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKSPACE_ROOT_DIR = '.haivemind-workspace';
const SELF_SUBDIR = 'self';

/**
 * Prepare a self-dev git worktree for the given branch.
 * Reuses an existing worktree directory if it already exists.
 * @param {string} repoRoot - Absolute or relative path to the repo root.
 * @param {string} featureBranch - Name of the feature branch.
 * @returns {string} Absolute path to the worktree directory.
 */
export function prepareSelfDevWorkspace(repoRoot, featureBranch) {
  const root = resolve(repoRoot);
  const workspaceBase = resolve(root, WORKSPACE_ROOT_DIR, SELF_SUBDIR);
  const worktreePath = resolve(workspaceBase, featureBranch);

  try {
    if (!existsSync(workspaceBase)) {
      mkdirSync(workspaceBase, { recursive: true });
    }

    if (!existsSync(worktreePath)) {
      const cmd = `git worktree add "${worktreePath}" -b "${featureBranch}"`;
      execSync(cmd, {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }
  } catch (error) {
    const stderr = error?.stderr?.toString?.() || '';
    const message = stderr || error.message || String(error);
    console.error(`[selfDev] Failed to prepare worktree for ${featureBranch}: ${message}`);
  }

  return worktreePath;
}

/**
 * Get a summary of changes between master and the given branch.
 * @param {string} repoRoot - Absolute or relative path to the repo root.
 * @param {string} branch - Branch name to diff against master.
 * @returns {string} Git diff --stat output (may be empty on error).
 */
export function getWorktreeDiffSummary(repoRoot, branch) {
  const root = resolve(repoRoot);

  try {
    const cmd = `git diff master...${branch} --stat`;
    const output = execSync(cmd, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return output.trim();
  } catch (error) {
    const stderr = error?.stderr?.toString?.() || '';
    const message = stderr || error.message || String(error);
    console.error(`[selfDev] Failed to get diff summary for ${branch}: ${message}`);
    return '';
  }
}

/**
 * Clean up the self-dev worktree and delete the branch.
 * Swallows git errors after logging so callers don't need to handle them.
 * @param {string} repoRoot - Absolute or relative path to the repo root.
 * @param {string} branch - Branch name whose worktree should be removed.
 */
export function cleanupWorktree(repoRoot, branch) {
  const root = resolve(repoRoot);
  const worktreePath = resolve(root, WORKSPACE_ROOT_DIR, SELF_SUBDIR, branch);

  try {
    const cmdRemove = `git worktree remove "${worktreePath}"`;
    execSync(cmdRemove, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = error?.stderr?.toString?.() || '';
    const message = stderr || error.message || String(error);
    console.error(`[selfDev] Failed to remove worktree for ${branch}: ${message}`);
  }

  try {
    const cmdDeleteBranch = `git branch -d "${branch}"`;
    execSync(cmdDeleteBranch, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = error?.stderr?.toString?.() || '';
    const message = stderr || error.message || String(error);
    console.error(`[selfDev] Failed to delete branch ${branch}: ${message}`);
  }
}
