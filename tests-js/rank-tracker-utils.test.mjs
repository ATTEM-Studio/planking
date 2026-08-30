import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRankChartPoints,
  filterHistoryWindow,
  formatRankResult,
  historySummary,
  jobLabel,
  parseTargetMid,
  rankDelta,
} from '../web/rank-tracker-utils.mjs';

test('parseTargetMid accepts plain MID and Naver place URLs', () => {
  assert.equal(parseTargetMid('1340244014'), '1340244014');
  assert.equal(parseTargetMid(' https://map.naver.com/p/entry/place/1340244014 '), '1340244014');
  assert.equal(parseTargetMid('https://m.place.naver.com/restaurant/2018579107/home'), '2018579107');
  assert.equal(parseTargetMid('not-a-place'), '');
});

test('formatRankResult distinguishes found and true out of range', () => {
  assert.equal(formatRankResult({ status: 'FOUND', rank: 19 }), '19위');
  assert.equal(formatRankResult({ status: 'OUT_OF_RANGE', rank: null }), '300+');
  assert.equal(formatRankResult({ status: 'INCOMPLETE', rank: null }), '—');
  assert.equal(formatRankResult({ status: 'BLOCKED', rank: null }), '—');
  assert.equal(formatRankResult(null), '—');
});

test('jobLabel exposes incomplete traversal separately from failure', () => {
  assert.equal(jobLabel('INCOMPLETE'), '조회 불완전');
  assert.equal(jobLabel('FAILED'), '조회 실패');
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

test('filterHistoryWindow uses the newest measurement as the calendar anchor', () => {
  const history = [
    { measured_date: '2026-08-30', rank: 19, status: 'FOUND' },
    { measured_date: '2026-08-27', rank: 22, status: 'FOUND' },
    { measured_date: '2026-08-23', rank: 30, status: 'FOUND' },
    { measured_date: '2026-07-01', rank: 40, status: 'FOUND' },
  ];
  assert.deepEqual(filterHistoryWindow(history, '7').map((row) => row.measured_date), [
    '2026-08-30', '2026-08-27', '2026-08-23',
  ]);
  assert.equal(filterHistoryWindow(history, '30').length, 3);
  assert.equal(filterHistoryWindow(history, 'all').length, 4);
});

test('buildRankChartPoints maps best ranks toward the top and 300+ to the floor', () => {
  const points = buildRankChartPoints([
    { measured_date: '2026-08-28', rank: 30, status: 'FOUND' },
    { measured_date: '2026-08-29', rank: null, status: 'OUT_OF_RANGE' },
    { measured_date: '2026-08-30', rank: 10, status: 'FOUND' },
  ], 600, 220);
  assert.equal(points.length, 3);
  assert.ok(points[2].y < points[0].y);
  assert.equal(points[1].display, '300+');
  assert.ok(points[1].y > points[0].y);
});

test('historySummary returns latest, best, measured count, and change', () => {
  const summary = historySummary([
    { measured_date: '2026-08-30', rank: 19, status: 'FOUND' },
    { measured_date: '2026-08-29', rank: 20, status: 'FOUND' },
    { measured_date: '2026-08-28', rank: null, status: 'OUT_OF_RANGE' },
  ]);
  assert.equal(summary.latest, '19위');
  assert.equal(summary.best, '19위');
  assert.equal(summary.count, 3);
  assert.deepEqual(summary.delta, { direction: 'up', amount: 1 });
});
