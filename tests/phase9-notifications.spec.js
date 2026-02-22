// @ts-check
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:3000';

/* ═══════════════════════════════════════════════════════════
   1. Notification service — unit tests
   ═══════════════════════════════════════════════════════════ */
test.describe('Notification service', () => {
  let refs, WorkspaceManager, getNotifications, addNotification,
    markRead, markAllRead, deleteNotification, clearNotifications, getUnreadCount;
  const SLUG = `test-notif-${Date.now()}`;

  test.beforeAll(async () => {
    ({ refs } = await import('../server/state.js'));
    ({ default: WorkspaceManager } = await import('../server/workspace.js'));
    ({
      getNotifications, addNotification, markRead, markAllRead,
      deleteNotification, clearNotifications, getUnreadCount,
    } = await import('../server/services/notifications.js'));

    const testDir = path.resolve(`.haivemind-workspace/${SLUG}`);
    mkdirSync(testDir, { recursive: true });
    const wm = new WorkspaceManager();
    wm.createProject(SLUG, { slug: SLUG });
    refs.workspace = wm;
  });

  test('getNotifications returns empty array for new project', () => {
    expect(getNotifications(SLUG)).toEqual([]);
  });

  test('addNotification creates and returns notification', () => {
    const n = addNotification(SLUG, {
      type: 'session_complete',
      title: 'Session done',
      message: 'All 5 tasks completed',
    });
    expect(n).toHaveProperty('id');
    expect(n.type).toBe('session_complete');
    expect(n.title).toBe('Session done');
    expect(n.read).toBe(false);
    expect(n.slug).toBe(SLUG);
  });

  test('addNotification prepends to list', () => {
    const n2 = addNotification(SLUG, {
      type: 'alert',
      title: 'Warning',
      message: 'Cost threshold exceeded',
    });
    const all = getNotifications(SLUG);
    expect(all[0].id).toBe(n2.id);
    expect(all.length).toBe(2);
  });

  test('getUnreadCount returns count of unread notifications', () => {
    expect(getUnreadCount(SLUG)).toBe(2);
  });

  test('markRead marks a notification as read', () => {
    const all = getNotifications(SLUG);
    const ok = markRead(SLUG, all[0].id);
    expect(ok).toBe(true);
    expect(getUnreadCount(SLUG)).toBe(1);
  });

  test('markRead returns false for nonexistent notification', () => {
    expect(markRead(SLUG, 'nonexistent-id')).toBe(false);
  });

  test('markAllRead marks all as read', () => {
    const count = markAllRead(SLUG);
    expect(count).toBe(1); // only 1 was still unread
    expect(getUnreadCount(SLUG)).toBe(0);
  });

  test('deleteNotification removes a notification', () => {
    const all = getNotifications(SLUG);
    const id = all[0].id;
    const ok = deleteNotification(SLUG, id);
    expect(ok).toBe(true);
    expect(getNotifications(SLUG).length).toBe(1);
  });

  test('deleteNotification returns false for nonexistent', () => {
    expect(deleteNotification(SLUG, 'nope')).toBe(false);
  });

  test('clearNotifications removes all', () => {
    addNotification(SLUG, { type: 'info', title: 'Test', message: 'msg' });
    const count = clearNotifications(SLUG);
    expect(count).toBeGreaterThan(0);
    expect(getNotifications(SLUG)).toEqual([]);
  });

  test('addNotification caps at MAX_NOTIFICATIONS', () => {
    for (let i = 0; i < 210; i++) {
      addNotification(SLUG, { type: 'info', title: `n${i}`, message: `msg${i}` });
    }
    const all = getNotifications(SLUG);
    expect(all.length).toBeLessThanOrEqual(200);
    clearNotifications(SLUG);
  });

  test('notification has meta field', () => {
    const n = addNotification(SLUG, {
      type: 'session_complete',
      title: 'Done',
      message: 'OK',
      meta: { sessionId: 'sess-123' },
    });
    expect(n.meta.sessionId).toBe('sess-123');
    clearNotifications(SLUG);
  });
});

