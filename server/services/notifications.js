/**
 * Notification Service — Phase 9.2
 *
 * Persistent inbox for session completions, alerts, webhook failures,
 * and system events. Stored per-project via WorkspaceManager.
 */

import { refs } from '../state.js';

const MAX_NOTIFICATIONS = 200;

/**
 * Notification types
 * @typedef {'session_complete'|'session_failed'|'webhook_failure'|'alert'|'info'} NotificationType
 */

/**
 * @typedef {Object} Notification
 * @property {string} id
 * @property {NotificationType} type
 * @property {string} title
 * @property {string} message
 * @property {string} slug — project slug
 * @property {number} createdAt
 * @property {boolean} read
 * @property {Object} [meta] — extra data (sessionId, webhookId, etc.)
 */

/**
 * Load notifications for a project.
 * @param {string} slug
 * @returns {Notification[]}
 */
export function getNotifications(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug);
  return settings?.notifications ?? [];
}

/**
 * Add a notification.
 * @param {string} slug
 * @param {Omit<Notification, 'id'|'createdAt'|'read'>} data
 * @returns {Notification}
 */
export function addNotification(slug, data) {
  const notifications = getNotifications(slug);
  const notification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: data.type,
    title: data.title,
    message: data.message,
    slug,
    createdAt: Date.now(),
    read: false,
    meta: data.meta ?? {},
  };
  notifications.unshift(notification);
  // Cap at MAX_NOTIFICATIONS
  if (notifications.length > MAX_NOTIFICATIONS) {
    notifications.length = MAX_NOTIFICATIONS;
  }
  saveNotifications(slug, notifications);
  return notification;
}

/**
 * Mark a notification as read.
 * @param {string} slug
 * @param {string} notifId
 * @returns {boolean}
 */
export function markRead(slug, notifId) {
  const notifications = getNotifications(slug);
  const notif = notifications.find(n => n.id === notifId);
  if (!notif) return false;
  notif.read = true;
  saveNotifications(slug, notifications);
  return true;
}

/**
 * Mark all notifications as read.
 * @param {string} slug
 * @returns {number} count marked
 */
export function markAllRead(slug) {
  const notifications = getNotifications(slug);
  let count = 0;
  for (const n of notifications) {
    if (!n.read) { n.read = true; count++; }
  }
  if (count > 0) saveNotifications(slug, notifications);
  return count;
}

/**
 * Delete a notification.
 * @param {string} slug
 * @param {string} notifId
 * @returns {boolean}
 */
export function deleteNotification(slug, notifId) {
  const notifications = getNotifications(slug);
  const idx = notifications.findIndex(n => n.id === notifId);
  if (idx === -1) return false;
  notifications.splice(idx, 1);
  saveNotifications(slug, notifications);
  return true;
}

/**
 * Clear all notifications for a project.
 * @param {string} slug
 * @returns {number} count cleared
 */
export function clearNotifications(slug) {
  const notifications = getNotifications(slug);
  const count = notifications.length;
  saveNotifications(slug, []);
  return count;
}

/**
 * Get unread count for a project.
 * @param {string} slug
 * @returns {number}
 */
export function getUnreadCount(slug) {
  return getNotifications(slug).filter(n => !n.read).length;
}

/**
 * Persist notifications to project settings.
 * @param {string} slug
 * @param {Notification[]} notifications
 */
function saveNotifications(slug, notifications) {
  refs.workspace?.updateProjectSettings?.(slug, { notifications });
}
