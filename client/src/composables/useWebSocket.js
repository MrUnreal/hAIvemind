import { ref } from 'vue';

const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

const connected = ref(false);
const connectionLost = ref(false);
/** @type {WebSocket|null} */
let socket = null;
let reconnectDelay = 2000;
const handlers = new Map();
let initialized = false;

function connect() {
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    connected.value = true;
    connectionLost.value = false;
    reconnectDelay = 2000;
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

function send(type, payload) {
  if (socket?.readyState !== WebSocket.OPEN) {
    console.warn('[ws] Cannot send, socket not open');
    return false;
  }
  socket.send(JSON.stringify({ type, payload }));
  return true;
}

export function useWebSocket() {
  if (!initialized) {
    initialized = true;
    connect();
  }
  return { connected, connectionLost, on, send };
}
