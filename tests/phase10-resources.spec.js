/**
 * Phase 10.3 — Resource Monitor Tests
 *
 * Tests for resource monitoring service (system metrics, limits, process tracking,
 * snapshots, alerts), REST endpoints, and client component integration.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, existsSync, rmSync, readFileSync } from 'fs';

const API = 'http://localhost:3000/api';
const TEST_DIR = '.haivemind-workspace';

let WorkspaceManager, refs, monitor;

test.beforeAll(async () => {
  const wsModule = await import('../server/workspace.js');
  WorkspaceManager = wsModule.default;
  const stateModule = await import('../server/state.js');
  refs = stateModule.refs;
  monitor = await import('../server/services/resourceMonitor.js');

  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  const wm = new WorkspaceManager(TEST_DIR);
  refs.workspace = wm;
  try { wm.createProject('resource-proj'); } catch { /* exists */ }
});

test.afterAll(async () => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  1 · RESOURCE SERVICE — System Metrics
// ═══════════════════════════════════════════════════════════════════

test.describe('Resource Monitor — System Metrics', () => {
  test('getSystemMetrics returns cpu, memory, disk', () => {
    const m = monitor.getSystemMetrics();
    expect(typeof m.cpu.percent).toBe('number');
    expect(m.cpu.percent).toBeGreaterThanOrEqual(0);
    expect(m.cpu.count).toBeGreaterThan(0);
    expect(m.cpu.model).toBeTruthy();
    expect(typeof m.memory.total).toBe('number');
    expect(typeof m.memory.used).toBe('number');
    expect(typeof m.memory.free).toBe('number');
    expect(m.memory.percent).toBeGreaterThanOrEqual(0);
    expect(typeof m.disk.percent).toBe('number');
    expect(typeof m.uptime).toBe('number');
    expect(m.loadAvg).toBeTruthy();
    expect(m.nodeMemory).toBeTruthy();
    expect(m.timestamp).toBeTruthy();
  });

  test('getSystemMetrics has node memory details', () => {
    const m = monitor.getSystemMetrics();
    expect(typeof m.nodeMemory.heapUsed).toBe('number');
    expect(typeof m.nodeMemory.heapTotal).toBe('number');
    expect(typeof m.nodeMemory.rss).toBe('number');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  2 · RESOURCE SERVICE — Limits
// ═══════════════════════════════════════════════════════════════════

test.describe('Resource Monitor — Limits', () => {
  test('getLimits returns default limits', () => {
    const limits = monitor.getLimits();
    expect(limits.maxMemoryPercent).toBe(90);
    expect(limits.maxCpuPercent).toBe(95);
    expect(limits.maxDiskPercent).toBe(95);
    expect(limits.maxProcessMemoryMb).toBe(512);
    expect(limits.maxProcessTimeSec).toBe(600);
  });

  test('setLimits updates project-level limits', () => {
    const updated = monitor.setLimits('resource-proj', { maxMemoryPercent: 80 });
    expect(updated.maxMemoryPercent).toBe(80);
    expect(updated.maxCpuPercent).toBe(95); // default unchanged
  });

  test('setLimits ignores invalid keys', () => {
    const updated = monitor.setLimits('resource-proj', { fakeSetting: 100 });
    expect(updated.fakeSetting).toBeUndefined();
  });

  test('setLimits ignores non-positive values', () => {
    const updated = monitor.setLimits('resource-proj', { maxMemoryPercent: -5 });
    // -5 is ignored, but setLimits writes cleaned limits (possibly empty)
    // so getLimits falls back to defaults
    expect(updated.maxMemoryPercent).toBeGreaterThan(0);
    expect(updated.maxCpuPercent).toBe(95);
  });

  test('getLimits reads project overrides', () => {
    // Re-set with a valid override
    monitor.setLimits('resource-proj', { maxMemoryPercent: 80 });
    const limits = monitor.getLimits('resource-proj');
    expect(limits.maxMemoryPercent).toBe(80);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  3 · RESOURCE SERVICE — Process Tracking
// ═══════════════════════════════════════════════════════════════════

test.describe('Resource Monitor — Process Tracking', () => {
  test('trackProcess registers a process', () => {
    monitor.trackProcess(99999, 'Test Agent', 'resource-proj');
    const procs = monitor.getTrackedProcesses();
    const found = procs.find(p => p.pid === 99999);
    expect(found).toBeTruthy();
    expect(found.label).toBe('Test Agent');
    expect(found.slug).toBe('resource-proj');
    expect(found.runtimeSec).toBeGreaterThanOrEqual(0);
  });

  test('untrackProcess removes a process', () => {
    monitor.untrackProcess(99999);
    const procs = monitor.getTrackedProcesses();
    expect(procs.find(p => p.pid === 99999)).toBeFalsy();
  });

  test('killProcess attempts to kill and untrack', () => {
    monitor.trackProcess(88888, 'Fake Process');
    const result = monitor.killProcess(88888);
    expect(result.pid).toBe(88888);
    // Process doesn't exist, so killed may be false
    const procs = monitor.getTrackedProcesses();
    expect(procs.find(p => p.pid === 88888)).toBeFalsy();
  });

  test('getTrackedProcesses returns runtime info', () => {
    monitor.trackProcess(77777, 'Runtime Test');
    const procs = monitor.getTrackedProcesses();
    const p = procs.find(x => x.pid === 77777);
    expect(typeof p.runtimeSec).toBe('number');
    expect(p.startedAt).toBeTruthy();
    monitor.untrackProcess(77777);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  4 · RESOURCE SERVICE — Snapshots & Alerts
// ═══════════════════════════════════════════════════════════════════

test.describe('Resource Monitor — Snapshots & Alerts', () => {
  test('recordSnapshot returns system metrics', () => {
    const snapshot = monitor.recordSnapshot();
    expect(snapshot.cpu).toBeTruthy();
    expect(snapshot.memory).toBeTruthy();
    expect(snapshot.timestamp).toBeTruthy();
  });

  test('getSnapshots returns recorded snapshots', () => {
    const snaps = monitor.getSnapshots();
    expect(snaps.length).toBeGreaterThanOrEqual(1);
  });

  test('getSnapshots respects limit', () => {
    monitor.recordSnapshot();
    monitor.recordSnapshot();
    const snaps = monitor.getSnapshots(1);
    expect(snaps.length).toBe(1);
  });

  test('addAlert stores alerts', () => {
    monitor.clearAlerts();
    monitor.addAlert('warning', 'Test alert');
    const alerts = monitor.getAlerts();
    expect(alerts.length).toBe(1);
    expect(alerts[0].level).toBe('warning');
    expect(alerts[0].message).toBe('Test alert');
  });

  test('getAlerts respects limit', () => {
    monitor.addAlert('info', 'Info alert');
    monitor.addAlert('critical', 'Critical alert');
    const alerts = monitor.getAlerts(2);
    expect(alerts.length).toBe(2);
  });

  test('clearAlerts removes all', () => {
    monitor.clearAlerts();
    expect(monitor.getAlerts().length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  5 · RESOURCE SERVICE — Formatting
// ═══════════════════════════════════════════════════════════════════

test.describe('Resource Monitor — Formatting', () => {
  test('formatBytes handles various sizes', () => {
    expect(monitor.formatBytes(0)).toBe('0 B');
    expect(monitor.formatBytes(1024)).toBe('1.0 KB');
    expect(monitor.formatBytes(1048576)).toBe('1.0 MB');
    expect(monitor.formatBytes(1073741824)).toBe('1.0 GB');
  });

  test('formatDuration handles seconds, minutes, hours', () => {
    expect(monitor.formatDuration(30)).toBe('30s');
    expect(monitor.formatDuration(90)).toBe('1m 30s');
    expect(monitor.formatDuration(3661)).toBe('1h 1m');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  6 · REST ENDPOINTS — Resource Monitor
// ═══════════════════════════════════════════════════════════════════

test.describe('REST — Resource Monitor Endpoints', () => {
  test('GET /resources/system returns metrics', async ({ request }) => {
    const res = await request.get(`${API}/resources/system`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.cpu).toBeTruthy();
    expect(body.memory).toBeTruthy();
    expect(body.disk).toBeTruthy();
  });

  test('POST /resources/snapshots records snapshot', async ({ request }) => {
    const res = await request.post(`${API}/resources/snapshots`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.cpu).toBeTruthy();
  });

  test('GET /resources/snapshots returns list', async ({ request }) => {
    const res = await request.get(`${API}/resources/snapshots`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toBeInstanceOf(Array);
  });

  test('GET /resources/alerts returns alerts', async ({ request }) => {
    const res = await request.get(`${API}/resources/alerts`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toBeInstanceOf(Array);
  });

  test('DELETE /resources/alerts clears alerts', async ({ request }) => {
    const res = await request.delete(`${API}/resources/alerts`);
    expect(res.ok()).toBe(true);
  });

  test('GET /resources/processes returns list', async ({ request }) => {
    const res = await request.get(`${API}/resources/processes`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toBeInstanceOf(Array);
  });

  test('POST /resources/processes tracks a process', async ({ request }) => {
    const res = await request.post(`${API}/resources/processes`, {
      data: { pid: 12345, label: 'Test Process', slug: 'test-project' },
    });
    expect(res.status()).toBe(201);
  });

  test('POST /resources/processes returns 400 without pid', async ({ request }) => {
    const res = await request.post(`${API}/resources/processes`, {
      data: { label: 'No PID' },
    });
    expect(res.status()).toBe(400);
  });

  test('DELETE /resources/processes/:pid kills process', async ({ request }) => {
    const res = await request.delete(`${API}/resources/processes/12345`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.pid).toBe(12345);
  });

  test('DELETE /resources/processes/:pid returns 400 for invalid pid', async ({ request }) => {
    const res = await request.delete(`${API}/resources/processes/abc`);
    expect(res.status()).toBe(400);
  });
});

test.describe('REST — Resource Limits', () => {
  const PROJ = `res-lim-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    await request.post(`${API}/projects`, { data: { name: PROJ } });
  });

  test('GET /resources/limits returns defaults', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/resources/limits`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.maxMemoryPercent).toBe(90);
  });

  test('PUT /resources/limits updates limits', async ({ request }) => {
    const res = await request.put(`${API}/projects/${PROJ}/resources/limits`, {
      data: { maxMemoryPercent: 85 },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.maxMemoryPercent).toBe(85);
  });

  test('GET /resources/limits returns 404 for unknown project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/resources/limits`);
    expect(res.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  7 · CLIENT INTEGRATION — ResourcePanel.vue
// ═══════════════════════════════════════════════════════════════════

test.describe('Client Integration — ResourcePanel.vue', () => {
  let src;

  test.beforeAll(async () => {
    src = readFileSync('client/src/components/ResourcePanel.vue', 'utf-8');
  });

  test('component has resource-panel class', () => {
    expect(src).toContain('resource-panel');
  });

  test('component shows CPU, Memory, Disk gauges', () => {
    expect(src).toContain('gauge-ring');
    expect(src).toContain('CPU');
    expect(src).toContain('Memory');
    expect(src).toContain('Disk');
  });

  test('component shows system info', () => {
    expect(src).toContain('resource-info');
    expect(src).toContain('Load Avg');
    expect(src).toContain('Node.js Heap');
    expect(src).toContain('Uptime');
  });

  test('component shows alerts', () => {
    expect(src).toContain('resource-alerts');
    expect(src).toContain('alert-card');
    expect(src).toContain('doClearAlerts');
  });

  test('component shows tracked processes', () => {
    expect(src).toContain('process-card');
    expect(src).toContain('process-kill-btn');
    expect(src).toContain('doKill');
  });

  test('component has refresh and snapshot buttons', () => {
    expect(src).toContain('resource-btn');
    expect(src).toContain('doSnapshot');
    expect(src).toContain('refresh');
  });

  test('component polls automatically', () => {
    expect(src).toContain('startPolling');
    expect(src).toContain('stopPolling');
    expect(src).toContain('setInterval');
  });

  test('component has scoped styles', () => {
    expect(src).toContain('<style scoped>');
    expect(src).toContain('gauge-value');
  });
});
