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

test('GraphQL restaurant businesses items are preferred over nested item arrays', () => {
  const payload = [{ data: {
    restaurants: {
      businesses: {
        items: [
          { id: '222', name: '실제 업체', visitorImages: [{ id: 'image-1' }] },
          { id: '333', name: '실제 업체 2' },
        ],
      },
      filtersInfo: { filters: [{ items: [{ id: 'filter-1', name: '필터' }] }] },
    },
  } }];
  assert.deepEqual(extractGraphqlItems(payload).map(item => item.id), ['222', '333']);
});

test('GraphQL generic items are still found recursively for other Naver responses', () => {
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

test('Place Plus is a normal place result, not an advertisement', () => {
  const rows = [
    {
      id: '1486800818',
      name: '메가MGC커피 부산하단역점',
      promotionTitle: '플레이스 플러스',
      ppc: '1',
    },
  ];
  assert.deepEqual(normalizeOrganicItems(rows).map(row => row.mid), ['1486800818']);
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

test('current allSearch review fields map to visitor and blog review counts', () => {
  assert.deepEqual(extractPlaceMetrics({
    reviewCount: 31,
    placeReviewCount: 635,
  }), {
    visitorReviewCount: 635,
    blogReviewCount: 31,
    saveCountRaw: null,
  });
});

test('place metrics keep missing values null instead of fabricating zero', () => {
  assert.deepEqual(extractPlaceMetrics({}), {
    visitorReviewCount: null,
    blogReviewCount: null,
    saveCountRaw: null,
  });
});
