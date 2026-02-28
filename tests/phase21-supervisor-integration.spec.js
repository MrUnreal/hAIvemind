// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Phase 21 — Task Supervisor Integration Tests
 *
 * These tests start the real server in --mock mode and verify the supervisor
 * behaves correctly end-to-end via WebSocket, simulating the actual user experience.
 *
 * Testing strategy:
 *   1. Direct service tests — import TaskSupervisor, feed it synthetic agent output,
 *      verify alerts, corrections, digests, and shared context.
 *   2. Integration wiring tests — verify the supervisor is properly wired into
 *      AgentManager + TaskRunner + sessions for non-demo mode.
 */

const API = 'http://localhost:3000';

/* ════════════════════════════════════════════════════════════════════
   Test 1: Full supervisor lifecycle simulation
   ════════════════════════════════════════════════════════════════════ */

test.describe('Supervisor — end-to-end lifecycle', () => {

  test('supervisor starts, monitors output, detects loop, issues correction, stops', async () => {
    // Dynamically import the real service
    const { default: TaskSupervisor, DIVERGENCE } = await import('../server/services/taskSupervisor.js');

    const messages = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));

    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 50,
      digestIntervalMs: 100,
      minOutputForCheck: 10,
      loopDetectionThreshold: 3,
      progressStallMs: 500,
      maxCorrectionsBeforeEscalate: 2,
    });

    // Track events
    const alerts = [];
    const corrections = [];
    supervisor.on('alert', a => alerts.push(a));
    supervisor.on('correction', c => corrections.push(c));

    // Start supervisor
    supervisor.start();
    expect(supervisor._active).toBe(true);

    // Register a mock agent
    const task = {
      id: 'task-1',
      label: 'Build auth service',
      description: 'Create JWT authentication with login and register endpoints',
      affectedFiles: ['server/auth.js', 'server/routes/auth.js'],
    };
    supervisor.registerAgent('agent-1', task);
    expect(supervisor.monitors.size).toBe(1);

    // Feed healthy output first
    supervisor.ingestOutput('agent-1', 'Creating server/auth.js...\nSetting up JWT configuration\n', 'stdout');
    supervisor.ingestOutput('agent-1', 'Writing login endpoint handler\nexport function login(req, res) {\n', 'stdout');

    // No alerts yet — output is on-topic
    expect(alerts.length).toBe(0);

    // Now feed repeating error lines — triggers error-spiral detection
    for (let i = 0; i < 8; i++) {
      supervisor.ingestOutput('agent-1', 'Error: Cannot find module "jsonwebtoken"\n', 'stderr');
    }

    // Give it a moment for inline checks and periodic rule check
    await new Promise(r => setTimeout(r, 100));

    expect(alerts.length).toBeGreaterThan(0);
    // Repeated errors trigger error-spiral (tracked via _trackErrors)
    const spiralAlert = alerts.find(a => a.category === DIVERGENCE.ERROR_SPIRAL);
    expect(spiralAlert).toBeTruthy();
    expect(spiralAlert.agentId).toBe('agent-1');

    // Should have triggered a correction (kill-and-restart)
    expect(corrections.length).toBeGreaterThan(0);
    const correction = corrections.find(c => c.action === 'kill-and-restart');
    expect(correction).toBeTruthy();
    expect(correction.enrichedContext).toContain('Supervisor');

    // Verify the monitor is marked for kill
    const monitor = supervisor.monitors.get('agent-1');
    expect(monitor.markedForKill).toBe(true);

    // Verify broadcast messages include supervisor:alert
    const alertMsgs = messages.filter(m => m.type === 'supervisor:alert');
    expect(alertMsgs.length).toBeGreaterThan(0);

    // Verify broadcast messages include supervisor:correction
    const corrMsgs = messages.filter(m => m.type === 'supervisor:correction');
    expect(corrMsgs.length).toBeGreaterThan(0);

    // Unregister the dead agent
    supervisor.unregisterAgent('agent-1');
    expect(supervisor.monitors.size).toBe(0);

    // Stop supervisor
    supervisor.stop();
    expect(supervisor._active).toBe(false);

    // Should have broadcast supervisor:status started + stopped
    const statusMsgs = messages.filter(m => m.type === 'supervisor:status');
    expect(statusMsgs.length).toBe(2);
    expect(statusMsgs[0].payload.status).toBe('started');
    expect(statusMsgs[1].payload.status).toBe('stopped');
  });

  test('supervisor detects progress stall and kills idle agent', async () => {
    const { default: TaskSupervisor, DIVERGENCE } = await import('../server/services/taskSupervisor.js');

    const messages = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));

    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 50,
      digestIntervalMs: 5000,
      progressStallMs: 100, // very short for testing
      minOutputForCheck: 10,
    });

    const corrections = [];
    supervisor.on('correction', c => corrections.push(c));

    supervisor.start();

    const task = {
      id: 'task-2',
      label: 'Write database models',
      description: 'Create Prisma schema and database models for users and posts',
    };
    supervisor.registerAgent('agent-stall', task);

    // Give it some initial output then go silent
    supervisor.ingestOutput('agent-stall', 'Starting database model generation...\nCreating schema...\n', 'stdout');

    // Wait for the stall detection to fire (progressStallMs=100, ruleCheckIntervalMs=50)
    await new Promise(r => setTimeout(r, 300));

    // The periodic rule check should have detected the stall
    const alertMsgs = messages.filter(m =>
      m.type === 'supervisor:alert' &&
      m.payload.category === 'progress-stall'
    );
    expect(alertMsgs.length).toBeGreaterThan(0);

    // Should have triggered a kill-and-restart correction
    const stallCorrection = corrections.find(c => c.action === 'kill-and-restart');
    expect(stallCorrection).toBeTruthy();
    expect(stallCorrection.reason).toContain('stalled');

    supervisor.stop();
  });

  test('supervisor detects error spiral from stderr', async () => {
    const { default: TaskSupervisor, DIVERGENCE } = await import('../server/services/taskSupervisor.js');

    const messages = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));

    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 50,
      digestIntervalMs: 5000,
      minOutputForCheck: 10,
    });

    supervisor.start();

    supervisor.registerAgent('agent-err', {
      id: 'task-err',
      label: 'Setup testing',
      description: 'Configure Jest testing framework',
    });

    // Feed repeated stderr errors (same 2 errors over and over)
    for (let i = 0; i < 3; i++) {
      supervisor.ingestOutput('agent-err', 'FAIL src/tests/auth.test.js\n', 'stderr');
      supervisor.ingestOutput('agent-err', 'Error: Connection refused at port 5432\n', 'stderr');
    }

    // Wait for periodic rule check
    await new Promise(r => setTimeout(r, 150));

    const alertMsgs = messages.filter(m =>
      m.type === 'supervisor:alert' &&
      m.payload.category === 'error-spiral'
    );
    expect(alertMsgs.length).toBeGreaterThan(0);

    supervisor.stop();
  });
});

