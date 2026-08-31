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
const RANK_GRAPHQL_MARKER = 'pcmap-api.place.naver.com/graphql';
const SEARCH_GRAPHQL_MARKER = 'p-api.place.naver.com/graphql';

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
  return assertRankResult({ status, rank: null, ...scannedCounts(pages), matchedMid: null, errorCode, errorMessage });
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

function findMatchedOrganicItem(targetMid, pages) {
  const target = String(targetMid);
  for (const page of pages) {
    const match = normalizeOrganicItems(page).find((item) => item.mid === target);
    if (match) return match;
  }
  return null;
}

function attachPlaceMetrics(result, matchedItem) {
  if (!result || result.status !== 'FOUND' || !matchedItem) return result;
  const metrics = extractPlaceMetrics(matchedItem.raw);
  return Object.values(metrics).some((value) => value !== null)
    ? assertRankResult({ ...result, placeMetrics: metrics })
    : result;
}

function shouldEnrichSaveCount(result) {
  const metrics = result?.placeMetrics;
  return Boolean(
    metrics
    && metrics.saveCountRaw === null
    && (metrics.visitorReviewCount !== null || metrics.blogReviewCount !== null),
  );
}

function mergePlaceMetrics(base, rich) {
  return {
    visitorReviewCount: rich?.visitorReviewCount ?? base?.visitorReviewCount ?? null,
    blogReviewCount: rich?.blogReviewCount ?? base?.blogReviewCount ?? null,
    saveCountRaw: rich?.saveCountRaw ?? base?.saveCountRaw ?? null,
  };
}

function parseGetRestaurantsTemplate(request) {
  try {
    const url = typeof request.url === 'function' ? request.url() : '';
    if (!url.includes(SEARCH_GRAPHQL_MARKER)) return null;
    const body = JSON.parse(request.postData() || 'null');
    const operations = Array.isArray(body) ? body : [body];
    if (!operations.some((operation) => operation?.operationName === 'getRestaurants' && operation?.variables?.input)) {
      return null;
    }
    return { endpoint: url, body };
  } catch {
    return null;
  }
}

function rewriteGetRestaurantsTemplate(template, query, { start = 1, display = 50 } = {}) {
  const body = JSON.parse(JSON.stringify(template.body));
  const operations = Array.isArray(body) ? body : [body];
  for (const operation of operations) {
    if (operation?.operationName !== 'getRestaurants' || !operation?.variables?.input) continue;
    operation.variables.input.query = query;
    operation.variables.input.start = start;
    operation.variables.input.display = display;
    delete operation.variables.input.nlu;
  }
  return { endpoint: template.endpoint, body };
}

async function replayGetRestaurants(page, template, query, options = {}) {
  const replay = rewriteGetRestaurantsTemplate(template, query, options);
  return page.evaluate(async ({ endpoint, body }) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  }, replay);
}

function alignedWithMapFirstPage(mapFirstPage, searchItems) {
  const mapOrganic = normalizeOrganicItems(mapFirstPage);
  const searchOrganic = normalizeOrganicItems(searchItems);
  if (!mapOrganic.length || searchOrganic.length < mapOrganic.length) return false;
  return mapOrganic.every((item, index) => searchOrganic[index]?.mid === item.mid);
}

async function waitForTemplate(page, getTemplate, timeoutMs) {
  const started = Date.now();
  while (!getTemplate() && Date.now() - started < timeoutMs) {
    if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(25);
    else await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return getTemplate();
}

function fallbackCategorySeed(rawCategory) {
  const values = Array.isArray(rawCategory) ? rawCategory : [rawCategory];
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const parts = String(values[index] ?? '')
      .split(/[>,/|·]/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length) return parts[0];
  }
  return '';
}

function fallbackLocalitySeed(...addressValues) {
  const addresses = addressValues.map((value) => String(value ?? '').trim()).filter(Boolean);
  for (const address of addresses) {
    const tokens = address.split(/\s+/).map((token) => token.replace(/[(),]/g, '')).filter(Boolean);
    for (let index = tokens.length - 1; index >= 0; index -= 1) {
      const match = tokens[index].match(/^(.+?)(?:동|읍|면|리|가)$/);
      if (match?.[1]) return match[1];
    }
  }
  for (const address of addresses) {
    const tokens = address.split(/\s+/).map((token) => token.replace(/[(),]/g, '')).filter(Boolean);
    for (let index = tokens.length - 1; index >= 0; index -= 1) {
      if (/^[가-힣0-9]+(?:구|군|시)$/.test(tokens[index])) return tokens[index];
    }
  }
  return '';
}

