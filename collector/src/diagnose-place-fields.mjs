import { chromium } from 'playwright';

const keyword = process.argv[2] || '하단카페';
const targetMid = String(process.argv[3] || '1328453904');
const graphMarker = 'pcmap-api.place.naver.com/graphql';

function findTarget(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const value of node) {
      const found = findTarget(value);
      if (found) return found;
    }
    return null;
  }
  const id = node.id ?? node.mid ?? node.placeId ?? node.place_id;
  if (id !== undefined && id !== null && String(id) === targetMid) return node;
  for (const value of Object.values(node)) {
    const found = findTarget(value);
    if (found) return found;
  }
  return null;
}

function selectedFields(item) {
  if (!item) return null;
  return {
    id: item.id ?? item.mid ?? item.placeId ?? item.place_id ?? null,
    name: item.name ?? item.placeName ?? null,
    visitorReviewCount: item.visitorReviewCount ?? null,
    blogCafeReviewCount: item.blogCafeReviewCount ?? null,
    saveCount: item.saveCount ?? null,
    totalReviewCount: item.totalReviewCount ?? null,
    bookingReviewCount: item.bookingReviewCount ?? null,
    reviewCount: item.reviewCount ?? null,
    placeReviewCount: item.placeReviewCount ?? null,
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
let graphResponses = 0;
let target = null;

page.on('response', async (response) => {
  if (!response.url().includes(graphMarker)) return;
  graphResponses += 1;
  try {
    const payload = await response.json();
    const found = findTarget(payload);
    if (found && !target) {
      target = selectedFields(found);
      console.log('GRAPHQL_TARGET=' + JSON.stringify(target));
      console.log('GRAPHQL_TARGET_KEYS=' + JSON.stringify(Object.keys(found).sort()));
    }
  } catch (error) {
    console.log('GRAPHQL_PARSE_ERROR=' + JSON.stringify(String(error?.message ?? error)));
  }
});

const url = `https://pcmap.place.naver.com/place/list?query=${encodeURIComponent(keyword)}`;
console.log('LIST_URL=' + url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(6000);
console.log('GRAPHQL_RESPONSES=' + graphResponses);
console.log('TARGET_FOUND=' + Boolean(target));
console.log('FINAL_URL=' + page.url());

await context.close();
await browser.close();
process.exit(target ? 0 : 2);
