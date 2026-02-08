#!/usr/bin/env node
/**
 * Self-development client — connects to hAIvemind and triggers
 * feature implementation via SELFDEV_START, then monitors progress.
 *
 * Resilient reconnection: exponential backoff, tracks which feature
 * was in-flight so it can resume on reconnect, and gives up after
 * a configurable number of consecutive failures.
 */

import WebSocket from 'ws';

const WS_URL = process.env.HAIVEMIND_WS || 'ws://localhost:3000/ws';
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30000;
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 min per feature
const features = [
  {
    featureName: 'session-locking',
    prompt: `Add session locking to prevent concurrent sessions on the same project workspace in hAIvemind — a Node.js ES module project.

The project structure is:
- server/index.js — main server file with Express + WebSocket. Has a startSession() async function, \`sessions\` Map (sessionId → session object), \`taskToSession\` Map, \`activeContexts\` Map. The startSession function calls workspace.startSession() which returns { sessionId, workDir, session }.
- server/workspace.js — WorkspaceManager class with startSession(), getProject(), etc.

PROBLEM: Two concurrent sessions on the same project will write to the same workDir simultaneously, causing file conflicts and corrupted output. There is NO guard preventing this.

Requirements:
1. In server/index.js, add a lock mechanism near the existing session Maps (around line 97):
   - Add a \`workDirLocks\` Map keyed by workDir (absolute path) → { sessionId, projectSlug, lockedAt: Date.now() }
   - Add function acquireLock(workDir, sessionId, projectSlug) — returns { locked: false } if acquired, or { locked: true, holder } if another session holds it
   - Add function releaseLock(workDir, sessionId) — only releases if the caller owns the lock

2. In the startSession() function (around line 268):
   - After calling workspace.startSession() to get the workDir, call acquireLock()
   - If locked, broadcast a session:error with a clear message: "Another session is already running on this workspace (started HH:MM:SS, project: <slug>)"
   - Return early without proceeding

3. In the startSession() function's success path (around line 362) and catch block (around line 370):
   - Call releaseLock(workDir, sessionId) in BOTH the success and error paths

4. Update the /api/health endpoint (around line 780) to include activeLocks: workDirLocks.size

Key constraints:
- ES modules only (import/export)
- Do NOT change any function signatures
- The lock is in-memory only (no filesystem locks)
- Keep changes minimal — only add the locking logic`,
    usePlanner: false,
  },
  {
    featureName: 'memory-management',
    prompt: `Add memory management to hAIvemind to prevent unbounded memory growth — a Node.js ES module project.

The project structure is:
- server/index.js — main server with \`sessions\` Map<string,object>, \`taskToSession\` Map<string,string>, \`activeContexts\` Map<string,object>, and broadcast() function
- server/agentManager.js — AgentManager class with \`this.agents\` Map<string,Agent> where each Agent has an \`output\` string array that grows unboundedly and a \`process\` property
- server/config.js — centralized config object exported as default

PROBLEM: 
- sessions Map grows forever (each session stores plan, timeline, agents data)
- taskToSession Map grows forever (every task ID ever created stays)
- AgentManager instances are created per-session but their agents Map is never cleaned
- Agent output arrays can grow huge (megabytes of stdout for long-running agents)
- No graceful shutdown: Ctrl+C leaves orphaned child processes
- activeContexts Map grows forever (one entry per project slug, but old entries are never removed)

Requirements:
1. In server/config.js, add configuration:
   - sessionRetentionMs: 30 * 60 * 1000 (30 minutes — how long completed sessions stay in memory)
   - maxAgentOutputBytes: 100 * 1024 (100KB cap per agent output buffer)

2. In server/index.js, add a session eviction mechanism:
   - Add a function pruneCompletedSessions() that iterates \`sessions\` Map:
     - For each session with status 'completed' or 'failed':
       - If (Date.now() - session.completedAt) > config.sessionRetentionMs, delete it from sessions
       - Also clean up its task IDs from taskToSession
   - Run pruneCompletedSessions() on an interval (every 5 minutes)
   - Store the interval ID so it can be cleared on shutdown

3. In server/index.js, add a completedAt timestamp:
   - When a session completes successfully (where stored.status = 'completed' is set), also set stored.completedAt = Date.now()
   - When a session fails (where stored.status = 'failed' is set), also set stored.completedAt = Date.now()

4. In server/agentManager.js, cap agent output:
   - In the stdout and stderr 'data' handlers (inside the spawn() method), BEFORE pushing to agent.output:
     - Calculate current total bytes: agent.output.reduce((acc, s) => acc + s.length, 0)
     - If total exceeds config.maxAgentOutputBytes (import from config.js), drop the oldest entries until under limit
   - Add a method killAll() that iterates this.agents, and for each agent with a non-null .process property, calls process.kill('SIGTERM')

5. In server/index.js, add graceful shutdown:
   - Add process.on('SIGTERM', gracefulShutdown) and process.on('SIGINT', gracefulShutdown)
   - gracefulShutdown(): log "Shutting down...", clear the prune interval, close the WebSocket server, close the HTTP server, process.exit(0)

Key constraints:
- ES modules only (import/export), project has "type": "module" in package.json
- Do NOT change any existing function signatures
- config.js exports a default object — add new fields to it
- Be careful with the agent output capping — still broadcast the chunk even if you're trimming the stored buffer`,
    usePlanner: false,
  },
  {
    featureName: 'ws-resilience',
    prompt: `Improve WebSocket resilience in hAIvemind — a Vue 3 + Node.js project.

The project structure is:
- client/src/composables/useWebSocket.js — singleton WebSocket module with connect(), on(), send(), connected ref, connectionLost ref. Uses handlers Map<string, callback[]>. Has exponential backoff reconnect already.
- server/index.js — WebSocket server with wss (WebSocketServer), clients Set<WebSocket>, broadcast() function. Has sessions Map and activeContexts Map.

CURRENT STATE of useWebSocket.js:
- It already has: connected ref, connectionLost ref, exponential backoff (2s → 30s), send() returns false if not open
- handlers Map accumulates duplicate handlers on HMR/reconnect because on() just pushes without dedup

PROBLEMS TO FIX:
1. Handler accumulation: on() keeps pushing callbacks without any way to remove them. On Vite HMR, the module re-executes and registers duplicate handlers.
2. No message queuing: messages sent while disconnected are silently dropped (send returns false but caller doesn't retry)
3. No state re-sync: when a client reconnects mid-session, it has stale state — no mechanism to catch up
4. Server doesn't detect stale clients: dead WebSocket connections stay in the clients Set until the TCP timeout

Requirements:
1. In client/src/composables/useWebSocket.js:
   - Add an off(type, handler) function that removes a specific handler from the handlers Map
   - Add a pendingMessages array that buffers messages when disconnected
   - Modify send(): if socket not open, push { type, payload } to pendingMessages (up to 50 max) and return false
   - On successful reconnect (in socket.onopen), flush pendingMessages by sending each one, then clear the array
   - Export off alongside on, send, connected, connectionLost

2. In server/index.js:
   - Add WebSocket heartbeat/ping-pong to detect dead connections:
     - In the wss 'connection' handler, set ws.isAlive = true
     - Add ws.on('pong', () => { ws.isAlive = true; })
     - Set up an interval (every 30 seconds) that iterates clients:
       - If ws.isAlive === false, terminate the connection (ws.terminate()) and remove from clients Set
       - Otherwise, set ws.isAlive = false and call ws.ping()
     - Clear this interval on server close
   - Add a 'reconnect:sync' message handler:
     - When client sends { type: 'reconnect:sync', payload: { projectSlug } }
     - Look up the activeContext for that projectSlug
     - If found, send back the current session state: plan, task statuses, session status
     - This lets reconnected clients rebuild their UI state

3. In client/src/composables/useWebSocket.js:
   - On reconnect (socket.onopen), after flushing pending messages, send a 'reconnect:sync' message if there's an active project
   - To know the active project, accept an optional getActiveProject callback in useWebSocket() that returns the current projectSlug or null

Key constraints:
- Vue 3 Composition API, ES modules only
- useWebSocket.js is a singleton — connect() runs once, not per component
- The off() function should use Array.filter to remove the exact function reference
- Keep the existing exponential backoff logic intact
- shared/protocol.js has MSG constants and makeMsg/parseMsg — add new message types there if needed`,
    usePlanner: false,
  },
];

