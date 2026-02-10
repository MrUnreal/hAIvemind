/**
 * Template routes — Phase 6.8
 */

import { Router } from 'express';
import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { refs } from '../state.js';
import log from '../logger.js';

const router = Router();

router.get('/templates', async (req, res) => {
  try {
    const entries = await readdir(refs.TEMPLATES_DIR, { withFileTypes: true });
    const templates = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry) => {
          try {
            const content = await readFile(join(refs.TEMPLATES_DIR, entry.name), 'utf8');
            const parsed = JSON.parse(content);
            const { name, description, stack, variables, tasks } = parsed;
            const id = entry.name.replace(/\.json$/, '');
            return { id, name, description, stack, variables, tasks };
          } catch (err) {
            log.error(`[templates] Failed to load template ${entry.name}:`, err.message);
            return null;
          }
        }),
    );

    res.json(templates.filter(Boolean));
  } catch (err) {
    log.error('[templates] Error reading templates directory:', err.message);
    res.status(500).json({ error: 'Failed to load templates' });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const { name, description, stack, variables, tasks } = req.body || {};
    if (!name || !tasks || !Array.isArray(tasks)) {
      return res.status(400).json({ error: 'name and tasks[] are required' });
    }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!id) return res.status(400).json({ error: 'Invalid template name' });

    const filePath = join(refs.TEMPLATES_DIR, `${id}.json`);
    if (existsSync(filePath)) {
      return res.status(409).json({ error: 'Template already exists', id });
    }

    const template = { name, description: description || '', stack: stack || '', variables: variables || [], tasks };
    await fs.writeFile(filePath, JSON.stringify(template, null, 2), 'utf8');
    log.info(`[templates] Created template: ${id}`);
    res.status(201).json({ id, ...template });
  } catch (err) {
    log.error('[templates] Error creating template:', err.message);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

export default router;
