from pathlib import Path


MIGRATION = Path("supabase/migrations/202608300003_rank_incomplete_status.sql")


def test_rank_jobs_allow_incomplete_without_adding_it_to_history():
    sql = MIGRATION.read_text(encoding="utf-8").lower()
    assert "drop constraint if exists rank_jobs_status_check" in sql
    assert "'incomplete'" in sql
    assert "rank_jobs_status_check" in sql
    assert "rank_history_status_check" not in sql
