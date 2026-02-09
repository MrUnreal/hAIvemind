<template>
  <div class="session-replay">
    <div class="replay-header">
      <h3>🕒 Session Replay</h3>
      <div class="time-meta" v-if="hasTimeline">
        <span class="time-label">Start: {{ formatTimestamp(sessionStart) }}</span>
        <span class="time-label">End: {{ formatTimestamp(sessionEnd) }}</span>
      </div>
      <div v-else class="time-meta empty">No timeline data for this session.</div>
    </div>

    <div v-if="hasTimeline" class="slider-row">
      <span class="slider-time">{{ formatTimestamp(currentTime) }}</span>
      <input
        type="range"
        class="time-slider"
        :min="sessionStart"
        :max="sessionEnd"
        v-model.number="currentTime"
      />
    </div>

    <div v-if="hasTimeline" class="events-list">
      <div
        v-for="(event, idx) in filteredEvents"
        :key="idx"
        class="event-row"
      >
        <div class="event-time">{{ formatTimestamp(event.timestamp) }}</div>
        <div class="event-main">
          <span :class="['event-badge', badgeClass(event)]">
            {{ badgeLabel(event) }}
          </span>
          <span class="event-message">{{ eventMessage(event) }}</span>
        </div>
      </div>
      <div v-if="filteredEvents.length === 0" class="events-empty">
        Move the slider to scrub through the session timeline.
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  timeline: {
    type: Array,
    default: () => [],
  },
  sessionStart: {
    type: Number,
    required: true,
  },
  sessionEnd: {
    type: Number,
    required: true,
  },
});

const emit = defineEmits(['update:replayState']);

const currentTime = ref(props.sessionEnd || props.sessionStart || Date.now());

const hasTimeline = computed(() => Array.isArray(props.timeline) && props.timeline.length > 0);

watch(
  () => [props.sessionStart, props.sessionEnd],
  ([start, end]) => {
    if (!start && !end) return;
    if (currentTime.value < start || currentTime.value > end) {
      currentTime.value = end || start;
    }
  },
  { immediate: true },
);

const filteredEvents = computed(() => {
  if (!hasTimeline.value) return [];
  return props.timeline.filter((e) => typeof e.timestamp === 'number' && e.timestamp <= currentTime.value);
});

function buildReplayState() {
  const tasksById = new Map();
  const edgesById = new Map();
  const taskStatuses = new Map();
  const agentStatuses = new Map();

  for (const ev of filteredEvents.value) {
    const data = ev && typeof ev === 'object' ? ev.data || {} : {};
    const evType = ev?.type || '';

    if (Array.isArray(data.tasks)) {
      for (const task of data.tasks) {
        if (!task) continue;
        const id = task.id || task.taskId || JSON.stringify(task);
        tasksById.set(id, task);
      }
    }

    if (data.task) {
      const task = data.task;
      const id = task.id || task.taskId || JSON.stringify(task);
      tasksById.set(id, task);
    }

    // Capture task:status events — payload is { taskId, status, ... } directly in data
    if (evType === 'task:status' && data.taskId && data.status) {
      taskStatuses.set(data.taskId, data);
    }

    // Capture agent:status events — payload is { agentId, taskId, status, ... }
    if (evType === 'agent:status' && data.agentId) {
      agentStatuses.set(data.agentId, data);
    }

    if (Array.isArray(data.edges)) {
      for (const edge of data.edges) {
        if (!edge) continue;
        const id = edge.id || `${edge.source || ''}->${edge.target || ''}`;
        edgesById.set(id, edge);
      }
    }

    if (data.edge) {
      const edge = data.edge;
      const id = edge.id || `${edge.source || ''}->${edge.target || ''}`;
      edgesById.set(id, edge);
    }
  }

  return {
    currentTime: currentTime.value,
    filteredTasks: Array.from(tasksById.values()),
    filteredEdges: Array.from(edgesById.values()),
    taskStatuses: Object.fromEntries(taskStatuses),
    agentStatuses: Object.fromEntries(agentStatuses),
  };
}

watch(
  [filteredEvents, () => currentTime.value],
  () => {
    emit('update:replayState', buildReplayState());
  },
  { immediate: true },
);

function formatTimestamp(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return String(ts);
  }
}

function badgeClass(event) {
  const type = event?.type || 'event';
  if (type.startsWith('task')) return 'badge-task';
  if (type.startsWith('agent')) return 'badge-agent';
  if (type.startsWith('verify')) return 'badge-verify';
  if (type.startsWith('plan')) return 'badge-plan';
  if (type.startsWith('session')) return 'badge-session';
  return 'badge-generic';
}

function badgeLabel(event) {
  const type = event?.type || 'event';
  return type.replace(/[:_]/g, ' ');
}

function eventMessage(event) {
  const data = event && typeof event === 'object' ? event.data || {} : {};
  if (typeof data.message === 'string') return data.message;
  if (typeof data.status === 'string') return data.status;
  if (data.taskId) return `Task ${data.taskId}`;
  if (data.agentId) return `Agent ${data.agentId}`;
  try {
    const json = JSON.stringify(data);
    return json === '{}' ? '(no details)' : json;
  } catch {
    return '(no details)';
  }
}
</script>

<style scoped>
.session-replay {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0d0d14;
  border-top: 1px solid #1a1a2e;
}

.replay-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 16px;
  border-bottom: 1px solid #1a1a2e;
}

.replay-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #e0e0e0;
}

.time-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: #666;
}

.time-meta.empty {
  color: #555;
}

.time-label {
  white-space: nowrap;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #1a1a2e;
}

.slider-time {
  font-size: 11px;
  color: #aaa;
  min-width: 90px;
}

.time-slider {
  flex: 1;
}

.events-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.event-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 4px 6px;
  border-radius: 6px;
}

.event-row:nth-child(odd) {
  background: #111118;
}

.event-time {
  font-size: 11px;
  color: #555;
  min-width: 88px;
}

.event-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.event-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.event-badge.badge-task {
  background: #1a2a3a;
  color: #4a9eff;
}

.event-badge.badge-agent {
  background: #1a3a1a;
  color: #6ecf6e;
}

.event-badge.badge-verify {
  background: #3a2a1a;
  color: #ffb64c;
}

.event-badge.badge-plan {
  background: #2a1a3a;
  color: #b56af5;
}

.event-badge.badge-session {
  background: #3a1a1a;
  color: #f56a6a;
}

.event-badge.badge-generic {
  background: #1a1a2e;
  color: #aaa;
}

.event-message {
  font-size: 12px;
  color: #ccc;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}

.events-empty {
  margin-top: 12px;
  font-size: 12px;
  color: #555;
  text-align: center;
}
</style>
