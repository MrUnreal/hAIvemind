/**
 * useDashboard composable — Phase 9.3
 *
 * Provides live system metrics by polling /health/details
 * and aggregating real-time WS events.
 */

import { ref, onMounted, onUnmounted } from 'vue';

const POLL_INTERVAL = 5000;

export function useDashboard() {
  const health = ref(null);
  const loading = ref(true);
  const error = ref('');
  const agentActivity = ref([]);      // recent agent events
  const sessionEvents = ref([]);      // recent session lifecycle events
  let pollTimer = null;

  async function fetchHealth() {
    try {
      const res = await fetch('/api/health/details');
      if (res.ok) {
        health.value = await res.json();
        error.value = '';
      } else {
        error.value = `Health endpoint returned ${res.status}`;
      }
    } catch (e) {
      error.value = e.message;
    }
    loading.value = false;
  }

  function addAgentEvent(evt) {
    agentActivity.value.unshift({ ...evt, ts: Date.now() });
    if (agentActivity.value.length > 50) agentActivity.value.length = 50;
  }

  function addSessionEvent(evt) {
    sessionEvents.value.unshift({ ...evt, ts: Date.now() });
    if (sessionEvents.value.length > 30) sessionEvents.value.length = 30;
  }

  function startPolling() {
    fetchHealth();
    pollTimer = setInterval(fetchHealth, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  onMounted(startPolling);
  onUnmounted(stopPolling);

  return {
    health,
    loading,
    error,
    agentActivity,
    sessionEvents,
    addAgentEvent,
    addSessionEvent,
    fetchHealth,
    startPolling,
    stopPolling,
  };
}
