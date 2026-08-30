from pathlib import Path


def test_rank_manage_ui_contains_brand_metrics_and_history_detail_shell():
    html = Path("index.html").read_text(encoding="utf-8")
    app = Path("web/app.mjs").read_text(encoding="utf-8")
    css = Path("styles.css").read_text(encoding="utf-8")
    manage_css = Path("manage.css").read_text(encoding="utf-8")

    assert 'src="./assets/planking-logo.png"' in html
    assert 'alt="PLANKING"' in html
    assert 'placeholder="예:' not in html
    assert "deleteModal" in html
    assert "영구 삭제" in html
    assert "복구할 수 없습니다" in html
    assert "historyModal" in html
    assert "7일" in html and "30일" in html and "90일" in html and "전체" in html
    assert "historyRankChart" in html
    assert "historyVisitorChart" in html
    assert "historyBlogChart" in html
    assert "historySaveChart" in html
    assert "영수증 리뷰" in html
    assert "블로그 리뷰" in html
    assert "저장" in html
    assert "metric-period-tabs" in app
    assert "data-metric-period=\"1\"" in app
    assert "data-metric-period=\"7\"" in app
    assert "data-metric-period=\"30\"" in app
    assert "/api/rank_manage" in app
    assert "--accent: #3539e8" in css.lower()
    assert "prefers-reduced-motion" in css
    assert "prefers-reduced-motion" in manage_css
