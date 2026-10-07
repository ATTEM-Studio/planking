export function presentRank(result) {
  if (!result) return { label: '데이터 없음', tone: 'muted', observed: false, description: '아직 측정된 순위가 없습니다' };
  if (result.status === 'FOUND' && Number.isFinite(Number(result.rank))) return { label: `${Number(result.rank)}위`, tone: 'good', observed: true, description: `현재 순위 ${Number(result.rank)}위` };
  if (result.status === 'OUT_OF_RANGE') return { label: `${Number(result.maxRank ?? 100)}위 밖`, tone: 'muted', observed: true, description: `현재 순위가 TOP ${Number(result.maxRank ?? 100)} 밖입니다` };
  if (result.status === 'BLOCKED') return { label: '수집 차단', tone: 'bad', observed: false, description: '수집이 차단되어 순위를 확인할 수 없습니다' };
  if (result.status === 'TIMEOUT') return { label: '수집 시간 초과', tone: 'warn', observed: false, description: '수집 시간이 초과되어 순위를 확인할 수 없습니다' };
  if (result.status === 'PARSE_ERROR') return { label: '수집 확인 필요', tone: 'warn', observed: false, description: '수집 결과를 확인할 수 없습니다' };
  return { label: '수집 실패', tone: 'bad', observed: false, description: '수집에 실패해 순위를 확인할 수 없습니다' };
}
export function rankDelta(current, previous) {
  if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(previous))) return { value: null, direction: 'unknown', label: '—', description: '비교할 측정값이 없습니다' };
  const value = Number(previous) - Number(current);
  if (value > 0) return { value, direction: 'up', label: `▲ ${value}`, description: `직전 측정 대비 ${value}위 상승` };
  if (value < 0) return { value, direction: 'down', label: `▼ ${Math.abs(value)}`, description: `직전 측정 대비 ${Math.abs(value)}위 하락` };
  return { value: 0, direction: 'flat', label: '─', description: '직전 측정과 순위가 같습니다' };
}
export function summarizeKeywords(rows = []) {
  const ranks = rows.filter((row) => row?.status === 'FOUND' && Number.isFinite(Number(row.rank))).map((row) => Number(row.rank));
  return { top3: ranks.filter((rank) => rank <= 3).length, top10: ranks.filter((rank) => rank <= 10).length, top20: ranks.filter((rank) => rank <= 20).length };
}
