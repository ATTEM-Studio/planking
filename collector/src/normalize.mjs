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

export function extractFirstPageItems(payload) {
  const list = payload?.result?.place?.list;
  return Array.isArray(list) ? list : [];
}

export function extractGraphqlItems(payload) {
  return findItems(payload) ?? [];
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
