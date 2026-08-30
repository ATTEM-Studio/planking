import { chromium } from 'playwright';

const keyword = process.argv[2] || '하단카페';
const targetMid = String(process.argv[3] || '1328453904');
const firstMarker = '/p/api/search/allSearch';
const interestingKey = /review|save|bookmark|receipt|visitor|blog|count/i;

function walkMatches(node, path = '', depth = 0, out = []) {
  if (depth > 7 || node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    node.forEach((value, index) => walkMatches(value, `${path}[${index}]`, depth + 1, out));
    return out;
  }
  if (typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    const next = path ? `${path}.${key}` : key;
    if (interestingKey.test(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value))) {
      out.push([next, value]);
    }
    walkMatches(value, next, depth + 1, out);
  }
  return out;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
let found = false;
let matchedType = '';
const detailEvidence = new Map();

page.on('response', async (response) => {
  const url = response.url();
  const contentType = String(response.headers()['content-type'] || '');
  if (!contentType.includes('json') && !url.includes(firstMarker) && !url.includes('graphql')) return;
  try {
    const payload = await response.json();
    if (url.includes(firstMarker)) {
      const list = payload?.result?.place?.list;
      if (Array.isArray(list)) {
        const item = list.find((row) => String(row?.mid ?? row?.id ?? row?.placeId ?? row?.place_id ?? '') === targetMid);
        if (item) {
          found = true;
          matchedType = String(item.type || '');
          console.log('MATCHED_SELECTED=' + JSON.stringify({
            id: item.id,
            type: item.type,
            category: item.category,
            reviewCount: item.reviewCount,
            placeReviewCount: item.placeReviewCount,
          }));
          console.log('MATCHED_REVIEW_SAVE_PATHS=' + JSON.stringify(walkMatches(item)));
        }
      }
    }

    const matches = walkMatches(payload).filter(([path]) => interestingKey.test(path));
    if (matches.length && (url.includes('place.naver.com') || url.includes('pcmap-api') || url.includes('map.naver.com'))) {
      const filtered = matches.slice(0, 80);
      detailEvidence.set(url.split('?')[0], filtered);
    }
  } catch {
    // Ignore non-JSON/stream responses in this temporary diagnostic.
  }
});

await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(keyword)}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(3500);
console.log('MATCHED=' + String(found));

const detailUrl = `https://map.naver.com/p/entry/place/${targetMid}`;
await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(5000);

const bodyText = await page.locator('body').innerText().catch(() => '');
const relevantLines = bodyText
  .split(/\n+/)
  .map(line => line.trim())
  .filter(line => /방문자\s*리뷰|블로그\s*리뷰|저장/i.test(line))
  .slice(0, 30);
console.log('DETAIL_TYPE_HINT=' + JSON.stringify(matchedType));
console.log('DETAIL_VISIBLE_LINES=' + JSON.stringify(relevantLines));
for (const [url, matches] of detailEvidence.entries()) {
  console.log('DETAIL_JSON=' + JSON.stringify({ url, matches }));
}

await context.close();
await browser.close();
process.exit(found ? 0 : 2);
