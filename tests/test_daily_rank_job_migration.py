from pathlib import Path


MIGRATION = Path("supabase/migrations/202608300002_daily_rank_jobs.sql")


def test_daily_rank_job_rpc_is_service_role_only_and_kst_daily():
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert "create or replace function public.enqueue_daily_rank_jobs()" in sql
    assert "at time zone 'asia/seoul'" in sql
    assert "j.status in ('pending','running')" in sql
    assert "revoke all on function public.enqueue_daily_rank_jobs() from public;" in sql
    assert "revoke all on function public.enqueue_daily_rank_jobs() from anon;" in sql
    assert "revoke all on function public.enqueue_daily_rank_jobs() from authenticated;" in sql
    assert "grant execute on function public.enqueue_daily_rank_jobs() to service_role;" in sql
