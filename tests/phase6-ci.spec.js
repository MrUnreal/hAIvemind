// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 6.0: CI Pipeline & Auto-Server Tests ────────────────────────────

test.describe('Playwright Config — webServer', () => {
  test('playwright.config.js has webServer array', async () => {
    const src = readFileSync(path.join(ROOT, 'playwright.config.js'), 'utf8');
    expect(src).toContain('webServer');
    // Should be an array with two entries
    expect(src).toContain('webServer: [');
  });

  test('webServer config starts Express on port 3000', async () => {
    const src = readFileSync(path.join(ROOT, 'playwright.config.js'), 'utf8');
    expect(src).toContain('node server/index.js --mock');
    expect(src).toContain('port: 3000');
  });

  test('webServer config starts Vite on port 5173', async () => {
    const src = readFileSync(path.join(ROOT, 'playwright.config.js'), 'utf8');
    expect(src).toContain('npx vite');
    expect(src).toContain('port: 5173');
  });

  test('webServer uses reuseExistingServer: true', async () => {
    const src = readFileSync(path.join(ROOT, 'playwright.config.js'), 'utf8');
    expect(src).toContain('reuseExistingServer: true');
  });
});

test.describe('Package Scripts', () => {
  test('package.json has test script', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.test).toBeDefined();
    expect(pkg.scripts.test).toContain('playwright test');
  });

  test('package.json has test:ci script', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['test:ci']).toBeDefined();
    expect(pkg.scripts['test:ci']).toContain('--forbid-only');
  });
});

test.describe('GitHub Actions CI', () => {
  test('.github/workflows/ci.yml exists', () => {
    expect(existsSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'))).toBe(true);
  });

  test('CI workflow uses node 20', () => {
    const yml = readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(yml).toContain("node-version: '20'");
  });

  test('CI workflow installs Playwright browsers', () => {
    const yml = readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(yml).toContain('playwright install');
  });

  test('CI workflow runs test:ci', () => {
    const yml = readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(yml).toContain('npm run test:ci');
  });

  test('CI workflow uploads artifacts on failure', () => {
    const yml = readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(yml).toContain('upload-artifact');
    expect(yml).toContain('if: failure()');
  });

  test('CI triggers on push to master', () => {
    const yml = readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(yml).toContain('push:');
    expect(yml).toContain('branches: [master]');
  });

  test('CI triggers on pull requests', () => {
    const yml = readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(yml).toContain('pull_request:');
  });
});

test.describe('Auto-Server Integration', () => {
  test('Express server is reachable via auto-server', async () => {
    const res = await fetch(`${API}/api/projects`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('Vite dev server is reachable via auto-server', async ({ page }) => {
    await page.goto('/');
    // The page should load and have a title or key element
    await expect(page.locator('body')).toBeAttached();
  });

  test('WebSocket connection works via auto-server', async ({ page }) => {
    // Navigate to the frontend first, then test WS from that origin
    await page.goto('/');
    const wsOk = await page.evaluate(() => {
      return new Promise((resolve) => {
        const ws = new WebSocket(`ws://${location.hostname}:3000/ws`);
        ws.onopen = () => { ws.close(); resolve(true); };
        ws.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 5000);
      });
    });
    expect(wsOk).toBe(true);
  });
});
