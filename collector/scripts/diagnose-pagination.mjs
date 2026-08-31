import { chromium } from 'playwright';
import { extractGraphqlItems, normalizeOrganicItems } from '../src/normalize.mjs';

const targetMid = process.env.TARGET_MID || '1328453904';
const queries = ['하단카페', '하단역카페'];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
let template = null;

page.on('request', (request) => {
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
  const response = await page.evaluate(async ({ endpoint, body }) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  }, { endpoint: template.endpoint, body });
  const items = normalizeOrganicItems(extractGraphqlItems(response.json));
  return { status: response.status, items };
}

try {
  await page.goto('https://search.naver.com/search.naver?where=nexearch&query=%ED%95%98%EB%8B%A8%EC%B9%B4%ED%8E%98', {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  const started = Date.now();
  while (!template && Date.now() - started < 15000) await page.waitForTimeout(50);
  if (!template) throw new Error('getRestaurants template was not captured');

  for (const query of queries) {
    let foundRank = null;
    const pageSummaries = [];
    for (const start of [1, 51, 101, 151, 201, 251]) {
      const result = await replay(query, start);
      const index = result.items.findIndex((item) => item.mid === targetMid);
      pageSummaries.push({ start, count: result.items.length, first: result.items[0]?.mid || null, targetIndex: index });
      if (index >= 0) {
        foundRank = start + index;
        break;
      }
      if (result.items.length === 0) break;
    }
    console.log('GRAPHQL_RANK', JSON.stringify({ query, targetMid, foundRank, pageSummaries }, null, 2));
  }
} finally {
  await context.close();
  await browser.close();
}
