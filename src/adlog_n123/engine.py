from __future__ import annotations

from typing import Any

from .calibration import ALPHA_N1, Calibrator, QueryProfile
from .region import outside_distance_km


class N123Engine:
    def __init__(self, calibrator: Calibrator):
        self.calibrator = calibrator

    @staticmethod
    def compose(profile: QueryProfile, *, n1: float, n2: float, outside_km: float = 0.0) -> float:
        return float(
            profile.intercept
            + ALPHA_N1 * float(n1)
            + profile.beta_n2 * float(n2)
            + profile.region_gamma * float(outside_km)
        )

    def score(self, query: str, item: dict[str, Any], naver_context: dict[str, Any] | None = None) -> dict[str, Any]:
        n1, n1_source = self.calibrator.predict_n1(query, item)
        n2, n2_source = self.calibrator.predict_n2(item)
        profile = self.calibrator.query_profiles.get(query)

        outside_km = 0.0
        region_penalty = 0.0
        if profile and profile.region_name:
            region = self.calibrator.region_entities.get(profile.region_name)
            if region and item.get("x") is not None and item.get("y") is not None:
                # User/search-coordinate distance is intentionally ignored here.
                # Region fit is based on the query's region entity geometry.
                outside_km = outside_distance_km(region, float(item["x"]), float(item["y"]))
                region_penalty = profile.region_gamma * outside_km

        if profile:
            n3 = self.compose(profile, n1=n1, n2=n2, outside_km=outside_km)
            n3_source = "calibrated_formula"
        else:
            n3 = (10.0 + 20.0 * n1 + 2.0 * n2) / 53.0
            n3_source = "fallback_proxy"

        confidence = "high" if n1_source == n2_source == "observed" and profile else "low"
        if profile and confidence == "low" and n2_source == "observed":
            confidence = "medium"

        return {
            "query": query,
            "place_id": str(item.get("id") or item.get("place_id")),
            "name": item.get("name") or item.get("place_name") or "",
            "n1": float(n1),
            "n2": float(n2),
            "n3": float(n3),
            "n1_source": n1_source,
            "n2_source": n2_source,
            "n3_source": n3_source,
            "confidence": confidence,
            "region_name": profile.region_name if profile else None,
            "outside_km": float(outside_km),
            "region_penalty": float(region_penalty),
            "beta_n2": float(profile.beta_n2) if profile else 2.0 / 53.0,
            "alpha_n1": ALPHA_N1,
            "intercept": float(profile.intercept) if profile else 10.0 / 53.0,
        }
