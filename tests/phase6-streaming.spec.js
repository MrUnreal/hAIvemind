// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 6.3: Real-Time Agent Output Streaming Tests ──────────────────

test.describe('Agent Streaming — Protocol', () => {
  test('AGENT_STREAM message type is defined', async () => {
    const mod = await import('../shared/protocol.js');
    expect(mod.MSG.AGENT_STREAM).toBe('agent:stream');
  });

  test('AGENT_OUTPUT message type still exists', async () => {
    const mod = await import('../shared/protocol.js');
    expect(mod.MSG.AGENT_OUTPUT).toBe('agent:output');
  });
});

test.describe('Agent Streaming — Server: agentManager.js', () => {
  test('agentManager.js has throttled stream buffer', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'agentManager.js'), 'utf8');
    expect(src).toContain('STREAM_INTERVAL_MS');
    expect(src).toContain('streamBuffer');
    expect(src).toContain('flushStream');
  });

  test('agentManager.js emits AGENT_STREAM', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'agentManager.js'), 'utf8');
    expect(src).toContain('MSG.AGENT_STREAM');
    expect(src).toContain('appendStream');
  });

  test('agentManager.js still emits AGENT_OUTPUT per chunk', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'agentManager.js'), 'utf8');
    expect(src).toContain('MSG.AGENT_OUTPUT');
  });

  test('stream buffer is flushed on process close', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'agentManager.js'), 'utf8');
    // Should call flushStream in onClose handler
    expect(src).toMatch(/onClose.*flushStream|flushStream.*onClose/s);
  });

  test('stream buffer is flushed on error', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'agentManager.js'), 'utf8');
    // Should call flushStream in onError handler  
    expect(src).toMatch(/onError.*flushStream|flushStream.*onError/s);
  });
});

test.describe('Agent Streaming — Client: App.vue', () => {
  test('App.vue handles agent:stream messages', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'App.vue'), 'utf8');
    expect(src).toContain("on('agent:stream'");
  });

  test('App.vue still handles agent:output messages', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'App.vue'), 'utf8');
    expect(src).toContain("on('agent:output'");
  });
});

test.describe('Agent Detail — Enhanced UI', () => {
  test('AgentDetail.vue has search input', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'AgentDetail.vue'), 'utf8');
    expect(src).toContain('searchQuery');
    expect(src).toContain('search-input');
    expect(src).toContain('Search output');
  });

  test('AgentDetail.vue has raw/summary toggle', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'AgentDetail.vue'), 'utf8');
    expect(src).toContain('showSummary');
    expect(src).toContain('toggle-btn');
    expect(src).toContain('summaryOutput');
  });

  test('AgentDetail.vue has search highlighting', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'AgentDetail.vue'), 'utf8');
    expect(src).toContain('search-highlight');
    expect(src).toContain('highlightMatches');
    expect(src).toContain('matchCount');
  });

  test('AgentDetail.vue has HTML escaping for safe v-html', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'AgentDetail.vue'), 'utf8');
    expect(src).toContain('escapeHtml');
    expect(src).toContain('v-html');
  });

  test('AgentDetail.vue shows match count', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'AgentDetail.vue'), 'utf8');
    expect(src).toContain('search-results');
    expect(src).toContain('matchCount');
  });

  test('AgentDetail.vue retains auto-scroll', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'AgentDetail.vue'), 'utf8');
    expect(src).toContain('scrollTop');
    expect(src).toContain('scrollHeight');
  });

  test('summary filter extracts important lines', () => {
    const src = readFileSync(path.join(ROOT, 'client', 'src', 'components', 'AgentDetail.vue'), 'utf8');
    expect(src).toContain('summaryOutput');
    expect(src).toContain("includes('error')");
    expect(src).toContain("includes('file')");
  });
});

test.describe('Agent Streaming — Integration', () => {
  test('server is running and responding', async () => {
    const res = await fetch(`${API}/api/projects`);
    expect(res.ok).toBe(true);
  });

  test('mock session can be started (agents produce output)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.status-dot.green', { timeout: 10000 });

    // Create project
    const createInput = page.locator('input[placeholder*="project name"]');
    await createInput.fill('stream-test-' + Date.now());
    await page.click('button:has-text("Create")');
    await page.waitForTimeout(1000);

    // Navigate to session
    const newBtn = page.locator('button:has-text("New Session"), button:has-text("Start Session")').first();
    if (await newBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await newBtn.click();
    }

    // Submit a build
    await page.fill('textarea', 'Build a hello world test');
    await page.click('.btn-primary:has-text("Build")');

    // Wait for workspace to appear (agents running)
    await page.waitForSelector('.workspace', { timeout: 15000 });

    // Verify agent nodes appear
    await expect(page.locator('.vue-flow')).toBeVisible({ timeout: 5000 });
  });
});
