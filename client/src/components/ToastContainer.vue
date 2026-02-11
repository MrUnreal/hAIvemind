<template>
  <Teleport to="body">
    <TransitionGroup name="toast" tag="div" class="toast-container">
      <div
        v-for="t in toasts"
        :key="t.id"
        :class="['toast', `toast-${t.type}`]"
        @click="dismissToast(t.id)"
      >
        <span class="toast-icon">{{ icons[t.type] }}</span>
        <span class="toast-message">{{ t.message }}</span>
        <button class="toast-close" @click.stop="dismissToast(t.id)">×</button>
      </div>
    </TransitionGroup>
  </Teleport>
</template>

<script setup>
import { toasts, dismissToast } from '../composables/useToast.js';

const icons = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
};
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 60px;
  right: 20px;
  z-index: 9998;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 12px;
  min-width: 280px;
  max-width: 420px;
  backdrop-filter: blur(12px);
  border: 1px solid;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.toast-success {
  background: rgba(26, 58, 26, 0.92);
  border-color: #2a5a2a;
  color: #6ecf6e;
}

.toast-error {
  background: rgba(58, 26, 26, 0.92);
  border-color: #5a2a2a;
  color: #f56a6a;
}

.toast-warning {
  background: rgba(58, 50, 20, 0.92);
  border-color: #5a4a1a;
  color: #f5c542;
}

.toast-info {
  background: rgba(20, 30, 50, 0.92);
  border-color: #1a2a4a;
  color: #6aacf5;
}

.toast-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.toast-message {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
}

.toast-close {
  background: none;
  border: none;
  color: inherit;
  font-size: 16px;
  cursor: pointer;
  padding: 0 2px;
  opacity: 0.5;
  transition: opacity 0.15s;
  flex-shrink: 0;
}
.toast-close:hover { opacity: 1; }

/* Transition animations */
.toast-enter-active {
  transition: all 0.3s ease-out;
}
.toast-leave-active {
  transition: all 0.2s ease-in;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(40px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(40px) scale(0.95);
}
.toast-move {
  transition: transform 0.3s ease;
}
</style>
