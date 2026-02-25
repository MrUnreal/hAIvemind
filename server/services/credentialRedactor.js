/**
 * server/services/credentialRedactor.js — Phase 18.2: Credential Safety
 *
 * Redacts credentials, secrets, and sensitive data from:
 * - Agent prompts (before sending to LLMs)
 * - Agent output (before storing/displaying)
 * - Log output
 *
 * Prevents accidental exposure of API keys, passwords, tokens, etc.
 */

// ─── Credential Patterns ─────────────────────────────────────────────
const CREDENTIAL_PATTERNS = [
  // API keys
  { pattern: /\b(sk-[a-zA-Z0-9]{20,})\b/g, label: 'OpenAI Key', replacement: 'sk-***REDACTED***' },
  { pattern: /\b(sk-ant-[a-zA-Z0-9-]{20,})\b/g, label: 'Anthropic Key', replacement: 'sk-ant-***REDACTED***' },
  { pattern: /\b(ghp_[a-zA-Z0-9]{36})\b/g, label: 'GitHub PAT', replacement: 'ghp_***REDACTED***' },
  { pattern: /\b(gho_[a-zA-Z0-9]{36})\b/g, label: 'GitHub OAuth', replacement: 'gho_***REDACTED***' },
  { pattern: /\b(ghs_[a-zA-Z0-9]{36})\b/g, label: 'GitHub Installation', replacement: 'ghs_***REDACTED***' },
  { pattern: /\b(AKIA[0-9A-Z]{16})\b/g, label: 'AWS Access Key', replacement: 'AKIA***REDACTED***' },
  { pattern: /\b(xoxb-[a-zA-Z0-9-]+)\b/g, label: 'Slack Bot Token', replacement: 'xoxb-***REDACTED***' },
  { pattern: /\b(xoxp-[a-zA-Z0-9-]+)\b/g, label: 'Slack User Token', replacement: 'xoxp-***REDACTED***' },

  // Private keys (multi-line aware)
  { pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC |DSA )?PRIVATE KEY-----/g, label: 'Private Key', replacement: '***PRIVATE_KEY_REDACTED***' },

  // JWT tokens
  { pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g, label: 'JWT Token', replacement: '***JWT_REDACTED***' },

  // Generic secrets in env-style assignments
  { pattern: /\b((?:API_?KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL|AUTH)[\s]*[=:]\s*)(['"]?)([^\s'"*]{8,})\2/gi, label: 'Secret Assignment', replacement: '$1$2***REDACTED***$2' },

  // Bearer tokens in headers
  { pattern: /(Authorization:\s*Bearer\s+)([^\s]+)/gi, label: 'Bearer Token', replacement: '$1***REDACTED***' },

  // Basic auth in URLs
  { pattern: /(https?:\/\/)([^:@\s]+):([^@\s]+)@/gi, label: 'URL Credentials', replacement: '$1***:***@' },

  // Connection strings
  { pattern: /((?:mongodb|postgres|mysql|redis):\/\/)([^:@\s]+):([^@\s]+)@/gi, label: 'DB Credentials', replacement: '$1***:***@' },
];

/**
 * Redact credentials from text.
 *
 * @param {string} text — text to redact
 * @param {object} [opts]
 * @param {boolean} [opts.logRedactions=false] — log what was redacted
 * @returns {{ text: string, redactionCount: number, redactedTypes: string[] }}
 */
export function redact(text, opts = {}) {
  if (!text || typeof text !== 'string') {
    return { text: text || '', redactionCount: 0, redactedTypes: [] };
  }

  let result = text;
  let redactionCount = 0;
  const redactedTypes = new Set();

  for (const { pattern, label, replacement } of CREDENTIAL_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;

    const matches = result.match(pattern);
    if (matches) {
      redactionCount += matches.length;
      redactedTypes.add(label);
      result = result.replace(pattern, replacement);

      if (opts.logRedactions) {
        console.warn(`[credential-redactor] Redacted ${matches.length}× ${label}`);
      }
    }
  }

  return {
    text: result,
    redactionCount,
    redactedTypes: [...redactedTypes],
  };
}

/**
 * Redact credentials from environment variables before passing to agents.
 * Returns a clean copy of process.env with sensitive values masked.
 *
 * @param {object} env — environment variables (usually process.env)
 * @returns {object} cleaned environment
 */
export function redactEnv(env) {
  const SENSITIVE_KEYS = /^(.*_)?(API_?KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL|AUTH|PRIVATE|SIGNING|ENCRYPTION)(\s.*)?$/i;

  const cleaned = {};
  for (const [key, value] of Object.entries(env)) {
    if (SENSITIVE_KEYS.test(key)) {
      // Mask: keep first 4 chars, replace rest with ***
      cleaned[key] = value && value.length > 4
        ? value.slice(0, 4) + '***'
        : '***';
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * Check if text contains any credentials.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function containsCredentials(text) {
  if (!text || typeof text !== 'string') return false;
  for (const { pattern } of CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
}
