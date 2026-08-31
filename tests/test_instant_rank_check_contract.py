from pathlib import Path


def test_instant_first_rank_check_assets_and_ui_contract():
    html = Path("index.html").read_text(encoding="utf-8")
    app = Path("web/app.mjs").read_text(encoding="utf-8")
    vercel = Path("vercel.json").read_text(encoding="utf-8")
    package = Path("package.json").read_text(encoding="utf-8")
    instant_api = Path("api/rank_collect.mjs")
    migration = Path("supabase/migrations/202608310002_instant_rank_claim.sql")

    assert "매일 오후 2시(KST) 기준 갱신" in html
    assert "/api/rank_collect" in app
    assert "즉시 조회 중" in app
    assert instant_api.exists()
    assert migration.exists()
    assert '"@sparticuz/chromium"' in package
    assert '"playwright-core"' in package
    assert '"api/**/*.mjs"' in vercel
