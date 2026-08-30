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

export function filterHistoryWindow(history, window = '30') {
  const rows = Array.isArray(history) ? history : [];
  if (window === 'all' || rows.length === 0) return [...rows];
  const days = Number(window);
  if (!Number.isFinite(days) || days <= 0) return [...rows];

  const newest = new Date(`${rows[0].measured_date}T00:00:00Z`);
  if (Number.isNaN(newest.getTime())) return [...rows];
  const cutoff = new Date(newest);
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  return rows.filter((row) => {
    const date = new Date(`${row.measured_date}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date >= cutoff && date <= newest;
  });
}

export function buildRankChartPoints(history, width = 760, height = 260) {
  const rows = [...(Array.isArray(history) ? history : [])].sort((a, b) =>
    String(a.measured_date).localeCompare(String(b.measured_date))
  );
  if (!rows.length) return [];
  const padX = 34;
  const padY = 24;
  const usableWidth = Math.max(1, width - padX * 2);
  const usableHeight = Math.max(1, height - padY * 2);
  return rows.map((row, index) => {
    const value = row?.status === 'OUT_OF_RANGE' ? 301 : Math.min(300, Math.max(1, Number(row?.rank) || 300));
    const x = rows.length === 1 ? width / 2 : padX + (usableWidth * index) / (rows.length - 1);
    const y = padY + ((value - 1) / 300) * usableHeight;
    return {
      x,
      y,
      value,
      date: row.measured_date,
      display: row?.status === 'OUT_OF_RANGE' ? '300+' : `${row.rank}위`,
      status: row.status,
    };
  });
}

export function historySummary(history) {
  const rows = Array.isArray(history) ? history : [];
  const found = rows.filter((row) => row?.status === 'FOUND' && Number.isInteger(row.rank));
  const bestRank = found.length ? Math.min(...found.map((row) => row.rank)) : null;
  return {
    latest: formatRankResult(rows[0] || null),
    best: bestRank === null ? '—' : `${bestRank}위`,
    count: rows.length,
    delta: rankDelta(rows),
  };
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
