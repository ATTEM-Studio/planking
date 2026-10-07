import { requireStaff } from '../../../lib/access';

const statusLabel = (status: string) => ({ succeeded: '수집 완료', queued: '대기 중', running: '수집 중', blocked: '수집 차단', failed: '수집 실패', timeout: '시간 초과', parse_error: '확인 필요' }[String(status).toLowerCase()] ?? String(status));

export default async function JobsAdminPage() {
  const { supabase } = await requireStaff();
  const { data: jobs, error } = await supabase.from('collection_jobs').select('id,status,trigger,attempt_count,created_at,started_at,finished_at,error_code,error_message,keywords(keyword,places(name))').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;

  return <main className="page-shell">
    <section className="section-head"><div><p className="eyebrow">관리 · 수집</p><h1>수집 작업</h1><p className="muted">최근 작업의 진행 상태와 확인이 필요한 오류를 관리합니다.</p></div></section>
    <section className="panel"><div className="table-wrap"><table><thead><tr><th>업체</th><th>키워드</th><th>유형</th><th>상태</th><th>시작</th><th>오류</th></tr></thead><tbody>{(jobs ?? []).map((job: any) => <tr key={job.id}><td>{job.keywords?.places?.name ?? '—'}</td><td>{job.keywords?.keyword ?? '—'}</td><td>{job.trigger}</td><td><span className={`job-status ${String(job.status).toLowerCase()}`} title={job.status}>{statusLabel(job.status)}</span></td><td>{job.started_at ? new Date(job.started_at).toLocaleString('ko-KR') : '대기 중'}</td><td>{job.error_code ? `${job.error_code} · ${job.error_message ?? ''}` : '—'}</td></tr>)}</tbody></table>{!(jobs ?? []).length && <p className="empty-state">아직 기록된 수집 작업이 없습니다.</p>}</div></section>
  </main>;
}
