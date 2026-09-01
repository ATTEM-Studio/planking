import { serverlessBrowserFactory } from './rank_collect.mjs';
import {
  extractFirstPageItems,
  extractGraphqlItems,
  normalizeOrganicItems,
} from '../collector/src/normalize.mjs';

const KEYWORD = '하단카페맛집';
const TARGET_MID = '1328453904';
const SEARCH_GRAPHQL_MARKER = 'p-api.place.naver.com/graphql';
const MAP_MARKER = '/p/api/search/allSearch';

function restaurantsOperation(body) {
  const operations = Array.isArray(body) ? body : [body];
  return operations.find(
    (operation) => operation?.operationName === 'getRestaurants' && operation?.variables?.input,
  ) ?? null;
}

function parseTemplate(request) {
  try {
    const url = request.url();
    if (!url.includes(SEARCH_GRAPHQL_MARKER)) return null;
    const body = JSON.parse(request.postData() || 'null');
    if (!restaurantsOperation(body)) return null;
    return { endpoint: url, body };
  } catch {
    return null;
  }
}

function naturalWindow(template) {
  const input = restaurantsOperation(template?.body)?.variables?.input;
  const start = Number(input?.start);
  const display = Number(input?.display);
  if (!Number.isInteger(start) || start < 1 || !Number.isInteger(display) || display < 1) return null;
  return { start, display };
}

function alignedAtNaturalOffset(mapItems, searchItems, start) {
  const map = normalizeOrganicItems(mapItems);
  const search = normalizeOrganicItems(searchItems);
  if (!map.length || !search.length || !Number.isInteger(start) || start < 1 || start > map.length) return false;
  const overlap = Math.min(search.length, map.length - start + 1);
  if (overlap < Math.min(3, map.length)) return false;
  for (let index = 0; index < overlap; index += 1) {
    if (search[index]?.mid !== map[start - 1 + index]?.mid) return false;
  }
  return true;
}

function summarize(rawItems, mapItems, start, targetMid) {
  const organic = normalizeOrganicItems(rawItems);
  const index = organic.findIndex((item) => item.mid === targetMid);
  return {
    organicCount: organic.length,
    aligned: alignedAtNaturalOffset(mapItems, rawItems, start),
    targetRank: index >= 0 ? start + index : null,
    firstMids: organic.slice(0, 15).map((item) => item.mid),
  };
}

async function waitFor(read, page, timeoutMs = 12000) {
  const started = Date.now();
  while (!read() && Date.now() - started < timeoutMs) {
    await page.waitForTimeout(50);
  }
  return read();
}

async function replay(page, template, { preserveNlu }) {
  if (!template) return { status: null, rawItems: [] };
  const body = JSON.parse(JSON.stringify(template.body));
  const operation = restaurantsOperation(body);
  operation.variables.input.query = KEYWORD;
  if (!preserveNlu) delete operation.variables.input.nlu;
  return page.evaluate(async ({ endpoint, body: requestBody }) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    let json = null;
    try { json = await response.json(); } catch {}
    return { status: response.status, json };
  }, { endpoint: template.endpoint, body });
}

export default async function handler(_request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  let browser;
  let context;
  try {
    browser = await serverlessBrowserFactory();
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

    let mapItems = null;
    const mapPage = await context.newPage();
    mapPage.on('response', async (networkResponse) => {
      try {
        if (!networkResponse.url().includes(MAP_MARKER) || networkResponse.status() !== 200) return;
        mapItems = extractFirstPageItems(await networkResponse.json());
      } catch {}
    });
    await mapPage.goto(
      `https://map.naver.com/p/search/${encodeURIComponent(KEYWORD)}`,
      { waitUntil: 'domcontentloaded', timeout: 15000 },
    );
    await waitFor(() => mapItems, mapPage);

    let template = null;
    let uiRawItems = null;
    let uiStatus = null;
    const searchPage = await context.newPage();
    searchPage.on('request', (request) => {
      const candidate = parseTemplate(request);
      if (candidate) template = candidate;
    });
    searchPage.on('response', async (networkResponse) => {
      try {
        const request = networkResponse.request();
        if (!parseTemplate(request)) return;
        uiStatus = networkResponse.status();
        if (uiStatus === 200) uiRawItems = extractGraphqlItems(await networkResponse.json());
      } catch {}
    });
    await searchPage.goto(
      `https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(KEYWORD)}`,
      { waitUntil: 'domcontentloaded', timeout: 15000 },
    );
    await waitFor(() => template, searchPage);
    await waitFor(() => uiRawItems, searchPage, 5000);

    const natural = naturalWindow(template);
    const input = restaurantsOperation(template?.body)?.variables?.input ?? {};
    const currentReplay = await replay(searchPage, template, { preserveNlu: false });
    const preservedReplay = await replay(searchPage, template, { preserveNlu: true });
    const currentRaw = extractGraphqlItems(currentReplay.json);
    const preservedRaw = extractGraphqlItems(preservedReplay.json);
    const mapOrganic = normalizeOrganicItems(mapItems ?? []);

    response.status(200).json({
      keyword: KEYWORD,
      targetMid: TARGET_MID,
      region: process.env.VERCEL_REGION ?? null,
      map: {
        organicCount: mapOrganic.length,
        mids: mapOrganic.slice(0, 20).map((item) => item.mid),
      },
      template: {
        found: Boolean(template),
        natural,
        inputKeys: Object.keys(input).sort(),
        nluPresent: Object.prototype.hasOwnProperty.call(input, 'nlu'),
      },
      ui: {
        status: uiStatus,
        ...(natural ? summarize(uiRawItems ?? [], mapItems ?? [], natural.start, TARGET_MID) : {}),
      },
      replayWithoutNlu: {
        status: currentReplay.status,
        ...(natural ? summarize(currentRaw, mapItems ?? [], natural.start, TARGET_MID) : {}),
      },
      replayWithNlu: {
        status: preservedReplay.status,
        ...(natural ? summarize(preservedRaw, mapItems ?? [], natural.start, TARGET_MID) : {}),
      },
    });
  } catch (error) {
    response.status(500).json({
      region: process.env.VERCEL_REGION ?? null,
      error: String(error?.name ?? 'Error'),
      message: String(error?.message ?? error),
    });
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}
