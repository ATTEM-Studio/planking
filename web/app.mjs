import {
  buildMetricChartPoints,
  buildMetricWindows,
  buildRankChartPoints,
  formatRankResult,
  historySummary,
  jobLabel,
  metricSnapshotForDate,
  parseTargetMid,
  rankDelta,
} from './rank-tracker-utils.mjs';

const $ = (id) => document.getElementById(id);
const pendingStatuses = new Set(['PENDING', 'RUNNING']);
const issueStatuses = new Set(['INCOMPLETE', 'BLOCKED', 'TIMEOUT', 'FAILED']);
const metricPeriodBySlot = new Map();
let slots = [];
let refreshTimer = null;
let activeDetail = null;
let activeWindow = '30';
let deleteTarget = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function kstToday() {
  // PLANKING의 측정일은 매일 14:00 KST(05:00 UTC)에 바뀝니다.
  return new Date(Date.now() - (5 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function setFormStatus(message = '', error = false) {
  const node = $('formStatus');
  node.textContent = message;
  node.classList.toggle('is-error', error);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', timeZone: 'UTC' }).format(date);
}

function formatFullDate(value) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).format(date);
}

function formatTime(value) {
  if (!value) return '측정 전';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '측정 전';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function formatNumber(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('ko-KR').format(Number(value));
}

function statusTone(status) {
  if (issueStatuses.has(status)) return 'issue';
  if (pendingStatuses.has(status)) return 'waiting';
  return 'good';
}

function deltaMarkup(history) {
  const delta = rankDelta(history);
  if (!delta) return '<span class="rank-delta neutral">변동 데이터 없음</span>';
  if (delta.direction === 'same') return '<span class="rank-delta neutral">변동 없음</span>';
  const arrow = delta.direction === 'up' ? '↑' : '↓';
  return `<span class="rank-delta ${delta.direction}">${arrow} ${delta.amount}</span>`;
}

function historyMarkup(history = []) {
  if (!history.length) return '<div class="history-empty">첫 측정이 완료되면 날짜별 순위 이력이 표시됩니다.</div>';
  return `
    <div class="history-strip">
      ${history.slice(0, 7).map((row) => `
        <div class="history-day">
          <span>${escapeHtml(formatDate(row.measured_date))}</span>
          <strong>${escapeHtml(formatRankResult(row))}</strong>
        </div>`).join('')}
    </div>`;
}

function metricPeriodTabsMarkup(activePeriod) {
  return `
    <div class="metric-period-tabs" role="group" aria-label="플레이스 지표 비교 기간">
      <button type="button" data-metric-period="1" class="${activePeriod === '1' ? 'is-active' : ''}">1일</button>
      <button type="button" data-metric-period="7" class="${activePeriod === '7' ? 'is-active' : ''}">7일</button>
      <button type="button" data-metric-period="30" class="${activePeriod === '30' ? 'is-active' : ''}">30일</button>
    </div>`;
}

function numericChangeMarkup(change) {
  if (!change || change.kind !== 'number') return '<span class="metric-change">—</span>';
  if (change.delta === 0) return '<span class="metric-change">변동 없음</span>';
  const positive = change.delta > 0;
  return `<span class="metric-change ${positive ? 'positive' : 'negative'}">${positive ? '+' : ''}${escapeHtml(formatNumber(change.delta))}</span>`;
}

function saveChangeMarkup(change) {
  if (!change || change.kind === 'unavailable') return '<span class="metric-change">—</span>';
  if (change.kind === 'same') return '<span class="metric-change">변동 없음</span>';
  return `<span class="metric-change raw-change">${escapeHtml(change.from)} → ${escapeHtml(change.to)}</span>`;
}

function metricPanelMarkup(slot) {
  const period = metricPeriodBySlot.get(slot.id) || '1';
  const windows = buildMetricWindows(slot.placeMetrics || [], kstToday());
  const current = windows.current;
  const changes = windows.periods[period];

  return `
    <section class="place-metrics-panel" aria-label="플레이스 지표 변화">
      <div class="place-metrics-head">
        <div><span>오늘 기준</span><strong>플레이스 지표 변화</strong></div>
        ${metricPeriodTabsMarkup(period)}
      </div>
      ${current ? `
        <div class="place-metric-grid">
          <div class="place-metric-item">
            <span>영수증 리뷰</span>
            <strong>${escapeHtml(formatNumber(current.visitor_review_count))}</strong>
            ${numericChangeMarkup(changes?.visitorReviews)}
          </div>
          <div class="place-metric-item">
            <span>블로그 리뷰</span>
            <strong>${escapeHtml(formatNumber(current.blog_review_count))}</strong>
            ${numericChangeMarkup(changes?.blogReviews)}
          </div>
          <div class="place-metric-item">
            <span>저장</span>
            <strong>${escapeHtml(current.save_count_raw ?? '—')}</strong>
            ${saveChangeMarkup(changes?.save)}
          </div>
        </div>` : '<div class="metrics-unavailable">오늘 플레이스 지표는 아직 수집되지 않았습니다.</div>'}
    </section>`;
}

function slotMarkup(slot, index = 0) {
  const history = Array.isArray(slot.history) ? slot.history : [];
  const latest = history[0] || null;
  const job = slot.latestJob || null;
  const status = job?.status || (latest?.status === 'OUT_OF_RANGE' ? 'OUT_OF_RANGE' : latest ? 'SUCCESS' : 'PENDING');
  const busy = pendingStatuses.has(status);
  const latestMeasuredAt = latest?.measured_at || job?.finished_at || job?.started_at || job?.requested_at;
  const placeLabel = slot.placeName || `MID ${slot.targetMid}`;

  return `
    <article class="slot-card is-clickable" style="--card-index:${index}" data-slot-id="${escapeHtml(slot.id)}" role="button" tabindex="0" aria-label="${escapeHtml(slot.keyword)} 누적 변화 보기">
      <div class="slot-card-head">
        <div class="slot-identity">
          <div class="slot-keyword-row">
            <span class="keyword-chip">${escapeHtml(slot.keyword)}</span>
            <span class="status-chip ${statusTone(status)}"><i></i>${escapeHtml(jobLabel(status))}</span>
          </div>
          <h3>${escapeHtml(placeLabel)}</h3>
          <p>MID ${escapeHtml(slot.targetMid)}</p>
        </div>
        <div class="rank-now">
          <span>현재 순위</span>
          <strong>${escapeHtml(formatRankResult(latest))}</strong>
          ${deltaMarkup(history)}
        </div>
      </div>

      ${metricPanelMarkup(slot)}

      <div class="slot-meta">
        <span><b>최근 측정</b>${escapeHtml(formatTime(latestMeasuredAt))}</span>
        <span><b>순위 기록</b>${history.length}일</span>
        <span class="history-hint">상세 그래프 →</span>
        <button class="button button-mini recheck-button" type="button" data-slot-id="${escapeHtml(slot.id)}" ${busy ? 'disabled' : ''}>${busy ? '조회 중…' : '다시 조회'}</button>
        <button class="button button-mini delete-button" type="button" data-slot-id="${escapeHtml(slot.id)}" ${busy ? 'disabled' : ''}>삭제</button>
      </div>

      ${historyMarkup(history)}
      ${issueStatuses.has(status) ? `<p class="issue-copy">최근 조회가 완료되지 않았습니다. 기존 정상 순위와 플레이스 지표 기록은 유지됩니다.${job?.error_code ? ` · ${escapeHtml(job.error_code)}` : ''}</p>` : ''}
    </article>`;
}

function renderMetrics() {
  $('metricTotal').textContent = slots.length;
  $('metricMeasured').textContent = slots.filter((slot) => (slot.history || []).length > 0).length;
  $('metricPending').textContent = slots.filter((slot) => pendingStatuses.has(slot.latestJob?.status)).length;
  $('metricIssues').textContent = slots.filter((slot) => issueStatuses.has(slot.latestJob?.status)).length;
}

function bindSlotInteractions() {
  document.querySelectorAll('.slot-card').forEach((card) => {
    const open = () => openHistory(card.dataset.slotId);
    card.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      open();
    });
    card.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button')) {
        event.preventDefault();
        open();
      }
    });
  });

  document.querySelectorAll('[data-metric-period]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const card = button.closest('.slot-card');
      if (!card) return;
      metricPeriodBySlot.set(card.dataset.slotId, button.dataset.metricPeriod);
      renderSlots();
    });
  });

  document.querySelectorAll('.recheck-button').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const slot = slots.find((row) => row.id === button.dataset.slotId);
      if (!slot) return;
      try {
        await queueRankRequest(slot.keyword, slot.targetMid, slot.placeName, button);
      } catch (error) {
        setFormStatus(error.message || '재조회 요청에 실패했습니다.', true);
      }
    });
  });

  document.querySelectorAll('.delete-button').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const slot = slots.find((row) => row.id === button.dataset.slotId);
      if (slot) openDeleteModal(slot);
    });
  });
}

