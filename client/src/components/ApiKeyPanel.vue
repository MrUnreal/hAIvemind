<template>
  <div v-if="visible" class="apikey-panel">
    <div class="apikey-header">
      <h3>🔑 API Key Management</h3>
      <button class="apikey-close-btn" @click="$emit('close')">✕</button>
    </div>

    <!-- Add key form -->
    <div class="apikey-add-form">
      <div class="apikey-row">
        <select v-model="newBackend" class="apikey-input apikey-select">
          <option value="">Select backend…</option>
          <option v-for="b in backends" :key="b" :value="b">{{ b }}</option>
        </select>
        <input
          v-model="newLabel"
          class="apikey-input"
          placeholder="Label (optional)"
        />
      </div>
      <div class="apikey-row">
        <input
          v-model="newKey"
          class="apikey-input apikey-key-input"
          :type="showNewKey ? 'text' : 'password'"
          placeholder="Paste API key…"
        />
        <button class="apikey-btn apikey-eye-btn" @click="showNewKey = !showNewKey">
          {{ showNewKey ? '🙈' : '👁️' }}
        </button>
        <button class="apikey-btn apikey-add-btn" :disabled="!canAdd" @click="addKey">
          Add
        </button>
      </div>
    </div>

    <!-- Key list -->
    <div v-if="keys.length === 0" class="apikey-empty">
      No API keys configured. Add one above.
    </div>

    <div v-for="key in keys" :key="key.id" class="apikey-card" :class="{ inactive: !key.active }">
      <div class="apikey-card-header">
        <span class="apikey-backend-badge">{{ key.backend }}</span>
        <span class="apikey-label">{{ key.label }}</span>
        <span class="apikey-status" :class="key.active ? 'active' : 'disabled'">
          {{ key.active ? '● Active' : '○ Disabled' }}
        </span>
      </div>
      <div class="apikey-card-body">
        <code class="apikey-masked">{{ key.maskedKey }}</code>
        <span class="apikey-date" :title="new Date(key.createdAt).toISOString()">
          {{ key.rotatedAt ? 'Rotated ' + timeAgo(key.rotatedAt) : 'Added ' + timeAgo(key.createdAt) }}
        </span>
      </div>
      <div class="apikey-card-actions">
        <button class="apikey-btn" @click="toggleKey(key.id)">
          {{ key.active ? 'Disable' : 'Enable' }}
        </button>
        <button class="apikey-btn" @click="startRotate(key)">Rotate</button>
        <button class="apikey-btn apikey-delete-btn" @click="deleteKey(key.id)">Delete</button>
      </div>

      <!-- Rotate inline form -->
      <div v-if="rotatingId === key.id" class="apikey-rotate-form">
        <input
          v-model="rotateKeyValue"
          class="apikey-input apikey-key-input"
          type="password"
          placeholder="New API key…"
        />
        <button class="apikey-btn" :disabled="!rotateKeyValue" @click="confirmRotate(key.id)">
          Confirm
        </button>
        <button class="apikey-btn" @click="rotatingId = null">Cancel</button>
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
const emit = defineEmits(['close']);

const backends = ['copilot', 'ollama', 'openai', 'anthropic', 'custom'];
const keys = ref([]);
const newBackend = ref('');
const newLabel = ref('');
const newKey = ref('');
const showNewKey = ref(false);
const rotatingId = ref(null);
const rotateKeyValue = ref('');

const canAdd = computed(() => newBackend.value && newKey.value.length >= 4);

watch(() => props.projectSlug, fetchKeys, { immediate: true });
watch(() => props.visible, (v) => { if (v) fetchKeys(); });

async function fetchKeys() {
  if (!props.projectSlug) return;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/api-keys`);
    if (res.ok) keys.value = await res.json();
  } catch { /* ignore */ }
}

async function addKey() {
  if (!canAdd.value) return;
  const res = await fetch(`/api/projects/${props.projectSlug}/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backend: newBackend.value, label: newLabel.value || newBackend.value, key: newKey.value }),
  });
  if (res.ok) {
    newBackend.value = '';
    newLabel.value = '';
    newKey.value = '';
    showNewKey.value = false;
    await fetchKeys();
  }
}

async function deleteKey(keyId) {
  await fetch(`/api/projects/${props.projectSlug}/api-keys/${keyId}`, { method: 'DELETE' });
  await fetchKeys();
}

async function toggleKey(keyId) {
  await fetch(`/api/projects/${props.projectSlug}/api-keys/${keyId}/toggle`, { method: 'PATCH' });
  await fetchKeys();
}

function startRotate(key) {
  rotatingId.value = key.id;
  rotateKeyValue.value = '';
}

async function confirmRotate(keyId) {
  await fetch(`/api/projects/${props.projectSlug}/api-keys/${keyId}/rotate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: rotateKeyValue.value }),
  });
  rotatingId.value = null;
  rotateKeyValue.value = '';
  await fetchKeys();
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
</script>

<style scoped>
.apikey-panel {
  padding: 1rem;
  max-height: 100%;
  overflow-y: auto;
}
.apikey-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}
.apikey-header h3 {
  color: var(--text-primary);
  margin: 0;
  font-size: 1rem;
}
.apikey-close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 1rem;
}
.apikey-add-form {
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 0.75rem;
  margin-bottom: 1rem;
}
.apikey-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.apikey-row:last-child {
  margin-bottom: 0;
}
.apikey-input {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border-input);
  border-radius: 6px;
  color: var(--text-primary);
  padding: 0.4rem 0.6rem;
  font-size: 0.85rem;
}
.apikey-select {
  max-width: 160px;
}
.apikey-key-input {
  font-family: monospace;
}
.apikey-btn {
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  color: var(--btn-text);
  border-radius: 6px;
  padding: 0.4rem 0.7rem;
  cursor: pointer;
  font-size: 0.8rem;
  white-space: nowrap;
}
.apikey-btn:hover {
  background: var(--btn-hover-bg);
}
.apikey-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.apikey-add-btn {
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  border: none;
}
.apikey-eye-btn {
  flex-shrink: 0;
  padding: 0.4rem;
}
.apikey-delete-btn {
  color: var(--accent-red);
  border-color: var(--accent-red-dim);
}
.apikey-empty {
  text-align: center;
  color: var(--text-muted);
  padding: 2rem;
  font-size: 0.85rem;
}
.apikey-card {
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
}
.apikey-card.inactive {
  opacity: 0.6;
}
.apikey-card-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}
.apikey-backend-badge {
  background: var(--accent-blue-dim);
  color: var(--accent-blue);
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}
.apikey-label {
  color: var(--text-primary);
  font-size: 0.85rem;
}
.apikey-status {
  margin-left: auto;
  font-size: 0.75rem;
}
.apikey-status.active {
  color: var(--accent-green);
}
.apikey-status.disabled {
  color: var(--text-muted);
}
.apikey-card-body {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}
.apikey-masked {
  color: var(--text-secondary);
  font-size: 0.8rem;
  background: var(--bg-input);
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
}
.apikey-date {
  color: var(--text-muted);
  font-size: 0.7rem;
}
.apikey-card-actions {
  display: flex;
  gap: 0.4rem;
}
.apikey-rotate-form {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-subtle);
}
</style>
