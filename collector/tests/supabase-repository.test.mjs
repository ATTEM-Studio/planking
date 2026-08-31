import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseRankRepository } from '../src/supabase-repository.mjs';

function fakeFetchFactory() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    let body = '';
    if (String(url).includes('/rpc/claim_next_rank_job')) {
      body = JSON.stringify([{ job_id: 'j1', slot_id: 's1', keyword: 'k', target_mid: 'm' }]);
    } else if (String(url).includes('/rpc/claim_rank_job')) {
      body = JSON.stringify([{ job_id: 'j1', slot_id: 's1', keyword: 'k', target_mid: 'm' }]);
    } else if (String(url).includes('/rpc/enqueue_daily_rank_jobs')) {
      body = '2';
    }
    return { ok: true, status: 200, async text() { return body; } };
  };
  return { calls, fetchImpl };
}

test('claimNextJob uses apikey only for new Supabase secret keys', async () => {
  const { calls, fetchImpl } = fakeFetchFactory();
  const repo = new SupabaseRankRepository({ url: 'https://db.test', serviceRoleKey: 'sb_secret_example', fetchImpl });
  const job = await repo.claimNextJob();
  assert.deepEqual(job, { id: 'j1', slotId: 's1', keyword: 'k', targetMid: 'm' });
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/claim_next_rank_job$/);
  assert.equal(calls[0].options.headers.apikey, 'sb_secret_example');
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test('claimJobById atomically claims the requested pending job', async () => {
  const { calls, fetchImpl } = fakeFetchFactory();
  const repo = new SupabaseRankRepository({ url: 'https://db.test', serviceRoleKey: 'sb_secret_example', fetchImpl });
  const job = await repo.claimJobById('j1');
  assert.deepEqual(job, { id: 'j1', slotId: 's1', keyword: 'k', targetMid: 'm' });
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/claim_rank_job$/);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_job_id: 'j1' });
});

test('claimNextJob keeps bearer auth for legacy service role JWT', async () => {
  const { calls, fetchImpl } = fakeFetchFactory();
  const legacy = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';
  const repo = new SupabaseRankRepository({ url: 'https://db.test', serviceRoleKey: legacy, fetchImpl });
  await repo.claimNextJob();
  assert.equal(calls[0].options.headers.apikey, legacy);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${legacy}`);
});

test('enqueueDailyJobs calls the service-role-only daily RPC', async () => {
  const { calls, fetchImpl } = fakeFetchFactory();
  const repo = new SupabaseRankRepository({ url: 'https://db.test', serviceRoleKey: 'sb_secret_example', fetchImpl });
  const inserted = await repo.enqueueDailyJobs();
  assert.equal(inserted, 2);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/enqueue_daily_rank_jobs$/);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body, '{}');
});

test('upsertHistory uses slot/date conflict key and merge-duplicates', async () => {
  const { calls, fetchImpl } = fakeFetchFactory();
  const repo = new SupabaseRankRepository({ url: 'https://db.test/', serviceRoleKey: 'sb_secret_example', fetchImpl });
  await repo.upsertHistory('s1', '2026-08-30', {
    status: 'FOUND', rank: 19, pagesScanned: 1, itemsScanned: 19, matchedMid: 'm',
  });
  assert.match(calls[0].url, /rank_history\?on_conflict=slot_id,measured_date$/);
  assert.equal(calls[0].options.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.slot_id, 's1');
  assert.equal(payload.rank, 19);
});

test('upsertPlaceMetrics preserves raw save count and uses MID/date conflict key', async () => {
  const { calls, fetchImpl } = fakeFetchFactory();
  const repo = new SupabaseRankRepository({ url: 'https://db.test/', serviceRoleKey: 'sb_secret_example', fetchImpl });
  await repo.upsertPlaceMetrics('1800550902', '2026-08-31', {
    visitorReviewCount: 5498,
    blogReviewCount: 3166,
    saveCountRaw: '87,000+',
  });
  assert.match(calls[0].url, /place_metrics_history\?on_conflict=target_mid,measured_date$/);
  const payload = JSON.parse(calls[0].options.body);
  assert.deepEqual(payload, {
    target_mid: '1800550902',
    measured_date: '2026-08-31',
    visitor_review_count: 5498,
    blog_review_count: 3166,
    save_count_raw: '87,000+',
    measured_at: payload.measured_at,
  });
  assert.match(payload.measured_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('complete and fail update terminal job fields', async () => {
  const { calls, fetchImpl } = fakeFetchFactory();
  const repo = new SupabaseRankRepository({ url: 'https://db.test', serviceRoleKey: 'sb_secret_example', fetchImpl });
  await repo.completeJob('j1', { status: 'SUCCESS' });
  await repo.failJob('j2', { status: 'BLOCKED', errorCode: 'HTTP_429', errorMessage: 'blocked' });
  assert.equal(calls[0].options.method, 'PATCH');
  assert.equal(JSON.parse(calls[0].options.body).status, 'SUCCESS');
  assert.equal(JSON.parse(calls[1].options.body).status, 'BLOCKED');
  assert.equal(JSON.parse(calls[1].options.body).error_code, 'HTTP_429');
});
