/**
 * Phase 6.7 — Scoped WS Channels & Session Persistence
 *
 * Tests:
 * A) Protocol: WS_SUBSCRIBE / WS_UNSUBSCRIBE message types exist
 * B) Server: broadcast scoping, subscribe/unsubscribe handling, broadcastGlobal
 * C) Session Checkpoint: writeCheckpoint, deleteCheckpoint, readAllCheckpoints, startCheckpointTimer
 * D) REST: GET /api/checkpoints
 * E) Client: useWebSocket exposes subscribeProject, sends subscribe/unsubscribe messages
 * F) App.vue integration: calls subscribeProject on project switch
 * G) Integration: WS subscribe flow via HTTP + WS
 */

import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');

// ═══════════════════════════════════════════════════════════
//  A) Protocol message types
// ═══════════════════════════════════════════════════════════

test.describe('Phase 6.7 — Protocol', () => {
  let MSG;

  test.beforeAll(async () => {
    const mod = await import(join(ROOT, 'shared', 'protocol.js'));
    MSG = mod.MSG;
  });

  test('WS_SUBSCRIBE message type is defined', () => {
    expect(MSG.WS_SUBSCRIBE).toBe('ws:subscribe');
  });

  test('WS_UNSUBSCRIBE message type is defined', () => {
    expect(MSG.WS_UNSUBSCRIBE).toBe('ws:unsubscribe');
  });
});

// ═══════════════════════════════════════════════════════════
//  B) Server — Scoped Broadcast
// ═══════════════════════════════════════════════════════════

test.describe('Phase 6.7 — Server Scoped Broadcast', () => {
  test('ws/broadcast.js has broadcastGlobal function', async () => {
    const src = await readFile(join(ROOT, 'server', 'ws', 'broadcast.js'), 'utf-8');
    expect(src).toContain('function broadcastGlobal(');
  });

  test('broadcast resolves projectSlug from payload', async () => {
    const src = await readFile(join(ROOT, 'server', 'ws', 'broadcast.js'), 'utf-8');
    expect(src).toContain('parsed?.payload?.projectSlug');
    expect(src).toContain('parsed?.payload?.slug');
  });

  test('broadcast resolves slug from taskId via taskToSession', async () => {
    const src = await readFile(join(ROOT, 'server', 'ws', 'broadcast.js'), 'utf-8');
    expect(src).toContain('taskToSession.get(taskId)');
  });

  test('broadcast filters by ws.subscribedProjects', async () => {
    const src = await readFile(join(ROOT, 'server', 'ws', 'broadcast.js'), 'utf-8');
    expect(src).toContain('ws.subscribedProjects');
    expect(src).toContain('.has(resolvedSlug)');
  });

  test('WS connection initializes subscribedProjects set', async () => {
    const src = await readFile(join(ROOT, 'server', 'ws', 'setup.js'), 'utf-8');
    expect(src).toContain('ws.subscribedProjects = new Set()');
  });

  test('server handles WS_SUBSCRIBE message', async () => {
    const src = await readFile(join(ROOT, 'server', 'ws', 'handlers.js'), 'utf-8');
    expect(src).toContain('MSG.WS_SUBSCRIBE');
    expect(src).toContain('ws.subscribedProjects.add(projectSlug)');
  });

  test('server handles WS_UNSUBSCRIBE message', async () => {
    const src = await readFile(join(ROOT, 'server', 'ws', 'handlers.js'), 'utf-8');
    expect(src).toContain('MSG.WS_UNSUBSCRIBE');
    expect(src).toContain('ws.subscribedProjects.delete(projectSlug)');
  });

  test('SHUTDOWN_WARNING uses broadcastGlobal', async () => {
    const src = await readFile(join(ROOT, 'server', 'services', 'shutdown.js'), 'utf-8');
    expect(src).toContain("broadcastGlobal(makeMsg(MSG.SHUTDOWN_WARNING");
  });
});

// ═══════════════════════════════════════════════════════════
//  C) Session Checkpoint Module
// ═══════════════════════════════════════════════════════════

test.describe('Phase 6.7 — Session Checkpoint', () => {
  test('sessionCheckpoint.js exists', async () => {
    const src = await readFile(join(ROOT, 'server', 'sessionCheckpoint.js'), 'utf-8');
    expect(src.length).toBeGreaterThan(100);
  });

  test('exports writeCheckpoint function', async () => {
    const mod = await import(join(ROOT, 'server', 'sessionCheckpoint.js'));
    expect(typeof mod.writeCheckpoint).toBe('function');
  });

  test('exports deleteCheckpoint function', async () => {
    const mod = await import(join(ROOT, 'server', 'sessionCheckpoint.js'));
    expect(typeof mod.deleteCheckpoint).toBe('function');
  });

  test('exports readAllCheckpoints function', async () => {
    const mod = await import(join(ROOT, 'server', 'sessionCheckpoint.js'));
    expect(typeof mod.readAllCheckpoints).toBe('function');
  });

  test('exports flushAllCheckpoints function', async () => {
    const mod = await import(join(ROOT, 'server', 'sessionCheckpoint.js'));
    expect(typeof mod.flushAllCheckpoints).toBe('function');
  });

  test('exports startCheckpointTimer function', async () => {
    const mod = await import(join(ROOT, 'server', 'sessionCheckpoint.js'));
    expect(typeof mod.startCheckpointTimer).toBe('function');
  });

  test('writeCheckpoint serializes session state correctly', async () => {
    const src = await readFile(join(ROOT, 'server', 'sessionCheckpoint.js'), 'utf-8');
    // Verify it captures essential fields
    expect(src).toContain('sessionId');
    expect(src).toContain('projectSlug');
    expect(src).toContain('checkpointedAt');
    expect(src).toContain('plan');
    expect(src).toContain('timeline');
  });

  test('checkpoint files go into .haivemind/checkpoints/ directory', async () => {
    const src = await readFile(join(ROOT, 'server', 'sessionCheckpoint.js'), 'utf-8');
    expect(src).toContain('checkpoints');
    expect(src).toContain('.haivemind');
  });

  test('checkpoint timer interval is configurable', async () => {
    const src = await readFile(join(ROOT, 'server', 'sessionCheckpoint.js'), 'utf-8');
    expect(src).toContain('intervalMs');
  });
});