function fallbackTemplateSeeds(keyword, mapFirstPage) {
  const first = normalizeOrganicItems(mapFirstPage)[0];
  const raw = first?.raw && typeof first.raw === 'object' ? first.raw : {};
  const category = fallbackCategorySeed(raw.category ?? raw.businessCategory);
  const locality = fallbackLocalitySeed(
    raw.shortAddress,
    raw.abbrAddress,
    raw.commonAddress,
    raw.address,
    raw.roadAddress,
  );
  const address = String(raw.commonAddress ?? raw.address ?? raw.roadAddress ?? '').trim();
  const name = String(first?.name ?? '').trim();
  const candidates = [String(keyword ?? '').trim()];
  if (locality && category) {
    candidates.push(`${locality}${category}`);
    candidates.push(`${locality} ${category}`);
  } else if (address && category) {
    candidates.push(`${address} ${category}`);
  }
  if (name) candidates.push(name);
  return [...new Set(candidates.filter(Boolean))];
}

async function collectAlignedRankFromNaverSearch({
  context,
  keyword,
  targetMid,
  mapFirstPage,
  maxRank,
  timeoutMs,
}) {
  const cleanKeyword = String(keyword ?? '').trim();
  const cleanMid = String(targetMid ?? '').trim();
  if (!context || !cleanKeyword || !cleanMid || !Array.isArray(mapFirstPage) || !mapFirstPage.length) return null;

  let searchPage;
  let template = null;
  try {
    searchPage = await context.newPage();
    // Unit-test/fake browser contexts intentionally do not implement evaluate.
    if (!searchPage || typeof searchPage.evaluate !== 'function') return null;

    searchPage.on('request', (request) => {
      const candidate = parseGetRestaurantsTemplate(request);
      if (candidate) template = candidate;
    });

    const seeds = fallbackTemplateSeeds(cleanKeyword, mapFirstPage);
    const perSeedTimeout = Math.max(1500, Math.min(5000, Math.floor(timeoutMs / Math.max(1, seeds.length))));
    for (const seed of seeds) {
      template = null;
      await searchPage.goto(
        `https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(seed)}`,
        { waitUntil: 'domcontentloaded', timeout: timeoutMs },
      );
      await waitForTemplate(searchPage, () => template, perSeedTimeout);
      if (template) break;
    }
    if (!template) return null;

    const seen = new Set();
    let cumulativeRank = 0;
    let pagesScanned = 0;

    for (let start = 1; start <= maxRank; start += 50) {
      const display = Math.min(50, maxRank - start + 1);
      const replay = await replayGetRestaurants(searchPage, template, cleanKeyword, { start, display });
      if (Number(replay?.status) !== 200) return null;

      const rawItems = extractGraphqlItems(replay?.json);
      const organicItems = normalizeOrganicItems(rawItems);
      if (start === 1 && !alignedWithMapFirstPage(mapFirstPage, rawItems)) return null;
      if (!organicItems.length) return null;

      pagesScanned += 1;
      for (const item of organicItems) {
        if (seen.has(item.mid)) continue;
        seen.add(item.mid);
        cumulativeRank += 1;
        if (cumulativeRank > maxRank) return null;
        if (item.mid !== cleanMid) continue;

        const placeMetrics = extractPlaceMetrics(item.raw);
        const result = {
          status: 'FOUND',
          rank: cumulativeRank,
          pagesScanned,
          itemsScanned: cumulativeRank,
          matchedMid: cleanMid,
          errorCode: null,
          errorMessage: null,
        };
        if (Object.values(placeMetrics).some((value) => value !== null)) result.placeMetrics = placeMetrics;
        return assertRankResult(result);
      }

      // Search GraphQL ending before maxRank is not proof of 300+.
      if (organicItems.length < display) return null;
    }

    // Never promote fallback absence to OUT_OF_RANGE without a proven complete top-300 traversal.
    return null;
  } catch {
    return null;
  } finally {
    if (searchPage && typeof searchPage.close === 'function') await searchPage.close().catch(() => {});
  }
}

