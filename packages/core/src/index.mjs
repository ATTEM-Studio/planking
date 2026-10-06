export const RANK_STATUSES = Object.freeze([
  'FOUND',
  'OUT_OF_RANGE',
  'BLOCKED',
  'TIMEOUT',
  'PARSE_ERROR',
  'FAILED',
]);

const FAILURE_STATUSES = new Set(['BLOCKED', 'TIMEOUT', 'PARSE_ERROR', 'FAILED']);

export function normalizeRankResult(input = {}) {
  const status = String(input.status ?? '').trim();
  if (!RANK_STATUSES.includes(status)) {
    throw new TypeError(`Unknown rank status: ${status || '(empty)'}`);
  }

  const rank = input.rank == null ? null : Number(input.rank);
  const maxRank = Number.isFinite(Number(input.maxRank)) ? Number(input.maxRank) : 100;
  const itemsScanned = Number.isFinite(Number(input.itemsScanned)) ? Number(input.itemsScanned) : 0;
  const pagesScanned = Number.isFinite(Number(input.pagesScanned)) ? Number(input.pagesScanned) : 0;

  if (status === 'FOUND' && (!Number.isInteger(rank) || rank < 1)) {
    throw new TypeError('FOUND requires a positive integer rank');
  }

  if (status === 'OUT_OF_RANGE' && rank !== null) {
    throw new TypeError('OUT_OF_RANGE must not include a numeric rank');
  }

  if (FAILURE_STATUSES.has(status) && rank !== null) {
    throw new TypeError(`${status} must not include a numeric rank`);
  }

  return Object.freeze({
    status,
    rank,
    maxRank,
    itemsScanned,
    pagesScanned,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
  });
}

export function rankLabel(result) {
  const normalized = normalizeRankResult(result);
  if (normalized.status === 'FOUND') return `${normalized.rank}위`;
  if (normalized.status === 'OUT_OF_RANGE') return `${normalized.maxRank}위 밖`;
  if (normalized.status === 'BLOCKED') return '수집 차단';
  if (normalized.status === 'TIMEOUT') return '수집 시간 초과';
  if (normalized.status === 'PARSE_ERROR') return '수집 구조 확인 필요';
  return '수집 실패';
}

export function isObservedRankStatus(status) {
  return status === 'FOUND' || status === 'OUT_OF_RANGE';
}
