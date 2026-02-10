// @ts-check
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';

// ═══════════════════════════════════════════════════════════
//  Phase 6.8: Server Decomposition Tests
// ═══════════════════════════════════════════════════════════

// ── Module Structure Tests ──

test.describe('Module structure', () => {
  test('server/index.js is under 200 lines (thin wiring)', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync('server/index.js', 'utf8');
    const lineCount = content.split('\n').length;
    expect(lineCount).toBeLessThan(200);
  });

  test('state.js exports all shared state', async () => {
    const state = await import('../server/state.js');
    expect(state.sessions).toBeDefined();
    expect(state.taskToSession).toBeDefined();
    expect(state.activeContexts).toBeDefined();
    expect(state.workDirLocks).toBeDefined();
    expect(state.clients).toBeDefined();
    expect(state.autopilotRuns).toBeDefined();
    expect(state.refs).toBeDefined();
    // refs bag has expected keys
    expect(state.refs).toHaveProperty('workspace');
    expect(state.refs).toHaveProperty('pluginManager');
    expect(state.refs).toHaveProperty('DEMO');
  });

  test('route modules export Express routers', async () => {
    const routeFiles = [
      '../server/routes/health.js',
      '../server/routes/projects.js',
      '../server/routes/sessions.js',
      '../server/routes/templates.js',
      '../server/routes/backends.js',
      '../server/routes/plugins.js',
      '../server/routes/autopilot.js',
    ];
    for (const filePath of routeFiles) {
      const mod = await import(filePath);
      expect(mod.default).toBeDefined();
      // Express routers are functions with .stack
      expect(typeof mod.default).toBe('function');
    }
  });

  test('service modules export expected functions', async () => {
    const sessions = await import('../server/services/sessions.js');
    expect(typeof sessions.startSession).toBe('function');
    expect(typeof sessions.runVerifyFixLoop).toBe('function');
    expect(typeof sessions.handleChatMessage).toBe('function');
    expect(typeof sessions.acquireLock).toBe('function');
    expect(typeof sessions.releaseLock).toBe('function');
    expect(typeof sessions.pruneCompletedSessions).toBe('function');

    const analysis = await import('../server/services/analysis.js');
    expect(typeof analysis.generateReflection).toBe('function');
    expect(typeof analysis.extractSkills).toBe('function');

    const recovery = await import('../server/services/recovery.js');
    expect(typeof recovery.recoverInterruptedSessions).toBe('function');
    expect(typeof recovery.recoverFromCheckpoints).toBe('function');

    const shutdown = await import('../server/services/shutdown.js');
    expect(typeof shutdown.gracefulShutdown).toBe('function');
  });

  test('ws modules export expected functions', async () => {
    const broadcast = await import('../server/ws/broadcast.js');
    expect(typeof broadcast.broadcast).toBe('function');
    expect(typeof broadcast.broadcastGlobal).toBe('function');
    expect(typeof broadcast.recordTimelineEvent).toBe('function');

    const handlers = await import('../server/ws/handlers.js');
    expect(typeof handlers.handleClientMessage).toBe('function');

    const setup = await import('../server/ws/setup.js');
    expect(typeof setup.createWss).toBe('function');
  });

  test('all module files exist on disk', async () => {
    const fs = await import('node:fs');
    const files = [
      'server/state.js',
      'server/routes/health.js',
      'server/routes/projects.js',
      'server/routes/sessions.js',
      'server/routes/templates.js',
      'server/routes/backends.js',
      'server/routes/plugins.js',
      'server/routes/autopilot.js',
      'server/services/sessions.js',
      'server/services/analysis.js',
      'server/services/recovery.js',
      'server/services/shutdown.js',
      'server/ws/broadcast.js',
      'server/ws/handlers.js',
      'server/ws/setup.js',
    ];
    for (const file of files) {
      expect(fs.existsSync(file), `${file} should exist`).toBe(true);
    }
  });
});

// ── API Smoke Tests (all routes still work after decomposition) ──

