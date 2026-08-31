import { chromium } from 'playwright';
import { extractFirstPageItems, normalizeOrganicItems } from '../src/normalize.mjs';

const keyword = process.env.KEYWORD || '하단역카페';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

async function mapFirstPage() {
  const page = await context.newPage();
  let captured = null;
  page.on('response', async (response) => {
    try {
      if (!response.url().includes('/p/api/search/allSearch')) return;
      captured = extractFirstPageItems(await response.json());
    } catch {}
  });
  try {
    await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(keyword)}`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    const started = Date.now();
    while (!captured && Date.now() - started < 15000) await page.waitForTimeout(50);
    return captured || [];
  } finally {
    await page.close();
  }
}

async function inspectSeed(seed) {
  const page = await context.newPage();
  const matches = [];
  page.on('request', (request) => {
    try {
      const url = request.url();
      if (!url.includes('place.naver.com/graphql')) return;
      const body = JSON.parse(request.postData() || 'null');
      const operations = Array.isArray(body) ? body : [body];
      for (const operation of operations) {
        matches.push({
          host: new URL(url).host,
          operationName: operation?.operationName || null,
          query: operation?.variables?.input?.query || null,
        });
      }
    } catch {}
  });
  try {
    await page.goto(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(seed)}`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(5000);
    return matches;
  } finally {
    await page.close();
  }
}

try {
  const rawFirstPage = await mapFirstPage();
  const first = normalizeOrganicItems(rawFirstPage)[0];
  const raw = first?.raw || {};
  const picked = {
    name: first?.name || null,
    commonAddress: raw.commonAddress ?? null,
    address: raw.address ?? null,
    category: raw.category ?? null,
    businessCategory: raw.businessCategory ?? null,
    roadAddress: raw.roadAddress ?? null,
    keys: Object.keys(raw),
  };
  console.log('FIRST_ITEM', JSON.stringify(picked, null, 2));

  const candidates = [
    keyword,
    [raw.commonAddress ?? raw.address, raw.category ?? raw.businessCategory].filter(Boolean).join(' '),
    first?.name || '',
    '하단카페',
    '서울맛집',
  ].filter(Boolean);

  for (const seed of [...new Set(candidates)]) {
    const requests = await inspectSeed(seed);
    console.log('SEED_REQUESTS', JSON.stringify({ seed, requests }, null, 2));
  }
} finally {
  await context.close();
  await browser.close();
}
