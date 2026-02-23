// @ts-nocheck
import { test, expect } from '@playwright/test';

const API = 'http://localhost:3000/api';
const PROJ = `test-dashboard-${Date.now()}`;

test.describe.serial('Phase 12.8 — Dashboard Widgets', () => {
  let widgetId;

  test.beforeAll(async ({ request }) => {
    await request.post(`${API}/projects`, { data: { name: PROJ } });
  });

  // ── Widget CRUD ─────────────────────────────────────────────────────

  test('create widget', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/dashboard/widgets`, {
      data: { title: 'Cost Overview', type: 'cost-graph', size: 'large' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.title).toBe('Cost Overview');
    expect(body.type).toBe('cost-graph');
    expect(body.size).toBe('large');
    expect(body).toHaveProperty('id');
    expect(body.visible).toBe(true);
    widgetId = body.id;
  });

  test('create widget missing title → 400', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/dashboard/widgets`, {
      data: { type: 'cost-graph' },
    });
    expect(res.status()).toBe(400);
  });

  test('create widget missing type → 400', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/dashboard/widgets`, {
      data: { title: 'No Type' },
    });
    expect(res.status()).toBe(400);
  });

  test('create widget invalid type → 400', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/dashboard/widgets`, {
      data: { title: 'Bad Type', type: 'unicorn' },
    });
    expect(res.status()).toBe(400);
  });

  test('list widgets returns created widget', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/dashboard/widgets`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body.some(w => w.id === widgetId)).toBe(true);
  });

  test('get single widget', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/dashboard/widgets/${widgetId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(widgetId);
    expect(body.title).toBe('Cost Overview');
  });

  test('get nonexistent widget → 404', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/dashboard/widgets/wdg-fake`);
    expect(res.status()).toBe(404);
  });

  test('update widget', async ({ request }) => {
    const res = await request.patch(`${API}/projects/${PROJ}/dashboard/widgets/${widgetId}`, {
      data: { title: 'Cost v2', size: 'small' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Cost v2');
    expect(body.size).toBe('small');
  });

  test('update nonexistent widget → 404', async ({ request }) => {
    const res = await request.patch(`${API}/projects/${PROJ}/dashboard/widgets/wdg-fake`, {
      data: { title: 'nope' },
    });
    expect(res.status()).toBe(404);
  });

  // ── Layout ──────────────────────────────────────────────────────────

  test('get layout', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/dashboard/layout`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('columns');
    expect(body).toHaveProperty('widgets');
    expect(Array.isArray(body.widgets)).toBe(true);
  });

  test('update layout columns', async ({ request }) => {
    const res = await request.patch(`${API}/projects/${PROJ}/dashboard/layout`, {
      data: { columns: 4 },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.columns).toBe(4);
  });

  // ── Widget Data ─────────────────────────────────────────────────────

  test('get widget data', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/dashboard/widgets/${widgetId}/data`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.type).toBe('cost-graph');
    expect(body).toHaveProperty('points');
    expect(body).toHaveProperty('totalCost');
  });

  test('get data for nonexistent widget → 404', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/dashboard/widgets/wdg-fake/data`);
    expect(res.status()).toBe(404);
  });

  // ── Multiple Widget Types ───────────────────────────────────────────

  test('create throughput widget and get data', async ({ request }) => {
    const cr = await request.post(`${API}/projects/${PROJ}/dashboard/widgets`, {
      data: { title: 'Throughput', type: 'task-throughput' },
    });
    expect(cr.status()).toBe(201);
    const w = await cr.json();
    const dr = await request.get(`${API}/projects/${PROJ}/dashboard/widgets/${w.id}/data`);
    expect(dr.status()).toBe(200);
    const data = await dr.json();
    expect(data.type).toBe('task-throughput');
    expect(data).toHaveProperty('totalTasks');
  });

  test('create error-rate widget and get data', async ({ request }) => {
    const cr = await request.post(`${API}/projects/${PROJ}/dashboard/widgets`, {
      data: { title: 'Errors', type: 'error-rate' },
    });
    expect(cr.status()).toBe(201);
    const w = await cr.json();
    const dr = await request.get(`${API}/projects/${PROJ}/dashboard/widgets/${w.id}/data`);
    const data = await dr.json();
    expect(data.type).toBe('error-rate');
    expect(data).toHaveProperty('rate');
  });

  // ── Dashboard Stats ─────────────────────────────────────────────────

  test('dashboard stats', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/dashboard/stats`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.totalWidgets).toBeGreaterThanOrEqual(3);
    expect(body).toHaveProperty('visible');
    expect(body).toHaveProperty('byType');
    expect(body).toHaveProperty('bySize');
  });

  // ── Delete ──────────────────────────────────────────────────────────

  test('delete widget', async ({ request }) => {
    const res = await request.delete(`${API}/projects/${PROJ}/dashboard/widgets/${widgetId}`);
    expect(res.status()).toBe(200);
    const check = await request.get(`${API}/projects/${PROJ}/dashboard/widgets/${widgetId}`);
    expect(check.status()).toBe(404);
  });

  test('delete nonexistent widget → 404', async ({ request }) => {
    const res = await request.delete(`${API}/projects/${PROJ}/dashboard/widgets/wdg-fake`);
    expect(res.status()).toBe(404);
  });

  // ── Meta ────────────────────────────────────────────────────────────

  test('widget-types returns valid list', async ({ request }) => {
    const res = await request.get(`${API}/widget-types`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toContain('cost-graph');
    expect(body).toContain('task-throughput');
  });

  test('widget-sizes returns valid list', async ({ request }) => {
    const res = await request.get(`${API}/widget-sizes`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toContain('small');
    expect(body).toContain('large');
  });

  // ── 404 guard ───────────────────────────────────────────────────────

  test('widgets on nonexistent project → 404', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/dashboard/widgets`);
    expect(res.status()).toBe(404);
  });
});