async function enrichPlaceMetricsFromNaverSearch({ context, seedKeyword, exactPlaceName, targetMid, result, timeoutMs }) {
  if (!shouldEnrichSaveCount(result)) return result;
  const seed = String(seedKeyword ?? '').trim();
  const exact = String(exactPlaceName ?? '').trim();
  if (!seed || !exact) return result;

  let metricsPage;
  let template = null;
  let richMetrics = null;
  try {
    metricsPage = await context.newPage();
    if (!metricsPage || typeof metricsPage.evaluate !== 'function') return result;

    metricsPage.on('request', (request) => {
      if (!template) template = parseGetRestaurantsTemplate(request);
    });
    metricsPage.on('response', async (response) => {
      try {
        const status = typeof response.status === 'function' ? response.status() : 0;
        if (status === 429) return;
        const url = typeof response.url === 'function' ? response.url() : '';
        if (!url.includes(SEARCH_GRAPHQL_MARKER)) return;
        const payload = await response.json();
        const raw = extractPlaceItemByMid(payload, targetMid);
        if (!raw) return;
        const candidate = extractPlaceMetrics(raw);
        if (Object.values(candidate).some((value) => value !== null)) {
          richMetrics = mergePlaceMetrics(richMetrics, candidate);
        }
      } catch {}
    });

    await metricsPage.goto(
      `https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(seed)}`,
      { waitUntil: 'domcontentloaded', timeout: timeoutMs },
    );
    await waitForTemplate(metricsPage, () => template, timeoutMs);

    if (richMetrics?.saveCountRaw) {
      return assertRankResult({ ...result, placeMetrics: mergePlaceMetrics(result.placeMetrics, richMetrics) });
    }
    if (!template) return result;

    const replay = await replayGetRestaurants(metricsPage, template, exact, { start: 1, display: 50 });
    if (Number(replay?.status) !== 200) return result;
    const raw = extractPlaceItemByMid(replay?.json, targetMid);
    if (!raw) return result;
    const replayMetrics = extractPlaceMetrics(raw);
    if (!Object.values(replayMetrics).some((value) => value !== null)) return result;
    return assertRankResult({ ...result, placeMetrics: mergePlaceMetrics(result.placeMetrics, replayMetrics) });
  } catch {
    return result;
  } finally {
    if (metricsPage && typeof metricsPage.close === 'function') await metricsPage.close().catch(() => {});
  }
}

export class NaverMapCollector {
  constructor({
    browserFactory = defaultBrowserFactory,
    timeoutMs = 15000,
    pageDelayMs = 600,
    metricEnrichmentTimeoutMs = 10000,
    rankSearchFallback = collectAlignedRankFromNaverSearch,
  } = {}) {
    this.browserFactory = browserFactory;
    this.timeoutMs = timeoutMs;
    this.pageDelayMs = pageDelayMs;
    this.metricEnrichmentTimeoutMs = metricEnrichmentTimeoutMs;
    this.rankSearchFallback = rankSearchFallback;
  }

  async collect({ keyword, targetMid, maxRank = 300 }) {
    const cleanKeyword = String(keyword ?? '').trim();
    const cleanMid = String(targetMid ?? '').trim();
    if (!cleanKeyword) throw new TypeError('keyword is required');
    if (!cleanMid) throw new TypeError('targetMid is required');

    const pages = [];
    let browser;
    let context;
    const capture = { first: [], graphql: [], blocked: false, parseError: null };

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
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return capture[kind][previousCount];
    };

    const finalizeFound = async (found) => {
      const matchedItem = findMatchedOrganicItem(cleanMid, pages);
      const withBaseMetrics = attachPlaceMetrics(found, matchedItem);
      const exactPlaceName = String(matchedItem?.name ?? '').trim();
      return enrichPlaceMetricsFromNaverSearch({
        context,
        seedKeyword: cleanKeyword,
        exactPlaceName,
        targetMid: cleanMid,
        result: withBaseMetrics,
        timeoutMs: this.metricEnrichmentTimeoutMs,
      });
    };

    const trySearchFallback = async () => {
      if (typeof this.rankSearchFallback !== 'function') return null;
      try {
        const result = await this.rankSearchFallback({
          context,
          keyword: cleanKeyword,
          targetMid: cleanMid,
          mapFirstPage: pages[0] ?? [],
          maxRank,
          timeoutMs: this.metricEnrichmentTimeoutMs,
        });
        return result ? assertRankResult(result) : null;
      } catch {
        return null;
      }
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
          if (!url.includes(FIRST_PAGE_MARKER) && !url.includes(RANK_GRAPHQL_MARKER)) return;
          const payload = await response.json();
          if (url.includes(FIRST_PAGE_MARKER)) capture.first.push(extractFirstPageItems(payload));
          else capture.graphql.push(extractGraphqlItems(payload));
        } catch (error) {
          capture.parseError = error;
        }
      });

      const firstBefore = capture.first.length;
      await page.goto(
        `https://map.naver.com/p/search/${encodeURIComponent(cleanKeyword)}`,
        { waitUntil: 'domcontentloaded', timeout: this.timeoutMs },
      );
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
          const fallback = await trySearchFallback();
          if (fallback) return fallback;
          return incompleteResult(pages, maxRank, `page ${pageNumber} was unavailable`);
        }

        const graphBefore = capture.graphql.length;
        await link.click({ timeout: this.timeoutMs });
        if (this.pageDelayMs > 0 && typeof page.waitForTimeout === 'function') await page.waitForTimeout(this.pageDelayMs);
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
      if (error?.code === 'BLOCKED') return errorResult('BLOCKED', pages, 'BLOCKED', String(error.message ?? 'Naver blocked request'));
      if (isTimeoutError(error)) return errorResult('TIMEOUT', pages, 'TIMEOUT', String(error.message ?? 'collection timed out'));
      return errorResult('FAILED', pages, error?.code ?? 'COLLECTOR_ERROR', String(error?.message ?? error));
    } finally {
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
  }
}
