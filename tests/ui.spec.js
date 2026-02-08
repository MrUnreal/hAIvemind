import { test, expect } from '@playwright/test';

// ─── Helper: wait for WebSocket connection ───
async function waitForConnection(page) {
  // The status dot turns green when connected
  await page.waitForSelector('.status-dot.green', { timeout: 10000 });
}

// ─── Helper: create a unique test project ───
async function createProject(page, name) {
  await page.fill('input[placeholder="New project name..."]', name);
  await page.click('button:has-text("Create")');
  // Wait for the project to be selected and session history to show
  await page.waitForSelector('.session-history, .prompt-container', { timeout: 10000 });
}

// ─── Helper: navigate to prompt input from session history ───
async function goToPrompt(page) {
  // SessionHistory shows both "+ New Session" (header) and "+ Start Session" (empty state)
  // Use first() to avoid strict mode violation
  const btn = page.locator('button:has-text("New Session"), button:has-text("Start Session")').first();
  await btn.click();
  await expect(page.locator('.prompt-container')).toBeVisible();
}

// ═══════════════════════════════════════════════════
//  TEST 1: App loads and connects to WebSocket
// ═══════════════════════════════════════════════════
test('app loads with header, WebSocket connects, project picker shows', async ({ page }) => {
  await page.goto('/');

  // Header is visible with logo
  await expect(page.locator('.logo')).toContainText('hAIvemind');

  // WebSocket connects (green dot)
  await waitForConnection(page);
  await expect(page.locator('.header-meta')).toContainText('Connected');

  // Project picker is showing
  await expect(page.locator('h2')).toContainText('Select a Project');
  await expect(page.locator('input[placeholder="New project name..."]')).toBeVisible();
});

// ═══════════════════════════════════════════════════
//  TEST 2: Create a new project
// ═══════════════════════════════════════════════════
test('can create a new project and see session history', async ({ page }) => {
  await page.goto('/');
  await waitForConnection(page);

  const projectName = `test-project-${Date.now()}`;
  await createProject(page, projectName);

  // Should see the project badge in the header
  await expect(page.locator('.project-badge')).toContainText(projectName);

  // Should be on the session history or prompt screen
  const historyOrPrompt = page.locator('.session-history, .prompt-container');
  await expect(historyOrPrompt).toBeVisible();
});

// ═══════════════════════════════════════════════════
//  TEST 3: Navigate from project to prompt input
// ═══════════════════════════════════════════════════
test('can navigate to prompt input and see model tier info', async ({ page }) => {
  await page.goto('/');
  await waitForConnection(page);

  const projectName = `test-prompt-${Date.now()}`;
  await createProject(page, projectName);

  // Navigate to prompt input
  await goToPrompt(page);
  await expect(page.locator('h2')).toContainText('What would you like to build?');

  // Textarea should be enabled (connected)
  const textarea = page.locator('textarea');
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeEnabled();

  // Build button should be visible
  await expect(page.locator('button:has-text("Build")')).toBeVisible();

  // Model tier info section should be visible
  await expect(page.locator('.tier-info')).toBeVisible();
  await expect(page.locator('.tier.t0')).toContainText('T0');
});

// ═══════════════════════════════════════════════════
//  TEST 4: Submit prompt and see DAG (mock mode)
// ═══════════════════════════════════════════════════
test('can submit prompt and see DAG nodes appear in mock mode', async ({ page }) => {
  await page.goto('/');
  await waitForConnection(page);

  const projectName = `test-dag-${Date.now()}`;
  await createProject(page, projectName);

  // Navigate to prompt
  await goToPrompt(page);

  // Type a prompt and submit
  await page.fill('textarea', 'Build a REST API with Express for a todo app');
  await page.click('button:has-text("Build")');

  // Wait for the workspace/flow canvas to appear (plan:created received)
  await page.waitForSelector('.workspace', { timeout: 15000 });

  // Vue Flow canvas should be present
  await expect(page.locator('.vue-flow')).toBeVisible();

  // Wait for nodes to appear (mock generates 5 tasks)
  await page.waitForSelector('.vue-flow__node', { timeout: 10000 });
  const nodes = page.locator('.vue-flow__node');
  const count = await nodes.count();
  expect(count).toBeGreaterThanOrEqual(3); // At least some tasks visible

  // Side panel should be visible (chat tab auto-opens)
  await expect(page.locator('.side-panel')).toBeVisible();
});

// ═══════════════════════════════════════════════════
//  TEST 5: Full mock session runs to completion
// ═══════════════════════════════════════════════════
test('mock session runs to completion with cost badge', async ({ page }) => {
  await page.goto('/');
  await waitForConnection(page);

  const projectName = `test-complete-${Date.now()}`;
  await createProject(page, projectName);

  await goToPrompt(page);

  await page.fill('textarea', 'Build a CLI tool');
  await page.click('button:has-text("Build")');

  // Wait for session to complete (mock agents complete quickly)
  await page.waitForSelector('.cost-badge', { timeout: 45000 });

  // Cost badge should show premium request count
  await expect(page.locator('.cost-badge')).toBeVisible();

  // Replay button should appear after session
  await expect(page.locator('.replay-btn')).toBeVisible();
});

