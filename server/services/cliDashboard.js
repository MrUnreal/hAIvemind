/**
 * server/services/cliDashboard.js — Phase 19.1: Terminal Dashboard
 *
 * Rich ANSI-based terminal dashboard for live session monitoring.
 * Uses box-drawing characters and cursor positioning for real-time updates.
 * Zero external dependencies — pure Node.js stdout manipulation.
 */

// ─── ANSI Escape Codes ───────────────────────────────────────────────
const ESC = '\x1b';
const CSI = `${ESC}[`;

const ansi = {
  clear: `${CSI}2J`,
  home: `${CSI}H`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  moveTo: (row, col) => `${CSI}${row};${col}H`,
  clearLine: `${CSI}2K`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  reset: `${CSI}0m`,
  fg: {
    black: `${CSI}30m`,
    red: `${CSI}31m`,
    green: `${CSI}32m`,
    yellow: `${CSI}33m`,
    blue: `${CSI}34m`,
    magenta: `${CSI}35m`,
    cyan: `${CSI}36m`,
    white: `${CSI}37m`,
  },
  bg: {
    black: `${CSI}40m`,
    red: `${CSI}41m`,
    green: `${CSI}42m`,
    yellow: `${CSI}43m`,
    blue: `${CSI}44m`,
    white: `${CSI}47m`,
  },
};

// ─── Box Drawing ─────────────────────────────────────────────────────
const BOX = {
  topLeft: '╔', topRight: '╗', bottomLeft: '╚', bottomRight: '╝',
  horizontal: '═', vertical: '║',
  teeRight: '╠', teeLeft: '╣', teeDown: '╦', teeUp: '╩', cross: '╬',
  // Light variants
  ltopLeft: '┌', ltopRight: '┐', lbottomLeft: '└', lbottomRight: '┘',
  lhorizontal: '─', lvertical: '│',
  lteeRight: '├', lteeLeft: '┤',
};

// ─── Progress Bar ────────────────────────────────────────────────────
function progressBar(value, max, width = 20) {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const pct = Math.round(ratio * 100);
  return `${bar} ${pct}%`;
}

// ─── Sparkline ───────────────────────────────────────────────────────
const SPARK_CHARS = '▁▂▃▄▅▆▇█';
function sparkline(values, width = 20) {
  if (!values.length) return ' '.repeat(width);
  const recent = values.slice(-width);
  const min = Math.min(...recent);
  const max = Math.max(...recent);
  const range = max - min || 1;
  return recent.map(v => {
    const idx = Math.round(((v - min) / range) * (SPARK_CHARS.length - 1));
    return SPARK_CHARS[idx];
  }).join('');
}

// ─── Dashboard State ─────────────────────────────────────────────────
export class TerminalDashboard {
  constructor(opts = {}) {
    this.slug = opts.slug || 'unknown';
    this.startTime = Date.now();
    this.width = opts.width || process.stdout.columns || 120;
    this.height = opts.height || process.stdout.rows || 40;

    // State
    this.tasks = [];
    this.agents = [];
    this.costSummary = { totalAgents: 0, totalPremiumRequests: 0, tierCounts: {} };
    this.wave = 0;
    this.status = 'initializing';
    this.logs = [];
    this.agentHistory = []; // for sparkline
    this.providerHealth = {};
    this.swarmTopology = null;

    this._interval = null;
    this._running = false;
  }

  start() {
    this._running = true;
    process.stdout.write(ansi.clear + ansi.home + ansi.hideCursor);

    // Listen for resize
    process.stdout.on('resize', () => {
      this.width = process.stdout.columns || 120;
      this.height = process.stdout.rows || 40;
    });

    // Render loop at 4fps
    this._interval = setInterval(() => this.render(), 250);
    this.render();
  }

  stop() {
    this._running = false;
    if (this._interval) clearInterval(this._interval);
    process.stdout.write(ansi.showCursor);
  }

  // ── State Update Methods ──────────────────────────────────────────
  updateTasks(tasks) {
    this.tasks = tasks || [];
  }

  updateAgent(agentId, status, tier, taskLabel) {
    const existing = this.agents.find(a => a.id === agentId);
    if (existing) {
      existing.status = status;
      existing.tier = tier;
      existing.task = taskLabel;
      existing.lastUpdate = Date.now();
    } else {
      this.agents.push({ id: agentId, status, tier, task: taskLabel, lastUpdate: Date.now() });
    }
    this.agentHistory.push(this.agents.filter(a => a.status === 'running').length);
    if (this.agentHistory.length > 60) this.agentHistory.shift();
  }

  updateCost(summary) {
    this.costSummary = summary || this.costSummary;
  }

  updateWave(wave) {
    this.wave = wave;
  }

  updateStatus(status) {
    this.status = status;
  }

