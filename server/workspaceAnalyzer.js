import { readdir, readFile, stat, access } from 'node:fs/promises';
import { join, extname, basename, relative } from 'node:path';

/**
 * Default ignore patterns (mimics .gitignore-like filtering).
 */
const DEFAULT_IGNORE = new Set([
  'node_modules', '.git', '.haivemind', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '__pycache__', '.venv', 'venv',
  'target', '.cargo', 'vendor', '.idea', '.vscode', '.DS_Store',
  'Thumbs.db', '.env', '.env.local',
]);

/**
 * Known framework/language manifest files and what they indicate.
 */
const MANIFEST_FILES = [
  { file: 'package.json', stack: 'Node.js' },
  { file: 'tsconfig.json', stack: 'TypeScript' },
  { file: 'pyproject.toml', stack: 'Python' },
  { file: 'requirements.txt', stack: 'Python' },
  { file: 'Cargo.toml', stack: 'Rust' },
  { file: 'go.mod', stack: 'Go' },
  { file: 'pom.xml', stack: 'Java (Maven)' },
  { file: 'build.gradle', stack: 'Java (Gradle)' },
  { file: 'Gemfile', stack: 'Ruby' },
  { file: 'composer.json', stack: 'PHP' },
  { file: 'Dockerfile', stack: 'Docker' },
  { file: 'docker-compose.yml', stack: 'Docker Compose' },
  { file: 'docker-compose.yaml', stack: 'Docker Compose' },
];

/**
 * Common entry points to scan for exports/patterns.
 */
const ENTRY_POINTS = [
  'index.js', 'index.ts', 'main.js', 'main.ts', 'app.js', 'app.ts',
  'src/index.js', 'src/index.ts', 'src/main.js', 'src/main.ts',
  'src/App.vue', 'src/App.tsx', 'src/App.jsx',
  'server/index.js', 'server/index.ts', 'server.js', 'server.ts',
  'lib/index.js', 'lib/index.ts',
];

const LANGUAGE_MAP = {
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.ts': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.jsx': 'React JSX', '.tsx': 'React TSX',
  '.vue': 'Vue', '.svelte': 'Svelte',
  '.py': 'Python', '.rs': 'Rust', '.go': 'Go',
  '.java': 'Java', '.rb': 'Ruby', '.php': 'PHP',
  '.css': 'CSS', '.scss': 'SCSS', '.less': 'LESS',
  '.html': 'HTML', '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML',
  '.md': 'Markdown', '.sql': 'SQL', '.sh': 'Shell',
};

/**
 * Analyze a workspace directory and produce a compact context document.
 *
 * @param {string} workDir - Absolute path to the project directory
 * @param {object} [opts]
 * @param {number} [opts.maxDepth=3] - Max directory tree depth
 * @param {number} [opts.maxEntryLines=30] - Max lines to read from entry points
 * @returns {Promise<WorkspaceAnalysis>}
 */
export async function analyzeWorkspace(workDir, opts = {}) {
  const maxDepth = opts.maxDepth ?? 3;
  const maxEntryLines = opts.maxEntryLines ?? 30;

  // Load .gitignore patterns (if exists) and merge with defaults
  const ignorePatterns = new Set(DEFAULT_IGNORE);
  try {
    const gitignore = await readFile(join(workDir, '.gitignore'), 'utf-8');
    for (const line of gitignore.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        // Simple pattern: strip leading/trailing slashes for directory name matching
        ignorePatterns.add(trimmed.replace(/^\/|\/$/g, ''));
      }
    }
  } catch { /* no .gitignore, use defaults */ }

  // 1. Build file tree
  const fileTree = await buildFileTree(workDir, workDir, maxDepth, ignorePatterns);

  // 2. Detect tech stack
  const techStack = await detectTechStack(workDir);

  // 3. Read entry points
  const entryPoints = await readEntryPoints(workDir, maxEntryLines);

  // 4. Read dependencies
  const dependencies = await readDependencies(workDir);

  // 5. Detect conventions
  const conventions = await detectConventions(workDir);

  // 6. Build summary
  const summary = buildSummary(techStack, dependencies, conventions, fileTree);

  return {
    fileTree,
    techStack,
    entryPoints,
    dependencies,
    conventions,
    summary,
    toPromptContext() {
      return formatForPrompt(this);
    },
  };
}

