/**
 * Playwright global teardown — cleans up test artifact projects.
 *
 * Runs after ALL test files complete. Removes orphaned project
 * directories and prunes the project registry so the workspace
 * stays clean between test runs.
 */
import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const WORKSPACE_DIR = join(ROOT, '.haivemind-workspace');
const REGISTRY_PATH = join(WORKSPACE_DIR, 'projects.json');

/** Directories that are NOT project dirs and must never be deleted. */
const KEEP = new Set(['.haivemind', 'projects.json']);

/**
 * Pattern that matches test-generated slugs.
 * Test slugs always contain a 13-digit epoch-ms timestamp suffix.
 */
const TEST_SLUG = /\d{13,}$/;

export default async function globalTeardown() {
  if (!existsSync(WORKSPACE_DIR)) return;

  // ── 1. Delete test-artifact directories ───────────────────
  let removedDirs = 0;
  try {
    for (const entry of readdirSync(WORKSPACE_DIR)) {
      if (KEEP.has(entry)) continue;
      if (!TEST_SLUG.test(entry)) continue;          // only nuke timestamped dirs
      try {
        rmSync(join(WORKSPACE_DIR, entry), { recursive: true, force: true });
        removedDirs++;
      } catch { /* ignore ENOENT races */ }
    }
  } catch { /* WORKSPACE_DIR may not exist on first run */ }

  // ── 2. Prune registry ─────────────────────────────────────
  if (existsSync(REGISTRY_PATH)) {
    try {
      const raw = readFileSync(REGISTRY_PATH, 'utf8');
      const registry = JSON.parse(raw);
      const before = Object.keys(registry.projects || {}).length;
      for (const slug of Object.keys(registry.projects || {})) {
        if (TEST_SLUG.test(slug)) {
          delete registry.projects[slug];
        }
      }
      const after = Object.keys(registry.projects || {}).length;
      if (after < before) {
        writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf8');
      }
    } catch { /* registry may be malformed — skip silently */ }
  }

  // ── 3. Clean interrupted session checkpoints ──────────────
  const interruptedDir = join(WORKSPACE_DIR, '.haivemind', 'interrupted');
  let removedCheckpoints = 0;
  if (existsSync(interruptedDir)) {
    try {
      for (const file of readdirSync(interruptedDir)) {
        try {
          rmSync(join(interruptedDir, file), { force: true });
          removedCheckpoints++;
        } catch { /* ignore */ }
      }
    } catch { /* dir may not exist */ }
  }

  if (removedDirs > 0 || removedCheckpoints > 0) {
    console.log(`[global-teardown] Cleaned ${removedDirs} test project dirs, ${removedCheckpoints} checkpoint files`);
  }
}
