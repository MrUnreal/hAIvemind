/**
 * Mock orchestrator that returns a hardcoded plan for testing.
 * Usage: start server with DEMO=1 environment variable.
 */

export async function decomposeMock(userPrompt) {
  // Simulate thinking time
  await sleep(1500);

  // Detect iteration context (handleChatMessage prefixes with "The project already has")
  const isIteration = userPrompt.startsWith('The project already has');
  if (isIteration) return decomposeMockIteration(userPrompt);

  // Initial build: 13-task plan with multi-level splits and merges
  //
  //   Wave 0: task-1 (scaffold)
  //              │
  //   Wave 1: task-2 (backend API) ─── task-3 (frontend framework) ─── task-4 (database schema)
  //              │         │                │           │                    │
  //   Wave 2: task-5    task-6           task-7      task-8              task-9
  //           (auth)    (payments)       (dashboard) (settings)         (DB seed)
  //              └────┬────┘                └────┬────┘                    │
  //   Wave 3:   task-10                    task-11                        │
  //           (backend tests)           (frontend tests)                 │
  //              └──────────────┬────────────┘───────────────────────────┘
  //   Wave 4:              task-12 (E2E integration tests)
  //                            │
  //   Wave 5:              task-13 (final verification)
  //
  return {
    tasks: [
      {
        id: 'task-1',
        label: 'Scaffold project',
        description: `Create directory structure, package.json, tsconfig, linter config. Request: "${userPrompt.slice(0, 80)}"`,
        dependencies: [],
      },
      // Wave 1: 3-wide split
      {
        id: 'task-2',
        label: 'Backend API routes',
        description: 'Create Express server, route handlers, middleware stack. Exports: createApp() from src/server.js.',
        dependencies: ['task-1'],
      },
      {
        id: 'task-3',
        label: 'Frontend framework',
        description: 'Set up Vue/React app shell, routing, layout components, API client module.',
        dependencies: ['task-1'],
      },
      {
        id: 'task-4',
        label: 'Database schema & models',
        description: 'Define database schema, ORM models, connection pool, query builders.',
        dependencies: ['task-1'],
      },
      // Wave 2: 5-wide split (2 from backend, 2 from frontend, 1 from database)
      {
        id: 'task-5',
        label: 'Auth service',
        description: 'Implement JWT auth, login/register endpoints, password hashing, session management.',
        dependencies: ['task-2'],
      },
      {
        id: 'task-6',
        label: 'Payment service',
        description: 'Implement payment processing, Stripe integration, invoice generation, webhook handlers.',
        dependencies: ['task-2'],
      },
      {
        id: 'task-7',
        label: 'Dashboard page',
        description: 'Build main dashboard with charts, stats cards, real-time data feeds, responsive layout.',
        dependencies: ['task-3'],
      },
      {
        id: 'task-8',
        label: 'Settings page',
        description: 'Build user settings page with profile editor, preferences, notification toggles.',
        dependencies: ['task-3'],
      },
      {
        id: 'task-9',
        label: 'DB seed & migrations',
        description: 'Create migration scripts, seed data, test fixtures, rollback procedures.',
        dependencies: ['task-4'],
      },
      // Wave 3: 2-wide merge+test chains
      {
        id: 'task-10',
        label: 'Backend test suite',
        description: 'Write API tests for auth + payment endpoints, mock DB, test middleware chain.',
        dependencies: ['task-5', 'task-6'],
      },
      {
        id: 'task-11',
        label: 'Frontend test suite',
        description: 'Write component tests for dashboard + settings, test routing, mock API responses.',
        dependencies: ['task-7', 'task-8'],
      },
      // Wave 4: full merge
      {
        id: 'task-12',
        label: 'E2E integration tests',
        description: 'End-to-end tests: login flow → dashboard → settings → payment. Full stack with seeded DB.',
        dependencies: ['task-10', 'task-11', 'task-9'],
      },
      // Wave 5: final verification
      {
        id: 'task-13',
        label: 'Final verification',
        description: 'Run full CI suite: lint, type-check, unit tests, E2E tests. Verify build output.',
        dependencies: ['task-12'],
      },
    ],
  };
}

/**
 * Mock iteration decomposer — returns multi-chain plans for follow-up requests.
 * Alternates between different shapes to demonstrate varied parallelism.
 */
