<template>
  <div v-if="visible" class="tmpl-panel">
    <div class="tmpl-header">
      <h3>📋 Session Templates</h3>
      <button class="tmpl-close-btn" @click="$emit('close')">✕</button>
    </div>

    <!-- Create / Edit form -->
    <div class="tmpl-form" v-if="showForm">
      <input v-model="form.name" class="tmpl-input" placeholder="Template name…" />
      <textarea v-model="form.prompt" class="tmpl-input tmpl-textarea" placeholder="Prompt text…" rows="4" />
      <input v-model="form.description" class="tmpl-input" placeholder="Description (optional)" />
      <select v-model="form.category" class="tmpl-input tmpl-select">
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>
      <div class="tmpl-form-actions">
        <button class="tmpl-btn tmpl-primary-btn" :disabled="!canSave" @click="saveTemplate">
          {{ editing ? 'Update' : 'Create' }}
        </button>
        <button class="tmpl-btn" @click="cancelForm">Cancel</button>
      </div>
    </div>

    <button v-else class="tmpl-btn tmpl-add-btn" @click="openCreateForm">+ New Template</button>

    <!-- Filter -->
    <div v-if="templates.length > 0" class="tmpl-filter">
      <button
        v-for="c in ['all', ...categories]" :key="c"
        :class="['tmpl-filter-btn', { active: filterCat === c }]"
        @click="filterCat = c"
      >
        {{ c }}
      </button>
    </div>

    <!-- Template list -->
    <div v-if="filtered.length === 0 && !showForm" class="tmpl-empty">
      {{ templates.length === 0 ? 'No templates yet. Create one to get started.' : 'No templates in this category.' }}
    </div>

    <div v-for="tmpl in filtered" :key="tmpl.id" class="tmpl-card">
      <div class="tmpl-card-header">
        <span class="tmpl-cat-badge">{{ tmpl.category }}</span>
        <span class="tmpl-name">{{ tmpl.name }}</span>
        <span class="tmpl-use-count" :title="`Used ${tmpl.useCount} times`">{{ tmpl.useCount }}×</span>
      </div>
      <div v-if="tmpl.description" class="tmpl-desc">{{ tmpl.description }}</div>
      <div class="tmpl-prompt-preview">{{ truncate(tmpl.prompt, 120) }}</div>
      <div class="tmpl-card-actions">
        <button class="tmpl-btn tmpl-launch-btn" @click="launchTemplate(tmpl)">▶ Launch</button>
        <button class="tmpl-btn" @click="editTemplate(tmpl)">Edit</button>
        <button class="tmpl-btn" @click="duplicate(tmpl.id)">Copy</button>
        <button class="tmpl-btn tmpl-delete-btn" @click="deleteTemplate(tmpl.id)">Delete</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  visible: Boolean,
  projectSlug: String,
});
const emit = defineEmits(['close', 'launch']);

const categories = ['feature', 'refactor', 'test', 'debug', 'docs', 'custom'];
const templates = ref([]);
const showForm = ref(false);
const editing = ref(null);
const filterCat = ref('all');
const form = ref({ name: '', prompt: '', description: '', category: 'custom' });

const canSave = computed(() => form.value.name.trim() && form.value.prompt.trim());
const filtered = computed(() => {
  if (filterCat.value === 'all') return templates.value;
  return templates.value.filter(t => t.category === filterCat.value);
});

watch(() => props.projectSlug, fetchTemplates, { immediate: true });
watch(() => props.visible, (v) => { if (v) fetchTemplates(); });

