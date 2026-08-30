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

function makeBrowser({ page1, page2, content = '<html></html>', title = '', gotoError = null, includeUnrelated = false }) {
  const handlers = [];
  const page = {
    on(event, handler) { if (event === 'response') handlers.push(handler); },
    async goto() {
      if (gotoError) throw gotoError;
      if (includeUnrelated) {
        for (const handler of handlers) await handler(new FakeResponse('https://example.com/other', { nope: true }));
      }
      if (page1) {
        for (const handler of handlers) await handler(page1);
      }
    },
    async content() { return content; },
    async title() { return title; },
    frameLocator() {
      return {
        getByRole(_role, options) {
          const number = Number(options.name);
          return {
            async count() { return number === 2 && page2 ? 1 : 0; },
            async click() {
              if (number === 2 && page2) {
                for (const handler of handlers) await handler(page2);
              }
            },
          };
        },
      };
    },
    async waitForTimeout() {},
  };
  const context = {
    async newPage() { return page; },
    async close() {},
  };
  return {
    async newContext() { return context; },
    async close() {},
  };
}

function page1Response(items, status = 200) {
  return new FakeResponse(
    'https://map.naver.com/p/api/search/allSearch?query=x',
    { result: { place: { list: items } } },
    status,
  );
}

function graphResponse(items, status = 200) {
  return new FakeResponse(
    'https://pcmap-api.place.naver.com/graphql',
    [{ data: { search: { result: { items } } } }],
    status,
  );
}

test('uses allSearch network response for page 1', async () => {
  const browserFactory = async () => makeBrowser({
    page1: page1Response([{ id: 'target', name: 'Target' }]),
  });
  const result = await new NaverMapCollector({ browserFactory, pageDelayMs: 0 }).collect({
    keyword: '경성대맛집', targetMid: 'target',
  });
  assert.deepEqual({ status: result.status, rank: result.rank }, { status: 'FOUND', rank: 1 });
});

test('uses GraphQL response after page 2 click and preserves cumulative organic rank', async () => {
  const first = Array.from({ length: 50 }, (_, i) => ({ id: String(1000 + i), name: `P${i}` }));
  const browserFactory = async () => makeBrowser({
    page1: page1Response(first),
    page2: graphResponse([{ id: 'ad', name: 'Ad', isAd: true }, { id: 'target', name: 'Target' }]),
  });
  const result = await new NaverMapCollector({ browserFactory, pageDelayMs: 0 }).collect({
    keyword: '경성대맛집', targetMid: 'target',
  });
  assert.equal(result.status, 'FOUND');
  assert.equal(result.rank, 51);
});

test('classifies captcha body as BLOCKED', async () => {
  const browserFactory = async () => makeBrowser({
    page1: page1Response([]),
    content: '<html>CAPTCHA challenge</html>',
  });
  const result = await new NaverMapCollector({ browserFactory, pageDelayMs: 0 }).collect({ keyword: 'x', targetMid: 'y' });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.rank, null);
});

test('classifies HTTP 429 as BLOCKED', async () => {
  const browserFactory = async () => makeBrowser({ page1: page1Response([], 429) });
  const result = await new NaverMapCollector({ browserFactory, pageDelayMs: 0 }).collect({ keyword: 'x', targetMid: 'y' });
  assert.equal(result.status, 'BLOCKED');
});

test('classifies Playwright timeout as TIMEOUT', async () => {
  const error = new Error('navigation timeout');
  error.name = 'TimeoutError';
  const browserFactory = async () => makeBrowser({ gotoError: error });
  const result = await new NaverMapCollector({ browserFactory, pageDelayMs: 0 }).collect({ keyword: 'x', targetMid: 'y' });
  assert.equal(result.status, 'TIMEOUT');
  assert.equal(result.rank, null);
});

test('ignores unrelated network responses', async () => {
  const browserFactory = async () => makeBrowser({
    includeUnrelated: true,
    page1: page1Response([{ id: 'target', name: 'Target' }]),
  });
  const result = await new NaverMapCollector({ browserFactory, pageDelayMs: 0 }).collect({ keyword: 'x', targetMid: 'target' });
  assert.equal(result.status, 'FOUND');
});
