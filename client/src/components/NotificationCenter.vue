<template>
  <div v-if="visible" class="notification-panel">
    <div class="notif-header">
      <h3 class="notif-title">🔔 Notifications</h3>
      <div class="notif-actions">
        <button v-if="unreadCount > 0" class="notif-action-btn" @click="onMarkAllRead" title="Mark all read">
          ✓ Read all
        </button>
        <button v-if="notifications.length > 0" class="notif-action-btn danger" @click="onClearAll" title="Clear all">
          🗑️ Clear
        </button>
        <button class="notif-close-btn" @click="$emit('close')">✕</button>
      </div>
    </div>

    <div v-if="loading" class="notif-loading">Loading…</div>

    <div v-else-if="notifications.length === 0" class="notif-empty">
      <span class="notif-empty-icon">📭</span>
      <span>No notifications yet</span>
    </div>

    <div v-else class="notif-list">
      <div
        v-for="n in notifications"
        :key="n.id"
        :class="['notif-item', { unread: !n.read }, n.type]"
        @click="onClickNotif(n)"
      >
        <span class="notif-type-icon">{{ typeIcon(n.type) }}</span>
        <div class="notif-body">
          <span class="notif-item-title">{{ n.title }}</span>
          <span class="notif-message">{{ n.message }}</span>
          <span class="notif-time">{{ timeAgo(n.createdAt) }}</span>
        </div>
        <button class="notif-delete-btn" @click.stop="onDelete(n.id)" title="Delete">✕</button>
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

const emit = defineEmits(['close']);

const notifications = ref([]);
const unreadCount = ref(0);
const loading = ref(false);

watch(() => [props.visible, props.projectSlug], async ([vis, slug]) => {
  if (vis && slug) await fetchNotifications();
}, { immediate: true });

async function fetchNotifications() {
  if (!props.projectSlug) return;
  loading.value = true;
  try {
    const res = await fetch(`/api/projects/${props.projectSlug}/notifications`);
    if (res.ok) {
      const data = await res.json();
      notifications.value = data.notifications;
      unreadCount.value = data.unread;
    }
  } catch { /* ignore */ }
  loading.value = false;
}

async function onMarkAllRead() {
  await fetch(`/api/projects/${props.projectSlug}/notifications/read-all`, { method: 'POST' });
  await fetchNotifications();
}

async function onClearAll() {
  await fetch(`/api/projects/${props.projectSlug}/notifications`, { method: 'DELETE' });
  notifications.value = [];
  unreadCount.value = 0;
}

async function onClickNotif(n) {
  if (!n.read) {
    await fetch(`/api/projects/${props.projectSlug}/notifications/${n.id}/read`, { method: 'PATCH' });
    n.read = true;
    unreadCount.value = Math.max(0, unreadCount.value - 1);
  }
}

async function onDelete(id) {
  await fetch(`/api/projects/${props.projectSlug}/notifications/${id}`, { method: 'DELETE' });
  notifications.value = notifications.value.filter(n => n.id !== id);
}

function typeIcon(type) {
  const icons = {
    session_complete: '✅',
    session_failed: '❌',
    webhook_failure: '🔗',
    alert: '⚠️',
    info: 'ℹ️',
  };
  return icons[type] || '📌';
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
</script>

<style scoped>
.notification-panel {
  position: absolute;
  right: 16px;
  top: 52px;
  width: 380px;
  max-height: 480px;
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  z-index: 60;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.notif-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-secondary);
}

.notif-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.notif-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.notif-action-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
.notif-action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.notif-action-btn.danger:hover {
  color: var(--status-error);
}

.notif-close-btn {
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  font-size: 14px;
  cursor: pointer;
  padding: 2px 6px;
}
.notif-close-btn:hover {
  color: var(--text-primary);
}

.notif-loading, .notif-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: var(--text-tertiary);
  gap: 8px;
}

.notif-empty-icon {
  font-size: 28px;
}

.notif-list {
  overflow-y: auto;
  max-height: 400px;
}

.notif-item {
  display: flex;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-secondary);
  cursor: pointer;
  transition: background 0.15s;
  align-items: flex-start;
}
.notif-item:hover {
  background: var(--bg-hover);
}
.notif-item.unread {
  background: var(--accent-blue-dim);
}
.notif-item.unread:hover {
  background: var(--bg-hover);
}

.notif-type-icon {
  font-size: 16px;
  flex-shrink: 0;
  margin-top: 2px;
}

.notif-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.notif-item-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.notif-message {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notif-time {
  font-size: 11px;
  color: var(--text-tertiary);
}

.notif-delete-btn {
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  opacity: 0;
  transition: opacity 0.15s;
}
.notif-item:hover .notif-delete-btn {
  opacity: 1;
}
.notif-delete-btn:hover {
  color: var(--status-error);
}
</style>
