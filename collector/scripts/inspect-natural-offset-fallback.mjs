import { chromium } from 'playwright';
import { extractFirstPageItems, extractGraphqlItems, normalizeOrganicItems } from '../src/normalize.mjs';

const cases = [
  { keyword: '하단역카페', targetMid: '1328453904', seed: '하단카페' },
  { keyword: '황성동맛집', targetMid: '2076542131', seed: '황성동맛집' },
];

const MAP_MARKER = '/p/api/search/allSearch';
const SEARCH_MARKER = 'p-api.place.naver.com/graphql';

function getRestaurantOp(request) {
  try {
    if (!request.url().includes(SEARCH_MARKER)) return null;
    const body = JSON.parse(request.postData() || 'null');
    const operations = Array.isArray(body) ? body : [body];
    const op = operations.find((item) => item?.operationName === 'getRestaurants' && item?.variables?.input);
    if (!op) return null;
    return { endpoint: request.url(), body, input: op.variables.input };
  } catch {
    return null;
  }
}

function rewriteQuery(template, keyword) {
  const body = JSON.parse(JSON.stringify(template.body));
  const operations = Array.isArray(body) ? body : [body];
  for (const op of operations) {
    if (op?.operationName !== 'getRestaurants' || !op?.variables?.input) continue;
    op.variables.input.query = keyword;
    delete op.variables.input.nlu;
  }
  return { endpoint: template.endpoint, body };
}

async function collectMap(context, keyword) {
  const page = await context.newPage();
  let resolveItems;
  const itemsPromise = new Promise((resolve) => { resolveItems = resolve; });
  page.on('response', async (response) => {
    try {
      if (!response.url().includes(MAP_MARKER)) return;
      resolveItems(extractFirstPageItems(await response.json()));
    } catch {}
  });
  await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(keyword)}`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  const items = await Promise.race([
    itemsPromise,
    page.waitForTimeout(7000).then(() => []),
  ]);
  await page.close();
  return normalizeOrganicItems(items);
}

async function captureSeedTemplate(context, seed) {
  const page = await context.newPage();
  let template = null;
  page.on('request', (request) => {
    const candidate = getRestaurantOp(request);
    if (candidate && !template) template = candidate;
  });
  await page.goto(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(seed)}`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  for (let i = 0; i < 80 && !template; i += 1) await page.waitForTimeout(100);
  return { page, template };
}

function analyze(mapItems, returnedItems, start, targetMid) {
  const organic = normalizeOrganicItems(returnedItems);
  const overlaps = [];
  let mismatch = null;
  for (let i = 0; i < organic.length; i += 1) {
    const absoluteRank = start + i;
    if (absoluteRank > mapItems.length) break;
    const mapMid = mapItems[absoluteRank - 1]?.mid ?? null;
    const searchMid = organic[i]?.mid ?? null;
    overlaps.push({ absoluteRank, mapMid, searchMid, match: mapMid === searchMid });
    if (!mismatch && mapMid !== searchMid) mismatch = { absoluteRank, mapMid, searchMid };
  }
  const targetIndex = organic.findIndex((item) => item.mid === String(targetMid));
  return {
    organicCount: organic.length,
    returnedMids: organic.slice(0, 60).map((item) => item.mid),
    overlaps,
    overlapAligned: overlaps.length > 0 && !mismatch,
    mismatch,
    targetRank: targetIndex >= 0 ? start + targetIndex : null,
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
try {
  for (const testCase of cases) {
    const mapItems = await collectMap(context, testCase.keyword);
    const { page, template } = await captureSeedTemplate(context, testCase.seed);
    let replay = null;
    if (template) {
      const rewritten = rewriteQuery(template, testCase.keyword);
      replay = await page.evaluate(async ({ endpoint, body }) => {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        return { status: response.status, json: await response.json() };
      }, rewritten);
    }
    const start = Number(template?.input?.start ?? 0);
    const display = Number(template?.input?.display ?? 0);
    console.log('NATURAL_OFFSET_FALLBACK', JSON.stringify({
      ...testCase,
      mapFirstMids: mapItems.slice(0, 20).map((item) => item.mid),
      templateInput: template ? { start, display, query: template.input.query, hasNlu: Boolean(template.input.nlu) } : null,
      replayStatus: replay?.status ?? null,
      analysis: replay && start > 0 ? analyze(mapItems, extractGraphqlItems(replay.json), start, testCase.targetMid) : null,
    }));
    await page.close();
  }
} finally {
  await context.close();
  await browser.close();
}
