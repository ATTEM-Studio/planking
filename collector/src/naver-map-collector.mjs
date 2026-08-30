import {
  extractFirstPageItems,
  extractGraphqlItems,
  extractPlaceItemByMid,
  extractPlaceMetrics,
  normalizeOrganicItems,
} from './normalize.mjs';
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

function attachPlaceMetrics(result, targetMid, pages) {
  if (!result || result.status !== 'FOUND') return result;
  const target = String(targetMid);
  for (const page of pages) {
    const match = normalizeOrganicItems(page).find(item => item.mid === target);
    if (!match) continue;
    const metrics = extractPlaceMetrics(match.raw);
    if (Object.values(metrics).some(value => value !== null)) {
      return assertRankResult({ ...result, placeMetrics: metrics });
    }
    return result;
  }
  return result;
}

function shouldEnrichSaveCount(result) {
  const metrics = result?.placeMetrics;
  if (!metrics || metrics.saveCountRaw !== null) return false;
  return metrics.visitorReviewCount !== null || metrics.blogReviewCount !== null;
}

function mergePlaceMetrics(base, rich) {
  return {
    visitorReviewCount: rich?.visitorReviewCount ?? base?.visitorReviewCount ?? null,
    blogReviewCount: rich?.blogReviewCount ?? base?.blogReviewCount ?? null,
    saveCountRaw: rich?.saveCountRaw ?? base?.saveCountRaw ?? null,
  };
}

async function enrichPlaceMetricsFromNaverSearch({
  context,
  keyword,
  targetMid,
  result,
  timeoutMs,
}) {
  if (!shouldEnrichSaveCount(result)) return result;

  let metricsPage;
  let richMetrics = null;
  try {
    metricsPage = await context.newPage();
    metricsPage.on('response', async response => {
      try {
        const status = typeof response.status === 'function' ? response.status() : 0;
        if (status === 429) return;
        const url = typeof response.url === 'function' ? response.url() : '';
        if (!url.includes(GRAPHQL_MARKER)) return;
        const payload = await response.json();
        const rawItem = extractPlaceItemByMid(payload, targetMid);
        if (!rawItem) return;
        const candidate = extractPlaceMetrics(rawItem);
        if (Object.values(candidate).some(value => value !== null)) {
          richMetrics = mergePlaceMetrics(richMetrics, candidate);
        }
      } catch {
        // Metric enrichment is best-effort and must never change rank status.
      }
    });

    await metricsPage.goto(
      `https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(keyword)}`,
      { waitUntil: 'domcontentloaded', timeout: timeoutMs },
    );

    const started = Date.now();
    while (richMetrics?.saveCountRaw === null || richMetrics?.saveCountRaw === undefined) {
      if (Date.now() - started >= timeoutMs) break;
      if (typeof metricsPage.waitForTimeout === 'function') {
        await metricsPage.waitForTimeout(25);
      } else {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }

    if (!richMetrics) return result;
    return assertRankResult({
      ...result,
      placeMetrics: mergePlaceMetrics(result.placeMetrics, richMetrics),
    });
  } catch {
    return result;
  } finally {
    if (metricsPage && typeof metricsPage.close === 'function') {
      await metricsPage.close().catch(() => {});
    }
  }
}

export class NaverMapCollector {
  constructor({
    browserFactory = defaultBrowserFactory,
    timeoutMs = 15000,
    pageDelayMs = 600,
    metricEnrichmentTimeoutMs = 3000,
  } = {}) {
    this.browserFactory = browserFactory;
    this.timeoutMs = timeoutMs;
    this.pageDelayMs = pageDelayMs;
    this.metricEnrichmentTimeoutMs = metricEnrichmentTimeoutMs;
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

    const finalizeFound = async found => {
      const withBaseMetrics = attachPlaceMetrics(found, cleanMid, pages);
      return enrichPlaceMetricsFromNaverSearch({
        context,
        keyword: cleanKeyword,
        targetMid: cleanMid,
        result: withBaseMetrics,
        timeoutMs: this.metricEnrichmentTimeoutMs,
      });
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
      if (found) return await finalizeFound(found);

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
        if (found) return await finalizeFound(found);
      }

      found = tryCurrentRank(cleanMid, pages, maxRank);
      return found ? await finalizeFound(found) : incompleteResult(pages, maxRank);
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
