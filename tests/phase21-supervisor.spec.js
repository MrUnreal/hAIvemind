// @ts-check
import { test, expect } from '@playwright/test';

/* ════════════════════════════════════════════
   Phase 21 — Asynchronous String: Task Supervision
   Idea credited to CC
   ════════════════════════════════════════════ */

// ─── 21.0 TaskSupervisor Core ────────────────────────────────────────
test.describe('TaskSupervisor — lifecycle & configuration', () => {
  test('constructor applies default config', async () => {
    const { default: TaskSupervisor, SUPERVISOR_DEFAULTS } = await import('../server/services/taskSupervisor.js');
    const messages = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));
    const supervisor = new TaskSupervisor(broadcast);

    expect(supervisor.config.enabled).toBe(true);
    expect(supervisor.config.ruleCheckIntervalMs).toBe(SUPERVISOR_DEFAULTS.ruleCheckIntervalMs);
    expect(supervisor.config.digestIntervalMs).toBe(SUPERVISOR_DEFAULTS.digestIntervalMs);
    expect(supervisor.config.loopDetectionThreshold).toBe(SUPERVISOR_DEFAULTS.loopDetectionThreshold);
    expect(supervisor.monitors.size).toBe(0);
  });

  test('constructor merges custom config over defaults', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 5000,
      digestIntervalMs: 8000,
      loopDetectionThreshold: 5,
    });

    expect(supervisor.config.ruleCheckIntervalMs).toBe(5000);
    expect(supervisor.config.digestIntervalMs).toBe(8000);
    expect(supervisor.config.loopDetectionThreshold).toBe(5);
    // Defaults still present for unset fields
    expect(supervisor.config.minOutputForCheck).toBe(500);
  });

  test('start() activates supervisor and broadcasts status', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const messages = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });

    supervisor.start();
    expect(supervisor._active).toBe(true);

    const statusMsg = messages.find(m => m.type === 'supervisor:status');
    expect(statusMsg).toBeDefined();
    expect(statusMsg.payload.status).toBe('started');
    expect(statusMsg.payload.config.ruleCheckIntervalMs).toBe(60000);

    supervisor.stop();
  });

  test('start() is idempotent — double-start does not crash', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });

    supervisor.start();
    supervisor.start(); // second call should be a no-op
    expect(supervisor._active).toBe(true);
    supervisor.stop();
  });

  test('stop() deactivates supervisor and broadcasts stopped status', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const messages = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });

    supervisor.start();
    supervisor.stop();
    expect(supervisor._active).toBe(false);
    expect(supervisor.monitors.size).toBe(0);

    const stopMsg = messages.find(m => m.type === 'supervisor:status' && m.payload.status === 'stopped');
    expect(stopMsg).toBeDefined();
    expect(stopMsg.payload.summary).toBeDefined();
  });

  test('stop() is idempotent — double-stop does not crash', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });

    supervisor.start();
    supervisor.stop();
    supervisor.stop(); // should not throw
    expect(supervisor._active).toBe(false);
  });
});

// ─── 21.1 Agent Registration ─────────────────────────────────────────
test.describe('TaskSupervisor — agent registration', () => {
  test('registerAgent creates a monitor', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Build API',
      description: 'Create REST API endpoints',
      affectedFiles: ['server/routes/api.js'],
    });

    expect(supervisor.monitors.size).toBe(1);
    expect(supervisor.monitors.has('agent-1')).toBe(true);

    const monitor = supervisor.monitors.get('agent-1');
    expect(monitor.agentId).toBe('agent-1');
    expect(monitor.taskId).toBe('task-1');
    expect(monitor.taskLabel).toBe('Build API');
    expect(monitor.taskAffectedFiles).toEqual(['server/routes/api.js']);
    expect(monitor.totalBytes).toBe(0);
    expect(monitor.corrections).toBe(0);

    supervisor.stop();
  });

  test('registerAgent is a no-op when supervisor is inactive', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast);
    // Not started — _active is false

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Test',
      description: 'Test task',
    });

    expect(supervisor.monitors.size).toBe(0);
  });

  test('unregisterAgent removes the monitor', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Build API',
      description: 'Create API',
    });
    expect(supervisor.monitors.size).toBe(1);

    supervisor.unregisterAgent('agent-1');
    expect(supervisor.monitors.size).toBe(0);

    supervisor.stop();
  });

  test('unregisterAgent for non-existent agent does not throw', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    // Should not throw
    supervisor.unregisterAgent('non-existent');
    expect(supervisor.monitors.size).toBe(0);

    supervisor.stop();
  });
});

