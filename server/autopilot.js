/**
 * Phase 5.4 — Auto-Pilot Mode (Continuous Self-Improvement)
 *
 * Implements the "reflect → plan → build" cycle that drives
 * hAIvemind's continuous self-improvement loop.
 *
 * After each session completes:
 *   1. Reflect — analyze session metrics (retry rate, escalation, cost)
 *   2. Plan   — feed reflection + roadmap to a planner agent
 *   3. Build  — auto-submit the planned session
 *
 * Safety rails:
 *   - Max sessions per cycle (default 5)
 *   - Cost ceiling enforcement
 *   - Mandatory test pass before proceeding
 *   - Full decision logging to `.haivemind/autopilot-log.json`
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Build a reflection summary from metrics for the planner to consume.
 * @param {object} reflection — from generateReflection() or workspace.getReflections()
 * @param {object} [costSummary]
 * @returns {string} Compact text summary
 */
export function reflectionToPromptContext(reflection, costSummary) {
  if (!reflection) return 'No previous session data available.';

  const lines = [];
  lines.push(`Last session status: ${reflection.status || 'unknown'}`);
  if (reflection.taskCount) lines.push(`Tasks: ${reflection.successCount || 0}/${reflection.taskCount} succeeded`);
  if (reflection.retryRate != null) lines.push(`Retry rate: ${(reflection.retryRate * 100).toFixed(0)}%`);
  if (reflection.durationMs) lines.push(`Duration: ${(reflection.durationMs / 1000).toFixed(1)}s`);
  if (reflection.escalatedTasks?.length) {
    lines.push(`Escalated tasks: ${reflection.escalatedTasks.map(t => t.label || t.taskId).join(', ')}`);
  }
  if (reflection.tierUsage) {
    lines.push(`Tier usage: ${Object.entries(reflection.tierUsage).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  if (costSummary?.totalPremiumRequests) {
    lines.push(`Premium requests: ${costSummary.totalPremiumRequests}`);
  }
  return lines.join('\n');
}

/**
 * Build a planner prompt that proposes the next autopilot session.
 * @param {object} opts
 * @param {string} opts.projectSlug
 * @param {string} [opts.roadmapText] — contents of docs/roadmap.md if available
 * @param {string} [opts.reflectionContext] — from reflectionToPromptContext()
 * @param {string[]} [opts.previousPrompts] — prompts from recent sessions to avoid repeats
 * @returns {string}
 */
export function buildAutopilotPlannerPrompt({ projectSlug, roadmapText, reflectionContext, previousPrompts }) {
  let prompt = `You are the auto-pilot planner for the "${projectSlug}" project.\n\n`;

  prompt += 'Your job is to propose the SINGLE most impactful next improvement session.\n';
  prompt += 'Output a JSON object with: { "prompt": "<session prompt>", "reasoning": "<why this is the best next step>" }\n\n';

  if (roadmapText) {
    prompt += '=== ROADMAP ===\n';
    prompt += roadmapText.slice(0, 4000) + '\n\n';
  }

  if (reflectionContext) {
    prompt += '=== LAST SESSION METRICS ===\n';
    prompt += reflectionContext + '\n\n';
  }

  if (previousPrompts?.length) {
    prompt += '=== RECENT SESSIONS (do NOT repeat) ===\n';
    for (const p of previousPrompts.slice(-10)) {
      prompt += `- ${p}\n`;
    }
    prompt += '\n';
  }

  prompt += 'Respond ONLY with the JSON object. No markdown, no explanation outside the JSON.\n';
  return prompt;
}

/**
 * Run a complete autopilot cycle.
 *
 * @param {object} opts
 * @param {object} opts.workspace — WorkspaceManager instance
 * @param {string} opts.slug — project slug
 * @param {Function} opts.runSession — async (slug, prompt) => { exitCode, sessionId, costSummary }
 * @param {Function} [opts.planFn] — async (featureDescription, workDir) => planResult
 * @param {object} [opts.config] — { maxCycles: 5, costCeiling: null, requireTests: false }
 * @param {Function} [opts.log] — logging function
 * @returns {Promise<{ cycles: number, decisions: object[], stopped: string }>}
 */
export async function runAutopilotCycle({
  workspace,
  slug,
  runSession,
  planFn,
  config: cycleConfig = {},
  log = console.log,
}) {
  const maxCycles = cycleConfig.maxCycles ?? 5;
  const costCeiling = cycleConfig.costCeiling ?? null;
  const requireTests = cycleConfig.requireTests ?? false;

  const decisions = [];
  let totalPremium = 0;
  let stoppedReason = 'completed';

  const project = workspace.getProject(slug);
  if (!project) throw new Error(`Project "${slug}" not found`);

  // Try to load roadmap
  let roadmapText = '';
  try {
    const roadmapPath = path.join(project.dir, 'docs', 'roadmap.md');
    roadmapText = await fs.readFile(roadmapPath, 'utf8');
  } catch {
    // No roadmap — fine
  }

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    log(`\n[autopilot] Cycle ${cycle + 1}/${maxCycles}`);

    // 1. Reflect — get latest reflection
    const reflections = workspace.getReflections(slug, 1);
    const lastReflection = reflections[0] || null;
    const reflectionContext = reflectionToPromptContext(lastReflection);

    // Get recent session prompts to avoid repetition
    const sessions = workspace.listSessions(slug);
    const previousPrompts = sessions.slice(-10).map(s => s.prompt).filter(Boolean);

    // 2. Plan — decide what to build next
    let sessionPrompt;
    let reasoning;

    if (planFn) {
      // Use the real planner agent
      try {
        const plannerPrompt = buildAutopilotPlannerPrompt({
          projectSlug: slug,
          roadmapText,
          reflectionContext,
          previousPrompts,
        });
        const planResult = await planFn(plannerPrompt, project.dir);
        sessionPrompt = planResult?.prompt || planResult?.summary || 'Continue improving the codebase';
        reasoning = planResult?.reasoning || planResult?.approach || 'Auto-pilot planner decision';
      } catch (err) {
        log(`[autopilot] Planner failed: ${err.message}`);
        stoppedReason = `planner-error: ${err.message}`;
        break;
      }
    } else {
      // Fallback: use roadmap items or generic improvement
      sessionPrompt = `Continue improving ${slug}: fix issues, harden tests, improve code quality`;
      reasoning = 'No planner available — using generic improvement prompt';
    }

    log(`[autopilot] Plan: "${sessionPrompt.slice(0, 100)}"`);
    log(`[autopilot] Reasoning: ${reasoning.slice(0, 100)}`);

    const decision = {
      cycle: cycle + 1,
      timestamp: new Date().toISOString(),
      prompt: sessionPrompt,
      reasoning,
      result: null,
    };

    // 3. Cost check
    if (costCeiling && totalPremium >= costCeiling) {
      stoppedReason = `cost-ceiling-reached (${totalPremium} >= ${costCeiling})`;
      decision.result = { skipped: true, reason: stoppedReason };
      decisions.push(decision);
      log(`[autopilot] Cost ceiling reached. Stopping.`);
      break;
    }

    // 4. Build — run the session
    try {
      const result = await runSession(slug, sessionPrompt);
      decision.result = {
        exitCode: result.exitCode,
        sessionId: result.sessionId,
        costSummary: result.costSummary,
      };

      if (result.costSummary?.totalPremiumRequests) {
        totalPremium += result.costSummary.totalPremiumRequests;
      }

      log(`[autopilot] Session ${result.sessionId?.slice(0, 8)} finished (exit ${result.exitCode})`);

      // Stop on failure if required
      if (result.exitCode !== 0 && requireTests) {
        stoppedReason = `session-failed (exit ${result.exitCode})`;
        decisions.push(decision);
        log(`[autopilot] Session failed and requireTests=true. Stopping.`);
        break;
      }
    } catch (err) {
      decision.result = { error: err.message };
      decisions.push(decision);
      stoppedReason = `session-error: ${err.message}`;
      log(`[autopilot] Session error: ${err.message}. Stopping.`);
      break;
    }

    decisions.push(decision);
  }

  // Persist autopilot log
  try {
    const logDir = path.join(project.dir, '.haivemind');
    await fs.mkdir(logDir, { recursive: true });
    const logPath = path.join(logDir, 'autopilot-log.json');

    let existing = [];
    try {
      const raw = await fs.readFile(logPath, 'utf8');
      existing = JSON.parse(raw);
    } catch { /* first run */ }

    existing.push({
      runAt: new Date().toISOString(),
      slug,
      cycles: decisions.length,
      stoppedReason,
      decisions,
    });

    await fs.writeFile(logPath, JSON.stringify(existing, null, 2));
  } catch (err) {
    log(`[autopilot] Failed to save log: ${err.message}`);
  }

  return { cycles: decisions.length, decisions, stopped: stoppedReason };
}
