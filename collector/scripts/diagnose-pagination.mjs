import { NaverMapCollector } from '../src/naver-map-collector.mjs';

const keyword = process.env.KEYWORD || '하단역카페';
const targetMid = process.env.TARGET_MID || '1328453904';
const result = await new NaverMapCollector({ timeoutMs: 30000, metricEnrichmentTimeoutMs: 20000 }).collect({
  keyword,
  targetMid,
  maxRank: 300,
});

console.log('COLLECTOR_RESULT', JSON.stringify(result, null, 2));
if (result.status !== 'FOUND') {
  throw new Error(`expected FOUND for pagination fallback smoke, got ${result.status}: ${result.errorMessage || ''}`);
}
if (!(result.rank > 20 && result.rank <= 300)) {
  throw new Error(`expected target beyond first 20 results, got rank ${result.rank}`);
}
