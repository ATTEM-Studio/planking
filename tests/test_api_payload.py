import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api.analyze import process_payload


def test_scored_rows_payload_returns_analysis_without_engine_call():
    rows = [
        {"query":"하단삼겹살","place_id":"A","name":"A","rank":1,"n1":.6,"n2":.55,"n3":.44,"confidence":"high","region_name":"하단","outside_km":0,"n1_source":"observed","n2_source":"observed","n3_source":"calibrated_formula"},
        {"query":"하단삼겹살","place_id":"B","name":"B","rank":2,"n1":.5,"n2":.45,"n3":.40,"confidence":"low","region_name":"하단","outside_km":1,"n1_source":"fallback_proxy","n2_source":"fallback_proxy","n3_source":"calibrated_formula"},
    ]
    result = process_payload({"query":"하단삼겹살","targetPlaceId":"A","scoredRows":rows}, engine=None)
    assert result["target"]["place_id"] == "A"
    assert result["target"]["rank"] == 1


def test_raw_items_payload_requires_engine():
    try:
        process_payload({"query":"하단삼겹살","targetPlaceId":"A","items":[{"id":"A"}]}, engine=None)
    except ValueError as exc:
        assert "engine" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_payload_rejects_more_than_70_rows():
    row = {"query":"x","place_id":"A","name":"A","rank":1,"n1":.5,"n2":.5,"n3":.4,"confidence":"low","region_name":None,"outside_km":0,"n1_source":"fallback_proxy","n2_source":"fallback_proxy","n3_source":"fallback_proxy"}
    rows = [{**row, "place_id":str(i), "rank":i+1} for i in range(71)]
    try:
        process_payload({"query":"x","targetPlaceId":"0","scoredRows":rows}, engine=None)
    except ValueError as exc:
        assert "70" in str(exc)
    else:
        raise AssertionError("expected ValueError")
