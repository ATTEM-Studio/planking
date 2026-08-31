import { chromium } from 'playwright';
import { extractFirstPageItems, normalizeOrganicItems } from '../src/normalize.mjs';
import { NaverMapCollector } from '../src/naver-map-collector.mjs';

const keyword = process.env.KEYWORD || '하단역카페';
const targetMid = process.env.TARGET_MID || '1328453904';

async function inspectNonEmptyMapFirstPage() {
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
    await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(keyword)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const started = Date.now();
    while (!captured && Date.now() - started < 15000) await page.waitForTimeout(50);

    const first = normalizeOrganicItems(captured || [])[0];
    const raw = first?.raw && typeof first.raw === 'object' ? first.raw : {};
    console.log('MAP_FIRST_ITEM', JSON.stringify({
      mid: first?.mid || null,
      name: first?.name || null,
      commonAddress: raw.commonAddress ?? null,
      address: raw.address ?? null,
      roadAddress: raw.roadAddress ?? null,
      category: raw.category ?? null,
      businessCategory: raw.businessCategory ?? null,
      categoryName: raw.categoryName ?? null,
      categoryNames: raw.categoryNames ?? null,
      keys: Object.keys(raw),
    }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

await inspectNonEmptyMapFirstPage();

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
