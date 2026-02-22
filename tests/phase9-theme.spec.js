// @ts-check
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:3000';

/* ═══════════════════════════════════════════════════════════
   1. useTheme composable — unit tests
   ═══════════════════════════════════════════════════════════ */
test.describe('useTheme composable', () => {
  const composablePath = path.resolve('client/src/composables/useTheme.js');

  test('exports useTheme function', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain('export function useTheme');
  });

  test('has reactive theme ref', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain("ref('dark')");
  });

  test('provides toggleTheme function', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain('function toggleTheme');
    expect(src).toContain("theme.value === 'dark'");
  });

  test('provides setTheme function', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain('function setTheme');
  });

  test('provides isDark reactive ref', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain('isDark');
    expect(src).toContain("theme.value === 'dark'");
  });

  test('persists to localStorage', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain('localStorage');
    expect(src).toContain('haivemind-theme');
  });

  test('detects OS preference via matchMedia', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain('matchMedia');
    expect(src).toContain('prefers-color-scheme');
  });

  test('applies theme class to document root', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain('document.documentElement');
    expect(src).toContain('dark-theme');
    expect(src).toContain('light-theme');
  });

  test('returns all expected members', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain('return {');
    expect(src).toContain('theme');
    expect(src).toContain('isDark');
    expect(src).toContain('toggleTheme');
    expect(src).toContain('setTheme');
  });

  test('singleton pattern — prevents double init', () => {
    const src = fs.readFileSync(composablePath, 'utf8');
    expect(src).toContain('initialized');
  });
});

/* ═══════════════════════════════════════════════════════════
   2. Theme CSS — custom properties
   ═══════════════════════════════════════════════════════════ */
test.describe('theme.css — custom properties', () => {
  const cssPath = path.resolve('client/src/theme.css');

  test('defines dark theme as default on :root', () => {
    const src = fs.readFileSync(cssPath, 'utf8');
    expect(src).toContain(':root');
    expect(src).toContain('.dark-theme');
  });

  test('defines light theme class', () => {
    const src = fs.readFileSync(cssPath, 'utf8');
    expect(src).toContain('.light-theme');
  });

  test('has background custom properties', () => {
    const src = fs.readFileSync(cssPath, 'utf8');
    expect(src).toContain('--bg-primary');
    expect(src).toContain('--bg-secondary');
    expect(src).toContain('--bg-card');
    expect(src).toContain('--bg-input');
    expect(src).toContain('--bg-hover');
  });

  test('has text custom properties', () => {
    const src = fs.readFileSync(cssPath, 'utf8');
    expect(src).toContain('--text-primary');
    expect(src).toContain('--text-secondary');
    expect(src).toContain('--text-muted');
  });

  test('has border custom properties', () => {
    const src = fs.readFileSync(cssPath, 'utf8');
    expect(src).toContain('--border-primary');
    expect(src).toContain('--border-secondary');
    expect(src).toContain('--border-input');
  });

  test('has accent color custom properties', () => {
    const src = fs.readFileSync(cssPath, 'utf8');
    expect(src).toContain('--accent-gold');
    expect(src).toContain('--accent-blue');
    expect(src).toContain('--accent-green');
    expect(src).toContain('--accent-red');
  });

  test('has component-specific custom properties', () => {
    const src = fs.readFileSync(cssPath, 'utf8');
    expect(src).toContain('--header-bg');
    expect(src).toContain('--header-border');
    expect(src).toContain('--panel-bg');
    expect(src).toContain('--btn-bg');
    expect(src).toContain('--badge-bg');
  });

  test('has shadow custom properties', () => {
    const src = fs.readFileSync(cssPath, 'utf8');
    expect(src).toContain('--shadow-sm');
    expect(src).toContain('--shadow-md');
    expect(src).toContain('--shadow-lg');
  });

  test('dark and light themes have different background values', () => {
    const src = fs.readFileSync(cssPath, 'utf8');
    // Dark uses #0d0d14, Light uses #f5f5f7
    expect(src).toContain('#0d0d14');
    expect(src).toContain('#f5f5f7');
  });

  test('applies body styles using variables', () => {
    const src = fs.readFileSync(cssPath, 'utf8');
    expect(src).toContain('body');
    expect(src).toContain('var(--bg-primary)');
    expect(src).toContain('var(--text-primary)');
  });

  test('includes scrollbar theming', () => {
    const src = fs.readFileSync(cssPath, 'utf8');
    expect(src).toContain('::-webkit-scrollbar');
    expect(src).toContain('var(--scrollbar-thumb)');
  });

  test('includes transition for smooth theme switching', () => {
    const src = fs.readFileSync(cssPath, 'utf8');
    expect(src).toContain('transition');
    expect(src).toContain('background-color 0.3s');
  });
});

/* ═══════════════════════════════════════════════════════════
   3. App.vue integration — theme toggle button & CSS vars
   ═══════════════════════════════════════════════════════════ */
test.describe('App.vue — theme integration', () => {
  const appPath = path.resolve('client/src/App.vue');

  test('imports useTheme composable', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain("import { useTheme } from './composables/useTheme.js'");
  });

  test('destructures isDark and toggleTheme', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain('isDark');
    expect(src).toContain('toggleTheme');
  });

  test('has theme toggle button in template', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain('theme-toggle-btn');
    expect(src).toContain('@click="toggleTheme"');
  });

  test('toggle button shows sun/moon emoji', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain('☀️');
    expect(src).toContain('🌙');
  });

  test('uses CSS variables for header styles', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain('var(--header-bg)');
    expect(src).toContain('var(--header-border)');
  });

  test('uses CSS variables for badge styles', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain('var(--badge-bg)');
    expect(src).toContain('var(--badge-border)');
  });

  test('uses CSS variables for button styles', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain('var(--btn-bg)');
    expect(src).toContain('var(--btn-border)');
    expect(src).toContain('var(--btn-text)');
  });

  test('uses CSS variables for text colors', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain('var(--text-primary)');
    expect(src).toContain('var(--text-secondary)');
    expect(src).toContain('var(--text-muted)');
  });

  test('uses CSS variables for accent colors', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain('var(--accent-gold)');
    expect(src).toContain('var(--accent-gold-dim)');
  });

  test('uses CSS variables for shadows', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain('var(--shadow-lg)');
  });

  test('uses CSS variables for overlay/error card', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain('var(--bg-overlay)');
    expect(src).toContain('var(--bg-primary)');
    expect(src).toContain('var(--border-primary)');
  });

  test('has theme-toggle-btn CSS class', () => {
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain('.theme-toggle-btn');
    expect(src).toContain('var(--btn-hover-bg)');
  });
});

/* ═══════════════════════════════════════════════════════════
   4. main.js — theme.css import
   ═══════════════════════════════════════════════════════════ */
test.describe('main.js — theme import', () => {
  const mainPath = path.resolve('client/src/main.js');

  test('imports theme.css', () => {
    const src = fs.readFileSync(mainPath, 'utf8');
    expect(src).toContain("import './theme.css'");
  });
});
