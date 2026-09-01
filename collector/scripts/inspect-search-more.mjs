import { chromium } from 'playwright';
import { extractGraphqlItems, normalizeOrganicItems } from '../src/normalize.mjs';

const keywords = (process.env.KEYWORDS || '황성동맛집,하단역카페').split(',').map((v) => v.trim()).filter(Boolean);

function getRestaurantsOperation(request) {
  try {
    if (!request.url().includes('p-api.place.naver.com/graphql')) return null;
    const body = JSON.parse(request.postData() || 'null');
    const operations = Array.isArray(body) ? body : [body];
    return operations.find((op) => op?.operationName === 'getRestaurants') ?? null;
  } catch {
    return null;
  }
}

function compactInput(input) {
  return {
    query: input?.query ?? null,
    start: input?.start ?? null,
    display: input?.display ?? null,
    nlu: input?.nlu ?? null,
  };
}

function isPlaceModuleMoreHref(href) {
  try {
    const url = new URL(href);
    return url.hostname === 'search.naver.com'
      && url.pathname === '/search.naver'
      && url.searchParams.get('where') === 'nexearch'
      && url.hash === '#';
  } catch {
    return false;
  }
}

async function runClick(context, keyword, candidateIndex) {
  const page = await context.newPage();
  const requests = [];
  const responses = [];

  page.on('request', (request) => {
    const op = getRestaurantsOperation(request);
    if (!op) return;
    requests.push(compactInput(op?.variables?.input));
  });

  page.on('response', async (response) => {
    try {
      const op = getRestaurantsOperation(response.request());
      if (!op) return;
      const payload = await response.json();
      const organic = normalizeOrganicItems(extractGraphqlItems(payload));
      responses.push({
        status: response.status(),
        mids: organic.map((item) => item.mid).slice(0, 100),
      });
    } catch {}
  });

  await page.goto(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(keyword)}`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForTimeout(2500);

  const allMore = page.locator('a').filter({ hasText: /^\s*더보기\s*$/ });
  const count = await allMore.count().catch(() => 0);
  const all = [];
  const placeCandidateIndexes = [];
  for (let i = 0; i < count; i += 1) {
    const node = allMore.nth(i);
    const href = await node.getAttribute('href').catch(() => null);
    const info = {
      index: i,
      href,
      className: await node.getAttribute('class').catch(() => null),
      outerHTML: await node.evaluate((el) => el.outerHTML.slice(0, 800)).catch(() => null),
      parentText: await node.evaluate((el) => (el.parentElement?.parentElement?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500)).catch(() => null),
    };
    all.push(info);
    if (href && isPlaceModuleMoreHref(href)) placeCandidateIndexes.push(i);
  }

  const beforeRequests = requests.length;
  const beforeResponses = responses.length;
  let clickResult = 'not-clicked';
  const targetIndex = placeCandidateIndexes[candidateIndex];
  if (targetIndex !== undefined) {
    try {
      const target = allMore.nth(targetIndex);
      await target.scrollIntoViewIfNeeded();
      await target.click({ timeout: 5000 });
      clickResult = 'clicked';
      await page.waitForTimeout(3500);
    } catch (error) {
      clickResult = `error:${String(error?.message ?? error).slice(0, 220)}`;
    }
  }

  const placeLinks = await page.locator('a[href*="map.naver.com/p/search/"][href*="/place/"]').evaluateAll((nodes) => {
    const mids = [];
    const seen = new Set();
    for (const a of nodes) {
      const match = a.href.match(/\/place\/(\d+)/);
      if (!match || seen.has(match[1])) continue;
      seen.add(match[1]);
      mids.push(match[1]);
    }
    return mids.slice(0, 120);
  }).catch(() => []);

  console.log('PLACE_MORE_CLICK_SUMMARY', JSON.stringify({
    keyword,
    candidateIndex,
    allMoreLinks: all,
    placeCandidateIndexes,
    targetIndex: targetIndex ?? null,
    clickResult,
    finalUrl: page.url(),
    newRequests: requests.slice(beforeRequests),
    newResponses: responses.slice(beforeResponses),
    allRequests: requests,
    allResponses: responses,
    domPlaceMids: placeLinks,
  }));

  await page.close();
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
try {
  for (const keyword of keywords) {
    for (let index = 0; index < 3; index += 1) {
      await runClick(context, keyword, index);
    }
  }
} finally {
  await context.close();
  await browser.close();
}
