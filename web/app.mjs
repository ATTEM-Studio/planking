import { confidenceLabel, formatScore, scoreTone } from './dashboard-utils.mjs';

const $ = (id) => document.getElementById(id);
const dashboard = $('dashboard');
const status = $('status');
let uploaded = null;

const metricIds = {
  relevance: ['relevanceScore', 'relevanceBar'],
  strength: ['strengthScore', 'strengthBar'],
  region_fit: ['regionScore', 'regionBar'],
  composite: ['compositeScore', 'compositeBar'],
};

function setStatus(message = '', error = false) {
  status.textContent = message;
  status.style.color = error ? '#9f413b' : '#687067';
}

function applyMetric(key, value) {
  const [textId, barId] = metricIds[key];
  $(textId).textContent = formatScore(value);
  $(barId).style.width = value == null ? '0%' : `${Math.max(0, Math.min(100, value))}%`;
}

function pill(value) {
  return `<span class="score-pill ${scoreTone(value)}">${formatScore(value)}</span>`;
}

function render(data) {
  const target = data.target;
  $('queryBadge').textContent = data.query || '키워드';
  $('confidenceBadge').textContent = `신뢰도 ${confidenceLabel(target.confidence)}`;
  $('placeName').textContent = target.name;
  $('confidenceCopy').textContent = target.confidence_copy || '';
  $('rankValue').textContent = target.rank;
  $('resultCount').textContent = `${data.result_count}개 결과 기준`;

  for (const [key, value] of Object.entries(target.scores)) applyMetric(key, value);

  $('focusLabel').textContent = target.focus?.label || '점검 영역';
  $('focusMessage').textContent = target.focus?.message || '';
  $('rawN1').textContent = target.raw.n1.toFixed(6);
  $('rawN2').textContent = target.raw.n2.toFixed(6);
  $('rawN3').textContent = target.raw.n3.toFixed(6);
  $('outsideKm').textContent = target.region_name ? `${target.raw.outside_km.toFixed(2)} km` : '해당 없음';
  $('regionName').textContent = target.region_name ? `지역 엔티티 · ${target.region_name}` : '현재 위치형 검색';

  const methodLabels = {
    rank: '실제 순위', relevance: '관련성', strength: '경쟁력', region_fit: '지역 적합성', composite: '종합점수'
  };
  $('methodList').innerHTML = Object.entries(data.method || {}).map(([key, value]) =>
    `<li><b>${methodLabels[key] || key}</b>${value}</li>`
  ).join('');

  $('competitorBody').innerHTML = (data.competitors || []).map((row) => `
    <tr class="${row.place_id === target.place_id ? 'is-target' : ''}">
      <td>${row.rank}</td>
      <td><strong>${escapeHtml(row.name)}</strong><br><small>${escapeHtml(row.place_id)}</small></td>
      <td>${pill(row.scores.relevance)}</td>
      <td>${pill(row.scores.strength)}</td>
      <td>${pill(row.scores.region_fit)}</td>
      <td>${pill(row.scores.composite)}</td>
    </tr>`).join('');

  $('notice').textContent = data.notice || '';
  dashboard.classList.remove('is-hidden');
  dashboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
  })[char]);
}

function findItems(payload) {
  if (Array.isArray(payload) && payload[0]?.data?.restaurants?.businesses?.items) {
    return payload[0].data.restaurants.businesses.items;
  }
  if (payload?.data?.restaurants?.businesses?.items) return payload.data.restaurants.businesses.items;
  if (payload?.restaurants?.businesses?.items) return payload.restaurants.businesses.items;
  return null;
}

async function analyzeUploaded() {
  if (!uploaded) throw new Error('먼저 JSON 파일을 선택해 주세요.');
  const query = $('queryInput').value.trim();
  const targetPlaceId = $('placeInput').value.trim();
  if (!query || !targetPlaceId) throw new Error('키워드와 플레이스 ID를 입력해 주세요.');

  let body;
  if (Array.isArray(uploaded) && uploaded.length && uploaded[0]?.n1 != null && uploaded[0]?.n2 != null && uploaded[0]?.n3 != null) {
    body = { query, targetPlaceId, scoredRows: uploaded };
  } else {
    const items = findItems(uploaded);
    if (!items) throw new Error('엔진 결과 배열 또는 네이버 GraphQL Response 형식을 찾지 못했습니다.');
    body = { query, targetPlaceId, items: items.slice(0, 70) };
  }

  setStatus('분석 중…');
  const response = await fetch('/api/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '분석에 실패했습니다.');
  render(result);
  setStatus('분석이 완료되었습니다.');
}

$('fileInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    uploaded = JSON.parse(await file.text());
    setStatus(`${file.name} 파일을 읽었습니다.`);
  } catch {
    uploaded = null;
    setStatus('JSON 형식을 읽지 못했습니다.', true);
  }
});

$('analyzeFile').addEventListener('click', () => analyzeUploaded().catch((error) => setStatus(error.message, true)));
$('loadDemo').addEventListener('click', async () => {
  try {
    setStatus('데모 데이터를 불러오는 중…');
    const response = await fetch('./demo/hadan-samgyeopsal-analysis.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('데모 데이터를 불러오지 못했습니다.');
    render(await response.json());
    setStatus('하단삼겹살 데모를 불러왔습니다.');
  } catch (error) {
    setStatus(error.message, true);
  }
});
