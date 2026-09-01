import test from 'node:test';
import assert from 'node:assert/strict';
import { NaverMapCollector } from '../src/naver-map-collector.mjs';

class FakeResponse {
  constructor(url, payload, status = 200) {
    this._url = url;
    this._payload = payload;
    this._status = status;
  }
  url() { return this._url; }
  status() { return this._status; }
  async json() { return this._payload; }
}

class FakeRequest {
  constructor(url, body) {
    this._url = url;
    this._body = body;
  }
  url() { return this._url; }
  postData() { return JSON.stringify(this._body); }
}

function page1Response(items) {
  return new FakeResponse(
    'https://map.naver.com/p/api/search/allSearch?query=x',
    { result: { place: { list: items } } },
  );
}

function makeMapItems() {
  const items = Array.from({ length: 20 }, (_, index) => ({
    id: String(1000 + index),
    name: `Place ${index + 1}`,
  }));
  items[0] = {
    ...items[0],
    name: '메가MGC커피 부산하단역점',
    address: '부산광역시 사하구 하단동 589-20 1층, 2층 메가MGC커피',
    category: ['카페,디저트', '카페'],
  };
  return items;
}

function makeGyeongjuMapItems() {
  const items = Array.from({ length: 20 }, (_, index) => ({
    id: String(2000 + index),
    name: `Gyeongju Place ${index + 1}`,
  }));
  items[0] = {
    ...items[0],
    name: '코지하우스 경주점',
    address: '경상북도 경주시 황성동 1258 1층',
    roadAddress: '경상북도 경주시 광중길 57 1층',
    category: ['음식점', '양식'],
  };
  return items;
}

function makeFallbackBrowser({
  mapItems,
  searchItems,
  templateSeed,
  templateSeeds = null,
  searchItemsBySeed = null,
}) {
  const mapResponseHandlers = [];
  const requestHandlers = [];
  const visitedSeeds = [];
  let replayedQuery = null;
  let activeSeed = null;

  const acceptedTemplateSeeds = new Set(templateSeeds ?? (templateSeed ? [templateSeed] : []));

  const mapPage = {
    on(event, handler) {
      if (event === 'response') mapResponseHandlers.push(handler);
    },
    async goto() {
      const response = page1Response(mapItems);
      for (const handler of mapResponseHandlers) await handler(response);
    },
    async content() { return '<html></html>'; },
    async title() { return ''; },
    frameLocator() {
      return {
        getByRole() {
          return {
            async count() { return 0; },
            async click() {},
          };
        },
      };
    },
    async waitForTimeout() {},
  };

  const searchPage = {
    on(event, handler) {
      if (event === 'request') requestHandlers.push(handler);
    },
    async goto(url) {
      const seed = new URL(url).searchParams.get('query');
      activeSeed = seed;
      visitedSeeds.push(seed);
      if (!acceptedTemplateSeeds.has(seed)) return;

      const request = new FakeRequest('https://p-api.place.naver.com/graphql', [{
        operationName: 'getRestaurants',
        variables: { input: { query: seed, start: 1, display: 20, nlu: `region:${seed}` } },
      }]);
      for (const handler of requestHandlers) handler(request);
    },
    async waitForTimeout() {},
    async evaluate(_callback, replay) {
      const operations = Array.isArray(replay.body) ? replay.body : [replay.body];
      replayedQuery = operations.find((operation) => operation?.operationName === 'getRestaurants')?.variables?.input?.query ?? null;
      const items = searchItemsBySeed?.[activeSeed] ?? searchItems;
      return {
        status: 200,
        json: [{ data: { search: { result: { items } } } }],
      };
    },
    async close() {},
  };

  let pageIndex = 0;
  const context = {
    async newPage() {
      pageIndex += 1;
      return pageIndex === 1 ? mapPage : searchPage;
    },
    async close() {},
  };
  const browser = {
    async newContext() { return context; },
    async close() {},
  };

  return {
    browserFactory: async () => browser,
    visitedSeeds,
    replayedQuery: () => replayedQuery,
  };
}

