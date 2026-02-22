// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const API = 'http://localhost:3000';

// ── Phase 8.3: Smart Retry Policies Tests ──────────────────────────────

// ── Retry Policy Service Unit Tests ──

test.describe('Smart Retry — buildRetryPolicy()', () => {
  /** @type {import('../server/services/retryPolicy.js')} */
  let mod;

  test.beforeAll(async () => {
    mod = await import('../server/services/retryPolicy.js');
  });

  test('returns defaults when no settings provided', () => {
    const policy = mod.buildRetryPolicy();
    expect(policy.maxRetries).toBe(5);
    expect(policy.backoffStrategy).toBe('none');
    expect(policy.backoffBaseMs).toBe(2000);
    expect(policy.skipAfterConsecutiveFailures).toBe(0);
    expect(policy.escalation).toEqual(['T0', 'T0', 'T1', 'T2', 'T3']);
  });

  test('overrides maxRetries from settings', () => {
    const policy = mod.buildRetryPolicy({ maxRetriesTotal: 3 });
    expect(policy.maxRetries).toBe(3);
  });

  test('overrides backoff strategy', () => {
    const policy = mod.buildRetryPolicy({ backoffStrategy: 'exponential', backoffBaseMs: 500 });
    expect(policy.backoffStrategy).toBe('exponential');
    expect(policy.backoffBaseMs).toBe(500);
  });

  test('overrides skip-after-N', () => {
    const policy = mod.buildRetryPolicy({ skipAfterConsecutiveFailures: 3 });
    expect(policy.skipAfterConsecutiveFailures).toBe(3);
  });

  test('overrides escalation chain', () => {
    const policy = mod.buildRetryPolicy({ escalation: ['T0', 'T2', 'T3'] });
    expect(policy.escalation).toEqual(['T0', 'T2', 'T3']);
  });
});

test.describe('Smart Retry — getBackoffDelay()', () => {
  /** @type {import('../server/services/retryPolicy.js')} */
  let mod;

  test.beforeAll(async () => {
    mod = await import('../server/services/retryPolicy.js');
  });

  test('none strategy returns 0', () => {
    const policy = mod.buildRetryPolicy({ backoffStrategy: 'none' });
    expect(mod.getBackoffDelay(policy, 0)).toBe(0);
    expect(mod.getBackoffDelay(policy, 5)).toBe(0);
  });

  test('linear strategy scales with attempt', () => {
    const policy = mod.buildRetryPolicy({ backoffStrategy: 'linear', backoffBaseMs: 1000 });
    expect(mod.getBackoffDelay(policy, 0)).toBe(0);
    expect(mod.getBackoffDelay(policy, 1)).toBe(1000);
    expect(mod.getBackoffDelay(policy, 3)).toBe(3000);
  });

  test('exponential strategy doubles each attempt', () => {
    const policy = mod.buildRetryPolicy({ backoffStrategy: 'exponential', backoffBaseMs: 1000 });
    expect(mod.getBackoffDelay(policy, 0)).toBe(1000);
    expect(mod.getBackoffDelay(policy, 1)).toBe(2000);
    expect(mod.getBackoffDelay(policy, 2)).toBe(4000);
  });

  test('exponential is capped at 30s', () => {
    const policy = mod.buildRetryPolicy({ backoffStrategy: 'exponential', backoffBaseMs: 1000 });
    expect(mod.getBackoffDelay(policy, 20)).toBe(30000);
  });

  test('fixed strategy returns constant delay', () => {
    const policy = mod.buildRetryPolicy({ backoffStrategy: 'fixed', backoffBaseMs: 5000 });
    expect(mod.getBackoffDelay(policy, 0)).toBe(5000);
    expect(mod.getBackoffDelay(policy, 3)).toBe(5000);
  });
});

test.describe('Smart Retry — shouldRetry()', () => {
  /** @type {import('../server/services/retryPolicy.js')} */
  let mod;

  test.beforeAll(async () => {
    mod = await import('../server/services/retryPolicy.js');
  });

  test('allows retry when under max', () => {
    const policy = mod.buildRetryPolicy({ maxRetriesTotal: 3 });
    const result = mod.shouldRetry(policy, 1);
    expect(result.shouldRetry).toBe(true);
    expect(result.reason).toContain('Retry');
  });

  test('denies retry when at max', () => {
    const policy = mod.buildRetryPolicy({ maxRetriesTotal: 3 });
    const result = mod.shouldRetry(policy, 3);
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toContain('Max retries');
  });

  test('denies retry after consecutive failure threshold', () => {
    const policy = mod.buildRetryPolicy({ skipAfterConsecutiveFailures: 2 });
    const result = mod.shouldRetry(policy, 1, 2);
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toContain('consecutive failures');
  });

  test('allows retry when consecutive failures below threshold', () => {
    const policy = mod.buildRetryPolicy({ skipAfterConsecutiveFailures: 3 });
    const result = mod.shouldRetry(policy, 1, 2);
    expect(result.shouldRetry).toBe(true);
  });

  test('includes delay for backoff strategies', () => {
    const policy = mod.buildRetryPolicy({ backoffStrategy: 'linear', backoffBaseMs: 1000 });
    const result = mod.shouldRetry(policy, 2);
    expect(result.shouldRetry).toBe(true);
    expect(result.delayMs).toBe(2000);
  });

  test('initial attempt reason is distinct', () => {
    const policy = mod.buildRetryPolicy();
    const result = mod.shouldRetry(policy, 0);
    expect(result.shouldRetry).toBe(true);
    expect(result.reason).toBe('Initial attempt');
  });
});