// ─── 21.2 Output Ingestion ───────────────────────────────────────────
test.describe('TaskSupervisor — output ingestion', () => {
  test('ingestOutput tracks bytes and updates lastOutputAt', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Test task',
      description: 'A coding task',
    });

    const before = Date.now();
    supervisor.ingestOutput('agent-1', 'Creating file: src/app.js\n', 'stdout');

    const monitor = supervisor.monitors.get('agent-1');
    expect(monitor.totalBytes).toBe('Creating file: src/app.js\n'.length);
    expect(monitor.lastOutputAt).toBeGreaterThanOrEqual(before);
    expect(monitor.outputBuffer.length).toBe(1);

    supervisor.stop();
  });

  test('ingestOutput caps buffer at maxBufferLines', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
      maxBufferLines: 5,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Test',
      description: 'Test task',
    });

    // Ingest more lines than the buffer can hold
    for (let i = 0; i < 10; i++) {
      supervisor.ingestOutput('agent-1', `line ${i}\n`, 'stdout');
    }

    const monitor = supervisor.monitors.get('agent-1');
    expect(monitor.outputBuffer.length).toBeLessThanOrEqual(5);
    // Should have the most recent lines
    expect(monitor.outputBuffer[monitor.outputBuffer.length - 1]).toBe('line 9');

    supervisor.stop();
  });

  test('ingestOutput extracts file references', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Build feature',
      description: 'Add feature',
    });

    supervisor.ingestOutput('agent-1', 'Creating file: src/handler.js\n', 'stdout');
    supervisor.ingestOutput('agent-1', 'Modified file: src/routes.ts\n', 'stdout');
    supervisor.ingestOutput('agent-1', 'create mode 100644 lib/utils.py\n', 'stdout');

    const monitor = supervisor.monitors.get('agent-1');
    expect(monitor.filesDetected.size).toBeGreaterThanOrEqual(2);
    expect(monitor.filesDetected.has('src/handler.js')).toBe(true);

    supervisor.stop();
  });

  test('ingestOutput tracks errors from stderr', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Fix bug',
      description: 'Fix the login bug',
    });

    supervisor.ingestOutput('agent-1', 'Error: Cannot find module "lodash"\n', 'stderr');
    supervisor.ingestOutput('agent-1', 'TypeError: undefined is not a function\n', 'stderr');

    const monitor = supervisor.monitors.get('agent-1');
    expect(monitor.recentErrors.length).toBe(2);

    supervisor.stop();
  });

  test('ingestOutput ignores unknown agentId', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    // Should not throw
    supervisor.ingestOutput('non-existent', 'some output\n', 'stdout');
    expect(supervisor.monitors.size).toBe(0);

    supervisor.stop();
  });
});

