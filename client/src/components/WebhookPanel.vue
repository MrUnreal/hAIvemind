<template>
  <div class="webhook-panel" v-if="visible">
    <div class="wh-header">
      <h3>🔔 Webhooks</h3>
      <button class="close-btn" @click="$emit('close')">✕</button>
    </div>

    <!-- Add Webhook Form -->
    <div class="wh-add-form">
      <input v-model="newUrl" class="wh-input" placeholder="https://example.com/webhook" />
      <input v-model="newName" class="wh-input wh-name" placeholder="Name (optional)" />
      <div class="wh-events">
        <label v-for="evt in availableEvents" :key="evt" class="wh-event-check">
          <input type="checkbox" :value="evt" v-model="newEvents" />
          {{ evt }}
        </label>
      </div>
      <button class="wh-add-btn" @click="addHook" :disabled="!newUrl.trim()">+ Add Webhook</button>
    </div>

    <!-- Webhook List -->
    <div v-if="loading" class="wh-loading">Loading...</div>
    <div v-else-if="webhooks.length === 0" class="wh-empty">No webhooks configured</div>

    <div v-else class="wh-list">
      <div v-for="hook in webhooks" :key="hook.id" class="wh-item" :class="{ disabled: !hook.enabled }">
        <div class="wh-item-header">
          <span class="wh-name-label">{{ hook.name || hook.url }}</span>
          <span class="wh-status" :class="hook.lastStatus || 'none'">
            {{ hook.lastStatus === 'ok' ? '✅' : hook.lastStatus === 'failed' ? '❌' : '⬜' }}
          </span>
        </div>

        <div class="wh-url">{{ hook.url }}</div>

        <div class="wh-meta">
          <span class="wh-events-list">{{ (hook.events || []).join(', ') }}</span>
          <span class="wh-stats">
            📦 {{ hook.deliveries || 0 }} delivered
            <span v-if="hook.failures > 0" class="wh-failures">· {{ hook.failures }} failed</span>
          </span>
        </div>

        <div class="wh-actions">
          <button class="wh-action toggle" @click="toggleHook(hook)" :title="hook.enabled ? 'Disable' : 'Enable'">
            {{ hook.enabled ? '⏸ Disable' : '▶ Enable' }}
          </button>
          <button class="wh-action test" @click="testHook(hook)" :disabled="testing === hook.id" title="Send test event">
            {{ testing === hook.id ? '⏳ Testing...' : '🧪 Test' }}
          </button>
          <button class="wh-action delete" @click="deleteHook(hook)" title="Remove webhook">
            🗑 Delete
          </button>
        </div>

        <div v-if="testResult && testResult.id === hook.id" class="wh-test-result" :class="testResult.success ? 'ok' : 'fail'">
          {{ testResult.success ? `✅ HTTP ${testResult.status}` : `❌ ${testResult.error || 'Failed'}` }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  projectSlug: { type: String, default: '' },
});

defineEmits(['close']);

const webhooks = ref([]);
const loading = ref(false);
const testing = ref(null);
const testResult = ref(null);

const newUrl = ref('');
const newName = ref('');
const newEvents = ref(['session:complete', 'session:failed']);
const availableEvents = ['session:started', 'session:complete', 'session:failed', 'session:warning'];

async function loadWebhooks() {
  if (!props.projectSlug) return;
  loading.value = true;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/webhooks`);
    if (res.ok) webhooks.value = await res.json();
  } catch { /* ignore */ }
  loading.value = false;
}

async function addHook() {
  if (!newUrl.value.trim() || !props.projectSlug) return;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: newUrl.value.trim(),
        name: newName.value.trim() || undefined,
        events: newEvents.value.length > 0 ? newEvents.value : undefined,
      }),
    });
    if (res.ok) {
      newUrl.value = '';
      newName.value = '';
      newEvents.value = ['session:complete', 'session:failed'];
      await loadWebhooks();
    }
  } catch { /* ignore */ }
}

async function deleteHook(hook) {
  if (!props.projectSlug) return;
  try {
    await fetch(`/api/projects/${props.projectSlug}/webhooks/${hook.id}`, { method: 'DELETE' });
    await loadWebhooks();
  } catch { /* ignore */ }
}

async function toggleHook(hook) {
  if (!props.projectSlug) return;
  try {
    await fetch(`/api/projects/${props.projectSlug}/webhooks/${hook.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !hook.enabled }),
    });
    await loadWebhooks();
  } catch { /* ignore */ }
}

async function testHook(hook) {
  if (!props.projectSlug) return;
  testing.value = hook.id;
  testResult.value = null;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/webhooks/${hook.id}/test`, { method: 'POST' });
    const data = await res.json();
    testResult.value = { id: hook.id, ...data };
  } catch (err) {
    testResult.value = { id: hook.id, success: false, error: err.message };
  }
  testing.value = null;
}

watch(() => props.visible, (v) => {
  if (v) loadWebhooks();
});
</script>

<style scoped>
.webhook-panel {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 16px;
}

.wh-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.wh-header h3 { font-size: 15px; color: var(--text-primary); }

.close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
}

/* Add Form */
.wh-add-form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-primary);
}

.wh-input {
  background: var(--border-primary);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  flex: 1;
  min-width: 200px;
}

.wh-name { max-width: 150px; min-width: 100px; flex: 0.3; }

.wh-events {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  width: 100%;
}

.wh-event-check {
  font-size: 11px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
}

.wh-add-btn {
  background: #2e7d32;
  border: none;
  color: #fff;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
}
.wh-add-btn:disabled { opacity: 0.5; cursor: default; }

/* Loading / Empty */
.wh-loading, .wh-empty {
  text-align: center;
  padding: 20px;
  color: var(--text-tertiary);
  font-size: 13px;
}

/* List */
.wh-list { display: flex; flex-direction: column; gap: 8px; }

.wh-item {
  background: var(--border-primary);
  border: 1px solid var(--border-secondary);
  border-radius: 8px;
  padding: 10px 14px;
}

.wh-item.disabled { opacity: 0.5; }

.wh-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.wh-name-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.wh-url {
  font-size: 11px;
  color: #64b5f6;
  font-family: 'Fira Code', monospace;
  margin-bottom: 6px;
  word-break: break-all;
}

.wh-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.wh-failures { color: #ef5350; }

.wh-actions {
  display: flex;
  gap: 6px;
}

.wh-action {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid var(--border-input);
  background: transparent;
  color: var(--btn-text);
  cursor: pointer;
  transition: all 0.2s;
}

.wh-action.toggle { border-color: #ffb74d; color: #ffb74d; }
.wh-action.toggle:hover { background: rgba(255, 183, 77, 0.1); }
.wh-action.test { border-color: #64b5f6; color: #64b5f6; }
.wh-action.test:hover { background: rgba(100, 181, 246, 0.1); }
.wh-action.delete { border-color: #ef5350; color: #ef5350; }
.wh-action.delete:hover { background: rgba(239, 83, 80, 0.1); }
.wh-action:disabled { opacity: 0.5; cursor: default; }

.wh-test-result {
  margin-top: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
}
.wh-test-result.ok { background: rgba(129, 199, 132, 0.1); color: #81c784; }
.wh-test-result.fail { background: rgba(239, 83, 80, 0.1); color: #ef5350; }
</style>
