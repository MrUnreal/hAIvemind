<template>
  <div class="detail-container">
    <div class="detail-header">
      <h3>{{ agent?.model || 'Agent' }}</h3>
      <button class="close-btn" @click="selectedAgentId = null">✕</button>
    </div>

    <div v-if="agent" class="detail-info">
      <div class="info-row">
        <span class="info-label">Task</span>
        <span>{{ taskLabel }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Status</span>
        <span :class="['status-badge', `status-${agent.status}`]">{{ agent.status }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Tier</span>
        <span :class="['tier-badge', (agent.modelTier || 'T0').toLowerCase()]">{{ agent.modelTier }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Cost</span>
        <span class="cost">{{ agent.multiplier }}× premium request</span>
      </div>
      <div class="info-row">
        <span class="info-label">Retries</span>
        <span>{{ agent.retries }}</span>
      </div>
      <div v-if="agent.reason" class="reason-row">
        <span class="info-label">Decision</span>
        <span class="reason-text">{{ agent.reason }}</span>
      </div>
    </div>

    <div class="console-header">
      <span>Console Output</span>
      <div class="console-controls">
        <input
          v-model="searchQuery"
          class="search-input"
          placeholder="Search output..."
          @input="highlightMatches"
        />
        <button class="toggle-btn" :class="{ active: showSummary }" @click="showSummary = !showSummary">
          {{ showSummary ? '📋 Summary' : '📜 Raw' }}
        </button>
        <span class="live-dot" v-if="agent?.status === 'running'">● LIVE</span>
      </div>
    </div>

    <div class="console" ref="consoleRef">
      <pre v-if="displayOutput" v-html="displayOutput"></pre>
      <div v-else class="console-empty">
        {{ agent?.status === 'running' ? 'Waiting for output...' : 'No output yet' }}
      </div>
      <div v-if="searchQuery && matchCount >= 0" class="search-results">
        {{ matchCount }} match{{ matchCount !== 1 ? 'es' : '' }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, nextTick } from 'vue';
import {
  selectedAgentId,
  agentMap,
  agentOutputMap,
  tasks,
} from '../composables/useSession.js';

const consoleRef = ref(null);
const searchQuery = ref('');
const showSummary = ref(false);
const matchCount = ref(-1);

const agent = computed(() => {
  if (!selectedAgentId.value) return null;
  return agentMap.get(selectedAgentId.value) || null;
});

const output = computed(() => {
  if (!selectedAgentId.value) return [];
  return agentOutputMap.get(selectedAgentId.value) || [];
});

/** Strip ANSI escape codes from text */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\\x1b\[[0-9;]*m/g, '');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Join all output chunks and strip ANSI codes */
const cleanOutput = computed(() => {
  const chunks = output.value;
  if (!chunks || chunks.length === 0) return '';
  return stripAnsi(chunks.join(''));
});

/** Summary view — extract key lines (files changed, errors, warnings) */
const summaryOutput = computed(() => {
  if (!cleanOutput.value) return '';
  const lines = cleanOutput.value.split('\n');
  const important = lines.filter(line => {
    const l = line.trim().toLowerCase();
    return l.includes('error') || l.includes('warning') || l.includes('created') ||
           l.includes('modified') || l.includes('deleted') || l.includes('file') ||
           l.includes('test') || l.includes('passed') || l.includes('failed') ||
           l.startsWith('+') || l.startsWith('-') || l.startsWith('diff ');
  });
  return important.length > 0 ? important.join('\n') : '(no notable lines detected)';
});

/** Display output — applies search highlighting and summary toggle */
const displayOutput = computed(() => {
  const text = showSummary.value ? summaryOutput.value : cleanOutput.value;
  if (!text) return '';
  const escaped = escapeHtml(text);
  if (!searchQuery.value) return escaped;
  try {
    const regex = new RegExp(`(${searchQuery.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escaped.replace(regex, '<mark class="search-highlight">$1</mark>');
  } catch {
    return escaped;
  }
});

function highlightMatches() {
  if (!searchQuery.value || !cleanOutput.value) { matchCount.value = -1; return; }
  try {
    const regex = new RegExp(searchQuery.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = cleanOutput.value.match(regex);
    matchCount.value = matches ? matches.length : 0;
  } catch {
    matchCount.value = 0;
  }
}

const taskLabel = computed(() => {
  if (!agent.value) return '';
  const task = tasks.value.find(t => t.id === agent.value.taskId);
  return task?.label || agent.value.taskId;
});

// Auto-scroll console
watch(cleanOutput, async () => {
  await nextTick();
  if (consoleRef.value) {
    consoleRef.value.scrollTop = consoleRef.value.scrollHeight;
  }
});
</script>

<style scoped>
.detail-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #111118;
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid #222;
}

.detail-header h3 {
  font-size: 15px;
  font-weight: 600;
  color: #e0e0e0;
}

.close-btn {
  background: none;
  border: none;
  color: #666;
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
.close-btn:hover {
  background: #222;
  color: #e0e0e0;
}

.detail-info {
  padding: 12px 20px;
  border-bottom: 1px solid #222;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 13px;
}

.info-label {
  color: #666;
}

.status-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}
.status-running { background: #1a2a3a; color: #4a9eff; }
.status-success { background: #1a3a1a; color: #4caf50; }
.status-failed { background: #3a1a1a; color: #f44336; }
.status-blocked { background: #3a2a1a; color: #ff9800; }

.tier-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}
.tier-badge.t0 { background: #1a3a1a; color: #6ecf6e; }
.tier-badge.t1 { background: #2a2a1a; color: #c5c56a; }
.tier-badge.t2 { background: #1a2a3a; color: #6aacf5; }
.tier-badge.t3 { background: #2a1a3a; color: #b56af5; }
.tier-badge.t4 { background: #3a1a1a; color: #f56a6a; }

.cost {
  color: #f5c542;
}

.reason-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 0;
  font-size: 13px;
}

.reason-text {
  color: #b0b0d0;
  font-size: 12px;
  line-height: 1.4;
  background: #1a1a2e;
  border: 1px solid #2a2a3e;
  border-radius: 6px;
  padding: 6px 10px;
}

.console-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 20px;
  font-size: 12px;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid #222;
}

.console-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-input {
  padding: 4px 8px;
  background: #0a0a0f;
  border: 1px solid #333;
  border-radius: 4px;
  color: #c0c0c0;
  font-size: 11px;
  width: 140px;
  outline: none;
}
.search-input:focus {
  border-color: #f5c542;
}

.toggle-btn {
  padding: 3px 8px;
  background: #1a1a22;
  border: 1px solid #333;
  border-radius: 4px;
  color: #888;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}
.toggle-btn:hover { border-color: #555; }
.toggle-btn.active { border-color: #f5c542; color: #f5c542; }

.live-dot {
  color: #4caf50;
  font-size: 11px;
  animation: blink 1s ease-in-out infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.console {
  flex: 1;
  overflow-y: auto;
  padding: 12px 20px;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.6;
  background: #0a0a0f;
}

.console pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  color: #c0c0c0;
}

.console pre :deep(.search-highlight) {
  background: #f5c54244;
  color: #f5c542;
  border-radius: 2px;
  padding: 0 1px;
}

.console-empty {
  color: #444;
  font-style: italic;
}

.search-results {
  position: sticky;
  bottom: 0;
  padding: 4px 12px;
  background: #1a1a22;
  border-top: 1px solid #333;
  font-size: 11px;
  color: #888;
}
</style>
