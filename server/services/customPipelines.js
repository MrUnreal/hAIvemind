/**
 * Custom Pipelines Service — Phase 12.6
 *
 * Multi-stage pipelines, conditional steps, approval gates,
 * pipeline templates, execution tracking.
 */

import { refs } from '../state.js';

// ─── Constants ──────────────────────────────────────────────────────────

export const STEP_TYPES = ['task', 'approval', 'condition', 'parallel', 'webhook'];
export const STEP_STATUSES = ['pending', 'running', 'completed', 'failed', 'skipped', 'waiting-approval'];
export const PIPELINE_STATUSES = ['draft', 'running', 'completed', 'failed', 'paused', 'cancelled'];

// ─── Helpers ────────────────────────────────────────────────────────────

function _genId(prefix = 'pipe') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function _getPipelines(slug) {
  const settings = refs.workspace?.getProjectSettings?.(slug) || {};
  return settings.pipelines || [];
}

function _savePipelines(slug, pipes) {
  if (pipes.length > 200) pipes.splice(0, pipes.length - 200);
  refs.workspace?.updateProjectSettings?.(slug, { pipelines: pipes });
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Create a new pipeline with stages.
 */
export function createPipeline(slug, data = {}) {
  if (!data.name) throw new Error('name is required');
  if (!data.steps || !Array.isArray(data.steps) || data.steps.length === 0) {
    throw new Error('steps array is required and must not be empty');
  }

  const steps = data.steps.map((s, i) => ({
    id: _genId('step'),
    order: i,
    name: s.name || `Step ${i + 1}`,
    type: STEP_TYPES.includes(s.type) ? s.type : 'task',
    config: s.config || {},
    condition: s.condition || null,
    status: 'pending',
    result: null,
    startedAt: null,
    completedAt: null,
  }));

  const pipeline = {
    id: _genId(),
    name: data.name,
    description: data.description || '',
    steps,
    status: 'draft',
    currentStep: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
    completedAt: null,
  };

  const pipes = _getPipelines(slug);
  pipes.push(pipeline);
  _savePipelines(slug, pipes);
  return pipeline;
}

/**
 * List all pipelines.
 */
export function listPipelines(slug, filters = {}) {
  let pipes = _getPipelines(slug);
  if (filters.status) pipes = pipes.filter(p => p.status === filters.status);
  return pipes;
}

/**
 * Get a single pipeline.
 */
export function getPipeline(slug, pipeId) {
  return _getPipelines(slug).find(p => p.id === pipeId) || null;
}

/**
 * Start a pipeline (set status to running, begin first step).
 */
export function startPipeline(slug, pipeId) {
  const pipes = _getPipelines(slug);
  const pipe = pipes.find(p => p.id === pipeId);
  if (!pipe) return null;
  if (pipe.status === 'running') return { ...pipe, error: 'Already running' };

  pipe.status = 'running';
  pipe.startedAt = Date.now();
  pipe.currentStep = 0;
  pipe.updatedAt = Date.now();

  // Start first step
  if (pipe.steps.length > 0) {
    const step = pipe.steps[0];
    if (step.type === 'approval') {
      step.status = 'waiting-approval';
    } else {
      step.status = 'running';
      step.startedAt = Date.now();
    }
  }

  _savePipelines(slug, pipes);
  return pipe;
}

/**
 * Advance pipeline: complete current step, start next.
 */
export function advancePipeline(slug, pipeId, stepResult = {}) {
  const pipes = _getPipelines(slug);
  const pipe = pipes.find(p => p.id === pipeId);
  if (!pipe) return null;
  if (pipe.status !== 'running') return { ...pipe, error: 'Pipeline not running' };

  const currentIdx = pipe.currentStep;
  const current = pipe.steps[currentIdx];
  if (!current) return { ...pipe, error: 'No current step' };

  // Complete current step
  current.status = stepResult.failed ? 'failed' : 'completed';
  current.result = stepResult.result || null;
  current.completedAt = Date.now();

  // If step failed, fail pipeline
  if (stepResult.failed) {
    pipe.status = 'failed';
    pipe.completedAt = Date.now();
    pipe.updatedAt = Date.now();
    _savePipelines(slug, pipes);
    return pipe;
  }

  // Move to next step
  const nextIdx = currentIdx + 1;
  if (nextIdx >= pipe.steps.length) {
    // Pipeline complete
    pipe.status = 'completed';
    pipe.completedAt = Date.now();
  } else {
    pipe.currentStep = nextIdx;
    const next = pipe.steps[nextIdx];

    // Check condition
    if (next.condition) {
      const prevResult = current.result;
      if (next.condition === 'skip-on-failure' && stepResult.failed) {
        next.status = 'skipped';
      } else if (next.condition === 'only-on-success' && !stepResult.failed) {
        next.status = next.type === 'approval' ? 'waiting-approval' : 'running';
        next.startedAt = Date.now();
      } else {
        next.status = next.type === 'approval' ? 'waiting-approval' : 'running';
        next.startedAt = Date.now();
      }
    } else {
      next.status = next.type === 'approval' ? 'waiting-approval' : 'running';
      next.startedAt = Date.now();
    }
  }

  pipe.updatedAt = Date.now();
  _savePipelines(slug, pipes);
  return pipe;
}

/**
 * Approve a step that is waiting-approval.
 */
export function approveStep(slug, pipeId, stepId) {
  const pipes = _getPipelines(slug);
  const pipe = pipes.find(p => p.id === pipeId);
  if (!pipe) return null;

  const step = pipe.steps.find(s => s.id === stepId);
  if (!step) return { error: 'Step not found' };
  if (step.status !== 'waiting-approval') return { error: 'Step not waiting for approval' };

  step.status = 'running';
  step.startedAt = Date.now();
  pipe.updatedAt = Date.now();

  _savePipelines(slug, pipes);
  return pipe;
}

/**
 * Cancel a pipeline.
 */
export function cancelPipeline(slug, pipeId) {
  const pipes = _getPipelines(slug);
  const pipe = pipes.find(p => p.id === pipeId);
  if (!pipe) return null;

  pipe.status = 'cancelled';
  pipe.completedAt = Date.now();
  pipe.updatedAt = Date.now();

  // Mark pending/running steps as skipped
  for (const step of pipe.steps) {
    if (step.status === 'pending' || step.status === 'running' || step.status === 'waiting-approval') {
      step.status = 'skipped';
    }
  }

  _savePipelines(slug, pipes);
  return pipe;
}

/**
 * Delete a pipeline.
 */
export function deletePipeline(slug, pipeId) {
  const pipes = _getPipelines(slug);
  const idx = pipes.findIndex(p => p.id === pipeId);
  if (idx === -1) return null;
  const removed = pipes.splice(idx, 1)[0];
  _savePipelines(slug, pipes);
  return removed;
}

/**
 * Get pipeline stats.
 */
export function getPipelineStats(slug) {
  const pipes = _getPipelines(slug);
  const byStatus = {};
  let totalSteps = 0;
  let completedSteps = 0;
  for (const p of pipes) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    totalSteps += p.steps.length;
    completedSteps += p.steps.filter(s => s.status === 'completed').length;
  }
  return {
    total: pipes.length,
    byStatus,
    totalSteps,
    completedSteps,
  };
}
