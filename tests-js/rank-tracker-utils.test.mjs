import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMetricChartPoints,
  buildMetricWindows,
  buildRankChartPoints,
  filterHistoryWindow,
  formatRankResult,
  groupSlotsByCompany,
  historySummary,
  jobLabel,
  jobProgress,
  metricSnapshotForDate,
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

test('jobProgress shows queue position and elapsed time without inventing a percentage', () => {
  const now = new Date('2026-09-01T05:00:00Z');
  const pending = jobProgress({
    status: 'PENDING',
    requested_at: '2026-09-01T04:51:00Z',
  }, { now, queuePosition: 2 });
  assert.deepEqual(pending, {
    tone: 'waiting',
    title: '수집 대기 중',
    detail: '대기 9분 · 대기열 2번째',
    stale: false,
  });

  const running = jobProgress({
    status: 'RUNNING',
    requested_at: '2026-09-01T04:50:00Z',
    started_at: '2026-09-01T04:59:22Z',
  }, { now });
  assert.deepEqual(running, {
    tone: 'running',
    title: '네이버 순위 수집 중',
    detail: '시작 후 38초 · 결과 확인 중',
    stale: false,
  });
});

test('jobProgress flags stale queue jobs instead of leaving users waiting indefinitely', () => {
  const progress = jobProgress({
    status: 'PENDING',
    requested_at: '2026-09-01T02:52:00Z',
  }, { now: new Date('2026-09-01T05:00:00Z'), queuePosition: 1 });

  assert.equal(progress.title, '처리 지연 감지');
  assert.equal(progress.detail, '대기 2시간 8분 · 대기열 1번째 · Worker 실행 지연');
  assert.equal(progress.stale, true);
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
    '2026-08-30', '2026-08-27',
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

const metricsHistory = [
  { measured_date: '2026-08-31', visitor_review_count: 2100, blog_review_count: 600, save_count_raw: '87,000+' },
  { measured_date: '2026-08-30', visitor_review_count: 2082, blog_review_count: 590, save_count_raw: '87,000+' },
  { measured_date: '2026-08-24', visitor_review_count: 2020, blog_review_count: 570, save_count_raw: '80,000+' },
  { measured_date: '2026-08-01', visitor_review_count: 1800, blog_review_count: 500, save_count_raw: '70,000+' },
];

test('metricSnapshotForDate uses exact calendar dates only', () => {
  assert.equal(metricSnapshotForDate(metricsHistory, '2026-08-30').visitor_review_count, 2082);
  assert.equal(metricSnapshotForDate(metricsHistory, '2026-08-29'), null);
});

test('buildMetricWindows compares today with exact 1, 7, and 30 day dates', () => {
  const windows = buildMetricWindows(metricsHistory, '2026-08-31');
  assert.equal(windows.current.visitor_review_count, 2100);
  assert.deepEqual(windows.periods['1'].visitorReviews, { kind: 'number', delta: 18, from: 2082, to: 2100 });
  assert.deepEqual(windows.periods['7'].blogReviews, { kind: 'number', delta: 30, from: 570, to: 600 });
  assert.deepEqual(windows.periods['30'].visitorReviews, { kind: 'number', delta: 300, from: 1800, to: 2100 });
});

test('buildMetricWindows preserves raw save buckets and never fabricates arithmetic', () => {
  const windows = buildMetricWindows(metricsHistory, '2026-08-31');
  assert.deepEqual(windows.periods['1'].save, { kind: 'same', from: '87,000+', to: '87,000+' });
  assert.deepEqual(windows.periods['7'].save, { kind: 'changed', from: '80,000+', to: '87,000+' });
  assert.deepEqual(windows.periods['30'].save, { kind: 'changed', from: '70,000+', to: '87,000+' });
});

test('buildMetricWindows reports unavailable when exact comparison date is missing', () => {
  const windows = buildMetricWindows(metricsHistory.filter(row => row.measured_date !== '2026-08-24'), '2026-08-31');
  assert.deepEqual(windows.periods['7'].visitorReviews, { kind: 'unavailable' });
  assert.deepEqual(windows.periods['7'].save, { kind: 'unavailable' });
});

test('buildMetricChartPoints scales numeric metric histories without inventing save values', () => {
  const points = buildMetricChartPoints(metricsHistory, 'visitor_review_count', 600, 220);
  assert.equal(points.length, 4);
  assert.equal(points[0].date, '2026-08-01');
  assert.equal(points.at(-1).value, 2100);
  assert.ok(points.at(-1).y < points[0].y);
  assert.deepEqual(buildMetricChartPoints(metricsHistory, 'save_count_raw', 600, 220), []);
});

test('groupSlotsByCompany groups multiple keywords under the same MID without duplicating companies', () => {
  const sharedMetrics = [{ measured_date: '2026-08-31', visitor_review_count: 5498, blog_review_count: 3166, save_count_raw: '87,000+' }];
  const groups = groupSlotsByCompany([
    { id: 's1', keyword: '하단고기집', targetMid: '1800550902', placeName: '부산삼겹살 하단본점', placeMetrics: sharedMetrics, history: [] },
    { id: 's2', keyword: '하단삼겹살', targetMid: '1800550902', placeName: '부산삼겹살 하단본점', placeMetrics: sharedMetrics, history: [] },
    { id: 's3', keyword: '하단카페', targetMid: '1328453904', placeName: '꿈카페 하단지점', placeMetrics: [], history: [] },
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].targetMid, '1800550902');
  assert.equal(groups[0].placeName, '부산삼겹살 하단본점');
  assert.deepEqual(groups[0].slots.map((slot) => slot.keyword), ['하단고기집', '하단삼겹살']);
  assert.equal(groups[0].placeMetrics, sharedMetrics);
  assert.equal(groups[1].targetMid, '1328453904');
  assert.equal(groups[1].slots.length, 1);
});

test('groupSlotsByCompany prefers a usable place name and the richest metrics history for a MID', () => {
  const shortMetrics = [{ measured_date: '2026-08-31' }];
  const longMetrics = [{ measured_date: '2026-08-31' }, { measured_date: '2026-08-30' }];
  const groups = groupSlotsByCompany([
    { id: 's1', keyword: 'A', targetMid: '11111', placeName: '', placeMetrics: shortMetrics },
    { id: 's2', keyword: 'B', targetMid: '11111', placeName: '업체명', placeMetrics: longMetrics },
  ]);

  assert.equal(groups[0].placeName, '업체명');
  assert.equal(groups[0].placeMetrics, longMetrics);
});
