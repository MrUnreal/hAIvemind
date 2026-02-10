<template>
  <div class="autopilot-panel">
    <div class="autopilot-header">
      <h3>🤖 Autopilot</h3>
      <button class="close-btn" @click="$emit('close')" title="Close">×</button>
    </div>

    <!-- Start form (when not running) -->
    <div v-if="!running" class="start-form">
      <p class="hint">Run automated reflect→plan→build cycles on this project.</p>

      <div class="form-row">
        <label>Max Cycles</label>
        <input type="number" v-model.number="maxCycles" min="1" max="50" class="form-input" />
      </div>

      <div class="form-row">
        <label>Cost Ceiling</label>
        <input type="number" v-model.number="costCeiling" min="0" step="0.5" placeholder="No limit" class="form-input" />
      </div>

      <div class="form-row checkbox-row">
        <label>
          <input type="checkbox" v-model="requireTests" />
          Stop on test failure
        </label>
      </div>

      <button class="start-btn" @click="startAutopilot" :disabled="starting">
        {{ starting ? '⏳ Starting...' : '🚀 Start Autopilot' }}
      </button>

      <!-- History -->
      <div v-if="history.length" class="history-section">
        <h4>Previous Runs</h4>
        <div v-for="(run, i) in history" :key="i" class="history-card">
          <span class="history-time">{{ formatTime(run.runAt) }}</span>
          <span class="history-cycles">{{ run.cycles }} cycles</span>
          <span :class="['history-reason', run.stoppedReason]">{{ run.stoppedReason }}</span>
        </div>
      </div>
    </div>

    <!-- Live progress (when running) -->
    <div v-else class="live-progress">
      <div class="progress-header">
        <span class="cycle-badge">Cycle {{ currentCycle }} / {{ maxCyclesRunning }}</span>
        <button class="stop-btn" @click="stopAutopilot">⏹ Stop</button>
      </div>

      <!-- Decision timeline -->
      <div class="decision-list">
        <div v-for="(d, i) in decisions" :key="i" class="decision-card">
          <div class="decision-header">
            <span class="decision-cycle">#{{ d.cycle }}</span>
            <span class="decision-time" v-if="d.timestamp">{{ new Date(d.timestamp).toLocaleTimeString() }}</span>
          </div>
          <div class="decision-prompt" v-if="d.prompt">{{ truncate(d.prompt, 200) }}</div>
          <div class="decision-reasoning" v-if="d.reasoning">
            <em>{{ truncate(d.reasoning, 150) }}</em>
          </div>
          <div class="decision-result" v-if="d.result">
            <span :class="d.result.exitCode === 0 ? 'success' : 'fail'">
              {{ d.result.exitCode === 0 ? '✅ Success' : '❌ Failed' }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  projectSlug: { type: String, required: true },
  wsEvents: { type: Object, default: null },
});

defineEmits(['close']);

const running = ref(false);
const starting = ref(false);
const maxCycles = ref(5);
const costCeiling = ref(null);
const requireTests = ref(false);
const currentCycle = ref(0);
const maxCyclesRunning = ref(5);
const decisions = ref([]);
const history = ref([]);

function truncate(s, len) {
  if (!s) return '';
  return s.length > len ? s.slice(0, len) + '…' : s;
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}

async function fetchStatus() {
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/autopilot`);
    if (res.ok) {
      const data = await res.json();
      running.value = data.running;
      currentCycle.value = data.cycles || 0;
      decisions.value = data.decisions || [];
      history.value = data.history || [];
    }
  } catch { /* ignore */ }
}

async function startAutopilot() {
  starting.value = true;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/autopilot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxCycles: maxCycles.value,
        costCeiling: costCeiling.value,
        requireTests: requireTests.value,
      }),
    });
    if (res.ok) {
      running.value = true;
      maxCyclesRunning.value = maxCycles.value;
      decisions.value = [];
      currentCycle.value = 0;
    }
  } catch { /* ignore */ }
  starting.value = false;
}

async function stopAutopilot() {
  try {
    await fetch(`/api/projects/${props.projectSlug}/autopilot/stop`, { method: 'POST' });
  } catch { /* ignore */ }
}

// WS event handlers
function onAutopilotCycle(data) {
  if (data.slug !== props.projectSlug) return;
  currentCycle.value = data.cycle;
  decisions.value.push(data);
}

function onAutopilotStopped(data) {
  if (data.slug !== props.projectSlug) return;
  running.value = false;
  fetchStatus(); // refresh history
}

let pollInterval = null;

onMounted(() => {
  fetchStatus();
  // Poll for updates if WS events aren't wired
  pollInterval = setInterval(fetchStatus, 5000);
});

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval);
});

// Expose handlers for parent to wire WS events
defineExpose({ onAutopilotCycle, onAutopilotStopped });
</script>

<style scoped>
.autopilot-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0a0a0f;
  color: #c0c0c0;
  font-size: 13px;
}

.autopilot-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #2a2a3e;
}

.autopilot-header h3 {
  margin: 0;
  font-size: 15px;
  color: #e0e0e0;
}

.close-btn {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  font-size: 20px;
}

.start-form {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hint {
  color: #888;
  font-size: 12px;
  margin: 0;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.form-row label {
  min-width: 100px;
  color: #aaa;
  font-size: 12px;
}

.form-input {
  background: #16161e;
  border: 1px solid #2a2a3e;
  color: #e0e0e0;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 13px;
  width: 120px;
}

.checkbox-row label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.start-btn {
  background: linear-gradient(135deg, #f5c542 0%, #e6a817 100%);
  color: #000;
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  font-weight: 600;
  cursor: pointer;
  font-size: 14px;
}

.start-btn:hover:not(:disabled) {
  filter: brightness(1.1);
}

.start-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.history-section {
  margin-top: 12px;
}

.history-section h4 {
  color: #e0e0e0;
  font-size: 13px;
  margin: 0 0 8px;
}

.history-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: #16161e;
  border-radius: 6px;
  margin-bottom: 4px;
  font-size: 12px;
}

.history-time {
  color: #888;
}

.history-cycles {
  color: #60a5fa;
}

.history-reason {
  margin-left: auto;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
}

.history-reason.completed {
  background: rgba(74, 222, 128, 0.15);
  color: #4ade80;
}

.history-reason.cost-ceiling-reached {
  background: rgba(245, 197, 66, 0.15);
  color: #f5c542;
}

.history-reason.session-failed, .history-reason.error {
  background: rgba(248, 113, 113, 0.15);
  color: #f87171;
}

/* Live progress */
.live-progress {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.cycle-badge {
  background: #2a2a4e;
  color: #a78bfa;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
}

.stop-btn {
  background: rgba(248, 113, 113, 0.15);
  border: 1px solid #f87171;
  color: #f87171;
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 12px;
}

.stop-btn:hover {
  background: rgba(248, 113, 113, 0.25);
}

.decision-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  max-height: 400px;
}

.decision-card {
  background: #16161e;
  border: 1px solid #2a2a3e;
  border-radius: 8px;
  padding: 10px 12px;
}

.decision-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.decision-cycle {
  color: #a78bfa;
  font-weight: 600;
  font-size: 12px;
}

.decision-time {
  color: #666;
  font-size: 11px;
}

.decision-prompt {
  color: #ccc;
  font-size: 12px;
  margin-bottom: 4px;
}

.decision-reasoning {
  color: #888;
  font-size: 11px;
  margin-bottom: 4px;
}

.decision-result .success {
  color: #4ade80;
  font-size: 12px;
}

.decision-result .fail {
  color: #f87171;
  font-size: 12px;
}
</style>