// ─── 21.3 Divergence Detection ──────────────────────────────────────
test.describe('TaskSupervisor — divergence detection', () => {
  test('detects output loop (repeated lines)', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const messages = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
      minOutputForCheck: 10,
      loopDetectionThreshold: 3,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Build feature',
      description: 'Create the feature',
    });

    // Produce enough output to pass minOutputForCheck
    supervisor.ingestOutput('agent-1', 'x'.repeat(20) + '\n', 'stdout');

    // Now produce repeated lines (need 20+ lines in buffer for quickLoopCheck)
    for (let i = 0; i < 20; i++) {
      supervisor.ingestOutput('agent-1', 'npm ERR! code ELIFECYCLE\n', 'stdout');
    }

    const alerts = messages.filter(m => m.type === 'supervisor:alert');
    const loopAlert = alerts.find(a => a.payload.category === 'loop-detected');
    expect(loopAlert).toBeDefined();
    expect(loopAlert.payload.severity).toMatch(/medium|high/);
    expect(loopAlert.payload.agentId).toBe('agent-1');

    supervisor.stop();
  });

  test('detects error spiral via periodic rule check', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const messages = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Fix tests',
      description: 'Fix failing tests',
    });

    // Inject repeated errors directly into the monitor
    const monitor = supervisor.monitors.get('agent-1');
    for (let i = 0; i < 8; i++) {
      monitor.recentErrors.push('Error: Cannot find module "react"');
    }

    // Manually trigger rule check
    supervisor._runRuleChecks();

    const alerts = messages.filter(m => m.type === 'supervisor:alert');
    const spiralAlert = alerts.find(a => a.payload.category === 'error-spiral');
    expect(spiralAlert).toBeDefined();
    expect(spiralAlert.payload.severity).toBe('high');

    supervisor.stop();
  });

  test('detects progress stall (no output)', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const messages = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
      progressStallMs: 1000,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Install deps',
      description: 'Install dependencies',
    });

    // Set lastOutputAt to the past
    const monitor = supervisor.monitors.get('agent-1');
    monitor.lastOutputAt = Date.now() - 5000; // 5 seconds ago (exceeds 1000ms threshold)

    supervisor._runRuleChecks();

    const alerts = messages.filter(m => m.type === 'supervisor:alert');
    const stallAlert = alerts.find(a => a.payload.category === 'progress-stall');
    expect(stallAlert).toBeDefined();
    expect(stallAlert.payload.severity).toBe('high');

    supervisor.stop();
  });

  test('detects scope drift when agent touches off-scope files', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const messages = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
      minOutputForCheck: 10,
      scopeDriftRatio: 0.4,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Fix auth',
      description: 'Fix the auth module',
      affectedFiles: ['server/auth.js'],
    });

    // Agent touches many off-scope files
    const monitor = supervisor.monitors.get('agent-1');
    monitor.totalBytes = 2000; // Already enough output
    monitor.filesDetected.add('server/auth.js');     // in-scope
    monitor.filesDetected.add('client/App.vue');      // off-scope
    monitor.filesDetected.add('client/store.js');     // off-scope
    monitor.filesDetected.add('docs/readme.md');      // off-scope
    monitor.filesDetected.add('tests/auth.spec.js');  // off-scope

    // Trigger quick scope check manually
    supervisor._quickScopeCheck(monitor);

    const alerts = messages.filter(m => m.type === 'supervisor:alert');
    const scopeAlert = alerts.find(a => a.payload.category === 'scope-drift');
    expect(scopeAlert).toBeDefined();

    supervisor.stop();
  });

  test('alerts are deduplicated by category within 30s window', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const messages = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
      progressStallMs: 100,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Test',
      description: 'Test task',
    });

    const monitor = supervisor.monitors.get('agent-1');
    monitor.lastOutputAt = Date.now() - 5000;

    // Run rule checks twice in rapid succession
    supervisor._runRuleChecks();
    supervisor._runRuleChecks();

    const stallAlerts = messages.filter(m =>
      m.type === 'supervisor:alert' && m.payload.category === 'progress-stall'
    );
    // Should only be 1 due to dedup
    expect(stallAlerts.length).toBe(1);

    supervisor.stop();
  });
});

