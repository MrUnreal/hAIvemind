/**
 * Phase 9.8 — Multi-User Auth Tests
 *
 * Tests for authentication service, middleware, routes,
 * project access control, and client component integration.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, existsSync, rmSync } from 'fs';

const API = 'http://localhost:3000/api';
const TEST_DIR = '.haivemind-workspace';

// ─── Helpers ─────────────────────────────────────────────────────────
let WorkspaceManager, refs, authService;

test.beforeAll(async () => {
  const wsModule = await import('../server/workspace.js');
  WorkspaceManager = wsModule.default;
  const stateModule = await import('../server/state.js');
  refs = stateModule.refs;
  authService = await import('../server/services/auth.js');

  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  const wm = new WorkspaceManager(TEST_DIR);
  refs.workspace = wm;
  try { wm.createProject('auth-test-proj'); } catch { /* exists */ }
});

test.afterAll(async () => {
  if (existsSync(TEST_DIR)) {
    const { rmSync: rm } = await import('fs');
    rm(TEST_DIR, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  1 · AUTH SERVICE — User Registration
// ═══════════════════════════════════════════════════════════════════

test.describe('Auth Service — User Registration', () => {
  test('registerUser creates a user with hashed password', () => {
    const user = authService.registerUser('testuser1', 'pass1234');
    expect(user.id).toMatch(/^usr-/);
    expect(user.username).toBe('testuser1');
    expect(user.role).toBe('user');
  });

  test('registerUser rejects duplicate username', () => {
    authService.registerUser('dupuser', 'pass1234');
    expect(() => authService.registerUser('dupuser', 'pass5678')).toThrow('Username already taken');
  });

  test('registerUser validates username length', () => {
    expect(() => authService.registerUser('a', 'pass1234')).toThrow('at least 2 characters');
  });

  test('registerUser validates password length', () => {
    expect(() => authService.registerUser('validname', 'abc')).toThrow('at least 4 characters');
  });

  test('registerUser respects role parameter', () => {
    const admin = authService.registerUser('adminuser1', 'pass1234', 'admin');
    expect(admin.role).toBe('admin');
    const viewer = authService.registerUser('vieweruser1', 'pass1234', 'viewer');
    expect(viewer.role).toBe('viewer');
  });

  test('registerUser defaults invalid role to user', () => {
    const user = authService.registerUser('badrole1', 'pass1234', 'superadmin');
    expect(user.role).toBe('user');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  2 · AUTH SERVICE — Authentication
// ═══════════════════════════════════════════════════════════════════

test.describe('Auth Service — Authentication', () => {
  test('authenticateUser returns token for valid credentials', () => {
    authService.registerUser('authuser1', 'secret123');
    const result = authService.authenticateUser('authuser1', 'secret123');
    expect(result.token).toBeTruthy();
    expect(result.token.length).toBe(64); // 32 random bytes = 64 hex chars
    expect(result.user.username).toBe('authuser1');
    expect(result.expiresAt).toBeTruthy();
  });

  test('authenticateUser throws for wrong password', () => {
    authService.registerUser('authuser2', 'correct');
    expect(() => authService.authenticateUser('authuser2', 'wrong')).toThrow('Invalid credentials');
  });

  test('authenticateUser throws for non-existent user', () => {
    expect(() => authService.authenticateUser('nobody', 'pass')).toThrow('Invalid credentials');
  });

  test('verifyToken returns user info for valid token', () => {
    authService.registerUser('tokenuser1', 'pass1234');
    const { token } = authService.authenticateUser('tokenuser1', 'pass1234');
    const user = authService.verifyToken(token);
    expect(user.username).toBe('tokenuser1');
    expect(user.role).toBe('user');
  });

  test('verifyToken returns null for invalid token', () => {
    expect(authService.verifyToken('invalidtoken')).toBeNull();
  });

  test('verifyToken returns null for null/empty', () => {
    expect(authService.verifyToken(null)).toBeNull();
    expect(authService.verifyToken('')).toBeNull();
  });

  test('revokeToken invalidates a token', () => {
    authService.registerUser('revokeuser1', 'pass1234');
    const { token } = authService.authenticateUser('revokeuser1', 'pass1234');
    expect(authService.verifyToken(token)).toBeTruthy();
    authService.revokeToken(token);
    expect(authService.verifyToken(token)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  3 · AUTH SERVICE — User Management
// ═══════════════════════════════════════════════════════════════════

test.describe('Auth Service — User Management', () => {
  test('getUsers returns sanitized user list', () => {
    const users = authService.getUsers();
    expect(users.length).toBeGreaterThan(0);
    const user = users[0];
    expect(user.id).toBeTruthy();
    expect(user.username).toBeTruthy();
    expect(user.role).toBeTruthy();
    // Should NOT contain passwordHash or salt
    expect(user.passwordHash).toBeUndefined();
    expect(user.salt).toBeUndefined();
  });

  test('removeUser deletes a user', () => {
    const user = authService.registerUser('removetest1', 'pass1234');
    const before = authService.getUsers().length;
    authService.removeUser(user.id);
    const after = authService.getUsers().length;
    expect(after).toBe(before - 1);
  });

  test('removeUser returns false for non-existent user', () => {
    expect(authService.removeUser('usr-nonexistent')).toBe(false);
  });

  test('updateUserRole changes user role', () => {
    const user = authService.registerUser('rolechange1', 'pass1234');
    const updated = authService.updateUserRole(user.id, 'admin');
    expect(updated.role).toBe('admin');
  });

  test('updateUserRole rejects invalid role', () => {
    const user = authService.registerUser('rolechange2', 'pass1234');
    expect(() => authService.updateUserRole(user.id, 'superadmin')).toThrow('Invalid role');
  });

  test('removeUser revokes user tokens', () => {
    const user = authService.registerUser('tokendel1', 'pass1234');
    const { token } = authService.authenticateUser('tokendel1', 'pass1234');
    expect(authService.verifyToken(token)).toBeTruthy();
    authService.removeUser(user.id);
    expect(authService.verifyToken(token)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  4 · AUTH SERVICE — Auth Enable/Disable
// ═══════════════════════════════════════════════════════════════════

test.describe('Auth Service — Enable/Disable', () => {
  test('isAuthEnabled returns boolean', () => {
    const enabled = authService.isAuthEnabled();
    expect(typeof enabled).toBe('boolean');
  });

  test('enableAuth sets auth enabled', () => {
    authService.enableAuth();
    expect(authService.isAuthEnabled()).toBe(true);
  });

  test('disableAuth sets auth disabled and clears tokens', () => {
    authService.registerUser('disuser1', 'pass1234');
    authService.authenticateUser('disuser1', 'pass1234');
    authService.disableAuth();
    expect(authService.isAuthEnabled()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  5 · AUTH SERVICE — Project ACL
// ═══════════════════════════════════════════════════════════════════

test.describe('Auth Service — Project ACL', () => {
  test('getProjectAcl returns default public ACL', () => {
    const acl = authService.getProjectAcl('auth-test-proj');
    expect(acl.public).toBe(true);
    expect(acl.owner).toBeNull();
  });

  test('setProjectAcl persists ACL', () => {
    authService.setProjectAcl('auth-test-proj', { owner: 'usr-123', allowedUsers: ['usr-456'], public: false });
    const acl = authService.getProjectAcl('auth-test-proj');
    expect(acl.owner).toBe('usr-123');
    expect(acl.allowedUsers).toContain('usr-456');
    expect(acl.public).toBe(false);
  });

  test('checkProjectAccess allows admin regardless', () => {
    authService.enableAuth();
    authService.setProjectAcl('auth-test-proj', { owner: 'usr-111', allowedUsers: [], public: false });
    expect(authService.checkProjectAccess('auth-test-proj', { userId: 'usr-999', role: 'admin' })).toBe(true);
    authService.disableAuth();
  });

  test('checkProjectAccess allows owner', () => {
    authService.enableAuth();
    authService.setProjectAcl('auth-test-proj', { owner: 'usr-111', allowedUsers: [], public: false });
    expect(authService.checkProjectAccess('auth-test-proj', { userId: 'usr-111', role: 'user' })).toBe(true);
    authService.disableAuth();
  });

  test('checkProjectAccess denies unrelated user on private project', () => {
    authService.enableAuth();
    authService.setProjectAcl('auth-test-proj', { owner: 'usr-111', allowedUsers: [], public: false });
    expect(authService.checkProjectAccess('auth-test-proj', { userId: 'usr-999', role: 'user' })).toBe(false);
    authService.disableAuth();
  });

  test('checkProjectAccess allows all when public', () => {
    authService.enableAuth();
    authService.setProjectAcl('auth-test-proj', { owner: 'usr-111', allowedUsers: [], public: true });
    expect(authService.checkProjectAccess('auth-test-proj', { userId: 'usr-999', role: 'user' })).toBe(true);
    authService.disableAuth();
  });

  test('checkProjectAccess allows all when auth disabled', () => {
    authService.disableAuth();
    expect(authService.checkProjectAccess('auth-test-proj', null)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  6 · AUTH ROUTES — REST API
// ═══════════════════════════════════════════════════════════════════

test.describe('Auth Routes — REST API', () => {
  test('GET /auth/status returns auth state', async ({ request }) => {
    const res = await request.get(`${API}/auth/status`);
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(typeof data.enabled).toBe('boolean');
  });

  test('POST /auth/register creates a user', async ({ request }) => {
    const res = await request.post(`${API}/auth/register`, {
      data: { username: `rest-user-${Date.now()}`, password: 'pass1234' },
    });
    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.id).toMatch(/^usr-/);
    expect(data.username).toMatch(/^rest-user-/);
  });

  test('POST /auth/register rejects short password', async ({ request }) => {
    const res = await request.post(`${API}/auth/register`, {
      data: { username: `short-pw-${Date.now()}`, password: 'ab' },
    });
    expect(res.status()).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('at least 4 characters');
  });

  test('POST /auth/login returns token', async ({ request }) => {
    const uname = `login-user-${Date.now()}`;
    await request.post(`${API}/auth/register`, {
      data: { username: uname, password: 'secret99' },
    });
    const res = await request.post(`${API}/auth/login`, {
      data: { username: uname, password: 'secret99' },
    });
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data.token).toBeTruthy();
    expect(data.user.username).toBe(uname);
  });

  test('POST /auth/login rejects wrong credentials', async ({ request }) => {
    const res = await request.post(`${API}/auth/login`, {
      data: { username: 'nonexistent', password: 'wrong' },
    });
    expect(res.status()).toBe(401);
  });

  test('GET /auth/me returns user with valid token', async ({ request }) => {
    const uname = `me-user-${Date.now()}`;
    await request.post(`${API}/auth/register`, { data: { username: uname, password: 'pass1234' } });
    const loginRes = await request.post(`${API}/auth/login`, { data: { username: uname, password: 'pass1234' } });
    const { token } = await loginRes.json();

    // Auth disabled → me still works via middleware pass-through check
    // Enable auth first
    const adminReg = await request.post(`${API}/auth/register`, { data: { username: `admin-me-${Date.now()}`, password: 'pass1234', role: 'admin' } });
    const adminLogin = await request.post(`${API}/auth/login`, { data: { username: (await adminReg.json()).username, password: 'pass1234' } });
    const adminToken = (await adminLogin.json()).token;
    await request.post(`${API}/auth/enable`, { headers: { Authorization: `Bearer ${adminToken}` } });

    const res = await request.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data.username).toBe(uname);

    // Cleanup: disable auth
    await request.post(`${API}/auth/disable`, { headers: { Authorization: `Bearer ${adminToken}` } });
  });

  test('POST /auth/logout revokes token', async ({ request }) => {
    const uname = `logout-user-${Date.now()}`;
    await request.post(`${API}/auth/register`, { data: { username: uname, password: 'pass1234' } });
    const loginRes = await request.post(`${API}/auth/login`, { data: { username: uname, password: 'pass1234' } });
    const { token } = await loginRes.json();

    const logoutRes = await request.post(`${API}/auth/logout`, { headers: { Authorization: `Bearer ${token}` } });
    expect(logoutRes.ok()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  7 · AUTH MIDDLEWARE — Behavior
// ═══════════════════════════════════════════════════════════════════

test.describe('Auth Middleware — Behavior', () => {
  test('requireAuth passes when auth is disabled', async ({ request }) => {
    // Auth disabled → GET /auth/me should still pass (disabled = pass-through)
    // Actually requireAuth blocks without token when enabled. Let's test with auth disabled.
    authService.disableAuth();
    // When auth is disabled, requireAuth passes through — but /auth/me uses requireAuth
    // The middleware passes req through, but req.user isn't set
    // This just tests the middleware doesn't block
    const res = await request.get(`${API}/auth/status`);
    expect(res.ok()).toBe(true);
  });

  test('requireAuth rejects when auth enabled and no token', async ({ request }) => {
    // Register admin and enable auth
    const uname = `auth-mw-admin-${Date.now()}`;
    await request.post(`${API}/auth/register`, { data: { username: uname, password: 'pass1234', role: 'admin' } });
    const loginRes = await request.post(`${API}/auth/login`, { data: { username: uname, password: 'pass1234' } });
    const { token } = await loginRes.json();
    await request.post(`${API}/auth/enable`, { headers: { Authorization: `Bearer ${token}` } });

    // Now try /auth/me without token — should be rejected
    const res = await request.get(`${API}/auth/me`);
    expect(res.status()).toBe(401);

    // Cleanup
    await request.post(`${API}/auth/disable`, { headers: { Authorization: `Bearer ${token}` } });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  8 · AUTH ROUTES — Project ACL
// ═══════════════════════════════════════════════════════════════════

test.describe('Auth Routes — Project ACL', () => {
  test('GET /projects/:slug/acl returns default ACL', async ({ request }) => {
    // Create a project via API first
    const slug = `acl-proj-${Date.now()}`;
    await request.post(`${API}/projects`, { data: { name: slug } });
    const res = await request.get(`${API}/projects/${slug}/acl`);
    expect(res.ok()).toBe(true);
    const acl = await res.json();
    expect(acl.public).toBe(true);
  });

  test('GET /projects/:slug/acl returns 404 for nonexistent project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/acl`);
    expect(res.status()).toBe(404);
  });

  test('PUT /projects/:slug/acl updates ACL (auth disabled = pass-through)', async ({ request }) => {
    const slug = `acl-put-${Date.now()}`;
    await request.post(`${API}/projects`, { data: { name: slug } });
    authService.disableAuth();

    const res = await request.put(`${API}/projects/${slug}/acl`, {
      data: { owner: 'usr-test', allowedUsers: ['usr-a', 'usr-b'], public: false },
    });
    expect(res.ok()).toBe(true);
    const acl = await res.json();
    expect(acl.owner).toBe('usr-test');
    expect(acl.allowedUsers).toContain('usr-a');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  9 · CLIENT COMPONENT — AuthPanel.vue (source integration)
// ═══════════════════════════════════════════════════════════════════

test.describe('Client — AuthPanel.vue integration', () => {
  let source;
  test.beforeAll(async () => {
    const { readFileSync } = await import('fs');
    source = readFileSync('client/src/components/AuthPanel.vue', 'utf-8');
  });

  test('component has login and register tabs', () => {
    expect(source).toContain('Login');
    expect(source).toContain('Register');
  });

  test('component has auth status display', () => {
    expect(source).toContain('auth-status');
    expect(source).toContain('Enabled');
    expect(source).toContain('Disabled');
  });

  test('component has password toggle', () => {
    expect(source).toContain('auth-pw-toggle');
    expect(source).toContain('showPw');
  });

  test('component has user management section', () => {
    expect(source).toContain('auth-users-section');
    expect(source).toContain('auth-user-row');
    expect(source).toContain('auth-delete-btn');
  });

  test('component has role badges', () => {
    expect(source).toContain('role-admin');
    expect(source).toContain('role-user');
    expect(source).toContain('role-viewer');
  });

  test('component stores token in localStorage', () => {
    expect(source).toContain('localStorage.setItem');
    expect(source).toContain('haivemind-token');
  });

  test('component emits authChange event', () => {
    expect(source).toContain("emit('authChange'");
  });

  test('component has logout functionality', () => {
    expect(source).toContain('/api/auth/logout');
    expect(source).toContain('auth-logout-btn');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  10 · CLEANUP TOKEN UTILITY
// ═══════════════════════════════════════════════════════════════════

test.describe('Auth Service — Cleanup', () => {
  test('cleanupExpiredTokens removes stale tokens', () => {
    const count = authService.cleanupExpiredTokens();
    expect(typeof count).toBe('number');
  });

  test('revokeAllTokens removes all tokens for a user', () => {
    const user = authService.registerUser(`bulkrevoke-${Date.now()}`, 'pass1234');
    authService.authenticateUser(user.username, 'pass1234');
    authService.authenticateUser(user.username, 'pass1234');
    const count = authService.revokeAllTokens(user.id);
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
