import { chromium } from 'playwright';
import { extractFirstPageItems, extractGraphqlItems, normalizeOrganicItems } from '../src/normalize.mjs';

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

function restaurantOperations(request) {
  try {
    if (!request.url().includes('p-api.place.naver.com/graphql')) return [];
    const body = JSON.parse(request.postData() || 'null');
    const ops = Array.isArray(body) ? body : [body];
    return ops.filter((op) => op?.operationName === 'getRestaurants');
  } catch {
    return [];
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
let firstPayload = null;
const graphqlRequests = [];
const graphqlResponses = [];

page.on('response', async (response) => {
  try {
    const url = response.url();
    if (url.includes('/p/api/search/allSearch') && !firstPayload) firstPayload = await response.json();
  } catch {}
});

context.on('request', (request) => {
  for (const op of restaurantOperations(request)) {
    graphqlRequests.push({
      url: request.url(),
      input: op?.variables?.input ?? null,
    });
  }
});

context.on('response', async (response) => {
  try {
    if (!response.url().includes('p-api.place.naver.com/graphql')) return;
    const request = response.request();
    if (!restaurantOperations(request).length) return;
    const payload = await response.json();
    graphqlResponses.push({
      status: response.status(),
      mids: normalizeOrganicItems(extractGraphqlItems(payload)).map((item) => item.mid).slice(0, 80),
    });
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
  const firstRaw = organic[0]?.raw ?? {};
  console.log('MAP_ALLSEARCH_META', JSON.stringify({
    keyword,
    resultKeys: Object.keys(firstPayload?.result ?? {}),
    placeKeys: Object.keys(place ?? {}),
    placeMeta: primitiveMetadata(place, { omit: ['list'] }),
    rawCount: rawItems.length,
    organicCount: organic.length,
    excludedCount: Math.max(0, rawItems.length - organic.length),
    firstOrganic: {
      mid: organic[0]?.mid ?? null,
      name: organic[0]?.name ?? null,
      address: firstRaw.address ?? null,
      roadAddress: firstRaw.roadAddress ?? null,
      commonAddress: firstRaw.commonAddress ?? null,
      category: firstRaw.category ?? null,
    },
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
  await searchPage.goto(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(keyword)}`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await searchPage.waitForTimeout(3000);

  console.log('SEARCH_INITIAL_GRAPHQL', JSON.stringify({
    requests: graphqlRequests.slice(0, 10),
    responses: graphqlResponses.slice(0, 10),
  }, null, 2));

  const moduleMore = searchPage.getByRole('link', { name: `${keyword} 더보기`, exact: true });
  const moduleMoreCount = await moduleMore.count().catch(() => 0);
  const moduleMoreHref = moduleMoreCount ? await moduleMore.first().getAttribute('href').catch(() => null) : null;
  console.log('SEARCH_PLACE_MORE', JSON.stringify({ count: moduleMoreCount, href: moduleMoreHref }, null, 2));

  if (moduleMoreCount) {
    const beforeRequests = graphqlRequests.length;
    const beforeResponses = graphqlResponses.length;
    const popupPromise = context.waitForEvent('page', { timeout: 3000 }).catch(() => null);
    await moduleMore.first().click({ noWaitAfter: true, timeout: 5000 }).catch((error) => {
      console.log('SEARCH_PLACE_MORE_CLICK_ERROR', String(error?.message ?? error));
    });
    const popup = await popupPromise;
    const activePage = popup ?? searchPage;
    await activePage.waitForTimeout(3000).catch(() => {});
    console.log('SEARCH_AFTER_PLACE_MORE', JSON.stringify({
      url: activePage.url(),
      newRequests: graphqlRequests.slice(beforeRequests),
      newResponses: graphqlResponses.slice(beforeResponses),
    }, null, 2));
    if (popup) await popup.close().catch(() => {});
  }

  await searchPage.close();
} finally {
  await context.close();
  await browser.close();
}