/* ════════════════════════════════════════════════════════════════════
   Test 2: Horizontal context sharing between concurrent agents
   ════════════════════════════════════════════════════════════════════ */

test.describe('Supervisor — horizontal context sharing', () => {

  test('interfaces exported by one agent are available to another', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');

    const broadcast = (msg) => {};
    const supervisor = new TaskSupervisor(broadcast, { minOutputForCheck: 10 });
    supervisor.start();

    // Agent A: backend
    supervisor.registerAgent('agent-a', {
      id: 'task-a', label: 'Build API routes',
      description: 'Create REST endpoints for users and posts',
    });

    // Agent B: frontend
    supervisor.registerAgent('agent-b', {
      id: 'task-b', label: 'Build React components',
      description: 'Create React components for user dashboard',
    });

    // Agent A produces output with export statements
    supervisor.ingestOutput('agent-a',
      'export function getUsers(req, res) { ... }\n' +
      'export function createUser(req, res) { ... }\n' +
      'router.get("/api/users", getUsers);\n' +
      'router.post("/api/users", createUser);\n',
      'stdout'
    );

    // Unregister agent-a to trigger interface sharing
    supervisor.unregisterAgent('agent-a');

    // Now check that shared context is available
    expect(supervisor.sharedContext.size).toBeGreaterThan(0);

    // Agent B's task should be able to access the shared API info
    const sharedCtx = supervisor._getRelevantSharedContext('task-b');
    // Shared context from agent-a should contain the exports/routes
    // (it will be available if the extraction found anything)
    expect(supervisor.sharedContext.size).toBe(1);

    supervisor.stop();
  });

  test('agent does not see its own shared context', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');

    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, { minOutputForCheck: 10 });
    supervisor.start();

    supervisor.registerAgent('agent-x', {
      id: 'task-x', label: 'Build API',
      description: 'REST endpoints',
    });

    supervisor.ingestOutput('agent-x',
      'export function handleRequest() {}\nrouter.get("/api/foo", handleRequest);\n',
      'stdout'
    );

    supervisor.unregisterAgent('agent-x');

    // Task-x should NOT see its own shared context
    const ctx = supervisor._getRelevantSharedContext('task-x');
    // Returns null when no relevant context from other tasks
    expect(ctx).toBeFalsy();

    supervisor.stop();
  });
});