  addLog(msg) {
    this.logs.push({ time: Date.now(), msg });
    if (this.logs.length > 100) this.logs.shift();
  }

  updateProviderHealth(health) {
    this.providerHealth = health || {};
  }

  updateSwarmTopology(topology) {
    this.swarmTopology = topology;
  }

  // ── Render ────────────────────────────────────────────────────────
  render() {
    if (!this._running) return;

    const w = Math.min(this.width, 140);
    const buf = [];

    buf.push(ansi.home);

    // Header
    buf.push(this._renderHeader(w));
    buf.push('');

    // Two-column layout: Tasks (left) + Agents/Cost (right)
    const leftWidth = Math.floor(w * 0.55);
    const rightWidth = w - leftWidth - 3;

    const leftLines = this._renderTaskPanel(leftWidth);
    const rightLines = [
      ...this._renderAgentPanel(rightWidth),
      '',
      ...this._renderCostPanel(rightWidth),
    ];

    // Merge columns
    const maxRows = Math.max(leftLines.length, rightLines.length);
    for (let i = 0; i < maxRows && i < this.height - 8; i++) {
      const left = leftLines[i] || '';
      const right = rightLines[i] || '';
      buf.push(`  ${this._pad(left, leftWidth)} ${ansi.dim}│${ansi.reset} ${right}`);
    }

    buf.push('');

    // Log tail
    buf.push(this._renderLogTail(w));

    // Status bar
    buf.push(this._renderStatusBar(w));

    process.stdout.write(buf.join('\n'));
  }

  _renderHeader(w) {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(0);
    const statusColor = this.status === 'completed' ? ansi.fg.green
      : this.status === 'failed' ? ansi.fg.red
        : ansi.fg.cyan;

    const title = `${ansi.bold}${ansi.fg.cyan} hAIvemind Dashboard${ansi.reset}`;
    const info = `${ansi.dim}${this.slug} │ ${statusColor}${this.status}${ansi.reset}${ansi.dim} │ Wave ${this.wave} │ ${elapsed}s${ansi.reset}`;

    return `${BOX.horizontal.repeat(2)} ${title} ${BOX.horizontal.repeat(2)} ${info}`;
  }

  _renderTaskPanel(w) {
    const lines = [];
    lines.push(`${ansi.bold}  Tasks${ansi.reset} ${ansi.dim}(${this.tasks.length})${ansi.reset}`);
    lines.push(`  ${BOX.lhorizontal.repeat(w - 4)}`);

    const done = this.tasks.filter(t => t.status === 'done' || t.status === 'success').length;
    const running = this.tasks.filter(t => t.status === 'running').length;
    const failed = this.tasks.filter(t => t.status === 'failed').length;
    const pending = this.tasks.length - done - running - failed;

    lines.push(`  ${progressBar(done, this.tasks.length, w - 16)} ${ansi.fg.green}${done}✓${ansi.reset} ${ansi.fg.yellow}${running}▸${ansi.reset} ${ansi.fg.red}${failed}✗${ansi.reset}`);
    lines.push('');

    // Show each task (limited to fit)
    const maxTasks = Math.min(this.tasks.length, this.height - 16);
    for (let i = 0; i < maxTasks; i++) {
      const t = this.tasks[i];
      const icon = t.status === 'done' || t.status === 'success' ? `${ansi.fg.green}✓${ansi.reset}`
        : t.status === 'running' ? `${ansi.fg.yellow}▸${ansi.reset}`
          : t.status === 'failed' ? `${ansi.fg.red}✗${ansi.reset}`
            : `${ansi.dim}·${ansi.reset}`;

      const label = (t.label || t.id || '?').slice(0, w - 10);
      const tier = t.modelTier ? `${ansi.dim}[${t.modelTier}]${ansi.reset}` : '';
      lines.push(`  ${icon} ${label} ${tier}`);
    }

    if (this.tasks.length > maxTasks) {
      lines.push(`  ${ansi.dim}... +${this.tasks.length - maxTasks} more${ansi.reset}`);
    }

    return lines;
  }

  _renderAgentPanel(w) {
    const lines = [];
    const active = this.agents.filter(a => a.status === 'running').length;
    const total = this.agents.length;

    lines.push(`${ansi.bold}Agents${ansi.reset} ${ansi.dim}(${active}/${total} active)${ansi.reset}`);
    lines.push(BOX.lhorizontal.repeat(w - 2));

    // Sparkline of agent concurrency
    if (this.agentHistory.length > 1) {
      lines.push(`${ansi.fg.cyan}${sparkline(this.agentHistory, Math.min(w - 4, 30))}${ansi.reset} ${ansi.dim}concurrency${ansi.reset}`);
    }

    // Active agents list
    const activeAgents = this.agents.filter(a => a.status === 'running').slice(0, 6);
    for (const a of activeAgents) {
      const tierColor = a.tier === 'T0' ? ansi.fg.green : a.tier === 'T1' ? ansi.fg.yellow : ansi.fg.magenta;
      lines.push(`${tierColor}●${ansi.reset} ${a.id?.slice(0, 6) || '?'} ${ansi.dim}${a.task?.slice(0, w - 16) || ''}${ansi.reset}`);
    }

    if (activeAgents.length === 0 && total > 0) {
      lines.push(`${ansi.dim}No agents running${ansi.reset}`);
    }

    return lines;
  }

