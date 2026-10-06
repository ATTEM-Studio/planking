import { normalizeRankResult } from '../../../packages/core/src/index.mjs';
import { detectBlockedText, extractApolloCandidates, normalizePlaceItems } from './parser.mjs';

export const COLLECTOR_VERSION = 'planking-v2.0.0';

function required(value, name) { const text = String(value ?? '').trim(); if (!text) throw new TypeError(`${name} is required`); return text; }
function normalizeMaxRank(value) { const number = Number(value ?? 100); if (!Number.isInteger(number) || number < 1 || number > 300) throw new RangeError('maxRank must be an integer between 1 and 300'); return number; }

export async function collectRank(input, adapter) {
  const keyword = required(input?.keyword, 'keyword');
  const targetPlaceId = required(input?.targetPlaceId, 'targetPlaceId');
  const maxRank = normalizeMaxRank(input?.maxRank);
  if (!adapter || typeof adapter.collect !== 'function') throw new TypeError('adapter.collect is required');
  try {
    const collected = await adapter.collect({ keyword, maxRank });
    if (collected?.blocked) return normalizeRankResult({ status: 'BLOCKED', rank: null, maxRank, itemsScanned: 0, pagesScanned: collected.pagesScanned ?? 0 });
    const items = normalizePlaceItems(collected?.items ?? [], maxRank);
    const found = items.find((item) => item.placeId === targetPlaceId);
    if (found) return normalizeRankResult({ status: 'FOUND', rank: found.rank, maxRank, itemsScanned: items.length, pagesScanned: collected?.pagesScanned ?? 1 });
    if (collected?.completed === true || items.length >= maxRank) return normalizeRankResult({ status: 'OUT_OF_RANGE', rank: null, maxRank, itemsScanned: items.length, pagesScanned: collected?.pagesScanned ?? 1 });
    return normalizeRankResult({ status: 'PARSE_ERROR', rank: null, maxRank, itemsScanned: items.length, pagesScanned: collected?.pagesScanned ?? 0, errorCode: 'INCOMPLETE_RESULT_SET', errorMessage: '검색 결과를 정상 범위까지 확인하지 못했습니다.' });
  } catch (error) {
    if (error?.name === 'TimeoutError' || /timeout/i.test(String(error?.message ?? ''))) return normalizeRankResult({ status: 'TIMEOUT', rank: null, maxRank, errorCode: 'TIMEOUT', errorMessage: String(error.message ?? error) });
    if (error?.name === 'ParseError') return normalizeRankResult({ status: 'PARSE_ERROR', rank: null, maxRank, errorCode: 'PARSE_ERROR', errorMessage: String(error.message ?? error) });
    return normalizeRankResult({ status: 'FAILED', rank: null, maxRank, errorCode: 'UNEXPECTED', errorMessage: String(error?.message ?? error) });
  }
}

export class PlaywrightNaverAdapter {
  constructor({ headless = true, timeoutMs = 45000 } = {}) { this.headless = headless; this.timeoutMs = timeoutMs; }
  async collect({ keyword, maxRank }) {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: this.headless });
    const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1400, height: 900 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36' });
    const page = await context.newPage();
    const collected = []; const seen = new Set(); let pagesScanned = 0;
    try {
      const url = `https://map.naver.com/p/search/${encodeURIComponent(keyword)}?searchType=place`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
      await page.waitForTimeout(1800);
      const bodyText = await page.locator('body').innerText().catch(() => '');
      if (detectBlockedText(bodyText)) return { blocked: true, items: [], pagesScanned: 0, completed: false };
      let previousCount = -1; let stableRounds = 0;
      for (let round = 0; round < 30 && collected.length < maxRank; round += 1) {
        pagesScanned = round + 1;
        for (const frame of page.frames()) {
          const frameUrl = frame.url() ?? '';
          if (frame !== page.mainFrame() && !frameUrl.includes('pcmap.place.naver.com')) continue;
          const blockedText = await frame.locator('body').innerText().catch(() => '');
          if (detectBlockedText(blockedText)) return { blocked: true, items: [], pagesScanned, completed: false };
          const payload = await frame.evaluate(() => window.__APOLLO_STATE__ || {}).catch(() => ({}));
          for (const item of extractApolloCandidates(payload)) if (!seen.has(item.id)) { seen.add(item.id); collected.push(item); }
          const domItems = await frame.locator('a[href*="/place/"]').evaluateAll((anchors) => anchors.map((anchor) => { const href = anchor.getAttribute('href') || ''; const match = href.match(/\/place\/(\d+)/); const row = anchor.closest('li'); const text = row?.innerText || anchor.textContent || ''; return match ? { id: match[1], name: (anchor.textContent || '').trim(), isAd: /(^|\n)광고($|\n)/.test(text) } : null; }).filter(Boolean)).catch(() => []);
          for (const item of domItems) if (!seen.has(item.id)) { seen.add(item.id); collected.push(item); }
          await frame.locator('#_pcmap_list_scroll_container').evaluate((el) => { el.scrollTop = el.scrollHeight; }).catch(() => {});
        }
        if (collected.length === previousCount) stableRounds += 1; else stableRounds = 0;
        previousCount = collected.length;
        if (stableRounds >= 3) break;
        await page.waitForTimeout(500);
      }
      return { items: collected.slice(0, maxRank), pagesScanned, completed: stableRounds >= 3 || collected.length >= maxRank };
    } finally { await browser.close(); }
  }
}