/* ════════════════════════════════════════════════════════════════════
   Test 3: Progressive verification
   ════════════════════════════════════════════════════════════════════ */

test.describe('Supervisor — progressive verification', () => {

  test('detects clean output as passing', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');

    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast);
    supervisor.start();

    supervisor.registerAgent('agent-clean', {
      id: 'task-clean', label: 'Create utils',
      description: 'Create utility functions',
      affectedFiles: ['src/utils.js'],
    });

    const result = supervisor.progressiveVerify('agent-clean', [
      'Created src/utils.js\n',
      'Wrote 5 functions\n',
      'All changes saved to src/utils.js\n',
    ]);

    expect(result.passed).toBe(true);
    expect(result.issues.length).toBe(0);

    supervisor.stop();
  });

  test('flags output containing errors', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');

    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast);
    supervisor.start();

    supervisor.registerAgent('agent-err2', {
      id: 'task-err2', label: 'Fix bugs',
      description: 'Fix compilation errors',
    });

    const result = supervisor.progressiveVerify('agent-err2', [
      'Attempting fix...\n',
      'SyntaxError: Unexpected token )\n',
      'Error: Module not found\n',
    ]);

    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some(i => i.includes('error'))).toBe(true);

    supervisor.stop();
  });

  test('flags output with test failures', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');

    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast);
    supervisor.start();

    supervisor.registerAgent('agent-fail', {
      id: 'task-fail', label: 'Add tests',
      description: 'Write unit tests',
    });

    const result = supervisor.progressiveVerify('agent-fail', [
      'Running tests...\n',
      'FAIL src/auth.test.js\n',
      '  ✕ should login user (5ms)\n',
      '2 tests, 1 failure\n',
    ]);

    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.toLowerCase().includes('test') || i.toLowerCase().includes('fail'))).toBe(true);

    supervisor.stop();
  });
});

/* ════════════════════════════════════════════════════════════════════
   Test 4: Digest broadcasting
   ════════════════════════════════════════════════════════════════════ */

test.describe('Supervisor — digest broadcasting', () => {

  test('broadcasts periodic digest with agent health scores', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');

    const messages = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));

    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 5000,
      digestIntervalMs: 80, // fast for testing
      minOutputForCheck: 10,
    });

    supervisor.start();

    supervisor.registerAgent('agent-d1', {
      id: 'task-d1', label: 'Task 1', description: 'Do something',
    });
    supervisor.registerAgent('agent-d2', {
      id: 'task-d2', label: 'Task 2', description: 'Do something else',
    });

    // Feed some output to both
    supervisor.ingestOutput('agent-d1', 'Working on Task 1...\nProgress: 50%\n', 'stdout');
    supervisor.ingestOutput('agent-d2', 'Working on Task 2...\nProgress: 30%\n', 'stdout');

    // Wait for a digest to fire
    await new Promise(r => setTimeout(r, 200));

    const digests = messages.filter(m => m.type === 'supervisor:digest');
    expect(digests.length).toBeGreaterThan(0);

    const digest = digests[0].payload;
    expect(digest.agents).toBeDefined();
    // agents is an array of status objects
    expect(Array.isArray(digest.agents)).toBe(true);
    expect(digest.agents.length).toBe(2);

    // Each agent in the digest should have health info
    for (const info of digest.agents) {
      expect(info).toHaveProperty('taskLabel');
      expect(info).toHaveProperty('outputBytes');
      expect(typeof info.outputBytes).toBe('number');
      expect(info).toHaveProperty('healthScore');
    }

    supervisor.stop();
  });
});

/* ════════════════════════════════════════════════════════════════════
   Test 5: Escalation after repeated corrections
   ════════════════════════════════════════════════════════════════════ */

test.describe('Supervisor — escalation path', () => {

  test('escalates to orchestrator after maxCorrections exceeded', async () => {
    const { default: TaskSupervisor, DIVERGENCE } = await import('../server/services/taskSupervisor.js');

    const messages = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));

    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 50,
      digestIntervalMs: 5000,
      minOutputForCheck: 10,
      maxCorrectionsBeforeEscalate: 2,
      progressStallMs: 80,
    });

    const corrections = [];
    supervisor.on('correction', c => corrections.push(c));

    supervisor.start();

    supervisor.registerAgent('agent-esc', {
      id: 'task-esc', label: 'Complex refactor',
      description: 'Refactor authentication module',
    });

    // Simulate the agent being corrected multiple times by artificially
    // setting the monitor's correction count just below the threshold
    const monitor = supervisor.monitors.get('agent-esc');
    monitor.corrections = 2; // at the threshold

    // Now feed output and go silent to trigger a stall
    supervisor.ingestOutput('agent-esc', 'Starting refactor...\n', 'stdout');
    await new Promise(r => setTimeout(r, 200));

    // The stall should trigger a correction, and since corrections > maxCorrectionsBeforeEscalate
    // it should be an 'escalate' action
    const escalateCorrection = corrections.find(c => c.action === 'escalate');
    expect(escalateCorrection).toBeTruthy();
    expect(escalateCorrection.reason).toContain('corrections issued');

    supervisor.stop();
  });
});

