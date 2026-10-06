export function presentRank(result) {
  if (!result) return { label: '데이터 없음', tone: 'muted', observed: false };
  if (result.status === 'FOUND' && Number.isFinite(Number(result.rank))) return { label: `${Number(result.rank)}위`, tone: 'good', observed: true };
  if (result.status === 'OUT_OF_RANGE') return { label: `${Number(result.maxRank ?? 100)}위 밖`, tone: 'muted', observed: true };
  if (result.status === 'BLOCKED') return { label: '수집 차단', tone: 'bad', observed: false };
  if (result.status === 'TIMEOUT') return { label: '수집 시간 초과', tone: 'warn', observed: false };
  if (result.status === 'PARSE_ERROR') return { label: '수집 확인 필요', tone: 'warn', observed: false };
  return { label: '수집 실패', tone: 'bad', observed: false };
}
export function rankDelta(current, previous) {
  if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(previous))) return { value: null, direction: 'unknown', label: '—' };
  const value = Number(previous) - Number(current);
  if (value > 0) return { value, direction: 'up', label: `▲ ${value}` };
  if (value < 0) return { value, direction: 'down', label: `▼ ${Math.abs(value)}` };
  return { value: 0, direction: 'flat', label: '─' };
}
export function summarizeKeywords(rows = []) {
  const ranks = rows.filter((row) => row?.status === 'FOUND' && Number.isFinite(Number(row.rank))).map((row) => Number(row.rank));
  return { top3: ranks.filter((rank) => rank <= 3).length, top10: ranks.filter((rank) => rank <= 10).length, top20: ranks.filter((rank) => rank <= 20).length };
}
