<template>
  <div class="chat-container">
    <div class="chat-header">
      <h3>🐝 Orchestrator</h3>
      <span v-if="isBusy" class="streaming-dot">● working...</span>
    </div>

    <div class="chat-messages" ref="messagesRef">
      <div v-if="messages.length === 0" class="chat-empty">
        <p>Waiting for session to start...</p>
      </div>

      <template v-for="(msg, i) in messages" :key="i">
        <!-- User messages: left-aligned -->
        <div v-if="msg.role === 'user'" class="chat-row chat-row-user">
          <div class="bubble bubble-user">
            <span class="bubble-text">{{ msg.content }}</span>
            <span class="msg-time">{{ formatTime(msg.time) }}</span>
          </div>
        </div>

        <!-- Assistant / orchestrator messages: right-aligned -->
        <div v-else class="chat-row chat-row-assistant">
          <div class="bubble bubble-assistant" :class="{ 'bubble-status': msg.role === 'status' }">
            <pre class="bubble-text">{{ msg.content }}</pre>
            <span class="msg-time">{{ formatTime(msg.time) }}</span>
          </div>
        </div>
      </template>
    </div>

    <div class="chat-input-row">
      <textarea
        ref="inputRef"
        v-model="input"
        :placeholder="isBusy ? 'Waiting for tasks to complete...' : 'Describe your next change...'"
        @keydown.enter.exact.prevent="sendMessage"
        rows="2"
        :disabled="isBusy || sessionStatus !== 'completed'"
      ></textarea>
      <button @click="sendMessage" :disabled="!input.trim() || isBusy || sessionStatus !== 'completed'">
        ↵
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted } from 'vue';
import { activeProject } from '../composables/useProjects.js';
import { sessionStatus, tasks, costSummary } from '../composables/useSession.js';
import { useWebSocket } from '../composables/useWebSocket.js';

const { on, send, connectionLost } = useWebSocket();

const messages = ref([]);
const input = ref('');
const isBusy = ref(false);
const messagesRef = ref(null);
const inputRef = ref(null);

// Reset isBusy when WS disconnects to prevent permanent input lock
watch(connectionLost, (lost) => {
  if (lost && isBusy.value) {
    isBusy.value = false;
    status('⚠️ Connection lost — input unlocked');
  }
});

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\\x1b\[[0-9;]*m/g, '');
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function status(content) {
  messages.value.push({ role: 'status', content, time: Date.now() });
  scrollToBottom();
}

// Track completed tasks to show incremental progress
const completedTasks = ref(new Set());

// ── Initial build events ──

on('plan:created', (payload) => {
  if (payload.append) {
    // Iteration: new tasks appended
    const taskCount = payload.tasks.filter(t => t.type !== 'prompt').length;
    status(`📋 Executing ${taskCount} new task${taskCount !== 1 ? 's' : ''}...`);
  } else {
    // Initial build
    isBusy.value = true;
    completedTasks.value.clear();
    const taskCount = payload.tasks.length;
    status(`📋 Plan created — ${taskCount} task${taskCount !== 1 ? 's' : ''}`);
  }
});

on('agent:status', (payload) => {
  const label = payload.taskLabel || tasks.value.find(t => t.id === payload.taskId)?.label || payload.taskId;

  if (payload.status === 'running') {
    // Agent assigned to task
    if (payload.retries === 0) {
      status(`🐝 "${label}" → ${payload.model} (${payload.modelTier})`);
    } else {
      status(`↻ "${label}" retry #${payload.retries} → ${payload.model} (${payload.modelTier}, ${payload.multiplier}×)`);
    }
  } else if (payload.status === 'success' && !completedTasks.value.has(payload.taskId)) {
    completedTasks.value.add(payload.taskId);
    status(`✅ "${label}" done (${payload.model})`);
  } else if (payload.status === 'failed') {
    status(`❌ "${label}" failed on ${payload.model} — will retry`);
  }
});

on('session:complete', (payload) => {
  isBusy.value = false;
  const cost = payload.costSummary?.totalPremiumRequests || 0;
  const ss = payload.swarmStats;
  if (ss) {
    const parts = [`🏁 Build complete — ${cost}× premium, ${ss.totalTasks} tasks`];
    if (ss.totalWaves > 1) parts.push(`${ss.totalWaves} waves`);
    if (ss.peakConcurrency > 1) parts.push(`peak ${ss.peakConcurrency} concurrent`);
    if (ss.speculativeLaunches > 0) parts.push(`${ss.speculativeLaunches} speculative`);
    if (ss.taskSplits > 0) parts.push(`${ss.taskSplits} splits`);
    if (ss.dagRewrites > 0) parts.push(`${ss.dagRewrites} rewrites`);
    status(parts.join(' · '));
  } else {
    status(`🏁 Build complete — ${cost}× premium requests`);
  }
});

on('session:error', (payload) => {
  isBusy.value = false;
  status(`❌ Session error: ${payload.error}`);
});

// ── Swarm events ──

on('swarm:wave', (payload) => {
  const { currentWave, totalWaves, totalRunning, totalSpeculative } = payload;
  const running = totalRunning || payload.waveStats?.running || 0;
  const spec = totalSpeculative || payload.waveStats?.speculative || 0;
  const parts = [`🌊 Wave ${currentWave + 1}/${totalWaves}`];
  if (running > 0) parts.push(`${running} agents swarming`);
  if (spec > 0) parts.push(`${spec} speculative`);
  if (payload.peakConcurrency > 1) parts.push(`peak ${payload.peakConcurrency}×`);
  status(parts.join(' — '));
});

