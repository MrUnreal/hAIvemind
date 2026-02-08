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
    featureName: 'project-templates',
    prompt: `Implement Project Templates for hAIvemind — a Vue 3 + Node.js project.

The project structure is:
- server/ — Node.js ES module backend with Express + WebSocket
- client/src/ — Vue 3 frontend
- shared/protocol.js — message types

Requirements:
1. Create a templates/ directory with 3 JSON template files:
   - templates/express-api.json — REST API tasks (setup, routes, auth middleware, error handling, tests)
   - templates/react-app.json — React SPA tasks (routing, state, API layer, components, styles)
   - templates/cli-tool.json — CLI tool tasks (arg parsing, commands, help, config, packaging)

2. Each template: { "name": "...", "description": "...", "stack": "...", "variables": [{"name": "projectName", "label": "Project Name", "default": "my-app"}], "tasks": [...] }
   Tasks follow same schema as decompose output: { id, label, description, dependencies: [] }

3. Add GET /api/templates endpoint in server/index.js — reads templates/ dir, returns array of templates.

4. In SESSION_START handler in server/index.js, accept optional templateId in payload. If provided, load template, substitute variables, skip decompose(), use template tasks directly.

Key constraints:
- ES modules only
- JSON files in templates/ directory
- Tasks in templates must be valid decompose output format`,
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
