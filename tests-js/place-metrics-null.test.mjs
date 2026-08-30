import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetricWindows } from '../web/rank-tracker-utils.mjs';

test('null review metrics remain unavailable instead of becoming zero', () => {
  const windows = buildMetricWindows([
    { measured_date: '2026-08-31', visitor_review_count: null, blog_review_count: null, save_count_raw: null },
    { measured_date: '2026-08-30', visitor_review_count: 100, blog_review_count: 50, save_count_raw: '1,000+' },
  ], '2026-08-31');
  assert.deepEqual(windows.periods['1'].visitorReviews, { kind: 'unavailable' });
  assert.deepEqual(windows.periods['1'].blogReviews, { kind: 'unavailable' });
  assert.deepEqual(windows.periods['1'].save, { kind: 'unavailable' });
});
