/**
 * WebSocket broadcast functions — Phase 6.8
 */

import { parseMsg, MSG } from '../../shared/protocol.js';
import { clients, sessions, taskToSession } from '../state.js';

/**
 * Record timeline events for a session.
 */
export function recordTimelineEvent(msgType, payload) {
  let sessionId;

  if (msgType === MSG.VERIFICATION_STATUS) {
    sessionId = payload?.sessionId;
  } else if (msgType === MSG.TASK_STATUS || msgType === MSG.AGENT_STATUS) {
    const taskId = payload?.taskId;
    if (!taskId) return;
    sessionId = taskToSession.get(taskId);
  }

  if (!sessionId) return;

  const session = sessions.get(sessionId);
  if (!session || !session.timeline) return;

  // Phase 5.0: Ring-buffer — cap timeline at 5000 events
  if (session.timeline.length >= 5000) {
    session.timeline.shift();
  }

  session.timeline.push({
    timestamp: Date.now(),
    type: msgType,
    data: payload || {},
  });
}

/**
 * Broadcast a message to connected clients with project-scoped filtering (Phase 6.7).
 */
export function broadcast(msg) {
  const parsed = parseMsg(msg);
  if (parsed && (parsed.type === MSG.TASK_STATUS || parsed.type === MSG.AGENT_STATUS || parsed.type === MSG.VERIFICATION_STATUS)) {
    recordTimelineEvent(parsed.type, parsed.payload);
  }

  // Phase 6.7: Scoped WS Channels — resolve project slug from message payload
  const slug = parsed?.payload?.projectSlug || parsed?.payload?.slug || null;

  // If no slug in payload, try to resolve from taskId/agentId/sessionId
  let resolvedSlug = slug;
  if (!resolvedSlug && parsed?.payload) {
    const { taskId, agentId, sessionId: sid } = parsed.payload;
    if (taskId) {
      const mappedSid = taskToSession.get(taskId);
      if (mappedSid) {
        const s = sessions.get(mappedSid);
        if (s) resolvedSlug = s.projectSlug;
      }
    }
    if (!resolvedSlug && sid) {
      const s = sessions.get(sid);
      if (s) resolvedSlug = s.projectSlug;
    }
  }

  for (const ws of clients) {
    if (ws.readyState !== ws.OPEN) continue;
    // If client has subscriptions and message has a project scope, filter
    if (resolvedSlug && ws.subscribedProjects?.size > 0 && !ws.subscribedProjects.has(resolvedSlug)) {
      continue;
    }
    ws.send(msg);
  }
}

/** Broadcast to all connected clients regardless of subscription (for global events). */
export function broadcastGlobal(msg) {
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}
