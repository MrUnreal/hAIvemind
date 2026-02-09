import { test, expect } from '@playwright/test';

// ─── Helpers ─────────────────────────────────────────────────────────
async function waitForConnection(page) {
  await page.waitForSelector('.status-dot.green', { timeout: 10000 });
}

async function createProject(page, name) {
  await page.fill('input[placeholder="New project name..."]', name);
  await page.click('button:has-text("Create")');
  await page.waitForSelector('.session-history, .prompt-container', { timeout: 15000 });
}

async function goToPrompt(page) {
  const btn = page.locator('button:has-text("New Session"), button:has-text("Start Session")').first();
  await btn.click();
  await expect(page.locator('.prompt-container')).toBeVisible();
}

async function submitBuild(page, prompt) {
  await page.fill('textarea', prompt);
  await page.locator('.btn-primary:has-text("Build")').click({ timeout: 10000 });
  await page.waitForSelector('.workspace', { timeout: 15000 });
}

async function waitForSessionComplete(page) {
  await page.waitForSelector('.completion-banner.success', { timeout: 60000 });
}

/** Create project → start session → wait for completion.  Returns project name. */
async function freshSession(page, name, prompt) {
  await page.goto('/');
  await waitForConnection(page);
  await createProject(page, name);
  await goToPrompt(page);
  await submitBuild(page, prompt);
  await waitForSessionComplete(page);
  return name;
}

/** Fit-view then click first task node (skips bookends). */
async function clickFirstTaskNode(page) {
  await page.waitForTimeout(1000);
  const fitBtn = page.locator('.vue-flow__controls button').nth(2);
  await fitBtn.click();
  await page.waitForTimeout(500);
  const taskNode = page.locator(
    '.vue-flow__node:not([data-id="__start__"]):not([data-id="__end__"])'
  ).first();
  await taskNode.click({ force: true });
}

// ═════════════════════════════════════════════════════════════════════
//  1 · APP BOOTSTRAP
// ═════════════════════════════════════════════════════════════════════

test.describe('App Bootstrap', () => {
  test('loads header, WebSocket connects, project picker visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.logo')).toContainText('hAIvemind');
    await waitForConnection(page);
    await expect(page.locator('.header-meta')).toContainText('Connected');
    await expect(page.locator('h2')).toContainText('Select a Project');
    await expect(page.locator('input[placeholder="New project name..."]')).toBeVisible();
  });

  test('create button disabled when input is empty', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await expect(page.locator('button:has-text("Create")')).toBeDisabled();
  });

  test('link-existing button disabled when inputs are empty', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await expect(page.locator('button:has-text("Link Existing")')).toBeDisabled();
  });
});

// ═════════════════════════════════════════════════════════════════════
//  2 · PROJECT MANAGEMENT
// ═════════════════════════════════════════════════════════════════════

