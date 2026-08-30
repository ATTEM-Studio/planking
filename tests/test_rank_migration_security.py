from pathlib import Path


MIGRATION = Path("supabase/migrations/202608300001_rank_tracking.sql")


def test_rank_tracking_tables_enable_rls_and_block_browser_roles():
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    for table in ("rank_slots", "rank_jobs", "rank_history"):
        assert f"alter table public.{table} enable row level security;" in sql
        assert f"revoke all on table public.{table} from anon;" in sql
        assert f"revoke all on table public.{table} from authenticated;" in sql
        assert f"grant all on table public.{table} to service_role;" in sql
