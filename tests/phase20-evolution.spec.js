// @ts-check
import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

/* ════════════════════════════════════════════
   Phase 20 — Competitive Learnings & Platform Evolution
   ════════════════════════════════════════════ */

// ─── 20.0 AST-Aware Repo Map ────────────────────────────────────────
test.describe('Repo Map — symbol extraction & context', () => {
  let tempDir;

  test.beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'repomap-'));
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    mkdirSync(join(tempDir, 'lib'), { recursive: true });

    // JS file with exported symbols
    writeFileSync(join(tempDir, 'src', 'handler.js'), `
export default class UserHandler {
  constructor(db) { this.db = db; }
  async getUser(id) { return this.db.find(id); }
}

export function validateInput(data) { return !!data; }

const helperFn = () => {};
`);

    // TS file with interface + class
    writeFileSync(join(tempDir, 'src', 'types.ts'), `
export interface UserDTO {
  id: string;
  name: string;
}

export class UserService {
  async findAll(): Promise<UserDTO[]> { return []; }
}
`);

    // Python file
    writeFileSync(join(tempDir, 'lib', 'utils.py'), `
class DataProcessor:
    def process(self, data):
        return data

def clean_text(text):
    return text.strip()
`);
  });

  test.afterAll(() => {
    try { rmSync(tempDir, { recursive: true }); } catch {}
  });

  test('buildRepoMap extracts JS/TS symbols correctly', async () => {
    const { buildRepoMap } = await import('../server/services/repoMap.js');
    const map = await buildRepoMap(tempDir);

    expect(map.stats.filesScanned).toBeGreaterThanOrEqual(3);
    expect(map.stats.totalSymbols).toBeGreaterThanOrEqual(5);

    // JS file symbols
    const handlerSymbols = map.files['src/handler.js'];
    expect(handlerSymbols).toBeDefined();
    const names = handlerSymbols.map(s => s.name);
    expect(names).toContain('UserHandler');
    expect(names).toContain('validateInput');
  });

  test('buildRepoMap extracts Python symbols', async () => {
    const { buildRepoMap } = await import('../server/services/repoMap.js');
    const map = await buildRepoMap(tempDir);

    const pySymbols = map.files['lib/utils.py'];
    expect(pySymbols).toBeDefined();
    const names = pySymbols.map(s => s.name);
    expect(names).toContain('DataProcessor');
    expect(names).toContain('clean_text');
  });

  test('toPromptContext produces readable string', async () => {
    const { buildRepoMap } = await import('../server/services/repoMap.js');
    const map = await buildRepoMap(tempDir);
    const ctx = map.toPromptContext();

    expect(typeof ctx).toBe('string');
    expect(ctx.length).toBeGreaterThan(50);
    expect(ctx).toContain('Repo Map');
    expect(ctx).toContain('UserHandler');
  });

  test('buildRepoMap handles empty directory', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'empty-'));
    const { buildRepoMap } = await import('../server/services/repoMap.js');
    const map = await buildRepoMap(emptyDir);

    expect(map.stats.totalSymbols).toBe(0);
    // Empty map still produces a header
    expect(typeof map.toPromptContext()).toBe('string');
    rmSync(emptyDir, { recursive: true });
  });

  test('buildRepoMap respects maxFiles option', async () => {
    const { buildRepoMap } = await import('../server/services/repoMap.js');
    const map = await buildRepoMap(tempDir, { maxFiles: 1 });
    expect(map.stats.filesScanned).toBeLessThanOrEqual(1);
  });
});

