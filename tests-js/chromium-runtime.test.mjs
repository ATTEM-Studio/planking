import assert from 'node:assert/strict';
import test from 'node:test';

import { createChromiumExecutableResolver } from '../api/chromium-runtime.mjs';


test('concurrent first registrations share one Chromium extraction', async () => {
  let extractionCalls = 0;
  let lockHeld = false;

  const resolver = createChromiumExecutableResolver({
    exists: () => false,
    getExecutablePath: async () => {
      extractionCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 20));
      return '/tmp/chromium';
    },
    openLock: async () => {
      if (lockHeld) {
        const error = new Error('locked');
        error.code = 'EEXIST';
        throw error;
      }
      lockHeld = true;
      return { close: async () => {} };
    },
    removeLock: async () => { lockHeld = false; },
    sleep: async () => {},
  });

  const [first, second, third] = await Promise.all([resolver(), resolver(), resolver()]);
  assert.deepEqual([first, second, third], ['/tmp/chromium', '/tmp/chromium', '/tmp/chromium']);
  assert.equal(extractionCalls, 1);
});


test('existing Chromium executable skips extraction entirely', async () => {
  let extractionCalls = 0;
  const resolver = createChromiumExecutableResolver({
    exists: path => path === '/tmp/chromium',
    getExecutablePath: async () => {
      extractionCalls += 1;
      return '/tmp/chromium';
    },
  });

  assert.equal(await resolver(), '/tmp/chromium');
  assert.equal(extractionCalls, 0);
});
