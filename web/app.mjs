import { formatRankResult, jobLabel, parseTargetMid, rankDelta } from './rank-tracker-utils.mjs';

const $ = (id) => document.getElementById(id);
const pendingStatuses = new Set(['PENDING', 'RUNNING']);
const issueStatuses = new Set(['BLOCKED', 'TIMEOUT', 'FAILED']);
let slots = [];
let refreshTimer = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function setFormStatus(message = '', error = false) {
  const node = $('formStatus');
  node.textContent = message;
  node.classList.toggle('is-error', error);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit' }).format(date);
}

function formatTime(value) {
  if (!value) return '측정 전';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '측정 전';
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
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
  if (!history.length) {
    return '<div class="history-empty">첫 측정이 완료되면 날짜별 이력이 표시됩니다.</div>';
  }
  return `
    <div class="history-strip">
      ${history.slice(0, 7).map((row) => `
        <div class="history-day">
          <span>${escapeHtml(formatDate(row.measured_date))}</span>
          <strong>${escapeHtml(formatRankResult(row))}</strong>
        </div>`).join('')}
    </div>`;
}

function slotMarkup(slot) {
  const history = Array.isArray(slot.history) ? slot.history : [];
  const latest = history[0] || null;
  const job = slot.latestJob || null;
  const status = job?.status || (latest?.status === 'OUT_OF_RANGE' ? 'OUT_OF_RANGE' : latest ? 'SUCCESS' : 'PENDING');
  const busy = pendingStatuses.has(status);
  const latestMeasuredAt = latest?.measured_at || job?.finished_at || job?.started_at || job?.requested_at;
  const placeLabel = slot.placeName || `MID ${slot.targetMid}`;

  return `
    <article class="slot-card" data-slot-id="${escapeHtml(slot.id)}">
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

      <div class="slot-meta">
        <span><b>최근 측정</b>${escapeHtml(formatTime(latestMeasuredAt))}</span>
        <span><b>기록</b>${history.length}일</span>
        <button class="button button-mini recheck-button" type="button" data-slot-id="${escapeHtml(slot.id)}" ${busy ? 'disabled' : ''}>
          ${busy ? '조회 중…' : '다시 조회'}
        </button>
      </div>

      ${historyMarkup(history)}
      ${issueStatuses.has(status) ? `<p class="issue-copy">최근 조회가 완료되지 않았습니다. 기존 정상 순위 기록은 유지됩니다.${job?.error_code ? ` · ${escapeHtml(job.error_code)}` : ''}</p>` : ''}
    </article>`;
}

function renderMetrics() {
  $('metricTotal').textContent = slots.length;
  $('metricMeasured').textContent = slots.filter((slot) => (slot.history || []).length > 0).length;
  $('metricPending').textContent = slots.filter((slot) => pendingStatuses.has(slot.latestJob?.status)).length;
  $('metricIssues').textContent = slots.filter((slot) => issueStatuses.has(slot.latestJob?.status)).length;
}

function renderSlots() {
  $('loadingState').classList.add('is-hidden');
  $('errorState').classList.add('is-hidden');
  $('emptyState').classList.toggle('is-hidden', slots.length !== 0);
  $('slotGrid').innerHTML = slots.map(slotMarkup).join('');
  renderMetrics();

  document.querySelectorAll('.recheck-button').forEach((button) => {
    button.addEventListener('click', async () => {
      const slot = slots.find((row) => row.id === button.dataset.slotId);
      if (!slot) return;
      await queueRankRequest(slot.keyword, slot.targetMid, slot.placeName, button);
    });
  });

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

async function queueRankRequest(keyword, targetMid, placeName, button = null) {
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
    setFormStatus('조회 요청이 등록되었습니다. 백그라운드 수집기가 순차적으로 처리합니다.');
    await refreshSlots({ silent: true });
    return data;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = '다시 조회';
    }
  }
}

$('rankForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const keyword = $('keywordInput').value.trim();
  const targetMid = parseTargetMid($('midInput').value);
  const placeName = $('placeNameInput').value.trim();
  if (!keyword) {
    setFormStatus('키워드를 입력해 주세요.', true);
    return;
  }
  if (!targetMid) {
    setFormStatus('올바른 플레이스 MID 또는 네이버 플레이스 URL을 입력해 주세요.', true);
    return;
  }

  const submit = $('submitButton');
  submit.disabled = true;
  submit.textContent = '등록 중…';
  setFormStatus('순위 추적을 등록하고 있습니다.');
  try {
    await queueRankRequest(keyword, targetMid, placeName);
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
  await refreshSlots();
  button.disabled = false;
  button.classList.remove('is-spinning');
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshSlots({ silent: true });
});

refreshSlots();