// ─── 21.4 Corrections ───────────────────────────────────────────────
test.describe('TaskSupervisor — correction system', () => {
  test('high-severity alert triggers kill-and-restart correction', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const messages = [];
    const corrections = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
      progressStallMs: 100,
    });
    supervisor.start();
    supervisor.on('correction', (c) => corrections.push(c));

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Build API',
      description: 'Create REST endpoints',
    });

    // Force a stall to trigger high-severity alert
    const monitor = supervisor.monitors.get('agent-1');
    monitor.lastOutputAt = Date.now() - 5000;
    supervisor._runRuleChecks();

    // Check that a correction was emitted
    expect(corrections.length).toBeGreaterThanOrEqual(1);
    expect(corrections[0].action).toBe('kill-and-restart');
    expect(corrections[0].agentId).toBe('agent-1');
    expect(corrections[0].taskId).toBe('task-1');
    expect(monitor.markedForKill).toBe(true);

    // Check correction was also broadcast
    const correctionMsg = messages.find(m => m.type === 'supervisor:correction');
    expect(correctionMsg).toBeDefined();
    expect(correctionMsg.payload.action).toBe('kill-and-restart');

    supervisor.stop();
  });

  test('correction includes enriched context for restarts', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const corrections = [];
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
      progressStallMs: 100,
    });
    supervisor.start();
    supervisor.on('correction', (c) => corrections.push(c));

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Fix bug',
      description: 'Fix login',
    });

    const monitor = supervisor.monitors.get('agent-1');
    monitor.lastOutputAt = Date.now() - 5000;
    monitor.filesDetected.add('src/auth.js');
    monitor.outputBuffer.push('Attempting to fix login...');
    monitor.outputBuffer.push('Reading config file...');

    supervisor._runRuleChecks();

    expect(corrections.length).toBeGreaterThanOrEqual(1);
    const ctx = corrections[0].enrichedContext;
    expect(ctx).toContain('Supervisor');
    expect(ctx).toContain('Instructions');

    supervisor.stop();
  });

  test('exceeding maxCorrections triggers escalation', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const corrections = [];
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
      maxCorrectionsBeforeEscalate: 1,
      progressStallMs: 100,
    });
    supervisor.start();
    supervisor.on('correction', (c) => corrections.push(c));

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Test',
      description: 'Test',
    });

    const monitor = supervisor.monitors.get('agent-1');
    monitor.corrections = 2; // Already past the limit
    monitor.lastOutputAt = Date.now() - 5000;
    // Clear dedup window
    monitor.activeAlerts.clear();

    supervisor._runRuleChecks();

    const escalation = corrections.find(c => c.action === 'escalate');
    expect(escalation).toBeDefined();
    expect(escalation.reason).toContain('corrections');

    supervisor.stop();
  });

  test('isMarkedForKill reflects supervisor decision', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
      progressStallMs: 100,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Test',
      description: 'Test',
    });

    expect(supervisor.isMarkedForKill('agent-1')).toBe(false);

    const monitor = supervisor.monitors.get('agent-1');
    monitor.lastOutputAt = Date.now() - 5000;
    supervisor._runRuleChecks();

    expect(supervisor.isMarkedForKill('agent-1')).toBe(true);
    expect(supervisor.isMarkedForKill('non-existent')).toBe(false);

    supervisor.stop();
  });
});