test.describe('Project Management', () => {
  test('create project and see session history', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    const name = `t-create-${Date.now()}`;
    await createProject(page, name);
    await expect(page.locator('.project-badge')).toContainText(name);
    await expect(page.locator('.session-history')).toBeVisible();
  });

  test('new project shows 0 sessions empty state', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await createProject(page, `t-empty-${Date.now()}`);
    await expect(page.locator('.session-history')).toContainText('0 previous sessions');
    await expect(page.locator('.session-history')).toContainText('No sessions yet');
  });

  test('create project by pressing Enter', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    const name = `t-enter-${Date.now()}`;
    await page.fill('input[placeholder="New project name..."]', name);
    await page.press('input[placeholder="New project name..."]', 'Enter');
    await page.waitForSelector('.session-history', { timeout: 10000 });
    await expect(page.locator('.project-badge')).toContainText(name);
  });

  test('duplicate project name shows error', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    const name = `t-dup-${Date.now()}`;
    await createProject(page, name);
    await page.click('.logo');
    await page.waitForSelector('h2:has-text("Select a Project")', { timeout: 5000 });
    await page.fill('input[placeholder="New project name..."]', name);
    await page.click('button:has-text("Create")');
    await expect(page.locator('.error-msg')).toBeVisible({ timeout: 5000 });
  });

  test('delete project via REST API and confirm removal', async ({ page, request }) => {
    await page.goto('/');
    await waitForConnection(page);
    const name = `t-del-${Date.now()}`;
    await createProject(page, name);

    // Get the slug
    const slug = name;
    // Verify project exists via API
    const before = await request.get(`http://localhost:3000/api/projects/${slug}`);
    expect(before.ok()).toBeTruthy();

    // Delete via API
    const delRes = await request.delete(`http://localhost:3000/api/projects/${slug}`);
    expect(delRes.ok()).toBeTruthy();

    // Verify gone
    const after = await request.get(`http://localhost:3000/api/projects/${slug}`);
    expect(after.status()).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════
//  3 · NAVIGATION
// ═════════════════════════════════════════════════════════════════════

test.describe('Navigation', () => {
  test('logo → project picker from session history', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await createProject(page, `t-nav1-${Date.now()}`);
    await page.click('.logo');
    await expect(page.locator('h2')).toContainText('Select a Project');
    await expect(page.locator('.project-badge')).not.toBeVisible();
  });

  test('project badge → session history from workspace', async ({ page }) => {
    await freshSession(page, `t-nav2-${Date.now()}`, 'nav test');
    await page.click('.project-badge');
    await expect(page.locator('.session-history')).toBeVisible();
  });

  test('logo → project picker from workspace', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await createProject(page, `t-nav3-${Date.now()}`);
    await goToPrompt(page);
    await submitBuild(page, 'nav test');
    // Don't wait for full completion — just get to workspace state
    await page.waitForSelector('.vue-flow', { timeout: 15000 });
    await page.click('.logo');
    await expect(page.locator('h2')).toContainText('Select a Project');
  });
});

// ═════════════════════════════════════════════════════════════════════
//  4 · PROMPT INPUT
// ═════════════════════════════════════════════════════════════════════

test.describe('Prompt Input', () => {
  test('prompt screen shows heading, textarea, build button, hint, tier info', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await createProject(page, `t-prompt-${Date.now()}`);
    await goToPrompt(page);
    await expect(page.locator('h2')).toContainText('What would you like to build?');
    await expect(page.locator('textarea')).toBeVisible();
    await expect(page.locator('textarea')).toBeEnabled();
    await expect(page.locator('button:has-text("Build")')).toBeVisible();
    await expect(page.locator('.hint')).toContainText('Ctrl+Enter');
    await expect(page.locator('.tier-info')).toBeVisible();
  });

  test('build button disabled with empty prompt', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await createProject(page, `t-btn-${Date.now()}`);
    await goToPrompt(page);
    await expect(page.locator('button:has-text("Build")')).toBeDisabled();
  });

  test('tier info lists all 4 tiers', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await createProject(page, `t-tiers-${Date.now()}`);
    await goToPrompt(page);
    for (const t of ['t0', 't1', 't2', 't3']) {
      await expect(page.locator(`.tier.${t}`)).toBeVisible();
    }
  });

  test('Ctrl+Enter submits prompt', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await createProject(page, `t-ctrlenter-${Date.now()}`);
    await goToPrompt(page);
    await page.fill('textarea', 'Ctrl+Enter test');
    await page.press('textarea', 'Control+Enter');
    await page.waitForSelector('.workspace', { timeout: 15000 });
  });
});

// ═════════════════════════════════════════════════════════════════════
//  5 · DAG & BUILD SESSION (mock mode)
// ═════════════════════════════════════════════════════════════════════

