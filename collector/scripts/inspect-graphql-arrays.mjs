import { chromium } from 'playwright';

const keywords = (process.env.KEYWORDS || '황성동맛집,하단역카페').split(',').map((v) => v.trim()).filter(Boolean);
const SEARCH_MARKER = 'p-api.place.naver.com/graphql';

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

function itemMid(item) {
  const value = item?.mid ?? item?.id ?? item?.placeId ?? item?.place_id;
  return value === undefined || value === null ? null : String(value);
}

function itemName(item) {
  const value = item?.name ?? item?.placeName ?? item?.place_name;
  return value === undefined || value === null ? null : String(value);
}

function collectArrays(node, path = '$', depth = 0, out = []) {
  if (depth > 10 || out.length >= 120 || node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    const placeLike = node.filter((value) => value && typeof value === 'object' && itemMid(value));
    if (placeLike.length) {
      out.push({
        path,
        length: node.length,
        placeLikeCount: placeLike.length,
        mids: placeLike.slice(0, 50).map(itemMid),
        names: placeLike.slice(0, 12).map(itemName),
        firstKeys: Object.keys(placeLike[0] ?? {}).sort(),
      });
    }
    node.slice(0, 20).forEach((value, index) => collectArrays(value, `${path}[${index}]`, depth + 1, out));
    return out;
  }
  if (typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    collectArrays(value, `${path}.${key}`, depth + 1, out);
    if (out.length >= 120) break;
  }
  return out;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
try {
  for (const keyword of keywords) {
    const page = await context.newPage();
    let responseIndex = 0;
    page.on('response', async (response) => {
      try {
        const op = getRestaurantOp(response.request());
        if (!op) return;
        const payload = await response.json();
        const input = op?.variables?.input ?? {};
        console.log('GRAPHQL_ARRAYS', JSON.stringify({
          keyword,
          responseIndex: responseIndex++,
          input: {
            query: input.query ?? null,
            start: input.start ?? null,
            display: input.display ?? null,
          },
          topLevelType: Array.isArray(payload) ? 'array' : typeof payload,
          arrays: collectArrays(payload),
        }));
      } catch (error) {
        console.log('GRAPHQL_ARRAY_ERROR', JSON.stringify({ keyword, error: String(error?.message ?? error) }));
      }
    });

    await page.goto(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(keyword)}`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(4000);
    const domPlaces = await page.locator('a[href*="map.naver.com/p/search/"][href*="/place/"]').evaluateAll((nodes) => {
      const result = [];
      const seen = new Set();
      for (const a of nodes) {
        const match = a.href.match(/\/place\/(\d+)/);
        if (!match || seen.has(match[1])) continue;
        seen.add(match[1]);
        result.push({ mid: match[1], text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160) });
      }
      return result.slice(0, 30);
    }).catch(() => []);
    console.log('GRAPHQL_DOM_PLACES', JSON.stringify({ keyword, domPlaces }));
    await page.close();
  }
} finally {
  await context.close();
  await browser.close();
}
