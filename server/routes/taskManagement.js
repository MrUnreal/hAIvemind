/**
 * Task management routes — dependencies, retry/recovery, decomposition, pipelines.
 */
import { Router } from 'express';
import { refs } from '../state.js';
import {
  listTasks, getTask, createTask, updateTask, deleteTask,
  addDependency, removeDependency, listDependencies,
  getSchedule, getCriticalPath, getDependencyStats,
  PRIORITY_LEVELS, TASK_STATUSES,
} from '../services/taskDependencies.js';
import {
  listRetryPolicies, getRetryPolicy, createRetryPolicy, updateRetryPolicy,
  deleteRetryPolicy, shouldRetry, recordRetry, getRetryLog,
  getCircuitBreaker, resetCircuitBreaker, listCircuitBreakers, getRetryStats,
  RETRY_STRATEGIES,
} from '../services/retryRecovery.js';
import {
  estimateComplexity, decompose, listDecompositions, getDecomposition,
  deleteDecomposition, mergeSubtasks, getDecompositionStats,
  COMPLEXITY_LEVELS,
} from '../services/smartDecomposition.js';
import {
  createPipeline, listPipelines, getPipeline, startPipeline,
  advancePipeline, approveStep, cancelPipeline, deletePipeline,
  getPipelineStats, STEP_TYPES, PIPELINE_STATUSES,
} from '../services/customPipelines.js';

const router = Router();

// ─── Phase 12.0: Task Dependencies & Priority ───────────────────────────

/** List tasks (optional ?status=&priority= filters) */
router.get('/projects/:slug/tasks', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(listTasks(req.params.slug, {
    status: req.query.status,
    priority: req.query.priority,
  }));
});

/** Get a single task */
router.get('/projects/:slug/tasks/:taskId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const task = getTask(req.params.slug, req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

/** Create a task */
router.post('/projects/:slug/tasks', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  try {
    const task = createTask(req.params.slug, req.body);
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Update a task */
router.patch('/projects/:slug/tasks/:taskId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const task = updateTask(req.params.slug, req.params.taskId, req.body);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

/** Delete a task */
router.delete('/projects/:slug/tasks/:taskId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const ok = deleteTask(req.params.slug, req.params.taskId);
  if (!ok) return res.status(404).json({ error: 'Task not found' });
  res.json({ ok: true });
});

/** List dependency edges */
router.get('/projects/:slug/dependencies', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(listDependencies(req.params.slug));
});

/** Add a dependency edge */
router.post('/projects/:slug/dependencies', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  try {
    const dep = addDependency(req.params.slug, req.body);
    res.status(201).json(dep);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Remove a dependency edge */
router.delete('/projects/:slug/dependencies/:depId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const ok = removeDependency(req.params.slug, req.params.depId);
  if (!ok) return res.status(404).json({ error: 'Dependency not found' });
  res.json({ ok: true });
});

/** Get priority-based schedule */
router.get('/projects/:slug/schedule', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getSchedule(req.params.slug));
});

/** Get critical path */
router.get('/projects/:slug/critical-path', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getCriticalPath(req.params.slug));
});

/** Get dependency graph stats */
router.get('/projects/:slug/dependency-stats', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getDependencyStats(req.params.slug));
});

/** List priority levels */
router.get('/priority-levels', (_req, res) => {
  res.json(PRIORITY_LEVELS);
});

/** List task statuses */
router.get('/task-statuses', (_req, res) => {
  res.json(TASK_STATUSES);
});

// ─── Phase 12.1: Auto-Retry & Recovery ──────────────────────────────────

/** List retry policies */
router.get('/projects/:slug/retry-policies', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(listRetryPolicies(req.params.slug));
});

/** Get a retry policy */
router.get('/projects/:slug/retry-policies/:policyId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const policy = getRetryPolicy(req.params.slug, req.params.policyId);
  if (!policy) return res.status(404).json({ error: 'Policy not found' });
  res.json(policy);
});

/** Create a retry policy */
router.post('/projects/:slug/retry-policies', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  try {
    const policy = createRetryPolicy(req.params.slug, req.body);
    res.status(201).json(policy);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Update a retry policy */
router.patch('/projects/:slug/retry-policies/:policyId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const policy = updateRetryPolicy(req.params.slug, req.params.policyId, req.body);
  if (!policy) return res.status(404).json({ error: 'Policy not found' });
  res.json(policy);
});

/** Delete a retry policy */
router.delete('/projects/:slug/retry-policies/:policyId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const ok = deleteRetryPolicy(req.params.slug, req.params.policyId);
  if (!ok) return res.status(404).json({ error: 'Policy not found' });
  res.json({ ok: true });
});

/** Check if retry should be attempted */
router.post('/projects/:slug/retry-check', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const { policyId, attempt, errorType } = req.body;
  if (!policyId) return res.status(400).json({ error: 'policyId is required' });
  res.json(shouldRetry(req.params.slug, policyId, attempt || 0, errorType));
});

/** Record a retry attempt */
router.post('/projects/:slug/retry-log', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const record = recordRetry(req.params.slug, req.body);
  res.status(201).json(record);
});

