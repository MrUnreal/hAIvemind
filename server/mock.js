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

  // Initial build: 7-task plan with 4-wide parallel fan-out
  //
  //   task-1 (scaffold) ──┬── task-2 (backend API)  ──┐
  //                       ├── task-3 (database)       ├── task-6 (integration wiring)
  //                       ├── task-4 (frontend UI)    │        │
  //                       └── task-5 (config/utils) ──┘        v
  //                                                      task-7 (verify & test)
  //
  return {
    tasks: [
      {
        id: 'task-1',
        label: 'Scaffold project',
        description: `Create directory structure, package.json, tsconfig.json, and base config. Request: "${userPrompt.slice(0, 80)}"`,
        dependencies: [],
      },
      {
        id: 'task-2',
        label: 'Implement backend API',
        description: 'Create Express server with REST endpoints, middleware, error handling. Exports: createApp() from src/server.js.',
        dependencies: ['task-1'],
      },
      {
        id: 'task-3',
        label: 'Create database layer',
        description: 'Define models, schema, migrations, seed data. Exports: db object from src/models/index.js.',
        dependencies: ['task-1'],
      },
      {
        id: 'task-4',
        label: 'Build frontend UI',
        description: 'Create components, pages, routing, styles. Entry: src/App.vue. API client at src/api/client.js.',
        dependencies: ['task-1'],
      },
      {
        id: 'task-5',
        label: 'Shared utils & config',
        description: 'Create shared utilities, constants, validation helpers. Exports from src/utils/index.js.',
        dependencies: ['task-1'],
      },
      {
        id: 'task-6',
        label: 'Integration wiring',
        description: 'Wire backend routes to database, connect frontend API client to server endpoints. Import and integrate all modules.',
        dependencies: ['task-2', 'task-3', 'task-4', 'task-5'],
      },
      {
        id: 'task-7',
        label: 'Verify & test',
        description: 'Run lint, type-check, unit tests. Start server and verify all endpoints respond correctly.',
        dependencies: ['task-6'],
      },
    ],
  };
}

/**
 * Mock iteration decomposer — returns a smaller, focused plan for follow-up requests.
 * Alternates between different shapes to demonstrate varied parallelism.
 */
let iterCallCount = 0;
function decomposeMockIteration(userPrompt) {
  iterCallCount++;
  const variant = iterCallCount % 3;

  if (variant === 1) {
    // 3-wide parallel: implement change in multiple layers simultaneously
    return {
      tasks: [
        {
          id: 'task-1',
          label: 'Update backend logic',
          description: 'Modify server routes and controllers for the requested change.',
          dependencies: [],
        },
        {
          id: 'task-2',
          label: 'Update frontend components',
          description: 'Modify UI components, add new views or controls as needed.',
          dependencies: [],
        },
        {
          id: 'task-3',
          label: 'Update shared types & utils',
          description: 'Update shared interfaces, validation, and utility functions.',
          dependencies: [],
        },
        {
          id: 'task-4',
          label: 'Verify iteration',
          description: 'Run tests, lint, and verify the changes work end-to-end.',
          dependencies: ['task-1', 'task-2', 'task-3'],
        },
      ],
    };
  }

  if (variant === 2) {
    // Diamond: config → [2 parallel changes] → verify
    return {
      tasks: [
        {
          id: 'task-1',
          label: 'Update config & schemas',
          description: 'Modify configuration files and data schemas for the new feature.',
          dependencies: [],
        },
        {
          id: 'task-2',
          label: 'Implement server changes',
          description: 'Update API endpoints and business logic.',
          dependencies: ['task-1'],
        },
        {
          id: 'task-3',
          label: 'Implement UI changes',
          description: 'Update frontend components and styling for the new feature.',
          dependencies: ['task-1'],
        },
        {
          id: 'task-4',
          label: 'Update tests',
          description: 'Add and update tests for the changed functionality.',
          dependencies: ['task-2', 'task-3'],
        },
        {
          id: 'task-5',
          label: 'Verify iteration',
          description: 'Run full test suite, lint, and verify integration.',
          dependencies: ['task-4'],
        },
      ],
    };
  }

  // variant === 0: wide fan-out from scratch (e.g. "add dark mode" touches many files)
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
        label: 'Update component styles',
        description: 'Apply theme-aware CSS variables to all existing components.',
        dependencies: [],
      },
      {
        id: 'task-3',
        label: 'Add settings persistence',
        description: 'Store theme preference in localStorage and load on startup.',
        dependencies: [],
      },
      {
        id: 'task-4',
        label: 'Verify iteration',
        description: 'Test theme toggle, persistence, and visual regression check.',
        dependencies: ['task-1', 'task-2', 'task-3'],
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
        // 85% success rate for T0, 95% for T2+
        const failChance = tierName === 'T0' ? 0.15 : tierName === 'T1' ? 0.08 : 0.03;
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
    return ['package.json', 'tsconfig.json', '.gitignore', 'README.md'];
  }
  if (label.includes('backend') || label.includes('api') || label.includes('server')) {
    return ['src/server.js', 'src/routes/index.js', 'src/middleware/auth.js', 'src/controllers/main.js'];
  }
  if (label.includes('database') || label.includes('schema') || label.includes('model')) {
    return ['src/models/schema.sql', 'src/models/index.js', 'src/migrations/001_init.js'];
  }
  if (label.includes('frontend') || label.includes('ui') || label.includes('component')) {
    return ['src/App.vue', 'src/components/Layout.vue', 'src/pages/Home.vue', 'src/api/client.js'];
  }
  if (label.includes('test') || label.includes('verify')) {
    return ['tests/api.test.js', 'tests/ui.test.js', 'docs/README.md'];
  }
  if (label.includes('util') || label.includes('config') || label.includes('shared')) {
    return ['src/utils/index.js', 'src/utils/validators.js', 'src/config/defaults.js'];
  }
  if (label.includes('integration') || label.includes('wiring')) {
    return ['src/app.js', 'src/routes/wire.js', 'src/plugins/setup.js'];
  }
  if (label.includes('theme') || label.includes('style') || label.includes('dark')) {
    return ['src/composables/useTheme.js', 'src/assets/theme.css'];
  }
  if (label.includes('persist') || label.includes('storage') || label.includes('setting')) {
    return ['src/utils/storage.js', 'src/composables/useSettings.js'];
  }
  return ['output.txt'];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
