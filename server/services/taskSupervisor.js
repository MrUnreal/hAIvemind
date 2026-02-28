/**
 * Phase 21 — Asynchronous String: Task Supervision
 *
 * Middle-management layer between the Orchestrator (strategic) and Agents (execution).
 * Monitors agent output streams in real-time, detects divergence, issues corrections,
 * aggregates progress upward, and shares context horizontally between task groups.
 *
 * Architecture:
 *   Orchestrator (T3, strategic) → Supervisors (T0/T1, tactical) → Agents (T0-T3, execution)
 *
 * Key capabilities:
 *   1. Divergence detection — rule-based fast checks + optional LLM spot checks
 *   2. Course correction — early kill + context-enriched restart
 *   3. Upward aggregation — compressed progress digests to orchestrator/client
 *   4. Horizontal coordination — share interface shapes between concurrent tasks
 *   5. Progressive verification — lightweight checks after each task completes
 */

import { MSG, makeMsg } from '../../shared/protocol.js';
import { summarizeOutput } from '../outputSummarizer.js';
import EventEmitter from 'node:events';

// ────────────────────────────────────────────────────────────────────────────
// Default configuration
// ────────────────────────────────────────────────────────────────────────────

export const SUPERVISOR_DEFAULTS = {
  /** Enable/disable the supervisor system */
  enabled: true,

  /** Minimum bytes of output before running divergence checks */
  minOutputForCheck: 500,

  /** Interval (ms) between rule-based divergence scans per agent */
  ruleCheckIntervalMs: 10_000,

  /** Interval (ms) between progress digest broadcasts */
  digestIntervalMs: 15_000,

  /** Maximum lines to buffer per agent for analysis */
  maxBufferLines: 200,

  /** How many repeated error lines trigger a "looping" alert */
  loopDetectionThreshold: 3,

  /** Ratio of off-scope file touches to total that triggers scope alert */
  scopeDriftRatio: 0.5,

  /** Maximum time (ms) an agent can go without producing new output (progress stall) */
  progressStallMs: 60_000,

  /** After this many corrections on one agent, escalate to orchestrator */
  maxCorrectionsBeforeEscalate: 2,

  /** Enable LLM-based spot checks (costs T0 calls) */
  llmSpotChecks: false,

  /** Interval (ms) between LLM spot checks when enabled */
  llmSpotCheckIntervalMs: 30_000,
};

// ────────────────────────────────────────────────────────────────────────────
// Divergence categories
// ────────────────────────────────────────────────────────────────────────────

export const DIVERGENCE = {
  SCOPE_DRIFT: 'scope-drift',
  LOOP_DETECTED: 'loop-detected',
  ERROR_SPIRAL: 'error-spiral',
  PROGRESS_STALL: 'progress-stall',
  OFF_TOPIC: 'off-topic',
};

const SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

// ────────────────────────────────────────────────────────────────────────────
// AgentMonitor — per-agent tracking state
// ────────────────────────────────────────────────────────────────────────────

