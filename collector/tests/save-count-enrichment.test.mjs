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

function emit(handlers, response) {
  return Promise.all(handlers.map(handler => handler(response)));
}

function makeBrowser() {
  let pageIndex = 0;
  const context = {
    async newPage() {
      pageIndex += 1;
      const handlers = [];
      if (pageIndex === 1) {
        return {
          on(event, handler) { if (event === 'response') handlers.push(handler); },
          async goto() {
            await emit(handlers, new FakeResponse(
              'https://map.naver.com/p/api/search/allSearch?query=x',
              { result: { place: { list: [{ id: 'target', name: 'Target', placeReviewCount: 635, reviewCount: 31 }] } } },
            ));
          },
          async content() { return '<html></html>'; },
          async title() { return ''; },
          frameLocator() { throw new Error('pagination should not be needed'); },
          async waitForTimeout() {},
          async close() {},
        };
      }

      return {
        on(event, handler) { if (event === 'response') handlers.push(handler); },
        async goto(url) {
          assert.match(url, /^https:\/\/search\.naver\.com\/search\.naver\?/);
          await emit(handlers, new FakeResponse(
            'https://pcmap-api.place.naver.com/graphql',
            [{ data: { restaurants: { businesses: { items: [{
              id: 'target',
              name: 'Target',
              visitorReviewCount: 635,
              blogCafeReviewCount: 31,
              saveCount: '87,000+',
            }] } } } }],
          ));
        },
        async close() {},
      };
    },
    async close() {},
  };
  return {
    async newContext() { return context; },
    async close() {},
  };
}

test('enriches FOUND result with saveCount from Naver getRestaurants GraphQL', async () => {
  const collector = new NaverMapCollector({
    browserFactory: async () => makeBrowser(),
    pageDelayMs: 0,
    metricEnrichmentTimeoutMs: 100,
  });

  const result = await collector.collect({ keyword: '하단카페', targetMid: 'target' });

  assert.equal(result.status, 'FOUND');
  assert.equal(result.rank, 1);
  assert.deepEqual(result.placeMetrics, {
    visitorReviewCount: 635,
    blogReviewCount: 31,
    saveCountRaw: '87,000+',
  });
});
