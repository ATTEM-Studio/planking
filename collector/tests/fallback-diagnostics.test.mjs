import test from 'node:test';
import assert from 'node:assert/strict';
import { NaverMapCollector } from '../src/naver-map-collector.mjs';

class FakeResponse {
  constructor(url, payload) {
    this._url = url;
    this._payload = payload;
  }
  url() { return this._url; }
  status() { return 200; }
  async json() { return this._payload; }
}

class FakeRequest {
  constructor(body) { this._body = body; }
  url() { return 'https://p-api.place.naver.com/graphql'; }
  postData() { return JSON.stringify(this._body); }
}

function browserWithMisalignedSearch() {
  const mapItems = Array.from({ length: 20 }, (_, index) => ({
    id: String(1000 + index),
    name: `Place ${index + 1}`,
  }));
  const searchItems = [...mapItems.slice(7)];
  for (let rank = 21; rank <= 39; rank += 1) {
    searchItems.push({ id: `next-${rank}`, name: `Next ${rank}` });
  }
  [searchItems[0], searchItems[1]] = [searchItems[1], searchItems[0]];

  const mapResponseHandlers = [];
  const requestHandlers = [];
  const mapPage = {
    on(event, handler) { if (event === 'response') mapResponseHandlers.push(handler); },
    async goto() {
      const response = new FakeResponse(
        'https://map.naver.com/p/api/search/allSearch?query=x',
        { result: { place: { list: mapItems } } },
      );
      for (const handler of mapResponseHandlers) await handler(response);
    },
    async content() { return '<html></html>'; },
    async title() { return ''; },
    frameLocator() {
      return { getByRole() { return { async count() { return 0; } }; } };
    },
  };
  const searchPage = {
    on(event, handler) { if (event === 'request') requestHandlers.push(handler); },
    async goto(url) {
      const seed = new URL(url).searchParams.get('query');
      const request = new FakeRequest([{
        operationName: 'getRestaurants',
        variables: { input: { query: seed, start: 8, display: 32 } },
      }]);
      for (const handler of requestHandlers) handler(request);
    },
    async waitForTimeout() {},
    async evaluate() {
      return {
        status: 200,
        json: [{ data: { restaurants: { businesses: { items: searchItems.slice(0, 32) } } } }],
      };
    },
    async close() {},
  };

  let pageIndex = 0;
  const context = {
    async newPage() { pageIndex += 1; return pageIndex === 1 ? mapPage : searchPage; },
    async close() {},
  };
  return {
    async newContext() { return context; },
    async close() {},
  };
}

test('INCOMPLETE reports why the Search fallback was rejected', async () => {
  const result = await new NaverMapCollector({
    browserFactory: async () => browserWithMisalignedSearch(),
    pageDelayMs: 0,
    metricEnrichmentTimeoutMs: 50,
  }).collect({ keyword: '하단카페맛집', targetMid: '1328453904', maxRank: 300 });

  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.rank, null);
  assert.equal(result.errorCode, 'INCOMPLETE_TRAVERSAL');
  assert.match(result.errorMessage, /FALLBACK_ALIGNMENT_MISMATCH/);
});