class AgentMonitor {
  constructor(agentId, taskId, taskLabel, taskDescription, taskAffectedFiles) {
    this.agentId = agentId;
    this.taskId = taskId;
    this.taskLabel = taskLabel;
    this.taskDescription = taskDescription;
    this.taskAffectedFiles = taskAffectedFiles || [];

    /** Rolling output buffer (recent lines only) */
    this.outputBuffer = [];
    /** Total bytes of output received */
    this.totalBytes = 0;
    /** Timestamp of the last output chunk */
    this.lastOutputAt = Date.now();
    /** Number of corrections issued for this agent */
    this.corrections = 0;
    /** Active alerts (deduped by category) */
    this.activeAlerts = new Map();
    /** Files mentioned in agent output */
    this.filesDetected = new Set();
    /** Error lines seen (for loop detection) */
    this.recentErrors = [];
    /** Whether this agent has been marked for kill */
    this.markedForKill = false;
    /** Exported interfaces detected (for horizontal sharing) */
    this.exportedInterfaces = [];
    /** Snapshot of progress metrics */
    this.progressSnapshot = { filesChanged: 0, commandsRun: 0, testsRun: false };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TaskSupervisor — the middle management layer
// ────────────────────────────────────────────────────────────────────────────

export default class TaskSupervisor extends EventEmitter {
  /**
   * @param {(msg: string) => void} broadcast - WebSocket broadcast function
   * @param {object} [opts] - Supervisor configuration overrides
   */
  constructor(broadcast, opts = {}) {
    super();
    this.broadcast = broadcast;
    this.config = { ...SUPERVISOR_DEFAULTS, ...opts };

    /** @type {Map<string, AgentMonitor>} agentId → AgentMonitor */
    this.monitors = new Map();

    /** Shared context bus — interface shapes, discovered facts */
    this.sharedContext = new Map();

    /** Digest timer handle */
    this._digestTimer = null;

    /** Rule-check timer handle */
    this._ruleCheckTimer = null;

    /** Active flag */
    this._active = false;

    /** Accumulated digest data for the current interval */
    this._digestAccumulator = {
      agentsMonitored: 0,
      alerts: [],
      corrections: [],
      progress: {},
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Start the supervisor — begins periodic checks and digest broadcasts.
   */
  start() {
    if (this._active) return;
    this._active = true;

    this._ruleCheckTimer = setInterval(
      () => this._runRuleChecks(),
      this.config.ruleCheckIntervalMs,
    );

    this._digestTimer = setInterval(
      () => this._broadcastDigest(),
      this.config.digestIntervalMs,
    );

    this.broadcast(makeMsg(MSG.SUPERVISOR_STATUS, {
      status: 'started',
      config: {
        ruleCheckIntervalMs: this.config.ruleCheckIntervalMs,
        digestIntervalMs: this.config.digestIntervalMs,
        llmSpotChecks: this.config.llmSpotChecks,
      },
    }));

    console.log('[supervisor] 🎯 Task Supervisor started — monitoring agent output streams');
  }

  /**
   * Stop the supervisor and clean up all resources.
   */
  stop() {
    if (!this._active) return;
    this._active = false;

    if (this._ruleCheckTimer) {
      clearInterval(this._ruleCheckTimer);
      this._ruleCheckTimer = null;
    }
    if (this._digestTimer) {
      clearInterval(this._digestTimer);
      this._digestTimer = null;
    }

    // Final digest before shutdown
    if (this.monitors.size > 0) {
      this._broadcastDigest();
    }

    this.monitors.clear();
    this.sharedContext.clear();

    this.broadcast(makeMsg(MSG.SUPERVISOR_STATUS, {
      status: 'stopped',
      summary: {
        totalAgentsMonitored: this._digestAccumulator.agentsMonitored,
        totalAlerts: this._digestAccumulator.alerts.length,
        totalCorrections: this._digestAccumulator.corrections.length,
      },
    }));

    console.log('[supervisor] Task Supervisor stopped');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Agent Registration
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Register an agent for monitoring. Call when an agent is spawned.
   * @param {string} agentId
   * @param {object} task - { id, label, description, affectedFiles }
   */
  registerAgent(agentId, task) {
    if (!this._active) return;

    const monitor = new AgentMonitor(
      agentId,
      task.id,
      task.label,
      task.description,
      task.affectedFiles,
    );
    this.monitors.set(agentId, monitor);
    this._digestAccumulator.agentsMonitored++;
  }

  /**
   * Unregister an agent (call when agent exits).
   * @param {string} agentId
   */
  unregisterAgent(agentId) {
    const monitor = this.monitors.get(agentId);
    if (!monitor) return;

    // Share any discovered interfaces before removing
    if (monitor.exportedInterfaces.length > 0) {
      this._shareInterfaces(monitor);
    }

    this.monitors.delete(agentId);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Output Ingestion — called on every agent output chunk
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Ingest an output chunk from an agent. This is the primary data feed.
   * Called from AgentManager on every stdout/stderr data event.
   *
   * @param {string} agentId
   * @param {string} chunk - Raw output text
   * @param {'stdout'|'stderr'} stream
   */
  ingestOutput(agentId, chunk, stream) {
    const monitor = this.monitors.get(agentId);
    if (!monitor) return;

    monitor.totalBytes += chunk.length;
    monitor.lastOutputAt = Date.now();

    // Add to rolling buffer (keep recent lines only)
    const lines = chunk.split('\n').filter(l => l.trim());
    for (const line of lines) {
      monitor.outputBuffer.push(line);
      if (monitor.outputBuffer.length > this.config.maxBufferLines) {
        monitor.outputBuffer.shift();
      }
    }

    // Extract file references from output
    this._extractFileReferences(monitor, chunk);

    // Extract error patterns (for loop detection)
    if (stream === 'stderr' || /(?:error|Error|ERROR|FAIL|panic|Traceback)/i.test(chunk)) {
      this._trackErrors(monitor, lines);
    }

    // Extract interface definitions (for horizontal sharing)
    this._extractInterfaces(monitor, chunk);

    // ── Inline fast checks (run on every chunk, no timer dependency) ──
    // Only run if we have enough output to be meaningful
    if (monitor.totalBytes >= this.config.minOutputForCheck) {
      this._quickScopeCheck(monitor);
      this._quickLoopCheck(monitor);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Rule-Based Divergence Detection (periodic)
  // ──────────────────────────────────────────────────────────────────────────

  /** @private */
  _runRuleChecks() {
    if (!this._active) return;

    const now = Date.now();

    for (const [agentId, monitor] of this.monitors) {
      if (monitor.markedForKill) continue;

      // 1. Progress stall — no output for too long
      const silenceMs = now - monitor.lastOutputAt;
      if (silenceMs > this.config.progressStallMs) {
        this._raiseAlert(monitor, {
          category: DIVERGENCE.PROGRESS_STALL,
          severity: SEVERITY.HIGH,
          message: `Agent has produced no output for ${Math.round(silenceMs / 1000)}s`,
          detail: `Last output at ${new Date(monitor.lastOutputAt).toISOString()}`,
        });
      }

      // 2. Error spiral — accumulating errors without progress
      if (monitor.recentErrors.length >= 5) {
        const uniqueErrors = new Set(monitor.recentErrors.map(e => e.slice(0, 80)));
        if (uniqueErrors.size <= 2) {
          // Same 1-2 errors repeating — definitely spiraling
          this._raiseAlert(monitor, {
            category: DIVERGENCE.ERROR_SPIRAL,
            severity: SEVERITY.HIGH,
            message: `Agent is repeating the same ${uniqueErrors.size} error(s) — likely stuck in a loop`,
            detail: [...uniqueErrors].join(' | '),
          });
        }
      }

      // 3. Scope drift — comprehensive check
      this._fullScopeCheck(monitor);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Fast Inline Checks (run per-chunk)
  // ──────────────────────────────────────────────────────────────────────────

  /** @private Quick scope check on every chunk */
  _quickScopeCheck(monitor) {
    if (monitor.taskAffectedFiles.length === 0) return;
    if (monitor.filesDetected.size < 3) return;

    const taskFiles = new Set(monitor.taskAffectedFiles.map(f => f.toLowerCase()));
    let offScope = 0;

    for (const file of monitor.filesDetected) {
      const lower = file.toLowerCase();
      const isInScope = [...taskFiles].some(tf =>
        lower.includes(tf) || tf.includes(lower)
      );
      if (!isInScope) offScope++;
    }

    const ratio = offScope / monitor.filesDetected.size;
    if (ratio > this.config.scopeDriftRatio && offScope > 2) {
      this._raiseAlert(monitor, {
        category: DIVERGENCE.SCOPE_DRIFT,
        severity: ratio > 0.8 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
        message: `${offScope}/${monitor.filesDetected.size} files touched are outside task scope`,
        detail: `Task files: ${monitor.taskAffectedFiles.join(', ')}`,
      });
    }
  }

  /** @private Quick loop check — same output pattern repeating */
  _quickLoopCheck(monitor) {
    const buf = monitor.outputBuffer;
    if (buf.length < 20) return;

    // Check last 20 lines for repetition patterns
    const recent = buf.slice(-20);
    const lineFreq = new Map();
    for (const line of recent) {
      const normalized = line.trim().slice(0, 100);
      if (normalized.length < 10) continue;
      lineFreq.set(normalized, (lineFreq.get(normalized) || 0) + 1);
    }

    for (const [line, count] of lineFreq) {
      if (count >= this.config.loopDetectionThreshold) {
        this._raiseAlert(monitor, {
          category: DIVERGENCE.LOOP_DETECTED,
          severity: count >= 5 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
          message: `Output line repeated ${count} times in last 20 lines`,
          detail: line.slice(0, 150),
        });
        return; // One loop alert per check is enough
      }
    }
  }

  /** @private Full scope analysis (runs periodically, more thorough) */
  _fullScopeCheck(monitor) {
    const desc = (monitor.taskDescription || '').toLowerCase();
    const label = (monitor.taskLabel || '').toLowerCase();
    const recentOutput = monitor.outputBuffer.slice(-50).join('\n').toLowerCase();

    // Check if agent is doing something completely unrelated
    // Heuristic: if the task mentions specific tech/files and the output is about different tech
    const taskKeywords = this._extractKeywords(desc + ' ' + label);
    const outputKeywords = this._extractKeywords(recentOutput);

    if (taskKeywords.length >= 3 && outputKeywords.length >= 3) {
      const overlap = taskKeywords.filter(k => outputKeywords.includes(k));
      const overlapRatio = overlap.length / taskKeywords.length;

      if (overlapRatio < 0.1 && monitor.totalBytes > 2000) {
        this._raiseAlert(monitor, {
          category: DIVERGENCE.OFF_TOPIC,
          severity: SEVERITY.MEDIUM,
          message: `Agent output shows low relevance to task (${Math.round(overlapRatio * 100)}% keyword overlap)`,
          detail: `Task keywords: ${taskKeywords.slice(0, 5).join(', ')} | Output keywords: ${outputKeywords.slice(0, 5).join(', ')}`,
        });
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Alert & Correction System
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Raise a divergence alert for an agent.
   * Deduplicates by category — only one alert per category per agent at a time.
   * @private
   */
  _raiseAlert(monitor, alert) {
    const { category, severity, message, detail } = alert;

    // Dedup: don't re-raise the same category within 30 seconds
    const existing = monitor.activeAlerts.get(category);
    if (existing && (Date.now() - existing.raisedAt) < 30_000) return;

    const alertObj = {
      agentId: monitor.agentId,
      taskId: monitor.taskId,
      taskLabel: monitor.taskLabel,
      category,
      severity,
      message,
      detail,
      raisedAt: Date.now(),
      outputBytes: monitor.totalBytes,
    };

    monitor.activeAlerts.set(category, alertObj);
    this._digestAccumulator.alerts.push(alertObj);

    // Broadcast the alert to the client
    this.broadcast(makeMsg(MSG.SUPERVISOR_ALERT, alertObj));

    console.log(`[supervisor] ⚠️ ALERT [${severity}] Agent ${monitor.agentId.slice(0, 8)} — ${category}: ${message}`);

    // Emit event for TaskRunner to act on
    this.emit('alert', alertObj);

    // If severity is HIGH or CRITICAL, recommend correction
    if (severity === SEVERITY.HIGH || severity === SEVERITY.CRITICAL) {
      this._recommendCorrection(monitor, alertObj);
    }
  }

  /**
   * Recommend a correction action for a diverging agent.
   * @private
   */
  _recommendCorrection(monitor, alert) {
    monitor.corrections++;

    const correction = {
      agentId: monitor.agentId,
      taskId: monitor.taskId,
      taskLabel: monitor.taskLabel,
      alertCategory: alert.category,
      correctionNumber: monitor.corrections,
      action: 'none',
      reason: '',
      enrichedContext: '',
    };

    if (monitor.corrections > this.config.maxCorrectionsBeforeEscalate) {
      // Too many corrections — escalate to orchestrator (TaskRunner handles this)
      correction.action = 'escalate';
      correction.reason = `${monitor.corrections} corrections issued — task needs re-decomposition or higher-tier model`;
    } else if (alert.category === DIVERGENCE.ERROR_SPIRAL || alert.category === DIVERGENCE.LOOP_DETECTED) {
      // Kill and restart — the agent is stuck
      correction.action = 'kill-and-restart';
      correction.reason = `Agent is ${alert.category === DIVERGENCE.LOOP_DETECTED ? 'in a loop' : 'spiraling on errors'} — kill early and restart with context`;
      correction.enrichedContext = this._buildCorrectionContext(monitor, alert);
      monitor.markedForKill = true;
    } else if (alert.category === DIVERGENCE.SCOPE_DRIFT) {
      // Kill and restart with explicit scope constraints
      correction.action = 'kill-and-restart';
      correction.reason = 'Agent drifted outside task scope — restarting with explicit file constraints';
      correction.enrichedContext = this._buildScopeConstraintContext(monitor);
      monitor.markedForKill = true;
    } else if (alert.category === DIVERGENCE.PROGRESS_STALL) {
      correction.action = 'kill-and-restart';
      correction.reason = 'Agent stalled with no output — killing early instead of waiting for timeout';
      correction.enrichedContext = this._buildStallContext(monitor);
      monitor.markedForKill = true;
    } else {
      correction.action = 'monitor';
      correction.reason = 'Alert noted but not severe enough for intervention yet';
    }

    this._digestAccumulator.corrections.push(correction);

    this.broadcast(makeMsg(MSG.SUPERVISOR_CORRECTION, correction));

    console.log(`[supervisor] 🔧 CORRECTION [${correction.action}] Agent ${monitor.agentId.slice(0, 8)} — ${correction.reason}`);

    // Emit correction event for TaskRunner to execute
    this.emit('correction', correction);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Context Building for Corrections
  // ──────────────────────────────────────────────────────────────────────────

  /** @private Build enriched context for a kill-and-restart correction */
  _buildCorrectionContext(monitor, alert) {
    const parts = [
      '## Supervisor Correction Context',
      '',
      `Your previous attempt was terminated because: ${alert.message}`,
      '',
    ];

    // Summarize what the agent DID accomplish
    if (monitor.filesDetected.size > 0) {
      parts.push(`### Files touched so far`);
      for (const f of [...monitor.filesDetected].slice(0, 10)) {
        parts.push(`- ${f}`);
      }
      parts.push('');
    }

    // Include the specific errors to avoid
    if (alert.category === DIVERGENCE.ERROR_SPIRAL) {
      const uniqueErrors = [...new Set(monitor.recentErrors.map(e => e.slice(0, 150)))];
      parts.push(`### Errors to resolve (don't repeat these)`);
      for (const err of uniqueErrors.slice(0, 5)) {
        parts.push(`- ${err}`);
      }
      parts.push('');
    }

    // Include shared context from other agents
    const sharedCtx = this._getRelevantSharedContext(monitor.taskId);
    if (sharedCtx) {
      parts.push(`### Context from concurrent agents`);
      parts.push(sharedCtx);
      parts.push('');
    }

    parts.push('### Instructions');
    parts.push('- Focus solely on the task objective');
    parts.push('- If you encounter the same error, try a fundamentally different approach');
    parts.push('- Do NOT repeat the failed strategy');

    return parts.join('\n');
  }

  /** @private Build context for scope-drift correction */
  _buildScopeConstraintContext(monitor) {
    const parts = [
      '## Supervisor Scope Correction',
      '',
      'Your previous attempt was terminated because you were modifying files outside your assigned scope.',
      '',
      `### Allowed files for this task`,
    ];

    if (monitor.taskAffectedFiles.length > 0) {
      for (const f of monitor.taskAffectedFiles) {
        parts.push(`- ${f}`);
      }
    } else {
      parts.push('- (No specific files listed — focus on files directly related to the task description)');
    }

    parts.push('');
    parts.push('### Instructions');
    parts.push('- ONLY modify files directly related to your task');
    parts.push('- Do NOT refactor unrelated code');
    parts.push('- Do NOT add features not described in your task');

    return parts.join('\n');
  }

  /** @private Build context for stall correction */
  _buildStallContext(monitor) {
    const lastLines = monitor.outputBuffer.slice(-10);
    const parts = [
      '## Supervisor Stall Correction',
      '',
      'Your previous attempt stalled (no output for an extended period).',
      '',
    ];

    if (lastLines.length > 0) {
      parts.push('### Last output before stall');
      parts.push('```');
      parts.push(lastLines.join('\n'));
      parts.push('```');
      parts.push('');
    }

    parts.push('### Instructions');
    parts.push('- If a command is hanging, try an alternative approach');
    parts.push('- Avoid interactive prompts or commands that wait for user input');
    parts.push('- If installing dependencies, use --yes or equivalent flags');

    return parts.join('\n');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Horizontal Context Sharing
  // ──────────────────────────────────────────────────────────────────────────

  /** @private Extract interface definitions from output */
  _extractInterfaces(monitor, chunk) {
    // Detect export statements: export function, export class, export const, module.exports
    const exportPatterns = [
      /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/g,
      /module\.exports\s*=\s*(?:{[^}]*}|\w+)/g,
      /export\s+{([^}]+)}/g,
    ];

    for (const pattern of exportPatterns) {
      for (const match of chunk.matchAll(pattern)) {
        const iface = match[0].slice(0, 200);
        if (!monitor.exportedInterfaces.includes(iface)) {
          monitor.exportedInterfaces.push(iface);
        }
      }
    }

    // Detect API route definitions
    const routePatterns = [
      /(?:app|router)\.(?:get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g,
    ];

    for (const pattern of routePatterns) {
      for (const match of chunk.matchAll(pattern)) {
        const route = `Route: ${match[1]}`;
        if (!monitor.exportedInterfaces.includes(route)) {
          monitor.exportedInterfaces.push(route);
        }
      }
    }
  }

  /** @private Share an agent's discovered interfaces with the context bus */
  _shareInterfaces(monitor) {
    if (monitor.exportedInterfaces.length === 0) return;

    const key = `interfaces:${monitor.taskId}`;
    this.sharedContext.set(key, {
      taskId: monitor.taskId,
      taskLabel: monitor.taskLabel,
      interfaces: monitor.exportedInterfaces,
      timestamp: Date.now(),
    });
  }

  /** @private Get relevant shared context for a task */
  _getRelevantSharedContext(taskId) {
    const parts = [];
    for (const [key, ctx] of this.sharedContext) {
      if (ctx.taskId === taskId) continue; // Don't share your own context
      if (ctx.interfaces?.length > 0) {
        parts.push(`From task "${ctx.taskLabel}": ${ctx.interfaces.slice(0, 5).join(', ')}`);
      }
    }
    return parts.length > 0 ? parts.join('\n') : null;
  }

  /**
   * Get all shared context entries (for injection into agent prompts).
   * @returns {string} Formatted context string
   */
  getSharedContextForTask(taskId) {
    return this._getRelevantSharedContext(taskId) || '';
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Progress Digest
  // ──────────────────────────────────────────────────────────────────────────

  /** @private Broadcast a compressed progress digest to clients */
  _broadcastDigest() {
    if (!this._active) return;
    if (this.monitors.size === 0) return;

    const agentStatuses = [];
    for (const [agentId, monitor] of this.monitors) {
      const status = {
        agentId: agentId.slice(0, 8),
        taskId: monitor.taskId,
        taskLabel: monitor.taskLabel,
        outputBytes: monitor.totalBytes,
        filesDetected: monitor.filesDetected.size,
        alertCount: monitor.activeAlerts.size,
        corrections: monitor.corrections,
        lastOutputAgo: Math.round((Date.now() - monitor.lastOutputAt) / 1000),
        healthScore: this._computeHealthScore(monitor),
      };
      agentStatuses.push(status);
    }

    const digest = {
      timestamp: Date.now(),
      activeAgents: this.monitors.size,
      agents: agentStatuses,
      sharedContextEntries: this.sharedContext.size,
      recentAlerts: this._digestAccumulator.alerts.slice(-5).map(a => ({
        agentId: a.agentId.slice(0, 8),
        category: a.category,
        severity: a.severity,
        message: a.message,
      })),
      recentCorrections: this._digestAccumulator.corrections.slice(-3).map(c => ({
        agentId: c.agentId.slice(0, 8),
        action: c.action,
        reason: c.reason,
      })),
    };

    this.broadcast(makeMsg(MSG.SUPERVISOR_DIGEST, digest));
  }

  /** @private Compute a health score (0-100) for an agent */
  _computeHealthScore(monitor) {
    let score = 100;

    // Penalize for active alerts
    for (const [, alert] of monitor.activeAlerts) {
      if (alert.severity === SEVERITY.CRITICAL) score -= 40;
      else if (alert.severity === SEVERITY.HIGH) score -= 25;
      else if (alert.severity === SEVERITY.MEDIUM) score -= 15;
      else score -= 5;
    }

    // Penalize for corrections
    score -= monitor.corrections * 10;

    // Penalize for silence (no output)
    const silenceMs = Date.now() - monitor.lastOutputAt;
    if (silenceMs > 30_000) score -= 10;
    if (silenceMs > 60_000) score -= 20;

    // Bonus for file activity
    if (monitor.filesDetected.size > 0) score = Math.min(score + 5, 100);

    return Math.max(0, Math.min(100, score));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Progressive Verification
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Run progressive verification on a completed task's output.
   * Called by TaskRunner after a task succeeds, before moving to next wave.
   *
   * @param {string} agentId
   * @param {string[]} outputChunks - The agent's accumulated output
   * @returns {{ passed: boolean, issues: string[] }}
   */
  progressiveVerify(agentId, outputChunks) {
    const monitor = this.monitors.get(agentId);
    const summary = summarizeOutput(outputChunks);
    const issues = [];

    // Check 1: Did the agent produce any file changes?
    if (summary.filesChanged.length === 0 && summary.filesDeleted.length === 0) {
      issues.push('No file changes detected in agent output');
    }

    // Check 2: Are there unresolved errors in the output?
    if (summary.errors.length > 0) {
      issues.push(`${summary.errors.length} error(s) in output: ${summary.errors[0].slice(0, 100)}`);
    }

    // Check 3: Did tests fail?
    if (summary.tests.failed > 0) {
      issues.push(`${summary.tests.failed} test(s) failed`);
    }

    // Check 4: If task had affected files, were they actually modified?
    if (monitor && monitor.taskAffectedFiles.length > 0) {
      const changedSet = new Set(summary.filesChanged.map(f => f.toLowerCase()));
      const missed = monitor.taskAffectedFiles.filter(f => !changedSet.has(f.toLowerCase()));
      if (missed.length > 0 && missed.length === monitor.taskAffectedFiles.length) {
        issues.push(`None of the expected files were modified: ${missed.join(', ')}`);
      }
    }

    return {
      passed: issues.length === 0,
      issues,
      summary: summary.digest,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Text Analysis Helpers
  // ──────────────────────────────────────────────────────────────────────────

  /** @private Extract file paths from output chunk */
  _extractFileReferences(monitor, chunk) {
    // Common file path patterns
    const patterns = [
      /(?:Creating|Modified|Updated|Wrote|Writing|Deleted|Reading)\s+(?:file:?\s*)?([^\s,;]+\.\w{1,10})/gi,
      /create mode \d+ (.+)/g,
      /diff --git a\/(.+?) b\//g,
      /(?:^|\n)\s*>\s+(\S+\.\w{1,10})\s*$/gm,
      /(?:open|read|write|unlink|stat)\s*\(\s*['"]([^'"]+\.\w{1,10})['"]/g,
    ];

    for (const pattern of patterns) {
      for (const match of chunk.matchAll(pattern)) {
        const file = match[1].trim();
        if (file.length < 200 && !file.startsWith('--')) {
          monitor.filesDetected.add(file);
        }
      }
    }
  }

  /** @private Track error lines for loop/spiral detection */
  _trackErrors(monitor, lines) {
    for (const line of lines) {
      if (/(?:error|Error|ERROR|FAIL|panic|Traceback|SyntaxError|TypeError|ReferenceError)/i.test(line)) {
        monitor.recentErrors.push(line.trim().slice(0, 200));
        // Keep only recent errors (sliding window)
        if (monitor.recentErrors.length > 20) {
          monitor.recentErrors.shift();
        }
      }
    }
  }

  /** @private Extract meaningful keywords from text */
  _extractKeywords(text) {
    // Remove common English stop words, keep technical terms
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
      'into', 'through', 'during', 'before', 'after', 'above', 'below',
      'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
      'this', 'that', 'these', 'those', 'it', 'its', 'if', 'then', 'else',
      'when', 'where', 'all', 'each', 'every', 'any', 'some', 'no',
      'file', 'files', 'code', 'function', 'add', 'create', 'update',
      'use', 'using', 'make', 'new', 'implement', 'task', 'ensure',
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    // Deduplicate and return top keywords by frequency
    const freq = new Map();
    for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([w]) => w);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public Accessors
  // ──────────────────────────────────────────────────────────────────────────

  /** Get supervisor stats for session snapshots */
  getStats() {
    return {
      active: this._active,
      monitorsCount: this.monitors.size,
      sharedContextEntries: this.sharedContext.size,
      totalAlerts: this._digestAccumulator.alerts.length,
      totalCorrections: this._digestAccumulator.corrections.length,
      alerts: this._digestAccumulator.alerts.slice(-10),
      corrections: this._digestAccumulator.corrections.slice(-10),
    };
  }

  /** Check if an agent has been marked for kill by the supervisor */
  isMarkedForKill(agentId) {
    const monitor = this.monitors.get(agentId);
    return monitor?.markedForKill ?? false;
  }

  /** Get the enriched correction context for a killed agent's restart */
  getCorrectionContext(agentId) {
    const corrections = this._digestAccumulator.corrections
      .filter(c => c.agentId === agentId && c.enrichedContext);
    return corrections.length > 0 ? corrections[corrections.length - 1].enrichedContext : '';
  }
}
