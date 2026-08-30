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
    if (interestingKey.test(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value))) out.push([next, value]);
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
    if (matches.length) evidence.push({ url: url.split('?')[0], status: response.status(), matches: matches.slice(0, 140) });
  } catch {
    // Ignore non-JSON responses in this temporary diagnostic.
  }
});

await page.goto(`https://map.naver.com/p/entry/place/${targetMid}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(6500);

const entryFrame = page.frames().find(frame => frame.url().includes(`/${targetMid}/`));
console.log('ENTRY_FRAME_URL=' + JSON.stringify(entryFrame?.url() || null));
if (!entryFrame) throw new Error('entry frame not found');

const links = await entryFrame.locator('a').evaluateAll((nodes) => nodes
  .map(node => ({ text: (node.textContent || '').trim(), href: node.href || '' }))
  .filter(item => /review/i.test(item.href) || /리뷰/.test(item.text))
  .slice(0, 30));
console.log('REVIEW_LINKS=' + JSON.stringify(links));

const html = await entryFrame.content();
console.log('HTML_SAVECOUNT_PRESENT=' + /saveCount/i.test(html));
console.log('HTML_VISITOR_PRESENT=' + /visitorReviewCount/i.test(html));
console.log('HTML_BLOG_PRESENT=' + /blogCafeReviewCount/i.test(html));
const saveContext = html.match(/.{0,120}saveCount.{0,180}/i)?.[0] || null;
console.log('HTML_SAVE_CONTEXT=' + JSON.stringify(saveContext));

const reviewHref = links.find(item => /review/i.test(item.href))?.href;
if (reviewHref) {
  await entryFrame.goto(reviewHref, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(5000);
  const text = await entryFrame.locator('body').innerText().catch(() => '');
  const lines = text.split(/\n+/).map(line => line.trim()).filter(line => /방문자\s*리뷰|블로그\s*리뷰|리뷰\s*\d|\d+[,.]?\d*\s*리뷰/i.test(line)).slice(0, 80);
  console.log('REVIEW_VISIBLE_LINES=' + JSON.stringify(lines));
  console.log('REVIEW_FINAL_URL=' + JSON.stringify(entryFrame.url()));
}

for (const item of evidence) console.log('DETAIL_JSON=' + JSON.stringify(item));

await context.close();
await browser.close();
