/**
 * server/services/promptGuard.js — Phase 18.1: Prompt Injection Defense
 *
 * Scans prompts and agent outputs for injection attempts:
 * - System prompt override attempts
 * - Instruction hijacking patterns
 * - Data exfiltration attempts
 * - Role confusion attacks
 *
 * Returns a risk score and can strip/modify suspicious content.
 */

// ─── Injection Patterns ──────────────────────────────────────────────
const INJECTION_PATTERNS = [
  // System prompt overrides
  { pattern: /\bignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?|context)\b/i, category: 'override', severity: 'high' },
  { pattern: /\byou\s+are\s+now\b.*\b(new|different|my)\s+(assistant|ai|bot|model)\b/i, category: 'override', severity: 'high' },
  { pattern: /\bforget\s+(everything|all|your)\b.*\b(said|told|instructed)\b/i, category: 'override', severity: 'high' },
  { pattern: /\bsystem\s*:\s*/i, category: 'override', severity: 'medium' },
  { pattern: /\b(new|override|replace)\s+(system\s+)?(prompt|instruction|directive)\b/i, category: 'override', severity: 'high' },

  // Instruction hijacking
  { pattern: /\bdo\s+not\s+(follow|obey|listen\s+to)\b.*\b(previous|original|above)\b/i, category: 'hijack', severity: 'high' },
  { pattern: /\bact\s+as\s+(if|though)\s+you\b.*\b(don'?t|no|without)\b.*\b(restrict|limit|boundar)\b/i, category: 'hijack', severity: 'high' },
  { pattern: /\b(jailbreak|DAN|developer\s+mode|unrestricted\s+mode)\b/i, category: 'hijack', severity: 'critical' },
  { pattern: /\bpretend\s+(you\s+)?(are|have)\s+no\s+(rules|restrictions|limits)\b/i, category: 'hijack', severity: 'high' },

  // Data exfiltration
  { pattern: /\b(print|show|reveal|display|output|write)\b.*\b(system\s+prompt|instructions|api[_\s]*key|password|secret|token|credential)\b/i, category: 'exfiltration', severity: 'high' },
  { pattern: /\b(curl|wget|fetch|http|https)\b.*\b(evil|attacker|exfil|malicious)\b/i, category: 'exfiltration', severity: 'critical' },
  { pattern: /\bsend\s+(data|info|content|output)\s+(to|via)\b/i, category: 'exfiltration', severity: 'medium' },

  // Encoded content (potential obfuscation)
  { pattern: /\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){5,}/i, category: 'obfuscation', severity: 'medium' },
  { pattern: /\\u[0-9a-f]{4}(?:\\u[0-9a-f]{4}){5,}/i, category: 'obfuscation', severity: 'medium' },

  // Role confusion
  { pattern: /\bI\s+am\s+(the\s+)?(admin|administrator|root|developer|owner)\b/i, category: 'role-confusion', severity: 'medium' },
  { pattern: /\bmy\s+authorization\s+(level|clearance)\s+is\b/i, category: 'role-confusion', severity: 'medium' },
];

/**
 * @typedef {Object} ScanResult
 * @property {boolean} safe — true if no significant threats detected
 * @property {number} riskScore — 0-1 risk score
 * @property {Array<{ pattern: string, category: string, severity: string, match: string }>} threats
 * @property {string} sanitized — cleaned text with injections removed
 */

/**
 * Scan text for prompt injection attempts.
 *
 * @param {string} text — text to scan
 * @param {object} [opts]
 * @param {string} [opts.minSeverity='medium'] — minimum severity to flag
 * @returns {ScanResult}
 */
export function scanForInjection(text, opts = {}) {
  if (!text || typeof text !== 'string') {
    return { safe: true, riskScore: 0, threats: [], sanitized: text || '' };
  }

  const minSeverity = opts.minSeverity || 'medium';
  const severityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
  const minSev = severityOrder[minSeverity] || 1;

  const threats = [];
  let sanitized = text;

  for (const rule of INJECTION_PATTERNS) {
    if (severityOrder[rule.severity] < minSev) continue;

    const match = text.match(rule.pattern);
    if (match) {
      threats.push({
        pattern: rule.pattern.source,
        category: rule.category,
        severity: rule.severity,
        match: match[0].slice(0, 100),
      });

      // Remove/replace the injection in sanitized output
      sanitized = sanitized.replace(rule.pattern, '[FILTERED]');
    }
  }

  // Calculate risk score
  let riskScore = 0;
  for (const t of threats) {
    switch (t.severity) {
      case 'critical': riskScore += 0.5; break;
      case 'high': riskScore += 0.3; break;
      case 'medium': riskScore += 0.15; break;
      case 'low': riskScore += 0.05; break;
    }
  }
  riskScore = Math.min(1, riskScore);

  return {
    safe: riskScore < 0.3,
    riskScore,
    threats,
    sanitized,
  };
}

/**
 * Sanitize a user prompt before sending to an LLM.
 * Removes detected injection attempts while preserving legitimate content.
 *
 * @param {string} prompt
 * @returns {{ prompt: string, wasModified: boolean, threats: Array }}
 */
export function sanitizePrompt(prompt) {
  const result = scanForInjection(prompt);

  if (result.safe) {
    return { prompt, wasModified: false, threats: [] };
  }

  console.warn(`[prompt-guard] Detected ${result.threats.length} injection attempt(s) (risk: ${result.riskScore.toFixed(2)})`);
  for (const t of result.threats) {
    console.warn(`  [${t.severity}] ${t.category}: "${t.match}"`);
  }

  return {
    prompt: result.sanitized,
    wasModified: true,
    threats: result.threats,
  };
}

/**
 * Scan agent output for attempts to leak system information.
 *
 * @param {string} output — agent output text
 * @returns {{ safe: boolean, leaks: string[] }}
 */
export function scanAgentOutput(output) {
  if (!output || typeof output !== 'string') {
    return { safe: true, leaks: [] };
  }

  const leaks = [];

  // Check for API key patterns in output
  const apiKeyPatterns = [
    { pattern: /sk-[a-zA-Z0-9]{20,}/, label: 'OpenAI API key' },
    { pattern: /sk-ant-[a-zA-Z0-9-]{20,}/, label: 'Anthropic API key' },
    { pattern: /ghp_[a-zA-Z0-9]{36}/, label: 'GitHub Personal Access Token' },
    { pattern: /gho_[a-zA-Z0-9]{36}/, label: 'GitHub OAuth Token' },
    { pattern: /AKIA[0-9A-Z]{16}/, label: 'AWS Access Key' },
    { pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, label: 'Private Key' },
  ];

  for (const { pattern, label } of apiKeyPatterns) {
    if (pattern.test(output)) {
      leaks.push(label);
    }
  }

  return { safe: leaks.length === 0, leaks };
}
