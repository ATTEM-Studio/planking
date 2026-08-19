from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

from adlog_n123.calibration import Calibrator
from adlog_n123.engine import N123Engine


def test_json_calibration_loads_observed_values_without_ml_runtime():
    cal = Calibrator.load(ROOT / "artifacts" / "calibration.json")
    n1, n1_source = cal.predict_n1("하단삼겹살", {"id": "1800550902", "name": "부산삼겹살 하단본점 숯불갈비"})
    n2, n2_source = cal.predict_n2({"id": "1800550902"})
    assert n1 == 0.573875
    assert n1_source == "observed"
    assert n2 == 0.515822
    assert n2_source == "observed"


def test_lightweight_engine_replays_observed_hadan_score():
    cal = Calibrator.load(ROOT / "artifacts" / "calibration.json")
    engine = N123Engine(cal)
    result = engine.score("하단삼겹살", {"id":"1800550902","name":"부산삼겹살 하단본점 숯불갈비","x":"128.9637325","y":"35.1113764"})
    assert result["confidence"] == "high"
    assert result["outside_km"] == 0.0
    assert abs(result["n3"] - 0.42476781714909645) < 1e-9


def test_lightweight_region_distance_detects_outside_place():
    cal = Calibrator.load(ROOT / "artifacts" / "calibration.json")
    engine = N123Engine(cal)
    result = engine.score("하단삼겹살", {"id":"2059806360","name":"돈 명지점","x":"128.9232992","y":"35.0957809"})
    assert result["outside_km"] > 0.3
    assert result["region_penalty"] < 0


def test_unseen_place_uses_explicit_low_confidence_fallback():
    cal = Calibrator.load(ROOT / "artifacts" / "calibration.json")
    engine = N123Engine(cal)
    result = engine.score("하단삼겹살", {"id":"new-place","name":"하단 새삼겹살","category":"돼지고기구이","commonAddress":"부산 사하구 하단동","visitorReviewCount":"120","blogCafeReviewCount":"20","saveCount":"300+","imageCount":12,"x":"128.963","y":"35.110"})
    assert result["confidence"] == "low"
    assert result["n1_source"] == "fallback_proxy"
    assert result["n2_source"] == "fallback_proxy"
    assert 0.15 <= result["n2"] <= 0.85
