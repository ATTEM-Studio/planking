import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRankResult } from '../src/types.mjs';
import { findRankAcrossPages } from '../src/rank-engine.mjs';

test('OUT_OF_RANGE requires a null rank', () => {
  assert.doesNotThrow(() => assertRankResult({
    status: 'OUT_OF_RANGE',
    rank: null,
    pagesScanned: 6,
    itemsScanned: 300,
    matchedMid: null,
  }));
  assert.throws(() => assertRankResult({
    status: 'OUT_OF_RANGE',
    rank: 301,
    pagesScanned: 6,
    itemsScanned: 300,
    matchedMid: null,
  }), /rank must be null/);
});

test('finds target on page 2 using organic cumulative offset', () => {
  const pages = [
    Array.from({ length: 50 }, (_, i) => ({ mid: String(1000 + i), name: `P${i}` })),
    [
      { mid: 'ad-x', name: '광고', isAd: true },
      { mid: 'target', name: 'Target' },
    ],
  ];
  const result = findRankAcrossPages({ targetMid: 'target', pages, maxRank: 300 });
  assert.equal(result.status, 'FOUND');
  assert.equal(result.rank, 51);
});

test('complete top-300 traversal returns OUT_OF_RANGE with null rank', () => {
  const pages = Array.from({ length: 6 }, (_, page) =>
    Array.from({ length: 50 }, (_, i) => ({ mid: `${page}-${i}`, name: 'x' })),
  );
  const result = findRankAcrossPages({ targetMid: 'missing', pages, maxRank: 300 });
  assert.deepEqual({ status: result.status, rank: result.rank }, { status: 'OUT_OF_RANGE', rank: null });
});

test('short traversal remains incomplete unless Naver end is explicitly confirmed', () => {
  const pages = [[{ mid: '1', name: 'x' }]];
  assert.throws(
    () => findRankAcrossPages({ targetMid: 'missing', pages, maxRank: 300 }),
    /incomplete traversal/,
  );
  assert.throws(
    () => findRankAcrossPages({ targetMid: 'missing', pages, maxRank: 300, endConfirmed: false }),
    /incomplete traversal/,
  );
});

test('confirmed natural end may return OUT_OF_RANGE before 300 and ads never count', () => {
  const pages = [[
    { mid: 'ad-1', name: '광고 1', isAd: true },
    { mid: '1', name: 'organic 1' },
    { mid: 'ad-2', name: '광고 2', advertisement: { label: '광고' } },
    { mid: '2', name: 'organic 2' },
  ]];
  const result = findRankAcrossPages({
    targetMid: 'missing',
    pages,
    maxRank: 300,
    endConfirmed: true,
  });
  assert.equal(result.status, 'OUT_OF_RANGE');
  assert.equal(result.rank, null);
  assert.equal(result.itemsScanned, 2);
  assert.equal(result.pagesScanned, 1);
});
