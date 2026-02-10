/**
 * WebSocket server setup — Phase 6.8
 */

import { WebSocketServer } from 'ws';
import { parseMsg } from '../../shared/protocol.js';
import { clients, refs } from '../state.js';
import { handleClientMessage } from './handlers.js';
import log from '../logger.js';

/**
 * Create and configure the WebSocket server.
 * @param {import('node:http').Server} server
 * @returns {{ wss: WebSocketServer, heartbeatInterval: NodeJS.Timer }}
 */
export function createWss(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  const heartbeatInterval = setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.subscribedProjects = new Set(); // Phase 6.7: Per-client project subscriptions
    log.info(`[ws] Client connected (${clients.size} total)`);

    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('close', () => {
      clients.delete(ws);
      log.info(`[ws] Client disconnected (${clients.size} total)`);
    });

    ws.on('message', (raw) => {
      const msg = parseMsg(raw.toString());
      if (!msg) return;
      handleClientMessage(msg, ws);
    });
  });

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return { wss, heartbeatInterval };
}
