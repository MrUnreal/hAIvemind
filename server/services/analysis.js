/**
 * Post-session analysis helpers — Phase 6.8
 * Extracted from server/index.js (Phase 2 analysis logic).
 */

/**
 * Generate a reflection summary from a completed session.
 */
export function generateReflection(plan, agentManager, costSummary, session) {
  const agents = [...agentManager.agents.values()];
  const tasks = plan.tasks.filter(t => t.type !== 'prompt');

  const succeeded = agents.filter(a => a.status === 'success');
  const failed = agents.filter(a => a.status === 'failed');
  const totalRetries = agents.reduce((sum, a) => sum + a.retries, 0);
  const duration = session.createdAt
    ? Date.now() - session.createdAt
    : null;

  const tierUsage = {};
  for (const agent of agents) {
    tierUsage[agent.modelTier] = (tierUsage[agent.modelTier] || 0) + 1;
  }

  const escalatedTasks = [];
  const taskAgents = {};
  for (const agent of agents) {
    if (!taskAgents[agent.taskId] || agent.retries > taskAgents[agent.taskId].retries) {
      taskAgents[agent.taskId] = agent;
    }
  }
  for (const [taskId, agent] of Object.entries(taskAgents)) {
    if (agent.retries > 0) {
      const task = tasks.find(t => t.id === taskId);
      escalatedTasks.push({
        taskId,
        label: task?.label || taskId,
        retriesNeeded: agent.retries,
        finalTier: agent.modelTier,
      });
    }
  }

  return {
    status: failed.length > succeeded.length ? 'mostly-failed' : 'mostly-succeeded',
    durationMs: duration,
    taskCount: tasks.length,
    agentCount: agents.length,
    successCount: succeeded.length,
    failCount: failed.length,
    retryRate: agents.length > 0 ? +(totalRetries / agents.length).toFixed(2) : 0,
    tierUsage,
    escalatedTasks,
    costSummary: costSummary || null,
  };
}

/**
 * Extract discoverable skills from agent output (build/test/lint commands).
 */
export function extractSkills(agentManager) {
  const allOutput = [...agentManager.agents.values()]
    .flatMap(a => a.output)
    .join('\n');

  const skills = {
    buildCommands: [],
    testCommands: [],
    lintCommands: [],
    patterns: [],
  };

  const buildPatterns = [
    /(?:npm|yarn|pnpm)\s+run\s+build/g,
    /(?:npm|yarn|pnpm)\s+run\s+dev/g,
    /tsc\b/g,
    /vite\s+build/g,
    /webpack\b/g,
    /cargo\s+build/g,
    /go\s+build/g,
    /make\b(?:\s+\w+)?/g,
    /python\s+setup\.py\s+build/g,
    /pip\s+install/g,
  ];

  const testPatterns = [
    /(?:npm|yarn|pnpm)\s+(?:run\s+)?test/g,
    /(?:npx\s+)?(?:jest|vitest|mocha|playwright|pytest|cargo\s+test|go\s+test)/g,
    /node\s+--test/g,
  ];

  const lintPatterns = [
    /(?:npm|yarn|pnpm)\s+run\s+lint/g,
    /(?:npx\s+)?(?:eslint|prettier|biome|rustfmt)/g,
  ];

  for (const pat of buildPatterns) {
    const matches = allOutput.match(pat);
    if (matches) skills.buildCommands.push(...matches);
  }
  for (const pat of testPatterns) {
    const matches = allOutput.match(pat);
    if (matches) skills.testCommands.push(...matches);
  }
  for (const pat of lintPatterns) {
    const matches = allOutput.match(pat);
    if (matches) skills.lintCommands.push(...matches);
  }

  skills.buildCommands = [...new Set(skills.buildCommands)];
  skills.testCommands = [...new Set(skills.testCommands)];
  skills.lintCommands = [...new Set(skills.lintCommands)];

  return skills;
}
