// @ts-check
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:3000';

/* ═══════════════════════════════════════════════════════════
   1. OnboardingWizard.vue — component structure
   ═══════════════════════════════════════════════════════════ */
test.describe('OnboardingWizard component', () => {
  const vuePath = path.resolve('client/src/components/OnboardingWizard.vue');

  test('has 3-step wizard flow', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('step === 1');
    expect(src).toContain('step === 2');
    expect(src).toContain('step === 3');
  });

  test('step 1: project name + description inputs', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('v-model="projectName"');
    expect(src).toContain('v-model="projectDesc"');
    expect(src).toContain('Project Name');
  });

  test('step 2: backend selection with copilot and ollama', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain("selectedBackend === 'copilot'");
    expect(src).toContain("selectedBackend === 'ollama'");
    expect(src).toContain('GitHub Copilot');
    expect(src).toContain('Ollama');
  });

  test('step 3: escalation presets — frugal, balanced, quality', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain("id: 'frugal'");
    expect(src).toContain("id: 'balanced'");
    expect(src).toContain("id: 'quality'");
    expect(src).toContain('Frugal');
    expect(src).toContain('Balanced');
    expect(src).toContain('Quality First');
  });

  test('has step indicators with active/done states', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('step-indicators');
    expect(src).toContain('step-dot');
    expect(src).toContain('active');
    expect(src).toContain('done');
  });

  test('has navigation buttons: back, next, skip, launch', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('← Back');
    expect(src).toContain('Next →');
    expect(src).toContain('Skip setup');
    expect(src).toContain('🚀 Launch Project');
  });

  test('emits complete event with config on finish', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain("emit('complete'");
    expect(src).toContain('name:');
    expect(src).toContain('description:');
    expect(src).toContain('backend:');
    expect(src).toContain('escalation:');
  });

  test('emits skip event', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain("$emit('skip')");
  });

  test('validates project name before advancing', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('nameError');
    expect(src).toContain('Project name is required');
  });

  test('uses CSS custom properties from theme', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('var(--bg-card)');
    expect(src).toContain('var(--accent-gold)');
    expect(src).toContain('var(--border-primary)');
    expect(src).toContain('var(--text-primary)');
  });

  test('has visible prop toggle', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain('v-if="visible"');
    expect(src).toContain("visible: { type: Boolean");
  });

  test('defaults backend to copilot and preset to balanced', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain("ref('copilot')");
    expect(src).toContain("ref('balanced')");
  });

  test('presets contain escalation chains', () => {
    const src = fs.readFileSync(vuePath, 'utf8');
    expect(src).toContain("chain: ['T0', 'T0', 'T0', 'T1', 'T2']");
    expect(src).toContain("chain: ['T0', 'T0', 'T1', 'T2', 'T3']");
    expect(src).toContain("chain: ['T1', 'T1', 'T2', 'T3', 'T3']");
  });
});

/* ═══════════════════════════════════════════════════════════
   2. ProjectPicker integration
   ═══════════════════════════════════════════════════════════ */
test.describe('ProjectPicker — onboarding integration', () => {
  const pickerPath = path.resolve('client/src/components/ProjectPicker.vue');

  test('imports OnboardingWizard component', () => {
    const src = fs.readFileSync(pickerPath, 'utf8');
    expect(src).toContain("import OnboardingWizard from './OnboardingWizard.vue'");
  });

  test('renders OnboardingWizard with visible binding', () => {
    const src = fs.readFileSync(pickerPath, 'utf8');
    expect(src).toContain(':visible="showOnboarding"');
  });

  test('handles @complete event from wizard', () => {
    const src = fs.readFileSync(pickerPath, 'utf8');
    expect(src).toContain('@complete="onOnboardingComplete"');
    expect(src).toContain('async function onOnboardingComplete');
  });

  test('handles @skip event from wizard', () => {
    const src = fs.readFileSync(pickerPath, 'utf8');
    expect(src).toContain('@skip="showOnboarding = false"');
  });

  test('shows onboarding when no projects exist', () => {
    const src = fs.readFileSync(pickerPath, 'utf8');
    expect(src).toContain('projects.value.length === 0');
    expect(src).toContain('showOnboarding.value = true');
  });

  test('onOnboardingComplete creates project and applies settings', () => {
    const src = fs.readFileSync(pickerPath, 'utf8');
    expect(src).toContain('createProject(config.name, config.description)');
    expect(src).toContain('/settings');
    expect(src).toContain('escalation: config.escalation');
    expect(src).toContain('defaultBackend: config.backend');
  });

  test('onOnboardingComplete selects project after creation', () => {
    const src = fs.readFileSync(pickerPath, 'utf8');
    expect(src).toContain('selectProject(project)');
  });
});

/* ═══════════════════════════════════════════════════════════
   3. REST API — settings endpoint exists
   ═══════════════════════════════════════════════════════════ */
test.describe('Settings REST API', () => {
  test('PATCH /api/projects/:slug/settings returns 404 for nonexistent project', async ({ request }) => {
    const res = await request.patch(`${BASE}/api/projects/nonexistent-zzz/settings`, {
      data: { escalation: ['T0', 'T1', 'T2'] },
    });
    expect(res.status()).toBe(404);
  });

  test('GET /api/projects/:slug/settings returns 404 for nonexistent project', async ({ request }) => {
    const res = await request.get(`${BASE}/api/projects/nonexistent-zzz/settings`);
    expect(res.status()).toBe(404);
  });
});
