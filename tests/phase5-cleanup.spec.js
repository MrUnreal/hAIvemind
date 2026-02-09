// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

// ── Phase 5.6: Dead Code Cleanup Tests ────────────────────────────────────

test.describe('Dead Code Cleanup — server/index.js imports', () => {
  const content = readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');

  test('no duplicate path import (no "import path from")', () => {
    expect(content).not.toMatch(/import\s+path\s+from\s+['"]node:path['"]/);
  });

  test('no unused selfDev imports', () => {
    expect(content).not.toContain('prepareSelfDevWorkspace');
    expect(content).not.toContain('getWorktreeDiffSummary');
  });

  test('uses consolidated join/dirname/resolve from node:path', () => {
    expect(content).toMatch(/import\s*{[^}]*join[^}]*}\s*from\s*['"]node:path['"]/);
    expect(content).toMatch(/import\s*{[^}]*dirname[^}]*}\s*from\s*['"]node:path['"]/);
  });

  test('no path.join calls (should be join())', () => {
    expect(content).not.toMatch(/path\.join\(/);
  });

  test('no path.resolve calls (should be resolve())', () => {
    expect(content).not.toMatch(/path\.resolve\(/);
  });
});

test.describe('Dead Code Cleanup — server/config.js', () => {
  const content = readFileSync(path.join(ROOT, 'server', 'config.js'), 'utf8');

  test('no separate agentTimeoutMs export', () => {
    expect(content).not.toMatch(/export\s+const\s+agentTimeoutMs/);
  });

  test('no separate orchestratorTimeoutMs export', () => {
    expect(content).not.toMatch(/export\s+const\s+orchestratorTimeoutMs/);
  });

  test('no getModelsInTier export', () => {
    expect(content).not.toContain('getModelsInTier');
  });

  test('getModelForRetry still exported', () => {
    expect(content).toMatch(/export\s+function\s+getModelForRetry/);
  });

  test('getOrchestratorModel still exported', () => {
    expect(content).toMatch(/export\s+function\s+getOrchestratorModel/);
  });
});

test.describe('Dead Code Cleanup — package.json', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  test('uuid dependency removed', () => {
    expect(pkg.dependencies.uuid).toBeUndefined();
  });

  test('express still in dependencies', () => {
    expect(pkg.dependencies.express).toBeDefined();
  });

  test('ws still in dependencies', () => {
    expect(pkg.dependencies.ws).toBeDefined();
  });
});

test.describe('Dead Code Cleanup — client composables', () => {
  test('useSession: eventLog not exported', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'composables', 'useSession.js'), 'utf8'
    );
    expect(content).not.toMatch(/export\s+const\s+eventLog/);
    // But still defined internally
    expect(content).toContain('eventLog');
  });

  test('useSession: selectedAgent computed removed', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'composables', 'useSession.js'), 'utf8'
    );
    expect(content).not.toMatch(/export\s+const\s+selectedAgent\s*=/);
  });

  test('useSession: selectedAgentOutput computed removed', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'composables', 'useSession.js'), 'utf8'
    );
    expect(content).not.toMatch(/export\s+const\s+selectedAgentOutput\s*=/);
  });

  test('useSession: logEvent not exported', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'composables', 'useSession.js'), 'utf8'
    );
    expect(content).not.toMatch(/export\s+function\s+logEvent/);
    // But still defined internally
    expect(content).toContain('function logEvent');
  });

  test('useSession: taskAgentMap still exported', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'composables', 'useSession.js'), 'utf8'
    );
    expect(content).toMatch(/export\s+const\s+taskAgentMap/);
  });

  test('useProjectSettings: settingsLoading not exported', () => {
    const content = readFileSync(
      path.join(ROOT, 'client', 'src', 'composables', 'useProjectSettings.js'), 'utf8'
    );
    expect(content).not.toMatch(/export\s+const\s+settingsLoading/);
    expect(content).toContain('settingsLoading');
  });
});

test.describe('Dead Code Cleanup — server still works', () => {
  test('API responds after cleanup', async () => {
    const res = await fetch('http://localhost:3000/api/projects');
    expect(res.ok).toBe(true);
    const projects = await res.json();
    expect(Array.isArray(projects)).toBe(true);
  });

  test('config exports still work', async () => {
    const config = await import('../server/config.js');
    expect(config.default).toBeDefined();
    expect(config.default.port).toBe(3000);
    expect(typeof config.getModelForRetry).toBe('function');
    expect(typeof config.getOrchestratorModel).toBe('function');
  });
});