async function fetchTemplates() {
  if (!props.projectSlug) return;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/templates`);
    if (res.ok) templates.value = await res.json();
  } catch { /* ignore */ }
}

function openCreateForm() {
  form.value = { name: '', prompt: '', description: '', category: 'custom' };
  editing.value = null;
  showForm.value = true;
}

function editTemplate(tmpl) {
  form.value = { name: tmpl.name, prompt: tmpl.prompt, description: tmpl.description, category: tmpl.category };
  editing.value = tmpl.id;
  showForm.value = true;
}

function cancelForm() {
  showForm.value = false;
  editing.value = null;
}

async function saveTemplate() {
  if (!canSave.value) return;
  if (editing.value) {
    await fetch(`/api/projects/${props.projectSlug}/templates/${editing.value}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form.value),
    });
  } else {
    await fetch(`/api/projects/${props.projectSlug}/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form.value),
    });
  }
  showForm.value = false;
  editing.value = null;
  await fetchTemplates();
}

async function deleteTemplate(id) {
  await fetch(`/api/projects/${props.projectSlug}/templates/${id}`, { method: 'DELETE' });
  await fetchTemplates();
}

async function duplicate(id) {
  await fetch(`/api/projects/${props.projectSlug}/templates/${id}/duplicate`, { method: 'POST' });
  await fetchTemplates();
}

async function launchTemplate(tmpl) {
  await fetch(`/api/projects/${props.projectSlug}/templates/${tmpl.id}/use`, { method: 'POST' });
  emit('launch', { prompt: tmpl.prompt, settings: tmpl.settings });
  await fetchTemplates();
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max) + '…' : text;
}
</script>

<style scoped>
.tmpl-panel {
  padding: 1rem;
  max-height: 100%;
  overflow-y: auto;
}
.tmpl-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}
.tmpl-header h3 {
  color: var(--text-primary);
  margin: 0;
  font-size: 1rem;
}
.tmpl-close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 1rem;
}
.tmpl-form {
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 0.75rem;
  margin-bottom: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.tmpl-input {
  background: var(--bg-input);
  border: 1px solid var(--border-input);
  border-radius: 6px;
  color: var(--text-primary);
  padding: 0.4rem 0.6rem;
  font-size: 0.85rem;
  font-family: inherit;
}
.tmpl-textarea {
  resize: vertical;
  min-height: 60px;
}
.tmpl-select {
  max-width: 160px;
}
.tmpl-form-actions {
  display: flex;
  gap: 0.5rem;
}
.tmpl-btn {
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  color: var(--btn-text);
  border-radius: 6px;
  padding: 0.35rem 0.6rem;
  cursor: pointer;
  font-size: 0.8rem;
  white-space: nowrap;
}
.tmpl-btn:hover {
  background: var(--btn-hover-bg);
}
.tmpl-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.tmpl-primary-btn {
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  border: none;
}
.tmpl-add-btn {
  width: 100%;
  margin-bottom: 0.75rem;
  text-align: center;
  padding: 0.5rem;
}
.tmpl-launch-btn {
  background: var(--accent-green-dim);
  color: var(--accent-green);
  border-color: var(--accent-green-dim);
}
.tmpl-delete-btn {
  color: var(--accent-red);
  border-color: var(--accent-red-dim);
}
.tmpl-filter {
  display: flex;
  gap: 0.3rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}
.tmpl-filter-btn {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  border-radius: 12px;
  padding: 0.2rem 0.5rem;
  cursor: pointer;
  font-size: 0.7rem;
  text-transform: capitalize;
}
.tmpl-filter-btn.active {
  background: var(--accent-blue-dim);
  color: var(--accent-blue);
  border-color: var(--accent-blue);
}
.tmpl-empty {
  text-align: center;
  color: var(--text-muted);
  padding: 2rem;
  font-size: 0.85rem;
}
.tmpl-card {
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
}
.tmpl-card-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.3rem;
}
.tmpl-cat-badge {
  background: var(--accent-purple-dim);
  color: var(--accent-purple);
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
}
.tmpl-name {
  color: var(--text-primary);
  font-size: 0.85rem;
  font-weight: 600;
}
.tmpl-use-count {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 0.7rem;
}
.tmpl-desc {
  color: var(--text-secondary);
  font-size: 0.75rem;
  margin-bottom: 0.3rem;
}
.tmpl-prompt-preview {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  font-family: monospace;
  background: var(--bg-input);
  padding: 0.3rem 0.5rem;
  border-radius: 4px;
  margin-bottom: 0.5rem;
  white-space: pre-wrap;
  word-break: break-word;
}
.tmpl-card-actions {
  display: flex;
  gap: 0.4rem;
}
</style>
