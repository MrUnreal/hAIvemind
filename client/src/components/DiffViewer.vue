<template>
  <div class="diff-viewer">
    <div class="diff-header">
      <h3>📊 Session Diff</h3>
      <span class="file-count">{{ files.length }} file{{ files.length !== 1 ? 's' : '' }} changed</span>
      <button class="close-diff" @click="$emit('close')">✕</button>
    </div>

    <div v-if="loading" class="diff-loading">Loading diff...</div>

    <div v-else-if="error" class="diff-error">{{ error }}</div>

    <template v-else>
      <!-- Stat summary -->
      <pre class="diff-summary" v-if="summary">{{ summary }}</pre>

      <!-- File list / accordion -->
      <div class="diff-files">
        <div v-for="file in files" :key="file" class="diff-file">
          <div class="file-header" @click="toggleFile(file)">
            <span class="file-icon">{{ expandedFiles[file] ? '▼' : '▶' }}</span>
            <span class="file-name">{{ file }}</span>
          </div>
          <div v-if="expandedFiles[file] && patches[file]" class="file-patch">
            <pre><code v-html="highlightPatch(patches[file])"></code></pre>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';

const props = defineProps({
  projectSlug: { type: String, required: true },
  sessionId: { type: String, required: true },
});

defineEmits(['close']);

const loading = ref(true);
const error = ref('');
const files = ref([]);
const summary = ref('');
const patches = ref({});
const expandedFiles = reactive({});

function toggleFile(file) {
  expandedFiles[file] = !expandedFiles[file];
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightPatch(patch) {
  if (!patch) return '';
  return escapeHtml(patch)
    .split('\n')
    .map(line => {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        return `<span class="diff-add">${line}</span>`;
      }
      if (line.startsWith('-') && !line.startsWith('---')) {
        return `<span class="diff-del">${line}</span>`;
      }
      if (line.startsWith('@@')) {
        return `<span class="diff-hunk">${line}</span>`;
      }
      if (line.startsWith('diff ')) {
        return `<span class="diff-meta">${line}</span>`;
      }
      return line;
    })
    .join('\n');
}

onMounted(async () => {
  try {
    const res = await fetch(
      `/api/projects/${props.projectSlug}/sessions/${props.sessionId}/diff?patches=true`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    files.value = data.files || [];
    summary.value = data.summary || '';
    patches.value = data.patches || {};
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.diff-viewer {
  background: var(--border-primary);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 16px;
  max-height: 70vh;
  overflow-y: auto;
}

.diff-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.diff-header h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 16px;
}

.file-count {
  color: var(--text-muted);
  font-size: 13px;
}

.close-diff {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 18px;
  padding: 4px 8px;
}

.close-diff:hover {
  color: #fff;
}

.diff-loading, .diff-error {
  color: var(--text-muted);
  text-align: center;
  padding: 24px;
}

.diff-error {
  color: #ff6b6b;
}

.diff-summary {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 12px;
  margin-bottom: 12px;
  overflow-x: auto;
}

.diff-files {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.file-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--border-primary);
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-primary);
  font-size: 13px;
}

.file-header:hover {
  background: var(--border-secondary);
}

.file-icon {
  font-size: 10px;
  color: var(--text-muted);
}

.file-name {
  font-family: 'Fira Code', monospace;
}

.file-patch {
  background: var(--bg-primary);
  border-left: 3px solid var(--border-subtle);
  margin-left: 12px;
  padding: 0;
  overflow-x: auto;
}

.file-patch pre {
  margin: 0;
  padding: 10px 14px;
  font-size: 12px;
  line-height: 1.5;
  font-family: 'Fira Code', monospace;
  color: var(--btn-text);
}

.file-patch :deep(.diff-add) {
  color: #4ade80;
  background: rgba(74, 222, 128, 0.08);
  display: block;
}

.file-patch :deep(.diff-del) {
  color: #f87171;
  background: rgba(248, 113, 113, 0.08);
  display: block;
}

.file-patch :deep(.diff-hunk) {
  color: #60a5fa;
  display: block;
}

.file-patch :deep(.diff-meta) {
  color: var(--text-muted);
  font-weight: bold;
  display: block;
}
</style>
