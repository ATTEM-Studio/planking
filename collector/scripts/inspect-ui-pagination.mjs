import { chromium } from 'playwright';
import { extractFirstPageItems, extractGraphqlItems, normalizeOrganicItems } from '../src/normalize.mjs';

const keywords = (process.env.KEYWORDS || '황성동맛집,하단역카페').split(',').map((v) => v.trim()).filter(Boolean);

function organicMids(payload, type) {
  try {
    const raw = type === 'map' ? extractFirstPageItems(payload) : extractGraphqlItems(payload);
    return normalizeOrganicItems(raw).map((item) => item.mid);
  } catch {
    return [];
  }
}

function getRestaurantsInput(request) {
  try {
    if (!request.url().includes('p-api.place.naver.com/graphql')) return null;
    const body = JSON.parse(request.postData() || 'null');
    const operations = Array.isArray(body) ? body : [body];
    return operations.find((op) => op?.operationName === 'getRestaurants')?.variables?.input ?? null;
  } catch {
    return null;
  }
}

function compactInput(input) {
  if (!input) return null;
  return {
    query: input.query ?? null,
    start: input.start ?? null,
    display: input.display ?? null,
    nlu: input.nlu ?? null,
  };
}

async function inspectMap(context, keyword) {
  const page = await context.newPage();
  const network = [];
  let totalCount = null;

  page.on('response', async (response) => {
    try {
      const url = response.url();
      let type = null;
      if (url.includes('/p/api/search/allSearch')) type = 'map';
      else if (url.includes('pcmap-api.place.naver.com/graphql')) type = 'graphql';
      if (!type) return;
      const payload = await response.json();
      if (type === 'map' && totalCount === null) totalCount = payload?.result?.place?.totalCount ?? null;
      network.push({ type, mids: organicMids(payload, type).slice(0, 80) });
    } catch {}
  });

  await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(keyword)}`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForTimeout(2000);

  const iframe = page.frameLocator('#searchIframe');
  const initialOrganic = network.find((entry) => entry.type === 'map')?.mids ?? [];
  const initialNetworkCount = network.length;

  const candidates = await iframe.locator('body').evaluate(() => {
    const values = [];
    for (const element of document.querySelectorAll('*')) {
      if (element.scrollHeight <= element.clientHeight + 80) continue;
      if (element.clientHeight < 120 || element.clientWidth < 150) continue;
      values.push({
        tag: element.tagName,
        id: element.id || null,
        className: typeof element.className === 'string' ? element.className.slice(0, 120) : null,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      });
    }
    return values.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight)).slice(0, 5);
  }).catch(() => []);

  const attempts = [];
  for (const target of candidates) {
    const before = network.length;
    const scrolled = await iframe.locator('body').evaluate((_, descriptor) => {
      const element = [...document.querySelectorAll('*')].find((node) => {
        const className = typeof node.className === 'string' ? node.className.slice(0, 120) : null;
        return node.tagName === descriptor.tag
          && (node.id || null) === descriptor.id
          && className === descriptor.className
          && node.scrollHeight > node.clientHeight + 80;
      });
      if (!element) return false;
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
      return true;
    }, target).catch(() => false);
    await page.waitForTimeout(2200);
    const newEntries = network.slice(before);
    attempts.push({
      target,
      scrolled,
      newNetworkCount: newEntries.length,
      newOrganicMids: [...new Set(newEntries.flatMap((entry) => entry.mids))].slice(0, 60),
    });
  }

  const paginationTexts = await iframe.locator('a,button').allTextContents().catch(() => []);
  console.log('MAP_SUMMARY', JSON.stringify({
    keyword,
    totalCount,
    initialOrganicCount: initialOrganic.length,
    initialOrganicMids: initialOrganic,
    initialNetworkCount,
    paginationTexts: paginationTexts.map((v) => v.replace(/\s+/g, ' ').trim()).filter((v) => /^(다음|이전|[0-9]+)$/.test(v)).slice(0, 30),
    scrollAttempts: attempts,
    finalNetworkCount: network.length,
  }));

  await page.close();
}

async function inspectSearch(context, keyword) {
  const page = await context.newPage();
  const initialRequests = [];
  page.on('request', (request) => {
    const input = getRestaurantsInput(request);
    if (input) initialRequests.push(compactInput(input));
  });

  await page.goto(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(keyword)}`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForTimeout(2000);

  const candidates = await page.locator('a').evaluateAll((nodes) => nodes.map((a) => ({
    text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    ariaLabel: a.getAttribute('aria-label'),
    href: a.href,
  })).filter((x) =>
    x.text.includes('더보기')
    || String(x.ariaLabel || '').includes('더보기')
    || /map\.naver\.com\/p\/search/.test(x.href)
  ).slice(0, 20)).catch(() => []);

  const candidate = candidates.find((x) => x.text.includes('더보기') && x.href)
    ?? candidates.find((x) => /map\.naver\.com\/p\/search/.test(x.href))
    ?? null;

  let navigation = null;
  if (candidate?.href) {
    const child = await context.newPage();
    const childRequests = [];
    child.on('request', (request) => {
      const input = getRestaurantsInput(request);
      if (input) childRequests.push(compactInput(input));
    });
    await child.goto(candidate.href, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await child.waitForTimeout(2200).catch(() => {});
    navigation = {
      sourceText: candidate.text,
      sourceHref: candidate.href,
      finalUrl: child.url(),
      getRestaurants: childRequests.slice(0, 10),
    };
    await child.close().catch(() => {});
  }

  console.log('SEARCH_SUMMARY', JSON.stringify({
    keyword,
    initialGetRestaurants: initialRequests.slice(0, 10),
    candidates,
    navigation,
  }));

  await page.close();
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
try {
  for (const keyword of keywords) {
    await inspectMap(context, keyword);
    await inspectSearch(context, keyword);
  }
} finally {
  await context.close();
  await browser.close();
}