/**
 * Build a depth-limited file tree string.
 */
async function buildFileTree(dir, rootDir, maxDepth, ignorePatterns, depth = 0) {
  if (depth > maxDepth) return '';

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return '';
  }

  const indent = '  '.repeat(depth);
  const lines = [];
  let fileCount = 0;
  const subdirs = [];

  // Sort: directories first, then files
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (ignorePatterns.has(entry.name)) continue;

    if (entry.isDirectory()) {
      subdirs.push(entry.name);
    } else {
      fileCount++;
      // Only list individual files at depths 0 and 1
      if (depth <= 1) {
        lines.push(`${indent}  ${entry.name}`);
      }
    }
  }

  const result = [];
  for (const subdir of subdirs) {
    const subPath = join(dir, subdir);
    const subTree = await buildFileTree(subPath, rootDir, maxDepth, ignorePatterns, depth + 1);
    if (subTree || depth < maxDepth) {
      result.push(`${indent}${subdir}/`);
      if (subTree) result.push(subTree);
    }
  }

  // At deeper levels, just show file count
  if (depth > 1 && fileCount > 0) {
    result.push(`${indent}  (${fileCount} files)`);
  } else {
    result.push(...lines);
  }

  return result.join('\n');
}

/**
 * Detect the technology stack by checking for manifest files.
 */