/** Get retry log */
router.get('/projects/:slug/retry-log', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getRetryLog(req.params.slug, {
    policyId: req.query.policyId,
    taskId: req.query.taskId,
    limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
  }));
});

/** Get circuit breaker state */
router.get('/projects/:slug/circuit-breakers/:policyId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getCircuitBreaker(req.params.slug, req.params.policyId));
});

/** Reset circuit breaker */
router.post('/projects/:slug/circuit-breakers/:policyId/reset', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(resetCircuitBreaker(req.params.slug, req.params.policyId));
});

/** List all circuit breakers */
router.get('/projects/:slug/circuit-breakers', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(listCircuitBreakers(req.params.slug));
});

/** Get retry stats */
router.get('/projects/:slug/retry-stats', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getRetryStats(req.params.slug));
});

/** List retry strategies */
router.get('/retry-strategies', (_req, res) => {
  res.json(RETRY_STRATEGIES);
});


// ─── Phase 12.3: Smart Decomposition ────────────────────────────────────

/** Estimate complexity of a task description */
router.post('/estimate-complexity', (req, res) => {
  if (!req.body.description) return res.status(400).json({ error: 'description is required' });
  res.json(estimateComplexity(req.body.description));
});

/** Decompose a task into sub-tasks */
router.post('/projects/:slug/decompositions', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  try {
    const dec = decompose(req.params.slug, req.body);
    res.status(201).json(dec);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** List all decompositions */
router.get('/projects/:slug/decompositions', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(listDecompositions(req.params.slug));
});

/** Get a decomposition */
router.get('/projects/:slug/decompositions/:decId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const dec = getDecomposition(req.params.slug, req.params.decId);
  if (!dec) return res.status(404).json({ error: 'Decomposition not found' });
  res.json(dec);
});

/** Delete a decomposition */
router.delete('/projects/:slug/decompositions/:decId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const ok = deleteDecomposition(req.params.slug, req.params.decId);
  if (!ok) return res.status(404).json({ error: 'Decomposition not found' });
  res.json({ ok: true });
});

/** Merge two sub-tasks */
router.post('/projects/:slug/decompositions/:decId/merge', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const { subtask1Id, subtask2Id, mergedName } = req.body;
  if (!subtask1Id || !subtask2Id) return res.status(400).json({ error: 'subtask1Id and subtask2Id required' });
  const result = mergeSubtasks(req.params.slug, req.params.decId, subtask1Id, subtask2Id, mergedName);
  if (!result) return res.status(404).json({ error: 'Decomposition or subtask not found' });
  res.json(result);
});

/** Get decomposition stats */
router.get('/projects/:slug/decomposition-stats', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getDecompositionStats(req.params.slug));
});

/** List complexity levels */
router.get('/complexity-levels', (_req, res) => {
  res.json(COMPLEXITY_LEVELS);
});


// ─── Phase 12.6 — Custom Pipelines ───────────────────────────────────────

/** Create a pipeline */
router.post('/projects/:slug/pipelines', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  try {
    const pipe = createPipeline(req.params.slug, req.body);
    res.status(201).json(pipe);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** List pipelines */
router.get('/projects/:slug/pipelines', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(listPipelines(req.params.slug, req.query));
});

/** Get a single pipeline */
router.get('/projects/:slug/pipelines/:pipeId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const pipe = getPipeline(req.params.slug, req.params.pipeId);
  if (!pipe) return res.status(404).json({ error: 'Pipeline not found' });
  res.json(pipe);
});

/** Start a pipeline */
router.post('/projects/:slug/pipelines/:pipeId/start', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const pipe = startPipeline(req.params.slug, req.params.pipeId);
  if (!pipe) return res.status(404).json({ error: 'Pipeline not found' });
  res.json(pipe);
});

/** Advance pipeline (complete current step) */
router.post('/projects/:slug/pipelines/:pipeId/advance', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const pipe = advancePipeline(req.params.slug, req.params.pipeId, req.body);
  if (!pipe) return res.status(404).json({ error: 'Pipeline not found' });
  res.json(pipe);
});

/** Approve a step */
router.post('/projects/:slug/pipelines/:pipeId/approve/:stepId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const result = approveStep(req.params.slug, req.params.pipeId, req.params.stepId);
  if (!result) return res.status(404).json({ error: 'Pipeline not found' });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** Cancel a pipeline */
router.post('/projects/:slug/pipelines/:pipeId/cancel', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const pipe = cancelPipeline(req.params.slug, req.params.pipeId);
  if (!pipe) return res.status(404).json({ error: 'Pipeline not found' });
  res.json(pipe);
});

/** Delete a pipeline */
router.delete('/projects/:slug/pipelines/:pipeId', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const removed = deletePipeline(req.params.slug, req.params.pipeId);
  if (!removed) return res.status(404).json({ error: 'Pipeline not found' });
  res.json(removed);
});

/** Pipeline stats */
router.get('/projects/:slug/pipeline-stats', (req, res) => {
  const project = refs.workspace.getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(getPipelineStats(req.params.slug));
});

/** Pipeline step types */
router.get('/step-types', (_req, res) => { res.json(STEP_TYPES); });

/** Pipeline statuses */
router.get('/pipeline-statuses', (_req, res) => { res.json(PIPELINE_STATUSES); });


export default router;
