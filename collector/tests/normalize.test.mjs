import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFirstPageItems, extractGraphqlItems, extractPlaceMetrics, normalizeOrganicItems } from '../src/normalize.mjs';

const page1 = {
  result: { place: { list: [
    { id: '111', name: '광고업체', isAd: true },
    { id: 1340244014, name: '태봉곱창 부경대 본점' },
  ] } },
};

test('first page list is extracted and ad rows are removed', () => {
  const raw = extractFirstPageItems(page1);
  const organic = normalizeOrganicItems(raw);
  assert.deepEqual(organic.map(row => row.mid), ['1340244014']);
});

test('GraphQL items are found recursively', () => {
  const payload = [{ data: { search: { result: { items: [{ id: '222', name: 'B' }] } } } }];
  assert.equal(extractGraphqlItems(payload)[0].id, '222');
});

test('unknown rows remain organic while explicit ad indicators are excluded', () => {
  const rows = [
    { id: '1', name: 'plain' },
    { id: '2', name: 'ad1', advertisement: { label: '광고' } },
    { id: '3', name: 'ad2', type: 'Advertisement' },
    { id: '4', name: 'promo', promotion: true },
    { name: 'missing mid' },
  ];
  assert.deepEqual(normalizeOrganicItems(rows).map(row => row.mid), ['1']);
});

test('place metrics preserve raw save bucket while parsing review counts', () => {
  assert.deepEqual(extractPlaceMetrics({
    visitorReviewCount: '5,498',
    blogCafeReviewCount: 3166,
    saveCount: '87,000+',
  }), {
    visitorReviewCount: 5498,
    blogReviewCount: 3166,
    saveCountRaw: '87,000+',
  });
});

test('place metrics keep missing values null instead of fabricating zero', () => {
  assert.deepEqual(extractPlaceMetrics({}), {
    visitorReviewCount: null,
    blogReviewCount: null,
    saveCountRaw: null,
  });
});
