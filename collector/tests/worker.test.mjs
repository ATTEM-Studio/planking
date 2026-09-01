import test from 'node:test';
import assert from 'node:assert/strict';
import { processClaimedJob, runOne } from '../src/worker.mjs';

function makeRepository(job = null) {
  const calls = [];
  return {
    calls,
    async claimNextJob() { calls.push(['claim']); return job; },
    async upsertHistory(slotId, measuredDate, result) { calls.push(['history', slotId, measuredDate, result]); },
    async upsertPlaceMetrics(targetMid, measuredDate, metrics) { calls.push(['metrics', targetMid, measuredDate, metrics]); },
    async completeJob(jobId, result) { calls.push(['complete', jobId, result]); },
    async failJob(jobId, result) { calls.push(['fail', jobId, result]); },
    async requeueJob(jobId, result) { calls.push(['requeue', jobId, result]); },
  };
}

const job = { id: 'job-1', slotId: 'slot-1', keyword: '경성대맛집', targetMid: '1340244014' };
const now = new Date('2026-08-30T07:00:00Z');

function foundCollector() {
  return {
    async collect() {
      return { status: 'FOUND', rank: 19, pagesScanned: 1, itemsScanned: 19, matchedMid: job.targetMid };
    },
  };
}

test('no pending job returns idle without calling collector', async () => {
  const repository = makeRepository(null);
  let called = 0;
  const collector = { async collect() { called += 1; } };
  assert.equal(await runOne({ repository, collector, now }), 'idle');
  assert.equal(called, 0);
});

test('FOUND upserts rank and place metrics then completes the job as SUCCESS', async () => {
  const repository = makeRepository(job);
  let called = 0;
  const collector = { async collect(query) {
    called += 1;
    assert.deepEqual(query, { keyword: job.keyword, targetMid: job.targetMid, maxRank: 300 });
    return {
      status: 'FOUND', rank: 19, pagesScanned: 1, itemsScanned: 19, matchedMid: job.targetMid,
      placeMetrics: { visitorReviewCount: 5498, blogReviewCount: 3166, saveCountRaw: '87,000+' },
    };
  } };
  assert.equal(await runOne({ repository, collector, now }), 'processed');
  assert.equal(called, 1);
  assert.equal(repository.calls[1][0], 'history');
  assert.equal(repository.calls[1][2], '2026-08-30');
  assert.deepEqual(repository.calls[2], [
    'metrics', job.targetMid, '2026-08-30',
    { visitorReviewCount: 5498, blogReviewCount: 3166, saveCountRaw: '87,000+' },
  ]);
  assert.equal(repository.calls[3][0], 'complete');
  assert.equal(repository.calls[3][2].status, 'SUCCESS');
});

test('measurement day stays on previous KST date until 13:59', async () => {
  const repository = makeRepository(job);
  await runOne({ repository, collector: foundCollector(), now: new Date('2026-08-31T04:59:59Z') });
  const history = repository.calls.find(call => call[0] === 'history');
  assert.equal(history[2], '2026-08-30');
});

test('measurement day switches at 14:00 KST', async () => {
  const repository = makeRepository(job);
  await runOne({ repository, collector: foundCollector(), now: new Date('2026-08-31T05:00:00Z') });
  const history = repository.calls.find(call => call[0] === 'history');
  assert.equal(history[2], '2026-08-31');
});

test('FOUND without exposed metrics still completes without fabricating a metrics row', async () => {
  const repository = makeRepository(job);
  const collector = { async collect() {
    return { status: 'FOUND', rank: 19, pagesScanned: 1, itemsScanned: 19, matchedMid: job.targetMid };
  } };
  await runOne({ repository, collector, now });
  assert.equal(repository.calls.some(call => call[0] === 'metrics'), false);
});

test('OUT_OF_RANGE writes null rank history but never fabricates place metrics', async () => {
  const repository = makeRepository(job);
  const result = { status: 'OUT_OF_RANGE', rank: null, pagesScanned: 6, itemsScanned: 300, matchedMid: null };
  const collector = { async collect() { return result; } };
  await runOne({ repository, collector, now });
  const history = repository.calls.find(call => call[0] === 'history');
  assert.equal(history[3].rank, null);
  assert.equal(repository.calls.some(call => call[0] === 'metrics'), false);
  const complete = repository.calls.find(call => call[0] === 'complete');
  assert.equal(complete[2].status, 'OUT_OF_RANGE');
});

for (const status of ['INCOMPLETE', 'BLOCKED', 'TIMEOUT', 'FAILED']) {
  test(`${status} does not overwrite history or place metrics and records terminal failure`, async () => {
    const repository = makeRepository(job);
    const collector = { async collect() {
      return { status, rank: null, pagesScanned: 1, itemsScanned: 20, matchedMid: null, errorCode: status, errorMessage: 'x' };
    } };
    await runOne({ repository, collector, now });
    assert.equal(repository.calls.some(call => call[0] === 'history'), false);
    assert.equal(repository.calls.some(call => call[0] === 'metrics'), false);
    const fail = repository.calls.find(call => call[0] === 'fail');
    assert.equal(fail[2].status, status);
  });
}

test('immediate first-registration failure is requeued instead of becoming a terminal failure', async () => {
  const repository = makeRepository(job);
  const collector = { async collect() {
    return {
      status: 'FAILED', rank: null, pagesScanned: 0, itemsScanned: 0,
      matchedMid: null, errorCode: 'WORKER_ERROR', errorMessage: 'transient chromium launch failure',
    };
  } };

  const result = await processClaimedJob({ repository, collector, rawJob: job, now, requeueOnFailure: true });
  assert.equal(result.status, 'FAILED');
  assert.equal(repository.calls.some(call => call[0] === 'fail'), false);
  const requeue = repository.calls.find(call => call[0] === 'requeue');
  assert.equal(requeue[1], job.id);
  assert.equal(requeue[2].errorCode, 'WORKER_ERROR');
});
