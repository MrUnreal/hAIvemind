/**
 * Phase 11.3 — Collaboration tests
 *
 * Tests role-based access control, collaborator CRUD, activity feed,
 * presence tracking, and roles listing.
 *
 * 36 tests
 */

import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';
const PROJ = `collab-test-${Date.now()}`;

test.beforeAll(async ({ request }) => {
  await request.post(`${API}/projects`, { data: { name: PROJ } });
});

// ═══════════════════════════════════════════════════════════
//  Collaborator CRUD & RBAC
// ═══════════════════════════════════════════════════════════

test.describe('Collaborator CRUD', () => {
  test('POST adds a collaborator', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/collaborators`, {
      data: { userId: 'user-1', name: 'Alice', role: 'editor' },
    });
    expect(res.status()).toBe(201);
    const collab = await res.json();
    expect(collab.userId).toBe('user-1');
    expect(collab.name).toBe('Alice');
    expect(collab.role).toBe('editor');
    expect(collab.addedAt).toBeTruthy();
  });

  test('POST adds another collaborator as viewer', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/collaborators`, {
      data: { userId: 'user-2', name: 'Bob', role: 'viewer' },
    });
    expect(res.status()).toBe(201);
    const collab = await res.json();
    expect(collab.role).toBe('viewer');
  });

  test('POST adds admin collaborator', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/collaborators`, {
      data: { userId: 'user-3', name: 'Charlie', role: 'admin' },
    });
    expect(res.status()).toBe(201);
  });

  test('GET lists all collaborators', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/collaborators`);
    expect(res.ok()).toBe(true);
    const collabs = await res.json();
    expect(collabs.length).toBe(3);
    const ids = collabs.map(c => c.userId);
    expect(ids).toContain('user-1');
    expect(ids).toContain('user-2');
    expect(ids).toContain('user-3');
  });

  test('POST updates existing collaborator role', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/collaborators`, {
      data: { userId: 'user-2', role: 'editor' },
    });
    expect(res.status()).toBe(201);
    const collab = await res.json();
    expect(collab.role).toBe('editor');
    expect(collab.updatedAt).toBeTruthy();
  });

  test('POST rejects invalid role', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/collaborators`, {
      data: { userId: 'user-4', role: 'superuser' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST rejects missing userId', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/collaborators`, {
      data: { name: 'No ID' },
    });
    expect(res.status()).toBe(400);
  });

  test('DELETE removes collaborator', async ({ request }) => {
    const res = await request.delete(`${API}/projects/${PROJ}/collaborators/user-3`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify removed
    const list = await request.get(`${API}/projects/${PROJ}/collaborators`);
    const collabs = await list.json();
    expect(collabs.find(c => c.userId === 'user-3')).toBeUndefined();
  });

  test('DELETE returns 404 for unknown collaborator', async ({ request }) => {
    const res = await request.delete(`${API}/projects/${PROJ}/collaborators/nobody`);
    expect(res.status()).toBe(404);
  });
});

