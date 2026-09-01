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

function requestGetRestaurantsInput(request) {
  try {
    if (!request.url().includes('p-api.place.naver.com/graphql')) return null;
    const body = JSON.parse(request.postData() || 'null');
    const operations = Array.isArray(body) ? body : [body];
    return operations.find((op) => op?.operationName === 'getRestaurants')?.variables?.input ?? null;
  } catch {
    return null;
  }
}

async function inspectMap(context, keyword) {
  const page = await context.newPage();
  const network = [];
  page.on('response', async (response) => {
    try {
      const url = response.url();
      let type = null;
      if (url.includes('/p/api/search/allSearch')) type = 'map';
      else if (url.includes('pcmap-api.place.naver.com/graphql')) type = 'graphql';
      if (!type) return;
      const payload = await response.json();
      network.push({ url, status: response.status(), type, mids: organicMids(payload, type).slice(0, 80) });
    } catch {}
  });

  await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(keyword)}`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForTimeout(2500);

  const iframe = page.frameLocator('#searchIframe');
  const scrollables = await iframe.locator('body').evaluate(() => {
    const values = [];
    for (const element of document.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      const overflow = `${style.overflow} ${style.overflowY}`;
      if (element.scrollHeight <= element.clientHeight + 80) continue;
      if (element.clientHeight < 120 || element.clientWidth < 150) continue;
      values.push({
        tag: element.tagName,
        id: element.id || null,
        className: typeof element.className === 'string' ? element.className.slice(0, 180) : null,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflow,
      });
    }
    return values.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight)).slice(0, 12);
  }).catch(() => []);

  const beforeDom = await iframe.locator('a').evaluateAll((anchors) => anchors.map((a) => ({
    text: (a.textContent || '').trim().slice(0, 80),
    href: a.getAttribute('href'),
  })).filter((x) => x.href && /place|entry/.test(x.href)).slice(0, 100)).catch(() => []);

  const scrollResults = [];
  for (let index = 0; index < Math.min(scrollables.length, 5); index += 1) {
    const target = scrollables[index];
    const beforeNetwork = network.length;
    const scrolled = await iframe.locator('body').evaluate((_, descriptor) => {
      const matches = [...document.querySelectorAll('*')].filter((element) => {
        const className = typeof element.className === 'string' ? element.className.slice(0, 180) : null;
        return element.tagName === descriptor.tag
          && (element.id || null) === descriptor.id
          && className === descriptor.className
          && element.scrollHeight > element.clientHeight + 80;
      });
      const element = matches[0];
      if (!element) return false;
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
      return true;
    }, target).catch(() => false);
    await page.waitForTimeout(2500);
    const afterDom = await iframe.locator('a').evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href')).filter((href) => href && /place|entry/.test(href))).catch(() => []);
    scrollResults.push({
      target,
      scrolled,
      newNetwork: network.slice(beforeNetwork),
      placeLikeAnchorCount: afterDom.length,
    });
  }

  console.log('MAP_UI_PAGINATION', JSON.stringify({
    keyword,
    initialNetwork: network.slice(0, 10),
    scrollables,
    initialPlaceLikeAnchors: beforeDom,
    scrollResults,
    finalNetworkCount: network.length,
  }, null, 2));
  await page.close();
}

async function inspectSearch(context, keyword) {
  const page = await context.newPage();
  const requests = [];
  page.on('request', (request) => {
    const input = requestGetRestaurantsInput(request);
    if (input) requests.push({ url: request.url(), input });
  });

  await page.goto(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(keyword)}`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForTimeout(2500);

  const anchors = await page.locator('a').evaluateAll((nodes, q) => nodes.map((a) => ({
    text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    ariaLabel: a.getAttribute('aria-label'),
    title: a.getAttribute('title'),
    href: a.href,
    target: a.getAttribute('target'),
    className: typeof a.className === 'string' ? a.className.slice(0, 180) : null,
  })).filter((x) =>
    x.text.includes(q)
    || x.text.includes('더보기')
    || String(x.ariaLabel || '').includes('더보기')
    || /map\.naver|place\.naver/.test(x.href)
  ).slice(0, 120), keyword).catch(() => []);

  const candidate = anchors.find((x) => x.text.includes('더보기') && x.href) ?? null;
  let afterNavigation = null;
  if (candidate?.href) {
    const child = await context.newPage();
    const childRequests = [];
    child.on('request', (request) => {
      const input = requestGetRestaurantsInput(request);
      if (input) childRequests.push({ url: request.url(), input });
    });
    await child.goto(candidate.href, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await child.waitForTimeout(2500).catch(() => {});
    afterNavigation = {
      source: candidate,
      finalUrl: child.url(),
      title: await child.title().catch(() => ''),
      getRestaurantsRequests: childRequests.slice(0, 20),
    };
    await child.close().catch(() => {});
  }

  console.log('SEARCH_UI_LINKS', JSON.stringify({
    keyword,
    initialGetRestaurants: requests.slice(0, 20),
    anchors,
    afterNavigation,
  }, null, 2));
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
