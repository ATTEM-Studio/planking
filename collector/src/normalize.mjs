function findItems(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node.items)) return node.items;
  if (Array.isArray(node)) {
    for (const value of node) {
      const found = findItems(value);
      if (found) return found;
    }
    return null;
  }
  for (const value of Object.values(node)) {
    const found = findItems(value);
    if (found) return found;
  }
  return null;
}

function isExplicitAd(item) {
  if (!item || typeof item !== 'object') return false;
  for (const key of ['isAd', 'ad', 'advertisement', 'isAdvertisement', 'promotion']) {
    if (item[key]) return true;
  }
  return typeof item.type === 'string' && ['ad', 'advertisement'].includes(item.type.toLowerCase());
}

function nullableCount(value) {
  if (value === undefined || value === null || value === '') return null;
  if (Number.isInteger(value) && value >= 0) return value;
  const normalized = String(value).replace(/,/g, '').trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function nullableRaw(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

export function extractFirstPageItems(payload) {
  const list = payload?.result?.place?.list;
  return Array.isArray(list) ? list : [];
}

export function extractGraphqlItems(payload) {
  return findItems(payload) ?? [];
}

export function extractPlaceMetrics(rawItem) {
  const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
  return {
    visitorReviewCount: nullableCount(item.visitorReviewCount ?? item.visitor_review_count),
    blogReviewCount: nullableCount(item.blogCafeReviewCount ?? item.blogReviewCount ?? item.blog_review_count),
    saveCountRaw: nullableRaw(item.saveCount ?? item.save_count ?? item.saveCountRaw),
  };
}

export function normalizeOrganicItems(items) {
  if (!Array.isArray(items)) return [];
  const organic = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || isExplicitAd(item)) continue;
    const rawMid = item.mid ?? item.id ?? item.placeId ?? item.place_id;
    if (rawMid === undefined || rawMid === null || String(rawMid).trim() === '') continue;
    organic.push({
      mid: String(rawMid),
      name: String(item.name ?? item.placeName ?? item.place_name ?? ''),
      raw: item,
    });
  }
  return organic;
}
