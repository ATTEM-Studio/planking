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

function continuationFromRank8(mapItems, { targetMid = null, targetRank = null, prefix = 'Next' } = {}) {
  const items = [...mapItems.slice(7)]; // natural GraphQL starts at absolute organic rank 8
  for (let rank = 21; rank <= 39; rank += 1) {
    if (targetMid && rank === targetRank) items.push({ id: String(targetMid), name: 'Target' });
    else items.push({ id: `${prefix}-${rank}`, name: `${prefix} ${rank}` });
  }
  return items.slice(0, 32);
}

function makeFallbackBrowser({
  mapItems,
  searchItems,
  templateSeed,
  templateSeeds = null,
  searchItemsBySeed = null,
  templateStart = 8,
  templateDisplay = 32,
}) {
  const mapResponseHandlers = [];
  const requestHandlers = [];
  const visitedSeeds = [];
  const replayInputs = [];
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
        variables: {
          input: {
            query: seed,
            start: templateStart,
            display: templateDisplay,
            nlu: `seed-region:${seed}`,
          },
        },
      }]);
      for (const handler of requestHandlers) handler(request);
    },
    async waitForTimeout() {},
    async evaluate(_callback, replay) {
      const operations = Array.isArray(replay.body) ? replay.body : [replay.body];
      const input = operations.find((operation) => operation?.operationName === 'getRestaurants')?.variables?.input ?? {};
      replayInputs.push({
        query: input.query ?? null,
        start: input.start ?? null,
        display: input.display ?? null,
        nlu: input.nlu ?? null,
        seed: activeSeed,
      });
      const items = searchItemsBySeed?.[activeSeed] ?? searchItems;
      return {
        status: 200,
        json: [{ data: { restaurants: { businesses: { items } } } }],
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
    replayInputs,
  };
}

test('uses Naver natural start/display and overlapping map ranks to find 하단역카페 at 25', async () => {
  const mapItems = makeMapItems();
  const searchItems = continuationFromRank8(mapItems, {
    targetMid: '1328453904',
    targetRank: 25,
  });
  const fake = makeFallbackBrowser({ mapItems, searchItems, templateSeed: '하단카페' });

  const result = await new NaverMapCollector({
    browserFactory: fake.browserFactory,
    pageDelayMs: 0,
    metricEnrichmentTimeoutMs: 50,
  }).collect({ keyword: '하단역카페', targetMid: '1328453904', maxRank: 300 });

  assert.equal(result.status, 'FOUND');
  assert.equal(result.rank, 25);
  assert.ok(fake.visitedSeeds.includes('하단카페'));
  assert.deepEqual(fake.replayInputs.at(-1), {
    query: '하단역카페',
    start: 8,
    display: 32,
    nlu: null,
    seed: '하단카페',
  });
});

test('retries another map-derived seed when the natural overlap is misaligned', async () => {
  const mapItems = makeGyeongjuMapItems();
  const wrong = continuationFromRank8(mapItems, { prefix: 'Wrong' });
  [wrong[0], wrong[1]] = [wrong[1], wrong[0]];
  const aligned = continuationFromRank8(mapItems, {
    targetMid: '2076542131',
    targetRank: 35,
    prefix: 'Gyeongju',
  });

  const fake = makeFallbackBrowser({
    mapItems,
    templateSeeds: ['황성동맛집', '경주시 황성동 양식'],
    searchItemsBySeed: {
      황성동맛집: wrong,
      '경주시 황성동 양식': aligned,
    },
  });

  const result = await new NaverMapCollector({
    browserFactory: fake.browserFactory,
    pageDelayMs: 0,
    metricEnrichmentTimeoutMs: 50,
  }).collect({ keyword: '황성동맛집', targetMid: '2076542131', maxRank: 300 });

  assert.equal(result.status, 'FOUND');
  assert.equal(result.rank, 35);
  assert.ok(fake.visitedSeeds.includes('경주시 황성동 양식'));
  const acceptedReplay = fake.replayInputs.find((input) => input.seed === '경주시 황성동 양식');
  assert.deepEqual(acceptedReplay, {
    query: '황성동맛집',
    start: 8,
    display: 32,
    nlu: null,
    seed: '경주시 황성동 양식',
  });
});

test('keeps INCOMPLETE when every natural GraphQL overlap disagrees with the map', async () => {
  const mapItems = makeMapItems();
  const searchItems = continuationFromRank8(mapItems, { targetMid: '1328453904', targetRank: 25 });
  [searchItems[0], searchItems[1]] = [searchItems[1], searchItems[0]];
  const fake = makeFallbackBrowser({ mapItems, searchItems, templateSeed: '하단카페' });

  const result = await new NaverMapCollector({
    browserFactory: fake.browserFactory,
    pageDelayMs: 0,
    metricEnrichmentTimeoutMs: 50,
  }).collect({ keyword: '하단역카페', targetMid: '1328453904', maxRank: 300 });

  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.rank, null);
  assert.equal(result.itemsScanned, 20);
});

test('never promotes a natural-offset fallback miss to OUT_OF_RANGE or 300+', async () => {
  const mapItems = makeMapItems();
  const searchItems = continuationFromRank8(mapItems, { prefix: 'NoTarget' });
  const fake = makeFallbackBrowser({ mapItems, searchItems, templateSeed: '하단카페' });

  const result = await new NaverMapCollector({
    browserFactory: fake.browserFactory,
    pageDelayMs: 0,
    metricEnrichmentTimeoutMs: 50,
  }).collect({ keyword: '하단역카페', targetMid: 'missing-mid', maxRank: 300 });

  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.rank, null);
  assert.notEqual(result.status, 'OUT_OF_RANGE');
  assert.equal(result.itemsScanned, 20);
});
