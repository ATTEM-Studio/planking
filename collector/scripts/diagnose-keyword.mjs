import { NaverMapCollector } from '../src/naver-map-collector.mjs';

const keyword = process.env.KEYWORD || '하단카페맛집';
const targetMid = process.env.TARGET_MID || '1328453904';
const timeoutMs = Number(process.env.TIMEOUT_MS || 15000);
const pageDelayMs = Number(process.env.PAGE_DELAY_MS || 450);
const metricEnrichmentTimeoutMs = Number(process.env.METRIC_TIMEOUT_MS || 9000);
const runtime = process.env.BROWSER_RUNTIME || 'playwright';

let browserFactory;
if (runtime === 'serverless') {
  const module = await import('../../api/rank_collect.mjs');
  browserFactory = module.serverlessBrowserFactory;
}

const startedAt = Date.now();
const result = await new NaverMapCollector({
  ...(browserFactory ? { browserFactory } : {}),
  timeoutMs,
  pageDelayMs,
  metricEnrichmentTimeoutMs,
}).collect({
  keyword,
  targetMid,
  maxRank: 300,
});

console.log('KEYWORD_DIAGNOSTIC_RESULT', JSON.stringify({
  keyword,
  targetMid,
  runtime,
  timeoutMs,
  pageDelayMs,
  metricEnrichmentTimeoutMs,
  elapsedMs: Date.now() - startedAt,
  ...result,
}, null, 2));
