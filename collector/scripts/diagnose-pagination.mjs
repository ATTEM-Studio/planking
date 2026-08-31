import { chromium } from 'playwright';
import { extractFirstPageItems, extractGraphqlItems, normalizeOrganicItems } from '../src/normalize.mjs';

const targetMid = process.env.TARGET_MID || '1328453904';
const queries = ['하단카페', '하단역카페'];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const searchPage = await context.newPage();
let template = null;

searchPage.on('request', (request) => {
  if (template) return;
  try {
    if (!request.url().includes('p-api.place.naver.com/graphql')) return;
    const body = JSON.parse(request.postData() || 'null');
    const ops = Array.isArray(body) ? body : [body];
    if (!ops.some((op) => op?.operationName === 'getRestaurants' && op?.variables?.input)) return;
    template = { endpoint: request.url(), body };
  } catch {}
});

function rewrite(body, query, start, display = 50) {
  const next = JSON.parse(JSON.stringify(body));
  const ops = Array.isArray(next) ? next : [next];
  for (const op of ops) {
    if (op?.operationName !== 'getRestaurants' || !op?.variables?.input) continue;
    op.variables.input.query = query;
    op.variables.input.start = start;
    op.variables.input.display = display;
    delete op.variables.input.nlu;
  }
  return next;
}

async function replay(query, start) {
  const body = rewrite(template.body, query, start, 50);
  const response = await searchPage.evaluate(async ({ endpoint, body }) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  }, { endpoint: template.endpoint, body });
  const rawItems = extractGraphqlItems(response.json);
  return { status: response.status, rawItems, items: normalizeOrganicItems(rawItems) };
}

async function mapFirstPage(query) {
  const page = await context.newPage();
  let captured = null;
  page.on('response', async (response) => {
    try {
      if (!response.url().includes('/p/api/search/allSearch')) return;
      captured = extractFirstPageItems(await response.json());
    } catch {}
  });
  try {
    await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    const started = Date.now();
    while (!captured && Date.now() - started < 15000) await page.waitForTimeout(50);
    return normalizeOrganicItems(captured || []);
  } finally {
    await page.close();
  }
}

function adLikeFields(raw) {
  return Object.fromEntries(Object.entries(raw || {}).filter(([key, value]) => {
    const lower = key.toLowerCase();
    return lower.includes('ad') || lower.includes('sponsor') || lower.includes('promotion') || lower.includes('type');
  }));
}

try {
  await searchPage.goto('https://search.naver.com/search.naver?where=nexearch&query=%ED%95%98%EB%8B%A8%EC%B9%B4%ED%8E%98', {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  const started = Date.now();
  while (!template && Date.now() - started < 15000) await searchPage.waitForTimeout(50);
  if (!template) throw new Error('getRestaurants template was not captured');

  for (const query of queries) {
    const mapItems = await mapFirstPage(query);
    const graph = await replay(query, 1);
    const targetIndex = graph.items.findIndex((item) => item.mid === targetMid);
    const mapIds = new Set(mapItems.map((item) => item.mid));
    const graphBeforeTarget = targetIndex >= 0 ? graph.items.slice(0, targetIndex) : graph.items.slice(0, 30);
    const extras = graphBeforeTarget.filter((item) => !mapIds.has(item.mid)).map((item) => ({
      mid: item.mid,
      name: item.name,
      position: graph.items.findIndex((row) => row.mid === item.mid) + 1,
      adLike: adLikeFields(item.raw),
      keys: Object.keys(item.raw || {}),
    }));
    console.log('ALIGNMENT', JSON.stringify({
      query,
      mapCount: mapItems.length,
      mapTargetRank: mapItems.findIndex((item) => item.mid === targetMid) + 1 || null,
      graphCount: graph.items.length,
      graphTargetRank: targetIndex >= 0 ? targetIndex + 1 : null,
      mapFirstIds: mapItems.map((item) => item.mid),
      graphFirstIds: graph.items.slice(0, Math.max(30, targetIndex + 1)).map((item) => item.mid),
      extrasBeforeTarget: extras,
    }, null, 2));
  }
} finally {
  await context.close();
  await browser.close();
}
