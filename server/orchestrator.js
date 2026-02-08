import { spawn } from 'node:child_process';
import { getOrchestratorModel } from './config.js';

/**
 * Call the orchestrator (T3) model to decompose a user prompt into tasks.
 * Returns a plan: { tasks: [{ id, label, description, dependencies }] }
 */
export async function decompose(userPrompt, workDir) {
  const { modelName, modelConfig } = getOrchestratorModel();

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
You have access to the project's filesystem. Before planning tasks:
1. EXPLORE the existing project structure — list files, read key modules, understand the architecture.
2. RESPECT existing patterns — follow the code style, import conventions, and naming used in the project.
3. For MODIFICATION tasks: reference specific existing files and describe what to change (not just what to create).
4. For NEW features: identify where new code should live based on the existing structure.
5. Include an "affectedFiles" list in each task's JSON output so agents know exactly which files to read and modify.
6. NEVER recreate files that already exist — modify them in place.
7. The JSON schema for tasks with affectedFiles:
{
  "tasks": [
    {
      "id": "task-1",
      "label": "Short label",
      "description": "Detailed instructions...",
      "dependencies": [],
      "affectedFiles": ["path/to/file.js", "path/to/other.js"]
    }
  ]
}`;

  const prompt = `${systemPrompt}\n\n## User Request\n\n${userPrompt}`;
  // Use --silent for clean output (no stats), --allow-all for non-interactive
  // --add-dir gives the planner filesystem access to understand existing codebases
  const fullArgs = [...modelConfig.args, prompt, '--silent', '--allow-all', '--add-dir', workDir];

  console.log(`[orchestrator] Decomposing with ${modelName} (${modelConfig.multiplier}× cost)...`);

  return new Promise((resolve, reject) => {
    let output = '';

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

    child.on('close', (code) => {
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
      reject(new Error(`Failed to spawn orchestrator: ${err.message}`));
    });
  });
}

/**
 * Verify project quality after all tasks are completed.
 * Returns: { passed: boolean, issues: string[], followUpTasks: [] }
 */
export async function verify(plan, workDir) {
  const { modelConfig } = getOrchestratorModel();

  const taskList = plan.tasks.map(t => `- ${t.label}: ${t.description}`).join('\n');

  const prompt = `You are a senior software engineer doing a code review.
All tasks below have been completed by coding agents. Review the workspace and verify:
1. All expected files exist
2. No obvious syntax errors
3. Imports/requires are consistent between files
4. The project could plausibly run (try npm install, node entry point, etc.)

## Completed Tasks
${taskList}

## Instructions
Check the workspace files thoroughly. If you find issues, decompose EACH fix into a separate, independent task.
Each fix task must be fully self-contained — describe exactly what file to edit, what to change, and why.
Make fixes as parallel as possible (different files = different tasks).

Output ONLY valid JSON (no markdown fences):
{
  "passed": true or false,
  "issues": ["description of each issue found"],
  "followUpTasks": [
    {
      "id": "fix-1",
      "label": "Short description of fix",
      "description": "Detailed fix instructions — include exact file, what to change, expected result",
      "dependencies": []
    }
  ]
}
If everything looks good, set passed=true and empty arrays for issues and followUpTasks.
IMPORTANT: Each fix task should target ONE file or ONE concern. Do NOT bundle multiple fixes into one task.`;

  const fullArgs = [...modelConfig.args, prompt, '--silent', '--allow-all', '--add-dir', workDir];

  console.log(`[orchestrator] Running verification in ${workDir}...`);

  return new Promise((resolve) => {
    let output = '';
    const child = spawn(modelConfig.cmd, fullArgs, {
      cwd: workDir,
      env: { ...process.env },
    });

    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', () => {});

    child.on('close', () => {
      try {
        const result = parseJsonFromOutput(output);
        console.log(`[orchestrator] Verification: ${result.passed ? 'PASSED' : 'FAILED'} (${result.issues?.length || 0} issues)`);
        resolve(result);
      } catch {
        console.log(`[orchestrator] Could not parse verification output, assuming passed`);
        resolve({ passed: true, issues: [], followUpTasks: [] });
      }
    });

    child.on('error', () => {
      resolve({ passed: true, issues: [], followUpTasks: [] });
    });
  });
}

/**
 * Call the orchestrator to analyze a failure and produce a failure report.
 */
export async function analyzeFailure(task, agentOutput, workDir) {
  const { modelConfig } = getOrchestratorModel();

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
    const child = spawn(modelConfig.cmd, fullArgs, {
      cwd: workDir,
      env: { ...process.env },
    });

    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', () => {});

    child.on('close', () => {
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