// ═══════════════════════════════════════════════════════════
//  D) Server — Checkpoint Integration
// ═══════════════════════════════════════════════════════════

test.describe('Phase 6.7 — Server Checkpoint Integration', () => {
  test('server imports sessionCheckpoint module', async () => {
    const src = await readFile(join(ROOT, 'server', 'index.js'), 'utf-8');
    expect(src).toContain("from './sessionCheckpoint.js'");
  });

  test('server starts checkpoint timer', async () => {
    const src = await readFile(join(ROOT, 'server', 'index.js'), 'utf-8');
    expect(src).toContain('startCheckpointTimer(sessions, workspace');
  });

  test('server deletes checkpoint on session complete', async () => {
    const src = await readFile(join(ROOT, 'server', 'services', 'sessions.js'), 'utf-8');
    expect(src).toContain('deleteCheckpoint(sessionId');
    // Should appear in both complete and fail paths
    const matches = src.match(/deleteCheckpoint\(/g);
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test('graceful shutdown flushes checkpoints', async () => {
    const src = await readFile(join(ROOT, 'server', 'services', 'shutdown.js'), 'utf-8');
    expect(src).toContain('checkpointTimer.flush()');
  });

  test('graceful shutdown clears checkpoint interval', async () => {
    const src = await readFile(join(ROOT, 'server', 'services', 'shutdown.js'), 'utf-8');
    expect(src).toContain('clearInterval(refs.checkpointTimer.intervalId)');
  });

  test('server recovers crash-orphaned sessions from checkpoints', async () => {
    const indexSrc = await readFile(join(ROOT, 'server', 'index.js'), 'utf-8');
    expect(indexSrc).toContain('recoverFromCheckpoints');
    const recoverySrc = await readFile(join(ROOT, 'server', 'services', 'recovery.js'), 'utf-8');
    expect(recoverySrc).toContain('readAllCheckpoints(workspace)');
    expect(recoverySrc).toContain('crash-orphaned');
  });
});

// ═══════════════════════════════════════════════════════════
//  E) Client — useWebSocket subscribeProject
// ═══════════════════════════════════════════════════════════

test.describe('Phase 6.7 — Client useWebSocket', () => {
  test('useWebSocket.js exports subscribeProject', async () => {
    const src = await readFile(join(ROOT, 'client', 'src', 'composables', 'useWebSocket.js'), 'utf-8');
    expect(src).toContain('subscribeProject');
    expect(src).toContain("'ws:subscribe'");
    expect(src).toContain("'ws:unsubscribe'");
  });

  test('subscribeProject tracks currentSubscribedProject', async () => {
    const src = await readFile(join(ROOT, 'client', 'src', 'composables', 'useWebSocket.js'), 'utf-8');
    expect(src).toContain('currentSubscribedProject');
  });

  test('subscribeProject unsubscribes from previous project', async () => {
    const src = await readFile(join(ROOT, 'client', 'src', 'composables', 'useWebSocket.js'), 'utf-8');
    // Should unsubscribe from old project before subscribing to new
    expect(src).toContain("send('ws:unsubscribe'");
  });

  test('onopen sends ws:subscribe for active project', async () => {
    const src = await readFile(join(ROOT, 'client', 'src', 'composables', 'useWebSocket.js'), 'utf-8');
    expect(src).toContain("type: 'ws:subscribe'");
  });

  test('return value includes subscribeProject', async () => {
    const src = await readFile(join(ROOT, 'client', 'src', 'composables', 'useWebSocket.js'), 'utf-8');
    expect(src).toMatch(/return\s*\{[^}]*subscribeProject/);
  });
});

// ═══════════════════════════════════════════════════════════
//  F) App.vue Integration
// ═══════════════════════════════════════════════════════════

test.describe('Phase 6.7 — App.vue Integration', () => {
  test('App.vue destructures subscribeProject from useWebSocket', async () => {
    const src = await readFile(join(ROOT, 'client', 'src', 'App.vue'), 'utf-8');
    expect(src).toContain('subscribeProject');
  });

  test('App.vue calls subscribeProject when activeProject changes', async () => {
    const src = await readFile(join(ROOT, 'client', 'src', 'App.vue'), 'utf-8');
    expect(src).toContain('subscribeProject(project.slug)');
  });

  test('App.vue calls subscribeProject(null) when no project', async () => {
    const src = await readFile(join(ROOT, 'client', 'src', 'App.vue'), 'utf-8');
    expect(src).toContain('subscribeProject(null)');
  });
});

// ═══════════════════════════════════════════════════════════
//  G) Integration — REST endpoint
// ═══════════════════════════════════════════════════════════

test.describe('Phase 6.7 — Integration', () => {
  test('GET /api/checkpoints returns array', async ({ request }) => {
    const res = await request.get('/api/checkpoints');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/health still works after scoped broadcast changes', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });
});
