/**
 * server/services/githubIssues.js — Phase 20.1: GitHub Issue Integration
 *
 * Inspired by SWE-agent: fetch a GitHub issue by URL or #number,
 * parse it into a structured prompt, and optionally auto-create
 * a session to fix it.
 *
 * Uses raw GitHub API (no SDK) — just HTTPS requests.
 * Supports: public repos (no token), private repos (with GITHUB_TOKEN).
 */

import https from 'node:https';
import http from 'node:http';

/**
 * Parse a GitHub issue URL or reference into owner/repo/number.
 *
 * Accepts:
 *   - https://github.com/owner/repo/issues/123
 *   - owner/repo#123
 *   - #123 (requires defaultRepo)
 *
 * @param {string} ref
 * @param {string} [defaultRepo] - e.g. "owner/repo"
 * @returns {{ owner: string, repo: string, number: number } | null}
 */
export function parseIssueRef(ref) {
  if (!ref) return null;

  // Full URL: https://github.com/owner/repo/issues/123
  const urlMatch = ref.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2], number: parseInt(urlMatch[3]) };
  }

  // Short form: owner/repo#123
  const shortMatch = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (shortMatch) {
    return { owner: shortMatch[1], repo: shortMatch[2], number: parseInt(shortMatch[3]) };
  }

  return null;
}

/**
 * Fetch a GitHub issue and its comments.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number} issueNumber
 * @param {object} [opts]
 * @param {string} [opts.token] - GitHub personal access token for private repos
 * @returns {Promise<GitHubIssue>}
 */
export async function fetchIssue(owner, repo, issueNumber, opts = {}) {
  const token = opts.token || process.env.GITHUB_TOKEN;

  // Fetch issue
  const issue = await githubGet(`/repos/${owner}/${repo}/issues/${issueNumber}`, token);

  // Fetch comments (first page, up to 30)
  let comments = [];
  if (issue.comments > 0) {
    try {
      comments = await githubGet(`/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=30`, token);
    } catch {
      // Comments fetch failed, continue without
    }
  }

  // Fetch linked PR diffs if any
  const linkedPRs = [];
  if (issue.pull_request) {
    // This IS a PR, not an issue
    try {
      const prFiles = await githubGet(`/repos/${owner}/${repo}/pulls/${issueNumber}/files?per_page=30`, token);
      linkedPRs.push({
        number: issueNumber,
        files: (prFiles || []).map(f => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
        })),
      });
    } catch {
      // PR files fetch failed
    }
  }

  return {
    number: issue.number,
    title: issue.title,
    body: issue.body || '',
    state: issue.state,
    labels: (issue.labels || []).map(l => l.name || l),
    author: issue.user?.login || 'unknown',
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    comments: (comments || []).map(c => ({
      author: c.user?.login || 'unknown',
      body: c.body || '',
      createdAt: c.created_at,
    })),
    linkedPRs,
    url: issue.html_url,
    repo: `${owner}/${repo}`,
  };
}

/**
 * Convert a GitHub issue into a structured prompt for decomposition.
 *
 * @param {GitHubIssue} issue
 * @param {object} [opts]
 * @param {boolean} [opts.includeComments=true]
 * @param {number} [opts.maxBodyLength=3000]
 * @returns {string}
 */
export function issueToPrompt(issue, opts = {}) {
  const includeComments = opts.includeComments ?? true;
  const maxBodyLength = opts.maxBodyLength ?? 3000;

  const sections = [];

  // Header
  sections.push(`Fix GitHub Issue #${issue.number}: ${issue.title}`);
  sections.push(`Source: ${issue.url}`);

  if (issue.labels.length > 0) {
    sections.push(`Labels: ${issue.labels.join(', ')}`);
  }

  sections.push('');

  // Body
  if (issue.body) {
    const body = issue.body.length > maxBodyLength
      ? issue.body.slice(0, maxBodyLength) + '\n... (truncated)'
      : issue.body;
    sections.push('## Issue Description\n');
    sections.push(body);
  }

  // Comments (context from discussion)
  if (includeComments && issue.comments.length > 0) {
    sections.push('\n## Discussion Context\n');
    // Take most recent 5 comments max
    const recentComments = issue.comments.slice(-5);
    for (const comment of recentComments) {
      const truncBody = comment.body.length > 500
        ? comment.body.slice(0, 500) + '...'
        : comment.body;
      sections.push(`**@${comment.author}:** ${truncBody}\n`);
    }
  }

  // Linked PR file context
  if (issue.linkedPRs.length > 0) {
    sections.push('\n## Related PR Changes\n');
    for (const pr of issue.linkedPRs) {
      sections.push(`PR #${pr.number} files:`);
      for (const f of pr.files.slice(0, 15)) {
        sections.push(`  - ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`);
      }
    }
  }

  // Instructions
  sections.push('\n## Task');
  sections.push('Analyze the issue above and implement the fix. Write tests for any changes.');
  sections.push('Follow existing codebase conventions. Create a minimal, focused fix.');

  return sections.join('\n');
}

// ─── GitHub API Helper ────────────────────────────────────────────────

function githubGet(path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'hAIvemind-agent/1.0',
        'Accept': 'application/vnd.github.v3+json',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid JSON from GitHub API: ${data.slice(0, 200)}`));
          }
        } else if (res.statusCode === 404) {
          reject(new Error(`GitHub issue not found: ${path}`));
        } else if (res.statusCode === 403) {
          reject(new Error('GitHub API rate limit exceeded or access denied'));
        } else {
          reject(new Error(`GitHub API error ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error('GitHub API request timed out'));
    });
    req.end();
  });
}
