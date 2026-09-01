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

function mapItems() {
  return Array.from({ length: 20 }, (_, index) => ({
    id: String(1000 + index),
    name: index === 0 ? '' : `Place ${index + 1}`,
  }));
}

function searchItems(firstPage) {
  const items = [...firstPage.slice(7)];
  items.push({ id: '2000', name: 'Rank 21' });
  items.push({ id: '1328453904', name: '꿈카페 하단지점' });
  for (let rank = 23; rank <= 39; rank += 1) {
    items.push({ id: `2000-${rank}`, name: `Rank ${rank}` });
  }
  return items.slice(0, 32);
}

function delayedFallbackBrowser({ delayMs }) {
  const firstPage = mapItems();
  const fallbackItems = searchItems(firstPage);
  const mapResponseHandlers = [];
  const searchRequestHandlers = [];
  let navigationToken = 0;

  const mapPage = {
    on(event, handler) {
      if (event === 'response') mapResponseHandlers.push(handler);
    },
    async goto() {
      const response = new FakeResponse(
        'https://map.naver.com/p/api/search/allSearch?query=x',
        { result: { place: { list: firstPage } } },
      );
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
    async waitForTimeout(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); },
  };

  const searchPage = {
    on(event, handler) {
      if (event === 'request') searchRequestHandlers.push(handler);
    },
    async goto(url) {
      navigationToken += 1;
      const token = navigationToken;
      const seed = new URL(url).searchParams.get('query');
      if (seed !== '하단카페맛집') return;
      setTimeout(() => {
        if (token !== navigationToken) return;
        const request = new FakeRequest('https://p-api.place.naver.com/graphql', [{
          operationName: 'getRestaurants',
          variables: {
            input: {
              query: seed,
              start: 8,
              display: 32,
              nlu: `late-template:${seed}`,
            },
          },
        }]);
        for (const handler of searchRequestHandlers) handler(request);
      }, delayMs);
    },
    async waitForTimeout(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); },
    async evaluate() {
      return {
        status: 200,
        json: [{ data: { restaurants: { businesses: { items: fallbackItems } } } }],
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
  return async () => browser;
}

test('Search fallback waits long enough for a delayed Vercel GraphQL template', async () => {
  const result = await new NaverMapCollector({
    browserFactory: delayedFallbackBrowser({ delayMs: 1750 }),
    pageDelayMs: 0,
    metricEnrichmentTimeoutMs: 1600,
    rankFallbackTimeoutMs: 3000,
  }).collect({
    keyword: '하단카페맛집',
    targetMid: '1328453904',
    maxRank: 300,
  });

  assert.equal(result.status, 'FOUND');
  assert.equal(result.rank, 22);
});