function renderSlots() {
  $('loadingState').classList.add('is-hidden');
  $('errorState').classList.add('is-hidden');
  $('emptyState').classList.toggle('is-hidden', slots.length !== 0);
  $('slotGrid').innerHTML = slots.map(slotMarkup).join('');
  renderMetrics();
  bindSlotInteractions();
  scheduleAutoRefresh();
}

function scheduleAutoRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  const hasActiveJob = slots.some((slot) => pendingStatuses.has(slot.latestJob?.status));
  if (!hasActiveJob) return;
  refreshTimer = setTimeout(() => {
    if (!document.hidden) refreshSlots({ silent: true });
  }, 12000);
}

async function refreshSlots({ silent = false } = {}) {
  if (!silent) {
    $('loadingState').classList.remove('is-hidden');
    $('errorState').classList.add('is-hidden');
  }
  try {
    const response = await fetch('/api/rank_status', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '순위 현황을 불러오지 못했습니다.');
    slots = Array.isArray(data.slots) ? data.slots : [];
    renderSlots();
  } catch (error) {
    if (!silent) {
      $('loadingState').classList.add('is-hidden');
      $('slotGrid').innerHTML = '';
      $('errorState').classList.remove('is-hidden');
      $('errorMessage').textContent = error.message || '잠시 후 다시 시도해 주세요.';
    }
  }
}

