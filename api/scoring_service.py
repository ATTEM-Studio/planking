from __future__ import annotations

from typing import Any, Iterable


DISPLAY_LABELS = {
    "relevance": "키워드 관련성",
    "strength": "업체 경쟁력",
    "region_fit": "지역 적합성",
    "composite": "종합 경쟁점수",
}


def _clamp_score(value: float) -> int:
    return int(round(max(0.0, min(100.0, value))))


def percentile_score(values: Iterable[float], target: float) -> int:
    vals = [float(v) for v in values]
    if not vals:
        raise ValueError("values must not be empty")
    if len(vals) == 1:
        return 100
    less = sum(1 for value in vals if value < target)
    equal = sum(1 for value in vals if value == target)
    position = less + max(0.0, (equal - 1) / 2.0)
    return _clamp_score(position / (len(vals) - 1) * 100.0)


def _region_fit_score(row: dict[str, Any], max_outside_km: float) -> int | None:
    if not row.get("region_name"):
        return None
    outside = max(0.0, float(row.get("outside_km") or 0.0))
    if outside <= 1e-12 or max_outside_km <= 1e-12:
        return 100
    return _clamp_score((1.0 - outside / max_outside_km) * 100.0)


def _confidence_copy(confidence: str) -> str:
    return {
        "high": "관측값 비중이 높아 비교 신뢰도가 높습니다.",
        "medium": "일부 값은 보정 모델을 사용한 비교 지표입니다.",
        "low": "공개 데이터 기반 추정값이 포함된 실험 지표입니다.",
    }.get(confidence, "실험 지표입니다.")


def _decorate_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        raise ValueError("scored rows must not be empty")

    n1_values = [float(row["n1"]) for row in rows]
    n2_values = [float(row["n2"]) for row in rows]
    n3_values = [float(row["n3"]) for row in rows]
    max_outside = max(float(row.get("outside_km") or 0.0) for row in rows)

    decorated: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        rank = int(row.get("rank") or index + 1)
        scores = {
            "relevance": percentile_score(n1_values, float(row["n1"])),
            "strength": percentile_score(n2_values, float(row["n2"])),
            "region_fit": _region_fit_score(row, max_outside),
            "composite": percentile_score(n3_values, float(row["n3"])),
        }
        decorated.append(
            {
                "place_id": str(row.get("place_id") or row.get("id") or ""),
                "name": str(row.get("name") or row.get("place_name") or ""),
                "rank": rank,
                "scores": scores,
                "raw": {
                    "n1": float(row["n1"]),
                    "n2": float(row["n2"]),
                    "n3": float(row["n3"]),
                    "outside_km": float(row.get("outside_km") or 0.0),
                },
                "confidence": str(row.get("confidence") or "low"),
                "sources": {
                    "n1": str(row.get("n1_source") or "unknown"),
                    "n2": str(row.get("n2_source") or "unknown"),
                    "n3": str(row.get("n3_source") or "unknown"),
                },
                "region_name": row.get("region_name"),
            }
        )
    return decorated


def _focus_for(target: dict[str, Any]) -> dict[str, Any]:
    candidates = {
        key: value
        for key, value in target["scores"].items()
        if key in {"relevance", "strength", "region_fit"} and value is not None
    }
    if not candidates:
        return {
            "key": "relevance",
            "label": DISPLAY_LABELS["relevance"],
            "message": "현재 비교군에서 해석 가능한 세부 지표가 충분하지 않습니다.",
        }
    key = min(candidates, key=candidates.get)
    return {
        "key": key,
        "label": DISPLAY_LABELS[key],
        "message": f"현재 비교군에서 {DISPLAY_LABELS[key]} 점수가 상대적으로 낮습니다. 해석상 점검 우선순위로만 사용하세요.",
    }


def build_analysis_from_scored_rows(
    rows: list[dict[str, Any]], *, target_place_id: str, competitor_limit: int = 10
) -> dict[str, Any]:
    decorated = _decorate_rows(rows)
    target_id = str(target_place_id)
    target = next((row for row in decorated if row["place_id"] == target_id), None)
    if target is None:
        raise ValueError(f"target place_id not found: {target_id}")

    target = dict(target)
    target["focus"] = _focus_for(target)
    target["confidence_copy"] = _confidence_copy(target["confidence"])

    query = str(rows[0].get("query") or "")
    competitors = sorted(decorated, key=lambda row: row["rank"])[: max(1, competitor_limit)]
    return {
        "query": query,
        "result_count": len(decorated),
        "target": target,
        "competitors": competitors,
        "method": {
            "rank": "검색 결과 배열의 실제 노출 순서",
            "relevance": "N1의 동일 검색 결과 내 상대 백분위",
            "strength": "N2의 동일 검색 결과 내 상대 백분위",
            "region_fit": "지역형 검색에서 지역 엔티티 경계 밖 거리의 비교군 상대값",
            "composite": "N3의 동일 검색 결과 내 상대 백분위",
        },
        "notice": "관련성·경쟁력·지역 적합성·종합점수는 역공학 기반 실험 지표이며 네이버 공식 점수가 아닙니다.",
        "engine_version": "planking-runtime-0.1.0",
    }


def analyze_raw_items(
    query: str,
    items: list[dict[str, Any]],
    *,
    target_place_id: str,
    engine: Any,
    competitor_limit: int = 10,
) -> dict[str, Any]:
    if not items:
        raise ValueError("items must not be empty")
    scored_rows: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        scored = dict(engine.score(query, item))
        scored["rank"] = index + 1
        scored_rows.append(scored)
    return build_analysis_from_scored_rows(
        scored_rows,
        target_place_id=target_place_id,
        competitor_limit=competitor_limit,
    )
