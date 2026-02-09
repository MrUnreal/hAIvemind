// @ts-check
/**
 * Structured logger for hAIvemind.
 *
 * Levels: error, warn, info, debug
 * Modes:
 *   - "pretty" (default) — colored, human-readable
 *   - "json"             — one JSON object per line (LOG_FORMAT=json)
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const COLORS = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m', debug: '\x1b[90m' };
const RESET = '\x1b[0m';

const logLevel = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;
const jsonMode = process.env.LOG_FORMAT === 'json';

function emit(level, category, args) {
  if (LEVELS[level] > logLevel) return;

  const ts = new Date().toISOString();
  const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');

  if (jsonMode) {
    const entry = { ts, level, ...(category ? { cat: category } : {}), msg };
    process.stderr.write(JSON.stringify(entry) + '\n');
  } else {
    const color = COLORS[level] || '';
    const tag = category ? `[${category}] ` : '';
    const prefix = `${color}${ts.slice(11, 23)} ${level.toUpperCase().padEnd(5)}${RESET} ${tag}`;
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(`${prefix}${msg}\n`);
  }
}

/**
 * Create a scoped logger with a fixed category.
 * @param {string} [category]
 */
export function createLogger(category) {
  return {
    error: (...args) => emit('error', category, args),
    warn: (...args) => emit('warn', category, args),
    info: (...args) => emit('info', category, args),
    debug: (...args) => emit('debug', category, args),
  };
}

/** Default (unscoped) logger instance */
const log = createLogger();
export default log;