let iterCallCount = 0;
function decomposeMockIteration(userPrompt) {
  iterCallCount++;
  const variant = iterCallCount % 3;

  if (variant === 1) {
    // Two independent feature branches, each with implement→test, then merge
    //   [api-changes, ui-changes] → [api-tests, ui-tests] → integration-verify
    return {
      tasks: [
        {
          id: 'task-1',
          label: 'API endpoint changes',
          description: 'Add/modify REST endpoints for the requested feature.',
          dependencies: [],
        },
        {
          id: 'task-2',
          label: 'UI component changes',
          description: 'Add/modify frontend components and pages.',
          dependencies: [],
        },
        {
          id: 'task-3',
          label: 'API unit tests',
          description: 'Write tests for the new/changed API endpoints.',
          dependencies: ['task-1'],
        },
        {
          id: 'task-4',
          label: 'UI component tests',
          description: 'Write tests for the new/changed UI components.',
          dependencies: ['task-2'],
        },
        {
          id: 'task-5',
          label: 'Integration verify',
          description: 'Run full test suite and verify end-to-end.',
          dependencies: ['task-3', 'task-4'],
        },
      ],
    };
  }

  if (variant === 2) {
    // Deep pipeline with a mid-level 4-wide fan-out
    //   investigate → [fix-auth, fix-payments, fix-dashboard, fix-settings] → [regression-backend, regression-frontend] → verify
    return {
      tasks: [
        {
          id: 'task-1',
          label: 'Investigate root cause',
          description: 'Analyze logs, reproduce issues, identify affected code paths.',
          dependencies: [],
        },
        {
          id: 'task-2',
          label: 'Fix auth module',
          description: 'Patch authentication bugs found during investigation.',
          dependencies: ['task-1'],
        },
        {
          id: 'task-3',
          label: 'Fix payment module',
          description: 'Patch payment processing bugs found during investigation.',
          dependencies: ['task-1'],
        },
        {
          id: 'task-4',
          label: 'Fix dashboard rendering',
          description: 'Patch dashboard component bugs found during investigation.',
          dependencies: ['task-1'],
        },
        {
          id: 'task-5',
          label: 'Fix settings validation',
          description: 'Patch settings form validation bugs found during investigation.',
          dependencies: ['task-1'],
        },
        {
          id: 'task-6',
          label: 'Backend regression tests',
          description: 'Run backend test suite against auth + payment fixes.',
          dependencies: ['task-2', 'task-3'],
        },
        {
          id: 'task-7',
          label: 'Frontend regression tests',
          description: 'Run frontend test suite against dashboard + settings fixes.',
          dependencies: ['task-4', 'task-5'],
        },
        {
          id: 'task-8',
          label: 'Verify all fixes',
          description: 'Full regression: lint, type-check, E2E tests across all fixed modules.',
          dependencies: ['task-6', 'task-7'],
        },
      ],
    };
  }

  // variant === 0: Three independent feature tracks, each with its own test, then merge
  //   [feature-a, feature-b, feature-c] → [test-a, test-b, test-c] → final-verify
  return {
    tasks: [
      {
        id: 'task-1',
        label: 'Add theme provider',
        description: 'Create theme context/composable with light/dark mode toggle.',
        dependencies: [],
      },
      {
        id: 'task-2',
        label: 'Add notification system',
        description: 'Create toast/notification composable with animation stack.',
        dependencies: [],
      },
      {
        id: 'task-3',
        label: 'Add keyboard shortcuts',
        description: 'Create global keyboard shortcut handler with help dialog.',
        dependencies: [],
      },
      {
        id: 'task-4',
        label: 'Test theme system',
        description: 'Write tests for theme toggle, persistence, CSS variable injection.',
        dependencies: ['task-1'],
      },
      {
        id: 'task-5',
        label: 'Test notification system',
        description: 'Write tests for toast stack, auto-dismiss, animation timing.',
        dependencies: ['task-2'],
      },
      {
        id: 'task-6',
        label: 'Test keyboard shortcuts',
        description: 'Write tests for key bindings, input suppression, help dialog.',
        dependencies: ['task-3'],
      },
      {
        id: 'task-7',
        label: 'Final verification',
        description: 'Run full suite, verify no conflicts between new feature modules.',
        dependencies: ['task-4', 'task-5', 'task-6'],
      },
    ],
  };
}

/**
 * Mock agent spawner that simulates CLI output.
 * Returns a fake child-process-like interface.
 */
