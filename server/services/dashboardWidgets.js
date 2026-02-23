/**
 * Dashboard Widgets Service — Phase 12.8
 *
 * Composable dashboard with widget CRUD, layout management, and
 * data-source providers for cost, throughput, errors, sessions, and model usage.
 */

import { refs } from '../state.js';

// ─── Constants ──────────────────────────────────────────────────────────

export const WIDGET_TYPES = [
  'cost-graph', 'task-throughput', 'error-rate',
  'active-sessions', 'model-usage', 'custom-metric',
];

export const WIDGET_SIZES = ['small', 'medium', 'large'];

// ─── Helpers ────────────────────────────────────────────────────────────

function _genId(prefix = 'wdg') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function _getDashboard(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  return settings.dashboard || { widgets: [], layout: { columns: 3 } };
}

function _saveDashboard(slug, dashboard) {
  refs.workspace?.updateProjectSettings?.(slug, { dashboard });
}

// ─── Widget CRUD ────────────────────────────────────────────────────────

/**
 * Create a new dashboard widget.
 */
export function createWidget(slug, data = {}) {
  if (!data.title) throw new Error('title is required');
  if (!data.type) throw new Error('type is required');
  if (!WIDGET_TYPES.includes(data.type)) {
    throw new Error(`Invalid type: ${data.type}. Must be one of: ${WIDGET_TYPES.join(', ')}`);
  }

  const widget = {
    id: _genId(),
    title: data.title,
    type: data.type,
    size: WIDGET_SIZES.includes(data.size) ? data.size : 'medium',
    position: typeof data.position === 'number' ? data.position : -1,
    config: data.config || {},
    visible: data.visible !== false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const dashboard = _getDashboard(slug);
  if (widget.position === -1) widget.position = dashboard.widgets.length;
  dashboard.widgets.push(widget);
  _saveDashboard(slug, dashboard);
  return widget;
}

/**
 * List all widgets for a project dashboard.
 */
export function listWidgets(slug) {
  const dashboard = _getDashboard(slug);
  return dashboard.widgets.sort((a, b) => a.position - b.position);
}

/**
 * Get a single widget by ID.
 */
export function getWidget(slug, widgetId) {
  const dashboard = _getDashboard(slug);
  return dashboard.widgets.find(w => w.id === widgetId) || null;
}

/**
 * Update a widget.
 */
export function updateWidget(slug, widgetId, patch = {}) {
  const dashboard = _getDashboard(slug);
  const widget = dashboard.widgets.find(w => w.id === widgetId);
  if (!widget) return null;

  if (patch.title !== undefined) widget.title = patch.title;
  if (patch.size && WIDGET_SIZES.includes(patch.size)) widget.size = patch.size;
  if (typeof patch.position === 'number') widget.position = patch.position;
  if (patch.config !== undefined) widget.config = { ...widget.config, ...patch.config };
  if (typeof patch.visible === 'boolean') widget.visible = patch.visible;
  widget.updatedAt = Date.now();

  _saveDashboard(slug, dashboard);
  return widget;
}

/**
 * Delete a widget.
 */
export function deleteWidget(slug, widgetId) {
  const dashboard = _getDashboard(slug);
  const idx = dashboard.widgets.findIndex(w => w.id === widgetId);
  if (idx === -1) return null;
  const removed = dashboard.widgets.splice(idx, 1)[0];
  _saveDashboard(slug, dashboard);
  return removed;
}

// ─── Layout Management ─────────────────────────────────────────────────

/**
 * Get the current dashboard layout.
 */
export function getLayout(slug) {
  const dashboard = _getDashboard(slug);
  return {
    columns: dashboard.layout?.columns || 3,
    widgets: dashboard.widgets.sort((a, b) => a.position - b.position).map(w => ({
      id: w.id,
      title: w.title,
      type: w.type,
      size: w.size,
      position: w.position,
      visible: w.visible,
    })),
  };
}

/**
 * Update layout (columns, reorder widgets).
 */
export function updateLayout(slug, layoutPatch = {}) {
  const dashboard = _getDashboard(slug);

  if (typeof layoutPatch.columns === 'number' && layoutPatch.columns >= 1 && layoutPatch.columns <= 6) {
    dashboard.layout = dashboard.layout || {};
    dashboard.layout.columns = layoutPatch.columns;
  }

  // Reorder by widgetIds array
  if (Array.isArray(layoutPatch.order)) {
    for (let i = 0; i < layoutPatch.order.length; i++) {
      const w = dashboard.widgets.find(ww => ww.id === layoutPatch.order[i]);
      if (w) w.position = i;
    }
  }

  _saveDashboard(slug, dashboard);
  return getLayout(slug);
}

// ─── Data Providers ─────────────────────────────────────────────────────

/**
 * Get widget data based on type. Returns mock/aggregated data
 * derived from project settings for each widget type.
 */
export function getWidgetData(slug, widgetId) {
  const dashboard = _getDashboard(slug);
  const widget = dashboard.widgets.find(w => w.id === widgetId);
  if (!widget) return null;

  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const sessions = refs.workspace?.listSessions?.(slug) || [];

  switch (widget.type) {
    case 'cost-graph':
      return _costGraphData(settings, sessions);
    case 'task-throughput':
      return _taskThroughputData(settings, sessions);
    case 'error-rate':
      return _errorRateData(settings, sessions);
    case 'active-sessions':
      return _activeSessionsData(sessions);
    case 'model-usage':
      return _modelUsageData(settings, sessions);
    case 'custom-metric':
      return _customMetricData(settings, widget.config);
    default:
      return { message: 'Unknown widget type' };
  }
}

function _costGraphData(settings, sessions) {
  const points = sessions.slice(-20).map(s => ({
    sessionId: s.id,
    cost: s.cost || 0,
    timestamp: s.createdAt || s.startedAt || 0,
  }));
  const totalCost = points.reduce((sum, p) => sum + p.cost, 0);
  return { type: 'cost-graph', points, totalCost, count: points.length };
}

function _taskThroughputData(settings, sessions) {
  const points = sessions.slice(-20).map(s => ({
    sessionId: s.id,
    tasks: s.taskCount || (s.tasks || []).length || 0,
    timestamp: s.createdAt || s.startedAt || 0,
  }));
  const totalTasks = points.reduce((sum, p) => sum + p.tasks, 0);
  return { type: 'task-throughput', points, totalTasks, count: points.length };
}

function _errorRateData(settings, sessions) {
  const points = sessions.slice(-20).map(s => ({
    sessionId: s.id,
    errors: s.errorCount || (s.errors || []).length || 0,
    timestamp: s.createdAt || s.startedAt || 0,
  }));
  const totalErrors = points.reduce((sum, p) => sum + p.errors, 0);
  const rate = points.length ? totalErrors / points.length : 0;
  return { type: 'error-rate', points, totalErrors, rate: Math.round(rate * 100) / 100, count: points.length };
}

function _activeSessionsData(sessions) {
  const active = sessions.filter(s => s.status === 'running' || s.status === 'active');
  return { type: 'active-sessions', active: active.length, total: sessions.length };
}

function _modelUsageData(settings, sessions) {
  const usage = {};
  for (const s of sessions) {
    const model = s.model || s.modelTier || 'unknown';
    usage[model] = (usage[model] || 0) + 1;
  }
  return { type: 'model-usage', breakdown: usage, total: sessions.length };
}

function _customMetricData(settings, config) {
  const metrics = settings.performanceMetrics || [];
  const metricName = config?.metricName || 'custom';
  const matching = metrics.filter(m => m.name === metricName || m.operation === metricName);
  return {
    type: 'custom-metric',
    metricName,
    count: matching.length,
    values: matching.slice(-20).map(m => m.duration || m.value || 0),
  };
}

// ─── Dashboard Stats ────────────────────────────────────────────────────

/**
 * Get dashboard stats.
 */
export function getDashboardStats(slug) {
  const dashboard = _getDashboard(slug);
  const byType = {};
  const bySize = {};
  for (const w of dashboard.widgets) {
    byType[w.type] = (byType[w.type] || 0) + 1;
    bySize[w.size] = (bySize[w.size] || 0) + 1;
  }
  return {
    totalWidgets: dashboard.widgets.length,
    visible: dashboard.widgets.filter(w => w.visible).length,
    hidden: dashboard.widgets.filter(w => !w.visible).length,
    columns: dashboard.layout?.columns || 3,
    byType,
    bySize,
  };
}
