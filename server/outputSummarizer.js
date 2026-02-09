/**
 * Phase 5.1 — Agent Output Diffing & Smart Summaries
 *
 * Extracts structured summaries from raw agent output:
 *  - Files changed (created, modified, deleted)
 *  - Errors encountered
 *  - Warnings
 *  - Test results
 *  - Commands run
 *
 * Used during escalation (pass summary instead of raw output)
 * and stored alongside raw output in session snapshots.
 */

/**
 * @typedef {Object} OutputSummary
 * @property {string[]} filesChanged - Files created or modified
 * @property {string[]} filesDeleted - Files deleted
 * @property {string[]} errors - Error messages found
 * @property {string[]} warnings - Warning messages found
 * @property {{ passed: number, failed: number, skipped: number, details: string[] }} tests - Test results
 * @property {string[]} commands - Commands that were run
 * @property {string} digest - One-paragraph human-readable digest
 */

/**
 * Extract a structured summary from raw agent output chunks.
 * @param {string[]} outputChunks - Array of raw output strings
 * @returns {OutputSummary}
 */
export function summarizeOutput(outputChunks) {
  const raw = outputChunks.join('');

  const filesChanged = extractFilesChanged(raw);
  const filesDeleted = extractFilesDeleted(raw);
  const errors = extractErrors(raw);
  const warnings = extractWarnings(raw);
  const tests = extractTestResults(raw);
  const commands = extractCommands(raw);
  const digest = buildDigest({ filesChanged, filesDeleted, errors, warnings, tests, commands });

  return { filesChanged, filesDeleted, errors, warnings, tests, commands, digest };
}

/**
 * Build a compact context string for escalation (replaces raw output).
 * Keeps within ~1500 tokens to avoid prompt overflow.
 * @param {OutputSummary} summary
 * @param {string} [rawTail] - Last N chars of raw output as fallback
 * @returns {string}
 */
export function summaryToContext(summary, rawTail = '') {
  const lines = [];

  lines.push('## Previous Attempt Summary\n');
  lines.push(summary.digest);

  if (summary.errors.length > 0) {
    lines.push('\n### Errors');
    for (const err of summary.errors.slice(0, 10)) {
      lines.push(`- ${err.slice(0, 200)}`);
    }
  }

  if (summary.warnings.length > 0) {
    lines.push('\n### Warnings');
    for (const w of summary.warnings.slice(0, 5)) {
      lines.push(`- ${w.slice(0, 150)}`);
    }
  }

  if (summary.filesChanged.length > 0) {
    lines.push('\n### Files Changed');
    for (const f of summary.filesChanged.slice(0, 20)) {
      lines.push(`- ${f}`);
    }
  }

  if (summary.tests.failed > 0) {
    lines.push(`\n### Test Failures (${summary.tests.failed} failed)`);
    for (const d of summary.tests.details.slice(0, 5)) {
      lines.push(`- ${d.slice(0, 200)}`);
    }
  }

  // If summary is thin, append raw tail as fallback
  const result = lines.join('\n');
  if (result.length < 200 && rawTail) {
    return result + '\n\n### Raw Output (tail)\n```\n' + rawTail.slice(-1000) + '\n```';
  }

  return result;
}

// ── Pattern extractors ──