// ─── 21.5 Horizontal Context Sharing ────────────────────────────────
test.describe('TaskSupervisor — horizontal context sharing', () => {
  test('extracts export statements and shares on unregister', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Create user service',
      description: 'Build user service module',
    });

    // Feed output containing export statements
    supervisor.ingestOutput('agent-1', 'export function getUser(id) { return db.find(id); }\n', 'stdout');
    supervisor.ingestOutput('agent-1', 'export class UserService { }\n', 'stdout');

    const monitor = supervisor.monitors.get('agent-1');
    expect(monitor.exportedInterfaces.length).toBeGreaterThanOrEqual(1);

    // Unregister — should share interfaces to shared context
    supervisor.unregisterAgent('agent-1');
    expect(supervisor.sharedContext.size).toBe(1);

    // Register another agent and get shared context
    supervisor.registerAgent('agent-2', {
      id: 'task-2',
      label: 'Build API routes',
      description: 'Create routes that use user service',
    });

    const ctx = supervisor.getSharedContextForTask('task-2');
    expect(ctx).toContain('Create user service');

    supervisor.stop();
  });

  test('getSharedContextForTask excludes own task context', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    // Manually seed shared context
    supervisor.sharedContext.set('interfaces:task-1', {
      taskId: 'task-1',
      taskLabel: 'Task A',
      interfaces: ['export function foo()'],
      timestamp: Date.now(),
    });

    // Task-1 should not see its own context
    const ownCtx = supervisor.getSharedContextForTask('task-1');
    expect(ownCtx).toBe('');

    // Task-2 should see task-1's context
    const otherCtx = supervisor.getSharedContextForTask('task-2');
    expect(otherCtx).toContain('Task A');

    supervisor.stop();
  });

  test('extracts API route definitions', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Create routes',
      description: 'Build API routes',
    });

    supervisor.ingestOutput('agent-1', `router.get('/api/users', handler)\n`, 'stdout');
    supervisor.ingestOutput('agent-1', `app.post('/api/auth/login', loginHandler)\n`, 'stdout');

    const monitor = supervisor.monitors.get('agent-1');
    const routes = monitor.exportedInterfaces.filter(i => i.startsWith('Route:'));
    expect(routes.length).toBeGreaterThanOrEqual(1);

    supervisor.stop();
  });
});

// ─── 21.6 Progress Digest ───────────────────────────────────────────
test.describe('TaskSupervisor — progress digest', () => {
  test('broadcastDigest sends supervisor:digest message', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const messages = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Build feature',
      description: 'Build it',
    });

    supervisor.ingestOutput('agent-1', 'Working on feature...\n'.repeat(10), 'stdout');

    // Manually trigger digest
    supervisor._broadcastDigest();

    const digest = messages.find(m => m.type === 'supervisor:digest');
    expect(digest).toBeDefined();
    expect(digest.payload.activeAgents).toBe(1);
    expect(digest.payload.agents.length).toBe(1);
    expect(digest.payload.agents[0].taskLabel).toBe('Build feature');
    expect(digest.payload.agents[0].outputBytes).toBeGreaterThan(0);
    expect(typeof digest.payload.agents[0].healthScore).toBe('number');

    supervisor.stop();
  });

  test('health score degrades with alerts and corrections', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Test',
      description: 'Test',
    });

    const monitor = supervisor.monitors.get('agent-1');

    // Fresh agent should have high health
    const initialScore = supervisor._computeHealthScore(monitor);
    expect(initialScore).toBeGreaterThanOrEqual(95);

    // Add a high-severity alert
    monitor.activeAlerts.set('error-spiral', {
      severity: 'high',
      raisedAt: Date.now(),
    });
    const degradedScore = supervisor._computeHealthScore(monitor);
    expect(degradedScore).toBeLessThan(initialScore);

    // Add corrections
    monitor.corrections = 2;
    const furtherDegraded = supervisor._computeHealthScore(monitor);
    expect(furtherDegraded).toBeLessThan(degradedScore);

    supervisor.stop();
  });

  test('digest is not broadcast when no monitors exist', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const messages = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    supervisor._broadcastDigest();

    const digest = messages.find(m => m.type === 'supervisor:digest');
    expect(digest).toBeUndefined();

    supervisor.stop();
  });
});