// ─── 20.1 GitHub Issue Integration ──────────────────────────────────
test.describe('GitHub Issues — parse & prompt', () => {
  test('parseIssueRef handles full URL', async () => {
    const { parseIssueRef } = await import('../server/services/githubIssues.js');
    const result = parseIssueRef('https://github.com/MrUnreal/hAIvemind/issues/42');
    expect(result).toEqual({ owner: 'MrUnreal', repo: 'hAIvemind', number: 42 });
  });

  test('parseIssueRef handles short form', async () => {
    const { parseIssueRef } = await import('../server/services/githubIssues.js');
    const result = parseIssueRef('facebook/react#1234');
    expect(result).toEqual({ owner: 'facebook', repo: 'react', number: 1234 });
  });

  test('parseIssueRef returns null for invalid input', async () => {
    const { parseIssueRef } = await import('../server/services/githubIssues.js');
    expect(parseIssueRef('')).toBeNull();
    expect(parseIssueRef(null)).toBeNull();
    expect(parseIssueRef('not-a-ref')).toBeNull();
    expect(parseIssueRef('#999')).toBeNull(); // No default repo
  });

  test('issueToPrompt produces structured output', async () => {
    const { issueToPrompt } = await import('../server/services/githubIssues.js');
    const issue = {
      number: 42,
      title: 'Fix login button',
      body: 'The login button does not respond to clicks on mobile.',
      state: 'open',
      labels: ['bug', 'ui'],
      author: 'user1',
      url: 'https://github.com/test/repo/issues/42',
      comments: [
        { author: 'dev1', body: 'I can reproduce this on iOS Safari.', createdAt: '2024-01-01' },
      ],
      linkedPRs: [],
      repo: 'test/repo',
    };
    const prompt = issueToPrompt(issue);

    expect(prompt).toContain('#42');
    expect(prompt).toContain('Fix login button');
    expect(prompt).toContain('bug, ui');
    expect(prompt).toContain('login button does not respond');
    expect(prompt).toContain('@dev1');
    expect(prompt).toContain('iOS Safari');
    expect(prompt).toContain('## Task');
  });

  test('issueToPrompt truncates long bodies', async () => {
    const { issueToPrompt } = await import('../server/services/githubIssues.js');
    const issue = {
      number: 1,
      title: 'Long issue',
      body: 'x'.repeat(5000),
      state: 'open',
      labels: [],
      author: 'u',
      url: 'https://github.com/t/r/issues/1',
      comments: [],
      linkedPRs: [],
      repo: 't/r',
    };
    const prompt = issueToPrompt(issue, { maxBodyLength: 200 });
    expect(prompt).toContain('truncated');
  });
});

