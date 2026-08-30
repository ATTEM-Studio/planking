import { extractFirstPageItems, extractGraphqlItems, normalizeOrganicItems } from './normalize.mjs';
import { findRankAcrossPages } from './rank-engine.mjs';
import { assertRankResult } from './types.mjs';

const FIRST_PAGE_MARKER = '/p/api/search/allSearch';
const GRAPHQL_MARKER = 'pcmap-api.place.naver.com/graphql';

async function defaultBrowserFactory() {
  const { chromium } = await import('playwright');
  return chromium.launch({ headless: true });
}

function scannedCounts(pages) {
  return {
    pagesScanned: pages.length,
    itemsScanned: pages.reduce((sum, page) => sum + normalizeOrganicItems(page).length, 0),
  };
}

function errorResult(status, pages, errorCode, errorMessage) {
  const counts = scannedCounts(pages);
  return assertRankResult({
    status,
    rank: null,
    ...counts,
    matchedMid: null,
    errorCode,
    errorMessage,
  });
}

function incompleteResult(pages, maxRank, reason = 'pagination ended before the requested rank limit') {
  const counts = scannedCounts(pages);
  return assertRankResult({
    status: 'INCOMPLETE',
    rank: null,
    ...counts,
    matchedMid: null,
    errorCode: 'INCOMPLETE_TRAVERSAL',
    errorMessage: `${reason}: scanned ${counts.itemsScanned} of ${maxRank}`,
  });
}

function isTimeoutError(error) {
  const name = String(error?.name ?? '').toLowerCase();
  const message = String(error?.message ?? '').toLowerCase();
  return name.includes('timeout') || message.includes('timeout');
}

function isBlockedText(text) {
  const value = String(text ?? '').toLowerCase();
  return value.includes('captcha') || value.includes('too many requests');
}

function tryCurrentRank(targetMid, pages, maxRank) {
  try {
    return findRankAcrossPages({ targetMid, pages, maxRank });
  } catch (error) {
    if (String(error?.message ?? '').includes('incomplete traversal')) return null;
    throw error;
  }
}

export class NaverMapCollector {
  constructor({ browserFactory = defaultBrowserFactory, timeoutMs = 15000, pageDelayMs = 600 } = {}) {
    this.browserFactory = browserFactory;
    this.timeoutMs = timeoutMs;
    this.pageDelayMs = pageDelayMs;
  }

  async collect({ keyword, targetMid, maxRank = 300 }) {
    const cleanKeyword = String(keyword ?? '').trim();
    const cleanMid = String(targetMid ?? '').trim();
    if (!cleanKeyword) throw new TypeError('keyword is required');
    if (!cleanMid) throw new TypeError('targetMid is required');

    const pages = [];
    let browser;
    let context;

    const capture = {
      first: [],
      graphql: [],
      blocked: false,
      parseError: null,
    };

    const waitForCapture = async (kind, previousCount) => {
      const started = Date.now();
      while (capture[kind].length <= previousCount) {
        if (capture.blocked) throw Object.assign(new Error('naver blocked request'), { code: 'BLOCKED' });
        if (capture.parseError) throw capture.parseError;
        if (Date.now() - started >= this.timeoutMs) {
          const error = new Error(`timeout waiting for ${kind} response`);
          error.name = 'TimeoutError';
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return capture[kind][previousCount];
    };

    try {
      browser = await this.browserFactory();
      context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await context.newPage();

      page.on('response', async (response) => {
        try {
          const status = typeof response.status === 'function' ? response.status() : 0;
          if (status === 429) {
            capture.blocked = true;
            return;
          }
          const url = typeof response.url === 'function' ? response.url() : '';
          if (!url.includes(FIRST_PAGE_MARKER) && !url.includes(GRAPHQL_MARKER)) return;
          const payload = await response.json();
          if (url.includes(FIRST_PAGE_MARKER)) {
            capture.first.push(extractFirstPageItems(payload));
          } else {
            capture.graphql.push(extractGraphqlItems(payload));
          }
        } catch (error) {
          capture.parseError = error;
        }
      });

      const firstBefore = capture.first.length;
      await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(cleanKeyword)}`, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeoutMs,
      });

      if (capture.blocked) return errorResult('BLOCKED', pages, 'HTTP_429', 'Naver returned HTTP 429');
      const initialText = `${await page.title()}\n${await page.content()}`;
      if (isBlockedText(initialText)) return errorResult('BLOCKED', pages, 'BLOCK_PAGE', 'Naver block/captcha page detected');

      pages.push(await waitForCapture('first', firstBefore));
      let found = tryCurrentRank(cleanMid, pages, maxRank);
      if (found) return found;

      const maxPages = Math.min(6, Math.ceil(maxRank / 50));
      for (let pageNumber = 2; pageNumber <= maxPages; pageNumber += 1) {
        const frame = page.frameLocator('#searchIframe');
        const link = frame.getByRole('link', { name: String(pageNumber), exact: true });
        const count = await link.count();
        if (count === 0) {
          return incompleteResult(pages, maxRank, `page ${pageNumber} was unavailable`);
        }

        const graphBefore = capture.graphql.length;
        await link.click({ timeout: this.timeoutMs });
        if (this.pageDelayMs > 0 && typeof page.waitForTimeout === 'function') {
          await page.waitForTimeout(this.pageDelayMs);
        }

        if (capture.blocked) return errorResult('BLOCKED', pages, 'HTTP_429', 'Naver returned HTTP 429');
        const body = `${await page.title()}\n${await page.content()}`;
        if (isBlockedText(body)) return errorResult('BLOCKED', pages, 'BLOCK_PAGE', 'Naver block/captcha page detected');

        pages.push(await waitForCapture('graphql', graphBefore));
        found = tryCurrentRank(cleanMid, pages, maxRank);
        if (found) return found;
      }

      found = tryCurrentRank(cleanMid, pages, maxRank);
      return found || incompleteResult(pages, maxRank);
    } catch (error) {
      if (error?.code === 'BLOCKED') {
        return errorResult('BLOCKED', pages, 'BLOCKED', String(error.message ?? 'Naver blocked request'));
      }
      if (isTimeoutError(error)) {
        return errorResult('TIMEOUT', pages, 'TIMEOUT', String(error.message ?? 'collection timed out'));
      }
      return errorResult('FAILED', pages, error?.code ?? 'COLLECTOR_ERROR', String(error?.message ?? error));
    } finally {
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
  }
}
