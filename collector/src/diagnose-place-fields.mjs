import { chromium } from 'playwright';

const targetMid = String(process.argv[3] || '1328453904');
const interestingKey = /review|save|bookmark|receipt|visitor|blog|count/i;

function walkMatches(node, path = '', depth = 0, out = []) {
  if (depth > 8 || node === null || node === undefined) return out;
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
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const evidence = [];

page.on('response', async (response) => {
  const url = response.url();
  if (!url.includes('naver.com')) return;
  const contentType = String(response.headers()['content-type'] || '');
  if (!contentType.includes('json') && !url.includes('graphql')) return;
  try {
    const payload = await response.json();
    const matches = walkMatches(payload);
    if (matches.length) {
      evidence.push({
        url: url.split('?')[0],
        status: response.status(),
        matches: matches.slice(0, 120),
      });
    }
  } catch (error) {
    if (url.includes('graphql')) {
      console.log('GRAPHQL_META=' + JSON.stringify({
        url: url.split('?')[0],
        status: response.status(),
        contentType,
        parseError: String(error?.message ?? error),
      }));
    }
  }
});

const detailUrl = `https://map.naver.com/p/entry/place/${targetMid}`;
await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(7000);

const frames = page.frames();
console.log('FRAME_URLS=' + JSON.stringify(frames.map(frame => frame.url())));
for (const frame of frames) {
  const text = await frame.locator('body').innerText().catch(() => '');
  const lines = text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(line => /방문자\s*리뷰|블로그\s*리뷰|저장|리뷰\s*\d|\d+[,.]?\d*\s*저장/i.test(line))
    .slice(0, 50);
  if (lines.length) {
    console.log('FRAME_VISIBLE=' + JSON.stringify({ url: frame.url(), lines }));
  }
}

for (const item of evidence) {
  console.log('DETAIL_JSON=' + JSON.stringify(item));
}

await context.close();
await browser.close();
