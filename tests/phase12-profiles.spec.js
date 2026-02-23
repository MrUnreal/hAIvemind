import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';
const PROJ = 'test-profiles-' + Date.now();

test.describe.serial('Phase 12.7 — Agent Profiles', () => {
  let profileId;

  test.beforeAll(async ({ request }) => {
    await request.post(`${API}/projects`, { data: { name: PROJ } });
  });

  // ── CRUD ────────────────────────────────────────────────────────

  test('create profile', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/agent-profiles`, {
      data: { name: 'Alpha Coder', role: 'coder', modelTier: 'T1', systemPrompt: 'You code.', capabilities: ['js', 'py'], tags: ['fast'] }
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Alpha Coder');
    expect(body.role).toBe('coder');
    expect(body.modelTier).toBe('T1');
    expect(body.capabilities).toEqual(['js', 'py']);
    expect(body.tags).toEqual(['fast']);
    expect(body.id).toBeTruthy();
    profileId = body.id;
  });

  test('list profiles returns created profile', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/agent-profiles`);
    expect(res.ok()).toBeTruthy();
    const list = await res.json();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some(p => p.id === profileId)).toBeTruthy();
  });

  test('get single profile', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/agent-profiles/${profileId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.id).toBe(profileId);
    expect(body.name).toBe('Alpha Coder');
  });

  test('update profile', async ({ request }) => {
    const res = await request.patch(`${API}/projects/${PROJ}/agent-profiles/${profileId}`, {
      data: { name: 'Alpha Coder v2', temperature: 0.5 }
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.name).toBe('Alpha Coder v2');
    expect(body.temperature).toBe(0.5);
  });

  test('delete profile', async ({ request }) => {
    // create a throwaway profile to delete
    const cr = await request.post(`${API}/projects/${PROJ}/agent-profiles`, {
      data: { name: 'Trash', role: 'tester' }
    });
    const { id } = await cr.json();
    const res = await request.delete(`${API}/projects/${PROJ}/agent-profiles/${id}`);
    expect(res.ok()).toBeTruthy();
    // verify gone
    const get = await request.get(`${API}/projects/${PROJ}/agent-profiles/${id}`);
    expect(get.status()).toBe(404);
  });

  // ── Clone ───────────────────────────────────────────────────────

  test('clone profile', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/agent-profiles/${profileId}/clone`, {
      data: { name: 'Alpha Clone' }
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Alpha Clone');
    expect(body.role).toBe('coder');
    expect(body.id).not.toBe(profileId);
    expect(body.isDefault).toBe(false);
  });

  // ── Default management ─────────────────────────────────────────

  test('set and get default profile for a role', async ({ request }) => {
    // mark the original profile as default
    await request.patch(`${API}/projects/${PROJ}/agent-profiles/${profileId}`, {
      data: { isDefault: true }
    });
    const res = await request.get(`${API}/projects/${PROJ}/agent-profiles/default/coder`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.id).toBe(profileId);
    expect(body.isDefault).toBe(true);
  });

  test('no default for unset role returns 404', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/agent-profiles/default/ops`);
    expect(res.status()).toBe(404);
  });

  // ── Filters ─────────────────────────────────────────────────────

  test('filter profiles by role', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/agent-profiles?role=coder`);
    expect(res.ok()).toBeTruthy();
    const list = await res.json();
    expect(list.length).toBeGreaterThanOrEqual(1);
    list.forEach(p => expect(p.role).toBe('coder'));
  });

  test('filter profiles by modelTier', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/agent-profiles?modelTier=T1`);
    expect(res.ok()).toBeTruthy();
    const list = await res.json();
    list.forEach(p => expect(p.modelTier).toBe('T1'));
  });

  test('filter profiles by tag', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/agent-profiles?tag=fast`);
    expect(res.ok()).toBeTruthy();
    const list = await res.json();
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  // ── Stats ──────────────────────────────────────────────────────

  test('profile stats', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/agent-profile-stats`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.byRole).toBeDefined();
    expect(body.byTier).toBeDefined();
    expect(body.defaults).toBeDefined();
  });

  // ── Meta endpoints ─────────────────────────────────────────────

  test('profile-roles returns valid list', async ({ request }) => {
    const res = await request.get(`${API}/profile-roles`);
    expect(res.ok()).toBeTruthy();
    const roles = await res.json();
    expect(roles).toContain('coder');
    expect(roles).toContain('generalist');
    expect(roles).toContain('reviewer');
  });

  test('model-tiers returns valid list', async ({ request }) => {
    const res = await request.get(`${API}/model-tiers`);
    expect(res.ok()).toBeTruthy();
    const tiers = await res.json();
    expect(tiers).toContain('T0');
    expect(tiers).toContain('T3');
  });

  // ── Error cases ────────────────────────────────────────────────

  test('create profile with invalid role rejects', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/agent-profiles`, {
      data: { name: 'Bad', role: 'wizard' }
    });
    expect(res.status()).toBe(400);
  });

  test('create profile with invalid model tier rejects', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/agent-profiles`, {
      data: { name: 'Bad', role: 'coder', modelTier: 'T99' }
    });
    expect(res.status()).toBe(400);
  });

  test('create profile without a name rejects', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/agent-profiles`, {
      data: { role: 'coder' }
    });
    expect(res.status()).toBe(400);
  });

  test('get profile on nonexistent project returns 404', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/agent-profiles`);
    expect(res.status()).toBe(404);
  });

  test('clone nonexistent profile returns 404', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/agent-profiles/no-such-id/clone`, {
      data: { name: 'Nope' }
    });
    expect(res.status()).toBe(404);
  });

  test('create profile with duplicate name rejects', async ({ request }) => {
    // Alpha Coder v2 already exists
    const res = await request.post(`${API}/projects/${PROJ}/agent-profiles`, {
      data: { name: 'Alpha Coder v2', role: 'coder' }
    });
    expect(res.status()).toBe(400);
  });
});