// ─── 21.7 Progressive Verification ─────────────────────────────────
test.describe('TaskSupervisor — progressive verification', () => {
  test('passes when agent produces clean output with file changes', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Create module',
      description: 'Create a module',
    });

    const output = [
      'Creating file: src/module.js\n',
      'Modified file: src/index.js\n',
      'Tests: 5 passed, 0 failed\n',
    ];

    const result = supervisor.progressiveVerify('agent-1', output);
    expect(result.passed).toBe(true);
    expect(result.issues.length).toBe(0);

    supervisor.stop();
  });

  test('flags when no file changes detected', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    const output = [
      'Thinking about the problem...\n',
      'Analyzing codebase...\n',
    ];

    const result = supervisor.progressiveVerify('non-existent', output);
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.includes('No file changes'))).toBe(true);

    supervisor.stop();
  });

  test('flags errors in agent output', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    const output = [
      'Creating file: src/app.js\n',
      'Error: Cannot read property "name" of undefined\n',
      'TypeError: expected string got number\n',
    ];

    const result = supervisor.progressiveVerify('unregistered', output);
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.includes('error'))).toBe(true);

    supervisor.stop();
  });

  test('flags test failures', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    const output = [
      'Creating file: src/app.js\n',
      'Running tests...\n',
      'Tests: 3 passed, 2 failed, 5 total\n',
    ];

    const result = supervisor.progressiveVerify('unregistered', output);
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.includes('test'))).toBe(true);

    supervisor.stop();
  });

  test('flags when expected files were not modified', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Fix auth',
      description: 'Fix auth module',
      affectedFiles: ['server/auth.js', 'server/middleware.js'],
    });

    // Agent created a different file entirely
    const output = [
      'Creating file: client/App.vue\n',
    ];

    const result = supervisor.progressiveVerify('agent-1', output);
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.includes('expected files'))).toBe(true);

    supervisor.stop();
  });
});

// ─── 21.8 Stats & Accessors ─────────────────────────────────────────
test.describe('TaskSupervisor — stats & public API', () => {
  test('getStats returns comprehensive supervisor statistics', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Test',
      description: 'Test',
    });

    const stats = supervisor.getStats();
    expect(stats.active).toBe(true);
    expect(stats.monitorsCount).toBe(1);
    expect(stats.sharedContextEntries).toBe(0);
    expect(stats.totalAlerts).toBe(0);
    expect(stats.totalCorrections).toBe(0);
    expect(Array.isArray(stats.alerts)).toBe(true);
    expect(Array.isArray(stats.corrections)).toBe(true);

    supervisor.stop();
  });

  test('getCorrectionContext returns last correction context for agent', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 60000,
      digestIntervalMs: 60000,
      progressStallMs: 100,
    });
    supervisor.start();

    supervisor.registerAgent('agent-1', {
      id: 'task-1',
      label: 'Fix bug',
      description: 'Fix a bug',
    });

    // Force a correction
    const monitor = supervisor.monitors.get('agent-1');
    monitor.lastOutputAt = Date.now() - 5000;
    supervisor._runRuleChecks();

    const ctx = supervisor.getCorrectionContext('agent-1');
    expect(typeof ctx).toBe('string');
    expect(ctx.length).toBeGreaterThan(0);

    // Non-existent agent returns empty string
    const noCtx = supervisor.getCorrectionContext('non-existent');
    expect(noCtx).toBe('');

    supervisor.stop();
  });
});

// ─── 21.9 Protocol Message Types ────────────────────────────────────
test.describe('Protocol — Phase 21 message types', () => {
  test('MSG contains all supervisor message types', async () => {
    const { MSG } = await import('../shared/protocol.js');

    expect(MSG.SUPERVISOR_ALERT).toBe('supervisor:alert');
    expect(MSG.SUPERVISOR_DIGEST).toBe('supervisor:digest');
    expect(MSG.SUPERVISOR_CORRECTION).toBe('supervisor:correction');
    expect(MSG.SUPERVISOR_STATUS).toBe('supervisor:status');
  });
});

// ─── 21.10 Config Integration ───────────────────────────────────────
test.describe('Config — supervisor defaults', () => {
  test('config.supervisor has expected shape and defaults', async () => {
    const { default: config } = await import('../server/config.js');

    expect(config.supervisor).toBeDefined();
    expect(typeof config.supervisor.enabled).toBe('boolean');
    expect(typeof config.supervisor.ruleCheckIntervalMs).toBe('number');
    expect(typeof config.supervisor.digestIntervalMs).toBe('number');
    expect(typeof config.supervisor.minOutputForCheck).toBe('number');
    expect(typeof config.supervisor.maxBufferLines).toBe('number');
    expect(typeof config.supervisor.loopDetectionThreshold).toBe('number');
    expect(typeof config.supervisor.scopeDriftRatio).toBe('number');
    expect(typeof config.supervisor.progressStallMs).toBe('number');
    expect(typeof config.supervisor.maxCorrectionsBeforeEscalate).toBe('number');
    expect(typeof config.supervisor.llmSpotChecks).toBe('boolean');
    expect(typeof config.supervisor.llmSpotCheckIntervalMs).toBe('number');
  });
});

