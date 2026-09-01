import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { NaverMapCollector } from '../src/naver-map-collector.mjs';
import { extractFirstPageItems, normalizeOrganicItems } from '../src/normalize.mjs';

async function currentFirstOrganicMid(keyword) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  let resolveItems;
  const itemsPromise = new Promise((resolve) => { resolveItems = resolve; });

  page.on('response', async (response) => {
    try {
      if (!response.url().includes('/p/api/search/allSearch')) return;
      resolveItems(extractFirstPageItems(await response.json()));
    } catch {}
  });

  try {
    await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(keyword)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const raw = await Promise.race([
      itemsPromise,
      page.waitForTimeout(8000).then(() => []),
    ]);
    return normalizeOrganicItems(raw)[0]?.mid ?? null;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

const fixedCases = [
  { keyword: '하단역카페', targetMid: '1328453904', expectedRank: 25 },
  { keyword: '황성동맛집', targetMid: '2076542131', expectedRank: 35 },
];

for (const testCase of fixedCases) {
  const collector = new NaverMapCollector();
  const started = Date.now();
  const result = await collector.collect({
    keyword: testCase.keyword,
    targetMid: testCase.targetMid,
    maxRank: 300,
  });
  console.log('LIVE_RANK_SMOKE', JSON.stringify({
    ...testCase,
    elapsedMs: Date.now() - started,
    result,
  }));
  assert.equal(result.status, 'FOUND', `${testCase.keyword} must be FOUND`);
  assert.equal(result.rank, testCase.expectedRank, `${testCase.keyword} live rank changed or fallback is wrong`);
}

const regressionKeyword = '하단카페';
const liveFirstMid = await currentFirstOrganicMid(regressionKeyword);
assert.ok(liveFirstMid, '하단카페 live first organic MID must be observable');
const regressionResult = await new NaverMapCollector().collect({
  keyword: regressionKeyword,
  targetMid: liveFirstMid,
  maxRank: 300,
});
console.log('LIVE_MAP_REGRESSION', JSON.stringify({
  keyword: regressionKeyword,
  targetMid: liveFirstMid,
  result: regressionResult,
}));
assert.equal(regressionResult.status, 'FOUND');
assert.equal(regressionResult.rank, 1);
