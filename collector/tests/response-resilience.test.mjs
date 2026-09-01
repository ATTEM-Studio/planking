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

class MalformedResponse extends FakeResponse {
  async json() {
    throw new SyntaxError('Unexpected end of JSON input');
  }
}

test('a malformed matching response does not poison a later valid page response', async () => {
  const handlers = [];
  const page = {
    on(event, handler) {
      if (event === 'response') handlers.push(handler);
    },
    async goto() {
      const malformed = new MalformedResponse(
        'https://map.naver.com/p/api/search/allSearch?query=x',
        null,
      );
      for (const handler of handlers) await handler(malformed);

      setTimeout(async () => {
        const valid = new FakeResponse(
          'https://map.naver.com/p/api/search/allSearch?query=x',
          { result: { place: { list: [{ id: 'target', name: 'Target' }] } } },
        );
        for (const handler of handlers) await handler(valid);
      }, 5);
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
  const context = {
    async newPage() { return page; },
    async close() {},
  };
  const browserFactory = async () => ({
    async newContext() { return context; },
    async close() {},
  });

  const result = await new NaverMapCollector({
    browserFactory,
    timeoutMs: 100,
    pageDelayMs: 0,
  }).collect({ keyword: '황성동맛집', targetMid: 'target' });

  assert.equal(result.status, 'FOUND');
  assert.equal(result.rank, 1);
  assert.equal(result.errorCode, null);
});
