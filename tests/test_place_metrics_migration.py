from pathlib import Path


MIGRATION = Path("supabase/migrations/202608310001_place_metrics_history.sql")


def test_place_metrics_history_schema_and_security_contract():
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert "create table if not exists public.place_metrics_history" in sql
    assert "target_mid text not null" in sql
    assert "measured_date date not null" in sql
    assert "visitor_review_count integer" in sql
    assert "blog_review_count integer" in sql
    assert "save_count_raw text" in sql
    assert "unique (target_mid, measured_date)" in sql

    assert "alter table public.place_metrics_history enable row level security;" in sql
    assert "revoke all on table public.place_metrics_history from anon;" in sql
    assert "revoke all on table public.place_metrics_history from authenticated;" in sql
    assert "grant all on table public.place_metrics_history to service_role;" in sql
