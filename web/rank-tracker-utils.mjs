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

export function groupSlotsByCompany(slots) {
  const groups = [];
  const byMid = new Map();

  for (const slot of Array.isArray(slots) ? slots : []) {
    const targetMid = String(slot?.targetMid ?? slot?.target_mid ?? '').trim();
    const fallbackKey = `slot:${String(slot?.id ?? groups.length)}`;
    const key = targetMid || fallbackKey;
    let group = byMid.get(key);

    if (!group) {
      group = {
        targetMid,
        placeName: String(slot?.placeName ?? '').trim(),
        placeMetrics: Array.isArray(slot?.placeMetrics) ? slot.placeMetrics : [],
        slots: [],
      };
      byMid.set(key, group);
      groups.push(group);
    } else {
      const placeName = String(slot?.placeName ?? '').trim();
      if (!group.placeName && placeName) group.placeName = placeName;
      const candidateMetrics = Array.isArray(slot?.placeMetrics) ? slot.placeMetrics : [];
      if (candidateMetrics.length > group.placeMetrics.length) group.placeMetrics = candidateMetrics;
    }

    group.slots.push(slot);
  }

  return groups;
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

function elapsedLabel(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds) / 1000));
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}시간 ${remainder}분` : `${hours}시간`;
}

export function jobProgress(job, { now = new Date(), queuePosition = null } = {}) {
  const status = String(job?.status ?? '');
  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(nowDate.getTime())) return null;

  if (status === 'PENDING') {
    const requestedAt = new Date(job?.requested_at ?? '');
    if (Number.isNaN(requestedAt.getTime())) return null;
    const elapsedMs = Math.max(0, nowDate.getTime() - requestedAt.getTime());
    const stale = elapsedMs >= 15 * 60 * 1000;
    const queue = Number.isInteger(queuePosition) && queuePosition > 0 ? ` · 대기열 ${queuePosition}번째` : '';
    return {
      tone: stale ? 'stale' : 'waiting',
      title: stale ? '처리 지연 감지' : '수집 대기 중',
      detail: `대기 ${elapsedLabel(elapsedMs)}${queue}${stale ? ' · Worker 실행 지연' : ''}`,
      stale,
    };
  }

  if (status === 'RUNNING') {
    const startedAt = new Date(job?.started_at ?? job?.requested_at ?? '');
    if (Number.isNaN(startedAt.getTime())) return null;
    const elapsedMs = Math.max(0, nowDate.getTime() - startedAt.getTime());
    const stale = elapsedMs >= 10 * 60 * 1000;
    return {
      tone: stale ? 'stale' : 'running',
      title: stale ? '수집 지연 감지' : '네이버 순위 수집 중',
      detail: `시작 후 ${elapsedLabel(elapsedMs)} · ${stale ? '응답 지연 확인 필요' : '결과 확인 중'}`,
      stale,
    };
  }

  return null;
}

function ensureProgressStyles() {
  if (document.getElementById('rank-progress-live-style')) return;
  const style = document.createElement('style');
  style.id = 'rank-progress-live-style';
  style.textContent = `
    .keyword-progress-live{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:5px;font-size:11px;line-height:1.4;color:#68708a}
    .keyword-progress-live strong{font-size:11px;font-weight:800;color:#4a55d8}
    .keyword-progress-live.is-running strong{color:#167b5a}
    .keyword-progress-live.is-stale{padding:5px 8px;border-radius:8px;background:#fff4e5;color:#9a5a00}
    .keyword-progress-live.is-stale strong{color:#c56a00}
  `;
  document.head.appendChild(style);
}

async function refreshVisibleJobProgress() {
  try {
    const response = await fetch('/api/rank_status', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    const rows = Array.isArray(payload?.slots) ? payload.slots : [];
    const pending = rows
      .filter((slot) => slot?.latestJob?.status === 'PENDING')
      .sort((a, b) => new Date(a.latestJob.requested_at).getTime() - new Date(b.latestJob.requested_at).getTime());
    const positions = new Map(pending.map((slot, index) => [String(slot.latestJob.id), index + 1]));
    const now = new Date();

    for (const slot of rows) {
      const job = slot?.latestJob;
      if (!job || (job.status !== 'PENDING' && job.status !== 'RUNNING')) continue;
      const row = document.querySelector(`.keyword-rank-row[data-slot-id="${CSS.escape(String(slot.id))}"]`);
      const copy = row?.querySelector('.keyword-rank-copy');
      if (!copy) continue;
      const progress = jobProgress(job, { now, queuePosition: positions.get(String(job.id)) ?? null });
      if (!progress) continue;

      let node = copy.querySelector('.keyword-progress-live');
      if (!node) {
        node = document.createElement('span');
        node.className = 'keyword-progress-live';
        copy.appendChild(node);
      }
      node.className = `keyword-progress-live is-${progress.tone}`;
      node.innerHTML = `<strong>${progress.title}</strong><span>${progress.detail}</span>`;
    }
  } catch {
    // The primary dashboard remains authoritative if this progressive enhancement cannot refresh.
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  ensureProgressStyles();
  const boot = () => {
    window.setTimeout(refreshVisibleJobProgress, 400);
    window.setInterval(() => {
      if (!document.hidden) refreshVisibleJobProgress();
    }, 10000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