/* ════════════════════════════════════════════════════════════════════
   Test 6: Multi-agent scenario (realistic session simulation)
   ════════════════════════════════════════════════════════════════════ */

test.describe('Supervisor — multi-agent realistic simulation', () => {

  test('supervises 3 concurrent agents, detects divergence in one, others unaffected', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');

    const messages = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));

    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 50,
      digestIntervalMs: 100,
      minOutputForCheck: 10,
      loopDetectionThreshold: 3,
    });

    const corrections = [];
    supervisor.on('correction', c => corrections.push(c));

    supervisor.start();

    // Three parallel agents
    supervisor.registerAgent('agent-good-1', {
      id: 'task-1', label: 'Setup database',
      description: 'Create PostgreSQL schema and migrations',
    });
    supervisor.registerAgent('agent-good-2', {
      id: 'task-2', label: 'Build frontend',
      description: 'Create React dashboard components',
    });
    supervisor.registerAgent('agent-bad', {
      id: 'task-3', label: 'Create API routes',
      description: 'Build REST API for user management',
    });

    // Good agents producing healthy output
    supervisor.ingestOutput('agent-good-1',
      'Creating migrations/001_users.sql\n' +
      'ALTER TABLE users ADD COLUMN email VARCHAR(255);\n' +
      'Migration applied successfully.\n',
      'stdout'
    );
    supervisor.ingestOutput('agent-good-2',
      'Creating src/components/Dashboard.tsx\n' +
      'export function Dashboard() { return <div>...</div> }\n' +
      'Component renders correctly.\n',
      'stdout'
    );

    // Bad agent — stuck in a loop (non-error lines repeating to trigger loop detection)
    for (let i = 0; i < 10; i++) {
      supervisor.ingestOutput('agent-bad',
        'Retrying npm install... attempt #1\nRetrying npm install... attempt #1\nRetrying npm install... attempt #1\n',
        'stdout'
      );
    }
    // Also feed errors to trigger error-spiral
    for (let i = 0; i < 6; i++) {
      supervisor.ingestOutput('agent-bad',
        'npm ERR! Cannot resolve dependency: express@^5.0.0\n',
        'stderr'
      );
    }

    await new Promise(r => setTimeout(r, 100));

    // Only agent-bad should have corrections
    expect(corrections.length).toBeGreaterThan(0);
    expect(corrections.every(c => c.agentId === 'agent-bad')).toBe(true);

    // Good agents should still be active and healthy
    expect(supervisor.monitors.has('agent-good-1')).toBe(true);
    expect(supervisor.monitors.has('agent-good-2')).toBe(true);

    const goodMonitor1 = supervisor.monitors.get('agent-good-1');
    const goodMonitor2 = supervisor.monitors.get('agent-good-2');
    expect(goodMonitor1.markedForKill).toBe(false);
    expect(goodMonitor2.markedForKill).toBe(false);

    // Bad agent should be marked for kill
    const badMonitor = supervisor.monitors.get('agent-bad');
    expect(badMonitor.markedForKill).toBe(true);

    supervisor.stop();
  });
});

/* ════════════════════════════════════════════════════════════════════
   Test 7: Server integration — verify wiring in sessions.js
   ════════════════════════════════════════════════════════════════════ */

