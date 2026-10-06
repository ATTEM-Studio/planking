export function detectBlockedText(text = '') {
  return /(captcha|비정상적인\s*접근|자동입력\s*방지|접근이\s*제한|보안\s*확인)/i.test(String(text));
}

function placeIdOf(item = {}) {
  const value = item.placeId ?? item.id ?? item.mid ?? item.businessId ?? '';
  return String(value).trim();
}

function isAdItem(item = {}) {
  if (item.isAd === true || item.ad === true) return true;
  const marker = `${item.type ?? ''} ${item.badge ?? ''} ${item.label ?? ''}`;
  return /(^|\s)(ad|광고)(\s|$)/i.test(marker);
}

export function normalizePlaceItems(rawItems = [], maxRank = 300) {
  const seen = new Set();
  const organic = [];
  for (const item of Array.isArray(rawItems) ? rawItems : []) {
    if (!item || isAdItem(item)) continue;
    const placeId = placeIdOf(item);
    if (!placeId || seen.has(placeId)) continue;
    seen.add(placeId);
    organic.push({ placeId, name: String(item.name ?? item.title ?? '').trim(), rank: organic.length + 1 });
    if (organic.length >= maxRank) break;
  }
  return organic;
}

export function extractApolloCandidates(state = {}) {
  const candidates = [];
  const seen = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const id = node.id ?? node.placeId ?? node.mid;
    const name = node.name ?? node.title;
    if (id != null && name && !seen.has(String(id))) {
      seen.add(String(id));
      candidates.push({ id: String(id), name: String(name), isAd: Boolean(node.isAd || node.ad) });
    }
  };
  const root = state.ROOT_QUERY ?? {};
  for (const value of Object.values(root)) {
    const groups = [value?.businesses?.items, value?.items, value?.places?.items];
    for (const group of groups) {
      if (!Array.isArray(group)) continue;
      for (const ref of group) visit(ref?.__ref ? state[ref.__ref] : ref);
    }
  }
  if (!candidates.length) for (const node of Object.values(state)) visit(node);
  return candidates;
}
