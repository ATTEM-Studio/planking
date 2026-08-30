import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRankResult } from '../src/types.mjs';

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
