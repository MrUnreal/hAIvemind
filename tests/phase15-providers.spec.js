// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
function read(f) { return readFileSync(path.join(ROOT, f), 'utf8'); }

/* ════════════════════════════════════════════
   Phase 15 — Multi-Provider & Backend Expansion
   ════════════════════════════════════════════ */

test.describe('Anthropic Backend', () => {
  test('anthropic.js exports a class with name and spawn', () => {
    const src = read('server/backends/anthropic.js');
    expect(src).toContain("get name() { return 'anthropic'; }");
    expect(src).toContain('spawn(prompt, workDir, opts');
    expect(src).toContain('api.anthropic.com');
    expect(src).toContain('ANTHROPIC_API_KEY');
  });

  test('anthropic backend returns error process when no API key', async () => {
    // Save and clear key
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const mod = await import('../server/backends/anthropic.js');
      const backend = new mod.default();
      const { process: p, cliCommand } = backend.spawn('test', '/tmp');
      expect(cliCommand).toContain('error');
    } finally {
      if (saved) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

test.describe('OpenAI Backend', () => {
  test('openai.js exports a class with name and spawn', () => {
    const src = read('server/backends/openai.js');
    expect(src).toContain("get name() { return 'openai'; }");
    expect(src).toContain('spawn(prompt, workDir, opts');
    expect(src).toContain('api.openai.com');
    expect(src).toContain('OPENAI_API_KEY');
  });

  test('openai backend returns error process when no API key', async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const mod = await import('../server/backends/openai.js');
      const backend = new mod.default();
      const { process: p, cliCommand } = backend.spawn('test', '/tmp');
      expect(cliCommand).toContain('error');
    } finally {
      if (saved) process.env.OPENAI_API_KEY = saved;
    }
  });
});

test.describe('Backend Registry — Multi-Provider', () => {
  test('registry includes anthropic and openai', () => {
    const src = read('server/backends/index.js');
    expect(src).toContain("import AnthropicBackend from './anthropic.js'");
    expect(src).toContain("import OpenAIBackend from './openai.js'");
    expect(src).toContain("['anthropic', AnthropicBackend]");
    expect(src).toContain("['openai', OpenAIBackend]");
  });

  test('listBackends returns all 4 providers', async () => {
    const { listBackends } = await import('../server/backends/index.js');
    const backends = listBackends();
    expect(backends).toContain('copilot');
    expect(backends).toContain('ollama');
    expect(backends).toContain('anthropic');
    expect(backends).toContain('openai');
    expect(backends.length).toBe(4);
  });
});

test.describe('Provider Failover', () => {
  test('recordSuccess and recordFailure track health', async () => {
    const { recordSuccess, recordFailure, getProviderHealthStatus, resetHealth } = await import('../server/services/providerFailover.js');
    resetHealth();
    recordSuccess('copilot');
    recordSuccess('copilot');
    recordFailure('openai');
    const status = getProviderHealthStatus();
    const copilot = status.find(s => s.name === 'copilot');
    const openai = status.find(s => s.name === 'openai');
    expect(copilot.failures).toBe(0);
    expect(copilot.totalCalls).toBe(2);
    expect(openai.failures).toBe(1);
  });

  test('isProviderHealthy returns false after many failures', async () => {
    const { recordFailure, isProviderHealthy, resetHealth } = await import('../server/services/providerFailover.js');
    resetHealth();
    for (let i = 0; i < 5; i++) recordFailure('test-provider');
    expect(isProviderHealthy('test-provider')).toBe(false);
  });

  test('getBestProviderForTier returns a provider', async () => {
    const { getBestProviderForTier, resetHealth } = await import('../server/services/providerFailover.js');
    resetHealth();
    const result = getBestProviderForTier('T1');
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('provider');
    expect(result).toHaveProperty('model');
    expect(result).toHaveProperty('multiplier');
  });

  test('TIER_PROVIDER_MAP covers all tiers', () => {
    const src = read('server/services/providerFailover.js');
    expect(src).toContain('T0:');
    expect(src).toContain('T1:');
    expect(src).toContain('T2:');
    expect(src).toContain('T3:');
  });
});
