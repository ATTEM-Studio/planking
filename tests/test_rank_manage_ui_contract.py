from pathlib import Path


def test_rank_manage_ui_contains_permanent_delete_warning_and_history_detail_shell():
    html = Path("index.html").read_text(encoding="utf-8")
    app = Path("web/app.mjs").read_text(encoding="utf-8")

    assert "deleteModal" in html
    assert "영구 삭제" in html
    assert "복구할 수 없습니다" in html
    assert "historyModal" in html
    assert "7일" in html and "30일" in html and "90일" in html and "전체" in html
    assert "/api/rank_manage" in app
