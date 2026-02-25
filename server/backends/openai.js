/**
 * server/backends/openai.js — Phase 15.1: Direct OpenAI API Backend
 *
 * Calls OpenAI Chat Completions API directly via HTTPS (no SDK dependency).
 * Supports GPT-4o, GPT-4.5, o1, o3, etc.
 *
 * Requires: OPENAI_API_KEY environment variable.
 * Returns a simulated ChildProcess via a stdout stream.
 */

import { Readable, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import https from 'node:https';

export default class OpenAIBackend {
  get name() { return 'openai'; }

  /**
   * @param {string} prompt
   * @param {string} workDir
   * @param {object} opts
   * @param {string} opts.model
   * @param {object} opts.modelConfig
   * @returns {{ process: ChildProcess-like, cliCommand: string }}
   */
  spawn(prompt, workDir, opts = {}) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return this._failProcess('OPENAI_API_KEY not set');
    }

    const model = opts.model || 'gpt-4o';
    const maxTokens = opts.modelConfig?.maxTokens || 16384;

    // Create a fake child process that streams API response
    const fakeProcess = new EventEmitter();
    fakeProcess.stdout = new Readable({ read() {} });
    fakeProcess.stderr = new Readable({ read() {} });
    fakeProcess.stdin = new Writable({ write(_, __, cb) { cb(); } });
    fakeProcess.pid = process.pid;
    fakeProcess.kill = () => { fakeProcess.killed = true; };
    fakeProcess.killed = false;

    const cliCommand = `openai-api ${model} "${prompt.slice(0, 80)}..."`;

    // Make the API call asynchronously
    setImmediate(() => this._callAPI(fakeProcess, apiKey, model, prompt, maxTokens, workDir));

    return { process: fakeProcess, cliCommand };
  }

  async _callAPI(fakeProcess, apiKey, model, prompt, maxTokens, workDir) {
    const body = JSON.stringify({
      model,
      max_completion_tokens: maxTokens,
      messages: [
        {
          role: 'system',
          content: `You are an expert software engineer. Working directory: ${workDir}. Complete the task described in the user message. Output ONLY the file changes needed.`,
        },
        { role: 'user', content: prompt },
      ],
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    try {
      const response = await new Promise((resolve, reject) => {
        const req = https.request(options, resolve);
        req.on('error', reject);
        req.write(body);
        req.end();
      });

      let data = '';
      response.on('data', chunk => {
        data += chunk.toString();
        fakeProcess.stdout.push(chunk);
      });

      response.on('end', () => {
        fakeProcess.stdout.push(null);
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            fakeProcess.stderr.push(Buffer.from(`OpenAI API error: ${parsed.error.message}\n`));
            fakeProcess.emit('close', 1);
          } else {
            fakeProcess.emit('close', 0);
          }
        } catch {
          fakeProcess.emit('close', 0);
        }
      });

      response.on('error', (err) => {
        fakeProcess.stderr.push(Buffer.from(`OpenAI API error: ${err.message}\n`));
        fakeProcess.stderr.push(null);
        fakeProcess.emit('close', 1);
      });
    } catch (err) {
      fakeProcess.stderr.push(Buffer.from(`Failed to call OpenAI API: ${err.message}\n`));
      fakeProcess.stderr.push(null);
      fakeProcess.emit('close', 1);
    }
  }

  _failProcess(errorMsg) {
    const fakeProcess = new EventEmitter();
    fakeProcess.stdout = new Readable({ read() {} });
    fakeProcess.stderr = new Readable({ read() {} });
    fakeProcess.stdin = new Writable({ write(_, __, cb) { cb(); } });
    fakeProcess.pid = 0;
    fakeProcess.kill = () => {};
    fakeProcess.killed = false;

    setImmediate(() => {
      fakeProcess.stderr.push(Buffer.from(`${errorMsg}\n`));
      fakeProcess.stderr.push(null);
      fakeProcess.stdout.push(null);
      fakeProcess.emit('close', 1);
    });

    return { process: fakeProcess, cliCommand: `[error] ${errorMsg}` };
  }
}
