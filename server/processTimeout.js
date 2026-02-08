/**
 * Wrap a ChildProcess with a timeout that will terminate it if it runs too long.
 *
 * On timeout, the child receives SIGTERM, and after 5 seconds (if still running) SIGKILL.
 *
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} timeoutMs
 * @param {string} label
 * @returns {Promise<{ code: number | null, signal: NodeJS.Signals | null }>}
 */
export function withTimeout(child, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let exited = false;
    let cleanedUp = false;
    /** @type {NodeJS.Timeout | undefined} */
    let timeoutId;
    /** @type {NodeJS.Timeout | undefined} */
    let killTimer;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = undefined;
      }

      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
    };

    const onExit = (code, signal) => {
      exited = true;

      if (!settled) {
        settled = true;
        cleanup();

        if (code === 0) {
          resolve({ code, signal });
        } else {
          const message = signal
            ? `${label} exited with signal ${signal}`
            : `${label} exited with code ${code}`;
          reject(new Error(message));
        }
      } else {
        // Process exited after a timeout or error; just clean up listeners/timers.
        cleanup();
      }
    };

    const onError = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    child.on('exit', onExit);
    child.on('error', onError);

    timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;

      const timeoutError = new Error(`${label} timed out after ${timeoutMs / 60000} minutes`);

      // First attempt graceful termination.
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore errors when sending the signal (e.g., process already exited).
      }

      // After 5 seconds, if the process still hasn't exited, force kill it.
      killTimer = setTimeout(() => {
        if (!exited) {
          try {
            child.kill('SIGKILL');
          } catch {
            // Ignore errors when forcing termination.
          }
        }
        cleanup();
      }, 5000);

      reject(timeoutError);
    }, timeoutMs);
  });
}
