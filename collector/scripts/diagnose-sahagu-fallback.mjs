import { chromium } from 'playwright';
import { extractFirstPageItems, extractGraphqlItems, normalizeOrganicItems } from '../src/normalize.mjs';

const keyword = process.env.KEYWORD || '사하구카페';
const targetMid = process.env.TARGET_MID || '1328453904';
const SEARCH_MARKER = 'p-api.place.naver.com/graphql';

function getOperation(body) {
  const operations = Array.isArray(body) ? body : [body];
  return operations.find((operation) => operation?.operationName === 'getRestaurants' && operation?.variables?.input) || null;
}

function parseTemplate(request) {
  try {
    if (!request.url().includes(SEARCH_MARKER)) return null;
    const body = JSON.parse(request.postData() || 'null');
    const operation = getOperation(body);
    if (!operation) return null;
    return { endpoint: request.url(), body, input: operation.variables.input };
  } catch {
    return null;
  }
}

function rewrite(template, query) {
  const body = JSON.parse(JSON.stringify(template.body));
  const operation = getOperation(body);
  operation.variables.input.query = query;
  delete operation.variables.input.nlu;
  return { endpoint: template.endpoint, body };
}

async function replay(page, template, query) {
  const payload = rewrite(template, query);
  return page.evaluate(async ({ endpoint, body }) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { status: response.status, textLength: text.length, textHead: text.slice(0, 200), json };
  }, payload);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const mapPage = await context.newPage();
let mapItems = null;

mapPage.on('response', async (response) => {
  try {
    if (!response.url().includes('/p/api/search/allSearch')) return;
    const items = extractFirstPageItems(await response.json());
    if (items.length && !mapItems) mapItems = items;
  } catch {}
});

await mapPage.goto(`https://map.naver.com/p/search/${encodeURIComponent(keyword)}`, {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
});
for (let i = 0; i < 300 && !mapItems; i += 1) await mapPage.waitForTimeout(50);
const mapOrganic = normalizeOrganicItems(mapItems || []);
console.log('MAP_TOP20', JSON.stringify(mapOrganic.map((item, index) => ({ rank: index + 1, mid: item.mid, name: item.name })), null, 2));
const firstRaw = mapOrganic[0]?.raw || {};
console.log('MAP_FIRST_RAW', JSON.stringify({
  name: mapOrganic[0]?.name || null,
  address: firstRaw.address ?? null,
  roadAddress: firstRaw.roadAddress ?? null,
  commonAddress: firstRaw.commonAddress ?? null,
  shortAddress: firstRaw.shortAddress ?? null,
  abbrAddress: firstRaw.abbrAddress ?? null,
  category: firstRaw.category ?? null,
  businessCategory: firstRaw.businessCategory ?? null,
}, null, 2));

const seeds = [...new Set([
  keyword,
  '사하구 카페',
  '하단카페',
  '하단 카페',
  '사하구 하단동 카페',
  '사하구 하단 카페',
  mapOrganic[0]?.name,
].filter(Boolean))];

const searchPage = await context.newPage();
for (const seed of seeds) {
  const templates = [];
  const handler = (request) => {
    const template = parseTemplate(request);
    if (template) templates.push(template);
  };
  searchPage.on('request', handler);
  try {
    await searchPage.goto(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(seed)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await searchPage.waitForTimeout(3500);
    const unique = [];
    const seen = new Set();
    for (const template of templates) {
      const start = Number(template.input?.start);
      const display = Number(template.input?.display);
      const key = `${start}:${display}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(template);
    }
    console.log('SEED_WINDOWS', JSON.stringify({ seed, windows: unique.map((t) => ({ start: t.input?.start, display: t.input?.display, query: t.input?.query })) }, null, 2));
    for (const template of unique) {
      const start = Number(template.input?.start);
      const replayed = await replay(searchPage, template, keyword);
      const rawItems = replayed.json ? extractGraphqlItems(replayed.json) : [];
      const organic = normalizeOrganicItems(rawItems);
      const targetIndex = organic.findIndex((item) => item.mid === targetMid);
      const overlap = organic.slice(0, Math.max(0, Math.min(20 - start + 1, organic.length))).map((item) => item.mid);
      const mapOverlap = mapOrganic.slice(Math.max(0, start - 1), Math.max(0, start - 1) + overlap.length).map((item) => item.mid);
      console.log('REPLAY_WINDOW', JSON.stringify({
        seed,
        start,
        display: template.input?.display,
        httpStatus: replayed.status,
        responseLength: replayed.textLength,
        responseHead: replayed.textHead,
        itemCount: organic.length,
        targetIndex,
        computedRank: targetIndex >= 0 ? start + targetIndex : null,
        targetFound: targetIndex >= 0,
        aligned: overlap.length >= 3 && overlap.every((mid, index) => mid === mapOverlap[index]),
        firstItems: organic.slice(0, 8).map((item, index) => ({ rank: start + index, mid: item.mid, name: item.name })),
      }, null, 2));
    }
  } finally {
    searchPage.removeListener('request', handler);
  }
}

await context.close();
await browser.close();