// ── State tracking ──
let currentFeatureIdx = 0;
let ws = null;
let sessionActive = false;
let reconnectAttempts = 0;
let sessionTimer = null;
let featureSentOnThisConnection = false;
const featureResults = [];

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(`\n💀 Gave up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts`);
    printSummary();
    process.exit(1);
  }
  const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS);
  reconnectAttempts++;
  console.log(`   Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
  setTimeout(connect, delay);
}

function resetSessionTimer() {
  if (sessionTimer) clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    console.error(`\n⏰ Feature "${features[currentFeatureIdx]?.featureName}" timed out after ${SESSION_TIMEOUT_MS / 60000}min`);
    featureResults.push({ passed: false, summary: 'Timed out' });
    sessionActive = false;
    currentFeatureIdx++;
    featureSentOnThisConnection = false;
    startNextFeature();
  }, SESSION_TIMEOUT_MS);
}

function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('🏁 SELF-DEV RUN SUMMARY');
  console.log('='.repeat(60));
  featureResults.forEach((r, i) => {
    console.log(`  ${r.passed ? '✅' : '❌'} ${features[i]?.featureName}: ${r.summary}`);
  });
  const remaining = features.slice(featureResults.length);
  if (remaining.length) {
    console.log(`  ⏸️  ${remaining.length} feature(s) not attempted: ${remaining.map(f => f.featureName).join(', ')}`);
  }
}

function connect() {
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log(`\n✅ Connected to hAIvemind (attempt ${reconnectAttempts || 1})`);
    reconnectAttempts = 0; // reset on successful connect
    featureSentOnThisConnection = false;

    // If a session was in flight when we disconnected, it's lost — move on
    if (sessionActive) {
      console.log(`   ⚠️ Previous session was in-flight, marking as failed and moving on`);
      featureResults.push({ passed: false, summary: 'Lost connection during execution' });
      sessionActive = false;
      currentFeatureIdx++;
    }
    startNextFeature();
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleMessage(msg);
    } catch (err) {
      console.error('   ⚠️ Bad message:', err.message);
    }
  });

  ws.on('error', (err) => {
    // Suppress ECONNREFUSED noise — scheduleReconnect handles it
    if (err.code !== 'ECONNREFUSED') {
      console.error('❌ WebSocket error:', err.message);
    }
  });

  ws.on('close', (code) => {
    console.log(`🔌 WebSocket closed (code ${code})`);
    ws = null;
    if (currentFeatureIdx < features.length || sessionActive) {
      scheduleReconnect();
    }
  });
}

function startNextFeature() {
  if (sessionTimer) clearTimeout(sessionTimer);

  if (currentFeatureIdx >= features.length) {
    printSummary();
    if (ws) ws.close();
    process.exit(0);
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log('   ⏳ Waiting for connection before starting next feature...');
    return; // connect() will call startNextFeature on open
  }

  // Guard against double-send on the same connection
  if (featureSentOnThisConnection) return;
  featureSentOnThisConnection = true;

  const feature = features[currentFeatureIdx];
  console.log('\n' + '='.repeat(60));
  console.log(`🚀 Starting self-dev: ${feature.featureName} (${currentFeatureIdx + 1}/${features.length})`);
  console.log('='.repeat(60));

  sessionActive = true;
  resetSessionTimer();

  ws.send(JSON.stringify({
    type: 'selfdev:start',
    payload: {
      featureName: feature.featureName,
      prompt: feature.prompt,
      usePlanner: feature.usePlanner ?? false,
    },
  }));
}

function handleMessage(msg) {
  const { type, payload } = msg;

  switch (type) {
    case 'plan:research':
      console.log(`\n🔬 PLANNER RESEARCH:`);
      console.log(`   Summary:    ${payload.research?.summary}`);
      console.log(`   Approach:   ${payload.research?.approach}`);
      console.log(`   Complexity: ${payload.research?.complexity}`);
      console.log(`   Tasks est:  ${payload.research?.estimatedTasks}`);
      break;

    case 'plan:created':
      console.log(`\n📋 PLAN: ${payload.tasks?.length} tasks`);
      payload.tasks?.forEach(t => {
        console.log(`   [${t.id}] ${t.label} (deps: ${t.dependencies?.join(', ') || 'none'})`);
      });
      break;

    case 'task:status':
      console.log(`   📌 Task ${payload.taskId}: ${payload.status}`);
      break;

    case 'agent:status': {
      const icon = payload.status === 'running' ? '🐝' :
                   payload.status === 'completed' ? '✅' :
                   payload.status === 'failed' ? '❌' : '⏳';
      const extra = payload.taskLabel ? ` (${payload.taskLabel})` : '';
      console.log(`   ${icon} Agent ${payload.agentId?.slice(0, 8)}: ${payload.status}${extra}`);
      if (payload.status === 'failed' && payload.error) {
        console.log(`      Error: ${payload.error}`);
      }
      break;
    }

    case 'verify:status':
      console.log(`\n🔍 VERIFY: ${payload.status} — ${payload.message}`);
      if (payload.issues?.length) {
        payload.issues.forEach(i => console.log(`      ⚠️ ${i}`));
      }
      break;

    case 'chat:response':
      console.log(`   💬 ${payload.content?.slice(0, 200)}`);
      break;

    case 'selfdev:diff':
      console.log(`\n📊 DIFF SUMMARY:\n${payload.diffSummary || '(no changes)'}`);
      break;

    case 'session:complete':
      if (sessionTimer) clearTimeout(sessionTimer);
      console.log(`\n✅ SESSION COMPLETE for ${features[currentFeatureIdx]?.featureName}`);
      featureResults.push({ passed: true, summary: 'Completed successfully' });
      sessionActive = false;
      currentFeatureIdx++;
      featureSentOnThisConnection = false;
      setTimeout(() => startNextFeature(), 2000);
      break;

    case 'session:error':
      if (sessionTimer) clearTimeout(sessionTimer);
      console.log(`\n❌ SESSION ERROR: ${payload.error}`);
      featureResults.push({ passed: false, summary: payload.error?.slice(0, 120) || 'Unknown error' });
      sessionActive = false;
      currentFeatureIdx++;
      featureSentOnThisConnection = false;
      setTimeout(() => startNextFeature(), 2000);
      break;

    case 'gate:request':
      console.log(`\n🚦 GATE REQUEST: ${payload.taskId} — auto-approving`);
      ws.send(JSON.stringify({
        type: 'gate:response',
        payload: { taskId: payload.taskId, approved: true, feedback: '' },
      }));
      break;

    default:
      // Silently ignore other message types
      break;
  }
}

// ── Go ──
console.log('🧬 hAIvemind Self-Development Client');
console.log(`   Features to implement: ${features.map(f => f.featureName).join(', ')}`);
console.log(`   Target: ${WS_URL}`);
connect();