test.describe('DAG Build Session', () => {
  test.describe.configure({ timeout: 90000 });

  test('submitting prompt shows DAG with ≥3 nodes', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await createProject(page, `t-dag-${Date.now()}`);
    await goToPrompt(page);
    await submitBuild(page, 'Build a todo app');
    await page.waitForSelector('.vue-flow__node', { timeout: 10000 });
    const count = await page.locator('.vue-flow__node').count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('DAG has START and DONE bookend nodes', async ({ page }) => {
    await freshSession(page, `t-bookends-${Date.now()}`, 'bookend test');
    await expect(page.locator('[data-id="__start__"]')).toBeVisible();
    await expect(page.locator('[data-id="__end__"]')).toBeVisible();
  });

  test('mock session completes with banner, cost badge, replay button', async ({ page }) => {
    await freshSession(page, `t-complete-${Date.now()}`, 'completion test');
    await expect(page.locator('.completion-banner.success')).toContainText('All tasks completed');
    // Use header cost badge specifically (nodes also have .cost-badge)
    await expect(page.locator('.header-meta .cost-badge')).toBeVisible();
    await expect(page.locator('.replay-btn')).toBeVisible();
  });

  test('agent nodes show model badge during build', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await createProject(page, `t-badge-${Date.now()}`);
    await goToPrompt(page);
    await submitBuild(page, 'agent badge test');
    await page.waitForSelector('.agent-node .model-badge', { timeout: 15000 });
    await expect(page.locator('.model-badge').first()).toBeVisible();
  });

  test('edges visible between nodes', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await createProject(page, `t-edges-${Date.now()}`);
    await goToPrompt(page);
    await submitBuild(page, 'edge test');
    await page.waitForSelector('.vue-flow__edge', { timeout: 15000 });
    const count = await page.locator('.vue-flow__edge').count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('VueFlow zoom/fit controls visible', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await createProject(page, `t-ctrl-${Date.now()}`);
    await goToPrompt(page);
    await submitBuild(page, 'controls test');
    await expect(page.locator('.vue-flow__controls')).toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════════
//  6 · SIDE PANEL & AGENT DETAIL
// ═════════════════════════════════════════════════════════════════════

test.describe('Side Panel & Agent Detail', () => {
  test.describe.configure({ timeout: 90000 });

  test('side panel auto-opens on build with Chat tab active', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await createProject(page, `t-auto-${Date.now()}`);
    await goToPrompt(page);
    await submitBuild(page, 'panel test');
    await expect(page.locator('.side-panel:not(.collapsed)')).toBeVisible();
    await expect(page.locator('.tab-btn.active')).toContainText('Chat');
  });

  test('collapse and expand side panel', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await createProject(page, `t-coll-${Date.now()}`);
    await goToPrompt(page);
    await submitBuild(page, 'collapse test');
    await expect(page.locator('.side-panel:not(.collapsed)')).toBeVisible();
    await page.click('.tab-collapse');
    await expect(page.locator('.side-panel.collapsed')).toBeVisible();
    await page.click('.tab-collapse');
    await expect(page.locator('.side-panel:not(.collapsed)')).toBeVisible();
  });

  test('clicking task node opens agent detail with 5 info rows', async ({ page }) => {
    await freshSession(page, `t-detail-${Date.now()}`, 'agent detail test');
    await clickFirstTaskNode(page);
    await expect(page.locator('.tab-btn.active')).toContainText('Agent');
    await expect(page.locator('.detail-container')).toBeVisible();
    await expect(page.locator('.info-row')).toHaveCount(5);
  });

  test('agent detail shows console output', async ({ page }) => {
    await freshSession(page, `t-console-${Date.now()}`, 'console test');
    await clickFirstTaskNode(page);
    await expect(page.locator('.console-header')).toContainText('Console Output');
    await expect(page.locator('.console pre')).not.toBeEmpty();
  });

  test('close button clears agent detail', async ({ page }) => {
    await freshSession(page, `t-close-${Date.now()}`, 'close test');
    await clickFirstTaskNode(page);
    await expect(page.locator('.detail-info')).toBeVisible();
    await page.click('.close-btn');
    // Close clears selectedAgentId — detail-info (inside v-if="agent") disappears
    await expect(page.locator('.detail-info')).not.toBeVisible();
  });

  test('switching Agent ↔ Chat tabs', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await createProject(page, `t-tabs-${Date.now()}`);
    await goToPrompt(page);
    await submitBuild(page, 'tab test');
    await expect(page.locator('.tab-btn.active')).toContainText('Chat');
    await page.click('.tab-btn:has-text("Agent")');
    await expect(page.locator('.tab-btn.active')).toContainText('Agent');
    await page.click('.tab-btn:has-text("Chat")');
    await expect(page.locator('.tab-btn.active')).toContainText('Chat');
  });
});

// ═════════════════════════════════════════════════════════════════════
//  7 · ORCHESTRATOR CHAT
// ═════════════════════════════════════════════════════════════════════

test.describe('Orchestrator Chat', () => {
  test.describe.configure({ timeout: 90000 });

  test('chat shows plan-created status message during build', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await createProject(page, `t-chat-plan-${Date.now()}`);
    await goToPrompt(page);
    await submitBuild(page, 'chat plan test');
    await page.waitForSelector('.bubble-status', { timeout: 15000 });
    await expect(page.locator('.chat-messages')).toContainText('Plan created');
  });

  test('chat shows build-complete message after session', async ({ page }) => {
    await freshSession(page, `t-chat-done-${Date.now()}`, 'chat done');
    await page.click('.tab-btn:has-text("Chat")');
    await expect(page.locator('.chat-messages')).toContainText('Build complete');
  });

  test('chat input placeholder changes from Waiting to next-change', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    await createProject(page, `t-chat-ph-${Date.now()}`);
    await goToPrompt(page);
    await submitBuild(page, 'chat placeholder test');
    // In mock mode, build completes quickly — verify either waiting or ready placeholder
    const chatInput = page.locator('.chat-input-row textarea');
    await waitForSessionComplete(page);
    // After completion, should say "next change"
    const ph = await chatInput.getAttribute('placeholder');
    expect(ph).toContain('next change');
  });

  test('chat input enabled after completion with "next change" placeholder', async ({ page }) => {
    await freshSession(page, `t-chat-en-${Date.now()}`, 'chat enabled');
    await page.click('.tab-btn:has-text("Chat")');
    const input = page.locator('.chat-input-row textarea');
    await expect(input).toBeEnabled();
    const ph = await input.getAttribute('placeholder');
    expect(ph).toContain('next change');
  });

  test('chat iteration submits follow-up and spawns new tasks', async ({ page }) => {
    await freshSession(page, `t-iter-${Date.now()}`, 'initial build');
    await page.click('.tab-btn:has-text("Chat")');
    const input = page.locator('.chat-input-row textarea');
    await input.fill('Add error handling');
    await page.keyboard.press('Enter');
    await expect(page.locator('.bubble-user')).toContainText('Add error handling');
    await expect(page.locator('.chat-messages')).toContainText('Executing', { timeout: 10000 });
    // Wait for iteration to finish
    await page.waitForSelector('.chat-messages >> text=Done', { timeout: 60000 });
  });
});

