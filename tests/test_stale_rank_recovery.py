from pathlib import Path


MIGRATION = Path("supabase/migrations/202608310002_instant_rank_claim.sql")


def test_stale_running_jobs_can_be_requeued_by_service_role_only():
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert "create or replace function public.requeue_stale_rank_jobs" in sql
    assert "status = 'pending'" in sql
    assert "status = 'running'" in sql
    assert "started_at < now() -" in sql
    assert "interval '10 minutes'" in sql
    assert "revoke all on function public.requeue_stale_rank_jobs() from anon;" in sql
    assert "revoke all on function public.requeue_stale_rank_jobs() from authenticated;" in sql
    assert "grant execute on function public.requeue_stale_rank_jobs() to service_role;" in sql