export function spawnMockAgent(task, modelName, tierName) {
  const lines = generateFakeOutput(task, modelName);
  let lineIndex = 0;
  let exited = false;

  const handlers = {
    stdout: [],
    stderr: [],
    close: [],
    error: [],
  };

  // Simulate output over time
  const interval = setInterval(() => {
    if (lineIndex >= lines.length) {
      if (!exited) {
        exited = true;
        clearInterval(interval);
        // 80% success rate for T0, 92% for T1, 97% for T2+
        // Slightly higher failure rate encourages swarm features: retries, escalation, task splitting
        const failChance = tierName === 'T0' ? 0.20 : tierName === 'T1' ? 0.08 : 0.03;
        const exitCode = Math.random() < failChance ? 1 : 0;
        for (const fn of handlers.close) fn(exitCode);
      }
      return;
    }

    const line = lines[lineIndex++];
    const stream = line.startsWith('[warn]') || line.startsWith('[error]') ? 'stderr' : 'stdout';
    for (const fn of handlers[stream]) fn(Buffer.from(line + '\n'));
  }, 200 + Math.random() * 300);

  return {
    stdout: { on: (evt, fn) => { if (evt === 'data') handlers.stdout.push(fn); } },
    stderr: { on: (evt, fn) => { if (evt === 'data') handlers.stderr.push(fn); } },
    on: (evt, fn) => {
      if (handlers[evt]) handlers[evt].push(fn);
    },
    kill: () => {
      clearInterval(interval);
      if (!exited) {
        exited = true;
        for (const fn of handlers.close) fn(1);
      }
    },
  };
}

function generateFakeOutput(task, modelName) {
  const sessionId = Math.random().toString(36).slice(2, 10);
  const lines = [
    `\x1b[90m[${ts()}]\x1b[0m Starting copilot-coding session \x1b[36m${sessionId}\x1b[0m`,
    `\x1b[90m[${ts()}]\x1b[0m Model: \x1b[33m${modelName}\x1b[0m`,
    `\x1b[90m[${ts()}]\x1b[0m Task: ${task.label}`,
    `\x1b[90m[${ts()}]\x1b[0m Reading workspace context...`,
    `\x1b[90m[${ts()}]\x1b[0m Collected \x1b[36m${3 + Math.floor(Math.random() * 12)}\x1b[0m relevant files (${(1.2 + Math.random() * 8).toFixed(1)}KB context)`,
    `\x1b[90m[${ts()}]\x1b[0m Sending request to \x1b[33m${modelName}\x1b[0m...`,
    ``,
  ];

  // Thinking / planning
  lines.push(`\x1b[90m[${ts()}]\x1b[0m \x1b[35mPlanning\x1b[0m Analyzing task requirements...`);
  lines.push(`\x1b[90m[${ts()}]\x1b[0m \x1b[35mPlanning\x1b[0m Identified ${2 + Math.floor(Math.random() * 4)} sub-steps`);
  lines.push(``);

  // File operations
  const files = generateFakeFiles(task);
  for (const file of files) {
    const lineCount = Math.floor(20 + Math.random() * 200);
    lines.push(`\x1b[90m[${ts()}]\x1b[0m \x1b[32mCreate\x1b[0m ${file}`);
    lines.push(`\x1b[90m         +${lineCount} lines\x1b[0m`);
  }

  lines.push(``);

  // Verification
  lines.push(`\x1b[90m[${ts()}]\x1b[0m \x1b[36mVerify\x1b[0m Running lint & type-check...`);
  lines.push(`\x1b[90m[${ts()}]\x1b[0m \x1b[32m✓\x1b[0m No errors found`);
  lines.push(``);

  // Summary
  const totalLines = files.length * (20 + Math.floor(Math.random() * 100));
  lines.push(`\x1b[90m[${ts()}]\x1b[0m \x1b[1mSummary:\x1b[0m Created \x1b[36m${files.length}\x1b[0m files, \x1b[36m+${totalLines}\x1b[0m lines`);
  lines.push(`\x1b[90m[${ts()}]\x1b[0m \x1b[32m✓ Task completed successfully\x1b[0m`);
  lines.push(`\x1b[90m[${ts()}]\x1b[0m Session \x1b[36m${sessionId}\x1b[0m finished in ${(2 + Math.random() * 6).toFixed(1)}s`);

  return lines;
}

