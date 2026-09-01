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

function page1Response(items, status = 200, totalCount = undefined) {
  const place = { list: items };
  if (totalCount !== undefined) place.totalCount = totalCount;
  return new FakeResponse(
    'https://map.naver.com/p/api/search/allSearch?query=x',
    { result: { place } },
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

test('FOUND includes target place metrics from the matched Naver item', async () => {
  const browserFactory = async () => makeBrowser({
    page1: page1Response([{
      id: 'target', name: 'Target', visitorReviewCount: '5,498', blogCafeReviewCount: 3166, saveCount: '87,000+',
    }]),
  });
  const result = await new NaverMapCollector({ browserFactory, pageDelayMs: 0 }).collect({ keyword: '하단고기집', targetMid: 'target' });
  assert.deepEqual(result.placeMetrics, {
    visitorReviewCount: 5498,
    blogReviewCount: 3166,
    saveCountRaw: '87,000+',
  });
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

test('falls back to aligned Naver search ranking when map pagination is unavailable', async () => {
  const first = Array.from({ length: 20 }, (_, i) => ({ id: String(1000 + i), name: `P${i}` }));
  const browserFactory = async () => makeBrowser({ page1: page1Response(first) });
  let fallbackCalls = 0;
  const rankSearchFallback = async ({ keyword, targetMid, mapFirstPage, maxRank }) => {
    fallbackCalls += 1;
    assert.equal(keyword, '하단역카페');
    assert.equal(targetMid, 'target');
    assert.equal(mapFirstPage.length, 20);
    assert.equal(maxRank, 300);
    return {
      status: 'FOUND',
      rank: 25,
      pagesScanned: 1,
      itemsScanned: 25,
      matchedMid: 'target',
      errorCode: null,
      errorMessage: null,
      placeMetrics: {
        visitorReviewCount: 635,
        blogReviewCount: 31,
        saveCountRaw: '100+',
      },
    };
  };
  const result = await new NaverMapCollector({ browserFactory, pageDelayMs: 0, rankSearchFallback }).collect({
    keyword: '하단역카페', targetMid: 'target',
  });
  assert.equal(fallbackCalls, 1);
  assert.equal(result.status, 'FOUND');
  assert.equal(result.rank, 25);
  assert.equal(result.placeMetrics.saveCountRaw, '100+');
});

test('confirmed natural end returns OUT_OF_RANGE before 300 and ads never count', async () => {
  const first = [
    { id: 'ad-1', name: '광고 1', isAd: true },
    { id: '1', name: 'organic 1' },
    { id: 'ad-2', name: '광고 2', advertisement: { label: '광고' } },
    { id: '2', name: 'organic 2' },
  ];
  const browserFactory = async () => makeBrowser({ page1: page1Response(first, 200, 2) });
  let fallbackCalls = 0;
  const result = await new NaverMapCollector({
    browserFactory,
    pageDelayMs: 0,
    rankSearchFallback: async () => {
      fallbackCalls += 1;
      return null;
    },
  }).collect({ keyword: '짧은키워드', targetMid: 'missing' });

  assert.equal(result.status, 'OUT_OF_RANGE');
  assert.equal(result.rank, null);
  assert.equal(result.itemsScanned, 2);
  assert.equal(fallbackCalls, 0);
});

test('large totalCount with only first 20 available stays INCOMPLETE', async () => {
  const first = Array.from({ length: 20 }, (_, i) => ({ id: String(1000 + i), name: `P${i}` }));
  const browserFactory = async () => makeBrowser({ page1: page1Response(first, 200, 2894) });
  const result = await new NaverMapCollector({
    browserFactory,
    pageDelayMs: 0,
    rankSearchFallback: async () => null,
  }).collect({ keyword: '황성동맛집', targetMid: 'missing' });

  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.rank, null);
  assert.equal(result.itemsScanned, 20);
  assert.equal(result.errorCode, 'INCOMPLETE_TRAVERSAL');
});

test('missing next page without an end signal is INCOMPLETE, never OUT_OF_RANGE', async () => {
  const first = Array.from({ length: 20 }, (_, i) => ({ id: String(1000 + i), name: `P${i}` }));
  const browserFactory = async () => makeBrowser({ page1: page1Response(first) });
  const result = await new NaverMapCollector({ browserFactory, pageDelayMs: 0 }).collect({
    keyword: '하단카', targetMid: 'missing',
  });
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.rank, null);
  assert.equal(result.itemsScanned, 20);
  assert.equal(result.errorCode, 'INCOMPLETE_TRAVERSAL');
  assert.equal(result.placeMetrics, undefined);
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
