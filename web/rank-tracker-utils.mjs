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

function dateOffset(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function metricSnapshotForDate(history, date) {
  const target = String(date ?? '');
  return (Array.isArray(history) ? history : []).find(row => String(row?.measured_date ?? '') === target) ?? null;
}

function hasNumericMetric(value) {
  if (value === undefined || value === null || value === '') return false;
  return Number.isFinite(Number(value));
}

function numericMetricDelta(current, previous, field) {
  const to = current?.[field];
  const from = previous?.[field];
  if (!hasNumericMetric(to) || !hasNumericMetric(from)) return { kind: 'unavailable' };
  return { kind: 'number', delta: Number(to) - Number(from), from: Number(from), to: Number(to) };
}

function rawMetricDelta(current, previous, field) {
  const to = current?.[field];
  const from = previous?.[field];
  if (to === undefined || to === null || from === undefined || from === null || String(to) === '' || String(from) === '') {
    return { kind: 'unavailable' };
  }
  const fromText = String(from);
  const toText = String(to);
  if (fromText === toText) return { kind: 'same', from: fromText, to: toText };
  return { kind: 'changed', from: fromText, to: toText };
}

export function buildMetricWindows(history, today) {
  const todayText = String(today ?? '');
  const current = metricSnapshotForDate(history, todayText);
  const periods = {};
  for (const days of [1, 7, 30]) {
    const comparisonDate = dateOffset(todayText, days);
    const previous = comparisonDate ? metricSnapshotForDate(history, comparisonDate) : null;
    periods[String(days)] = {
      comparisonDate,
      visitorReviews: numericMetricDelta(current, previous, 'visitor_review_count'),
      blogReviews: numericMetricDelta(current, previous, 'blog_review_count'),
      save: rawMetricDelta(current, previous, 'save_count_raw'),
    };
  }
  return { today: todayText, current, periods };
}

export function buildMetricChartPoints(history, field, width = 760, height = 220) {
  if (field === 'save_count_raw') return [];
  const rows = [...(Array.isArray(history) ? history : [])]
    .filter(row => hasNumericMetric(row?.[field]))
    .sort((a, b) => String(a.measured_date).localeCompare(String(b.measured_date)));
  if (!rows.length) return [];
  const values = rows.map(row => Number(row[field]));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padX = 34;
  const padY = 24;
  const usableWidth = Math.max(1, width - padX * 2);
  const usableHeight = Math.max(1, height - padY * 2);
  const span = max - min;
  return rows.map((row, index) => {
    const value = Number(row[field]);
    const x = rows.length === 1 ? width / 2 : padX + (usableWidth * index) / (rows.length - 1);
    const ratio = span === 0 ? 0.5 : (value - min) / span;
    const y = padY + (1 - ratio) * usableHeight;
    return { x, y, value, date: row.measured_date };
  });
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