test.describe('Smart Retry — makeRetryRecord()', () => {
  /** @type {import('../server/services/retryPolicy.js')} */
  let mod;

  test.beforeAll(async () => {
    mod = await import('../server/services/retryPolicy.js');
  });

  test('creates a retry record with all fields', () => {
    const record = mod.makeRetryRecord('task-1', 2, 'Timeout', 'Process timed out');
    expect(record.taskId).toBe('task-1');
    expect(record.attempt).toBe(2);
    expect(record.reason).toBe('Timeout');
    expect(record.error).toBe('Process timed out');
    expect(record.timestamp).toBeGreaterThan(0);
  });

  test('handles missing error gracefully', () => {
    const record = mod.makeRetryRecord('task-2', 0, 'Initial');
    expect(record.error).toBeNull();
  });
});

test.describe('Smart Retry — validateRetrySettings()', () => {
  /** @type {import('../server/services/retryPolicy.js')} */
  let mod;

  test.beforeAll(async () => {
    mod = await import('../server/services/retryPolicy.js');
  });

  test('validates correct settings', () => {
    const result = mod.validateRetrySettings({
      maxRetriesTotal: 3,
      backoffStrategy: 'linear',
      backoffBaseMs: 2000,
      skipAfterConsecutiveFailures: 2,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.policy.maxRetriesTotal).toBe(3);
  });

  test('rejects invalid maxRetriesTotal', () => {
    const result = mod.validateRetrySettings({ maxRetriesTotal: -1 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('maxRetriesTotal');
  });

  test('rejects invalid backoff strategy', () => {
    const result = mod.validateRetrySettings({ backoffStrategy: 'turbo' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('backoffStrategy');
  });

  test('rejects invalid escalation', () => {
    const result = mod.validateRetrySettings({ escalation: ['T0', 'T9'] });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid tiers');
  });

  test('rejects empty escalation array', () => {
    const result = mod.validateRetrySettings({ escalation: [] });
    expect(result.valid).toBe(false);
  });

  test('validates correct escalation', () => {
    const result = mod.validateRetrySettings({ escalation: ['T0', 'T1', 'T3'] });
    expect(result.valid).toBe(true);
    expect(result.policy.escalation).toEqual(['T0', 'T1', 'T3']);
  });

  test('ignores unknown fields', () => {
    const result = mod.validateRetrySettings({ randomField: true });
    expect(result.valid).toBe(true);
    expect(result.policy).toEqual({});
  });
});

// ── REST API Tests ──

test.describe('Smart Retry — REST API', () => {
  test('GET retry-policy returns defaults for any project', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent/retry-policy`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('maxRetries');
    expect(data).toHaveProperty('backoffStrategy');
    expect(data).toHaveProperty('escalation');
  });

  test('PUT retry-policy validates input', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent/retry-policy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backoffStrategy: 'invalid' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('backoffStrategy');
  });

  test('PUT retry-policy rejects out-of-range maxRetries', async () => {
    const res = await fetch(`${API}/api/projects/nonexistent/retry-policy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxRetriesTotal: 100 }),
    });
    expect(res.status).toBe(400);
  });
});

// ── Integration ──

test.describe('Smart Retry — Integration', () => {
  test('retryPolicy.js service module exists', () => {
    expect(existsSync(path.join(ROOT, 'server', 'services', 'retryPolicy.js'))).toBe(true);
  });

  test('retryPolicy.js exports all functions', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'services', 'retryPolicy.js'), 'utf-8');
    expect(src).toContain('export function buildRetryPolicy');
    expect(src).toContain('export function getBackoffDelay');
    expect(src).toContain('export function shouldRetry');
    expect(src).toContain('export function makeRetryRecord');
    expect(src).toContain('export function validateRetrySettings');
  });

  test('projects.js imports retryPolicy', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'routes', 'projects.js'), 'utf-8');
    expect(src).toContain('retryPolicy');
    expect(src).toContain('retry-policy');
  });

  test('sessions.js passes retry settings in overrides', () => {
    const src = readFileSync(path.join(ROOT, 'server', 'services', 'sessions.js'), 'utf-8');
    expect(src).toContain('backoffStrategy');
    expect(src).toContain('skipAfterConsecutiveFailures');
  });
});