async function runInstantCollection(jobId) {
  const response = await fetch('/api/rank_collect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId }),
  });
  const data = await response.json();
  if (response.status === 409) return { claimedElsewhere: true, data };
  if (!response.ok) throw new Error(data.error || '즉시 조회에 실패했습니다.');
  return { claimedElsewhere: false, data };
}

async function queueRankRequest(keyword, targetMid, placeName, button = null) {
  const idleLabel = button?.classList?.contains('recheck-button') ? '다시 조회' : '추적 시작';
  if (button) {
    button.disabled = true;
    button.textContent = '요청 중…';
  }
  try {
    const response = await fetch('/api/rank_request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, targetPlaceId: targetMid, placeName: placeName || undefined }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '순위 조회 요청에 실패했습니다.');

    if (button) button.textContent = '즉시 조회 중…';
    setFormStatus('즉시 조회 중입니다. 첫 결과를 확인하고 있습니다.');
    await refreshSlots({ silent: true });

    let instant;
    try {
      instant = await runInstantCollection(data.jobId);
    } catch (error) {
      setFormStatus('즉시 조회가 지연되고 있습니다. 등록은 완료되었으며 예약 수집기가 이어서 처리합니다.', true);
      await refreshSlots({ silent: true });
      return data;
    }

    await refreshSlots({ silent: true });
    if (instant.claimedElsewhere) {
      setFormStatus('이미 다른 수집기가 조회를 시작했습니다. 결과가 들어오는 즉시 화면에 반영됩니다.');
    } else if (['FOUND', 'OUT_OF_RANGE'].includes(instant.data?.result?.status)) {
      setFormStatus('첫 조회가 완료되었습니다. 이후 매일 오후 2시(KST)에 자동 측정됩니다.');
    } else {
      setFormStatus('첫 조회가 완료되지 않았습니다. 현재 상태를 확인해 주세요.', true);
    }
    return data;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = idleLabel;
    }
  }
}

