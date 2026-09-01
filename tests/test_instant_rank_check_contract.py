from pathlib import Path


def test_first_registration_gets_immediate_attempt_with_worker_fallback():
    html = Path("index.html").read_text(encoding="utf-8")
    app = Path("web/app.mjs").read_text(encoding="utf-8")
    package = Path("package.json").read_text(encoding="utf-8")
    vercel = Path("vercel.json").read_text(encoding="utf-8")

    assert "매일 오후 2시(KST) 기준 갱신" in html
    assert "첫 등록 즉시 1차 조회" in html
    assert "/api/rank_request" in app
    assert "/api/rank_collect" in app
    assert "immediate: true" in app
    assert "즉시 1차 조회" in app
    assert "안정 수집기가 자동 재처리" in app
    assert Path("api/rank_collect.mjs").exists()
    assert "@sparticuz/chromium" in package
    assert "playwright-core" in package
    assert '"api/rank_collect.mjs"' in vercel


def test_recheck_does_not_use_serverless_immediate_collection():
    app = Path("web/app.mjs").read_text(encoding="utf-8")

    # Existing-keyword rechecks stay on the queue-only path to avoid concurrent
    # serverless Chromium launches. Only the form's first registration opts in.
    recheck_block = app.split("document.querySelectorAll('.recheck-button')", 1)[1].split("document.querySelectorAll('.delete-button')", 1)[0]
    assert "immediate: true" not in recheck_block
