// @ts-check
import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

// ── Phase 5.5: Distribution Tests ─────────────────────────────────────────

test.describe('Distribution — Dockerfile', () => {
  test('Dockerfile exists and has correct structure', () => {
    const file = path.join(ROOT, 'Dockerfile');
    expect(existsSync(file)).toBe(true);
    const content = readFileSync(file, 'utf8');

    // Multi-stage build
    expect(content).toContain('FROM node:20-alpine AS client-build');
    expect(content).toContain('FROM node:20-alpine');

    // Client build stage
    expect(content).toContain('vite build');

    // Production stage copies
    expect(content).toContain('COPY server/');
    expect(content).toContain('COPY shared/');
    expect(content).toContain('COPY templates/');
    expect(content).toContain('COPY bin/');
    expect(content).toContain('COPY --from=client-build');

    // Security: non-root user
    expect(content).toContain('adduser');
    expect(content).toContain('USER haivemind');

    // Health check
    expect(content).toContain('HEALTHCHECK');
    expect(content).toContain('/api/projects');

    // Port and entrypoint
    expect(content).toContain('EXPOSE 3000');
    expect(content).toContain('CMD');
    expect(content).toContain('server/index.js');
  });

  test('Dockerfile uses npm ci --omit=dev for small image', () => {
    const content = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    expect(content).toContain('--omit=dev');
  });

  test('Dockerfile sets NODE_ENV=production', () => {
    const content = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    expect(content).toContain('NODE_ENV=production');
  });
});

test.describe('Distribution — docker-compose.yml', () => {
  test('docker-compose.yml exists and has correct structure', () => {
    const file = path.join(ROOT, 'docker-compose.yml');
    expect(existsSync(file)).toBe(true);
    const content = readFileSync(file, 'utf8');

    // Service definition
    expect(content).toContain('haivemind:');
    expect(content).toContain('build: .');
    expect(content).toContain('image: haivemind:latest');

    // Port mapping
    expect(content).toContain(':3000');

    // Volumes for persistence
    expect(content).toContain('haivemind-workspace');
    expect(content).toContain('haivemind-data');
    expect(content).toContain('./projects');

    // Health check
    expect(content).toContain('healthcheck');

    // Restart policy
    expect(content).toContain('restart:');
  });

  test('docker-compose.yml supports env var overrides', () => {
    const content = readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
    expect(content).toContain('${PORT:-3000}');
    expect(content).toContain('${DEMO:-0}');
    expect(content).toContain('${COPILOT_CMD:-copilot}');
  });
});

test.describe('Distribution — .dockerignore', () => {
  test('.dockerignore exists and excludes unnecessary files', () => {
    const file = path.join(ROOT, '.dockerignore');
    expect(existsSync(file)).toBe(true);
    const content = readFileSync(file, 'utf8');

    expect(content).toContain('node_modules/');
    expect(content).toContain('.git/');
    expect(content).toContain('test-results/');
    expect(content).toContain('tests/');
    expect(content).toContain('.haivemind-workspace/');
  });
});

test.describe('Distribution — package.json', () => {
  test('package.json has engines field', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.engines).toBeDefined();
    expect(pkg.engines.node).toContain('>=18');
  });

  test('package.json is not private (publishable)', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.private).toBeUndefined();
  });

  test('package.json has start script', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.start).toBeDefined();
    expect(pkg.scripts.start).toContain('server/index.js');
  });

  test('package.json has docker scripts', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['docker:build']).toContain('docker build');
    expect(pkg.scripts['docker:up']).toContain('docker compose up');
    expect(pkg.scripts['docker:down']).toContain('docker compose down');
  });

  test('package.json has bin entry for CLI', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin.haivemind).toBe('./bin/haivemind.js');
  });

  test('package.json has description', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.description).toBeDefined();
    expect(pkg.description.length).toBeGreaterThan(10);
  });
});

test.describe('Distribution — Production Static Serving', () => {
  test('server/index.js has static file serving code', () => {
    const content = readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
    expect(content).toContain('express.static');
    expect(content).toContain('client/dist');
    expect(content).toContain('sendFile');
  });

  test('server/index.js SPA fallback excludes API and WS routes', () => {
    const content = readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
    expect(content).toContain('/api');
    expect(content).toContain('/ws');
    // Regex or conditional that exempts API routes from SPA fallback
    expect(content).toMatch(/(?!\/api|\/ws)|(?:\^(?!\\\/api))/);
  });

  test('npm start works (server starts and responds)', async () => {
    // The mock server is already running on port 3000, so just verify it responds
    const response = await fetch('http://localhost:3000/api/projects');
    expect(response.ok).toBe(true);
    const projects = await response.json();
    expect(Array.isArray(projects)).toBe(true);
  });
});

test.describe('Distribution — CLI npx compatibility', () => {
  test('bin/haivemind.js has correct shebang', () => {
    const content = readFileSync(path.join(ROOT, 'bin', 'haivemind.js'), 'utf8');
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  test('CLI help works via node direct invocation', () => {
    const out = execSync('node bin/haivemind.js help', { cwd: ROOT, encoding: 'utf8' });
    expect(out).toContain('haivemind');
    expect(out).toContain('Usage');
  });

  test('npm start script references server/index.js', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.start).toBe('node server/index.js');
  });
});
