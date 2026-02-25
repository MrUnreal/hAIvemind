/**
 * server/services/repoMap.js — Phase 20.0: AST-Aware Repo Map
 *
 * Inspired by aider's tree-sitter repo map: extracts function, class,
 * method, and export definitions from source files to produce a structured
 * symbol map. This gives the decomposer much richer codebase context than
 * a raw file tree — it knows WHAT each file defines, not just that it exists.
 *
 * Uses regex-based extraction (no native tree-sitter dependency) for
 * broad language support without compiled bindings.
 */

import { readdir, readFile, access } from 'node:fs/promises';
import { join, extname, relative, basename } from 'node:path';

// ─── Ignore Patterns ─────────────────────────────────────────────────
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.haivemind', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '__pycache__', '.venv', 'venv',
  'target', '.cargo', 'vendor', '.idea', '.vscode',
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts',
  '.jsx', '.tsx', '.vue', '.svelte',
  '.py', '.rs', '.go', '.java', '.rb', '.php',
  '.c', '.cpp', '.h', '.hpp', '.cs',
]);

// ─── Language-Specific Symbol Extractors ──────────────────────────────

const EXTRACTORS = {
  javascript: extractJSSymbols,
  typescript: extractJSSymbols,  // TS superset of JS patterns
  python: extractPythonSymbols,
  rust: extractRustSymbols,
  go: extractGoSymbols,
  java: extractJavaSymbols,
  ruby: extractRubySymbols,
  csharp: extractCSharpSymbols,
};

const EXT_TO_LANG = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.jsx': 'javascript', '.tsx': 'typescript',
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.vue': 'javascript', '.svelte': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.rb': 'ruby',
  '.cs': 'csharp',
  '.c': 'javascript',  // C function syntax similar enough
  '.cpp': 'javascript', '.h': 'javascript', '.hpp': 'javascript',
};

/**
 * Build a structured repo map of the workspace.
 *
 * Returns a map of relative file paths → symbol definitions,
 * plus a compact prompt-ready string.
 *
 * @param {string} workDir - Absolute path to workspace root
 * @param {object} [opts]
 * @param {number} [opts.maxFiles=200] - Max files to scan
 * @param {number} [opts.maxFileSize=100000] - Skip files larger than this (bytes)
 * @param {number} [opts.maxDepth=6] - Max directory depth
 * @returns {Promise<RepoMap>}
 */
export async function buildRepoMap(workDir, opts = {}) {
  const maxFiles = opts.maxFiles ?? 200;
  const maxFileSize = opts.maxFileSize ?? 100_000;
  const maxDepth = opts.maxDepth ?? 6;

  // Collect all code files
  const codeFiles = [];
  await collectCodeFiles(workDir, workDir, codeFiles, maxFiles, maxDepth, 0);

  // Extract symbols from each file
  const fileMap = {};
  let totalSymbols = 0;

  for (const filePath of codeFiles) {
    const relPath = relative(workDir, filePath).replace(/\\/g, '/');
    const ext = extname(filePath);
    const lang = EXT_TO_LANG[ext];

    if (!lang) continue;

    try {
      const content = await readFile(filePath, 'utf-8');
      if (content.length > maxFileSize) continue;

      const extractor = EXTRACTORS[lang] || extractJSSymbols;
      const symbols = extractor(content);

      if (symbols.length > 0) {
        fileMap[relPath] = symbols;
        totalSymbols += symbols.length;
      }
    } catch {
      // Skip unreadable files
    }
  }

  return {
    files: fileMap,
    stats: {
      filesScanned: codeFiles.length,
      filesWithSymbols: Object.keys(fileMap).length,
      totalSymbols,
    },
    toPromptContext() {
      return formatRepoMap(fileMap);
    },
  };
}

/**
 * Recursively collect code files.
 */
async function collectCodeFiles(dir, rootDir, results, maxFiles, maxDepth, depth) {
  if (depth > maxDepth || results.length >= maxFiles) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Sort: files first (alphabetically), then dirs
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return 1;
    if (!a.isDirectory() && b.isDirectory()) return -1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (results.length >= maxFiles) break;

    if (IGNORE_DIRS.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      await collectCodeFiles(fullPath, rootDir, results, maxFiles, maxDepth, depth + 1);
    } else if (CODE_EXTENSIONS.has(extname(entry.name))) {
      results.push(fullPath);
    }
  }
}

