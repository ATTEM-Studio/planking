import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRankResult, parseTargetMid, rankDelta } from '../web/rank-tracker-utils.mjs';

test('parseTargetMid accepts plain MID and Naver place URLs', () => {
  assert.equal(parseTargetMid('1340244014'), '1340244014');
  assert.equal(parseTargetMid(' https://map.naver.com/p/entry/place/1340244014 '), '1340244014');
  assert.equal(parseTargetMid('https://m.place.naver.com/restaurant/2018579107/home'), '2018579107');
  assert.equal(parseTargetMid('not-a-place'), '');
});

test('formatRankResult distinguishes found and true out of range', () => {
  assert.equal(formatRankResult({ status: 'FOUND', rank: 19 }), '19위');
  assert.equal(formatRankResult({ status: 'OUT_OF_RANGE', rank: null }), '300+');
  assert.equal(formatRankResult({ status: 'BLOCKED', rank: null }), '—');
  assert.equal(formatRankResult(null), '—');
});

test('rankDelta treats a lower rank number as improvement', () => {
  assert.deepEqual(rankDelta([
    { status: 'FOUND', rank: 19, measured_date: '2026-08-30' },
    { status: 'FOUND', rank: 20, measured_date: '2026-08-29' },
  ]), { direction: 'up', amount: 1 });

  assert.deepEqual(rankDelta([
    { status: 'FOUND', rank: 22, measured_date: '2026-08-30' },
    { status: 'FOUND', rank: 20, measured_date: '2026-08-29' },
  ]), { direction: 'down', amount: 2 });

  assert.equal(rankDelta([{ status: 'OUT_OF_RANGE', rank: null }]), null);
});
