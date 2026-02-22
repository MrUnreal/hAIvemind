// @ts-check
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:3000';

/* ═══════════════════════════════════════════════════════════
   1. useDashboard composable
   ═══════════════════════════════════════════════════════════ */
test.describe('useDashboard composable', () => {
  const composablePath = path.resolve('client/src/composables/useDashboard.js');

  test('exports useDashboard function', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain('export function useDashboard');
  });

  test('fetches from /health/details', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain('/api/health/details');
  });

  test('provides health, loading, error refs', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain('health');
    expect(src).toContain('loading');
    expect(src).toContain('error');
  });

  test('provides agentActivity and sessionEvents', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain('agentActivity');
    expect(src).toContain('sessionEvents');
  });

  test('provides addAgentEvent and addSessionEvent', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain('addAgentEvent');
    expect(src).toContain('addSessionEvent');
  });

  test('polls on interval', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain('setInterval');
    expect(src).toContain('POLL_INTERVAL');
  });

  test('caps event arrays to prevent memory leak', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain('.length > 50');
    expect(src).toContain('.length > 30');
  });

  test('has startPolling and stopPolling methods', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain('startPolling');
    expect(src).toContain('stopPolling');
    expect(src).toContain('clearInterval');
  });
});

/* ═══════════════════════════════════════════════════════════
   2. LiveDashboard.vue — component structure
   ═══════════════════════════════════════════════════════════ */
test.describe('LiveDashboard component', () => {
  const vuePath = path.resolve('client/src/components/LiveDashboard.vue');

  test('displays system metrics grid', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('metrics-grid');
    expect(src).toContain('metric-card');
    expect(src).toContain('Uptime');
    expect(src).toContain('Sessions');
    expect(src).toContain('Clients');
    expect(src).toContain('Projects');
  });

  test('displays memory usage bars', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('Memory Usage');
    expect(src).toContain('memory-bar-fill');
    expect(src).toContain('heapPercent');
    expect(src).toContain('Heap Used');
    expect(src).toContain('RSS');
  });

  test('has agent activity feed', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('Agent Activity');
    expect(src).toContain('agentActivity');
    expect(src).toContain('activity-feed');
    expect(src).toContain('statusIcon');
  });

  test('has session events feed', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('Session Events');
    expect(src).toContain('sessionEvents');
    expect(src).toContain('sessionIcon');
  });

  test('has project breakdown section', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('project-table');
    expect(src).toContain('project-row');
    expect(src).toContain('proj-name');
  });

  test('has formatUptime helper', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('formatUptime');
  });

  test('uses CSS custom properties from theme', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('var(--bg-input)');
    expect(src).toContain('var(--text-primary)');
    expect(src).toContain('var(--border-secondary)');
    expect(src).toContain('var(--accent-gold)');
  });

  test('imports useDashboard composable', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain("from '../composables/useDashboard.js'");
  });
});

/* ═══════════════════════════════════════════════════════════
   3. Health endpoint — REST API
   ═══════════════════════════════════════════════════════════ */
test.describe('Health REST API', () => {
  test('GET /health returns system status', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('status', 'ok');
    expect(data).toHaveProperty('uptime');
  });

  test('GET /health/details returns detailed metrics', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health/details`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('memory');
    expect(data).toHaveProperty('runtime');
    expect(data).toHaveProperty('node');
    expect(data.memory).toHaveProperty('rss');
    expect(data.memory).toHaveProperty('heapUsed');
    expect(data.runtime).toHaveProperty('sessions');
    expect(data.runtime).toHaveProperty('clients');
  });
});

/* ═══════════════════════════════════════════════════════════
   4. App.vue — dashboard integration
   ═══════════════════════════════════════════════════════════ */
test.describe('App.vue — live dashboard integration', () => {
  const appPath = path.resolve('client/src/App.vue');

  test('imports LiveDashboard component', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain("import LiveDashboard from './components/LiveDashboard.vue'");
  });

  test('has Live tab in side panel', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain("sideTab === 'live'");
    expect(src).toContain('📡 Live');
  });

  test('renders LiveDashboard in side content', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain('<LiveDashboard');
  });
});
