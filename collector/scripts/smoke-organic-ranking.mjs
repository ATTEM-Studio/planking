import { NaverMapCollector } from '../src/naver-map-collector.mjs';

const cases = [
  { keyword: '황성동맛집', targetMid: '2076542131' },
  { keyword: '하단역카페', targetMid: '1328453904' },
];

for (const testCase of cases) {
  const collector = new NaverMapCollector();
  const started = Date.now();
  const result = await collector.collect({ ...testCase, maxRank: 300 });
  console.log('LIVE_RANK_SMOKE', JSON.stringify({
    ...testCase,
    elapsedMs: Date.now() - started,
    result,
  }, null, 2));
}