  _renderCostPanel(w) {
    const lines = [];
    lines.push(`${ansi.bold}Cost${ansi.reset}`);
    lines.push(BOX.lhorizontal.repeat(w - 2));

    const tc = this.costSummary.tierCounts || {};
    const tiers = ['T0', 'T1', 'T2', 'T3'];
    const tierColors = { T0: ansi.fg.green, T1: ansi.fg.yellow, T2: ansi.fg.magenta, T3: ansi.fg.red };
    const multipliers = { T0: '0×', T1: '0.33×', T2: '1×', T3: '3×' };

    for (const tier of tiers) {
      const count = tc[tier] || 0;
      if (count > 0 || tier === 'T0') {
        const color = tierColors[tier];
        lines.push(`${color}${tier}${ansi.reset} ${ansi.dim}(${multipliers[tier]})${ansi.reset}: ${count} agents`);
      }
    }

    const premium = this.costSummary.totalPremiumRequests || 0;
    lines.push(`${ansi.dim}Premium: ${premium}×${ansi.reset}`);

    return lines;
  }

  _renderLogTail(w) {
    const recentLogs = this.logs.slice(-3);
    if (!recentLogs.length) return `${ansi.dim}  No recent log entries${ansi.reset}`;

    return recentLogs.map(l => {
      const age = Math.round((Date.now() - l.time) / 1000);
      return `${ansi.dim}  ${age}s ago │ ${l.msg.slice(0, w - 14)}${ansi.reset}`;
    }).join('\n');
  }

  _renderStatusBar(w) {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const done = this.tasks.filter(t => t.status === 'done' || t.status === 'success').length;
    const bar = `${ansi.bg.blue}${ansi.fg.white}${ansi.bold} hAIvemind ${ansi.reset}` +
      ` ${done}/${this.tasks.length} tasks` +
      ` │ Wave ${this.wave}` +
      ` │ ${this.agents.filter(a => a.status === 'running').length} agents` +
      ` │ ${elapsed}s` +
      ` │ ${ansi.dim}Ctrl+C to stop${ansi.reset}`;
    return `\n${bar}`;
  }

  _pad(str, width) {
    // Strip ANSI for length calculation
    const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, width - visible.length);
    return str + ' '.repeat(pad);
  }
}

/**
 * Create a broadcast handler that feeds a dashboard.
 * Pairs with the same MSG types used by the CLI build command.
 */
export function createDashboardBroadcast(dashboard, MSG) {
  return function broadcast(msgObj) {
    const type = msgObj?.type || msgObj?.t;
    const payload = msgObj?.payload || msgObj?.p;

    switch (type) {
      case MSG.PLAN_CREATED:
        dashboard.updateTasks(payload?.tasks || []);
        dashboard.addLog('Plan created');
        break;

      case MSG.TASK_STATUS: {
        const tasks = dashboard.tasks.map(t =>
          t.id === payload?.taskId ? { ...t, status: payload.status, modelTier: payload.tier } : t
        );
        dashboard.updateTasks(tasks);
        break;
      }

      case MSG.AGENT_STATUS:
        dashboard.updateAgent(
          payload?.agentId, payload?.status,
          payload?.tier, payload?.label || payload?.taskLabel
        );
        break;

      case MSG.WAVE_START:
        dashboard.updateWave(payload?.wave || dashboard.wave + 1);
        break;

      case MSG.SESSION_COMPLETE:
        dashboard.updateStatus('completed');
        dashboard.updateCost(payload?.costSummary);
        dashboard.addLog('Session complete');
        break;

      case MSG.SESSION_ERROR:
        dashboard.updateStatus('failed');
        dashboard.addLog(`Error: ${payload?.error || 'unknown'}`);
        break;

      case MSG.VERIFY_STATUS:
        dashboard.addLog(`Verify: ${payload?.status}`);
        break;

      case MSG.ROUTING_DECISION:
        dashboard.addLog(`Route: ${payload?.model} for ${payload?.category}`);
        break;

      case MSG.PROVIDER_FAILOVER:
        dashboard.addLog(`Failover: ${payload?.from} → ${payload?.to}`);
        break;

      default:
        break;
    }
  };
}
