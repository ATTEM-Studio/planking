import { chromium } from 'playwright';
import { extractFirstPageItems, extractGraphqlItems } from '../src/normalize.mjs';

const keywords = (process.env.KEYWORDS || '하단역카페,황성동맛집').split(',').map((v) => v.trim()).filter(Boolean);
const MAP_MARKER = '/p/api/search/allSearch';
const SEARCH_MARKER = 'p-api.place.naver.com/graphql';
const suspiciousKey = /(ad|advert|promotion|promo|sponsor|paid|place.?plus|badge|label|powerlink|premium)/i;
const suspiciousValue = /(광고|플레이스\s*플러스|sponsor|promotion|advert|place\s*plus)/i;

function midOf(item) {
  return String(item?.mid ?? item?.id ?? item?.placeId ?? item?.place_id ?? '');
}

function nameOf(item) {
  return String(item?.name ?? item?.placeName ?? item?.place_name ?? '');
}

function scanSignals(value, path = '', depth = 0, out = []) {
  if (depth > 5 || out.length >= 80 || value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((child, index) => scanSignals(child, `${path}[${index}]`, depth + 1, out));
    return out;
  }
  if (typeof value !== 'object') {
    const text = String(value);
    if (suspiciousValue.test(text)) out.push({ path, value: text.slice(0, 300) });
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (suspiciousKey.test(key) && (typeof child !== 'object' || child === null)) {
      out.push({ path: childPath, value: String(child).slice(0, 300) });
    }
    scanSignals(child, childPath, depth + 1, out);
    if (out.length >= 80) break;
  }
  return out;
}

function compactItem(item) {
  const primitiveTopLevel = {};
  for (const [key, value] of Object.entries(item ?? {})) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      primitiveTopLevel[key] = typeof value === 'string' ? value.slice(0, 220) : value;
    }
  }
  return {
    mid: midOf(item),
    name: nameOf(item),
    topLevelKeys: Object.keys(item ?? {}).sort(),
    primitiveTopLevel,
    suspiciousSignals: scanSignals(item),
  };
}

function getRestaurantOp(request) {
  try {
    if (!request.url().includes(SEARCH_MARKER)) return null;
    const body = JSON.parse(request.postData() || 'null');
    const operations = Array.isArray(body) ? body : [body];
    return operations.find((op) => op?.operationName === 'getRestaurants') ?? null;
  } catch {
    return null;
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
try {
  for (const keyword of keywords) {
    const page = await context.newPage();
    let mapItems = [];
    const gqlItems = [];
    page.on('response', async (response) => {
      try {
        const url = response.url();
        if (url.includes(MAP_MARKER)) {
          mapItems = extractFirstPageItems(await response.json());
          return;
        }
        if (!getRestaurantOp(response.request())) return;
        gqlItems.push(...extractGraphqlItems(await response.json()));
      } catch {}
    });

    await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(keyword)}`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(2500);
    console.log('AD_MAP_RAW', JSON.stringify({
      keyword,
      items: mapItems.slice(0, 5).map(compactItem),
    }));
    await page.close();

    const search = await context.newPage();
    const searchGqlItems = [];
    search.on('response', async (response) => {
      try {
        if (!getRestaurantOp(response.request())) return;
        searchGqlItems.push(...extractGraphqlItems(await response.json()));
      } catch {}
    });
    await search.goto(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(keyword)}`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await search.waitForTimeout(3000);
    const domPlaces = await search.locator('a[href*="map.naver.com/p/search/"][href*="/place/"]').evaluateAll((nodes) => {
      const out = [];
      const seen = new Set();
      for (const a of nodes) {
        const match = a.href.match(/\/place\/(\d+)/);
        if (!match || seen.has(match[1])) continue;
        seen.add(match[1]);
        const container = a.closest('li') || a.closest('.place_section_content') || a.parentElement;
        out.push({ mid: match[1], text: (container?.textContent || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500) });
      }
      return out.slice(0, 12);
    }).catch(() => []);
    console.log('AD_SEARCH_RAW', JSON.stringify({
      keyword,
      domPlaces,
      gqlItems: searchGqlItems.slice(0, 5).map(compactItem),
    }));
    await search.close();
  }
} finally {
  await context.close();
  await browser.close();
}
