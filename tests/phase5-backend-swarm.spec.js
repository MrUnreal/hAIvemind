// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 5.8: Backend/Swarm REST API Tests ───────────────────────────────

test.describe('Backend REST API', () => {
  test('GET /api/backends returns array of backends', async () => {
    const res = await fetch(`${API}/api/backends`);
    expect(res.ok).toBe(true);
    const backends = await res.json();
    expect(Array.isArray(backends)).toBe(true);
    expect(backends.length).toBeGreaterThanOrEqual(2);

    const names = backends.map(b => b.name);
    expect(names).toContain('copilot');
    expect(names).toContain('ollama');
  });

  test('GET /api/backends shows active backend', async () => {
    const res = await fetch(`${API}/api/backends`);
    const backends = await res.json();
    const active = backends.find(b => b.active);
    expect(active).toBeDefined();
    expect(active.name).toBe('copilot');
  });

  test('GET /api/backends/active returns current default', async () => {
    const res = await fetch(`${API}/api/backends/active`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.name).toBe('copilot');
  });

  test('PUT /api/backends/active switches backend', async () => {
    // Switch to ollama
    const res1 = await fetch(`${API}/api/backends/active`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ollama' }),
    });
    expect(res1.ok).toBe(true);
    const data1 = await res1.json();
    expect(data1.name).toBe('ollama');

    // Verify
    const check = await fetch(`${API}/api/backends/active`);
    const checkData = await check.json();
    expect(checkData.name).toBe('ollama');

    // Switch back
    await fetch(`${API}/api/backends/active`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'copilot' }),
    });
  });

  test('PUT /api/backends/active rejects unknown backend', async () => {
    const res = await fetch(`${API}/api/backends/active`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'nonexistent' }),
    });
    expect(res.status).toBe(400);
  });

  test('GET /api/backends/:name returns backend config', async () => {
    const res = await fetch(`${API}/api/backends/copilot`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.name).toBe('copilot');
    expect(data.config).toBeDefined();
  });

  test('GET /api/backends/:name returns 404 for unknown', async () => {
    const res = await fetch(`${API}/api/backends/nonexistent`);
    expect(res.status).toBe(404);
  });

  test('PUT /api/backends/:name updates config', async () => {
    const res = await fetch(`${API}/api/backends/ollama`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-coder' }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.config.model).toBe('deepseek-coder');

    // Verify persistence
    const check = await fetch(`${API}/api/backends/ollama`);
    const checkData = await check.json();
    expect(checkData.config.model).toBe('deepseek-coder');
  });
});

test.describe('Swarm REST API', () => {
  test('GET /api/swarm returns swarm status', async () => {
    const res = await fetch(`${API}/api/swarm`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(typeof data.enabled).toBe('boolean');
    expect(typeof data.totalCapacity).toBe('number');
    expect(Array.isArray(data.runners)).toBe(true);
    expect(typeof data.description).toBe('string');
  });

  test('PUT /api/swarm enables swarm', async () => {
    const res = await fetch(`${API}/api/swarm`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.enabled).toBe(true);
    expect(data.totalCapacity).toBeGreaterThan(0);
  });

  test('GET /api/swarm/runners returns array when enabled', async () => {
    // Enable first
    await fetch(`${API}/api/swarm`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });

    const res = await fetch(`${API}/api/swarm/runners`);
    expect(res.ok).toBe(true);
    const runners = await res.json();
    expect(Array.isArray(runners)).toBe(true);
    // Should have at least the local runner
    expect(runners.length).toBeGreaterThanOrEqual(1);
    expect(runners[0].type).toBe('local');
    expect(typeof runners[0].capacity).toBe('number');
  });

  test('PUT /api/swarm disables swarm', async () => {
    const res = await fetch(`${API}/api/swarm`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.enabled).toBe(false);
    expect(data.totalCapacity).toBe(0);
  });

  test('GET /api/swarm/runners returns empty when disabled', async () => {
    // Disable
    await fetch(`${API}/api/swarm`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    const res = await fetch(`${API}/api/swarm/runners`);
    const runners = await res.json();
    expect(runners).toEqual([]);
  });
});

test.describe('Backend/Swarm — Code Integration', () => {
  test('server imports backend/swarm modules', () => {
    const indexSrc = readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
    expect(indexSrc).toContain('createSwarm');
    const backendsSrc = readFileSync(path.join(ROOT, 'server', 'routes', 'backends.js'), 'utf8');
    expect(backendsSrc).toContain('listBackends');
  });

  test('listBackends returns expected backends', async () => {
    const { listBackends } = await import('../server/backends/index.js');
    const names = listBackends();
    expect(names).toContain('copilot');
    expect(names).toContain('ollama');
  });

  test('SwarmManager can be instantiated', async () => {
    const SwarmManager = (await import('../server/swarm/index.js')).default;
    const sm = new SwarmManager();
    expect(sm.totalCapacity()).toBe(0);
    expect(sm.runners).toHaveLength(0);
  });

  test('createSwarm creates instance with local runner', async () => {
    const { createSwarm } = await import('../server/swarm/index.js');
    const swarm = createSwarm({ enabled: true, runners: [] });
    expect(swarm.totalCapacity()).toBeGreaterThan(0);
    expect(swarm.runners.length).toBeGreaterThanOrEqual(1);
  });
});
