import { chromium } from 'playwright';
import { extractFirstPageItems, normalizeOrganicItems } from '../src/normalize.mjs';
import { NaverMapCollector } from '../src/naver-map-collector.mjs';

const keyword = process.env.KEYWORD || '하단역카페';
const targetMid = process.env.TARGET_MID || '1328453904';
const normalKeyword = process.env.NORMAL_KEYWORD || '하단카페';

async function inspectNonEmptyMapFirstPage(query, label) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  let captured = null;

  page.on('response', async (response) => {
    try {
      if (!response.url().includes('/p/api/search/allSearch')) return;
      const items = extractFirstPageItems(await response.json());
      if (!captured && items.length > 0) captured = items;
    } catch {}
  });

  try {
    await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const started = Date.now();
    while (!captured && Date.now() - started < 15000) await page.waitForTimeout(50);

    const first = normalizeOrganicItems(captured || [])[0];
    const raw = first?.raw && typeof first.raw === 'object' ? first.raw : {};
    console.log(label, JSON.stringify({
      keyword: query,
      mid: first?.mid || null,
      name: first?.name || null,
      commonAddress: raw.commonAddress ?? null,
      address: raw.address ?? null,
      roadAddress: raw.roadAddress ?? null,
      category: raw.category ?? null,
      businessCategory: raw.businessCategory ?? null,
    }, null, 2));
    return first || null;
  } finally {
    await context.close();
    await browser.close();
  }
}

await inspectNonEmptyMapFirstPage(keyword, 'FALLBACK_MAP_FIRST_ITEM');

const result = await new NaverMapCollector({ timeoutMs: 30000, metricEnrichmentTimeoutMs: 20000 }).collect({
  keyword,
  targetMid,
  maxRank: 300,
});

console.log('FALLBACK_COLLECTOR_RESULT', JSON.stringify(result, null, 2));
if (result.status !== 'FOUND') {
  throw new Error(`expected FOUND for pagination fallback smoke, got ${result.status}: ${result.errorMessage || ''}`);
}
if (!(result.rank > 20 && result.rank <= 300)) {
  throw new Error(`expected target beyond first 20 results, got rank ${result.rank}`);
}

const normalFirst = await inspectNonEmptyMapFirstPage(normalKeyword, 'NORMAL_MAP_FIRST_ITEM');
if (!normalFirst?.mid) throw new Error(`could not resolve a live first-page MID for ${normalKeyword}`);

const normalResult = await new NaverMapCollector({ timeoutMs: 30000, metricEnrichmentTimeoutMs: 20000 }).collect({
  keyword: normalKeyword,
  targetMid: normalFirst.mid,
  maxRank: 300,
});

console.log('NORMAL_COLLECTOR_RESULT', JSON.stringify(normalResult, null, 2));
if (normalResult.status !== 'FOUND') {
  throw new Error(`expected FOUND for normal map regression ${normalKeyword}, got ${normalResult.status}: ${normalResult.errorMessage || ''}`);
}
if (!(normalResult.rank >= 1 && normalResult.rank <= 20)) {
  throw new Error(`expected current first-page place to remain within top 20 for ${normalKeyword}, got rank ${normalResult.rank}`);
}
