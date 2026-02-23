/**
 * Phase 11.6 — Notification Channels tests
 *
 * Tests channel CRUD, toggle, test, send, digest mode, and meta endpoint.
 *
 * 28 tests
 */

import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';
const PROJ = `notif-chan-${Date.now()}`;
let channelId = null;
let digestChannelId = null;

test.beforeAll(async ({ request }) => {
  await request.post(`${API}/projects`, { data: { name: PROJ } });
});

// ═══════════════════════════════════════════════════════════
//  Channel CRUD
// ═══════════════════════════════════════════════════════════

test.describe('Channel CRUD', () => {
  test('POST creates a Slack channel', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/channels`, {
      data: {
        type: 'slack',
        name: 'Dev Slack',
        config: { webhookUrl: 'https://hooks.slack.com/test' },
        mode: 'realtime',
        events: ['session:complete', 'session:error'],
      },
    });
    expect(res.status()).toBe(201);
    const ch = await res.json();
    expect(ch.type).toBe('slack');
    expect(ch.name).toBe('Dev Slack');
    expect(ch.enabled).toBe(true);
    expect(ch.mode).toBe('realtime');
    expect(ch.events).toContain('session:complete');
    channelId = ch.id;
  });

  test('POST creates a Discord channel in digest mode', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/channels`, {
      data: {
        type: 'discord',
        name: 'Digest Discord',
        config: { webhookUrl: 'https://discord.com/api/webhooks/test' },
        mode: 'digest',
        events: ['*'],
      },
    });
    expect(res.status()).toBe(201);
    const ch = await res.json();
    expect(ch.mode).toBe('digest');
    digestChannelId = ch.id;
  });

  test('POST rejects invalid channel type', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/channels`, {
      data: { type: 'telegram', name: 'Test' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST rejects invalid delivery mode', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/channels`, {
      data: { type: 'slack', mode: 'weekly' },
    });
    expect(res.status()).toBe(400);
  });

  test('GET lists all channels', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/channels`);
    expect(res.ok()).toBe(true);
    const channels = await res.json();
    expect(channels.length).toBe(2);
  });

  test('GET single channel by ID', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/channels/${channelId}`);
    expect(res.ok()).toBe(true);
    const ch = await res.json();
    expect(ch.id).toBe(channelId);
    expect(ch.type).toBe('slack');
  });

  test('GET single channel returns 404 for unknown', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/channels/nonexistent`);
    expect(res.status()).toBe(404);
  });

  test('PUT updates channel', async ({ request }) => {
    const res = await request.put(`${API}/projects/${PROJ}/channels/${channelId}`, {
      data: { name: 'Updated Slack' },
    });
    expect(res.ok()).toBe(true);
    const ch = await res.json();
    expect(ch.name).toBe('Updated Slack');
    expect(ch.updatedAt).toBeTruthy();
  });

  test('PUT returns 404 for unknown channel', async ({ request }) => {
    const res = await request.put(`${API}/projects/${PROJ}/channels/nonexistent`, {
      data: { name: 'X' },
    });
    expect(res.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════
//  Toggle & Test
// ═══════════════════════════════════════════════════════════

test.describe('Toggle & Test', () => {
  test('POST toggle disables channel', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/channels/${channelId}/toggle`);
    expect(res.ok()).toBe(true);
    const ch = await res.json();
    expect(ch.enabled).toBe(false);
  });

  test('POST toggle re-enables channel', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/channels/${channelId}/toggle`);
    expect(res.ok()).toBe(true);
    const ch = await res.json();
    expect(ch.enabled).toBe(true);
  });

  test('POST test sends test notification', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/channels/${channelId}/test`);
    expect(res.ok()).toBe(true);
    const result = await res.json();
    expect(result.status).toBe('test-sent');
    expect(result.type).toBe('slack');
    expect(result.payload).toBeTruthy();
  });

  test('POST test returns 404 for unknown channel', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/channels/nonexistent/test`);
    expect(res.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════
//  Send & Digest
// ═══════════════════════════════════════════════════════════

test.describe('Send & Digest', () => {
  test('POST notify sends to matching realtime channels', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/notify`, {
      data: { action: 'session:complete', detail: 'Build finished' },
    });
    expect(res.ok()).toBe(true);
    const results = await res.json();
    // Slack channel matches session:complete, Discord matches * (digest)
    expect(results.length).toBe(2);
    const slackResult = results.find(r => r.type === 'slack');
    expect(slackResult.status).toBe('sent');
    const discordResult = results.find(r => r.type === 'discord');
    expect(discordResult.status).toBe('buffered');
  });

  test('POST notify skips non-matching events', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/notify`, {
      data: { action: 'file:edit', detail: 'Edited something' },
    });
    const results = await res.json();
    // Only Discord (events: *) should match, Slack only listens to session:*
    const slackResult = results.find(r => r.type === 'slack');
    expect(slackResult).toBeUndefined();
    const discordResult = results.find(r => r.type === 'discord');
    expect(discordResult).toBeTruthy();
  });

  test('POST notify rejects missing action', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/notify`, {
      data: { detail: 'no action' },
    });
    expect(res.status()).toBe(400);
  });

  test('GET digest returns buffered events', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/channels/${digestChannelId}/digest`);
    expect(res.ok()).toBe(true);
    const digest = await res.json();
    expect(digest.length).toBeGreaterThanOrEqual(2); // session:complete + file:edit
  });

  test('POST flush digest returns and clears buffer', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/channels/${digestChannelId}/digest/flush`);
    expect(res.ok()).toBe(true);
    const flushed = await res.json();
    expect(flushed.length).toBeGreaterThanOrEqual(2);

    // After flush, digest should be empty
    const check = await request.get(`${API}/projects/${PROJ}/channels/${digestChannelId}/digest`);
    const empty = await check.json();
    expect(empty.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
//  Delete & Meta
// ═══════════════════════════════════════════════════════════

test.describe('Delete & Meta', () => {
  test('DELETE removes channel', async ({ request }) => {
    const res = await request.delete(`${API}/projects/${PROJ}/channels/${channelId}`);
    expect(res.ok()).toBe(true);

    const list = await request.get(`${API}/projects/${PROJ}/channels`);
    const channels = await list.json();
    expect(channels.find(c => c.id === channelId)).toBeUndefined();
  });

  test('DELETE returns 404 for unknown channel', async ({ request }) => {
    const res = await request.delete(`${API}/projects/${PROJ}/channels/nonexistent`);
    expect(res.status()).toBe(404);
  });

  test('GET notification-meta returns types and modes', async ({ request }) => {
    const res = await request.get(`${API}/notification-meta`);
    expect(res.ok()).toBe(true);
    const meta = await res.json();
    expect(meta.types).toContain('slack');
    expect(meta.types).toContain('discord');
    expect(meta.types).toContain('email');
    expect(meta.modes).toContain('realtime');
    expect(meta.modes).toContain('digest');
  });

  test('channels 404 for unknown project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/channels`);
    expect(res.status()).toBe(404);
  });
});
