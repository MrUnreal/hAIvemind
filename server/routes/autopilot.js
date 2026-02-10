/**
 * Autopilot routes — Phase 6.8
 * Start, status, and stop autopilot runs.
 */

import { Router } from 'express';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { MSG, makeMsg } from '../../shared/protocol.js';
import { sessions, autopilotRuns, refs } from '../state.js';
import { broadcast } from '../ws/broadcast.js';
import { startSession } from '../services/sessions.js';

const router = Router();

/** Start autopilot run */
router.post('/projects/:slug/autopilot', async (req, res) => {
  const { slug } = req.params;
  const workspace = refs.workspace;
  const project = workspace.getProject(slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  if (autopilotRuns.get(slug)?.running) {
    return res.status(409).json({ error: 'Autopilot already running for this project' });
  }

  const { maxCycles = 5, costCeiling = null, requireTests = false } = req.body || {};
  const abortController = { aborted: false };

  const run = { running: true, abortController, cycles: 0, decisions: [], startedAt: Date.now() };
  autopilotRuns.set(slug, run);

  broadcast(makeMsg(MSG.AUTOPILOT_STARTED, { slug, maxCycles, costCeiling }));
  res.json({ status: 'started', slug, maxCycles });

  // Run autopilot asynchronously
  try {
    const { runAutopilotCycle } = await import('../autopilot.js');
    const result = await runAutopilotCycle({
      workspace,
      slug,
      runSession: (prompt) => {
        return new Promise((resolve) => {
          const sessionId = startSession(prompt, slug);
          const check = setInterval(() => {
            if (abortController.aborted) {
              clearInterval(check);
              resolve({ exitCode: 1, sessionId, costSummary: {} });
            }
            const s = sessions.get(sessionId);
            if (s && (s.status === 'completed' || s.status === 'failed')) {
              clearInterval(check);
              resolve({
                exitCode: s.status === 'completed' ? 0 : 1,
                sessionId,
                costSummary: s.costSummary || {},
              });
            }
          }, 1000);
        });
      },
      planFn: async () => null,
      config: { maxCycles, costCeiling, requireTests },
      log: (await import('../logger.js')).default,
      onCycle: (decision) => {
        run.cycles++;
        run.decisions.push(decision);
        broadcast(makeMsg(MSG.AUTOPILOT_CYCLE, { slug, ...decision }));
      },
    });
    run.running = false;
    run.stoppedReason = result?.stopped || 'completed';
    broadcast(makeMsg(MSG.AUTOPILOT_STOPPED, { slug, reason: run.stoppedReason, cycles: run.cycles }));
  } catch (err) {
    run.running = false;
    run.stoppedReason = 'error';
    broadcast(makeMsg(MSG.AUTOPILOT_STOPPED, { slug, reason: 'error', error: err.message }));
  }
});

/** Get autopilot status */
router.get('/projects/:slug/autopilot', (req, res) => {
  const { slug } = req.params;
  const workspace = refs.workspace;
  const project = workspace.getProject(slug);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const run = autopilotRuns.get(slug);
  if (!run) return res.json({ running: false, history: [] });

  // Try to load history from log file
  let history = [];
  try {
    const logPath = join(project.dir, '.haivemind', 'autopilot-log.json');
    if (existsSync(logPath)) {
      history = JSON.parse(readFileSync(logPath, 'utf8'));
    }
  } catch { /* ignore */ }

  res.json({
    running: run.running,
    cycles: run.cycles,
    decisions: run.decisions,
    stoppedReason: run.stoppedReason,
    startedAt: run.startedAt,
    history,
  });
});

/** Stop autopilot run */
router.post('/projects/:slug/autopilot/stop', (req, res) => {
  const { slug } = req.params;
  const run = autopilotRuns.get(slug);
  if (!run?.running) return res.status(404).json({ error: 'No autopilot run active' });
  run.abortController.aborted = true;
  res.json({ ok: true, message: 'Abort signal sent' });
});

export default router;
