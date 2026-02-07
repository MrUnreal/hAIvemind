<template>
  <div class="session-history">
    <div class="history-header">
      <div>
        <h2>📁 {{ activeProject?.name }}</h2>
        <p class="subtitle">
          {{ sessions.length }} previous session{{ sessions.length !== 1 ? 's' : '' }}
        </p>
      </div>
      <button class="new-session-btn" @click="$emit('newSession')">
        + New Session
      </button>
    </div>

    <div v-if="sessionsLoading" class="loading">Loading sessions...</div>

    <div v-else-if="sessions.length === 0" class="empty">
      <p>No sessions yet. Start your first one!</p>
      <button class="new-session-btn" @click="$emit('newSession')">
        + Start Session
      </button>
    </div>

    <div v-else class="session-list">
      <div
        v-for="session in sortedSessions"
        :key="session.id"
        class="session-card"
        @click="onLoadSession(session.id)"
      >
        <div class="session-top">
          <span :class="['status-pill', `pill-${session.status}`]">
            {{ statusLabel(session.status) }}
          </span>
          <span class="session-time">{{ formatTime(session.startedAt) }}</span>
        </div>

        <div class="session-prompt">
          {{ truncate(session.prompt, 160) }}
        </div>

        <div class="session-meta">
          <span class="meta-item" v-if="session.taskCount">
            📋 {{ session.taskCount }} tasks
          </span>
          <span class="meta-item" v-if="session.agentCount">
            🤖 {{ session.agentCount }} agents
          </span>
          <span class="meta-item cost" v-if="session.totalCost > 0">
            💰 {{ session.totalCost.toFixed(1) }}× premium
          </span>
          <span class="meta-item cost free" v-else>
            💰 Free (T0 only)
          </span>
        </div>

        <!-- Quick task summary -->
        <div class="task-summary" v-if="session.taskSummary && session.taskSummary.length > 0">
          <div
            v-for="(task, i) in session.taskSummary.slice(0, 5)"
            :key="i"
            class="task-chip"
          >
            <span class="task-icon">{{ task.status === 'success' ? '✅' : task.status === 'failed' ? '❌' : '⬜' }}</span>
            {{ truncate(task.label, 40) }}
          </div>
          <span v-if="session.taskSummary.length > 5" class="more">
            +{{ session.taskSummary.length - 5 }} more
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import {
  activeProject,
  sessions,
  sessionsLoading,
} from '../composables/useProjects.js';
import { loadSession } from '../composables/useSession.js';

defineEmits(['newSession']);

const sortedSessions = computed(() => {
  return [...sessions.value].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
});

function statusLabel(status) {
  const labels = {
    completed: '✅ Completed',
    failed: '❌ Failed',
    running: '⏳ Running',
    planning: '🔄 Planning',
  };
  return labels[status] || status;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

function truncate(s, len) {
  if (!s) return '';
  return s.length > len ? s.slice(0, len) + '…' : s;
}

async function onLoadSession(sessionId) {
  if (!activeProject.value) return;
  await loadSession(activeProject.value.slug, sessionId);
}
</script>

<style scoped>
.session-history {
  display: flex;
  flex-direction: column;
  max-width: 800px;
  margin: 40px auto;
  padding: 0 24px;
  gap: 24px;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.history-header h2 {
  font-size: 20px;
  color: #e0e0e0;
  margin: 0;
}

.subtitle {
  color: #666;
  font-size: 13px;
  margin-top: 4px;
}

.new-session-btn {
  background: linear-gradient(135deg, #f5c542, #e6a817);
  color: #111;
  border: none;
  padding: 10px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}
.new-session-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(245, 197, 66, 0.3);
}

.loading {
  text-align: center;
  color: #666;
  padding: 40px;
}

.empty {
  text-align: center;
  color: #666;
  padding: 60px 0;
}
.empty p {
  margin-bottom: 16px;
}

.session-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.session-card {
  background: #16161e;
  border: 1px solid #2a2a3e;
  border-radius: 12px;
  padding: 16px 20px;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;
}
.session-card:hover {
  border-color: #f5c542;
  box-shadow: 0 2px 12px rgba(245, 197, 66, 0.1);
  transform: translateY(-1px);
}

.session-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.status-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 12px;
}
.pill-completed { background: #1a3a1a; color: #6ecf6e; }
.pill-failed { background: #3a1a1a; color: #f56a6a; }
.pill-running { background: #1a2a3a; color: #4a9eff; }
.pill-planning { background: #2a2a1a; color: #c5c56a; }

.session-time {
  font-size: 12px;
  color: #555;
}

.session-prompt {
  font-size: 14px;
  color: #c0c0c0;
  line-height: 1.5;
  margin-bottom: 12px;
}

.session-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.meta-item {
  font-size: 12px;
  color: #888;
}
.meta-item.cost {
  color: #f5c542;
}
.meta-item.cost.free {
  color: #6ecf6e;
}

.task-summary {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}

.task-chip {
  font-size: 11px;
  color: #aaa;
  background: #1a1a2e;
  border: 1px solid #2a2a3e;
  padding: 3px 8px;
  border-radius: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.task-icon {
  font-size: 10px;
  margin-right: 3px;
}

.more {
  font-size: 11px;
  color: #666;
}
</style>