test.describe('Role & Access Checks', () => {
  test('GET role returns user role', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/collaborators/user-1/role`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.role).toBe('editor');
  });

  test('GET role returns null for non-collaborator', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/collaborators/stranger/role`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.role).toBeNull();
  });

  test('GET access returns allowed for sufficient role', async ({ request }) => {
    // user-1 is editor, checking viewer access should be allowed
    const res = await request.get(`${API}/projects/${PROJ}/collaborators/user-1/access/viewer`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.allowed).toBe(true);
  });

  test('GET access returns denied for insufficient role', async ({ request }) => {
    // user-2 is editor, checking admin access should be denied
    const res = await request.get(`${API}/projects/${PROJ}/collaborators/user-2/access/admin`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.allowed).toBe(false);
  });

  test('GET access returns denied for non-collaborator', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/collaborators/stranger/access/viewer`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.allowed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
//  Activity Feed
// ═══════════════════════════════════════════════════════════

test.describe('Activity Feed', () => {
  test('POST records activity', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/activity`, {
      data: { userId: 'user-1', action: 'session:start', detail: 'Started a new session' },
    });
    expect(res.status()).toBe(201);
    const record = await res.json();
    expect(record.id).toBeTruthy();
    expect(record.userId).toBe('user-1');
    expect(record.action).toBe('session:start');
    expect(record.timestamp).toBeTruthy();
  });

  test('POST records multiple activities', async ({ request }) => {
    await request.post(`${API}/projects/${PROJ}/activity`, {
      data: { userId: 'user-2', action: 'file:edit', detail: 'Edited config' },
    });
    await request.post(`${API}/projects/${PROJ}/activity`, {
      data: { userId: 'user-1', action: 'session:complete', detail: 'Session done' },
    });
  });

  test('GET returns activity feed', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/activity`);
    expect(res.ok()).toBe(true);
    const activity = await res.json();
    expect(activity.length).toBeGreaterThanOrEqual(3);
  });

  test('GET filters by userId', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/activity?userId=user-1`);
    const activity = await res.json();
    expect(activity.length).toBeGreaterThanOrEqual(2);
    for (const a of activity) expect(a.userId).toBe('user-1');
  });

  test('GET filters by action', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/activity?action=file:edit`);
    const activity = await res.json();
    expect(activity.length).toBeGreaterThanOrEqual(1);
    for (const a of activity) expect(a.action).toBe('file:edit');
  });

  test('POST rejects missing fields', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/activity`, {
      data: { detail: 'no userId or action' },
    });
    expect(res.status()).toBe(400);
  });

  test('DELETE clears activity', async ({ request }) => {
    const res = await request.delete(`${API}/projects/${PROJ}/activity`);
    expect(res.ok()).toBe(true);

    const get = await request.get(`${API}/projects/${PROJ}/activity`);
    const activity = await get.json();
    expect(activity.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
//  Presence
// ═══════════════════════════════════════════════════════════

test.describe('Presence Tracking', () => {
  test('POST joins presence', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/presence`, {
      data: { userId: 'user-1' },
    });
    expect(res.ok()).toBe(true);
    const entry = await res.json();
    expect(entry.userId).toBe('user-1');
    expect(entry.joinedAt).toBeTruthy();
    expect(entry.lastSeen).toBeTruthy();
  });

  test('POST another user joins', async ({ request }) => {
    await request.post(`${API}/projects/${PROJ}/presence`, {
      data: { userId: 'user-2' },
    });
  });

  test('GET presence lists active users', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/presence`);
    expect(res.ok()).toBe(true);
    const users = await res.json();
    expect(users.length).toBe(2);
    const ids = users.map(u => u.userId);
    expect(ids).toContain('user-1');
    expect(ids).toContain('user-2');
  });

  test('POST heartbeat updates lastSeen', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/presence/user-1/heartbeat`);
    expect(res.ok()).toBe(true);
  });

  test('DELETE leaves presence', async ({ request }) => {
    const res = await request.delete(`${API}/projects/${PROJ}/presence/user-2`);
    expect(res.ok()).toBe(true);

    const get = await request.get(`${API}/projects/${PROJ}/presence`);
    const users = await get.json();
    expect(users.length).toBe(1);
    expect(users[0].userId).toBe('user-1');
  });

  test('POST requires userId', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/presence`, {
      data: {},
    });
    expect(res.status()).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════
//  Roles listing & 404 guards
// ═══════════════════════════════════════════════════════════

test.describe('Roles & Guards', () => {
  test('GET /collaboration/roles returns valid roles', async ({ request }) => {
    const res = await request.get(`${API}/collaboration/roles`);
    expect(res.ok()).toBe(true);
    const roles = await res.json();
    expect(roles).toEqual(['viewer', 'editor', 'admin']);
  });

  test('collaborators 404 for unknown project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/collaborators`);
    expect(res.status()).toBe(404);
  });

  test('activity 404 for unknown project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/activity`);
    expect(res.status()).toBe(404);
  });

  test('presence 404 for unknown project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/presence`);
    expect(res.status()).toBe(404);
  });
});
