/**
 * WebSocket message handlers — Phase 6.8
 */

import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { MSG, makeMsg } from '../../shared/protocol.js';
import { sessions, activeContexts, refs } from '../state.js';
import { broadcast } from './broadcast.js';
import { startSession, handleChatMessage } from '../services/sessions.js';
import { plan } from '../orchestrator.js';
import log from '../logger.js';

/**
 * Handle an incoming WebSocket message from a client.
 */
export async function handleClientMessage(msg, ws) {
  const workspace = refs.workspace;

  if (msg.type === MSG.SESSION_START) {
    const { prompt, projectSlug, templateId, variables } = msg.payload || {};
    if (!prompt) {
      ws.send(makeMsg(MSG.SESSION_ERROR, { error: 'No prompt provided' }));
      return;
    }
    if (!projectSlug) {
      ws.send(makeMsg(MSG.SESSION_ERROR, { error: 'No project selected' }));
      return;
    }

    let predefinedPlan;
    if (templateId) {
      if (!/^[a-zA-Z0-9_-]+$/.test(templateId)) {
        ws.send(makeMsg(MSG.SESSION_ERROR, { error: 'Invalid template ID (alphanumeric, hyphens, underscores only)' }));
        return;
      }
      try {
        const templatesDir = resolve(process.cwd(), 'templates');
        const templatePath = join(templatesDir, `${templateId}.json`);
        const raw = await fs.readFile(templatePath, 'utf8');
        const template = JSON.parse(raw);

        if (!Array.isArray(template.tasks)) {
          ws.send(makeMsg(MSG.SESSION_ERROR, { error: `Template "${templateId}" is invalid (missing tasks array)` }));
          return;
        }

        const vars = variables && typeof variables === 'object' ? variables : {};
        const tasks = template.tasks.map((task) => {
          const t = { ...task };
          if (typeof t.description === 'string' && vars && Object.keys(vars).length > 0) {
            let desc = t.description;
            for (const [key, value] of Object.entries(vars)) {
              const token = `{{${key}}}`;
              if (desc.includes(token)) {
                const replacement = value == null ? '' : String(value);
                desc = desc.split(token).join(replacement);
              }
            }
            t.description = desc;
          }
          return t;
        });

        predefinedPlan = { ...template, tasks };
      } catch (err) {
        log.error(`[session] Failed to load template "${templateId}": ${err.message}`);
        ws.send(makeMsg(MSG.SESSION_ERROR, { error: `Failed to load template "${templateId}"` }));
        return;
      }
    }

    await startSession(prompt, projectSlug, predefinedPlan);
  }
  if (msg.type === MSG.SELFDEV_START) {
    const { featureName, prompt, usePlanner } = msg.payload || {};
    if (!prompt) {
      ws.send(makeMsg(MSG.SESSION_ERROR, { error: 'No prompt provided' }));
      return;
    }
    if (!featureName) {
      ws.send(makeMsg(MSG.SESSION_ERROR, { error: 'No featureName provided' }));
      return;
    }
    const repoRoot = process.cwd();
    const projectSlug = `selfdev-${featureName}`;

    let project = workspace.getProject(projectSlug);
    if (!project) {
      try {
        project = workspace.linkProject(projectSlug, repoRoot);
      } catch (err) {
        project = workspace.getProject(projectSlug);
        if (!project) {
          log.error(`[selfdev] Failed to link project: ${err.message}`);
          ws.send(makeMsg(MSG.SESSION_ERROR, { error: err.message }));
          return;
        }
      }
    }

    if (usePlanner) {
      try {
        broadcast(makeMsg(MSG.CHAT_RESPONSE, {
          projectSlug,
          role: 'assistant',
          content: `🔬 Planner mode: researching "${featureName}" with T3 model...`,
        }));
        const research = await plan(prompt, repoRoot);
        broadcast(makeMsg(MSG.PLAN_RESEARCH, { projectSlug, research }));
        broadcast(makeMsg(MSG.CHAT_RESPONSE, {
          projectSlug,
          role: 'assistant',
          content: `📋 **Plan: ${research.summary}**\n\n` +
            `Approach: ${research.approach}\n` +
            `Complexity: ${research.complexity} (~${research.estimatedTasks} tasks)\n` +
            `Recommendation: ${research.recommendation}\n` +
            `Risks: ${research.risks?.join(', ') || 'None identified'}\n` +
            `Files: ${[...(research.affectedFiles || []), ...(research.newFiles || [])].join(', ')}`,
        }));

        if (research.recommendation === 'defer' || research.recommendation === 'redesign') {
          broadcast(makeMsg(MSG.CHAT_RESPONSE, {
            projectSlug,
            role: 'assistant',
            content: `⚠️ Planner recommends **${research.recommendation}**: ${research.reasoning}`,
          }));
          return;
        }
      } catch (err) {
        log.error(`[planner] Research failed: ${err.message}`);
        broadcast(makeMsg(MSG.CHAT_RESPONSE, {
          projectSlug,
          role: 'assistant',
          content: `⚠️ Planner research failed, proceeding directly to implementation...`,
        }));
      }
    }

    try {
      await startSession(prompt, projectSlug);
    } catch (err) {
      log.error(`[selfdev] Error during self-dev session: ${err.message}`);
      ws.send(makeMsg(MSG.SESSION_ERROR, { error: err.message }));
      return;
    }
    broadcast(makeMsg(MSG.SELFDEV_DIFF, { featureName, projectSlug }));
  }
  if (msg.type === MSG.CHAT_MESSAGE) {
    const { message, projectSlug } = msg.payload;
    if (message && projectSlug) {
      await handleChatMessage(message, projectSlug);
    }
  }
  if (msg.type === MSG.RECONNECT_SYNC) {
    const { projectSlug } = msg.payload || {};
    const ctx = activeContexts.get(projectSlug);
    if (ctx) {
      const session = sessions.get(ctx.sessionId);
      ws.send(makeMsg(MSG.RECONNECT_SYNC, {
        projectSlug,
        plan: ctx.plan,
        tasks: ctx.taskStatuses,
        sessionStatus: session?.status,
      }));
    }
  }
  if (msg.type === MSG.GATE_RESPONSE) {
    const { taskId, approved, feedback } = msg.payload || {};
    for (const [, ctx] of activeContexts) {
      if (ctx.taskRunner) {
        ctx.taskRunner.resolveGate(taskId, approved, feedback);
      }
    }
  }

  // Phase 6.7: WebSocket channel subscriptions
  if (msg.type === MSG.WS_SUBSCRIBE) {
    const { projectSlug } = msg.payload || {};
    if (projectSlug && typeof projectSlug === 'string') {
      ws.subscribedProjects.add(projectSlug);
      log.info(`[ws] Client subscribed to project: ${projectSlug} (${ws.subscribedProjects.size} subscriptions)`);
    }
  }
  if (msg.type === MSG.WS_UNSUBSCRIBE) {
    const { projectSlug } = msg.payload || {};
    if (projectSlug) {
      ws.subscribedProjects.delete(projectSlug);
      log.info(`[ws] Client unsubscribed from project: ${projectSlug} (${ws.subscribedProjects.size} subscriptions)`);
    }
  }
}