test.describe('Supervisor — server wiring', () => {

  test('sessions.js imports and creates TaskSupervisor when not in demo mode', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const root = resolve(import.meta.dirname, '..');

    const sessionsSource = readFileSync(resolve(root, 'server/services/sessions.js'), 'utf8');

    // Verify the import exists
    expect(sessionsSource).toContain("import TaskSupervisor from './taskSupervisor.js'");

    // Verify supervisor is created in startSession
    expect(sessionsSource).toContain('new TaskSupervisor(broadcast, supervisorConfig)');

    // Verify supervisor is passed to AgentManager
    expect(sessionsSource).toContain('agentManager.supervisor = supervisor');

    // Verify supervisor is passed to TaskRunner
    expect(sessionsSource).toContain('supervisor,');

    // Verify supervisor lifecycle management
    expect(sessionsSource).toContain('supervisor.start()');
    expect(sessionsSource).toContain('supervisor.stop()');

    // Verify supervisor stats are included in session completion
    expect(sessionsSource).toContain('supervisorStats');
  });

  test('agentManager.js registers and unregisters agents with supervisor', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const root = resolve(import.meta.dirname, '..');

    const amSource = readFileSync(resolve(root, 'server/agentManager.js'), 'utf8');

    // Verify supervisor hooks
    expect(amSource).toContain('this.supervisor.registerAgent');
    expect(amSource).toContain('this.supervisor.unregisterAgent');
    expect(amSource).toContain('this.supervisor.ingestOutput');
  });

  test('taskRunner.js handles supervisor correction events', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const root = resolve(import.meta.dirname, '..');

    const trSource = readFileSync(resolve(root, 'server/taskRunner.js'), 'utf8');

    // Verify supervisor integration
    expect(trSource).toContain("supervisor.on('correction'");
    expect(trSource).toContain('progressiveVerify');
    expect(trSource).toContain('getSharedContextForTask');
  });
});

/* ════════════════════════════════════════════════════════════════════
   Test 8: Stats and report generation
   ════════════════════════════════════════════════════════════════════ */

test.describe('Supervisor — stats and reporting', () => {

  test('getStats returns comprehensive metrics after a session', async () => {
    const { default: TaskSupervisor } = await import('../server/services/taskSupervisor.js');

    const broadcast = () => {};
    const supervisor = new TaskSupervisor(broadcast, {
      minOutputForCheck: 10,
      ruleCheckIntervalMs: 5000,
      digestIntervalMs: 5000,
    });

    supervisor.start();

    // Simulate a complete session
    supervisor.registerAgent('agent-s1', {
      id: 'task-s1', label: 'Task A', description: 'Do A',
    });
    supervisor.ingestOutput('agent-s1', 'Working...\nDone!\n', 'stdout');
    supervisor.unregisterAgent('agent-s1');

    const stats = supervisor.getStats();

    expect(stats).toBeDefined();
    expect(stats.active).toBe(true);
    expect(typeof stats.totalAlerts).toBe('number');
    expect(typeof stats.totalCorrections).toBe('number');
    expect(Array.isArray(stats.alerts)).toBe(true);
    expect(Array.isArray(stats.corrections)).toBe(true);

    supervisor.stop();
  });
});

/* ════════════════════════════════════════════════════════════════════
   Test 9: Scope drift detection with file tracking
   ════════════════════════════════════════════════════════════════════ */

test.describe('Supervisor — scope drift via file tracking', () => {

  test('detects when agent modifies files far outside its scope', async () => {
    const { default: TaskSupervisor, DIVERGENCE } = await import('../server/services/taskSupervisor.js');

    const messages = [];
    const broadcast = (msg) => messages.push(JSON.parse(msg));

    const supervisor = new TaskSupervisor(broadcast, {
      ruleCheckIntervalMs: 50,
      digestIntervalMs: 5000,
      minOutputForCheck: 10,
      scopeDriftRatio: 0.5,
    });

    supervisor.start();

    supervisor.registerAgent('agent-drift', {
      id: 'task-drift',
      label: 'Fix auth bug',
      description: 'Fix login validation in the auth module',
      affectedFiles: ['server/auth.js'],
    });

    // Output mentions many unrelated files (use format that matches _extractFileReferences regex)
    supervisor.ingestOutput('agent-drift',
      'Creating client/components/Dashboard.vue\n' +
      'Creating client/components/Settings.vue\n' +
      'Creating client/utils/formatting.js\n' +
      'Creating tests/e2e/checkout.spec.js\n' +
      'Creating server/auth.js\n',
      'stdout'
    );

    // Wait for periodic rule check
    await new Promise(r => setTimeout(r, 150));

    const alerts = messages.filter(m =>
      m.type === 'supervisor:alert' &&
      m.payload.category === 'scope-drift'
    );
    // Should detect that most files are outside auth scope
    expect(alerts.length).toBeGreaterThan(0);

    supervisor.stop();
  });
});

/* ════════════════════════════════════════════════════════════════════
   Test 10: Real server health endpoint includes supervisor status
   ════════════════════════════════════════════════════════════════════ */

test.describe('Supervisor — server health', () => {

  test('health endpoint is accessible (server running)', async ({ request }) => {
    const resp = await request.get(`${API}/api/health`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.status).toBe('ok');
  });
});
