import { NaverMapCollector } from '../src/naver-map-collector.mjs';

const keyword = process.env.KEYWORD || '하단카페맛집';
const targetMid = process.env.TARGET_MID || '1328453904';

const result = await new NaverMapCollector({
  timeoutMs: 45000,
  metricEnrichmentTimeoutMs: 20000,
}).collect({
  keyword,
  targetMid,
  maxRank: 300,
});

console.log('KEYWORD_DIAGNOSTIC_RESULT', JSON.stringify({ keyword, targetMid, ...result }, null, 2));