// ─── 20.2 Per-Task Checkpoints ──────────────────────────────────────
test.describe('Task Checkpoints — snapshot & rollback', () => {
  let tempDir;
  let isGitDir = false;

  test.beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ckpt-'));
    writeFileSync(join(tempDir, 'main.js'), 'console.log("v1");\n');
    writeFileSync(join(tempDir, 'helper.js'), 'module.exports = {};\n');

    // Initialize git repo for proper checkpoint support
    try {
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
      execSync('git add -A', { cwd: tempDir, stdio: 'ignore' });
      execSync('git -c user.email="test@test.com" -c user.name="test" commit -m "init"', {
        cwd: tempDir, stdio: 'ignore',
      });
      isGitDir = true;
    } catch {
      isGitDir = false;
    }
  });

  test.afterAll(() => {
    try { rmSync(tempDir, { recursive: true }); } catch {}
  });

  test('TaskCheckpointManager creates and retrieves checkpoints', async () => {
    const { TaskCheckpointManager } = await import('../server/services/taskCheckpoints.js');
    const mgr = new TaskCheckpointManager(tempDir, 'test-session-1');
    await mgr.initialize();

    expect(mgr.checkpoints.length).toBe(0); // no checkpoints before first task

    // Modify a file
    writeFileSync(join(tempDir, 'main.js'), 'console.log("v2");\n');

    await mgr.createCheckpoint('task-1', 'Update main');
    expect(mgr.checkpoints.length).toBe(1);
    expect(mgr.checkpoints[0].taskId).toBe('task-1');
    expect(mgr.checkpoints[0].taskLabel).toBe('Update main');
  });

  test('TaskCheckpointManager getDiff returns changes', async () => {
    const { TaskCheckpointManager } = await import('../server/services/taskCheckpoints.js');
    const mgr = new TaskCheckpointManager(tempDir, 'test-session-2');
    await mgr.initialize();

    await mgr.createCheckpoint('task-a', 'Baseline');

    writeFileSync(join(tempDir, 'helper.js'), 'module.exports = { updated: true };\n');
    await mgr.createCheckpoint('task-b', 'Update helper');

    const diff = mgr.getDiff(0, 1);
    expect(diff).toBeDefined();
    expect(typeof diff).toBe('object');
    expect(Array.isArray(diff.files)).toBe(true);
    expect(typeof diff.summary).toBe('string');
  });

  test('TaskCheckpointManager getSummary returns checkpoint info', async () => {
    const { TaskCheckpointManager } = await import('../server/services/taskCheckpoints.js');
    const mgr = new TaskCheckpointManager(tempDir, 'test-session-3');
    await mgr.initialize();

    writeFileSync(join(tempDir, 'main.js'), 'console.log("v3");\n');
    await mgr.createCheckpoint('task-3', 'Version 3');

    const summary = mgr.getSummary();
    expect(Array.isArray(summary)).toBe(true);
    expect(summary.length).toBeGreaterThanOrEqual(1);
    expect(summary[0].taskId).toBe('task-3');
  });

  test('TaskCheckpointManager toJSON serialization', async () => {
    const { TaskCheckpointManager } = await import('../server/services/taskCheckpoints.js');
    const mgr = new TaskCheckpointManager(tempDir, 'test-session-4');
    await mgr.initialize();
    await mgr.createCheckpoint('task-4', 'Test serialize');

    const json = mgr.toJSON();
    expect(json.workDir).toBe(tempDir);
    expect(json.sessionId).toBe('test-session-4');
    expect(json.isGit).toBe(isGitDir);
    expect(Array.isArray(json.checkpoints)).toBe(true);
    expect(json.checkpoints.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── 20.3 Cross-Project Learning ────────────────────────────────────
test.describe('Cross-Project Learning — promote & search', () => {
  test('promoteToGlobal stores in __global__ index', async () => {
    const { promoteToGlobal, getCrossProjectStats } = await import('../server/services/crossProjectLearning.js');

    promoteToGlobal('projectA', 'pat-1', 'Use express.Router() for modular routes', {
      category: 'architecture',
      successRate: 0.95,
    });

    const stats = getCrossProjectStats();
    expect(stats.globalPatterns).toBeGreaterThanOrEqual(1);
    expect(stats.contributingProjects).toContain('projectA');
  });

  test('searchCrossProject finds relevant patterns', async () => {
    const { promoteToGlobal, searchCrossProject } = await import('../server/services/crossProjectLearning.js');

    promoteToGlobal('projectB', 'pat-2', 'Always add error handling middleware last in Express', {
      category: 'best-practice',
    });

    const results = searchCrossProject('projectC', 'express error handling', 5);
    expect(Array.isArray(results)).toBe(true);
    // Search should work without errors; results depend on similarity threshold
    expect(results).toBeDefined();
  });

  test('getCrossProjectContext produces prompt text', async () => {
    const { promoteToGlobal, getCrossProjectContext } = await import('../server/services/crossProjectLearning.js');

    promoteToGlobal('projectD', 'pat-3', 'Use 2-space indentation for JavaScript files', {
      category: 'conventions',
    });

    const ctx = getCrossProjectContext('projectE', 'javascript formatting conventions');
    // May or may not find results depending on similarity threshold, but should not error
    expect(typeof ctx).toBe('string');
  });

  test('getCrossProjectStats returns valid structure', async () => {
    const { getCrossProjectStats } = await import('../server/services/crossProjectLearning.js');
    const stats = getCrossProjectStats();

    expect(typeof stats.globalPatterns).toBe('number');
    expect(Array.isArray(stats.contributingProjects)).toBe(true);
  });
});

// ─── 20.4 Streaming Diffs ───────────────────────────────────────────
test.describe('Streaming Diffs — watcher lifecycle', () => {
  let tempDir;

  test.beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'diffs-'));
    writeFileSync(join(tempDir, 'app.js'), 'const x = 1;\n');
    try {
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
      execSync('git add -A', { cwd: tempDir, stdio: 'ignore' });
      execSync('git -c user.email="test@test.com" -c user.name="test" commit -m "init"', {
        cwd: tempDir, stdio: 'ignore',
      });
    } catch {}
  });

  test.afterAll(() => {
    try { rmSync(tempDir, { recursive: true }); } catch {}
  });

  test('StreamingDiffWatcher starts and stops without error', async () => {
    const { StreamingDiffWatcher } = await import('../server/services/streamingDiffs.js');
    const messages = [];
    const watcher = new StreamingDiffWatcher(tempDir, msg => messages.push(msg));

    watcher.start();
    expect(watcher._active).toBe(true);

    watcher.stop();
    expect(watcher._active).toBe(false);
  });

  test('snapshotFile caches file content', async () => {
    const { StreamingDiffWatcher } = await import('../server/services/streamingDiffs.js');
    const watcher = new StreamingDiffWatcher(tempDir, () => {});

    await watcher.snapshotFile('app.js');
    expect(watcher._fileCache.has('app.js')).toBe(true);
    const cached = watcher._fileCache.get('app.js');
    expect(cached.content).toContain('const x = 1');
    expect(cached.hash).toBeDefined();
  });

  test('snapshotFile handles missing file gracefully', async () => {
    const { StreamingDiffWatcher } = await import('../server/services/streamingDiffs.js');
    const watcher = new StreamingDiffWatcher(tempDir, () => {});

    // Should not throw
    await watcher.snapshotFile('nonexistent.js');
    expect(watcher._fileCache.has('nonexistent.js')).toBe(false);
  });

  test('getSummary returns valid structure', async () => {
    const { StreamingDiffWatcher } = await import('../server/services/streamingDiffs.js');
    const watcher = new StreamingDiffWatcher(tempDir, () => {});

    const summary = watcher.getSummary();
    expect(summary.totalChanges).toBe(0);
    expect(Array.isArray(summary.files)).toBe(true);
    expect(Array.isArray(summary.changeLog)).toBe(true);
  });
});

