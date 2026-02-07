import { ref } from 'vue';

const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

const connected = ref(false);
/** @type {WebSocket|null} */
let socket = null;
const handlers = new Map();
let initialized = false;

function connect() {
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    connected.value = true;
    console.log('[ws] Connected');
  };

  socket.onclose = () => {
    connected.value = false;
    console.log('[ws] Disconnected, reconnecting in 2s...');
    setTimeout(connect, 2000);
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
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, payload }));
  }
}

export function useWebSocket() {
  if (!initialized) {
    initialized = true;
    connect();
  }
  return { connected, on, send };
}
