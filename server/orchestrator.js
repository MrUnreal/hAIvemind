import { spawn } from 'node:child_process';
import config, { getOrchestratorModel } from './config.js';
import { withTimeout } from './processTimeout.js';

/**
 * Planner mode: Research and evaluate a feature proposal before decomposing.
 * Uses T3 (expensive) model to deeply analyze the codebase and produce an implementation plan.
 * Returns: { summary, approach, risks, affectedFiles, estimatedTasks, recommendation }
 */
export async function plan(featureDescription, workDir) {
  const { modelName, modelConfig } = getOrchestratorModel();
  const timeoutMs = config.orchestratorTimeoutMs;
  const timeoutMinutes = Math.round(timeoutMs / 60000);

  const prompt = `You are a senior software architect evaluating a feature proposal for an existing codebase.
You have access to the project filesystem via --add-dir. Explore it thoroughly before responding.

## Feature Proposal
${featureDescription}

## Your Task
1. Explore the existing codebase structure, key files, and architecture patterns
2. Evaluate the feature's feasibility, complexity, and impact
3. Identify which files need modification and what new files are needed
4. Assess risks and potential breaking changes
5. Recommend the best implementation approach

Output ONLY valid JSON (no markdown fences, no preamble):
{
  "summary": "One-paragraph summary of what this feature does",
  "approach": "Recommended implementation strategy in 2-3 sentences",
  "risks": ["risk 1", "risk 2"],
  "affectedFiles": ["path/to/file.js"],
  "newFiles": ["path/to/new/file.js"],
  "estimatedTasks": 5,
  "complexity": "low|medium|high",
  "recommendation": "proceed|defer|redesign",
  "reasoning": "Why this recommendation"
}`;

  const fullArgs = [...modelConfig.args, prompt, '--silent', '--allow-all', '--add-dir', workDir];

  console.log(`[planner] Researching feature with ${modelName} (${modelConfig.multiplier}× cost)...`);

  return new Promise((resolve, reject) => {
    let output = '';
    let timedOut = false;
    const child = spawn(modelConfig.cmd, fullArgs, {
      cwd: workDir,
      env: { ...process.env },
    });

    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => {
      console.error(`[planner:stderr] ${data.toString().trim()}`);
    });

    withTimeout(child, timeoutMs, 'Planner').catch((err) => {
      if (err instanceof Error && err.message.includes('timed out')) {
        timedOut = true;
        reject(new Error(`Planning timed out after ${timeoutMinutes} minutes`));
      }
    });

    child.on('close', (code) => {
      if (timedOut) {
        return;
      }
      if (code !== 0) {
        return reject(new Error(`Planner exited with code ${code}`));
      }
      try {
        const result = parseJsonFromOutput(output);
        console.log(`[planner] Research complete — ${result.recommendation} (${result.complexity} complexity, ~${result.estimatedTasks} tasks)`);
        resolve(result);
      } catch (err) {
        reject(new Error(`Failed to parse planner output: ${err.message}\n\nRaw output:\n${output.slice(0, 500)}`));
      }
    });

    child.on('error', (err) => {
      if (timedOut) {
        return;
      }
      reject(new Error(`Failed to spawn planner: ${err.message}`));
    });
  });
}

/**
 * Call the orchestrator (T3) model to decompose a user prompt into tasks.
 * Returns a plan: { tasks: [{ id, label, description, dependencies }] }
 */