function filterRowsFromToday(rows, window) {
  const source = Array.isArray(rows) ? rows : [];
  if (window === 'all') return [...source];
  const days = Number(window);
  if (!Number.isFinite(days) || days <= 0) return [...source];
  const end = new Date(`${kstToday()}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return source.filter(row => {
    const date = new Date(`${row?.measured_date}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date >= start && date <= end;
  });
}

function renderRankChart(history) {
  const chart = $('historyRankChart');
  if (!history.length) {
    chart.innerHTML = '<div class="chart-empty">선택한 기간에 순위 기록이 없습니다.</div>';
    return;
  }
  const width = 760;
  const height = 250;
  const points = buildRankChartPoints(history, width, height);
  const polyline = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const labelStep = Math.max(1, Math.ceil(points.length / 5));
  chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="누적 순위 변화 그래프">
      <g class="chart-grid">
        <line x1="34" y1="24" x2="726" y2="24"></line>
        <line x1="34" y1="91" x2="726" y2="91"></line>
        <line x1="34" y1="158" x2="726" y2="158"></line>
        <line x1="34" y1="226" x2="726" y2="226"></line>
      </g>
      <polyline class="rank-line" points="${polyline}"></polyline>
      ${points.map((point, index) => `
        <g class="rank-point-group">
          <circle class="rank-point ${point.status === 'OUT_OF_RANGE' ? 'out' : ''}" cx="${point.x}" cy="${point.y}" r="4.5"><title>${escapeHtml(point.date)} · ${escapeHtml(point.display)}</title></circle>
          ${(index % labelStep === 0 || index === points.length - 1) ? `<text x="${point.x}" y="244" text-anchor="middle">${escapeHtml(formatDate(point.date))}</text>` : ''}
        </g>`).join('')}
    </svg>`;
}

function renderNumericMetricChart(rows, field, targetId, label) {
  const chart = $(targetId);
  const width = 760;
  const height = 205;
  const points = buildMetricChartPoints(rows, field, width, height);
  if (!points.length) {
    chart.innerHTML = `<div class="chart-empty">선택한 기간에 ${escapeHtml(label)} 기록이 없습니다.</div>`;
    return;
  }
  const polyline = points.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const labelStep = Math.max(1, Math.ceil(points.length / 5));
  chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)} 변화 그래프">
      <g>
        <line class="metric-grid" x1="34" y1="28" x2="726" y2="28"></line>
        <line class="metric-grid" x1="34" y1="102" x2="726" y2="102"></line>
        <line class="metric-grid" x1="34" y1="176" x2="726" y2="176"></line>
      </g>
      <polyline class="metric-line" points="${polyline}"></polyline>
      ${points.map((point, index) => `
        <g class="metric-point-group">
          <circle class="metric-point" cx="${point.x}" cy="${point.y}" r="4.2"><title>${escapeHtml(point.date)} · ${escapeHtml(formatNumber(point.value))}</title></circle>
          ${(index === 0 || index === points.length - 1) ? `<text class="metric-chart-value" x="${point.x}" y="${Math.max(15, point.y - 10)}" text-anchor="middle">${escapeHtml(formatNumber(point.value))}</text>` : ''}
          ${(index % labelStep === 0 || index === points.length - 1) ? `<text x="${point.x}" y="199" text-anchor="middle">${escapeHtml(formatDate(point.date))}</text>` : ''}
        </g>`).join('')}
    </svg>`;
}

