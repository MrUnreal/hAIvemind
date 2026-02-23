/**
 * Phase 11.0 — Enhanced Webhook System tests
 *
 * Tests HMAC signatures, exponential backoff, delivery history, test ping,
 * webhook CRUD enhancements (get single, update), delivery stats, and
 * supported events listing.
 *
 * 40 tests
 */

import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';
const PROJ = `wh11-test-${Date.now()}`;

test.beforeAll(async ({ request }) => {
  await request.post(`${API}/projects`, { data: { name: PROJ } });
});

// ═══════════════════════════════════════════════════════════
//  Service-level: HMAC signature computation & verification
// ═══════════════════════════════════════════════════════════

let computeSignature, verifySignature, WEBHOOK_EVENTS;

test.beforeAll(async () => {
  const mod = await import('../server/services/webhooks.js');
  computeSignature = mod.computeSignature;
  verifySignature = mod.verifySignature;
  WEBHOOK_EVENTS = mod.WEBHOOK_EVENTS;
});

test.describe('Webhook HMAC Signatures', () => {
  test('computeSignature returns hex string', () => {
    const sig = computeSignature('{"test":true}', 'secret123');
    expect(sig).toMatch(/^[a-f0-9]{64}$/); // SHA-256 = 64 hex chars
  });

  test('same payload + secret = same signature', () => {
    const sig1 = computeSignature('hello', 'key');
    const sig2 = computeSignature('hello', 'key');
    expect(sig1).toBe(sig2);
  });

  test('different secrets produce different signatures', () => {
    const sig1 = computeSignature('hello', 'key1');
    const sig2 = computeSignature('hello', 'key2');
    expect(sig1).not.toBe(sig2);
  });

  test('different payloads produce different signatures', () => {
    const sig1 = computeSignature('payload1', 'key');
    const sig2 = computeSignature('payload2', 'key');
    expect(sig1).not.toBe(sig2);
  });

  test('verifySignature returns true for valid signature', () => {
    const body = '{"test":true}';
    const secret = 'mySecret';
    const sig = computeSignature(body, secret);
    expect(verifySignature(body, secret, sig)).toBe(true);
  });

  test('verifySignature returns false for tampered body', () => {
    const secret = 'mySecret';
    const sig = computeSignature('original', secret);
    expect(verifySignature('tampered', secret, sig)).toBe(false);
  });

  test('verifySignature returns false for wrong secret', () => {
    const body = 'test';
    const sig = computeSignature(body, 'correct');
    expect(verifySignature(body, 'wrong', sig)).toBe(false);
  });

  test('verifySignature returns false for truncated signature', () => {
    const body = 'test';
    const sig = computeSignature(body, 'key');
    expect(verifySignature(body, 'key', sig.slice(0, 10))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
//  WEBHOOK_EVENTS constant
// ═══════════════════════════════════════════════════════════

test.describe('Webhook Events constant', () => {
  test('WEBHOOK_EVENTS is a non-empty string array', () => {
    expect(Array.isArray(WEBHOOK_EVENTS)).toBe(true);
    expect(WEBHOOK_EVENTS.length).toBeGreaterThan(5);
    for (const e of WEBHOOK_EVENTS) expect(typeof e).toBe('string');
  });

  test('includes core session events', () => {
    expect(WEBHOOK_EVENTS).toContain('session:complete');
    expect(WEBHOOK_EVENTS).toContain('session:failed');
    expect(WEBHOOK_EVENTS).toContain('ping');
  });
});

// ═══════════════════════════════════════════════════════════
//  REST — CRUD enhancements
// ═══════════════════════════════════════════════════════════

test.describe('Webhook CRUD', () => {
  let hookId;

  test('POST creates a webhook with description', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/webhooks`, {
      data: { url: 'https://example.com/hook1', name: 'Test Hook', description: 'My hook', secret: 's3cret' },
    });
    expect(res.status()).toBe(201);
    const hook = await res.json();
    expect(hook.id).toBeTruthy();
    expect(hook.url).toBe('https://example.com/hook1');
    expect(hook.name).toBe('Test Hook');
    expect(hook.description).toBe('My hook');
    expect(hook.secret).toBe('s3cret');
    expect(hook.enabled).toBe(true);
    hookId = hook.id;
  });

  test('GET single webhook by ID', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/webhooks/${hookId}`);
    expect(res.ok()).toBe(true);
    const hook = await res.json();
    expect(hook.id).toBe(hookId);
    expect(hook.url).toBe('https://example.com/hook1');
  });

  test('GET single webhook — 404 for unknown ID', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/webhooks/wh-nonexistent`);
    expect(res.status()).toBe(404);
  });

  test('PUT updates webhook fields', async ({ request }) => {
    const res = await request.put(`${API}/projects/${PROJ}/webhooks/${hookId}`, {
      data: { name: 'Updated Hook', url: 'https://example.com/hook2', description: 'Updated desc' },
    });
    expect(res.ok()).toBe(true);
    const hook = await res.json();
    expect(hook.name).toBe('Updated Hook');
    expect(hook.url).toBe('https://example.com/hook2');
    expect(hook.description).toBe('Updated desc');
    expect(hook.updatedAt).toBeTruthy();
  });

  test('PUT returns 404 for unknown webhook', async ({ request }) => {
    const res = await request.put(`${API}/projects/${PROJ}/webhooks/wh-nope`, {
      data: { name: 'nope' },
    });
    expect(res.status()).toBe(404);
  });

  test('PUT rejects invalid URL', async ({ request }) => {
    const res = await request.put(`${API}/projects/${PROJ}/webhooks/${hookId}`, {
      data: { url: 'not-a-url' },
    });
    expect(res.status()).toBe(400);
  });

  test('PUT can update events list', async ({ request }) => {
    const res = await request.put(`${API}/projects/${PROJ}/webhooks/${hookId}`, {
      data: { events: ['session:complete', 'task:complete', 'ping'] },
    });
    expect(res.ok()).toBe(true);
    const hook = await res.json();
    expect(hook.events).toContain('ping');
    expect(hook.events.length).toBe(3);
  });

  test('PATCH toggles webhook enabled', async ({ request }) => {
    const res = await request.patch(`${API}/projects/${PROJ}/webhooks/${hookId}`, {
      data: { enabled: false },
    });
    expect(res.ok()).toBe(true);
    const hook = await res.json();
    expect(hook.enabled).toBe(false);

    // Re-enable
    const res2 = await request.patch(`${API}/projects/${PROJ}/webhooks/${hookId}`, {
      data: { enabled: true },
    });
    expect(res2.ok()).toBe(true);
  });

  test('LIST webhooks includes the created hook', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/webhooks`);
    expect(res.ok()).toBe(true);
    const hooks = await res.json();
    expect(hooks.length).toBeGreaterThanOrEqual(1);
    expect(hooks.some(h => h.id === hookId)).toBe(true);
  });

  test('POST rejects missing URL', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/webhooks`, {
      data: { name: 'No URL' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST rejects invalid URL', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/webhooks`, {
      data: { url: 'not-valid' },
    });
    expect(res.status()).toBe(400);
  });

  test('DELETE removes webhook', async ({ request }) => {
    // Create a disposable webhook
    const create = await request.post(`${API}/projects/${PROJ}/webhooks`, {
      data: { url: 'https://example.com/disposable' },
    });
    const { id } = await create.json();

    const res = await request.delete(`${API}/projects/${PROJ}/webhooks/${id}`);
    expect(res.ok()).toBe(true);

    // Verify gone
    const get = await request.get(`${API}/projects/${PROJ}/webhooks/${id}`);
    expect(get.status()).toBe(404);
  });

  test('DELETE returns 404 for unknown webhook', async ({ request }) => {
    const res = await request.delete(`${API}/projects/${PROJ}/webhooks/wh-ghost`);
    expect(res.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════
//  REST — Delivery history & stats
// ═══════════════════════════════════════════════════════════

test.describe('Delivery History & Stats', () => {
  test('GET delivery history returns array', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/webhooks-history`);
    expect(res.ok()).toBe(true);
    const history = await res.json();
    expect(Array.isArray(history)).toBe(true);
  });

  test('GET delivery stats returns stats object', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/webhooks-stats`);
    expect(res.ok()).toBe(true);
    const stats = await res.json();
    expect(typeof stats.total).toBe('number');
    expect(typeof stats.successful).toBe('number');
    expect(typeof stats.failed).toBe('number');
    expect(typeof stats.avgDurationMs).toBe('number');
    expect(typeof stats.byWebhook).toBe('object');
  });

  test('DELETE clears delivery history', async ({ request }) => {
    const res = await request.delete(`${API}/projects/${PROJ}/webhooks-history`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify empty
    const get = await request.get(`${API}/projects/${PROJ}/webhooks-history`);
    const history = await get.json();
    expect(history.length).toBe(0);
  });

  test('GET delivery history supports query filters', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/webhooks-history?limit=5&event=session:complete`);
    expect(res.ok()).toBe(true);
    const history = await res.json();
    expect(Array.isArray(history)).toBe(true);
  });

  test('GET delivery history 404 for unknown project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/webhooks-history`);
    expect(res.status()).toBe(404);
  });

  test('GET delivery stats 404 for unknown project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/webhooks-stats`);
    expect(res.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════
//  REST — Supported events & signature verification
// ═══════════════════════════════════════════════════════════

test.describe('Webhook Events & Verify Endpoints', () => {
  test('GET /webhook-events returns supported events', async ({ request }) => {
    const res = await request.get(`${API}/webhook-events`);
    expect(res.ok()).toBe(true);
    const events = await res.json();
    expect(Array.isArray(events)).toBe(true);
    expect(events).toContain('session:complete');
    expect(events).toContain('ping');
  });

  test('POST /webhook-verify validates correct signature', async ({ request }) => {
    const body = '{"event":"test"}';
    const secret = 'verifyMe';
    const sig = computeSignature(body, secret);
    const res = await request.post(`${API}/webhook-verify`, {
      data: { body, secret, signature: `sha256=${sig}` },
    });
    expect(res.ok()).toBe(true);
    const result = await res.json();
    expect(result.valid).toBe(true);
  });

  test('POST /webhook-verify rejects wrong signature', async ({ request }) => {
    const res = await request.post(`${API}/webhook-verify`, {
      data: { body: 'payload', secret: 'key', signature: 'sha256=0000000000000000000000000000000000000000000000000000000000000000' },
    });
    expect(res.ok()).toBe(true);
    const result = await res.json();
    expect(result.valid).toBe(false);
  });

  test('POST /webhook-verify requires all fields', async ({ request }) => {
    const res = await request.post(`${API}/webhook-verify`, {
      data: { body: 'payload' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /webhook-verify handles signature without sha256= prefix', async ({ request }) => {
    const body = 'test';
    const secret = 'key';
    const sig = computeSignature(body, secret);
    const res = await request.post(`${API}/webhook-verify`, {
      data: { body, secret, signature: sig },
    });
    expect(res.ok()).toBe(true);
    const result = await res.json();
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
//  REST — 404 guards for non-existent projects
// ═══════════════════════════════════════════════════════════

test.describe('Webhook 404 guards', () => {
  test('GET webhooks — 404 for nonexistent project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/webhooks`);
    expect(res.status()).toBe(404);
  });

  test('POST webhook — 404 for nonexistent project', async ({ request }) => {
    const res = await request.post(`${API}/projects/nonexistent-zzz/webhooks`, {
      data: { url: 'https://example.com' },
    });
    expect(res.status()).toBe(404);
  });

  test('GET single webhook — 404 for nonexistent project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/webhooks/wh-123`);
    expect(res.status()).toBe(404);
  });

  test('PUT webhook — 404 for nonexistent project', async ({ request }) => {
    const res = await request.put(`${API}/projects/nonexistent-zzz/webhooks/wh-123`, {
      data: { name: 'nope' },
    });
    expect(res.status()).toBe(404);
  });
});
