import test from 'node:test';
import assert from 'node:assert/strict';
import { runOne } from '../src/worker.mjs';

function makeRepository(job = null) {
  const calls = [];
  return {
    calls,
    async claimNextJob() { calls.push(['claim']); return job; },
    async upsertHistory(slotId, measuredDate, result) { calls.push(['history', slotId, measuredDate, result]); },
    async completeJob(jobId, result) { calls.push(['complete', jobId, result]); },
    async failJob(jobId, result) { calls.push(['fail', jobId, result]); },
  };
}

const job = { id: 'job-1', slotId: 'slot-1', keyword: '경성대맛집', targetMid: '1340244014' };
const now = new Date('2026-08-30T07:00:00Z');

test('no pending job returns idle without calling collector', async () => {
  const repository = makeRepository(null);
  let called = 0;
  const collector = { async collect() { called += 1; } };
  assert.equal(await runOne({ repository, collector, now }), 'idle');
  assert.equal(called, 0);
});

test('FOUND upserts history then completes the job as SUCCESS', async () => {
  const repository = makeRepository(job);
  let called = 0;
  const collector = { async collect(query) {
    called += 1;
    assert.deepEqual(query, { keyword: job.keyword, targetMid: job.targetMid, maxRank: 300 });
    return { status: 'FOUND', rank: 19, pagesScanned: 1, itemsScanned: 19, matchedMid: job.targetMid };
  } };
  assert.equal(await runOne({ repository, collector, now }), 'processed');
  assert.equal(called, 1);
  assert.equal(repository.calls[1][0], 'history');
  assert.equal(repository.calls[1][2], '2026-08-30');
  assert.equal(repository.calls[2][0], 'complete');
  assert.equal(repository.calls[2][2].status, 'SUCCESS');
});

test('OUT_OF_RANGE writes null history and completes as OUT_OF_RANGE', async () => {
  const repository = makeRepository(job);
  const result = { status: 'OUT_OF_RANGE', rank: null, pagesScanned: 6, itemsScanned: 300, matchedMid: null };
  const collector = { async collect() { return result; } };
  await runOne({ repository, collector, now });
  const history = repository.calls.find(call => call[0] === 'history');
  assert.equal(history[3].rank, null);
  const complete = repository.calls.find(call => call[0] === 'complete');
  assert.equal(complete[2].status, 'OUT_OF_RANGE');
});

for (const status of ['BLOCKED', 'TIMEOUT', 'FAILED']) {
  test(`${status} does not overwrite history and records terminal failure`, async () => {
    const repository = makeRepository(job);
    const collector = { async collect() {
      return { status, rank: null, pagesScanned: 1, itemsScanned: 50, matchedMid: null, errorCode: status, errorMessage: 'x' };
    } };
    await runOne({ repository, collector, now });
    assert.equal(repository.calls.some(call => call[0] === 'history'), false);
    const fail = repository.calls.find(call => call[0] === 'fail');
    assert.equal(fail[2].status, status);
  });
}
