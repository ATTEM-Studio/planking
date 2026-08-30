export function parseTargetMid(value) {
  const text = String(value ?? '').trim();
  if (/^\d{5,}$/.test(text)) return text;
  const match = text.match(/\/(?:place|restaurant|cafe)\/(\d{5,})(?:[/?#]|$)/i);
  return match ? match[1] : '';
}

export function formatRankResult(entry) {
  if (!entry) return '—';
  if (entry.status === 'FOUND' && Number.isInteger(entry.rank)) return `${entry.rank}위`;
  if (entry.status === 'OUT_OF_RANGE') return '300+';
  return '—';
}

export function rankDelta(history) {
  const found = (Array.isArray(history) ? history : [])
    .filter((row) => row?.status === 'FOUND' && Number.isInteger(row.rank))
    .slice(0, 2);
  if (found.length < 2) return null;
  const diff = found[1].rank - found[0].rank;
  if (diff === 0) return { direction: 'same', amount: 0 };
  return { direction: diff > 0 ? 'up' : 'down', amount: Math.abs(diff) };
}

export function jobLabel(status) {
  return ({
    PENDING: '조회 대기',
    RUNNING: '조회 중',
    SUCCESS: '정상 완료',
    OUT_OF_RANGE: '300위 밖',
    INCOMPLETE: '조회 불완전',
    BLOCKED: '조회 제한',
    TIMEOUT: '조회 지연',
    FAILED: '조회 실패',
  })[status] || '대기';
}
