from __future__ import annotations

from dataclasses import dataclass, field
import json
from math import log10
from pathlib import Path
import re
from typing import Any

from .region import RegionEntity

ALPHA_N1 = 20.0 / 53.0


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, float(value)))


def _number(value: Any) -> float:
    if value is None:
        return 0.0
    text = str(value).replace(",", "").replace("+", "").strip()
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    return float(match.group(0)) if match else 0.0


def _text_blob(item: dict[str, Any]) -> str:
    parts = [
        item.get("name"), item.get("place_name"), item.get("category"), item.get("businessCategory"),
        item.get("address"), item.get("commonAddress"), item.get("fullAddress"), item.get("microReview"),
        item.get("description"), item.get("options"),
    ]
    for review in item.get("visitorReviews") or []:
        if isinstance(review, dict):
            parts.append(review.get("review"))
    return " ".join(str(part) for part in parts if part).lower()


def _relevance_hint(query: str, item: dict[str, Any], region_name: str | None) -> float:
    text = _text_blob(item)
    compact_query = re.sub(r"\s+", "", query.lower())
    intent = compact_query
    if region_name:
        intent = intent.replace(re.sub(r"\s+", "", region_name.lower()), "")
    tokens = [token for token in (compact_query, intent) if len(token) >= 2]
    if not tokens:
        return 0.5
    normalized_text = re.sub(r"\s+", "", text)
    hits = sum(1 for token in tokens if token in normalized_text)
    return hits / len(tokens)


def _strength_proxy(item: dict[str, Any]) -> float:
    visitor = _number(item.get("visitorReviewCount") or item.get("place_visit_cnt"))
    blog = _number(item.get("blogCafeReviewCount") or item.get("totalReviewCount") or item.get("place_blog_cnt"))
    save = _number(item.get("saveCount") or item.get("place_save_cnt"))
    images = _number(item.get("imageCount"))
    bonus = 0.0
    bonus += 0.006 if item.get("hasBooking") else 0.0
    bonus += 0.004 if item.get("hasNPay") else 0.0
    pos = item.get("posInfo") or {}
    bonus += 0.004 if isinstance(pos, dict) and pos.get("isPOS") else 0.0
    value = (
        0.30
        + 0.018 * log10(visitor + 1.0)
        + 0.015 * log10(blog + 1.0)
        + 0.012 * log10(save + 1.0)
        + 0.008 * log10(images + 1.0)
        + bonus
    )
    return _clamp(value, 0.15, 0.85)


@dataclass(frozen=True)
class QueryProfile:
    query: str
    n1_median: float
    n1_min: float
    n1_max: float
    beta_n2: float
    intercept: float
    region_gamma: float = 0.0
    region_name: str | None = None

    @classmethod
    def from_dict(cls, query: str, payload: dict[str, Any]) -> "QueryProfile":
        return cls(
            query=query,
            n1_median=float(payload["n1_median"]),
            n1_min=float(payload["n1_min"]),
            n1_max=float(payload["n1_max"]),
            beta_n2=float(payload["beta_n2"]),
            intercept=float(payload["intercept"]),
            region_gamma=float(payload.get("region_gamma") or 0.0),
            region_name=payload.get("region_name"),
        )


@dataclass
class Calibrator:
    n1_cache: dict[tuple[str, str], float] = field(default_factory=dict)
    n2_cache: dict[str, float] = field(default_factory=dict)
    query_profiles: dict[str, QueryProfile] = field(default_factory=dict)
    region_entities: dict[str, RegionEntity] = field(default_factory=dict)

    @classmethod
    def load(cls, path: str | Path) -> "Calibrator":
        with Path(path).open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        n1_cache = {
            (query, str(pid)): float(value)
            for query, values in (payload.get("n1_cache") or {}).items()
            for pid, value in values.items()
        }
        return cls(
            n1_cache=n1_cache,
            n2_cache={str(pid): float(value) for pid, value in (payload.get("n2_cache") or {}).items()},
            query_profiles={
                query: QueryProfile.from_dict(query, profile)
                for query, profile in (payload.get("query_profiles") or {}).items()
            },
            region_entities={
                name: RegionEntity.from_dict(region)
                for name, region in (payload.get("region_entities") or {}).items()
            },
        )

    def predict_n1(self, query: str, item: dict[str, Any]) -> tuple[float, str]:
        pid = str(item.get("id") or item.get("place_id") or "")
        exact = self.n1_cache.get((query, pid))
        if exact is not None:
            return exact, "observed"

        profile = self.query_profiles.get(query)
        if profile:
            hint = _relevance_hint(query, item, profile.region_name)
            span = max(0.002, profile.n1_max - profile.n1_min)
            value = profile.n1_median + (hint - 0.5) * span * 0.5
            return _clamp(value, profile.n1_min - span * 0.15, profile.n1_max + span * 0.15), "fallback_proxy"

        hint = _relevance_hint(query, item, None)
        return _clamp(0.35 + 0.30 * hint, 0.25, 0.70), "fallback_proxy"

    def predict_n2(self, item: dict[str, Any]) -> tuple[float, str]:
        pid = str(item.get("id") or item.get("place_id") or "")
        exact = self.n2_cache.get(pid)
        if exact is not None:
            return exact, "observed"
        return _strength_proxy(item), "fallback_proxy"
