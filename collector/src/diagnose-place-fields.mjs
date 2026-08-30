import { chromium } from 'playwright';

const keyword = process.argv[2] || '하단맛집';
const graphMarker = 'pcmap-api.place.naver.com/graphql';

function collectPlaceItems(node, out = [], depth = 0) {
  if (depth > 9 || !node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const value of node) collectPlaceItems(value, out, depth + 1);
    return out;
  }
  const id = node.id ?? node.mid ?? node.placeId ?? node.place_id;
  if (id !== undefined && id !== null && (node.name || node.placeName)) out.push(node);
  for (const value of Object.values(node)) collectPlaceItems(value, out, depth + 1);
  return out;
}

function compact(item) {
  return {
    id: item.id ?? item.mid ?? item.placeId ?? item.place_id ?? null,
    name: item.name ?? item.placeName ?? null,
    reviewCount: item.reviewCount ?? null,
    placeReviewCount: item.placeReviewCount ?? null,
    visitorReviewCount: item.visitorReviewCount ?? null,
    blogCafeReviewCount: item.blogCafeReviewCount ?? null,
    totalReviewCount: item.totalReviewCount ?? null,
    saveCount: item.saveCount ?? null,
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
let graphqlResponses = 0;

page.on('response', async (response) => {
  if (!response.url().includes(graphMarker) || response.status() !== 200) return;
  try {
    const payload = await response.json();
    graphqlResponses += 1;
    const items = collectPlaceItems(payload).slice(0, 8).map(compact);
    console.log('GRAPHQL_SAMPLE=' + JSON.stringify(items));
    console.log('GRAPHQL_HAS_SAVE=' + items.some(item => item.saveCount !== null));
  } catch {
    // Ignore non-JSON responses.
  }
});

await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(keyword)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(5500);
const frame = page.frameLocator('#searchIframe');
const page2 = frame.getByRole('link', { name: '2', exact: true });
const page2Count = await page2.count();
console.log('PAGE2_COUNT=' + page2Count);
if (page2Count) {
  await page2.click({ timeout: 10000 });
  await page.waitForTimeout(4000);
  const page1 = frame.getByRole('link', { name: '1', exact: true });
  const page1Count = await page1.count();
  console.log('PAGE1_COUNT=' + page1Count);
  if (page1Count) {
    await page1.click({ timeout: 10000 });
    await page.waitForTimeout(4000);
  }
}
console.log('GRAPHQL_RESPONSES=' + graphqlResponses);
await context.close();
await browser.close();
