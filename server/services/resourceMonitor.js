/**
 * server/services/resourceMonitor.js — Real-time Resource Monitor
 *
 * Tracks CPU, memory, disk, and per-process resource usage.
 * Supports resource limits, kill runaway agents, and history.
 */

import { cpus, totalmem, freemem, loadavg } from 'os';
import { statSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { refs } from '../state.js';

// ─── Resource Limits ────────────────────────────────────────────────
const DEFAULT_LIMITS = {
  maxMemoryPercent: 90,    // warn above 90% memory
  maxCpuPercent: 95,       // warn above 95% CPU
  maxDiskPercent: 95,      // warn above 95% disk
  maxProcessMemoryMb: 512, // kill agent if > 512 MB
  maxProcessTimeSec: 600,  // kill agent if running > 10 min
};

// ─── In-memory tracking ─────────────────────────────────────────────
const processTracker = new Map(); // pid → { start, label, slug }
const snapshots = [];             // recent system snapshots
const MAX_SNAPSHOTS = 120;        // keep 2 hours of minute-level data
const alerts = [];                // recent alerts
const MAX_ALERTS = 50;

// ─── System Metrics ─────────────────────────────────────────────────

/**
 * Get current system resource usage.
 * @returns {{ cpu, memory, disk, uptime, loadAvg, timestamp }}
 */
export function getSystemMetrics() {
  const cpuInfo = cpus();
  const cpuCount = cpuInfo.length;
  const totalMem = totalmem();
  const freeMem = freemem();
  const usedMem = totalMem - freeMem;
  const load = loadavg();

  // CPU usage approximation from load average
  const cpuPercent = Math.min(100, Math.round((load[0] / cpuCount) * 100));

  const memPercent = Math.round((usedMem / totalMem) * 100);

  // Disk usage (best-effort)
  let disk = { total: 0, used: 0, free: 0, percent: 0 };
  try {
    if (process.platform === 'win32') {
      const out = execSync('wmic logicaldisk get size,freespace,caption /format:csv', {
        encoding: 'utf-8', timeout: 3000,
      });
      const lines = out.trim().split('\n').filter(l => l.includes(','));
      // Parse first disk with data
      for (const line of lines.slice(1)) {
        const parts = line.trim().split(',');
        if (parts.length >= 4) {
          const free = parseInt(parts[1]) || 0;
          const total = parseInt(parts[2]) || 0;
          if (total > 0) {
            disk = {
              total, free, used: total - free,
              percent: Math.round(((total - free) / total) * 100),
            };
            break;
          }
        }
      }
    } else {
      const out = execSync("df -B1 / | tail -1 | awk '{print $2,$3,$4}'", {
        encoding: 'utf-8', timeout: 3000,
      });
      const [total, used, free] = out.trim().split(/\s+/).map(Number);
      if (total > 0) {
        disk = { total, used, free, percent: Math.round((used / total) * 100) };
      }
    }
  } catch { /* disk check failed, return zeros */ }

  return {
    cpu: { percent: cpuPercent, count: cpuCount, model: cpuInfo[0]?.model || 'Unknown' },
    memory: {
      total: totalMem, used: usedMem, free: freeMem,
      percent: memPercent,
    },
    disk,
    uptime: process.uptime(),
    loadAvg: { '1m': load[0], '5m': load[1], '15m': load[2] },
    nodeMemory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get resource limits (with project-level overrides).
 * @param {string} [slug]
 * @returns {object}
 */
export function getLimits(slug) {
  const base = { ...DEFAULT_LIMITS };
  if (slug && refs.workspace) {
    try {
      const settings = refs.workspace.getProjectSettings(slug);
      if (settings.resourceLimits) {
        Object.assign(base, settings.resourceLimits);
      }
    } catch { /* ignore */ }
  }
  return base;
}

/**
 * Update resource limits for a project.
 * @param {string} slug
 * @param {object} limits
 * @returns {object}
 */
export function setLimits(slug, limits) {
  const cleaned = {};
  for (const [key, val] of Object.entries(limits)) {
    if (key in DEFAULT_LIMITS && typeof val === 'number' && val > 0) {
      cleaned[key] = val;
    }
  }
  refs.workspace?.updateProjectSettings?.(slug, { resourceLimits: cleaned });
  return getLimits(slug);
}

// ─── Process Tracking ────────────────────────────────────────────────

/**
 * Register an agent process for monitoring.
 * @param {number} pid
 * @param {string} label
 * @param {string} [slug]
 */
export function trackProcess(pid, label, slug = '') {
  processTracker.set(pid, {
    pid, label, slug,
    startedAt: new Date().toISOString(),
    startMs: Date.now(),
  });
}

/**
 * Untrack a process.
 * @param {number} pid
 */
export function untrackProcess(pid) {
  processTracker.delete(pid);
}

/**
 * Get all tracked processes with runtime info.
 * @returns {Array}
 */
export function getTrackedProcesses() {
  const now = Date.now();
  return [...processTracker.values()].map(p => ({
    ...p,
    runtimeSec: Math.round((now - p.startMs) / 1000),
  }));
}

/**
 * Kill a tracked process.
 * @param {number} pid
 * @returns {{ killed: boolean, pid: number }}
 */
export function killProcess(pid) {
  const tracked = processTracker.get(pid);
  try {
    process.kill(pid, 'SIGTERM');
    processTracker.delete(pid);
    addAlert('warning', `Killed process ${pid} (${tracked?.label || 'unknown'})`);
    return { killed: true, pid };
  } catch (err) {
    processTracker.delete(pid); // remove even if kill fails (might be already dead)
    return { killed: false, pid, error: err.message };
  }
}

// ─── Snapshots ──────────────────────────────────────────────────────

/**
 * Record a system snapshot (called periodically).
 */
export function recordSnapshot() {
  const metrics = getSystemMetrics();
  snapshots.push(metrics);
  if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();

  // Check limits and generate alerts
  const limits = getLimits();
  if (metrics.memory.percent > limits.maxMemoryPercent) {
    addAlert('critical', `Memory usage ${metrics.memory.percent}% exceeds limit ${limits.maxMemoryPercent}%`);
  }
  if (metrics.cpu.percent > limits.maxCpuPercent) {
    addAlert('warning', `CPU load ${metrics.cpu.percent}% exceeds limit ${limits.maxCpuPercent}%`);
  }
  if (metrics.disk.percent > limits.maxDiskPercent) {
    addAlert('critical', `Disk usage ${metrics.disk.percent}% exceeds limit ${limits.maxDiskPercent}%`);
  }

  return metrics;
}

/**
 * Get recent snapshots for charting.
 * @param {number} [limit]
 * @returns {Array}
 */
export function getSnapshots(limit = 60) {
  return snapshots.slice(-limit);
}

// ─── Alerts ─────────────────────────────────────────────────────────

/**
 * Add a resource alert.
 * @param {'info'|'warning'|'critical'} level
 * @param {string} message
 */
export function addAlert(level, message) {
  alerts.push({
    level,
    message,
    timestamp: new Date().toISOString(),
  });
  if (alerts.length > MAX_ALERTS) alerts.shift();
}

/**
 * Get recent alerts.
 * @param {number} [limit]
 * @returns {Array}
 */
export function getAlerts(limit = 20) {
  return alerts.slice(-limit).reverse();
}

/**
 * Clear all alerts.
 */
export function clearAlerts() {
  alerts.length = 0;
}

// ─── Formatting Helpers ─────────────────────────────────────────────

/**
 * Format bytes to human-readable string.
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/**
 * Format seconds to human-readable duration.
 */
export function formatDuration(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}