function renderSaveTimeline(rows) {
  const chart = $('historySaveChart');
  const available = [...rows]
    .filter(row => row?.save_count_raw !== undefined && row?.save_count_raw !== null && String(row.save_count_raw) !== '')
    .sort((a, b) => String(a.measured_date).localeCompare(String(b.measured_date)));
  if (!available.length) {
    chart.innerHTML = '<div class="chart-empty">선택한 기간에 저장 기록이 없습니다.</div>';
    return;
  }
  const compact = available.length > 10
    ? available.filter((_, index) => index === 0 || index === available.length - 1 || index % Math.ceil(available.length / 8) === 0)
    : available;
  chart.innerHTML = `
    <div class="save-timeline" role="img" aria-label="저장 구간값 변화 타임라인">
      <div class="save-timeline-track">
        ${compact.map(row => `
          <div class="save-node">
            <div class="save-node-dot" aria-hidden="true"></div>
            <strong title="${escapeHtml(row.save_count_raw)}">${escapeHtml(row.save_count_raw)}</strong>
            <span>${escapeHtml(formatDate(row.measured_date))}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

function renderHistoryDetail() {
  if (!activeDetail) return;
  const rankRows = filterRowsFromToday(activeDetail.history || [], activeWindow);
  const metricRows = filterRowsFromToday(activeDetail.placeMetrics || [], activeWindow);
  const summary = historySummary(rankRows);
  const todayMetric = metricSnapshotForDate(activeDetail.placeMetrics || [], kstToday());

  $('historyLatest').textContent = summary.latest;
  $('historyVisitorLatest').textContent = formatNumber(todayMetric?.visitor_review_count);
  $('historyBlogLatest').textContent = formatNumber(todayMetric?.blog_review_count);
  $('historySaveLatest').textContent = todayMetric?.save_count_raw ?? '—';

  document.querySelectorAll('[data-history-window]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.historyWindow === activeWindow);
  });

  renderRankChart(rankRows);
  renderNumericMetricChart(metricRows, 'visitor_review_count', 'historyVisitorChart', '영수증 리뷰');
  renderNumericMetricChart(metricRows, 'blog_review_count', 'historyBlogChart', '블로그 리뷰');
  renderSaveTimeline(metricRows);

  $('historyTableBody').innerHTML = rankRows.length ? rankRows.map((row) => `
    <tr>
      <td>${escapeHtml(formatFullDate(row.measured_date))}</td>
      <td><strong>${escapeHtml(formatRankResult(row))}</strong></td>
      <td>${row.status === 'OUT_OF_RANGE' ? '300위 밖' : '정상 측정'}</td>
      <td>${escapeHtml(formatTime(row.measured_at))}</td>
    </tr>`).join('') : '<tr><td colspan="4" class="table-empty">선택한 기간에 순위 기록이 없습니다.</td></tr>';
}