export async function decompose(userPrompt, workDir, { fileTree, skills } = {}) {
  const { modelName, modelConfig } = getOrchestratorModel();
  const timeoutMs = config.orchestratorTimeoutMs;
  const timeoutMinutes = Math.round(timeoutMs / 60000);

  const systemPrompt = `You are a senior software architect acting as a project planner for a MASSIVELY PARALLEL execution platform.
Given a user's project request, decompose it into concrete, implementable tasks that can run with MAXIMUM PARALLELISM.

## Core Philosophy — Parallelism First
This platform runs every independent task simultaneously via separate AI agents.
Your #1 goal is to MINIMIZE sequential dependency chains and MAXIMIZE parallel execution.
Think of yourself as an architect specifying contracts/interfaces upfront so builders can work in parallel.

## Rules for Maximum Parallelism
- Each task is a single, focused unit of work (one file, one feature, one concern).
- PRE-SPEC INTERFACES: In each task's description, fully specify the interfaces, function signatures, exports, and data shapes that other tasks will consume. This way modules can be built in parallel without waiting for each other.
- A task should ONLY depend on another task if it literally cannot proceed without that task's file output (e.g. it reads or imports a generated config file at build time).
- DO NOT add dependencies just because one module calls another — if you pre-spec the interface/contract in both task descriptions, they can be built in parallel.
- Example: if a CLI entry point imports from a library module, both can be built in parallel as long as both task descriptions specify the shared interface (function names, signatures, export names).
- The ONLY hard dependency is: if task B needs to read a file that task A generates AND B cannot proceed without that file's content being determined by A (e.g. package.json determines what packages are available).
- Be specific in descriptions: include file names, function signatures, API shapes, expected exports, and type contracts.
- Keep it practical: aim for 3-8 tasks for most projects.
- The LAST task should be a verification task that depends on ALL other tasks. It runs the project (e.g. runs tests, starts the server, or checks for syntax errors) to confirm everything works together. Give it a label like "Verify & test".
- Output ONLY valid JSON matching this schema (no markdown fences, no extra text):
{
  "tasks": [
    {
      "id": "task-1",
      "label": "Short human-readable label",
      "description": "Detailed implementation instructions including file names, function signatures, expected exports, interface contracts, and expected behavior...",
      "dependencies": []
    }
  ]
}

## Example of Good vs Bad Parallelism

BAD (sequential): package.json → utils.js → service.js → cli.js → verify
GOOD (parallel):   package.json → [utils.js, service.js, cli.js] → verify
                   (all three middle tasks specify their shared interfaces upfront and run in parallel)

## Working With Existing Codebases
When modifying an existing project (file tree provided below), reference specific files to modify. Include "affectedFiles" in each task. Never recreate existing files.

## CRITICAL OUTPUT RULES
- Your ENTIRE response must be ONLY the JSON object. No text before or after.
- No markdown fences. No commentary. No "let me look at" preamble. JUST the JSON.
- Keep each task description under 150 words to stay within output limits.`;

  let prompt = `${systemPrompt}\n\n## User Request\n\n${userPrompt}`;

  // If a file tree is provided, include it so the planner is codebase-aware
  if (fileTree) {
    prompt += `\n\n## Existing Project Structure\n\n\`\`\`\n${fileTree}\n\`\`\``;
  }

  // Phase 2: Inject persistent skills as project knowledge
  if (skills) {
    const skillLines = [];
    if (skills.buildCommands?.length) skillLines.push(`Build commands: ${skills.buildCommands.join(', ')}`);
    if (skills.testCommands?.length) skillLines.push(`Test commands: ${skills.testCommands.join(', ')}`);
    if (skills.lintCommands?.length) skillLines.push(`Lint commands: ${skills.lintCommands.join(', ')}`);
    if (skills.patterns?.length) skillLines.push(`Known patterns: ${skills.patterns.join('; ')}`);
    if (skillLines.length > 0) {
      prompt += `\n\n## Project Knowledge (from previous sessions)\n${skillLines.join('\n')}`;
    }
  }

  // Use --silent for clean output (no stats), --allow-all for non-interactive
  // Note: --add-dir is NOT passed here to avoid output truncation.
  // Instead, callers can pass fileTree for codebase context.
  const fullArgs = [...modelConfig.args, prompt, '--silent', '--allow-all'];

  console.log(`[orchestrator] Decomposing with ${modelName} (${modelConfig.multiplier}× cost)...`);

  return new Promise((resolve, reject) => {
    let output = '';
    let timedOut = false;

    const child = spawn(modelConfig.cmd, fullArgs, {
      cwd: workDir,
      env: { ...process.env },
    });

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      console.error(`[orchestrator:stderr] ${data.toString().trim()}`);
    });

    withTimeout(child, timeoutMs, 'Orchestrator decomposition').catch((err) => {
      if (err instanceof Error && err.message.includes('timed out')) {
        timedOut = true;
        reject(new Error(`Decomposition timed out after ${timeoutMinutes} minutes`));
      }
    });

    child.on('close', (code) => {
      if (timedOut) {
        return;
      }
      if (code !== 0) {
        return reject(new Error(`Orchestrator exited with code ${code}`));
      }

      try {
        // Try to extract JSON from the output (model may wrap it in markdown fences)
        const plan = parseJsonFromOutput(output);
        console.log(`[orchestrator] Decomposed into ${plan.tasks.length} tasks`);
        resolve(plan);
      } catch (err) {
        reject(new Error(`Failed to parse orchestrator output: ${err.message}\n\nRaw output:\n${output.slice(0, 500)}`));
      }
    });

    child.on('error', (err) => {
      if (timedOut) {
        return;
      }
      reject(new Error(`Failed to spawn orchestrator: ${err.message}`));
    });
  });
}