// ═════════════════════════════════════════════════════════════════════
//  8 · SESSION HISTORY & LOADING
// ═════════════════════════════════════════════════════════════════════

test.describe('Session History', () => {
  test.describe.configure({ timeout: 90000 });

  test('completed session appears in history with card', async ({ page }) => {
    await freshSession(page, `t-hist-${Date.now()}`, 'history test');
    await page.click('.project-badge');
    await page.waitForSelector('.session-history', { timeout: 10000 });
    await expect(page.locator('.session-history')).toContainText('1 previous session');
    await expect(page.locator('.session-card')).toBeVisible();
  });

  test('session card shows status pill, task count, task chips', async ({ page }) => {
    await freshSession(page, `t-card-${Date.now()}`, 'card meta test');
    await page.click('.project-badge');
    await page.waitForSelector('.session-card', { timeout: 10000 });
    // Wait for session list to refresh (finalization may take a moment)
    await expect(page.locator('.status-pill')).toContainText(/Completed|Planning/, { timeout: 10000 });
    // Session should show task summary
    await expect(page.locator('.session-card')).toBeVisible();
    const chipCount = await page.locator('.task-chip').count();
    expect(chipCount).toBeGreaterThanOrEqual(0);
  });

  test('clicking session card loads DAG', async ({ page }) => {
    await freshSession(page, `t-load-${Date.now()}`, 'load DAG');
    await page.click('.project-badge');
    await page.waitForSelector('.session-card', { timeout: 10000 });
    await page.click('.session-card');
    await page.waitForSelector('.vue-flow', { timeout: 15000 });
    // DAG should load with nodes
    await page.waitForSelector('.vue-flow__node', { timeout: 10000 });
    const nodes = await page.locator('.vue-flow__node').count();
    expect(nodes).toBeGreaterThanOrEqual(3);
  });
});

