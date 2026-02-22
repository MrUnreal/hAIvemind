/**
 * Phase 10.2 — Smart Prompt Suggestions Tests
 *
 * Tests for the prompt suggestions service, REST endpoints,
 * prompt history, and client component integration.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, existsSync, rmSync, readFileSync } from 'fs';

const API = 'http://localhost:3000/api';
const TEST_DIR = '.haivemind-workspace';

let WorkspaceManager, refs, suggestions;

test.beforeAll(async () => {
  const wsModule = await import('../server/workspace.js');
  WorkspaceManager = wsModule.default;
  const stateModule = await import('../server/state.js');
  refs = stateModule.refs;
  suggestions = await import('../server/services/promptSuggestions.js');

  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  const wm = new WorkspaceManager(TEST_DIR);
  refs.workspace = wm;
  try { wm.createProject('suggest-proj'); } catch { /* exists */ }
});

test.afterAll(async () => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  1 · SUGGESTIONS SERVICE — Core
// ═══════════════════════════════════════════════════════════════════

test.describe('Suggestions Service — Core', () => {
  test('getSuggestions returns suggestions with sources', () => {
    const result = suggestions.getSuggestions('suggest-proj');
    expect(result.suggestions).toBeInstanceOf(Array);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.sources).toBeTruthy();
    expect(typeof result.sources.builtin).toBe('number');
    expect(typeof result.sources.sessions).toBe('number');
    expect(typeof result.sources.memory).toBe('number');
  });

  test('each suggestion has required fields', () => {
    const { suggestions: items } = suggestions.getSuggestions('suggest-proj');
    for (const s of items) {
      expect(s.text).toBeTruthy();
      expect(s.category).toBeTruthy();
      expect(s.source).toBeTruthy();
      expect(s.tags).toBeInstanceOf(Array);
    }
  });

  test('getSuggestions filters by category', () => {
    const { suggestions: items } = suggestions.getSuggestions('suggest-proj', { category: 'fix' });
    for (const s of items) expect(s.category).toBe('fix');
  });

  test('getSuggestions filters by query', () => {
    const { suggestions: items } = suggestions.getSuggestions('suggest-proj', { query: 'test' });
    expect(items.length).toBeGreaterThanOrEqual(1);
    for (const s of items) {
      const txt = `${s.text} ${s.tags.join(' ')} ${s.category}`.toLowerCase();
      expect(txt).toContain('test');
    }
  });

  test('getSuggestions respects limit', () => {
    const { suggestions: items } = suggestions.getSuggestions('suggest-proj', { limit: 3 });
    expect(items.length).toBeLessThanOrEqual(3);
  });

  test('getSuggestions deduplicates', () => {
    const { suggestions: items } = suggestions.getSuggestions('suggest-proj');
    const texts = items.map(s => s.text.toLowerCase().replace(/\s+/g, ' ').trim());
    const unique = new Set(texts);
    expect(texts.length).toBe(unique.size);
  });

  test('getCategories returns array of categories', () => {
    const cats = suggestions.getCategories();
    expect(cats).toBeInstanceOf(Array);
    expect(cats.length).toBeGreaterThanOrEqual(5);
    expect(cats).toContain('fix');
    expect(cats).toContain('test');
    expect(cats).toContain('refactor');
  });

  test('CATEGORIES has 10 entries', () => {
    expect(suggestions.CATEGORIES).toEqual([
      'fix', 'feature', 'refactor', 'test', 'docs',
      'performance', 'security', 'devops', 'maintenance', 'observability',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  2 · SUGGESTIONS SERVICE — Prompt History
// ═══════════════════════════════════════════════════════════════════

test.describe('Suggestions Service — Prompt History', () => {
  test('recordPrompt stores entry', () => {
    const entry = suggestions.recordPrompt('suggest-proj', 'Build a REST API', 'sess-1');
    expect(entry.text).toBe('Build a REST API');
    expect(entry.sessionId).toBe('sess-1');
    expect(entry.timestamp).toBeTruthy();
  });

  test('getPromptHistory returns recorded prompts', () => {
    const history = suggestions.getPromptHistory('suggest-proj');
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].text).toBe('Build a REST API');
  });

  test('getPromptHistory respects limit', () => {
    suggestions.recordPrompt('suggest-proj', 'Add tests');
    suggestions.recordPrompt('suggest-proj', 'Fix bugs');
    const history = suggestions.getPromptHistory('suggest-proj', 1);
    expect(history.length).toBe(1);
  });

  test('recordPrompt caps text at 500 chars', () => {
    const long = 'x'.repeat(600);
    const entry = suggestions.recordPrompt('suggest-proj', long);
    expect(entry.text.length).toBe(500);
  });

  test('clearHistory removes all prompts', () => {
    suggestions.clearHistory('suggest-proj');
    const history = suggestions.getPromptHistory('suggest-proj');
    expect(history.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  3 · REST ENDPOINTS — Suggestions
// ═══════════════════════════════════════════════════════════════════

test.describe('REST — Suggestions Endpoints', () => {
  const PROJ = `suggest-route-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    await request.post(`${API}/projects`, { data: { name: PROJ } });
  });

  test('GET /suggestions returns suggestion list', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/suggestions`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.suggestions).toBeInstanceOf(Array);
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(body.sources).toBeTruthy();
  });

  test('GET /suggestions?category=fix filters by category', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/suggestions?category=fix`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    for (const s of body.suggestions) expect(s.category).toBe('fix');
  });

  test('GET /suggestions?query=test filters by query', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/suggestions?query=test`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.suggestions.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /suggestions?limit=3 respects limit', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/suggestions?limit=3`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.suggestions.length).toBeLessThanOrEqual(3);
  });

  test('GET /suggestions/categories returns categories', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/suggestions/categories`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toBeInstanceOf(Array);
    expect(body).toContain('fix');
  });

  test('POST /suggestions/history records prompt', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/suggestions/history`, {
      data: { text: 'Add authentication', sessionId: 'sess-99' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.text).toBe('Add authentication');
  });

  test('POST /suggestions/history returns 400 without text', async ({ request }) => {
    const res = await request.post(`${API}/projects/${PROJ}/suggestions/history`, {
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('GET /suggestions/history returns history', async ({ request }) => {
    const res = await request.get(`${API}/projects/${PROJ}/suggestions/history`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toBeInstanceOf(Array);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  test('DELETE /suggestions/history clears history', async ({ request }) => {
    const res = await request.delete(`${API}/projects/${PROJ}/suggestions/history`);
    expect(res.ok()).toBe(true);
    const after = await request.get(`${API}/projects/${PROJ}/suggestions/history`);
    const body = await after.json();
    expect(body.length).toBe(0);
  });

  test('GET /suggestions returns 404 for nonexistent project', async ({ request }) => {
    const res = await request.get(`${API}/projects/nonexistent-zzz/suggestions`);
    expect(res.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  4 · CLIENT INTEGRATION — SuggestionsPanel.vue
// ═══════════════════════════════════════════════════════════════════

test.describe('Client Integration — SuggestionsPanel.vue', () => {
  let src;

  test.beforeAll(async () => {
    src = readFileSync('client/src/components/SuggestionsPanel.vue', 'utf-8');
  });

  test('component has suggestions-panel class', () => {
    expect(src).toContain('suggestions-panel');
  });

  test('component supports category filter', () => {
    expect(src).toContain('filterCategory');
    expect(src).toContain('suggestions-select');
  });

  test('component supports search', () => {
    expect(src).toContain('searchQuery');
    expect(src).toContain('suggestions-search');
  });

  test('component shows source chips', () => {
    expect(src).toContain('source-chip');
    expect(src).toContain('builtin');
    expect(src).toContain('sessions');
    expect(src).toContain('memory');
  });

  test('component shows suggestion cards', () => {
    expect(src).toContain('suggestion-card');
    expect(src).toContain('suggestion-text');
    expect(src).toContain('suggestion-category');
  });

  test('component shows prompt history', () => {
    expect(src).toContain('history-card');
    expect(src).toContain('history-text');
    expect(src).toContain('clearPromptHistory');
  });

  test('component emits usePrompt', () => {
    expect(src).toContain('usePrompt');
    expect(src).toContain('useSuggestion');
  });

  test('component has scoped styles', () => {
    expect(src).toContain('<style scoped>');
    expect(src).toContain('suggestion-tag');
  });
});
