/**
 * Phase 10.5 — Event Bus Tests
 *
 * Tests for internal pub/sub event system: subscribe, emit, once,
 * wildcard, async handlers, history, stats, and REST endpoints.
 */
import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';

let bus;

test.beforeAll(async () => {
  bus = await import('../server/services/eventBus.js');
});

// ═══════════════════════════════════════════════════════════════════
//  1 · EVENT BUS — Subscribe + Emit
// ═══════════════════════════════════════════════════════════════════

test.describe('Event Bus — Subscribe + Emit', () => {
  test.beforeEach(() => bus._reset());

  test('on registers a listener that fires on emit', async () => {
    let received = null;
    bus.on('test:event', (data) => { received = data; });
    await bus.emit('test:event', { value: 42 });
    expect(received).toEqual({ value: 42 });
  });

  test('emit returns listener count and no errors', async () => {
    bus.on('x', () => {});
    bus.on('x', () => {});
    const result = await bus.emit('x');
    expect(result.event).toBe('x');
    expect(result.listenerCount).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  test('emit captures handler errors', async () => {
    bus.on('fail', () => { throw new Error('boom'); });
    const result = await bus.emit('fail');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toBe('boom');
  });

  test('emit with no listeners returns 0 count', async () => {
    const result = await bus.emit('nobody');
    expect(result.listenerCount).toBe(0);
  });

  test('handler receives meta with event name and timestamp', async () => {
    let meta = null;
    bus.on('meta-test', (data, m) => { meta = m; });
    await bus.emit('meta-test');
    expect(meta.event).toBe('meta-test');
    expect(meta.timestamp).toBeTruthy();
    expect(meta.id).toMatch(/^evt-/);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  2 · EVENT BUS — Once + Off
// ═══════════════════════════════════════════════════════════════════

test.describe('Event Bus — Once + Off', () => {
  test.beforeEach(() => bus._reset());

  test('once fires only on first emit', async () => {
    let count = 0;
    bus.once('one', () => { count++; });
    await bus.emit('one');
    await bus.emit('one');
    expect(count).toBe(1);
  });

  test('off removes a subscription', async () => {
    let count = 0;
    const id = bus.on('rem', () => { count++; });
    expect(bus.off(id)).toBe(true);
    await bus.emit('rem');
    expect(count).toBe(0);
  });

  test('off returns false for unknown id', () => {
    expect(bus.off(999999)).toBe(false);
  });

  test('removeAllListeners clears specific event', () => {
    bus.on('a', () => {});
    bus.on('b', () => {});
    bus.removeAllListeners('a');
    expect(bus.listEvents()).not.toContain('a');
    expect(bus.listEvents()).toContain('b');
  });

  test('removeAllListeners clears all events when no arg', () => {
    bus.on('x', () => {});
    bus.on('y', () => {});
    bus.removeAllListeners();
    expect(bus.listEvents()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  3 · EVENT BUS — Wildcard
// ═══════════════════════════════════════════════════════════════════

test.describe('Event Bus — Wildcard', () => {
  test.beforeEach(() => bus._reset());

  test('wildcard * listener fires on any event', async () => {
    const events = [];
    bus.on('*', (data, meta) => { events.push(meta.event); });
    await bus.emit('foo');
    await bus.emit('bar');
    expect(events).toEqual(['foo', 'bar']);
  });

  test('wildcard + specific both fire', async () => {
    let wildcardFired = false;
    let specificFired = false;
    bus.on('*', () => { wildcardFired = true; });
    bus.on('exact', () => { specificFired = true; });
    await bus.emit('exact');
    expect(wildcardFired).toBe(true);
    expect(specificFired).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  4 · EVENT BUS — Async Handlers
// ═══════════════════════════════════════════════════════════════════

test.describe('Event Bus — Async Handlers', () => {
  test.beforeEach(() => bus._reset());

  test('async handlers are awaited', async () => {
    let value = 0;
    bus.on('async', async () => {
      await new Promise(r => setTimeout(r, 10));
      value = 1;
    });
    await bus.emit('async');
    expect(value).toBe(1);
  });

  test('emitSync does not block', () => {
    let fired = false;
    bus.on('sync-test', () => { fired = true; });
    bus.emitSync('sync-test');
    // emitSync is fire-and-forget, but handler runs on microtask
    // The test just verifies it doesn't throw
  });
});

// ═══════════════════════════════════════════════════════════════════
//  5 · EVENT BUS — History
// ═══════════════════════════════════════════════════════════════════

test.describe('Event Bus — History', () => {
  test.beforeEach(() => bus._reset());

  test('getHistory returns emitted events', async () => {
    await bus.emit('h1', { a: 1 });
    await bus.emit('h2', { b: 2 });
    const h = bus.getHistory();
    expect(h.length).toBeGreaterThanOrEqual(2);
    expect(h.some(e => e.event === 'h1')).toBe(true);
    expect(h.some(e => e.event === 'h2')).toBe(true);
  });

  test('getHistory filters by event', async () => {
    await bus.emit('filter-a');
    await bus.emit('filter-b');
    const h = bus.getHistory({ event: 'filter-a' });
    expect(h.every(e => e.event === 'filter-a')).toBe(true);
  });

  test('getHistory respects limit', async () => {
    for (let i = 0; i < 10; i++) await bus.emit('lim');
    const h = bus.getHistory({ limit: 3 });
    expect(h).toHaveLength(3);
  });

  test('clearHistory empties the log', async () => {
    await bus.emit('temp');
    bus.clearHistory();
    expect(bus.getHistory()).toHaveLength(0);
  });

  test('history caps at MAX_HISTORY', async () => {
    bus._reset();
    for (let i = 0; i < 210; i++) await bus.emit('cap');
    const h = bus.getHistory({ limit: 300 });
    expect(h.length).toBeLessThanOrEqual(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  6 · EVENT BUS — Stats + List Events
// ═══════════════════════════════════════════════════════════════════

test.describe('Event Bus — Stats', () => {
  test.beforeEach(() => bus._reset());

  test('getStats returns listener counts', () => {
    bus.on('s1', () => {});
    bus.on('s1', () => {});
    bus.on('s2', () => {});
    const s = bus.getStats();
    expect(s.totalListeners).toBe(3);
    expect(s.eventCounts.s1).toBe(2);
    expect(s.eventCounts.s2).toBe(1);
  });

  test('getStats includes history counts', async () => {
    await bus.emit('hc', {});
    await bus.emit('hc', {});
    const s = bus.getStats();
    expect(s.historySize).toBe(2);
    expect(s.historyCounts.hc).toBe(2);
  });

  test('listEvents returns registered event names', () => {
    bus.on('e1', () => {});
    bus.on('e2', () => {});
    const events = bus.listEvents();
    expect(events).toContain('e1');
    expect(events).toContain('e2');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  7 · EVENT BUS — EVENTS constant
// ═══════════════════════════════════════════════════════════════════

test.describe('Event Bus — Constants', () => {
  test('EVENTS has well-known event names', () => {
    expect(bus.EVENTS.SESSION_START).toBe('session:start');
    expect(bus.EVENTS.TASK_COMPLETE).toBe('task:complete');
    expect(bus.EVENTS.PLUGIN_LOAD).toBe('plugin:load');
    expect(bus.EVENTS.DIFF_ADD).toBe('diff:add');
    expect(bus.EVENTS.ALERT_FIRE).toBe('alert:fire');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  8 · EVENT BUS — on() validation
// ═══════════════════════════════════════════════════════════════════

test.describe('Event Bus — Validation', () => {
  test.beforeEach(() => bus._reset());

  test('on throws if handler is not a function', () => {
    expect(() => bus.on('bad', 'not-a-function')).toThrow('Handler must be a function');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  9 · REST ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

test.describe('Event Bus — REST Endpoints', () => {
  let request;

  test.beforeAll(async ({ playwright }) => {
    request = await playwright.request.newContext();
    // Clear history at start
    await request.delete(`${API}/events/history`);
  });

  test('POST /events/emit fires an event', async () => {
    const res = await request.post(`${API}/events/emit`, {
      data: { event: 'rest:test', data: { key: 'val' } },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.event).toBe('rest:test');
    expect(typeof body.listenerCount).toBe('number');
  });

  test('POST /events/emit requires event name', async () => {
    const res = await request.post(`${API}/events/emit`, {
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('GET /events/history returns emitted events', async () => {
    await request.post(`${API}/events/emit`, {
      data: { event: 'history:check' },
    });
    const res = await request.get(`${API}/events/history`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.some(e => e.event === 'history:check')).toBe(true);
  });

  test('GET /events/history?event=x filters', async () => {
    const res = await request.get(`${API}/events/history?event=rest:test`);
    const body = await res.json();
    expect(body.every(e => e.event === 'rest:test')).toBe(true);
  });

  test('GET /events/history?limit=1 limits', async () => {
    const res = await request.get(`${API}/events/history?limit=1`);
    const body = await res.json();
    expect(body.length).toBeLessThanOrEqual(1);
  });

  test('GET /events/stats returns stats', async () => {
    const res = await request.get(`${API}/events/stats`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.totalListeners).toBe('number');
    expect(typeof body.historySize).toBe('number');
  });

  test('GET /events lists events', async () => {
    const res = await request.get(`${API}/events`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.wellKnown).toBeTruthy();
    expect(body.wellKnown.SESSION_START).toBe('session:start');
  });

  test('DELETE /events/history clears history', async () => {
    await request.post(`${API}/events/emit`, { data: { event: 'temp' } });
    const res = await request.delete(`${API}/events/history`);
    expect(res.ok()).toBeTruthy();
    const check = await request.get(`${API}/events/history`);
    const body = await check.json();
    expect(body).toHaveLength(0);
  });
});
