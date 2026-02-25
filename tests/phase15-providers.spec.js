// @ts-check
import { test, expect } from '@playwright/test';

/* ════════════════════════════════════════════
   Phase 15 — Multi-Provider & Backend Expansion
   ════════════════════════════════════════════ */

test.describe('Anthropic Backend', () => {
  test('returns error process when no API key', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const mod = await import('../server/backends/anthropic.js');
      const backend = new mod.default();
      expect(backend.name).toBe('anthropic');
      const { cliCommand } = backend.spawn('test', '/tmp');
      expect(cliCommand).toContain('error');
    } finally {
      if (saved) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

test.describe('OpenAI Backend', () => {
  test('returns error process when no API key', async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const mod = await import('../server/backends/openai.js');
      const backend = new mod.default();
      expect(backend.name).toBe('openai');
      const { cliCommand } = backend.spawn('test', '/tmp');
      expect(cliCommand).toContain('error');
    } finally {
      if (saved) process.env.OPENAI_API_KEY = saved;
    }
  });
});

test.describe('Backend Registry', () => {
  test('listBackends returns all 4 providers', async () => {
    const { listBackends } = await import('../server/backends/index.js');
    const backends = listBackends();
    expect(backends).toEqual(expect.arrayContaining(['copilot', 'ollama', 'anthropic', 'openai']));
    expect(backends.length).toBe(4);
  });
});

test.describe('Provider Failover', () => {
  test('tracks health and blocks unhealthy providers', async () => {
    const { recordSuccess, recordFailure, isProviderHealthy, getProviderHealthStatus, resetHealth } = await import('../server/services/providerFailover.js');
    resetHealth();

    // Track calls
    recordSuccess('copilot');
    recordSuccess('copilot');
    recordFailure('openai');
    const status = getProviderHealthStatus();
    const copilot = status.find(s => s.name === 'copilot');
    const openai = status.find(s => s.name === 'openai');
    expect(copilot.failures).toBe(0);
    expect(copilot.totalCalls).toBe(2);
    expect(openai.failures).toBe(1);

    // Many failures → unhealthy
    resetHealth();
    for (let i = 0; i < 5; i++) recordFailure('test-provider');
    expect(isProviderHealthy('test-provider')).toBe(false);
  });

  test('getBestProviderForTier covers all tiers', async () => {
    const { getBestProviderForTier, TIER_PROVIDER_MAP, resetHealth } = await import('../server/services/providerFailover.js');
    resetHealth();

    // Map has all tiers
    for (const tier of ['T0', 'T1', 'T2', 'T3']) {
      expect(TIER_PROVIDER_MAP).toHaveProperty(tier);
    }

    // Returns a valid provider
    const result = getBestProviderForTier('T1');
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('provider');
    expect(result).toHaveProperty('model');
    expect(result).toHaveProperty('multiplier');
  });
});
