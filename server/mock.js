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

  // Initial build: 25-task enterprise platform plan with extreme parallelism
  //
  //   Wave 0: task-1 (scaffold)
  //               │
  //   Wave 1: task-2 (backend core) ── task-3 (frontend shell) ── task-4 (database) ── task-5 (infra/config)
  //               │                        │                         │                    │
  //   Wave 2: task-6  task-7  task-8  task-9  task-10  task-11  task-12  task-13  task-14  task-15
  //           (auth)  (pay)  (notify) (dash)  (settings)(admin) (search) (DB seed)(uploads)(cache)
  //           ──────10-wide maximum parallelism──────
  //              │      │       │        │       │        │        │       │         │       │
  //   Wave 3: task-16   task-17   task-18   task-19
  //           (be-test) (fe-test) (perf-test)(sec-audit)
  //              └──────┬──────┘──────┬──────┘
  //   Wave 4: task-20 (integration tests) ── task-21 (E2E tests)
  //              └────────┬────────┘
  //   Wave 5: task-22 (load tests) ── task-23 (security scan)
  //              └────────┬────────┘
  //   Wave 6: task-24 (staging deploy verify) → task-25 (final sign-off)
  //
  return {
    tasks: [
      {
        id: 'task-1',
        label: 'Scaffold project',
        description: `Create mono-repo structure, package.json workspaces, tsconfig, linter, Docker config. Request: "${userPrompt.slice(0, 80)}"`,
        dependencies: [],
      },
      // Wave 1: 4-wide foundation split
      {
        id: 'task-2',
        label: 'Backend core framework',
        description: 'Express server, route system, middleware stack, error handling, logger, health checks.',
        dependencies: ['task-1'],
      },
      {
        id: 'task-3',
        label: 'Frontend app shell',
        description: 'Vue/React app shell, router, layout system, API client, state management, theme provider.',
        dependencies: ['task-1'],
      },
      {
        id: 'task-4',
        label: 'Database layer',
        description: 'Database schema, ORM models, connection pool, query builder, migration framework.',
        dependencies: ['task-1'],
      },
      {
        id: 'task-5',
        label: 'Infrastructure & config',
        description: 'Environment config, secrets management, logging transport, feature flags, rate limiting setup.',
        dependencies: ['task-1'],
      },
      // Wave 2: 10-WIDE maximum parallelism burst
      {
        id: 'task-6',
        label: 'Auth service',
        description: 'JWT auth, login/register, OAuth2 providers, password hashing, session management, RBAC.',
        dependencies: ['task-2'],
      },
      {
        id: 'task-7',
        label: 'Payment service',
        description: 'Stripe integration, subscription management, invoice generation, webhook handlers, refunds.',
        dependencies: ['task-2'],
      },
      {
        id: 'task-8',
        label: 'Notification service',
        description: 'Email templates, push notifications, in-app alerts, notification preferences, queue system.',
        dependencies: ['task-2', 'task-5'],
      },
      {
        id: 'task-9',
        label: 'Dashboard page',
        description: 'Main dashboard with charts, KPI cards, data feeds, responsive layout, real-time updates.',
        dependencies: ['task-3'],
      },
      {
        id: 'task-10',
        label: 'Settings page',
        description: 'User settings, profile editor, preferences, billing info, notification toggles, API keys.',
        dependencies: ['task-3'],
      },
      {
        id: 'task-11',
        label: 'Admin panel',
        description: 'Admin dashboard, user management, audit logs, system health, feature flag toggles.',
        dependencies: ['task-3', 'task-5'],
      },
      {
        id: 'task-12',
        label: 'Search engine',
        description: 'Full-text search, filters, faceted search, autocomplete, search analytics, indexing.',
        dependencies: ['task-4'],
      },
      {
        id: 'task-13',
        label: 'DB seed & migrations',
        description: 'Migration scripts, seed data, test fixtures, rollback procedures, data validation.',
        dependencies: ['task-4'],
      },
      {
        id: 'task-14',
        label: 'File upload service',
        description: 'S3/local upload, image processing, thumbnails, virus scanning, storage quotas.',
        dependencies: ['task-2', 'task-5'],
      },
      {
        id: 'task-15',
        label: 'Cache layer',
        description: 'Redis caching, cache invalidation, session store, rate limit buckets, pub/sub setup.',
        dependencies: ['task-5'],
      },
      // Wave 3: 4-wide test phase (depends on Wave 2)
      {
        id: 'task-16',
        label: 'Backend test suite',
        description: 'API tests for auth, payment, notifications, file uploads. Mock DB, test middleware chain.',
        dependencies: ['task-6', 'task-7', 'task-8', 'task-14'],
      },
      {
        id: 'task-17',
        label: 'Frontend test suite',
        description: 'Component tests for dashboard, settings, admin. Test routing, mock API, snapshot tests.',
        dependencies: ['task-9', 'task-10', 'task-11'],
      },
      {
        id: 'task-18',
        label: 'Performance benchmarks',
        description: 'API latency benchmarks, DB query performance, cache hit rates, rendering performance.',
        dependencies: ['task-12', 'task-13', 'task-15'],
      },
      {
        id: 'task-19',
        label: 'Security audit',
        description: 'OWASP checks, dependency audit, SQL injection tests, XSS prevention, CSRF tokens, CSP headers.',
        dependencies: ['task-6', 'task-15'],
      },
      // Wave 4: Integration (depends on Wave 3)
      {
        id: 'task-20',
        label: 'Integration tests',
        description: 'Cross-service integration: auth→payment, dashboard→API, admin→audit, search→DB.',
        dependencies: ['task-16', 'task-17'],
      },
      {
        id: 'task-21',
        label: 'E2E test suite',
        description: 'Full user journeys: signup→login→dashboard→payment→settings. Playwright browser tests.',
        dependencies: ['task-17', 'task-18'],
      },
      // Wave 5: Deep validation (depends on Wave 4)
      {
        id: 'task-22',
        label: 'Load testing',
        description: 'k6/Artillery load tests: 1000 concurrent users, spike tests, soak tests, breaking point.',
        dependencies: ['task-20', 'task-19'],
      },
      {
        id: 'task-23',
        label: 'Security penetration test',
        description: 'Automated pen testing, auth bypass attempts, rate limit verification, data leak detection.',
        dependencies: ['task-19', 'task-21'],
      },
      // Wave 6: Final verification
      {
        id: 'task-24',
        label: 'Staging deploy verify',
        description: 'Deploy to staging, smoke tests, health checks, monitoring alerts, rollback test.',
        dependencies: ['task-22', 'task-23'],
      },
      {
        id: 'task-25',
        label: 'Final sign-off',
        description: 'Production readiness checklist, documentation review, changelog, release notes.',
        dependencies: ['task-24'],
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
    return ['package.json', 'tsconfig.json', '.gitignore', 'README.md', 'src/index.js', 'docker-compose.yml'];
  }
  if (label.includes('backend') && (label.includes('route') || label.includes('core') || label.includes('framework'))) {
    return ['src/server.js', 'src/routes/index.js', 'src/middleware/cors.js', 'src/middleware/auth.js', 'src/middleware/errors.js'];
  }
  if (label.includes('auth') && !label.includes('test') && !label.includes('security') && !label.includes('audit')) {
    return ['src/services/auth.js', 'src/routes/auth.js', 'src/middleware/jwt.js', 'src/utils/hash.js', 'src/models/user.js'];
  }
  if (label.includes('payment') && !label.includes('test')) {
    return ['src/services/payment.js', 'src/routes/payment.js', 'src/webhooks/stripe.js', 'src/models/invoice.js', 'src/models/subscription.js'];
  }
  if (label.includes('notification') && !label.includes('test') && !label.includes('toggle')) {
    return ['src/services/notification.js', 'src/routes/notifications.js', 'src/templates/email.js', 'src/queue/worker.js'];
  }
  if (label.includes('dashboard') && !label.includes('test') && !label.includes('admin')) {
    return ['src/pages/Dashboard.vue', 'src/components/StatsCard.vue', 'src/components/Chart.vue', 'src/composables/useDashboard.js'];
  }
  if (label.includes('settings') && !label.includes('test')) {
    return ['src/pages/Settings.vue', 'src/components/ProfileEditor.vue', 'src/components/PreferencesForm.vue'];
  }
  if (label.includes('admin') && !label.includes('test')) {
    return ['src/pages/Admin.vue', 'src/components/UserTable.vue', 'src/components/AuditLog.vue', 'src/routes/admin.js'];
  }
  if (label.includes('search') && !label.includes('test')) {
    return ['src/services/search.js', 'src/routes/search.js', 'src/indexer/indexer.js', 'src/components/SearchBar.vue'];
  }
  if (label.includes('upload') || label.includes('file') && !label.includes('test')) {
    return ['src/services/upload.js', 'src/routes/uploads.js', 'src/utils/image.js', 'src/middleware/multer.js'];
  }
  if (label.includes('cache') && !label.includes('test')) {
    return ['src/services/cache.js', 'src/middleware/cache.js', 'src/utils/redis.js', 'src/config/redis.js'];
  }
  if (label.includes('infrastructure') || label.includes('infra') || label.includes('config') && label.includes('service')) {
    return ['src/config/index.js', 'src/config/secrets.js', 'src/config/features.js', 'src/middleware/rateLimit.js'];
  }
  if (label.includes('frontend') && (label.includes('framework') || label.includes('shell') || label.includes('app'))) {
    return ['src/App.vue', 'src/router/index.js', 'src/components/Layout.vue', 'src/api/client.js', 'src/store/index.js'];
  }
  if (label.includes('database') || label.includes('schema') || label.includes('model') || label.includes('database layer')) {
    return ['src/models/schema.sql', 'src/models/index.js', 'src/db/connection.js', 'src/db/migrations.js'];
  }
  if (label.includes('seed') || label.includes('migration')) {
    return ['src/migrations/001_init.js', 'src/migrations/002_seed.js', 'src/fixtures/users.json', 'src/fixtures/products.json'];
  }
  if (label.includes('security') && (label.includes('audit') || label.includes('scan'))) {
    return ['tests/security/owasp.test.js', 'tests/security/xss.test.js', 'tests/security/csrf.test.js', 'reports/security-audit.md'];
  }
  if (label.includes('penetration') || label.includes('pen test')) {
    return ['tests/pentest/auth-bypass.test.js', 'tests/pentest/injection.test.js', 'tests/pentest/rate-limit.test.js'];
  }
  if (label.includes('load') && label.includes('test')) {
    return ['tests/load/k6-script.js', 'tests/load/spike-test.js', 'tests/load/soak-test.js', 'reports/load-results.json'];
  }
  if (label.includes('performance') || label.includes('benchmark')) {
    return ['tests/perf/api-latency.test.js', 'tests/perf/db-query.test.js', 'tests/perf/cache-hits.test.js'];
  }
  if (label.includes('staging') || label.includes('deploy')) {
    return ['scripts/deploy-staging.sh', 'scripts/smoke-test.js', 'scripts/health-check.js', 'k8s/staging.yaml'];
  }
  if (label.includes('sign-off') || label.includes('checklist') || label.includes('release')) {
    return ['docs/release-notes.md', 'docs/changelog.md', 'docs/production-checklist.md'];
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
