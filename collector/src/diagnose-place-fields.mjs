import { chromium } from 'playwright';

const keyword = process.argv[2] || '하단카페';
const targetMid = String(process.argv[3] || '1328453904');
const firstMarker = '/p/api/search/allSearch';

function walkMatches(node, path = '', depth = 0, out = []) {
  if (depth > 5 || node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    node.forEach((value, index) => walkMatches(value, `${path}[${index}]`, depth + 1, out));
    return out;
  }
  if (typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    const next = path ? `${path}.${key}` : key;
    if (/review|save|bookmark|receipt|visitor|blog|count/i.test(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value))) {
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

page.on('response', async (response) => {
  if (found) return;
  const url = response.url();
  if (!url.includes(firstMarker)) return;
  try {
    const payload = await response.json();
    const list = payload?.result?.place?.list;
    if (!Array.isArray(list)) return;
    const item = list.find((row) => String(row?.mid ?? row?.id ?? row?.placeId ?? row?.place_id ?? '') === targetMid);
    if (!item) return;
    found = true;
    console.log('MATCHED_TOP_LEVEL_KEYS=' + JSON.stringify(Object.keys(item).sort()));
    console.log('MATCHED_REVIEW_SAVE_PATHS=' + JSON.stringify(walkMatches(item)));
  } catch (error) {
    console.error('DIAGNOSTIC_PARSE_ERROR=' + String(error?.message ?? error));
  }
});

await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(keyword)}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(4000);
console.log('MATCHED=' + String(found));
await context.close();
await browser.close();
process.exit(found ? 0 : 2);