async function detectTechStack(workDir) {
  const detected = [];

  for (const { file, stack } of MANIFEST_FILES) {
    try {
      await access(join(workDir, file));
      detected.push(stack);
    } catch { /* not found */ }
  }

  // Check package.json for framework hints
  try {
    const pkg = JSON.parse(await readFile(join(workDir, 'package.json'), 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (allDeps.react) detected.push('React');
    if (allDeps.vue || allDeps['@vue/core']) detected.push('Vue');
    if (allDeps.svelte) detected.push('Svelte');
    if (allDeps.next) detected.push('Next.js');
    if (allDeps.nuxt) detected.push('Nuxt');
    if (allDeps.express) detected.push('Express');
    if (allDeps.fastify) detected.push('Fastify');
    if (allDeps.koa) detected.push('Koa');
    if (allDeps.electron) detected.push('Electron');
    if (allDeps.vite) detected.push('Vite');
    if (allDeps.webpack) detected.push('webpack');
    if (allDeps.tailwindcss) detected.push('Tailwind CSS');
    if (allDeps.prisma || allDeps['@prisma/client']) detected.push('Prisma');
    if (allDeps.mongoose) detected.push('MongoDB/Mongoose');
    if (allDeps.sequelize) detected.push('Sequelize');
  } catch { /* no package.json or parse error */ }

  return [...new Set(detected)];
}

/**
 * Read the first N lines of known entry point files.
 */
async function readEntryPoints(workDir, maxLines) {
  const results = [];

  for (const relPath of ENTRY_POINTS) {
    try {
      const fullPath = join(workDir, relPath);
      await access(fullPath);
      const content = await readFile(fullPath, 'utf-8');
      const lines = content.split('\n').slice(0, maxLines);
      results.push({
        path: relPath,
        preview: lines.join('\n'),
        language: LANGUAGE_MAP[extname(relPath)] || 'Unknown',
      });
    } catch { /* not found */ }
  }

  return results;
}

/**
 * Read direct dependencies from package manifests.
 */
async function readDependencies(workDir) {
  const deps = { runtime: [], dev: [] };

  try {
    const pkg = JSON.parse(await readFile(join(workDir, 'package.json'), 'utf-8'));
    if (pkg.dependencies) deps.runtime = Object.keys(pkg.dependencies);
    if (pkg.devDependencies) deps.dev = Object.keys(pkg.devDependencies);
  } catch { /* no package.json */ }

  return deps;
}

/**
 * Detect coding conventions from config files and package.json.
 */
async function detectConventions(workDir) {
  const conventions = {
    moduleSystem: 'unknown',
    testFramework: 'unknown',
    linter: 'none',
    formatter: 'none',
    packageManager: 'npm',
  };

  try {
    const pkg = JSON.parse(await readFile(join(workDir, 'package.json'), 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Module system
    conventions.moduleSystem = pkg.type === 'module' ? 'ESM' : 'CJS';

    // Test framework
    if (allDeps.jest) conventions.testFramework = 'Jest';
    else if (allDeps.vitest) conventions.testFramework = 'Vitest';
    else if (allDeps.mocha) conventions.testFramework = 'Mocha';
    else if (allDeps['@playwright/test']) conventions.testFramework = 'Playwright';
    else if (allDeps.cypress) conventions.testFramework = 'Cypress';

    // Linter
    if (allDeps.eslint) conventions.linter = 'ESLint';
    if (allDeps.biome || allDeps['@biomejs/biome']) conventions.linter = 'Biome';

    // Formatter
    if (allDeps.prettier) conventions.formatter = 'Prettier';

    // Package manager (check lockfile)
    try { await access(join(workDir, 'pnpm-lock.yaml')); conventions.packageManager = 'pnpm'; } catch {}
    try { await access(join(workDir, 'yarn.lock')); conventions.packageManager = 'yarn'; } catch {}
    try { await access(join(workDir, 'bun.lockb')); conventions.packageManager = 'bun'; } catch {}
  } catch { /* no package.json */ }

  return conventions;
}

/**
 * Build a one-paragraph summary of the workspace.
 */
function buildSummary(techStack, dependencies, conventions, fileTree) {
  const parts = [];

  if (techStack.length > 0) {
    parts.push(`Tech stack: ${techStack.join(', ')}`);
  }

  if (conventions.moduleSystem !== 'unknown') {
    parts.push(`Module system: ${conventions.moduleSystem}`);
  }

  if (conventions.testFramework !== 'unknown') {
    parts.push(`Tests: ${conventions.testFramework}`);
  }

  const totalDeps = dependencies.runtime.length + dependencies.dev.length;
  if (totalDeps > 0) {
    parts.push(`${dependencies.runtime.length} runtime + ${dependencies.dev.length} dev dependencies`);
  }

  return parts.join('. ') + '.';
}

/**
 * Format the analysis as a compact prompt-injection string (~500–1500 tokens).
 */
function formatForPrompt(analysis) {
  const sections = [];

  // Summary line
  sections.push(`## Workspace Analysis\n\n${analysis.summary}`);

  // Tech stack
  if (analysis.techStack.length > 0) {
    sections.push(`**Stack:** ${analysis.techStack.join(', ')}`);
  }

  // Conventions
  const conv = analysis.conventions;
  const convParts = [];
  if (conv.moduleSystem !== 'unknown') convParts.push(`${conv.moduleSystem} modules`);
  if (conv.testFramework !== 'unknown') convParts.push(`${conv.testFramework} tests`);
  if (conv.linter !== 'none') convParts.push(conv.linter);
  if (conv.formatter !== 'none') convParts.push(conv.formatter);
  if (conv.packageManager !== 'npm') convParts.push(conv.packageManager);
  if (convParts.length > 0) {
    sections.push(`**Conventions:** ${convParts.join(', ')}`);
  }

  // Key dependencies (top 15 runtime deps)
  if (analysis.dependencies.runtime.length > 0) {
    const topDeps = analysis.dependencies.runtime.slice(0, 15);
    sections.push(`**Dependencies:** ${topDeps.join(', ')}${analysis.dependencies.runtime.length > 15 ? ` (+${analysis.dependencies.runtime.length - 15} more)` : ''}`);
  }

  // File tree (compact)
  if (analysis.fileTree) {
    sections.push(`**File Structure:**\n\`\`\`\n${analysis.fileTree}\n\`\`\``);
  }

  // Entry point previews (compact — just imports/exports from first entry)
  if (analysis.entryPoints.length > 0) {
    const ep = analysis.entryPoints[0];
    // Extract just import/export lines for compactness
    const importExportLines = ep.preview.split('\n')
      .filter(l => /^\s*(import|export|from|require|module\.exports)/.test(l))
      .slice(0, 10);
    if (importExportLines.length > 0) {
      sections.push(`**Main entry (${ep.path}):**\n\`\`\`\n${importExportLines.join('\n')}\n\`\`\``);
    }
  }

  return sections.join('\n\n');
}