function ts() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function generateFakeFiles(task) {
  const label = task.label.toLowerCase();
  if (label.includes('scaffold') || label.includes('setup') || label.includes('structure')) {
    return ['package.json', 'tsconfig.json', '.gitignore', 'README.md', 'src/index.js'];
  }
  if (label.includes('backend') && label.includes('route')) {
    return ['src/server.js', 'src/routes/index.js', 'src/middleware/cors.js', 'src/middleware/auth.js'];
  }
  if (label.includes('auth') && !label.includes('test')) {
    return ['src/services/auth.js', 'src/routes/auth.js', 'src/middleware/jwt.js', 'src/utils/hash.js'];
  }
  if (label.includes('payment') && !label.includes('test')) {
    return ['src/services/payment.js', 'src/routes/payment.js', 'src/webhooks/stripe.js', 'src/models/invoice.js'];
  }
  if (label.includes('dashboard') && !label.includes('test')) {
    return ['src/pages/Dashboard.vue', 'src/components/StatsCard.vue', 'src/components/Chart.vue', 'src/composables/useDashboard.js'];
  }
  if (label.includes('settings') && !label.includes('test')) {
    return ['src/pages/Settings.vue', 'src/components/ProfileEditor.vue', 'src/components/PreferencesForm.vue'];
  }
  if (label.includes('frontend') && label.includes('framework')) {
    return ['src/App.vue', 'src/router/index.js', 'src/components/Layout.vue', 'src/api/client.js'];
  }
  if (label.includes('database') || label.includes('schema') || label.includes('model')) {
    return ['src/models/schema.sql', 'src/models/index.js', 'src/db/connection.js'];
  }
  if (label.includes('seed') || label.includes('migration')) {
    return ['src/migrations/001_init.js', 'src/migrations/002_seed.js', 'src/fixtures/users.json', 'src/fixtures/products.json'];
  }
  if (label.includes('backend') && label.includes('test')) {
    return ['tests/auth.test.js', 'tests/payment.test.js', 'tests/middleware.test.js'];
  }
  if (label.includes('frontend') && label.includes('test')) {
    return ['tests/Dashboard.test.js', 'tests/Settings.test.js', 'tests/routing.test.js'];
  }
  if (label.includes('regression') && label.includes('backend')) {
    return ['tests/regression/auth.test.js', 'tests/regression/payment.test.js'];
  }
  if (label.includes('regression') && label.includes('frontend')) {
    return ['tests/regression/dashboard.test.js', 'tests/regression/settings.test.js'];
  }
  if (label.includes('e2e') || label.includes('integration') || label.includes('end-to-end')) {
    return ['tests/e2e/login-flow.test.js', 'tests/e2e/payment-flow.test.js', 'tests/e2e/settings-flow.test.js'];
  }
  if (label.includes('investigate') || label.includes('root cause')) {
    return ['docs/investigation-report.md', 'scripts/reproduce-bug.js'];
  }
  if (label.includes('fix')) {
    return ['src/fixes/patch.js', 'src/fixes/validation.js'];
  }
  if (label.includes('api') && label.includes('test')) {
    return ['tests/api/endpoints.test.js', 'tests/api/mocks.js'];
  }
  if (label.includes('ui') && label.includes('test')) {
    return ['tests/ui/components.test.js', 'tests/ui/snapshots.js'];
  }
  if (label.includes('test') || label.includes('verify') || label.includes('verification')) {
    return ['tests/suite.test.js', 'tests/integration.test.js', 'docs/test-report.md'];
  }
  if (label.includes('theme') || label.includes('style') || label.includes('dark')) {
    return ['src/composables/useTheme.js', 'src/assets/theme.css'];
  }
  if (label.includes('notification') || label.includes('toast')) {
    return ['src/composables/useToast.js', 'src/components/ToastContainer.vue'];
  }
  if (label.includes('keyboard') || label.includes('shortcut')) {
    return ['src/composables/useKeyboardShortcuts.js', 'src/components/ShortcutsHelp.vue'];
  }
  if (label.includes('api') || label.includes('endpoint')) {
    return ['src/routes/api.js', 'src/controllers/main.js'];
  }
  if (label.includes('component') || label.includes('ui') || label.includes('frontend')) {
    return ['src/components/Feature.vue', 'src/pages/NewPage.vue', 'src/api/client.js'];
  }
  if (label.includes('util') || label.includes('config') || label.includes('shared')) {
    return ['src/utils/index.js', 'src/utils/validators.js', 'src/config/defaults.js'];
  }
  return ['src/output.js', 'docs/notes.md'];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
