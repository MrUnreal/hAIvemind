<template>
  <div class="project-picker">
    <div class="picker-card">
      <h2>Select a Project</h2>
      <p class="subtitle">Each project gets its own isolated workspace. Agents write code directly into the project directory.</p>

      <!-- Create new -->
      <div class="create-section">
        <div class="input-row">
          <input
            v-model="newName"
            placeholder="New project name..."
            @keydown.enter="onCreate"
            class="text-input"
          />
          <button @click="onCreate" :disabled="!newName.trim()" class="btn-primary">
            + Create
          </button>
        </div>

        <div class="input-row link-row">
          <input
            v-model="linkName"
            placeholder="Project name..."
            class="text-input small"
          />
          <input
            v-model="linkDir"
            placeholder="Absolute path to existing folder..."
            class="text-input"
          />
          <button @click="onLink" :disabled="!linkName.trim() || !linkDir.trim()" class="btn-secondary">
            📁 Link Existing
          </button>
        </div>

        <p v-if="error" class="error-msg">{{ error }}</p>
      </div>

      <!-- Project list -->
      <div v-if="loading" class="loading">Loading projects...</div>

      <div v-else-if="projects.length === 0" class="empty">
        <p>No projects yet. Create one above to get started.</p>
      </div>

      <div v-else class="project-list">
        <div
          v-for="project in projects"
          :key="project.slug"
          class="project-item"
          @click="onSelect(project)"
        >
          <div class="project-main">
            <span class="project-name">
              {{ project.name }}
              <span v-if="project.linked" class="linked-badge">linked</span>
            </span>
            <span class="project-slug">{{ project.slug }}</span>
          </div>
          <div class="project-meta">
            <span>{{ project.sessionCount || 0 }} sessions</span>
            <span v-if="project.totalCost">{{ project.totalCost.toFixed(1) }}× cost</span>
            <span class="project-date">{{ formatDate(project.createdAt) }}</span>
          </div>
          <button
            class="btn-delete"
            @click.stop="onDelete(project.slug)"
            title="Delete project"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import {
  projects,
  loading,
  fetchProjects,
  createProject,
  linkProject,
  selectProject,
  deleteProject,
} from '../composables/useProjects.js';

const newName = ref('');
const linkName = ref('');
const linkDir = ref('');
const error = ref('');

onMounted(() => {
  fetchProjects();
});

async function onCreate() {
  if (!newName.value.trim()) return;
  error.value = '';
  try {
    const project = await createProject(newName.value.trim());
    newName.value = '';
    selectProject(project);
  } catch (err) {
    error.value = err.message;
  }
}

async function onLink() {
  if (!linkName.value.trim() || !linkDir.value.trim()) return;
  error.value = '';
  try {
    const project = await linkProject(linkName.value.trim(), linkDir.value.trim());
    linkName.value = '';
    linkDir.value = '';
    selectProject(project);
  } catch (err) {
    error.value = err.message;
  }
}

function onSelect(project) {
  selectProject(project);
}

async function onDelete(slug) {
  if (confirm(`Delete project "${slug}" and all its files?`)) {
    await deleteProject(slug);
  }
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString();
}
</script>

<style scoped>
.project-picker {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}

.picker-card {
  max-width: 680px;
  width: 100%;
}

h2 {
  font-size: 28px;
  font-weight: 600;
  color: #f0f0f0;
  margin-bottom: 8px;
}

.subtitle {
  color: #888;
  margin-bottom: 24px;
  line-height: 1.5;
}

.create-section {
  margin-bottom: 32px;
}

.input-row {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}

.link-row {
  margin-top: 8px;
}

.text-input {
  flex: 1;
  background: #111118;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 10px 14px;
  color: #e0e0e0;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s;
}
.text-input:focus {
  border-color: #f5c542;
}
.text-input.small {
  max-width: 180px;
}

.btn-primary {
  background: #f5c542;
  color: #111;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s;
}
.btn-primary:hover:not(:disabled) { background: #ffd866; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-secondary {
  background: #1a2a3a;
  color: #6aacf5;
  border: 1px solid #2a3a4a;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s;
}
.btn-secondary:hover:not(:disabled) { background: #223344; }
.btn-secondary:disabled { opacity: 0.4; cursor: not-allowed; }

.error-msg {
  color: #f56a6a;
  font-size: 13px;
  margin-top: 8px;
}

.loading, .empty {
  text-align: center;
  color: #666;
  padding: 40px 0;
}

.project-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.project-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  background: #111118;
  border: 1px solid #222;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.project-item:hover {
  border-color: #f5c542;
  background: #16161e;
}

.project-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.project-name {
  font-weight: 600;
  color: #e0e0e0;
  font-size: 15px;
}

.linked-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 500;
  background: #1a2a3a;
  color: #6aacf5;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 8px;
  vertical-align: middle;
}

.project-slug {
  font-size: 12px;
  color: #555;
  font-family: monospace;
}

.project-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #666;
  white-space: nowrap;
}

.project-date {
  color: #555;
}

.btn-delete {
  background: none;
  border: none;
  color: #555;
  font-size: 14px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: color 0.2s, background 0.2s;
}
.btn-delete:hover {
  color: #f56a6a;
  background: #2a1a1a;
}
</style>
