<template>
  <div class="project-picker">
    <div class="picker-card">
      <!-- Hero -->
      <div class="hero">
        <div class="hero-icon">🐝</div>
        <h1 class="hero-title">hAIvemind</h1>
        <p class="hero-tagline">AI-powered orchestrator that decomposes, delegates, and builds.</p>
      </div>

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

      <!-- Search / filter -->
      <div v-if="projects.length > 5" class="search-row">
        <input
          v-model="search"
          placeholder="Search projects..."
          class="search-input"
        />
      </div>

      <!-- Project list -->
      <div v-if="loading" class="loading">
        <div class="loading-spinner"></div>
        <span>Loading projects...</span>
      </div>

      <div v-else-if="projects.length === 0" class="empty">
        <div class="empty-icon">📂</div>
        <p>No projects yet</p>
        <span class="empty-hint">Create one above to get started.</span>
      </div>

      <div v-else class="project-list">
        <div
          v-for="project in filteredProjects"
          :key="project.slug"
          class="project-item"
          @click="onSelect(project)"
        >
          <div class="project-icon-col">
            <div class="project-avatar" :style="{ background: avatarColor(project.slug) }">
              {{ project.name.charAt(0).toUpperCase() }}
            </div>
          </div>
          <div class="project-main">
            <span class="project-name">
              {{ project.name }}
              <span v-if="project.linked" class="linked-badge">linked</span>
            </span>
            <span class="project-slug">{{ project.slug }}</span>
          </div>
          <div class="project-meta">
            <span class="meta-pill sessions">{{ project.sessionCount || 0 }} sessions</span>
            <span v-if="project.totalCost" class="meta-pill cost">{{ project.totalCost.toFixed(1) }}×</span>
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
        <div v-if="filteredProjects.length === 0 && search" class="empty-search">
          No projects match "{{ search }}"
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
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
const search = ref('');

const filteredProjects = computed(() => {
  if (!search.value.trim()) return projects.value;
  const q = search.value.trim().toLowerCase();
  return projects.value.filter(p =>
    p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)
  );
});

const avatarColors = [
  'linear-gradient(135deg, #f5c542, #e6a817)',
  'linear-gradient(135deg, #4a9eff, #2563eb)',
  'linear-gradient(135deg, #6ecf6e, #22c55e)',
  'linear-gradient(135deg, #b56af5, #8b5cf6)',
  'linear-gradient(135deg, #f56a6a, #ef4444)',
  'linear-gradient(135deg, #f59e0b, #d97706)',
  'linear-gradient(135deg, #06b6d4, #0891b2)',
  'linear-gradient(135deg, #ec4899, #db2777)',
];

function avatarColor(slug) {
  let hash = 0;
  for (const c of slug) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

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
  align-items: flex-start;
  justify-content: center;
  padding: 40px 24px;
  overflow-y: auto;
}

.picker-card {
  max-width: 720px;
  width: 100%;
  padding-bottom: 60px;
}

/* ── Hero ── */
.hero {
  text-align: center;
  margin-bottom: 40px;
}

.hero-icon {
  font-size: 48px;
  margin-bottom: 12px;
  filter: drop-shadow(0 0 24px rgba(245, 197, 66, 0.3));
}

.hero-title {
  font-size: 36px;
  font-weight: 700;
  background: linear-gradient(135deg, #f5c542 0%, #ffd866 50%, #f5c542 100%);
  background-size: 200% 200%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: shimmer 3s ease-in-out infinite;
  margin-bottom: 8px;
}

@keyframes shimmer {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

.hero-tagline {
  color: #666;
  font-size: 15px;
  line-height: 1.5;
}

/* ── Create section ── */
.create-section {
  margin-bottom: 28px;
}

.input-row {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}

.link-row {
  margin-top: 4px;
}

.text-input {
  flex: 1;
  background: #111118;
  border: 1px solid #2a2a3e;
  border-radius: 10px;
  padding: 11px 16px;
  color: #e0e0e0;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.text-input:focus {
  border-color: #f5c542;
  box-shadow: 0 0 0 3px rgba(245, 197, 66, 0.1);
}
.text-input.small {
  max-width: 180px;
}
.text-input::placeholder {
  color: #444;
}

.btn-primary {
  background: linear-gradient(135deg, #f5c542, #e6a817);
  color: #111;
  border: none;
  padding: 11px 22px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: transform 0.15s, box-shadow 0.2s;
}
.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(245, 197, 66, 0.3);
}
.btn-primary:active:not(:disabled) {
  transform: translateY(0);
}
.btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }

.btn-secondary {
  background: #14141e;
  color: #6aacf5;
  border: 1px solid #1e2a3a;
  padding: 11px 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.2s, background 0.2s;
}
.btn-secondary:hover:not(:disabled) { background: #1a2230; border-color: #2a4a6a; }
.btn-secondary:disabled { opacity: 0.35; cursor: not-allowed; }

.error-msg {
  color: #f56a6a;
  font-size: 13px;
  margin-top: 8px;
}

/* ── Search ── */
.search-row {
  margin-bottom: 16px;
}

.search-input {
  width: 100%;
  background: #111118;
  border: 1px solid #2a2a3e;
  border-radius: 10px;
  padding: 10px 16px;
  color: #e0e0e0;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s;
}
.search-input:focus {
  border-color: #4a9eff;
  box-shadow: 0 0 0 3px rgba(74, 158, 255, 0.08);
}
.search-input::placeholder {
  color: #444;
}

/* ── Loading ── */
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #555;
  padding: 40px 0;
}

.loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #333;
  border-top-color: #f5c542;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Empty ── */
.empty {
  text-align: center;
  padding: 60px 0;
}

.empty-icon {
  font-size: 40px;
  margin-bottom: 12px;
  opacity: 0.5;
}

.empty p {
  color: #666;
  font-size: 15px;
  margin-bottom: 4px;
}

.empty-hint {
  color: #444;
  font-size: 13px;
}

.empty-search {
  text-align: center;
  color: #555;
  padding: 24px;
  font-size: 13px;
}

/* ── Project list ── */
.project-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.project-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  background: #111118;
  border: 1px solid #1e1e2e;
  border-radius: 12px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s, transform 0.15s, box-shadow 0.2s;
}
.project-item:hover {
  border-color: #f5c54266;
  background: #14141e;
  transform: translateX(2px);
  box-shadow: 0 2px 12px rgba(245, 197, 66, 0.06);
}

.project-icon-col {
  flex-shrink: 0;
}

.project-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.3);
}

.project-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.project-name {
  font-weight: 600;
  color: #e0e0e0;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  font-size: 11px;
  color: #444;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.project-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
}

.meta-pill {
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 500;
}

.meta-pill.sessions {
  background: #1a1a2e;
  color: #888;
}

.meta-pill.cost {
  background: #2a2a1a;
  color: #f5c542;
}

.project-date {
  color: #444;
  font-size: 11px;
}

.btn-delete {
  background: none;
  border: none;
  color: #333;
  font-size: 14px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: color 0.2s, background 0.2s;
  opacity: 0;
}
.project-item:hover .btn-delete {
  opacity: 1;
}
.btn-delete:hover {
  color: #f56a6a;
  background: #2a1a1a;
}
</style>