on('swarm:scaling', (payload) => {
  status(`⚡ ${payload.reason}`);
});

on('task:split', (payload) => {
  const subs = payload.subtasks.map(s => s.label).join(', ');
  status(`🔀 "${payload.originalLabel}" → split into ${payload.subtasks.length} sub-tasks: ${subs}`);
});

on('task:speculative', (payload) => {
  const pending = payload.pendingDeps?.length || 0;
  status(`🔮 "${payload.label}" started speculatively (${pending} dep${pending !== 1 ? 's' : ''} still running)`);
});

// ── Verification events ──

on('verify:status', (payload) => {
  if (payload.status === 'running') {
    status(`🔍 ${payload.message}`);
  } else if (payload.status === 'passed') {
    status(`✅ ${payload.message}`);
  } else if (payload.status === 'fixing') {
    status(`🔧 ${payload.message}`);
    if (payload.issues) {
      for (const issue of payload.issues) {
        status(`  ⚠️ ${issue}`);
      }
    }
  } else if (payload.status === 'warning') {
    status(`⚠️ ${payload.message}`);
  }
});

on('selfdev:diff', (payload) => {
  status(`📊 Self-dev diff:\n${payload.diffSummary}`);
});

// ── Iteration events (chat-triggered) ──

on('iteration:start', (payload) => {
  isBusy.value = true;
  status(`🔧 Decomposing request...`);
});

on('iteration:complete', (payload) => {
  isBusy.value = false;
  if (payload.error) {
    status(`❌ Error: ${payload.error}`);
  } else {
    status(`✅ Done — ${payload.costSummary?.totalPremiumRequests || 0}× premium requests`);
  }
});

// Fallback for error messages sent via chat:response
on('chat:response', (payload) => {
  if (payload.role === 'assistant' && payload.content && !payload.streaming && !payload.done) {
    messages.value.push({
      role: 'assistant',
      content: stripAnsi(payload.content),
      time: Date.now(),
    });
    scrollToBottom();
  }
});

function sendMessage() {
  const text = input.value.trim();
  if (!text || isBusy.value || sessionStatus.value !== 'completed') return;
  if (!activeProject.value) return;

  // Set busy immediately to prevent double-submit before server acks
  isBusy.value = true;

  messages.value.push({ role: 'user', content: text, time: Date.now() });
  send('chat:message', {
    message: text,
    projectSlug: activeProject.value.slug,
  });

  input.value = '';
  scrollToBottom();
}

async function scrollToBottom() {
  await nextTick();
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
  }
}

onMounted(() => {
  inputRef.value?.focus();
});
</script>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-primary);
}

.chat-header h3 {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.streaming-dot {
  font-size: 11px;
  color: #f5c542;
  animation: blink 1s ease-in-out infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* ── Message list ── */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chat-empty {
  color: var(--text-tertiary);
  font-size: 13px;
  line-height: 1.6;
  padding: 20px 8px;
  text-align: center;
}

/* ── Row alignment ── */
.chat-row {
  display: flex;
  width: 100%;
}

.chat-row-user {
  justify-content: flex-start;
}

.chat-row-assistant {
  justify-content: flex-end;
}

/* ── Bubbles ── */
.bubble {
  max-width: 85%;
  padding: 10px 14px 6px;
  border-radius: 16px;
  position: relative;
}

.bubble-user {
  background: #111a2e;
  border: 1px solid #1a2a4a;
  border-bottom-left-radius: 4px;
  color: #d0daf0;
}

.bubble-assistant {
  background: var(--bg-secondary);
  border: 1px solid var(--bg-card);
  border-bottom-right-radius: 4px;
  color: #c0c0d0;
}

.bubble-text {
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.bubble-assistant .bubble-text {
  font-family: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
}

/* ── Timestamps ── */
.msg-time {
  display: block;
  font-size: 10px;
  color: var(--text-tertiary);
  margin-top: 4px;
  text-align: right;
}

.bubble-user .msg-time {
  text-align: left;
}

/* ── Status bubbles (compact orchestrator updates) ── */
.bubble-status {
  background: var(--bg-tertiary);
  border-color: var(--bg-card);
  padding: 6px 12px 4px;
}

.bubble-status .bubble-text {
  font-size: 11px;
  color: var(--text-muted);
}

/* ── Input row ── */
.chat-input-row {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-primary);
  background: var(--bg-secondary);
}

.chat-input-row textarea {
  flex: 1;
  background: var(--bg-secondary);
  border: 1px solid var(--bg-card);
  border-radius: 20px;
  color: var(--text-primary);
  padding: 10px 16px;
  font-size: 13px;
  font-family: inherit;
  resize: none;
  outline: none;
  line-height: 1.4;
  transition: border-color 0.2s;
}

.chat-input-row textarea:focus {
  border-color: #f5c54266;
}

.chat-input-row textarea::placeholder {
  color: var(--border-input);
}

.chat-input-row button {
  background: #f5c542;
  color: var(--bg-secondary);
  border: none;
  border-radius: 50%;
  width: 38px;
  height: 38px;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.2s;
  align-self: flex-end;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.chat-input-row button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.chat-input-row button:not(:disabled):hover {
  opacity: 0.8;
}
</style>