// ─── 21.11 Keyword Extraction ───────────────────────────────────────
test.describe('TaskSupervisor — keyword extraction', () => {
  test('extracts meaningful keywords from text', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');
    const supervisor = new TaskSupervisor(() => {});

    const keywords = supervisor._extractKeywords(
      'Build a React authentication module with JWT tokens and OAuth integration for the dashboard'
    );

    expect(keywords.length).toBeGreaterThan(0);
    // Should contain technical terms, not stop words
    expect(keywords).toContain('react');
    expect(keywords).toContain('jwt');
    expect(keywords).toContain('oauth');
    // Should not contain stop words
    expect(keywords).not.toContain('the');
    expect(keywords).not.toContain('and');
    expect(keywords).not.toContain('with');
  });
});

// ─── 21.12 Integration: Supervisor + TaskRunner ─────────────────────
test.describe('TaskRunner — supervisor integration', () => {
  test('TaskRunner constructor accepts supervisor option', async () => {
    const { default: TaskRunner } = await import('../server/taskRunner.js');
    const { default: AgentManager } = await import('../server/agentManager.js');
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');

    const broadcast = () => {};
    const agentManager = new AgentManager(broadcast, true);
    const supervisor = new TaskSupervisor(broadcast);

    const plan = {
      tasks: [
        { id: 't1', label: 'Task 1', description: 'Do thing 1', dependencies: [] },
      ],
    };

    const runner = new TaskRunner(plan, agentManager, broadcast, '/tmp/test', {
      supervisor,
    });

    expect(runner.supervisor).toBe(supervisor);
    expect(runner._supervisorKills).toBeDefined();
    runner.cleanup();
  });

  test('TaskRunner works without supervisor (backward compatible)', async () => {
    const { default: TaskRunner } = await import('../server/taskRunner.js');
    const { default: AgentManager } = await import('../server/agentManager.js');

    const broadcast = () => {};
    const agentManager = new AgentManager(broadcast, true);

    const plan = {
      tasks: [
        { id: 't1', label: 'Task 1', description: 'Do thing 1', dependencies: [] },
      ],
    };

    const runner = new TaskRunner(plan, agentManager, broadcast, '/tmp/test');
    expect(runner.supervisor).toBeNull();
    runner.cleanup();
  });
});

// ─── 21.13 Integration: Supervisor + AgentManager ───────────────────
test.describe('AgentManager — supervisor integration', () => {
  test('AgentManager accepts supervisor option', async () => {
    const { default: AgentManager } = await import('../server/agentManager.js');
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');

    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast);
    const agentManager = new AgentManager(broadcast, true, { supervisor });

    expect(agentManager.supervisor).toBe(supervisor);
  });

  test('AgentManager works without supervisor (backward compatible)', async () => {
    const { default: AgentManager } = await import('../server/agentManager.js');
    const broadcast = () => {};
    const agentManager = new AgentManager(broadcast, true);

    expect(agentManager.supervisor).toBeNull();
  });
});

// ─── 21.14 DIVERGENCE constants exported ────────────────────────────
test.describe('DIVERGENCE constants', () => {
  test('exports all divergence categories', async () => {
    const { DIVERGENCE } = await import('../server/services/taskSupervisor.js');

    expect(DIVERGENCE.SCOPE_DRIFT).toBe('scope-drift');
    expect(DIVERGENCE.LOOP_DETECTED).toBe('loop-detected');
    expect(DIVERGENCE.ERROR_SPIRAL).toBe('error-spiral');
    expect(DIVERGENCE.PROGRESS_STALL).toBe('progress-stall');
    expect(DIVERGENCE.OFF_TOPIC).toBe('off-topic');
  });
});