// ═══════════════════════════════════════════════════
//  TEST 6: Click node opens agent detail panel
// ═══════════════════════════════════════════════════
test('clicking a DAG node opens agent detail panel', async ({ page }) => {
  await page.goto('/');
  await waitForConnection(page);

  const projectName = `test-panel-${Date.now()}`;
  await createProject(page, projectName);

  await goToPrompt(page);

  await page.fill('textarea', 'Build a thing');

  // Use locator-based click with retry to handle DOM detachment during re-render
  await page.locator('.btn-primary:has-text("Build")').click({ timeout: 10000 });

  // Wait for task nodes to appear (not the __start__ bookend)
  await page.waitForSelector('.vue-flow__node:not([data-id="__start__"])', { timeout: 20000 });

  // Wait for nodes to settle (Vue Flow auto-focus animation)
  await page.waitForTimeout(2000);

  // Click a real task node (skip the bookend)
  const taskNode = page.locator('.vue-flow__node:not([data-id="__start__"])').first();
  await taskNode.click({ force: true });

  // Agent detail panel should open (side panel expands, Agent tab active)
  await expect(page.locator('.tab-btn.active')).toContainText('Agent');
  await expect(page.locator('.side-panel:not(.collapsed)')).toBeVisible();
});

// ═══════════════════════════════════════════════════
//  TEST 7: Logo click returns to project picker
// ═══════════════════════════════════════════════════
test('clicking logo returns to project picker', async ({ page }) => {
  await page.goto('/');
  await waitForConnection(page);

  const projectName = `test-nav-${Date.now()}`;
  await createProject(page, projectName);

  // Should be on session history
  await expect(page.locator('.project-badge')).toBeVisible();

  // Click logo to go home
  await page.click('.logo');

  // Should be back on project picker
  await expect(page.locator('h2')).toContainText('Select a Project');
  // Project badge should be gone
  await expect(page.locator('.project-badge')).not.toBeVisible();
});

// ═══════════════════════════════════════════════════
//  TEST 8: Project badge click returns to sessions
// ═══════════════════════════════════════════════════
test('clicking project badge returns to session history', async ({ page }) => {
  await page.goto('/');
  await waitForConnection(page);

  const projectName = `test-badge-${Date.now()}`;
  await createProject(page, projectName);

  // Go to prompt
  await goToPrompt(page);

  // Click project badge
  await page.click('.project-badge');

  // Should be back on session history
  const historyOrEmpty = page.locator('.session-history');
  await expect(historyOrEmpty).toBeVisible();
});

// ═══════════════════════════════════════════════════
//  TEST 9: Side panel collapse/expand
// ═══════════════════════════════════════════════════
test('side panel can be collapsed and expanded', async ({ page }) => {
  await page.goto('/');
  await waitForConnection(page);

  const projectName = `test-collapse-${Date.now()}`;
  await createProject(page, projectName);

  await goToPrompt(page);

  await page.fill('textarea', 'Build something');
  await page.click('button:has-text("Build")');

  // Wait for workspace
  await page.waitForSelector('.workspace', { timeout: 15000 });

  // Side panel should auto-open for chat
  await expect(page.locator('.side-panel:not(.collapsed)')).toBeVisible();

  // Click collapse button
  await page.click('.tab-collapse');
  await expect(page.locator('.side-panel.collapsed')).toBeVisible();

  // Click expand button
  await page.click('.tab-collapse');
  await expect(page.locator('.side-panel:not(.collapsed)')).toBeVisible();
});

// ═══════════════════════════════════════════════════
//  TEST 10: Health endpoint returns expected fields
// ═══════════════════════════════════════════════════
test('health endpoint returns all expected fields', async ({ request }) => {
  const response = await request.get('http://localhost:3000/api/health');
  expect(response.ok()).toBeTruthy();

  const body = await response.json();
  expect(body.status).toBe('ok');
  expect(body).toHaveProperty('sessions');
  expect(body).toHaveProperty('projects');
  expect(body).toHaveProperty('clients');
  expect(body).toHaveProperty('activeLocks');
});

// ═══════════════════════════════════════════════════
//  TEST 11: Projects REST API
// ═══════════════════════════════════════════════════
test('projects REST API - list, create, delete', async ({ request }) => {
  // List projects
  const listRes = await request.get('http://localhost:3000/api/projects');
  expect(listRes.ok()).toBeTruthy();
  const projects = await listRes.json();
  expect(Array.isArray(projects)).toBeTruthy();

  // Create a project
  const createRes = await request.post('http://localhost:3000/api/projects', {
    data: { name: `api-test-${Date.now()}` },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();
  expect(created).toHaveProperty('slug');
  expect(created).toHaveProperty('name');

  // Delete the project
  const deleteRes = await request.delete(`http://localhost:3000/api/projects/${created.slug}`);
  expect(deleteRes.ok()).toBeTruthy();
});

// ═══════════════════════════════════════════════════
//  TEST 12: Templates API
// ═══════════════════════════════════════════════════
test('templates API returns valid templates', async ({ request }) => {
  const response = await request.get('http://localhost:3000/api/templates');
  expect(response.ok()).toBeTruthy();

  const templates = await response.json();
  expect(Array.isArray(templates)).toBeTruthy();
  expect(templates.length).toBeGreaterThan(0);

  // Each template should have required fields
  for (const t of templates) {
    expect(t).toHaveProperty('id');
    expect(t).toHaveProperty('name');
    expect(t).toHaveProperty('tasks');
    expect(Array.isArray(t.tasks)).toBeTruthy();
  }
});
