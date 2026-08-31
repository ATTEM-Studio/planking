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

function makeFallbackBrowser({ mapItems, searchItems, templateSeed }) {
  const mapResponseHandlers = [];
  const requestHandlers = [];
  const visitedSeeds = [];
  let replayedQuery = null;

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
      visitedSeeds.push(seed);
      if (seed !== templateSeed) return;

      const request = new FakeRequest('https://p-api.place.naver.com/graphql', [{
        operationName: 'getRestaurants',
        variables: { input: { query: seed, start: 1, display: 20, nlu: {} } },
      }]);
      for (const handler of requestHandlers) handler(request);
    },
    async waitForTimeout() {},
    async evaluate(_callback, replay) {
      const operations = Array.isArray(replay.body) ? replay.body : [replay.body];
      replayedQuery = operations.find((operation) => operation?.operationName === 'getRestaurants')?.variables?.input?.query ?? null;
      return {
        status: 200,
        json: [{ data: { search: { result: { items: searchItems } } } }],
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
  const mapItems = Array.from({ length: 20 }, (_, index) => ({
    id: String(1000 + index),
    name: `Place ${index + 1}`,
  }));
  mapItems[0] = {
    ...mapItems[0],
    name: '메가MGC커피 부산하단역점',
    address: '부산광역시 사하구 하단동 589-20 1층, 2층 메가MGC커피',
    category: ['카페,디저트', '카페'],
  };

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
