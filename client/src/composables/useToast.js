import { ref } from 'vue';

/**
 * Toast notification stack.
 * Animated toast messages with auto-dismiss and manual close.
 */

let nextId = 1;

/** @type {import('vue').Ref<Array<{id: number, type: string, message: string, duration: number}>>} */
export const toasts = ref([]);

/**
 * Show a toast notification.
 * @param {string} message - Toast message
 * @param {'success'|'error'|'warning'|'info'} [type='info'] - Toast type
 * @param {number} [duration=4000] - Auto-dismiss in ms (0 = sticky)
 */
export function showToast(message, type = 'info', duration = 4000) {
  const id = nextId++;
  toasts.value.push({ id, type, message, duration });

  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
}

/**
 * Dismiss a toast by ID.
 */
export function dismissToast(id) {
  const idx = toasts.value.findIndex(t => t.id === id);
  if (idx !== -1) toasts.value.splice(idx, 1);
}

// Convenience methods
export const toast = {
  success: (msg, duration) => showToast(msg, 'success', duration),
  error: (msg, duration) => showToast(msg, 'error', duration ?? 6000),
  warning: (msg, duration) => showToast(msg, 'warning', duration ?? 5000),
  info: (msg, duration) => showToast(msg, 'info', duration),
};
