import { chromium } from 'playwright';
import { extractFirstPageItems, normalizeOrganicItems } from '../src/normalize.mjs';

const keyword = process.env.KEYWORD || '황성동맛집';

function primitiveMetadata(object, { omit = [] } = {}) {
  if (!object || typeof object !== 'object') return {};
  const skipped = new Set(omit);
  const output = {};
  for (const [key, value] of Object.entries(object)) {
    if (skipped.has(key)) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) output[key] = value;
    else if (Array.isArray(value)) output[key] = `[array:${value.length}]`;
    else if (typeof value === 'object') output[key] = `{keys:${Object.keys(value).join(',')}}`;
  }
  return output;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
let firstPayload = null;
const graphqlRequests = [];

page.on('response', async (response) => {
  try {
    const url = response.url();
    if (url.includes('/p/api/search/allSearch') && !firstPayload) firstPayload = await response.json();
  } catch {}
});

try {
  await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(keyword)}`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  const started = Date.now();
  while (!firstPayload && Date.now() - started < 15000) await page.waitForTimeout(50);

  const place = firstPayload?.result?.place ?? null;
  const rawItems = extractFirstPageItems(firstPayload);
  const organic = normalizeOrganicItems(rawItems);
  console.log('MAP_ALLSEARCH_META', JSON.stringify({
    keyword,
    resultKeys: Object.keys(firstPayload?.result ?? {}),
    placeKeys: Object.keys(place ?? {}),
    placeMeta: primitiveMetadata(place, { omit: ['list'] }),
    rawCount: rawItems.length,
    organicCount: organic.length,
    excludedCount: Math.max(0, rawItems.length - organic.length),
    firstOrganicMids: organic.slice(0, 25).map((item) => item.mid),
  }, null, 2));

  const iframe = page.frameLocator('#searchIframe');
  const links = await iframe.locator('a').allTextContents().catch(() => []);
  const buttons = await iframe.locator('button').allTextContents().catch(() => []);
  console.log('MAP_UI_CONTROLS', JSON.stringify({
    links: links.map((v) => v.trim()).filter(Boolean).slice(-80),
    buttons: buttons.map((v) => v.trim()).filter(Boolean).slice(-80),
  }, null, 2));

  const searchPage = await context.newPage();
  searchPage.on('request', (request) => {
    try {
      if (!request.url().includes('p-api.place.naver.com/graphql')) return;
      const body = JSON.parse(request.postData() || 'null');
      const ops = Array.isArray(body) ? body : [body];
      for (const op of ops) {
        if (op?.operationName !== 'getRestaurants') continue;
        graphqlRequests.push({
          operationName: op.operationName,
          input: op?.variables?.input ?? null,
        });
      }
    } catch {}
  });

  await searchPage.goto(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(keyword)}`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await searchPage.waitForTimeout(3000);
  console.log('SEARCH_GRAPHQL_REQUESTS', JSON.stringify(graphqlRequests.slice(0, 10), null, 2));

  const searchLinks = await searchPage.locator('a').allTextContents().catch(() => []);
  const searchButtons = await searchPage.locator('button').allTextContents().catch(() => []);
  console.log('SEARCH_UI_CONTROLS', JSON.stringify({
    links: searchLinks.map((v) => v.trim()).filter(Boolean).filter((v) => /더보기|다음|^[0-9]+$/.test(v)).slice(0, 100),
    buttons: searchButtons.map((v) => v.trim()).filter(Boolean).filter((v) => /더보기|다음|^[0-9]+$/.test(v)).slice(0, 100),
  }, null, 2));

  await searchPage.close();
} finally {
  await context.close();
  await browser.close();
}
