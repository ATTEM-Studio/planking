from pathlib import Path


def test_rank_recheck_uses_reliable_worker_queue_not_serverless_browser():
    html = Path("index.html").read_text(encoding="utf-8")
    app = Path("web/app.mjs").read_text(encoding="utf-8")

    assert "매일 오후 2시(KST) 기준 갱신" in html
    assert "/api/rank_request" in app
    assert "/api/rank_collect" not in app
    assert "조회 요청이 등록되었습니다" in app
    assert "수집기가 순차 처리" in app