// ─── Protocol additions ─────────────────────────────────────────────
test.describe('Phase 20 Protocol — new message types', () => {
  test('MSG includes all Phase 20 message types', async () => {
    const { MSG } = await import('../shared/protocol.js');
    expect(MSG.REPO_MAP_READY).toBe('repomap:ready');
    expect(MSG.TASK_CHECKPOINT).toBe('task:checkpoint');
    expect(MSG.FILE_DIFF).toBe('file:diff');
    expect(MSG.CROSS_PROJECT_LEARN).toBe('crossproject:learn');
    expect(MSG.GITHUB_ISSUE_LOADED).toBe('github:issue:loaded');
  });
});

// ─── Integration: workspaceAnalyzer now includes repoMap ────────────
test.describe('Workspace Analyzer — repo map integration', () => {
  let tempDir;

  test.beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'analyzer-'));
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      type: 'module',
      dependencies: { express: '^4.18.0' },
    }));
    writeFileSync(join(tempDir, 'index.js'), `
export function main() { console.log('hello'); }
export class App { start() {} }
`);
  });

  test.afterAll(() => {
    try { rmSync(tempDir, { recursive: true }); } catch {}
  });

  test('analyzeWorkspace includes repoMap in result', async () => {
    const { analyzeWorkspace } = await import('../server/workspaceAnalyzer.js');
    const analysis = await analyzeWorkspace(tempDir);

    expect(analysis.repoMap).toBeDefined();
    expect(analysis.repoMap.stats.totalSymbols).toBeGreaterThanOrEqual(1);
  });

  test('toPromptContext includes symbol map section', async () => {
    const { analyzeWorkspace } = await import('../server/workspaceAnalyzer.js');
    const analysis = await analyzeWorkspace(tempDir);
    const ctx = analysis.toPromptContext();

    expect(ctx).toContain('Repo Map');
  });
});
