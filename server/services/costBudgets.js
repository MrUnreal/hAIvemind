/**
 * server/services/costBudgets.js — Per-Project Cost Budgets
 *
 * Features:
 *   - Hard limit (blocks sessions) + soft limit (warns)
 *   - Budget periods: daily, weekly, monthly, total
 *   - Spend tracking per period
 *   - Budget alerts when thresholds crossed
 *   - Simple spend forecasting based on historical rate
 */

import { refs } from '../state.js';

// ─── Constants ──────────────────────────────────────────────────────────

export const BUDGET_PERIODS = ['daily', 'weekly', 'monthly', 'total'];
const MAX_ALERTS = 200;

// ─── Budget CRUD ────────────────────────────────────────────────────────

/**
 * Get the budget config for a project.
 */
export function getBudget(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  return settings.costBudget || _defaultBudget();
}

function _defaultBudget() {
  return {
    period: 'monthly',
    softLimit: null,    // warn at this cost
    hardLimit: null,    // block at this cost
    currency: 'requests', // 'requests' (premium API calls) or 'usd'
    alertsEnabled: true,
    createdAt: null,
    updatedAt: null,
  };
}

/**
 * Set the budget for a project.
 */
export function setBudget(slug, budget) {
  if (budget.period && !BUDGET_PERIODS.includes(budget.period)) {
    throw new Error(`Invalid period: ${budget.period}. Valid: ${BUDGET_PERIODS.join(', ')}`);
  }
  if (budget.softLimit !== undefined && budget.softLimit !== null && typeof budget.softLimit !== 'number') {
    throw new Error('softLimit must be a number or null');
  }
  if (budget.hardLimit !== undefined && budget.hardLimit !== null && typeof budget.hardLimit !== 'number') {
    throw new Error('hardLimit must be a number or null');
  }

  const existing = getBudget(slug);
  const updated = {
    ...existing,
    ...budget,
    updatedAt: Date.now(),
    createdAt: existing.createdAt || Date.now(),
  };

  refs.workspace?.updateProjectSettings?.(slug, { costBudget: updated });
  return updated;
}

/**
 * Clear (reset) the budget.
 */
export function clearBudget(slug) {
  refs.workspace?.updateProjectSettings?.(slug, { costBudget: _defaultBudget() });
  return { ok: true };
}

// ─── Spend Tracking ─────────────────────────────────────────────────────

/**
 * Record a cost entry (called after session completes).
 */
export function recordSpend(slug, entry) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const log = settings.costSpendLog || [];

  log.push({
    amount: entry.amount || 0,
    currency: entry.currency || 'requests',
    sessionId: entry.sessionId || null,
    description: entry.description || '',
    timestamp: Date.now(),
  });

  // Keep log reasonable
  const trimmed = log.slice(-1000);
  refs.workspace?.updateProjectSettings?.(slug, { costSpendLog: trimmed });

  // Check budget and generate alerts
  _checkBudgetAlerts(slug);

  return log[log.length - 1];
}

/**
 * Get spend history with optional filtering.
 */
export function getSpendLog(slug, opts = {}) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  let log = settings.costSpendLog || [];

  if (opts.since) {
    log = log.filter(e => e.timestamp >= opts.since);
  }
  if (opts.limit) {
    log = log.slice(-opts.limit);
  }

  return log;
}

/**
 * Clear spend log.
 */
export function clearSpendLog(slug) {
  refs.workspace?.updateProjectSettings?.(slug, { costSpendLog: [] });
  return { ok: true };
}

/**
 * Get current spend for the active budget period.
 */
export function getCurrentSpend(slug) {
  const budget = getBudget(slug);
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const log = settings.costSpendLog || [];

  const periodStart = _getPeriodStart(budget.period);
  const periodEntries = budget.period === 'total'
    ? log
    : log.filter(e => e.timestamp >= periodStart);

  const total = periodEntries.reduce((sum, e) => sum + (e.amount || 0), 0);

  return {
    period: budget.period,
    periodStart: budget.period === 'total' ? null : periodStart,
    totalSpend: total,
    softLimit: budget.softLimit,
    hardLimit: budget.hardLimit,
    softLimitReached: budget.softLimit !== null && total >= budget.softLimit,
    hardLimitReached: budget.hardLimit !== null && total >= budget.hardLimit,
    remaining: budget.hardLimit !== null ? Math.max(0, budget.hardLimit - total) : null,
    entryCount: periodEntries.length,
  };
}