/**
 * Verify project quality after all tasks are completed.
 * Returns: { passed: boolean, issues: string[], followUpTasks: [] }
 */
export async function verify(plan, workDir, { skills } = {}) {
  const { modelConfig } = getOrchestratorModel();
  const timeoutMs = config.orchestratorTimeoutMs;
  const timeoutMinutes = Math.round(timeoutMs / 60000);

  const taskList = plan.tasks.map(t => `- ${t.label}: ${t.description}`).join('\n');

  // Phase 2: Build skills hint for verification
  let skillsHint = '';
  if (skills) {
    const lines = [];
    if (skills.testCommands?.length) lines.push(`Known test commands: ${skills.testCommands.join(', ')}`);
    if (skills.buildCommands?.length) lines.push(`Known build commands: ${skills.buildCommands.join(', ')}`);
    if (skills.lintCommands?.length) lines.push(`Known lint commands: ${skills.lintCommands.join(', ')}`);
    if (lines.length > 0) {
      skillsHint = `\n\n## Project Knowledge\nUse these known commands when possible:\n${lines.join('\n')}`;
    }
  }

  const prompt = `You are a senior software engineer doing a thorough code review with TEST-DRIVEN VERIFICATION.
All tasks below have been completed by coding agents. Your job:

1. Review the workspace files for correctness
2. WRITE AND RUN actual tests where possible (e.g. \`node -e "..."\`, \`node --check file.js\`, lint checks)
3. Try to start/build the project (npm install, node entry point, etc.)
4. Verify imports/exports consistency between modules
5. Check for missing files, syntax errors, and integration issues

## Test Strategy
- For each key module, run \`node --check <file>\` to verify syntax
- For Node.js projects, try \`node -e "import('./<entry>')"\` to test imports
- If a package.json has a test script, run it
- If there are no tests, create a simple smoke test and run it

## Completed Tasks
${taskList}

## Instructions
Check the workspace files thoroughly. If you find issues, decompose EACH fix into a separate task.
Include any test files you created in the workspace — they become part of the project.

Output ONLY valid JSON (no markdown fences):
{
  "passed": true or false,
  "testsRun": ["description of each test executed"],
  "issues": ["description of each issue found"],
  "followUpTasks": [
    {
      "id": "fix-1",
      "label": "Short description of fix",
      "description": "Detailed fix instructions",
      "dependencies": []
    }
  ]
}
If everything looks good, set passed=true. Each fix task should target ONE file.`;

  // Append skills hint if available
  const finalPrompt = skillsHint ? prompt + skillsHint : prompt;

  const fullArgs = [...modelConfig.args, finalPrompt, '--silent', '--allow-all', '--add-dir', workDir];

  console.log(`[orchestrator] Running verification in ${workDir}...`);

  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    const child = spawn(modelConfig.cmd, fullArgs, {
      cwd: workDir,
      env: { ...process.env },
    });

    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', () => {});

    withTimeout(child, timeoutMs, 'Verification').catch((err) => {
      if (err instanceof Error && err.message.includes('timed out')) {
        timedOut = true;
        console.warn(`[orchestrator] Verification timed out after ${timeoutMinutes} minutes`);
        resolve({ passed: false, issues: [`Verification timed out after ${timeoutMinutes} minutes`], followUpTasks: [] });
      }
    });

    child.on('close', (code) => {
      if (timedOut) {
        return;
      }
      try {
        const result = parseJsonFromOutput(output);
        console.log(`[orchestrator] Verification: ${result.passed ? 'PASSED' : 'FAILED'} (${result.issues?.length || 0} issues)`);
        resolve(result);
      } catch {
        // If we can't parse output, verification did NOT pass — don't assume success
        console.warn(`[orchestrator] Could not parse verification output (exit code ${code}), marking as failed`);
        resolve({ passed: false, issues: ['Verification process produced unparseable output'], followUpTasks: [] });
      }
    });

    child.on('error', (err) => {
      if (timedOut) {
        return;
      }
      console.error(`[orchestrator] Verification process error: ${err.message}`);
      resolve({ passed: false, issues: [`Verification process crashed: ${err.message}`], followUpTasks: [] });
    });
  });
}

