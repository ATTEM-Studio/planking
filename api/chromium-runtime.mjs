import { existsSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';

const DEFAULT_EXECUTABLE = '/tmp/chromium';
const DEFAULT_LOCK = '/tmp/planking-chromium-extract.lock';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function createChromiumExecutableResolver({
  getExecutablePath,
  executablePath = DEFAULT_EXECUTABLE,
  lockPath = DEFAULT_LOCK,
  exists = existsSync,
  openLock = path => open(path, 'wx'),
  removeLock = path => unlink(path),
  sleep = wait,
  waitMs = 150,
  maxWaits = 200,
} = {}) {
  if (typeof getExecutablePath !== 'function') {
    throw new TypeError('getExecutablePath is required');
  }

  let inFlight = null;

  async function resolveOnce() {
    if (exists(executablePath)) return executablePath;

    for (let attempt = 0; attempt < maxWaits; attempt += 1) {
      if (exists(executablePath)) return executablePath;

      let lockHandle = null;
      try {
        lockHandle = await openLock(lockPath);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        await sleep(waitMs);
        continue;
      }

      try {
        if (exists(executablePath)) return executablePath;
        return await getExecutablePath();
      } finally {
        try {
          await lockHandle?.close?.();
        } finally {
          try {
            await removeLock(lockPath);
          } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
          }
        }
      }
    }

    throw new Error('timed out waiting for Chromium extraction lock');
  }

  return async function resolveChromiumExecutable() {
    if (exists(executablePath)) return executablePath;
    if (!inFlight) {
      inFlight = resolveOnce().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}
