<template>
  <div v-if="visible" class="sched-panel">
    <div class="sched-header">
      <h3>📅 Session Scheduler</h3>
      <button class="sched-close" @click="$emit('close')">✕</button>
    </div>

    <!-- Add Schedule Form -->
    <div class="sched-add-form">
      <input v-model="newPrompt" placeholder="Session prompt…" class="sched-prompt-input" />
      <div class="sched-options">
        <input v-model="newCron" placeholder="Cron: min hour dow (e.g. 0 9 *)" class="sched-cron-input" />
        <select v-model="newPriority" class="sched-priority-select">
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
        <label class="sched-oneshot-label">
          <input type="checkbox" v-model="newOneShot" /> One-shot
        </label>
      </div>
      <button class="sched-add-btn" @click="createSchedule" :disabled="!newPrompt.trim()">
        Add Schedule
      </button>
      <div v-if="addError" class="sched-error">{{ addError }}</div>
    </div>

    <!-- Schedules List -->
    <div class="sched-list">
      <div v-if="schedules.length === 0" class="sched-empty">No schedules yet</div>
      <div v-for="s in schedules" :key="s.id" class="sched-item" :class="{ 'sched-disabled': !s.enabled }">
        <div class="sched-item-header">
          <span class="sched-item-prompt">{{ s.prompt }}</span>
          <span class="sched-priority-badge" :class="'sched-p-' + s.priority">{{ s.priority }}</span>
        </div>
        <div class="sched-item-meta">
          <span v-if="s.cron" class="sched-cron-display">⏰ {{ s.cron }}</span>
          <span v-else class="sched-trigger-type">{{ s.trigger }}</span>
          <span v-if="s.oneShot" class="sched-oneshot">one-shot</span>
          <span class="sched-run-count">{{ s.runCount }} runs</span>
          <span v-if="s.lastRun" class="sched-last-run">Last: {{ formatDate(s.lastRun) }}</span>
          <span v-if="s.lastStatus" class="sched-last-status" :class="'sched-status-' + s.lastStatus">
            {{ s.lastStatus }}
          </span>
        </div>
        <div class="sched-actions">
          <button @click="toggleSchedule(s)" class="sched-toggle-btn">
            {{ s.enabled ? '⏸ Disable' : '▶ Enable' }}
          </button>
          <button @click="runNow(s)" class="sched-run-btn">🚀 Run Now</button>
          <button @click="deleteSchedule(s.id)" class="sched-delete-btn">🗑</button>
        </div>
      </div>
    </div>

    <!-- Queue -->
    <div class="sched-queue-section">
      <h4>📋 Execution Queue ({{ queue.length }})</h4>
      <div v-if="queue.length === 0" class="sched-empty">Queue is empty</div>
      <div v-for="q in queue" :key="q.id" class="sched-queue-item">
        <span class="sched-q-status" :class="'sched-qs-' + q.status">{{ q.status }}</span>
        <span class="sched-q-prompt">{{ q.prompt }}</span>
        <span class="sched-q-priority" :class="'sched-p-' + q.priority">{{ q.priority }}</span>
        <button v-if="q.status === 'pending'" @click="cancelQueueEntry(q.id)" class="sched-q-cancel">✕</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({ visible: Boolean, projectSlug: String });
const emit = defineEmits(['close']);

const schedules = ref([]);
const queue = ref([]);
const newPrompt = ref('');
const newCron = ref('');
const newPriority = ref('normal');
const newOneShot = ref(false);
const addError = ref('');

async function loadSchedules() {
  if (!props.projectSlug) return;
  try {
    const [schedRes, queueRes] = await Promise.all([
      fetch(`/api/projects/${props.projectSlug}/schedules`),
      fetch('/api/queue'),
    ]);
    if (schedRes.ok) schedules.value = await schedRes.json();
    if (queueRes.ok) {
      const all = await queueRes.json();
      queue.value = all.filter(e => e.slug === props.projectSlug);
    }
  } catch { /* ignore */ }
}

async function createSchedule() {
  addError.value = '';
  try {
    const body = { prompt: newPrompt.value.trim(), priority: newPriority.value, oneShot: newOneShot.value };
    if (newCron.value.trim()) body.cron = newCron.value.trim();
    const res = await fetch(`/api/projects/${props.projectSlug}/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json();
      addError.value = data.error || 'Failed to create schedule';
      return;
    }
    newPrompt.value = '';
    newCron.value = '';
    newPriority.value = 'normal';
    newOneShot.value = false;
    await loadSchedules();
  } catch (err) {
    addError.value = err.message;
  }
}

async function toggleSchedule(s) {
  await fetch(`/api/projects/${props.projectSlug}/schedules/${s.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: !s.enabled }),
  });
  await loadSchedules();
}

