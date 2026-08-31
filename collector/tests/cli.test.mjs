import test from 'node:test';
import assert from 'node:assert/strict';
import { drainQueue, exitCodeForResult, parseArgs } from '../src/cli.mjs';

test('parseArgs reads once keyword and mid', () => {
  assert.deepEqual(parseArgs(['once', '--keyword', '경성대맛집', '--mid', '1340244014']), {
    command: 'once', keyword: '경성대맛집', mid: '1340244014',
  });
});

test('parseArgs reads drain max jobs with a safe default', () => {
  assert.deepEqual(parseArgs(['drain']), { command: 'drain', maxJobs: 10 });
  assert.deepEqual(parseArgs(['drain', '--max', '3']), { command: 'drain', maxJobs: 3 });
  assert.throws(() => parseArgs(['drain', '--max', '0']), /--max/);
});

test('drainQueue recovers stale jobs then seeds daily jobs before claiming the queue', async () => {
  const order = [];
  const processed = await drainQueue({
    repository: {
      async requeueStaleJobs() {
        order.push('requeue-stale');
        return 1;
      },
      async enqueueDailyJobs() {
        order.push('enqueue-daily');
        return 3;
      },
    },
    collector: {},
    maxJobs: 10,
    delayMs: 0,
    runOneImpl: async () => {
      order.push('claim');
      return 'idle';
    },
    sleepImpl: async () => {},
  });
  assert.equal(processed, 0);
  assert.deepEqual(order, ['requeue-stale', 'enqueue-daily', 'claim']);
});

test('drainQueue stops when queue becomes idle', async () => {
  const states = ['processed', 'processed', 'idle'];
  let calls = 0;
  const processed = await drainQueue({
    repository: {},
    collector: {},
    maxJobs: 10,
    delayMs: 0,
    runOneImpl: async () => {
      calls += 1;
      return states.shift();
    },
    sleepImpl: async () => {},
  });
  assert.equal(processed, 2);
  assert.equal(calls, 3);
});

test('drainQueue respects maxJobs', async () => {
  let calls = 0;
  const processed = await drainQueue({
    repository: {},
    collector: {},
    maxJobs: 2,
    delayMs: 0,
    runOneImpl: async () => {
      calls += 1;
      return 'processed';
    },
    sleepImpl: async () => {},
  });
  assert.equal(processed, 2);
  assert.equal(calls, 2);
});

test('result exit code distinguishes successful measurement from collection failure', () => {
  assert.equal(exitCodeForResult({ status: 'FOUND' }), 0);
  assert.equal(exitCodeForResult({ status: 'OUT_OF_RANGE' }), 0);
  assert.equal(exitCodeForResult({ status: 'BLOCKED' }), 2);
  assert.equal(exitCodeForResult({ status: 'TIMEOUT' }), 2);
  assert.equal(exitCodeForResult({ status: 'FAILED' }), 2);
});
