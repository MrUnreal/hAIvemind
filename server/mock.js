/**
 * Mock orchestrator that returns a hardcoded plan for testing.
 * Usage: start server with DEMO=1 environment variable.
 */

export async function decomposeMock(userPrompt) {
  // Simulate thinking time
  await sleep(1500);

  return {
    tasks: [
      {
        id: 'task-1',
        label: 'Setup project structure',
        description: `Create the project directory structure and initialize package.json. Based on user request: "${userPrompt.slice(0, 100)}"`,
        dependencies: [],
      },
      {
        id: 'task-2',
        label: 'Implement backend API',
        description: 'Create Express server with REST endpoints. Set up routes, middleware, and basic error handling.',
        dependencies: ['task-1'],
      },
      {
        id: 'task-3',
        label: 'Create database schema',
        description: 'Define database models and set up migrations. Create tables for the core data entities.',
        dependencies: ['task-1'],
      },
      {
        id: 'task-4',
        label: 'Build frontend UI',
        description: 'Create the frontend application with components, pages, and routing. Connect to the backend API.',
        dependencies: ['task-2', 'task-3'],
      },
      {
        id: 'task-5',
        label: 'Add tests & documentation',
        description: 'Write unit tests for backend endpoints and frontend components. Add README documentation.',
        dependencies: ['task-4'],
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
  if (label.includes('setup') || label.includes('structure')) {
    return ['package.json', 'tsconfig.json', '.gitignore', 'README.md'];
  }
  if (label.includes('backend') || label.includes('api')) {
    return ['src/server.js', 'src/routes/index.js', 'src/middleware/auth.js', 'src/controllers/main.js'];
  }
  if (label.includes('database') || label.includes('schema')) {
    return ['src/models/schema.sql', 'src/models/index.js', 'src/migrations/001_init.js'];
  }
  if (label.includes('frontend') || label.includes('ui')) {
    return ['src/App.vue', 'src/components/Layout.vue', 'src/pages/Home.vue', 'src/api/client.js'];
  }
  if (label.includes('test')) {
    return ['tests/api.test.js', 'tests/ui.test.js', 'docs/README.md'];
  }
  return ['output.txt'];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
