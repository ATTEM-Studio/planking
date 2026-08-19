import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api.scoring_service import build_analysis_from_scored_rows


def _rows():
    return [
        {"query":"하단삼겹살","place_id":"A","name":"A식당","rank":1,"n1":0.60,"n2":0.55,"n3":0.44,"confidence":"high","region_name":"하단","outside_km":0.0,"n1_source":"observed","n2_source":"observed","n3_source":"calibrated_formula"},
        {"query":"하단삼겹살","place_id":"B","name":"B식당","rank":2,"n1":0.55,"n2":0.50,"n3":0.42,"confidence":"medium","region_name":"하단","outside_km":1.0,"n1_source":"fallback_proxy","n2_source":"observed","n3_source":"calibrated_formula"},
        {"query":"하단삼겹살","place_id":"C","name":"C식당","rank":3,"n1":0.50,"n2":0.45,"n3":0.40,"confidence":"low","region_name":"하단","outside_km":2.0,"n1_source":"fallback_proxy","n2_source":"fallback_proxy","n3_source":"calibrated_formula"},
    ]


def test_target_metrics_are_percentile_based_and_rank_is_preserved():
    result = build_analysis_from_scored_rows(_rows(), target_place_id="A")
    assert result["target"]["rank"] == 1
    assert result["target"]["scores"]["relevance"] == 100
    assert result["target"]["scores"]["strength"] == 100
    assert result["target"]["scores"]["composite"] == 100
    assert result["target"]["scores"]["region_fit"] == 100
    assert result["engine_version"] == "planking-runtime-0.1.0"


def test_region_fit_declines_only_for_places_outside_region_boundary():
    result = build_analysis_from_scored_rows(_rows(), target_place_id="B")
    assert result["target"]["scores"]["region_fit"] == 50
    c = next(row for row in result["competitors"] if row["place_id"] == "C")
    assert c["scores"]["region_fit"] == 0


def test_lowest_dimension_is_reported_as_comparison_gap_not_causal_claim():
    rows = _rows()
    rows[1]["n1"] = 0.49
    rows[1]["n2"] = 0.54
    result = build_analysis_from_scored_rows(rows, target_place_id="B")
    focus = result["target"]["focus"]
    assert focus["key"] == "relevance"
    assert "비교군" in focus["message"]
    assert "원인" not in focus["message"]


def test_unknown_target_raises_clear_error():
    try:
        build_analysis_from_scored_rows(_rows(), target_place_id="Z")
    except ValueError as exc:
        assert "target place_id" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_no_region_query_returns_null_region_fit():
    rows = _rows()
    for row in rows:
        row["region_name"] = None
        row["outside_km"] = 0.0
    result = build_analysis_from_scored_rows(rows, target_place_id="A")
    assert result["target"]["scores"]["region_fit"] is None
