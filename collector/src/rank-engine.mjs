import { normalizeOrganicItems } from './normalize.mjs';
import { assertRankResult } from './types.mjs';

export function findRankAcrossPages({ targetMid, pages, maxRank = 300, complete = false }) {
  const target = String(targetMid ?? '');
  if (!target) throw new TypeError('targetMid is required');
  if (!Array.isArray(pages)) throw new TypeError('pages must be an array');
  if (!Number.isInteger(maxRank) || maxRank < 1 || maxRank > 300) {
    throw new TypeError('maxRank must be an integer from 1 to 300');
  }

  let itemsScanned = 0;
  let pagesScanned = 0;

  for (const page of pages) {
    pagesScanned += 1;
    const organic = normalizeOrganicItems(page);
    for (const item of organic) {
      if (itemsScanned >= maxRank) break;
      itemsScanned += 1;
      if (item.mid === target) {
        return assertRankResult({
          status: 'FOUND',
          rank: itemsScanned,
          pagesScanned,
          itemsScanned,
          matchedMid: item.mid,
        });
      }
    }
    if (itemsScanned >= maxRank) break;
  }

  const pageCapacityReached = pages.length >= Math.ceil(maxRank / 50);
  if (!(complete || itemsScanned >= maxRank || pageCapacityReached)) {
    throw new Error('incomplete traversal: target was not found before the collection ended');
  }

  return assertRankResult({
    status: 'OUT_OF_RANGE',
    rank: null,
    pagesScanned,
    itemsScanned,
    matchedMid: null,
  });
}
