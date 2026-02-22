/**
 * Phase 8.2: Agent Output Annotations
 * 
 * Utility to detect file paths (with optional line numbers) in text
 * and wrap them in clickable annotation spans.
 */

/**
 * Regex patterns for common file-path-like strings in console output.
 * Matches patterns like:
 *   src/index.js
 *   src/index.js:42
 *   src/index.js:42:10
 *   ./server/routes/sessions.js:155
 *   /absolute/path/file.ts:10
 *   file.py:100
 */
const FILE_PATH_RE = /(?:^|[\s'"(])((\.{0,2}\/)?(?:[\w.@-]+\/)*[\w.-]+\.(?:json|jsx|tsx|mjs|cjs|scss|less|yaml|yml|toml|bash|conf|svelte|astro|java|cpp|hpp|js|ts|vue|py|rb|go|rs|c|h|css|html|md|txt|sh|sql|xml|env|cfg|ini|log))(?::(\d+)(?::(\d+))?)?(?=[\s'")\],;:]|$)/gm;

/**
 * Annotate file paths in already-HTML-escaped text.
 * Wraps detected paths in <span class="file-annotation" data-path="..." data-line="...">
 * 
 * @param {string} html - HTML-escaped text (no raw HTML except our marks)
 * @returns {string} HTML with file paths wrapped in annotation spans
 */
export function annotateFilePaths(html) {
  if (!html) return html;

  return html.replace(FILE_PATH_RE, (match, filePath, _prefix, line, col) => {
    // Preserve the leading whitespace/character before the path
    const leadChar = match[0] !== '.' && match[0] !== '/' && !/[\w]/.test(match[0])
      ? match[0]
      : '';
    const fullMatch = leadChar ? match.slice(1) : match;

    const lineAttr = line ? ` data-line="${line}"` : '';
    const colAttr = col ? ` data-col="${col}"` : '';
    const displayLine = line ? `:${line}${col ? ':' + col : ''}` : '';

    return `${leadChar}<span class="file-annotation" data-path="${filePath}"${lineAttr}${colAttr} title="Click to view ${filePath}${displayLine}">${filePath}${displayLine}</span>`;
  });
}

/**
 * Extract all file references from a text block.
 * Returns unique file paths found in the text.
 * 
 * @param {string} text - Raw text (not HTML)
 * @returns {Array<{path: string, line?: number, col?: number}>}
 */
export function extractFileRefs(text) {
  if (!text) return [];
  const refs = [];
  const seen = new Set();
  let m;
  const re = new RegExp(FILE_PATH_RE.source, 'gm');
  while ((m = re.exec(text)) !== null) {
    const filePath = m[1];
    const line = m[3] ? parseInt(m[3], 10) : undefined;
    const col = m[4] ? parseInt(m[4], 10) : undefined;
    const key = `${filePath}:${line || ''}:${col || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ path: filePath, line, col });
    }
  }
  return refs;
}