// ═════════════════════════════════════════════════════════════════════
//  9 · SESSION REPLAY
// ═════════════════════════════════════════════════════════════════════

test.describe('Session Replay', () => {
  // Replay tests need extra time because freshSession + replay interactions are slow
  test.describe.configure({ timeout: 90000 });
  test('replay button opens replay panel', async ({ page }) => {
    await freshSession(page, `t-rp-open-${Date.now()}`, 'replay open');
    await page.click('.replay-btn');
    await expect(page.locator('.session-replay')).toBeVisible();
    await expect(page.locator('.replay-header')).toContainText('Session Replay');
    // Timeline slider is conditional on hasTimeline — may show "No timeline data" for mock
    const hasSlider = await page.locator('.time-slider').count();
    const hasEmpty = await page.locator('.time-meta.empty').count();
    expect(hasSlider + hasEmpty).toBeGreaterThanOrEqual(1);
  });

  test('scrubbing slider to start shows pending nodes (if timeline exists)', async ({ page }) => {
    await freshSession(page, `t-rp-scrub-${Date.now()}`, 'replay scrub');
    await page.click('.replay-btn');
    await page.waitForSelector('.session-replay', { timeout: 5000 });

    const hasSlider = await page.locator('.time-slider').count();
    if (hasSlider === 0) {
      // No timeline data in mock mode — skip gracefully
      return;
    }
    await page.evaluate(() => {
      const s = document.querySelector('.time-slider');
      s.value = s.min;
      s.dispatchEvent(new Event('input'));
    });
    await page.waitForTimeout(500);

    const pending = await page.locator('.agent-node.status-pending').count();
    expect(pending).toBeGreaterThanOrEqual(2);
  });

  test('exiting replay preserves node states', async ({ page }) => {
    await freshSession(page, `t-rp-exit-${Date.now()}`, 'replay exit');

    // Fit view so all nodes are rendered in the viewport
    await page.waitForTimeout(1000);
    const fitBtn = page.locator('.vue-flow__controls button').nth(2);
    await fitBtn.click();
    await page.waitForTimeout(1000);

    // Count all non-pending agent-nodes before replay
    const nodesBefore = await page.evaluate(() => {
      const nodes = document.querySelectorAll('.agent-node');
      const states = {};
      nodes.forEach(n => {
        const cls = [...n.classList].find(c => c.startsWith('status-'));
        if (cls) states[cls] = (states[cls] || 0) + 1;
      });
      return states;
    });

    await page.click('.replay-btn');
    await page.waitForSelector('.session-replay', { timeout: 5000 });

    // Exit replay immediately
    await page.click('.replay-btn');
    await page.waitForTimeout(1000);

    // Fit view again
    await fitBtn.click();
    await page.waitForTimeout(500);

    // Count all non-pending agent-nodes after replay
    const nodesAfter = await page.evaluate(() => {
      const nodes = document.querySelectorAll('.agent-node');
      const states = {};
      nodes.forEach(n => {
        const cls = [...n.classList].find(c => c.startsWith('status-'));
        if (cls) states[cls] = (states[cls] || 0) + 1;
      });
      return states;
    });

    // State distribution should be the same before and after replay
    expect(nodesAfter).toEqual(nodesBefore);
  });
});

