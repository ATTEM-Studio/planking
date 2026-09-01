import { chromium } from 'playwright';
import { extractGraphqlItems, normalizeOrganicItems } from '../src/normalize.mjs';

const keyword = process.env.KEYWORD || '사하구카페';
const targetMid = process.env.TARGET_MID || '1328453904';
const marker = 'p-api.place.naver.com/graphql';
const overlap = 8;

function getOperation(body) {
  const operations = Array.isArray(body) ? body : [body];
  return operations.find((operation) => operation?.operationName === 'getRestaurants' && operation?.variables?.input) || null;
}

function parseTemplate(request) {
  try {
    if (!request.url().includes(marker)) return null;
    const body = JSON.parse(request.postData() || 'null');
    const operation = getOperation(body);
    if (!operation) return null;
    return { endpoint: request.url(), body };
  } catch {
    return null;
  }
}

async function replay(page, template, start, display) {
  const body = JSON.parse(JSON.stringify(template.body));
  const operation = getOperation(body);
  operation.variables.input.query = keyword;
  operation.variables.input.start = start;
  operation.variables.input.display = display;
  delete operation.variables.input.nlu;
  return page.evaluate(async ({ endpoint, body }) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { status: response.status, textLength: text.length, json };
  }, { endpoint: template.endpoint, body });
}

function totalFromPayload(payload) {
  const operations = Array.isArray(payload) ? payload : [payload];
  for (const entry of operations) {
    const total = Number(entry?.data?.restaurants?.businesses?.total);
    if (Number.isFinite(total)) return total;
  }
  return null;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
let template = null;
page.on('request', (request) => {
  const candidate = parseTemplate(request);
  if (candidate && !template) template = candidate;
});

await page.goto(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(keyword)}`, {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
});
for (let i = 0; i < 200 && !template; i += 1) await page.waitForTimeout(25);
if (!template) throw new Error('getRestaurants template not observed');

const naturalInput = getOperation(template.body).variables.input;
const naturalStart = Number(naturalInput.start);
const display = Number(naturalInput.display);
console.log('NATURAL_WINDOW', JSON.stringify({ start: naturalStart, display }, null, 2));
if (!Number.isInteger(naturalStart) || !Number.isInteger(display)) throw new Error('invalid natural window');

let previous = null;
let start = naturalStart;
let foundRank = null;
const maxRank = 300;

while (start <= maxRank) {
  const response = await replay(page, template, start, display);
  const rawItems = response.json ? extractGraphqlItems(response.json) : [];
  const items = normalizeOrganicItems(rawItems);
  const total = totalFromPayload(response.json);
  const targetIndex = items.findIndex((item) => item.mid === targetMid);
  let overlapMatches = null;
  if (previous) {
    const expected = previous.items.slice(-overlap).map((item) => item.mid);
    const actual = items.slice(0, overlap).map((item) => item.mid);
    overlapMatches = expected.length === overlap && actual.length === overlap && expected.every((mid, index) => mid === actual[index]);
  }
  console.log('CHAIN_WINDOW', JSON.stringify({
    start,
    display,
    httpStatus: response.status,
    responseLength: response.textLength,
    total,
    itemCount: items.length,
    targetIndex,
    targetRank: targetIndex >= 0 ? start + targetIndex : null,
    overlapMatches,
    first3: items.slice(0, 3).map((item) => ({ mid: item.mid, name: item.name })),
    last3: items.slice(-3).map((item) => ({ mid: item.mid, name: item.name })),
  }, null, 2));

  if (response.status !== 200 || !items.length) break;
  if (previous && overlapMatches !== true) {
    console.log('CHAIN_STOP', 'overlap mismatch');
    break;
  }
  if (targetIndex >= 0) {
    foundRank = start + targetIndex;
    break;
  }
  if (items.length < display) break;

  previous = { start, items };
  start += display - overlap;
}

console.log('CHAIN_RESULT', JSON.stringify({ keyword, targetMid, foundRank }, null, 2));
await context.close();
await browser.close();
