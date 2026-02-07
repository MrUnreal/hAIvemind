import { ref, computed } from 'vue';

const API_BASE = '/api';

/**
 * Reactive project state & helpers.
 */

/** @type {import('vue').Ref<object[]>} */
export const projects = ref([]);

/** @type {import('vue').Ref<object|null>} */
export const activeProject = ref(null);

/** @type {import('vue').Ref<boolean>} */
export const loading = ref(false);

export const hasActiveProject = computed(() => !!activeProject.value);

/**
 * Fetch all projects from server.
 */
export async function fetchProjects() {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE}/projects`);
    projects.value = await res.json();
  } catch (err) {
    console.error('[projects] Failed to fetch:', err);
  } finally {
    loading.value = false;
  }
}

/**
 * Create a new project.
 */
export async function createProject(name, description = '') {
  const res = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error);
  }
  const project = await res.json();
  await fetchProjects();
  return project;
}

/**
 * Link an existing directory as a project.
 */
export async function linkProject(name, directory) {
  const res = await fetch(`${API_BASE}/projects/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, directory }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error);
  }
  const project = await res.json();
  await fetchProjects();
  return project;
}

/**
 * Delete a project.
 */
export async function deleteProject(slug) {
  await fetch(`${API_BASE}/projects/${slug}`, { method: 'DELETE' });
  if (activeProject.value?.slug === slug) {
    activeProject.value = null;
  }
  await fetchProjects();
}

/** @type {import('vue').Ref<object[]>} - sessions for active project */
export const sessions = ref([]);

/** @type {import('vue').Ref<boolean>} */
export const sessionsLoading = ref(false);

/**
 * Select a project as active and fetch its sessions.
 */
export async function selectProject(project) {
  activeProject.value = project;
  await fetchSessions(project.slug);
}

/**
 * Clear active project (go back to picker).
 */
export function clearProject() {
  activeProject.value = null;
  sessions.value = [];
}

/**
 * Fetch sessions for a project.
 */
export async function fetchSessions(slug) {
  sessionsLoading.value = true;
  try {
    const res = await fetch(`${API_BASE}/projects/${slug || activeProject.value?.slug}/sessions`);
    if (res.ok) {
      sessions.value = await res.json();
    }
  } catch (err) {
    console.error('[projects] Failed to fetch sessions:', err);
  } finally {
    sessionsLoading.value = false;
  }
}