// ─── JavaScript / TypeScript Extractor ───────────────────────────────

function extractJSSymbols(content) {
  const symbols = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    // Export default function/class
    let m;

    // export function name(...)
    m = trimmed.match(/^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*\(/);
    if (m) { symbols.push({ type: 'function', name: m[1], line: i + 1, exported: true }); continue; }

    // export class Name
    m = trimmed.match(/^export\s+(?:default\s+)?class\s+(\w+)/);
    if (m) { symbols.push({ type: 'class', name: m[1], line: i + 1, exported: true }); continue; }

    // export const/let/var name =
    m = trimmed.match(/^export\s+(?:const|let|var)\s+(\w+)\s*=/);
    if (m) { symbols.push({ type: 'const', name: m[1], line: i + 1, exported: true }); continue; }

    // function name(...)
    m = trimmed.match(/^(?:async\s+)?function\s+(\w+)\s*\(/);
    if (m) { symbols.push({ type: 'function', name: m[1], line: i + 1, exported: false }); continue; }

    // class Name
    m = trimmed.match(/^class\s+(\w+)/);
    if (m) { symbols.push({ type: 'class', name: m[1], line: i + 1, exported: false }); continue; }

    // const name = (...) => ... or const name = function
    m = trimmed.match(/^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/);
    if (m) { symbols.push({ type: 'function', name: m[1], line: i + 1, exported: false }); continue; }

    // Class method: name(...) { or async name(...) {
    m = trimmed.match(/^(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/);
    if (m && !['if', 'for', 'while', 'switch', 'catch', 'return', 'throw'].includes(m[1])) {
      // Check if we're inside a class (rough heuristic: indented)
      if (line.match(/^\s{2,}/)) {
        symbols.push({ type: 'method', name: m[1], line: i + 1, exported: false });
      }
    }

    // export default { ... } or module.exports
    if (trimmed.startsWith('export default ') || trimmed.startsWith('module.exports')) {
      symbols.push({ type: 'export', name: 'default', line: i + 1, exported: true });
    }
  }

  return symbols;
}

// ─── Python Extractor ────────────────────────────────────────────────

function extractPythonSymbols(content) {
  const symbols = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    let m;

    // class ClassName:
    m = trimmed.match(/^class\s+(\w+)\s*[:(]/);
    if (m) { symbols.push({ type: 'class', name: m[1], line: i + 1, exported: !m[1].startsWith('_') }); continue; }

    // def function_name(
    m = trimmed.match(/^(?:async\s+)?def\s+(\w+)\s*\(/);
    if (m) {
      const isMethod = line.match(/^\s{4,}/);  // Indented = method
      symbols.push({
        type: isMethod ? 'method' : 'function',
        name: m[1],
        line: i + 1,
        exported: !m[1].startsWith('_'),
      });
    }
  }

  return symbols;
}

// ─── Rust Extractor ──────────────────────────────────────────────────

function extractRustSymbols(content) {
  const symbols = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    let m;

    // pub fn name(
    m = trimmed.match(/^(pub\s+)?(?:async\s+)?fn\s+(\w+)/);
    if (m) { symbols.push({ type: 'function', name: m[2], line: i + 1, exported: !!m[1] }); continue; }

    // struct Name
    m = trimmed.match(/^(pub\s+)?struct\s+(\w+)/);
    if (m) { symbols.push({ type: 'struct', name: m[2], line: i + 1, exported: !!m[1] }); continue; }

    // enum Name
    m = trimmed.match(/^(pub\s+)?enum\s+(\w+)/);
    if (m) { symbols.push({ type: 'enum', name: m[2], line: i + 1, exported: !!m[1] }); continue; }

    // impl Name
    m = trimmed.match(/^impl\s+(\w+)/);
    if (m) { symbols.push({ type: 'impl', name: m[1], line: i + 1, exported: false }); }

    // trait Name
    m = trimmed.match(/^(pub\s+)?trait\s+(\w+)/);
    if (m) { symbols.push({ type: 'trait', name: m[2], line: i + 1, exported: !!m[1] }); }
  }

  return symbols;
}

// ─── Go Extractor ────────────────────────────────────────────────────

function extractGoSymbols(content) {
  const symbols = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    let m;

    // func Name( or func (r Receiver) Name(
    m = trimmed.match(/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/);
    if (m) {
      symbols.push({
        type: 'function',
        name: m[1],
        line: i + 1,
        exported: m[1][0] === m[1][0].toUpperCase(),
      });
      continue;
    }

    // type Name struct/interface
    m = trimmed.match(/^type\s+(\w+)\s+(struct|interface)/);
    if (m) {
      symbols.push({
        type: m[2],
        name: m[1],
        line: i + 1,
        exported: m[1][0] === m[1][0].toUpperCase(),
      });
    }
  }

  return symbols;
}

// ─── Java Extractor ──────────────────────────────────────────────────

function extractJavaSymbols(content) {
  const symbols = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    let m;

    // public/private/protected class Name
    m = trimmed.match(/^(?:public|private|protected)?\s*(?:abstract\s+)?(?:static\s+)?class\s+(\w+)/);
    if (m) { symbols.push({ type: 'class', name: m[1], line: i + 1, exported: trimmed.includes('public') }); continue; }

    // public/private method
    m = trimmed.match(/^(?:public|private|protected)\s+(?:static\s+)?(?:abstract\s+)?(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(/);
    if (m) { symbols.push({ type: 'method', name: m[1], line: i + 1, exported: trimmed.includes('public') }); continue; }

    // interface Name
    m = trimmed.match(/^(?:public\s+)?interface\s+(\w+)/);
    if (m) { symbols.push({ type: 'interface', name: m[1], line: i + 1, exported: true }); }
  }

  return symbols;
}

// ─── Ruby Extractor ──────────────────────────────────────────────────

function extractRubySymbols(content) {
  const symbols = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    let m;

    // class ClassName
    m = trimmed.match(/^class\s+(\w+)/);
    if (m) { symbols.push({ type: 'class', name: m[1], line: i + 1, exported: true }); continue; }

    // module ModuleName
    m = trimmed.match(/^module\s+(\w+)/);
    if (m) { symbols.push({ type: 'module', name: m[1], line: i + 1, exported: true }); continue; }

    // def method_name
    m = trimmed.match(/^def\s+(self\.)?(\w+[?!]?)/);
    if (m) {
      symbols.push({
        type: m[1] ? 'class_method' : 'method',
        name: m[2],
        line: i + 1,
        exported: !m[2].startsWith('_'),
      });
    }
  }

  return symbols;
}

// ─── C# Extractor ────────────────────────────────────────────────────

function extractCSharpSymbols(content) {
  const symbols = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    let m;

    // class Name
    m = trimmed.match(/^(?:public|internal|private|protected)?\s*(?:abstract\s+|static\s+|sealed\s+)*class\s+(\w+)/);
    if (m) { symbols.push({ type: 'class', name: m[1], line: i + 1, exported: trimmed.includes('public') }); continue; }

    // interface IName
    m = trimmed.match(/^(?:public|internal)?\s*interface\s+(\w+)/);
    if (m) { symbols.push({ type: 'interface', name: m[1], line: i + 1, exported: true }); continue; }

    // public ReturnType MethodName(
    m = trimmed.match(/^(?:public|private|protected|internal)\s+(?:static\s+|async\s+|virtual\s+|override\s+)*\w+(?:<[^>]+>)?\s+(\w+)\s*\(/);
    if (m && !['if', 'for', 'while', 'class', 'new'].includes(m[1])) {
      symbols.push({ type: 'method', name: m[1], line: i + 1, exported: trimmed.includes('public') });
    }
  }

  return symbols;
}

// ─── Format for Prompt Injection ─────────────────────────────────────

/**
 * Format the repo map as a compact, readable string for prompt context.
 * Output resembles aider's repo map format:
 *
 *   server/index.js
 *     ⊕ function createServer (L12)
 *     ⊕ class AppRouter (L45)
 *     ○ function helper (L89)
 *
 * ⊕ = exported, ○ = internal
 *
 * @param {Object} fileMap
 * @returns {string}
 */
function formatRepoMap(fileMap) {
  const lines = ['## Repo Map (symbols by file)\n'];

  // Sort files for consistent output
  const sortedFiles = Object.keys(fileMap).sort();

  for (const filePath of sortedFiles) {
    const symbols = fileMap[filePath];
    lines.push(`**${filePath}**`);

    for (const sym of symbols) {
      const marker = sym.exported ? '⊕' : '○';
      lines.push(`  ${marker} ${sym.type} ${sym.name} (L${sym.line})`);
    }

    lines.push('');  // blank line between files
  }

  return lines.join('\n');
}