function _getPeriodStart(period) {
  const now = new Date();
  switch (period) {
    case 'daily':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    case 'weekly': {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday start
      return new Date(now.getFullYear(), now.getMonth(), diff).getTime();
    }
    case 'monthly':
      return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    case 'total':
    default:
      return 0;
  }
}

// ─── Alerts ─────────────────────────────────────────────────────────────

/**
 * Get budget alerts for a project.
 */
export function getAlerts(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  return settings.costAlerts || [];
}

/**
 * Clear budget alerts.
 */
export function clearAlerts(slug) {
  refs.workspace?.updateProjectSettings?.(slug, { costAlerts: [] });
  return { ok: true };
}

function _checkBudgetAlerts(slug) {
  const budget = getBudget(slug);
  if (!budget.alertsEnabled) return;

  const spend = getCurrentSpend(slug);
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  const alerts = settings.costAlerts || [];

  if (spend.softLimitReached) {
    // Only alert once per period
    const alreadyAlerted = alerts.find(
      a => a.type === 'soft-limit' && a.period === budget.period && a.periodStart === spend.periodStart
    );
    if (!alreadyAlerted) {
      alerts.push({
        type: 'soft-limit',
        message: `Soft limit reached: ${spend.totalSpend}/${budget.softLimit} ${budget.currency}`,
        spend: spend.totalSpend,
        limit: budget.softLimit,
        period: budget.period,
        periodStart: spend.periodStart,
        timestamp: Date.now(),
      });
    }
  }

  if (spend.hardLimitReached) {
    const alreadyAlerted = alerts.find(
      a => a.type === 'hard-limit' && a.period === budget.period && a.periodStart === spend.periodStart
    );
    if (!alreadyAlerted) {
      alerts.push({
        type: 'hard-limit',
        message: `Hard limit reached: ${spend.totalSpend}/${budget.hardLimit} ${budget.currency} — sessions blocked`,
        spend: spend.totalSpend,
        limit: budget.hardLimit,
        period: budget.period,
        periodStart: spend.periodStart,
        timestamp: Date.now(),
      });
    }
  }

  // Cap alerts
  const trimmed = alerts.slice(-MAX_ALERTS);
  refs.workspace?.updateProjectSettings?.(slug, { costAlerts: trimmed });
}

// ─── Forecasting ────────────────────────────────────────────────────────

/**
 * Forecast spend for the remainder of the current period.
 */
export function forecast(slug) {
  const budget = getBudget(slug);
  const spend = getCurrentSpend(slug);

  if (budget.period === 'total' || !spend.periodStart) {
    return { forecast: null, message: 'Forecasting not available for total period' };
  }

  const now = Date.now();
  const elapsed = now - spend.periodStart;
  const periodLength = _getPeriodLength(budget.period);

  if (elapsed < 60000) { // Less than 1 minute of data
    return { forecast: null, message: 'Insufficient data for forecast' };
  }

  const rate = spend.totalSpend / elapsed; // spend per ms
  const projectedTotal = Math.round(rate * periodLength);
  const remaining = periodLength - elapsed;
  const projectedRemaining = Math.round(rate * remaining);

  return {
    currentSpend: spend.totalSpend,
    projectedTotal,
    projectedRemaining,
    rate: Math.round(rate * 86400000 * 100) / 100, // spend per day, 2 decimals
    periodElapsedPct: Math.round((elapsed / periodLength) * 100),
    willExceedSoft: budget.softLimit !== null && projectedTotal > budget.softLimit,
    willExceedHard: budget.hardLimit !== null && projectedTotal > budget.hardLimit,
  };
}

function _getPeriodLength(period) {
  switch (period) {
    case 'daily': return 86400000;
    case 'weekly': return 86400000 * 7;
    case 'monthly': return 86400000 * 30; // approximate
    default: return 86400000 * 30;
  }
}

// ─── Check Permission ───────────────────────────────────────────────────

/**
 * Check whether a session is allowed under the current budget.
 * Returns { allowed: boolean, reason?: string }
 */
export function checkBudgetPermission(slug) {
  const budget = getBudget(slug);
  if (budget.hardLimit === null) return { allowed: true };

  const spend = getCurrentSpend(slug);
  if (spend.hardLimitReached) {
    return {
      allowed: false,
      reason: `Hard budget limit reached: ${spend.totalSpend}/${budget.hardLimit} ${budget.currency} (${budget.period})`,
    };
  }

  return { allowed: true };
}

// ─── Reset (test helper) ────────────────────────────────────────────────

export function _reset() {
  // Stateless service — nothing to reset
}