async function runNow(s) {
  await fetch(`/api/projects/${props.projectSlug}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: s.prompt, priority: s.priority, scheduleId: s.id }),
  });
  await loadSchedules();
}

async function deleteSchedule(id) {
  await fetch(`/api/projects/${props.projectSlug}/schedules/${id}`, { method: 'DELETE' });
  await loadSchedules();
}

async function cancelQueueEntry(id) {
  await fetch(`/api/queue/${id}`, { method: 'DELETE' });
  await loadSchedules();
}

function formatDate(ts) {
  return new Date(ts).toLocaleString();
}

watch(() => props.visible, v => { if (v) loadSchedules(); });
</script>

<style scoped>
.sched-panel { background: #1e1e2e; border: 1px solid #444; border-radius: 8px; padding: 16px; margin: 12px 0; }
.sched-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.sched-header h3 { margin: 0; color: #e0e0e0; }
.sched-close { background: none; border: none; color: #888; cursor: pointer; font-size: 18px; }
.sched-add-form { background: #262636; border-radius: 6px; padding: 12px; margin-bottom: 12px; }
.sched-prompt-input { width: 100%; padding: 8px; background: #1a1a2a; border: 1px solid #444; border-radius: 4px; color: #e0e0e0; box-sizing: border-box; margin-bottom: 8px; }
.sched-options { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.sched-cron-input { flex: 1; padding: 6px; background: #1a1a2a; border: 1px solid #444; border-radius: 4px; color: #e0e0e0; min-width: 200px; }
.sched-priority-select { padding: 6px; background: #1a1a2a; border: 1px solid #444; border-radius: 4px; color: #e0e0e0; }
.sched-oneshot-label { color: #aaa; font-size: 13px; display: flex; align-items: center; gap: 4px; }
.sched-add-btn { padding: 8px 16px; background: #4c8dff; color: white; border: none; border-radius: 4px; cursor: pointer; }
.sched-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.sched-error { color: #ff6b6b; font-size: 13px; margin-top: 6px; }
.sched-list { margin-bottom: 16px; }
.sched-empty { color: #666; font-style: italic; padding: 12px; text-align: center; }
.sched-item { background: #262636; border-radius: 6px; padding: 10px; margin-bottom: 6px; }
.sched-item.sched-disabled { opacity: 0.5; }
.sched-item-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.sched-item-prompt { color: #e0e0e0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.sched-priority-badge { padding: 2px 8px; border-radius: 3px; font-size: 11px; text-transform: uppercase; }
.sched-p-high { background: #ff6b6b33; color: #ff6b6b; }
.sched-p-normal { background: #4c8dff33; color: #4c8dff; }
.sched-p-low { background: #66666633; color: #888; }
.sched-item-meta { display: flex; gap: 8px; font-size: 12px; color: #888; flex-wrap: wrap; margin-bottom: 6px; }
.sched-cron-display { color: #ffa94d; }
.sched-oneshot { color: #cc99ff; }
.sched-last-status { font-weight: 500; }
.sched-status-completed { color: #51cf66; }
.sched-status-failed { color: #ff6b6b; }
.sched-actions { display: flex; gap: 6px; }
.sched-actions button { padding: 4px 10px; border: 1px solid #444; border-radius: 3px; background: #1a1a2a; color: #ccc; cursor: pointer; font-size: 12px; }
.sched-actions button:hover { background: #333; }
.sched-queue-section { border-top: 1px solid #333; padding-top: 12px; }
.sched-queue-section h4 { margin: 0 0 8px; color: #e0e0e0; }
.sched-queue-item { display: flex; gap: 8px; align-items: center; padding: 6px 8px; background: #262636; border-radius: 4px; margin-bottom: 4px; }
.sched-q-status { font-size: 11px; padding: 2px 6px; border-radius: 3px; }
.sched-qs-pending { background: #ffa94d33; color: #ffa94d; }
.sched-qs-running { background: #4c8dff33; color: #4c8dff; }
.sched-qs-completed { background: #51cf6633; color: #51cf66; }
.sched-qs-failed { background: #ff6b6b33; color: #ff6b6b; }
.sched-q-prompt { flex: 1; color: #ccc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.sched-q-cancel { background: none; border: none; color: #ff6b6b; cursor: pointer; font-size: 14px; }
</style>
