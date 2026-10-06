import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRank } from '../src/engine.mjs';

function adapter(result) { return { collect: async () => result }; }

test('collectRank matches target by exact place id and excludes ads from rank', async () => {
  const result = await collectRank({ keyword: '서면 맛집', targetPlaceId: '222', maxRank: 100 }, adapter({ items: [{ id: 'ad', name: '광고', isAd: true }, { id: '111', name: 'A' }, { id: '222', name: 'B' }], pagesScanned: 1 }));
  assert.equal(result.status, 'FOUND');
  assert.equal(result.rank, 2);
});

test('collectRank returns OUT_OF_RANGE only after a normal completed scan', async () => {
  const result = await collectRank({ keyword: '서면 맛집', targetPlaceId: '999', maxRank: 2 }, adapter({ items: [{ id: '111', name: 'A' }, { id: '222', name: 'B' }], pagesScanned: 1, completed: true }));
  assert.deepEqual({ status: result.status, rank: result.rank }, { status: 'OUT_OF_RANGE', rank: null });
});

test('collectRank maps blocked collection without a numeric rank', async () => {
  const result = await collectRank({ keyword: '서면 맛집', targetPlaceId: '999', maxRank: 100 }, adapter({ blocked: true, items: [] }));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.rank, null);
});

test('collectRank maps timeout errors', async () => {
  const timeoutAdapter = { collect: async () => { const error = new Error('navigation timeout'); error.name = 'TimeoutError'; throw error; } };
  const result = await collectRank({ keyword: '서면 맛집', targetPlaceId: '999', maxRank: 100 }, timeoutAdapter);
  assert.equal(result.status, 'TIMEOUT');
});

test('collectRank reports PARSE_ERROR when a normal page yields no parseable items', async () => {
  const result = await collectRank({ keyword: '서면 맛집', targetPlaceId: '999', maxRank: 100 }, adapter({ items: [], pagesScanned: 1, completed: false }));
  assert.equal(result.status, 'PARSE_ERROR');
});

test('collectRank accepts proven native collector results without recomputing rank', async () => {
  const nativeAdapter = adapter({ nativeRankResult: { status: 'FOUND', rank: 37, itemsScanned: 37, pagesScanned: 2, errorCode: null, errorMessage: null } });
  const result = await collectRank({ keyword: '서면 맛집', targetPlaceId: '222', maxRank: 100 }, nativeAdapter);
  assert.equal(result.status, 'FOUND');
  assert.equal(result.rank, 37);
  assert.equal(result.itemsScanned, 37);
});

test('collectRank maps legacy incomplete traversal to PARSE_ERROR, never OUT_OF_RANGE', async () => {
  const nativeAdapter = adapter({ nativeRankResult: { status: 'INCOMPLETE', rank: null, itemsScanned: 62, pagesScanned: 2, errorCode: 'INCOMPLETE_TRAVERSAL', errorMessage: 'page unavailable' } });
  const result = await collectRank({ keyword: '서면 맛집', targetPlaceId: '999', maxRank: 100 }, nativeAdapter);
  assert.equal(result.status, 'PARSE_ERROR');
  assert.equal(result.rank, null);
});
