import { ref } from 'vue';

const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

const connected = ref(false);
const connectionLost = ref(false);
/** @type {WebSocket|null} */
let socket = null;
let reconnectDelay = 2000;
const handlers = new Map();
const pendingMessages = [];
let getActiveProject = null;
let initialized = false;

function connect() {
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    connected.value = true;
    connectionLost.value = false;
    reconnectDelay = 2000;

    if (pendingMessages.length) {
      for (const msg of pendingMessages) {
        socket.send(JSON.stringify(msg));
      }
      pendingMessages.length = 0;
    }

    if (typeof getActiveProject === 'function') {
      const projectSlug = getActiveProject();
      if (projectSlug) {
        socket.send(JSON.stringify({ type: 'reconnect:sync', payload: { projectSlug } }));
      }
    }

    console.log('[ws] Connected');
  };

  socket.onclose = () => {
    connected.value = false;
    connectionLost.value = true;
    console.log(`[ws] Disconnected, reconnecting in ${reconnectDelay / 1000}s...`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      const cbs = handlers.get(msg.type);
      if (cbs) {
        for (const cb of cbs) cb(msg.payload);
      }
    } catch (e) {
      console.warn('[ws] Bad message:', e);
    }
  };

  socket.onerror = (err) => {
    console.error('[ws] Error:', err);
  };
}

function on(type, handler) {
  if (!handlers.has(type)) handlers.set(type, []);
  handlers.get(type).push(handler);
}

function off(type, handler) {
  const cbs = handlers.get(type);
  if (!cbs) return;
  const filtered = cbs.filter((cb) => cb !== handler);
  if (filtered.length === 0) {
    handlers.delete(type);
  } else {
    handlers.set(type, filtered);
  }
}

function send(type, payload) {
  if (socket?.readyState !== WebSocket.OPEN) {
    console.warn('[ws] Cannot send, socket not open');
    if (pendingMessages.length >= 50) {
      pendingMessages.shift();
    }
    pendingMessages.push({ type, payload });
    return false;
  }
  socket.send(JSON.stringify({ type, payload }));
  return true;
}

export function useWebSocket(getActiveProjectFn) {
  if (typeof getActiveProjectFn === 'function') {
    getActiveProject = getActiveProjectFn;
  }
  if (!initialized) {
    initialized = true;
    connect();
  }
  return { connected, connectionLost, on, off, send };
}