async function openHistory(slotId) {
  const slot = slots.find((row) => row.id === slotId);
  if (!slot) return;
  activeDetail = null;
  activeWindow = '30';
  $('historyTitle').textContent = `${slot.keyword} 누적 변화`;
  $('historySubtitle').textContent = `${slot.placeName || `MID ${slot.targetMid}`} · 전체 기록을 불러오는 중`;
  $('historyLoading').textContent = '순위와 플레이스 지표를 불러오는 중입니다.';
  $('historyLoading').classList.remove('is-hidden');
  $('historyContent').classList.add('is-hidden');
  $('historyModal').classList.remove('is-hidden');
  document.body.classList.add('modal-open');

  try {
    const response = await fetch(`/api/rank_manage?slotId=${encodeURIComponent(slotId)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '누적 데이터를 불러오지 못했습니다.');
    activeDetail = data;
    $('historyTitle').textContent = `${data.keyword} 누적 변화`;
    $('historySubtitle').textContent = `${data.placeName || `MID ${data.targetMid}`} · MID ${data.targetMid}`;
    $('historyLoading').classList.add('is-hidden');
    $('historyContent').classList.remove('is-hidden');
    const busy = pendingStatuses.has(slot.latestJob?.status);
    $('historyDeleteButton').disabled = busy;
    $('historyDeleteButton').textContent = busy ? '조회 중 삭제 불가' : '키워드 삭제';
    renderHistoryDetail();
  } catch (error) {
    $('historyLoading').textContent = error.message || '누적 데이터를 불러오지 못했습니다.';
  }
}

function closeHistoryModal() {
  $('historyModal').classList.add('is-hidden');
  activeDetail = null;
  if ($('deleteModal').classList.contains('is-hidden')) document.body.classList.remove('modal-open');
}

function openDeleteModal(slot) {
  if (pendingStatuses.has(slot.latestJob?.status)) return;
  deleteTarget = slot;
  $('deleteDescription').innerHTML = '삭제하면 등록 키워드와 누적 순위 기록, 조회 작업 이력이 모두 삭제되며 <strong>복구할 수 없습니다.</strong>';
  $('deleteTargetLabel').textContent = `${slot.keyword} · ${slot.placeName || `MID ${slot.targetMid}`}`;
  $('deleteModal').classList.remove('is-hidden');
  document.body.classList.add('modal-open');
}

function closeDeleteModal() {
  $('deleteModal').classList.add('is-hidden');
  deleteTarget = null;
  if ($('historyModal').classList.contains('is-hidden')) document.body.classList.remove('modal-open');
}

async function confirmPermanentDelete() {
  if (!deleteTarget) return;
  const button = $('deleteConfirmButton');
  const target = deleteTarget;
  button.disabled = true;
  button.textContent = '삭제 중…';
  try {
    const response = await fetch(`/api/rank_manage?slotId=${encodeURIComponent(target.id)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '키워드 삭제에 실패했습니다.');
    closeDeleteModal();
    closeHistoryModal();
    setFormStatus(`'${target.keyword}' 키워드와 누적 기록을 영구 삭제했습니다.`);
    await refreshSlots({ silent: true });
  } catch (error) {
    $('deleteDescription').textContent = error.message || '삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  } finally {
    button.disabled = false;
    button.textContent = '영구 삭제';
  }
}

$('rankForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const keyword = $('keywordInput').value.trim();
  const targetMid = parseTargetMid($('midInput').value);
  const placeName = $('placeNameInput').value.trim();
  if (!keyword) return setFormStatus('키워드를 입력해 주세요.', true);
  if (!targetMid) return setFormStatus('올바른 플레이스 MID 또는 네이버 플레이스 URL을 입력해 주세요.', true);

  const submit = $('submitButton');
  submit.disabled = true;
  submit.textContent = '등록 중…';
  setFormStatus('순위 추적을 등록하고 있습니다.');
  try {
    await queueRankRequest(keyword, targetMid, placeName, submit);
    $('midInput').value = targetMid;
    $('placeNameInput').value = '';
  } catch (error) {
    setFormStatus(error.message || '등록에 실패했습니다.', true);
  } finally {
    submit.disabled = false;
    submit.textContent = '추적 시작';
  }
});

$('refreshButton').addEventListener('click', async () => {
  const button = $('refreshButton');
  button.disabled = true;
  button.classList.add('is-spinning');
  try {
    await refreshSlots();
  } finally {
    button.disabled = false;
    button.classList.remove('is-spinning');
  }
});

$('historyCloseButton').addEventListener('click', closeHistoryModal);
$('historyDeleteButton').addEventListener('click', () => {
  if (!activeDetail) return;
  const slot = slots.find((row) => row.id === activeDetail.id);
  if (slot) openDeleteModal(slot);
});
$('deleteCancelButton').addEventListener('click', closeDeleteModal);
$('deleteConfirmButton').addEventListener('click', confirmPermanentDelete);

document.querySelectorAll('[data-history-window]').forEach((button) => {
  button.addEventListener('click', () => {
    activeWindow = button.dataset.historyWindow;
    renderHistoryDetail();
  });
});

$('historyModal').addEventListener('click', (event) => {
  if (event.target === $('historyModal')) closeHistoryModal();
});
$('deleteModal').addEventListener('click', (event) => {
  if (event.target === $('deleteModal')) closeDeleteModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!$('deleteModal').classList.contains('is-hidden')) closeDeleteModal();
  else if (!$('historyModal').classList.contains('is-hidden')) closeHistoryModal();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshSlots({ silent: true });
});

refreshSlots();