test('derives a local category seed from live map fields and replays the original keyword', async () => {
  const mapItems = makeMapItems();
  const searchItems = [
    ...mapItems,
    { id: '1020', name: 'Place 21' },
    { id: '1021', name: 'Place 22' },
    { id: '1022', name: 'Place 23' },
    { id: '1023', name: 'Place 24' },
    { id: '1328453904', name: 'Target' },
  ];

  const fake = makeFallbackBrowser({
    mapItems,
    searchItems,
    templateSeed: '하단카페',
  });

  const result = await new NaverMapCollector({
    browserFactory: fake.browserFactory,
    pageDelayMs: 0,
    metricEnrichmentTimeoutMs: 50,
  }).collect({
    keyword: '하단역카페',
    targetMid: '1328453904',
    maxRank: 300,
  });

  assert.equal(result.status, 'FOUND');
  assert.equal(result.rank, 25);
  assert.ok(fake.visitedSeeds.includes('하단카페'));
  assert.equal(fake.replayedQuery(), '하단역카페');
});

test('retries with full map locality when the original search template is region-misaligned', async () => {
  const mapItems = makeGyeongjuMapItems();
  const wrongRegionItems = [...mapItems];
  [wrongRegionItems[0], wrongRegionItems[1]] = [wrongRegionItems[1], wrongRegionItems[0]];
  const alignedItems = [
    ...mapItems,
    { id: '2020', name: 'Gyeongju Place 21' },
    { id: '2021', name: 'Gyeongju Place 22' },
    { id: '2022', name: 'Gyeongju Place 23' },
    { id: '2023', name: 'Gyeongju Place 24' },
    { id: '2076542131', name: '우후죽순용황점' },
  ];

  const fake = makeFallbackBrowser({
    mapItems,
    templateSeeds: ['황성동맛집', '경주시 황성동 양식'],
    searchItemsBySeed: {
      황성동맛집: wrongRegionItems,
      '경주시 황성동 양식': alignedItems,
    },
  });

  const result = await new NaverMapCollector({
    browserFactory: fake.browserFactory,
    pageDelayMs: 0,
    metricEnrichmentTimeoutMs: 50,
  }).collect({
    keyword: '황성동맛집',
    targetMid: '2076542131',
    maxRank: 300,
  });

  assert.equal(result.status, 'FOUND');
  assert.equal(result.rank, 25);
  assert.ok(fake.visitedSeeds.includes('경주시 황성동 양식'));
  assert.equal(fake.replayedQuery(), '황성동맛집');
});

test('keeps INCOMPLETE when every search fallback seed remains misaligned with the map', async () => {
  const mapItems = makeMapItems();
  const mismatchedFirstPage = [...mapItems];
  [mismatchedFirstPage[0], mismatchedFirstPage[1]] = [mismatchedFirstPage[1], mismatchedFirstPage[0]];
  const searchItems = [
    ...mismatchedFirstPage,
    { id: '1020', name: 'Place 21' },
    { id: '1021', name: 'Place 22' },
    { id: '1022', name: 'Place 23' },
    { id: '1023', name: 'Place 24' },
    { id: '1328453904', name: 'Target' },
  ];

  const fake = makeFallbackBrowser({ mapItems, searchItems, templateSeed: '하단카페' });
  const result = await new NaverMapCollector({
    browserFactory: fake.browserFactory,
    pageDelayMs: 0,
    metricEnrichmentTimeoutMs: 50,
  }).collect({
    keyword: '하단역카페',
    targetMid: '1328453904',
    maxRank: 300,
  });

  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.rank, null);
  assert.equal(result.itemsScanned, 20);
});

test('never promotes a fallback miss to OUT_OF_RANGE or 300+', async () => {
  const mapItems = makeMapItems();
  const searchItems = [
    ...mapItems,
    { id: '1020', name: 'Place 21' },
    { id: '1021', name: 'Place 22' },
    { id: '1022', name: 'Place 23' },
    { id: '1023', name: 'Place 24' },
  ];

  const fake = makeFallbackBrowser({ mapItems, searchItems, templateSeed: '하단카페' });
  const result = await new NaverMapCollector({
    browserFactory: fake.browserFactory,
    pageDelayMs: 0,
    metricEnrichmentTimeoutMs: 50,
  }).collect({
    keyword: '하단역카페',
    targetMid: 'missing-mid',
    maxRank: 300,
  });

  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.rank, null);
  assert.notEqual(result.status, 'OUT_OF_RANGE');
  assert.equal(result.itemsScanned, 20);
});
