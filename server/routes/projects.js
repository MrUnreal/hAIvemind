/**
 * Project routes — thin re-exporter.
 * All domain routes split into separate files for maintainability.
 */
import { Router } from 'express';
import projectCore from './projectCore.js';
import webhooks from './webhooks.js';
import scheduling from './scheduling.js';
import notifications from './notifications.js';
import security from './security.js';
import templates from './templates.js';
import auditCollab from './auditCollab.js';
import analytics from './analytics.js';
import memory from './memory.js';
import resources from './resources.js';
import codeReview from './codeReview.js';
import events from './events.js';
import sessionOps from './sessionOps.js';
import taskManagement from './taskManagement.js';
import agentConfig from './agentConfig.js';

const router = Router();

router.use(projectCore);
router.use(webhooks);
router.use(scheduling);
router.use(notifications);
router.use(security);
router.use(templates);
router.use(auditCollab);
router.use(analytics);
router.use(memory);
router.use(resources);
router.use(codeReview);
router.use(events);
router.use(sessionOps);
router.use(taskManagement);
router.use(agentConfig);

export default router;