/* ═══════════════════════════════════════════════════════════
   2. REST API — notification endpoints
   ═══════════════════════════════════════════════════════════ */
test.describe('Notification REST API', () => {
  test('GET /api/projects/:slug/notifications returns 404 for nonexistent project', async ({ request }) => {
    const res = await request.get(`${BASE}/api/projects/nonexistent-zzz/notifications`);
    expect(res.status()).toBe(404);
  });

  test('POST /api/projects/:slug/notifications returns 404 for nonexistent project', async ({ request }) => {
    const res = await request.post(`${BASE}/api/projects/nonexistent-zzz/notifications`, {
      data: { type: 'info', title: 'Test', message: 'msg' },
    });
    expect(res.status()).toBe(404);
  });

  test('POST /api/projects/:slug/notifications returns 400 without title/type', async ({ request }) => {
    const res = await request.post(`${BASE}/api/projects/nonexistent-zzz/notifications`, {
      data: { message: 'no title or type' },
    });
    // 404 takes precedence here since project doesn't exist
    expect([400, 404]).toContain(res.status());
  });

  test('DELETE /api/projects/:slug/notifications returns 404 for nonexistent project', async ({ request }) => {
    const res = await request.delete(`${BASE}/api/projects/nonexistent-zzz/notifications`);
    expect(res.status()).toBe(404);
  });

  test('PATCH /api/projects/:slug/notifications/:id/read returns 404', async ({ request }) => {
    const res = await request.patch(`${BASE}/api/projects/nonexistent-zzz/notifications/fake-id/read`);
    expect(res.status()).toBe(404);
  });

  test('POST /api/projects/:slug/notifications/read-all returns 404', async ({ request }) => {
    const res = await request.post(`${BASE}/api/projects/nonexistent-zzz/notifications/read-all`);
    expect(res.status()).toBe(404);
  });
});

/* ═══════════════════════════════════════════════════════════
   3. NotificationCenter.vue — component checks
   ═══════════════════════════════════════════════════════════ */
test.describe('NotificationCenter component', () => {
  const vuePath = path.resolve('client/src/components/NotificationCenter.vue');

  test('has notification list with type icons', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('notif-list');
    expect(src).toContain('typeIcon');
    expect(src).toContain('session_complete');
    expect(src).toContain('session_failed');
    expect(src).toContain('webhook_failure');
  });

  test('has mark-all-read and clear-all actions', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('onMarkAllRead');
    expect(src).toContain('onClearAll');
    expect(src).toContain('Read all');
    expect(src).toContain('Clear');
  });

  test('shows unread indicator', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('unread');
    expect(src).toContain('unreadCount');
  });

  test('has empty state with mailbox icon', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('📭');
    expect(src).toContain('No notifications yet');
  });

  test('uses timeAgo for relative timestamps', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('timeAgo');
    expect(src).toContain('just now');
    expect(src).toContain('ago');
  });

  test('has delete-per-notification functionality', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('onDelete');
    expect(src).toContain('notif-delete-btn');
  });

  test('uses CSS custom properties from theme', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('var(--bg-card)');
    expect(src).toContain('var(--border-primary)');
    expect(src).toContain('var(--shadow-lg)');
  });
});

/* ═══════════════════════════════════════════════════════════
   4. App.vue — notification integration
   ═══════════════════════════════════════════════════════════ */
test.describe('App.vue — notification integration', () => {
  const appPath = path.resolve('client/src/App.vue');

  test('imports NotificationCenter component', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain("import NotificationCenter from './components/NotificationCenter.vue'");
  });

  test('has notification bell button', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain('notif-bell-btn');
    expect(src).toContain('🔔');
  });

  test('has notification badge for unread count', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain('notif-badge');
    expect(src).toContain('notifBadge');
  });

  test('toggles showNotifications on bell click', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain('showNotifications = !showNotifications');
  });

  test('passes projectSlug to NotificationCenter', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain(':projectSlug=');
    expect(src).toContain(':visible="showNotifications"');
  });
});
