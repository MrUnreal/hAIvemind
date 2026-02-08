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
const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 min per feature
const features = [
  {
    featureName: 'process-timeouts',
    prompt: `Add configurable process timeouts to all CLI spawns in hAIvemind — a Node.js ES module project.

The project structure is:
- server/orchestrator.js — has decompose(), verify(), plan(), analyzeFailure() functions that spawn child processes via child_process.spawn()
- server/agentManager.js — has spawn() method that creates agent child processes via child_process.spawn()
- server/config.js — centralized configuration

PROBLEM: All child_process.spawn() calls wait indefinitely. A hung copilot CLI process freezes the entire session with no recovery.

Requirements:
1. In server/config.js, add timeout configuration:
   - agentTimeoutMs: 300000 (5 minutes) — timeout for agent processes
   - orchestratorTimeoutMs: 300000 (5 minutes) — timeout for decompose/verify/plan processes

2. In server/agentManager.js spawn() method:
   - After spawning the child process, start a setTimeout
   - If the timeout fires before the process exits, call child.kill('SIGTERM'), wait 5 seconds, then child.kill('SIGKILL') if still alive
   - Mark the agent as failed with a clear error message: "Agent timed out after X minutes"
   - Clean up event listeners

3. In server/orchestrator.js, for decompose(), verify(), plan(), and analyzeFailure():
   - Wrap each spawn in a timeout mechanism
   - If timeout fires, kill the child process and reject/resolve with a timeout error
   - For verify(): resolve with { passed: false, issues: ['Verification timed out after X minutes'] }
   - For decompose(): reject with Error('Decomposition timed out after X minutes')
   - For plan(): reject with Error('Planning timed out after X minutes')

4. Add a utility function in a new file server/processTimeout.js:
   - export function withTimeout(child, timeoutMs, label) — returns a Promise that rejects on timeout and kills the process
   - This avoids duplicating timeout logic in every function

Key constraints:
- ES modules only (import/export)
- Do NOT change the function signatures — only add timeout wrapping internally
- Use config values, not hardcoded timeouts
- child.kill('SIGTERM') first, then SIGKILL after grace period`,
    usePlanner: true,
  },
  {
    featureName: 'error-recovery-ui',
    prompt: `Improve error handling and recovery UX in hAIvemind — a Vue 3 + Node.js project.

The project structure is:
- client/src/App.vue — main application component
- client/src/composables/useWebSocket.js — WebSocket connection management (singleton, auto-reconnect)
- client/src/composables/useSession.js — reactive session state
- client/src/components/FlowCanvas.vue — DAG visualization
- shared/protocol.js — WebSocket message types

PROBLEM: When things go wrong, the user gets no useful feedback:
- session:error events only console.error, no visible message shown
- If decompose() fails during planning, the UI shows an infinite spinner forever
- When WebSocket disconnects, the user can still submit prompts that silently fail
- No retry mechanism after errors

Requirements:
1. In client/src/App.vue:
   - Add an error banner/toast that appears when session:error is received
   - Show the actual error message text from the payload
   - Add a "Retry" button that resets sessionStatus and shows the prompt input again
   - When sessionStatus is 'failed', show the error overlay INSTEAD of the planning spinner
   - Add a "New Session" button visible during error state

2. In client/src/composables/useWebSocket.js:
   - Make the send() function return false (and log a warning) if the connection is not open
   - Add a 'connectionLost' reactive ref that is true while reconnecting
   - Add exponential backoff to the reconnect logic (2s, 4s, 8s, up to 30s max)
   - Reset reconnect delay on successful connection

3. In client/src/App.vue:
   - Show a "Reconnecting..." overlay when connectionLost is true
   - Disable the prompt submit button when disconnected
   - After reconnecting, show a brief "Reconnected" notification

4. In client/src/composables/useSession.js:
   - Add a sessionError reactive ref (string or null)
   - Set it from the session:error handler
   - Clear it on resetSession() and new session start

Key constraints:
- Vue 3 Composition API with <script setup>
- ES modules only
- Dark theme styling consistent with existing (#0d0d14 backgrounds, #1a1a2e borders, #f44336 for errors)
- No new npm dependencies`,
    usePlanner: true,
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
