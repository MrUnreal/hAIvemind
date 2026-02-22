/**
 * server/services/auth.js — Multi-User Authentication Service
 *
 * Optional auth layer: user registration, token-based authentication,
 * project-level access control. When disabled, all requests pass through.
 */

import { randomBytes, createHash } from 'crypto';
import { refs } from '../state.js';

// ─── In-memory stores ────────────────────────────────────────────────
const tokens = new Map();        // token → { userId, username, role, expiresAt }
const TOKEN_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ─── Helpers ─────────────────────────────────────────────────────────
function hashPassword(password, salt) {
  return createHash('sha256').update(password + salt).digest('hex');
}

function generateToken() {
  return randomBytes(32).toString('hex');
}

function getAuthData() {
  const settings = refs.workspace?.getGlobalSettings?.() || {};
  return settings.auth || { enabled: false, users: [] };
}

function saveAuthData(data) {
  refs.workspace?.updateGlobalSettings?.({ auth: data });
}

// ─── Auth Configuration ─────────────────────────────────────────────
export function isAuthEnabled() {
  return getAuthData().enabled === true;
}

export function enableAuth() {
  const data = getAuthData();
  data.enabled = true;
  if (!data.users) data.users = [];
  saveAuthData(data);
  return { enabled: true };
}

export function disableAuth() {
  const data = getAuthData();
  data.enabled = false;
  saveAuthData(data);
  tokens.clear();
  return { enabled: false };
}

// ─── User Management ────────────────────────────────────────────────
export function getUsers() {
  const data = getAuthData();
  return (data.users || []).map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    createdAt: u.createdAt,
  }));
}

export function registerUser(username, password, role = 'user') {
  const data = getAuthData();
  if (!data.users) data.users = [];

  if (!username || typeof username !== 'string' || username.length < 2) {
    throw new Error('Username must be at least 2 characters');
  }
  if (!password || typeof password !== 'string' || password.length < 4) {
    throw new Error('Password must be at least 4 characters');
  }

  const exists = data.users.find(u => u.username === username);
  if (exists) throw new Error('Username already taken');

  const salt = randomBytes(16).toString('hex');
  const user = {
    id: `usr-${Date.now()}-${randomBytes(4).toString('hex')}`,
    username,
    passwordHash: hashPassword(password, salt),
    salt,
    role: ['admin', 'user', 'viewer'].includes(role) ? role : 'user',
    createdAt: new Date().toISOString(),
  };

  data.users.push(user);
  saveAuthData(data);

  return { id: user.id, username: user.username, role: user.role };
}

export function removeUser(userId) {
  const data = getAuthData();
  if (!data.users) return false;

  const idx = data.users.findIndex(u => u.id === userId);
  if (idx === -1) return false;

  data.users.splice(idx, 1);
  saveAuthData(data);

  // Revoke all tokens for this user
  for (const [tok, info] of tokens) {
    if (info.userId === userId) tokens.delete(tok);
  }
  return true;
}

export function updateUserRole(userId, newRole) {
  if (!['admin', 'user', 'viewer'].includes(newRole)) {
    throw new Error('Invalid role — must be admin, user, or viewer');
  }
  const data = getAuthData();
  const user = (data.users || []).find(u => u.id === userId);
  if (!user) throw new Error('User not found');
  user.role = newRole;
  saveAuthData(data);
  return { id: user.id, username: user.username, role: user.role };
}

// ─── Authentication ─────────────────────────────────────────────────
export function authenticateUser(username, password) {
  const data = getAuthData();
  const user = (data.users || []).find(u => u.username === username);
  if (!user) throw new Error('Invalid credentials');

  const hash = hashPassword(password, user.salt);
  if (hash !== user.passwordHash) throw new Error('Invalid credentials');

  const token = generateToken();
  tokens.set(token, {
    userId: user.id,
    username: user.username,
    role: user.role,
    expiresAt: Date.now() + TOKEN_TTL,
  });

  return {
    token,
    user: { id: user.id, username: user.username, role: user.role },
    expiresAt: new Date(Date.now() + TOKEN_TTL).toISOString(),
  };
}

export function verifyToken(token) {
  if (!token) return null;
  const info = tokens.get(token);
  if (!info) return null;
  if (Date.now() > info.expiresAt) {
    tokens.delete(token);
    return null;
  }
  return { userId: info.userId, username: info.username, role: info.role };
}

export function revokeToken(token) {
  return tokens.delete(token);
}

export function revokeAllTokens(userId) {
  let count = 0;
  for (const [tok, info] of tokens) {
    if (info.userId === userId) { tokens.delete(tok); count++; }
  }
  return count;
}

// ─── Project Access Control ─────────────────────────────────────────
export function getProjectAcl(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug);
  return settings?.acl || { owner: null, allowedUsers: [], public: true };
}

export function setProjectAcl(slug, acl) {
  refs.workspace?.updateProjectSettings?.(slug, { acl });
  return acl;
}

export function checkProjectAccess(slug, user) {
  if (!isAuthEnabled()) return true;
  if (!user) return false;
  if (user.role === 'admin') return true;

  const acl = getProjectAcl(slug);
  if (acl.public) return true;
  if (acl.owner === user.userId) return true;
  if (acl.allowedUsers?.includes(user.userId)) return true;
  return false;
}

// ─── Cleanup ─────────────────────────────────────────────────────────
export function cleanupExpiredTokens() {
  const now = Date.now();
  let count = 0;
  for (const [tok, info] of tokens) {
    if (now > info.expiresAt) { tokens.delete(tok); count++; }
  }
  return count;
}