/**
 * Call the orchestrator to analyze a failure and produce a failure report.
 */
export async function analyzeFailure(task, agentOutput, workDir) {
  const { modelConfig } = getOrchestratorModel();
  const timeoutMs = config.orchestratorTimeoutMs;
  const timeoutMinutes = Math.round(timeoutMs / 60000);

  const prompt = `You are analyzing a failed coding task. Given the task description and the agent's output,
produce a structured failure report as JSON.

## Task
Label: ${task.label}
Description: ${task.description}
Dependencies: ${JSON.stringify(task.dependencies)}

## Agent Output (last 3000 chars)
${agentOutput.slice(-3000)}

## Instructions
Analyze the failure and output ONLY valid JSON (no markdown fences):
{
  "failedTaskId": "${task.id}",
  "summary": "Brief description of what went wrong",
  "upstreamTaskId": "task-id-if-upstream-caused-this or null",
  "suggestedFix": "What needs to change to fix this",
  "category": "syntax|logic|dependency|integration|unknown"
}`;

  const fullArgs = [...modelConfig.args, prompt, '--silent', '--allow-all'];

  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    const child = spawn(modelConfig.cmd, fullArgs, {
      cwd: workDir,
      env: { ...process.env },
    });

    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', () => {});

    withTimeout(child, timeoutMs, 'Failure analysis').catch((err) => {
      if (err instanceof Error && err.message.includes('timed out')) {
        timedOut = true;
        console.warn(`[orchestrator] Failure analysis timed out after ${timeoutMinutes} minutes`);
        resolve({
          failedTaskId: task.id,
          summary: `Timed out after ${timeoutMinutes} minutes while analyzing failure`,
          upstreamTaskId: null,
          suggestedFix: 'Retry failure analysis with a longer timeout or inspect logs manually',
          category: 'unknown',
        });
      }
    });

    child.on('close', () => {
      if (timedOut) {
        return;
      }
      try {
        resolve(parseJsonFromOutput(output));
      } catch {
        resolve({
          failedTaskId: task.id,
          summary: 'Could not analyze failure',
          upstreamTaskId: null,
          suggestedFix: 'Manual review required',
          category: 'unknown',
        });
      }
    });

    child.on('error', () => {
      if (timedOut) {
        return;
      }
      resolve({
        failedTaskId: task.id,
        summary: 'Orchestrator spawn failed',
        upstreamTaskId: null,
        suggestedFix: 'Check CLI configuration',
        category: 'unknown',
      });
    });
  });
}

/**
 * Extract JSON from model output that may contain markdown fences or preamble.
 */
function parseJsonFromOutput(raw) {
  // Try direct parse first
  try {
    return JSON.parse(raw.trim());
  } catch { /* continue */ }

  // Try extracting from markdown code fences
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim());
  }

  // Try finding first { ... } block
  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return JSON.parse(raw.slice(braceStart, braceEnd + 1));
  }

  throw new Error('No valid JSON found in output');
}
