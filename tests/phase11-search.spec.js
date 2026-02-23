// @ts-check
import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';
const PROJ = 'test-search-' + Date.now();
let slug;

test.describe.serial('Phase 11.8 — Search & Filter', () => {

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API}/projects`, { data: { name: PROJ } });
    expect(res.status()).toBe(201);
    slug = (await res.json()).slug;
  });

  // ── Seed data ───────────────────────────────────────────────────────────

  test('seed memory entries for search', async ({ request }) => {
    const entries = [
      { key: 'alpha-config', content: 'alpha configuration details' },
      { key: 'beta-deploy', content: 'beta deployment procedure' },
      { key: 'gamma-test', content: 'gamma testing strategy' },
    ];
    for (const e of entries) {
      const r = await request.post(`${API}/projects/${slug}/memory`, { data: e });
      expect(r.status()).toBe(201);
    }
  });

  test('seed collaborators for search', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/collaborators`, {
      data: { userId: 'alice-search', role: 'editor' },
    });
    expect(r.status()).toBe(201);
  });

  test('seed activity for search', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/activity`, {
      data: { userId: 'bob-search', action: 'unique-findable-string in activity' },
    });
    expect(r.status()).toBe(201);
  });

  // ── Basic search ────────────────────────────────────────────────────────

  test('search with empty query returns results', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/search?q=`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty('results');
    expect(body).toHaveProperty('totalCount');
    expect(body).toHaveProperty('types');
  });

  test('search finds memory entries by value', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/search?q=alpha`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.totalCount).toBeGreaterThanOrEqual(1);
    const memResults = body.results.filter(r => r.type === 'memory');
    expect(memResults.length).toBeGreaterThanOrEqual(1);
  });

  test('search finds memory entries by key', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/search?q=beta-deploy`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.totalCount).toBeGreaterThanOrEqual(1);
  });

  test('search finds activity entries', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/search?q=unique-findable-string`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.totalCount).toBeGreaterThanOrEqual(1);
    const actResults = body.results.filter(r => r.type === 'activity');
    expect(actResults.length).toBeGreaterThanOrEqual(1);
  });

  test('search finds collaborator entries', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/search?q=alice-search`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.totalCount).toBeGreaterThanOrEqual(1);
    const colResults = body.results.filter(r => r.type === 'collaborator');
    expect(colResults.length).toBeGreaterThanOrEqual(1);
  });

  // ── Type filtering ──────────────────────────────────────────────────────

  test('search filters by single type', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/search?q=alpha&types=memory`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    for (const result of body.results) {
      expect(result.type).toBe('memory');
    }
  });

  test('search filters by multiple types', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/search?q=&types=memory,activity`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    for (const result of body.results) {
      expect(['memory', 'activity']).toContain(result.type);
    }
  });

  test('search with non-matching type returns empty', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/search?q=alpha&types=diff`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.totalCount).toBe(0);
    expect(body.results).toHaveLength(0);
  });

  // ── Pagination ──────────────────────────────────────────────────────────

  test('search respects limit', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/search?q=&limit=2`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.results.length).toBeLessThanOrEqual(2);
  });

  test('search respects offset', async ({ request }) => {
    const all = await (await request.get(`${API}/projects/${slug}/search?q=`)).json();
    if (all.totalCount > 1) {
      const r2 = await request.get(`${API}/projects/${slug}/search?q=&offset=1`);
      const body2 = await r2.json();
      expect(body2.results.length).toBe(all.totalCount - 1);
    }
  });

  // ── Result structure ────────────────────────────────────────────────────

  test('search results have correct structure', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/search?q=alpha`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    const first = body.results[0];
    expect(first).toHaveProperty('type');
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('match');
    expect(first).toHaveProperty('timestamp');
  });

  test('search returns type counts', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/search?q=`);
    const body = await r.json();
    expect(typeof body.types).toBe('object');
  });

  // ── Saved searches ─────────────────────────────────────────────────────

  let savedSearchId;

  test('save a search', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/saved-searches`, {
      data: { name: 'My Alpha Search', q: 'alpha', types: ['memory'] },
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body).toHaveProperty('id');
    expect(body.name).toBe('My Alpha Search');
    expect(body.q).toBe('alpha');
    savedSearchId = body.id;
  });

  test('list saved searches', async ({ request }) => {
    const r = await request.get(`${API}/projects/${slug}/saved-searches`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body.find(s => s.id === savedSearchId)).toBeTruthy();
  });

  test('delete a saved search', async ({ request }) => {
    const r = await request.delete(`${API}/projects/${slug}/saved-searches/${savedSearchId}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    // verify gone
    const list = await (await request.get(`${API}/projects/${slug}/saved-searches`)).json();
    expect(list.find(s => s.id === savedSearchId)).toBeFalsy();
  });

  test('delete non-existent saved search → 404', async ({ request }) => {
    const r = await request.delete(`${API}/projects/${slug}/saved-searches/nope-999`);
    expect(r.status()).toBe(404);
  });

  test('save search missing fields → 400', async ({ request }) => {
    const r = await request.post(`${API}/projects/${slug}/saved-searches`, {
      data: {},
    });
    expect(r.status()).toBe(400);
  });

  // ── 404 guards ──────────────────────────────────────────────────────────

  test('search on non-existent project → 404', async ({ request }) => {
    const r = await request.get(`${API}/projects/nonexistent-zzz/search?q=hello`);
    expect(r.status()).toBe(404);
  });

  test('saved-searches on non-existent project → 404', async ({ request }) => {
    const r = await request.get(`${API}/projects/nonexistent-zzz/saved-searches`);
    expect(r.status()).toBe(404);
  });

  // ── Search types meta ───────────────────────────────────────────────────

  test('GET /search-types returns valid list', async ({ request }) => {
    const r = await request.get(`${API}/search-types`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toContain('session');
    expect(body).toContain('memory');
    expect(body).toContain('diff');
  });

  // ── Date filtering ─────────────────────────────────────────────────────

  test('search with since filter narrows results', async ({ request }) => {
    const futureTs = Date.now() + 86400000; // tomorrow
    const r = await request.get(`${API}/projects/${slug}/search?q=alpha&since=${futureTs}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.totalCount).toBe(0);
  });

  test('search with until filter narrows results', async ({ request }) => {
    const pastTs = 1000; // epoch + 1s
    const r = await request.get(`${API}/projects/${slug}/search?q=alpha&until=${pastTs}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.totalCount).toBe(0);
  });
});