function extractFilesChanged(raw) {
  const files = new Set();

  // Git-style: "create mode 100644 path/to/file"
  for (const m of raw.matchAll(/create mode \d+ (.+)/g)) {
    files.add(m[1].trim());
  }

  // Copilot CLI style: "Created file: path" or "Modified file: path"
  for (const m of raw.matchAll(/(?:Created|Modified|Updated|Wrote|Writing)\s+(?:file:?\s*)?([^\s,;]+\.\w+)/gi)) {
    files.add(m[1].trim());
  }

  // diff --git a/path b/path
  for (const m of raw.matchAll(/diff --git a\/(.+?) b\//g)) {
    files.add(m[1].trim());
  }

  // Common editor patterns: "file.ts (modified)" or "> file.ts"
  for (const m of raw.matchAll(/(?:^|\n)\s*>\s+(\S+\.\w{1,10})\s*$/gm)) {
    files.add(m[1].trim());
  }

  return [...files].filter(f => f.length < 200 && !f.startsWith('--'));
}

function extractFilesDeleted(raw) {
  const files = new Set();

  for (const m of raw.matchAll(/delete mode \d+ (.+)/g)) {
    files.add(m[1].trim());
  }

  for (const m of raw.matchAll(/(?:Deleted|Removed)\s+(?:file:?\s*)?([^\s,;]+\.\w+)/gi)) {
    files.add(m[1].trim());
  }

  return [...files].filter(f => f.length < 200);
}

function extractErrors(raw) {
  const errors = [];

  // Standard error patterns
  const errorPatterns = [
    /(?:^|\n)(Error:.{5,200})/gm,
    /(?:^|\n)(TypeError:.{5,200})/gm,
    /(?:^|\n)(ReferenceError:.{5,200})/gm,
    /(?:^|\n)(SyntaxError:.{5,200})/gm,
    /(?:^|\n)(ENOENT:.{5,200})/gm,
    /(?:^|\n)(EACCES:.{5,200})/gm,
    /(?:^|\n)(ERR!.{5,200})/gm,
    /(?:^|\n)(error\[E\d+\]:.{5,200})/gm,
    /(?:^|\n)(error TS\d+:.{5,200})/gm,
    /(?:^|\n)(✘\s+.{5,150})/gm,
    /(?:^|\n)(FAIL.{5,150})/gm,
    /(?:^|\n)(❌.{5,150})/gm,
    /(?:^|\n)(panic:.{5,200})/gm,
    /(?:^|\n)(Traceback \(most recent call last\))/gm,
    /(?:^|\n)(\s+at .+:\d+:\d+)/gm,  // Stack trace lines
  ];

  for (const pat of errorPatterns) {
    for (const m of raw.matchAll(pat)) {
      errors.push(m[1].trim());
      if (errors.length >= 25) break;
    }
    if (errors.length >= 25) break;
  }

  return [...new Set(errors)].slice(0, 15);
}

function extractWarnings(raw) {
  const warnings = [];

  const warnPatterns = [
    /(?:^|\n)(Warning:.{5,150})/gm,
    /(?:^|\n)(WARN.{5,150})/gm,
    /(?:^|\n)(⚠️?.{5,150})/gm,
    /(?:^|\n)(deprecated:.{5,150})/gim,
  ];

  for (const pat of warnPatterns) {
    for (const m of raw.matchAll(pat)) {
      warnings.push(m[1].trim());
      if (warnings.length >= 10) break;
    }
    if (warnings.length >= 10) break;
  }

  return [...new Set(warnings)].slice(0, 8);
}

function extractTestResults(raw) {
  const result = { passed: 0, failed: 0, skipped: 0, details: [] };

  // Jest / Vitest: "Tests: 5 passed, 2 failed, 7 total"
  const jestMatch = raw.match(/Tests:\s+(\d+)\s+passed(?:,\s+(\d+)\s+failed)?(?:,\s+(\d+)\s+skipped)?/i);
  if (jestMatch) {
    result.passed = parseInt(jestMatch[1]) || 0;
    result.failed = parseInt(jestMatch[2]) || 0;
    result.skipped = parseInt(jestMatch[3]) || 0;
  }

  // Playwright: "X passed (Ys)" or "X failed"
  const pwPassMatch = raw.match(/(\d+)\s+passed/i);
  const pwFailMatch = raw.match(/(\d+)\s+failed/i);
  if (pwPassMatch && !jestMatch) result.passed = parseInt(pwPassMatch[1]) || 0;
  if (pwFailMatch && !jestMatch) result.failed = parseInt(pwFailMatch[1]) || 0;

  // pytest: "X passed, Y failed" 
  const pytestMatch = raw.match(/(\d+)\s+passed(?:,\s+(\d+)\s+failed)?/i);
  if (pytestMatch && !jestMatch) {
    result.passed = parseInt(pytestMatch[1]) || 0;
    result.failed = parseInt(pytestMatch[2]) || 0;
  }

  // Go: "ok" / "FAIL" lines
  const goPass = (raw.match(/^ok\s+\S+/gm) || []).length;
  const goFail = (raw.match(/^FAIL\s+\S+/gm) || []).length;
  if (goPass + goFail > result.passed + result.failed) {
    result.passed = goPass;
    result.failed = goFail;
  }

  // Capture individual test failure lines
  const failLines = [
    ...raw.matchAll(/(?:^|\n)\s*(✘|FAIL|×|✗)\s+(.{5,150})/gm),
    ...raw.matchAll(/(?:^|\n)\s*(?:FAIL)\s+(.{5,150})/gm),
  ];
  for (const m of failLines) {
    const detail = (m[2] || m[1]).trim();
    if (detail && !result.details.includes(detail)) {
      result.details.push(detail);
    }
    if (result.details.length >= 10) break;
  }

  return result;
}

function extractCommands(raw) {
  const commands = new Set();

  // Shell-prompt-style lines: "$ npm install" or "> npm test"
  const shellPatterns = [
    /(?:^|\n)\s*\$\s+(.{5,120})/gm,
    /(?:^|\n)\s*>\s+((?:npm|yarn|pnpm|npx|node|python|pip|cargo|go|make|git)\s.{3,100})/gm,
  ];

  for (const pat of shellPatterns) {
    for (const m of raw.matchAll(pat)) {
      commands.add(m[1].trim());
      if (commands.size >= 15) break;
    }
    if (commands.size >= 15) break;
  }

  // Copilot CLI outputs "Running: <command>"
  for (const m of raw.matchAll(/Running:\s+(.{5,120})/g)) {
    commands.add(m[1].trim());
  }

  return [...commands].slice(0, 10);
}

function buildDigest({ filesChanged, filesDeleted, errors, warnings, tests, commands }) {
  const parts = [];

  const fileCount = filesChanged.length + filesDeleted.length;
  if (fileCount > 0) {
    parts.push(`Touched ${fileCount} file(s)`);
    if (filesDeleted.length > 0) parts.push(`(${filesDeleted.length} deleted)`);
  } else {
    parts.push('No file changes detected');
  }

  if (commands.length > 0) {
    parts.push(`ran ${commands.length} command(s)`);
  }

  if (tests.passed + tests.failed > 0) {
    parts.push(`tests: ${tests.passed} passed, ${tests.failed} failed`);
  }

  if (errors.length > 0) {
    parts.push(`${errors.length} error(s) found`);
  }

  if (warnings.length > 0) {
    parts.push(`${warnings.length} warning(s)`);
  }

  return parts.join('. ') + '.';
}