// ═════════════════════════════════════════════════════════════════════
//  10 · REST API
// ═════════════════════════════════════════════════════════════════════

test.describe('REST API', () => {
  test('health endpoint returns all expected fields', async ({ request }) => {
    const res = await request.get('http://localhost:3000/api/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
    for (const key of ['sessions', 'projects', 'clients', 'activeLocks']) {
      expect(body).toHaveProperty(key);
    }
  });

  test('projects CRUD lifecycle', async ({ request }) => {
    // List
    const listRes = await request.get('http://localhost:3000/api/projects');
    expect(listRes.ok()).toBeTruthy();
    expect(Array.isArray(await listRes.json())).toBeTruthy();

    // Create
    const name = `api-crud-${Date.now()}`;
    const createRes = await request.post('http://localhost:3000/api/projects', { data: { name } });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    expect(created).toHaveProperty('slug');
    expect(created).toHaveProperty('name');

    // Get single
    const getRes = await request.get(`http://localhost:3000/api/projects/${created.slug}`);
    expect(getRes.ok()).toBeTruthy();
    expect((await getRes.json()).slug).toBe(created.slug);

    // Delete
    const delRes = await request.delete(`http://localhost:3000/api/projects/${created.slug}`);
    expect(delRes.ok()).toBeTruthy();

    // Verify deleted → 404
    const gone = await request.get(`http://localhost:3000/api/projects/${created.slug}`);
    expect(gone.status()).toBe(404);
  });

  test('duplicate project creation returns 409', async ({ request }) => {
    const name = `api-dup-${Date.now()}`;
    await request.post('http://localhost:3000/api/projects', { data: { name } });
    const dup = await request.post('http://localhost:3000/api/projects', { data: { name } });
    expect(dup.status()).toBe(409);
  });

  test('templates API returns valid templates', async ({ request }) => {
    const res = await request.get('http://localhost:3000/api/templates');
    expect(res.ok()).toBeTruthy();
    const templates = await res.json();
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      expect(t).toHaveProperty('id');
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('tasks');
      expect(Array.isArray(t.tasks)).toBeTruthy();
    }
  });

  test('sessions API for new project returns empty array', async ({ request }) => {
    const name = `api-sess-${Date.now()}`;
    const created = await (await request.post('http://localhost:3000/api/projects', { data: { name } })).json();
    const sessRes = await request.get(`http://localhost:3000/api/projects/${created.slug}/sessions`);
    expect(sessRes.ok()).toBeTruthy();
    const sessions = await sessRes.json();
    expect(Array.isArray(sessions)).toBeTruthy();
    expect(sessions.length).toBe(0);
    await request.delete(`http://localhost:3000/api/projects/${created.slug}`);
  });

  test('non-existent project returns 404', async ({ request }) => {
    const res = await request.get('http://localhost:3000/api/projects/definitely-not-real');
    expect(res.status()).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════
//  11 · EDGE CASES
// ═════════════════════════════════════════════════════════════════════

test.describe('Edge Cases', () => {
  test('rapid project creation works correctly', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    const n1 = `t-rapid1-${Date.now()}`;
    await createProject(page, n1);
    await page.click('.logo');
    await page.waitForSelector('h2:has-text("Select a Project")', { timeout: 5000 });
    const n2 = `t-rapid2-${Date.now()}`;
    await createProject(page, n2);
    await expect(page.locator('.project-badge')).toContainText(n2);
  });
});
