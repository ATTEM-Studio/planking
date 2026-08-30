export const RANK_STATUSES = Object.freeze([
  'FOUND', 'OUT_OF_RANGE', 'BLOCKED', 'TIMEOUT', 'FAILED',
]);

export const TERMINAL_JOB_STATUSES = Object.freeze([
  'SUCCESS', 'OUT_OF_RANGE', 'BLOCKED', 'TIMEOUT', 'FAILED',
]);

export const TERMINAL_STATUSES = TERMINAL_JOB_STATUSES;

export function assertRankResult(result) {
  if (!RANK_STATUSES.includes(result?.status)) {
    throw new TypeError(`invalid rank status: ${result?.status}`);
  }
  if (result.status === 'FOUND') {
    if (!Number.isInteger(result.rank) || result.rank < 1 || result.rank > 300) {
      throw new TypeError('FOUND rank must be an integer from 1 to 300');
    }
  } else if (result.rank !== null) {
    throw new TypeError(`${result.status} rank must be null`);
  }
  if (!Number.isInteger(result.pagesScanned) || result.pagesScanned < 0) {
    throw new TypeError('pagesScanned must be a non-negative integer');
  }
  if (!Number.isInteger(result.itemsScanned) || result.itemsScanned < 0) {
    throw new TypeError('itemsScanned must be a non-negative integer');
  }
  return result;
}
