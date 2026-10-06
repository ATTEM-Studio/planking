import { COLLECTOR_VERSION } from './engine.mjs';
function required(value, name) { const text = String(value ?? '').trim(); if (!text) throw new TypeError(`${name} is required`); return text; }
export class SupabaseRankRepository {
  constructor({ url, serviceRoleKey, fetchImpl = fetch }) { this.url = required(url, 'url').replace(/\/$/, ''); this.serviceRoleKey = required(serviceRoleKey, 'serviceRoleKey'); this.fetchImpl = fetchImpl; }
  async request(path, body = {}) {
    const response = await this.fetchImpl(`${this.url}/rest/v1/${path}`, { method: 'POST', headers: { apikey: this.serviceRoleKey, Authorization: `Bearer ${this.serviceRoleKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) throw new Error(`Supabase request failed (${response.status}): ${text || 'empty response'}`);
    return text ? JSON.parse(text) : null;
  }
  async claimNextJob() {
    const rows = await this.request('rpc/claim_next_rank_job'); const row = Array.isArray(rows) ? rows[0] : rows; if (!row) return null;
    return { jobId: String(row.job_id), keywordId: String(row.keyword_id), keyword: String(row.keyword), targetPlaceId: String(row.target_place_id), maxRank: Number(row.max_rank) };
  }
  async finishJob(jobId, result) { return this.request('rpc/finish_rank_job', { p_job_id: required(jobId, 'jobId'), p_status: result.status, p_rank: result.rank ?? null, p_max_rank: result.maxRank ?? 100, p_items_scanned: result.itemsScanned ?? 0, p_pages_scanned: result.pagesScanned ?? 0, p_collector_version: COLLECTOR_VERSION, p_error_code: result.errorCode ?? null, p_error_message: result.errorMessage ?? null }); }
}
