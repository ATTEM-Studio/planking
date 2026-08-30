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

function compact(item) {
  if (!item) return null;
  return {
    id: item.id ?? item.mid ?? null,
    name: item.name ?? null,
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
const graphqlPayloads = [];

page.on('response', async (response) => {
  if (!response.url().includes(graphMarker) || response.status() !== 200) return;
  try {
    const payload = await response.json();
    graphqlPayloads.push(payload);
    const target = findTarget(payload);
    if (target) {
      console.log('TARGET_GRAPHQL=' + JSON.stringify(compact(target)));
      console.log('TARGET_KEYS=' + JSON.stringify(Object.keys(target).sort()));
    }
  } catch {
    // Only successful JSON GraphQL responses are relevant here.
  }
});

await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(keyword)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(5000);
const frame = page.frameLocator('#searchIframe');

const page2 = frame.getByRole('link', { name: '2', exact: true });
console.log('PAGE2_COUNT=' + await page2.count());
if (await page2.count()) {
  await page2.click({ timeout: 10000 });
  await page.waitForTimeout(3500);
  const page1 = frame.getByRole('link', { name: '1', exact: true });
  console.log('PAGE1_COUNT=' + await page1.count());
  if (await page1.count()) {
    await page1.click({ timeout: 10000 });
    await page.waitForTimeout(4000);
  }
}

console.log('GRAPHQL_PAYLOAD_COUNT=' + graphqlPayloads.length);
console.log('TARGET_GRAPHQL_FOUND=' + graphqlPayloads.some(payload => Boolean(findTarget(payload))));
await context.close();
await browser.close();
