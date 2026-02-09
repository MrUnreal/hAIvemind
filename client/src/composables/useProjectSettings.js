import { ref, reactive } from 'vue';

const API_BASE = '/api';

/**
 * Reactive project settings, skills, and reflections state.
 * Phase 2: Intelligence & UX
 */

/** @type {import('vue').Ref<object|null>} - Current project skills */
export const projectSkills = ref(null);

/** @type {import('vue').Ref<object|null>} - Current project settings */
export const projectSettings = ref(null);

/** @type {import('vue').Ref<object[]>} - Reflections for current project */
export const projectReflections = ref([]);

/** @type {import('vue').Ref<object|null>} - Latest session reflection */
export const latestReflection = ref(null);

/** @type {import('vue').Ref<boolean>} */
export const settingsLoading = ref(false);

// ── Skills ──

export async function fetchSkills(slug) {
  try {
    const res = await fetch(`${API_BASE}/projects/${slug}/skills`);
    if (res.ok) {
      projectSkills.value = await res.json();
    }
  } catch (err) {
    console.error('[settings] Failed to fetch skills:', err);
  }
}

export async function updateSkills(slug, skills) {
  const res = await fetch(`${API_BASE}/projects/${slug}/skills`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(skills),
  });
  if (res.ok) {
    projectSkills.value = await res.json();
  }
  return projectSkills.value;
}

// ── Settings ──

export async function fetchSettings(slug) {
  try {
    const res = await fetch(`${API_BASE}/projects/${slug}/settings`);
    if (res.ok) {
      projectSettings.value = await res.json();
    }
  } catch (err) {
    console.error('[settings] Failed to fetch settings:', err);
  }
}

export async function updateSettings(slug, patch) {
  const res = await fetch(`${API_BASE}/projects/${slug}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (res.ok) {
    projectSettings.value = await res.json();
  }
  return projectSettings.value;
}

// ── Reflections ──

export async function fetchReflections(slug, limit = 20) {
  try {
    const res = await fetch(`${API_BASE}/projects/${slug}/reflections?limit=${limit}`);
    if (res.ok) {
      projectReflections.value = await res.json();
      if (projectReflections.value.length > 0) {
        latestReflection.value = projectReflections.value[0];
      }
    }
  } catch (err) {
    console.error('[settings] Failed to fetch reflections:', err);
  }
}

// ── Load all Phase 2 data for a project ──

export async function loadProjectIntelligence(slug) {
  settingsLoading.value = true;
  try {
    await Promise.all([
      fetchSkills(slug),
      fetchSettings(slug),
      fetchReflections(slug),
    ]);
  } finally {
    settingsLoading.value = false;
  }
}

// ── Reset ──

export function resetProjectIntelligence() {
  projectSkills.value = null;
  projectSettings.value = null;
  projectReflections.value = [];
  latestReflection.value = null;
}
