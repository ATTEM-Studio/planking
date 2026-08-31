function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${name} is required`);
  return text;
}

function authHeaders(key) {
  const headers = {
    apikey: key,
    'Content-Type': 'application/json',
  };
  if (key.startsWith('eyJ')) {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

function normalizeClaimedJob(row) {
  if (!row) return null;
  return {
    id: String(row.job_id ?? row.id),
    slotId: String(row.slot_id),
    keyword: String(row.keyword),
    targetMid: String(row.target_mid),
  };
}

export class SupabaseRankRepository {
  constructor({ url, serviceRoleKey, fetchImpl = fetch }) {
    this.url = required(url, 'url').replace(/\/$/, '');
    this.serviceRoleKey = required(serviceRoleKey, 'serviceRoleKey');
    this.fetchImpl = fetchImpl;
  }

  _headers(extra = {}) {
    return {
      ...authHeaders(this.serviceRoleKey),
      ...extra,
    };
  }

  async _request(path, options = {}) {
    const response = await this.fetchImpl(`${this.url}${path}`, {
      ...options,
      headers: this._headers(options.headers),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Supabase request failed (${response.status}): ${text || 'empty response'}`);
    }
    if (!text) return null;
    return JSON.parse(text);
  }

  async enqueueDailyJobs() {
    const result = await this._request('/rest/v1/rpc/enqueue_daily_rank_jobs', {
      method: 'POST',
      body: '{}',
    });
    const value = Array.isArray(result) ? result[0] : result;
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  async claimNextJob() {
    const rows = await this._request('/rest/v1/rpc/claim_next_rank_job', {
      method: 'POST',
      body: '{}',
    });
    return normalizeClaimedJob(Array.isArray(rows) ? rows[0] : rows);
  }

  async claimJobById(jobId) {
    const rows = await this._request('/rest/v1/rpc/claim_rank_job', {
      method: 'POST',
      body: JSON.stringify({ p_job_id: required(jobId, 'jobId') }),
    });
    return normalizeClaimedJob(Array.isArray(rows) ? rows[0] : rows);
  }

  async upsertHistory(slotId, measuredDate, result) {
    await this._request('/rest/v1/rank_history?on_conflict=slot_id,measured_date', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        slot_id: slotId,
        measured_date: measuredDate,
        rank: result.rank,
        status: result.status,
        pages_scanned: result.pagesScanned,
        items_scanned: result.itemsScanned,
        measured_at: new Date().toISOString(),
      }),
    });
  }

  async upsertPlaceMetrics(targetMid, measuredDate, metrics) {
    await this._request('/rest/v1/place_metrics_history?on_conflict=target_mid,measured_date', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        target_mid: String(targetMid),
        measured_date: measuredDate,
        visitor_review_count: metrics?.visitorReviewCount ?? null,
        blog_review_count: metrics?.blogReviewCount ?? null,
        save_count_raw: metrics?.saveCountRaw ?? null,
        measured_at: new Date().toISOString(),
      }),
    });
  }

  async completeJob(jobId, result) {
    await this._request(`/rest/v1/rank_jobs?id=eq.${encodeURIComponent(jobId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: result.status,
        finished_at: new Date().toISOString(),
        error_code: null,
        error_message: null,
      }),
    });
  }

  async failJob(jobId, result) {
    await this._request(`/rest/v1/rank_jobs?id=eq.${encodeURIComponent(jobId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: result.status,
        finished_at: new Date().toISOString(),
        error_code: result.errorCode ?? null,
        error_message: result.errorMessage ?? null,
      }),
    });
  }
}
