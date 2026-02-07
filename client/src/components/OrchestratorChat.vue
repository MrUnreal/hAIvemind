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

const { on, send } = useWebSocket();

const messages = ref([]);
const input = ref('');
const isBusy = ref(false);
const messagesRef = ref(null);
const inputRef = ref(null);

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
  // Show escalation reasons
  if (payload.reason) {
    status(`⚡ ${payload.reason}`);
  }
  // Show task completion
  if (payload.status === 'success' && !completedTasks.value.has(payload.taskId)) {
    completedTasks.value.add(payload.taskId);
    const task = tasks.value.find(t => t.id === payload.taskId);
    status(`✅ "${task?.label || payload.taskId}" done (${payload.model})`);
  }
});

on('session:complete', (payload) => {
  isBusy.value = false;
  const cost = payload.costSummary?.totalPremiumRequests || 0;
  status(`🏁 Build complete — ${cost}× premium requests`);
});

on('session:error', (payload) => {
  isBusy.value = false;
  status(`❌ Session error: ${payload.error}`);
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
  background: #0d0d14;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid #1a1a2e;
  background: #111118;
}

.chat-header h3 {
  font-size: 15px;
  font-weight: 600;
  color: #e0e0e0;
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
  color: #555;
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
  background: #1a2a4a;
  border: 1px solid #2a3a5a;
  border-bottom-left-radius: 4px;
  color: #e0e8f0;
}

.bubble-assistant {
  background: #1a1a2e;
  border: 1px solid #2a2a3e;
  border-bottom-right-radius: 4px;
  color: #d0d0e0;
}

.bubble-text {
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.bubble-assistant .bubble-text {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
}

/* ── Timestamps ── */
.msg-time {
  display: block;
  font-size: 10px;
  color: #555;
  margin-top: 4px;
  text-align: right;
}

.bubble-user .msg-time {
  text-align: left;
}

/* ── Status bubbles (compact orchestrator updates) ── */
.bubble-status {
  background: #13131a;
  border-color: #1e1e2e;
  padding: 6px 12px 4px;
}

.bubble-status .bubble-text {
  font-size: 11px;
  color: #888;
}

/* ── Input row ── */
.chat-input-row {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #1a1a2e;
  background: #111118;
}

.chat-input-row textarea {
  flex: 1;
  background: #16161e;
  border: 1px solid #2a2a3e;
  border-radius: 20px;
  color: #e0e0e0;
  padding: 10px 16px;
  font-size: 13px;
  font-family: inherit;
  resize: none;
  outline: none;
  line-height: 1.4;
}

.chat-input-row textarea:focus {
  border-color: #f5c542;
}

.chat-input-row textarea::placeholder {
  color: #444;
}

.chat-input-row button {
  background: #f5c542;
  color: #111;
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
