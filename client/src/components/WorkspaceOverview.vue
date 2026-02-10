<template>
  <div class="workspace-overview">
    <div class="overview-header">
      <h3>🔍 Workspace Intelligence</h3>
      <button class="refresh-btn" @click="refresh" :disabled="loading">
        {{ loading ? '⏳' : '🔄' }}
      </button>
    </div>

    <div v-if="loading && !analysis" class="overview-loading">Analyzing workspace...</div>

    <div v-else-if="error" class="overview-error">{{ error }}</div>

    <template v-else-if="analysis">
      <!-- Summary -->
      <p class="overview-summary">{{ analysis.summary }}</p>

      <!-- Tech Stack -->
      <div class="section" v-if="analysis.techStack && analysis.techStack.length">
        <h4>Tech Stack</h4>
        <div class="tag-row">
          <span v-for="tech in analysis.techStack" :key="tech" class="tech-tag">{{ tech }}</span>
        </div>
      </div>

      <!-- Conventions -->
      <div class="section" v-if="analysis.conventions">
        <h4>Conventions</h4>
        <div class="conventions-grid">
          <div class="conv-item" v-if="analysis.conventions.moduleSystem">
            <span class="conv-label">Modules</span>
            <span class="conv-value">{{ analysis.conventions.moduleSystem }}</span>
          </div>
          <div class="conv-item" v-if="analysis.conventions.testFramework">
            <span class="conv-label">Tests</span>
            <span class="conv-value">{{ analysis.conventions.testFramework }}</span>
          </div>
          <div class="conv-item" v-if="analysis.conventions.linter && analysis.conventions.linter !== 'none'">
            <span class="conv-label">Linter</span>
            <span class="conv-value">{{ analysis.conventions.linter }}</span>
          </div>
          <div class="conv-item" v-if="analysis.conventions.packageManager">
            <span class="conv-label">Pkg Mgr</span>
            <span class="conv-value">{{ analysis.conventions.packageManager }}</span>
          </div>
        </div>
      </div>

      <!-- Dependencies -->
      <div class="section" v-if="analysis.dependencies">
        <h4>Dependencies</h4>
        <div class="dep-counts">
          <span class="dep-badge runtime" v-if="analysis.dependencies.runtime">
            {{ analysis.dependencies.runtime.length }} runtime
          </span>
          <span class="dep-badge dev" v-if="analysis.dependencies.dev">
            {{ analysis.dependencies.dev.length }} dev
          </span>
        </div>
      </div>

      <!-- File Tree (collapsible) -->
      <div class="section" v-if="analysis.fileTree">
        <h4 @click="showTree = !showTree" class="toggle-heading">
          {{ showTree ? '▼' : '▶' }} File Tree
        </h4>
        <pre v-if="showTree" class="file-tree">{{ analysis.fileTree }}</pre>
      </div>

      <!-- Entry Points -->
      <div class="section" v-if="analysis.entryPoints && analysis.entryPoints.length">
        <h4>Entry Points</h4>
        <div v-for="ep in analysis.entryPoints" :key="ep.path" class="entry-point">
          <span class="ep-path">{{ ep.path }}</span>
          <code class="ep-preview" v-if="ep.preview">{{ truncate(ep.preview, 80) }}</code>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  projectSlug: { type: String, required: true },
});

const loading = ref(false);
const error = ref('');
const analysis = ref(null);
const showTree = ref(false);

function truncate(s, len) {
  if (!s) return '';
  return s.length > len ? s.slice(0, len) + '…' : s;
}

async function refresh() {
  if (!props.projectSlug) return;
  loading.value = true;
  error.value = '';
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/analysis`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    analysis.value = await res.json();
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

watch(() => props.projectSlug, (slug) => {
  if (slug) refresh();
}, { immediate: true });
</script>

<style scoped>
.workspace-overview {
  background: #1a1a2e;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 16px;
}

.overview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.overview-header h3 {
  margin: 0;
  font-size: 16px;
  color: #e0e0e0;
}

.refresh-btn {
  background: none;
  border: 1px solid #444;
  border-radius: 4px;
  color: #ccc;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 14px;
}

.refresh-btn:hover:not(:disabled) {
  background: #333;
}

.overview-loading, .overview-error {
  color: #888;
  text-align: center;
  padding: 16px;
}

.overview-error {
  color: #ff6b6b;
}

.overview-summary {
  color: #aaa;
  font-size: 13px;
  margin: 0 0 12px;
  line-height: 1.5;
}

.section {
  margin-bottom: 12px;
}

.section h4 {
  color: #e0e0e0;
  font-size: 13px;
  margin: 0 0 6px;
}

.toggle-heading {
  cursor: pointer;
  user-select: none;
}

.toggle-heading:hover {
  color: #60a5fa;
}

.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tech-tag {
  background: #2a2a4e;
  color: #a78bfa;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
}

.conventions-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.conv-item {
  display: flex;
  justify-content: space-between;
  background: #222;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
}

.conv-label {
  color: #888;
}

.conv-value {
  color: #e0e0e0;
  font-weight: 500;
}

.dep-counts {
  display: flex;
  gap: 8px;
}

.dep-badge {
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
}

.dep-badge.runtime {
  background: #1a3a2e;
  color: #4ade80;
}

.dep-badge.dev {
  background: #2a2a3e;
  color: #60a5fa;
}

.file-tree {
  background: #111;
  color: #aaa;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 11px;
  overflow-x: auto;
  max-height: 300px;
  overflow-y: auto;
}

.entry-point {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
}

.ep-path {
  color: #60a5fa;
  font-size: 12px;
  font-family: 'Fira Code', monospace;
}

.ep-preview {
  color: #666;
  font-size: 11px;
  font-family: 'Fira Code', monospace;
}
</style>
