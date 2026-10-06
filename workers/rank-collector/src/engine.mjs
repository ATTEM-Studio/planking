import { normalizeRankResult } from '../../../packages/core/src/index.mjs';
import { normalizePlaceItems } from './parser.mjs';

export const COLLECTOR_VERSION = 'planking-v2.0.0';

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${name} is required`);
  return text;
}

function normalizeMaxRank(value) {
  const number = Number(value ?? 100);
  if (!Number.isInteger(number) || number < 1 || number > 300) {
    throw new RangeError('maxRank must be an integer between 1 and 300');
  }
  return number;
}

export async function collectRank(input, adapter) {
  const keyword = required(input?.keyword, 'keyword');
  const targetPlaceId = required(input?.targetPlaceId, 'targetPlaceId');
  const maxRank = normalizeMaxRank(input?.maxRank);
  if (!adapter || typeof adapter.collect !== 'function') throw new TypeError('adapter.collect is required');

  try {
    const collected = await adapter.collect({ keyword, targetPlaceId, maxRank });
    if (collected?.nativeRankResult) {
      const native = collected.nativeRankResult;
      const status = native.status === 'INCOMPLETE' ? 'PARSE_ERROR' : native.status;
      return normalizeRankResult({
        status,
        rank: status === 'FOUND' ? native.rank : null,
        maxRank,
        itemsScanned: native.itemsScanned ?? 0,
        pagesScanned: native.pagesScanned ?? 0,
        errorCode: native.errorCode ?? (native.status === 'INCOMPLETE' ? 'INCOMPLETE_TRAVERSAL' : null),
        errorMessage: native.errorMessage ?? null,
      });
    }
    if (collected?.blocked) {
      return normalizeRankResult({ status: 'BLOCKED', rank: null, maxRank, itemsScanned: 0, pagesScanned: collected.pagesScanned ?? 0 });
    }

    const items = normalizePlaceItems(collected?.items ?? [], maxRank);
    const found = items.find((item) => item.placeId === targetPlaceId);
    if (found) {
      return normalizeRankResult({ status: 'FOUND', rank: found.rank, maxRank, itemsScanned: items.length, pagesScanned: collected?.pagesScanned ?? 1 });
    }

    if (collected?.completed === true || items.length >= maxRank) {
      return normalizeRankResult({ status: 'OUT_OF_RANGE', rank: null, maxRank, itemsScanned: items.length, pagesScanned: collected?.pagesScanned ?? 1 });
    }

    return normalizeRankResult({
      status: 'PARSE_ERROR', rank: null, maxRank, itemsScanned: items.length, pagesScanned: collected?.pagesScanned ?? 0,
      errorCode: 'INCOMPLETE_RESULT_SET', errorMessage: '검색 결과를 정상 범위까지 확인하지 못했습니다.',
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || /timeout/i.test(String(error?.message ?? ''))) {
      return normalizeRankResult({ status: 'TIMEOUT', rank: null, maxRank, errorCode: 'TIMEOUT', errorMessage: String(error.message ?? error) });
    }
    if (error?.name === 'ParseError') {
      return normalizeRankResult({ status: 'PARSE_ERROR', rank: null, maxRank, errorCode: 'PARSE_ERROR', errorMessage: String(error.message ?? error) });
    }
    return normalizeRankResult({ status: 'FAILED', rank: null, maxRank, errorCode: 'UNEXPECTED', errorMessage: String(error?.message ?? error) });
  }
}

export class PlaywrightNaverAdapter {
  constructor({ headless = true, timeoutMs = 45000 } = {}) {
    this.headless = headless;
    this.timeoutMs = timeoutMs;
  }

  async collect({ keyword, targetPlaceId, maxRank }) {
    const { NaverMapCollector } = await import('./legacy/naver-map-collector.mjs');
    const browserFactory = async () => {
      const { chromium } = await import('playwright');
      return chromium.launch({ headless: this.headless });
    };
    const collector = new NaverMapCollector({
      browserFactory,
      timeoutMs: this.timeoutMs,
      rankFallbackTimeoutMs: Math.min(this.timeoutMs, 12000),
      rankFallbackTotalTimeoutMs: Math.max(this.timeoutMs, 30000),
    });
    const nativeRankResult = await collector.collect({
      keyword,
      targetMid: targetPlaceId,
      maxRank,
    });
    return { nativeRankResult };
  }
}
