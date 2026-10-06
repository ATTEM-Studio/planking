import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRankResult, rankLabel } from '../src/index.mjs';

test('FOUND requires a positive rank and formats rank label', () => {
  const result = normalizeRankResult({ status: 'FOUND', rank: 7, itemsScanned: 20, pagesScanned: 1 });
  assert.equal(result.rank, 7);
  assert.equal(rankLabel(result), '7위');
});

test('OUT_OF_RANGE keeps rank null and formats using maxRank', () => {
  const result = normalizeRankResult({ status: 'OUT_OF_RANGE', rank: null, maxRank: 100, itemsScanned: 100, pagesScanned: 5 });
  assert.equal(result.rank, null);
  assert.equal(rankLabel(result), '100위 밖');
});

test('collector failure states reject a numeric rank', () => {
  assert.throws(() => normalizeRankResult({ status: 'BLOCKED', rank: 3 }), /must not include a numeric rank/);
});

test('unknown status is rejected', () => {
  assert.throws(() => normalizeRankResult({ status: 'MYSTERY', rank: null }), /Unknown rank status/);
});