test.describe('API routes (post-decomposition)', () => {
  test('GET /api/health returns ok', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.ok()).toBe(true);
    const json = await res.json();
    expect(json.status).toBe('ok');
    expect(json).toHaveProperty('sessions');
    expect(json).toHaveProperty('projects');
    expect(json).toHaveProperty('clients');
    expect(json).toHaveProperty('activeLocks');
  });

  test('GET /api/projects returns array', async ({ request }) => {
    const res = await request.get(`${BASE}/api/projects`);
    expect(res.ok()).toBe(true);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBeGreaterThan(0);
  });

  test('GET /api/backends returns list with copilot', async ({ request }) => {
    const res = await request.get(`${BASE}/api/backends`);
    expect(res.ok()).toBe(true);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    const names = json.map(b => b.name);
    expect(names).toContain('copilot');
    expect(names).toContain('ollama');
  });

  test('GET /api/backends/active returns name', async ({ request }) => {
    const res = await request.get(`${BASE}/api/backends/active`);
    expect(res.ok()).toBe(true);
    const json = await res.json();
    expect(json.name).toBe('copilot');
  });

  test('GET /api/templates returns array', async ({ request }) => {
    const res = await request.get(`${BASE}/api/templates`);
    expect(res.ok()).toBe(true);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  test('GET /api/plugins returns array', async ({ request }) => {
    const res = await request.get(`${BASE}/api/plugins`);
    expect(res.ok()).toBe(true);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  test('GET /api/swarm returns status', async ({ request }) => {
    const res = await request.get(`${BASE}/api/swarm`);
    expect(res.ok()).toBe(true);
    const json = await res.json();
    expect(json).toHaveProperty('enabled');
    expect(json).toHaveProperty('totalCapacity');
  });

  test('GET /api/checkpoints returns array', async ({ request }) => {
    const res = await request.get(`${BASE}/api/checkpoints`);
    expect(res.ok()).toBe(true);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  test('GET /api/interrupted-sessions returns array', async ({ request }) => {
    const res = await request.get(`${BASE}/api/interrupted-sessions`);
    expect(res.ok()).toBe(true);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  test('POST /api/projects creates and deletes a project', async ({ request }) => {
    const name = `decomp-test-${Date.now()}`;
    const create = await request.post(`${BASE}/api/projects`, {
      data: { name },
    });
    expect(create.status()).toBe(201);
    const proj = await create.json();
    expect(proj.slug).toBeTruthy();

    // Verify it appears in list
    const list = await request.get(`${BASE}/api/projects`);
    const projects = await list.json();
    const found = projects.find(p => p.slug === proj.slug);
    expect(found).toBeTruthy();

    // Delete
    const del = await request.delete(`${BASE}/api/projects/${proj.slug}`);
    expect(del.ok()).toBe(true);
  });
});

// ── WebSocket Tests (WS still works after decomposition) ──

test.describe('WebSocket (post-decomposition)', () => {
  test('WS connection succeeds and health shows client', async ({ page }) => {
    await page.goto('http://localhost:5173');
    // Wait for WS to connect
    await page.waitForTimeout(1000);
    const res = await page.request.get(`${BASE}/api/health`);
    const json = await res.json();
    expect(json.clients).toBeGreaterThanOrEqual(1);
  });
});

// ── Session Integration Test (mock mode) ──

test.describe('Session flow (post-decomposition)', () => {
  test('REST session start works end-to-end', async ({ request }) => {
    // Create a project
    const name = `decomp-session-${Date.now()}`;
    const create = await request.post(`${BASE}/api/projects`, { data: { name } });
    const proj = await create.json();

    // Start session via REST
    const start = await request.post(`${BASE}/api/projects/${proj.slug}/sessions`, {
      data: { prompt: 'Test decomposed server integration' },
    });
    expect(start.ok()).toBe(true);
    const startJson = await start.json();
    expect(startJson.status).toBe('started');

    // Wait for session to complete
    await new Promise(r => setTimeout(r, 3000));

    // Verify session appears in list
    const sessions = await request.get(`${BASE}/api/projects/${proj.slug}/sessions`);
    const sessionList = await sessions.json();
    expect(sessionList.length).toBeGreaterThanOrEqual(1);

    // Cleanup
    await request.delete(`${BASE}/api/projects/${proj.slug}`);
  });
});

// ── Autopilot Route Test ──

test.describe('Autopilot routes (post-decomposition)', () => {
  test('GET /api/projects/:slug/autopilot returns default status', async ({ request }) => {
    // Create a project
    const name = `autopilot-test-${Date.now()}`;
    const create = await request.post(`${BASE}/api/projects`, { data: { name } });
    const proj = await create.json();

    const res = await request.get(`${BASE}/api/projects/${proj.slug}/autopilot`);
    expect(res.ok()).toBe(true);
    const json = await res.json();
    expect(json.running).toBe(false);

    await request.delete(`${BASE}/api/projects/${proj.slug}`);
  });

  test('POST autopilot/stop returns 404 when no run active', async ({ request }) => {
    const name = `autopilot-stop-${Date.now()}`;
    const create = await request.post(`${BASE}/api/projects`, { data: { name } });
    const proj = await create.json();

    const res = await request.post(`${BASE}/api/projects/${proj.slug}/autopilot/stop`);
    expect(res.status()).toBe(404);

    await request.delete(`${BASE}/api/projects/${proj.slug}`);
  });
});
