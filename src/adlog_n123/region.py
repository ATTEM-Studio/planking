from __future__ import annotations

from dataclasses import dataclass
from math import cos, radians, sqrt
from typing import Iterable


@dataclass(frozen=True)
class RegionEntity:
    name: str
    spot_id: str | None
    rcode: str | None
    center_lon: float | None
    center_lat: float | None
    coordinates: tuple[tuple[float, float], ...]

    @classmethod
    def from_dict(cls, payload: dict) -> "RegionEntity":
        return cls(
            name=str(payload.get("name") or ""),
            spot_id=payload.get("spot_id"),
            rcode=payload.get("rcode"),
            center_lon=_optional_float(payload.get("center_lon")),
            center_lat=_optional_float(payload.get("center_lat")),
            coordinates=tuple((float(lon), float(lat)) for lon, lat in payload.get("coordinates") or []),
        )


def _optional_float(value):
    return None if value is None else float(value)


def parse_spot_polygon(spot: str | None) -> RegionEntity | None:
    if not spot or ":" not in spot:
        return None
    parts = spot.split(":")
    if len(parts) < 8:
        return None
    flat = parts[2].split("^") if parts[2] else []
    if len(flat) < 6 or len(flat) % 2:
        return None
    try:
        coords = tuple(
            (float(flat[i]) / 1e7, float(flat[i + 1]) / 1e7)
            for i in range(0, len(flat), 2)
        )
    except ValueError:
        return None

    center_lon = center_lat = None
    if len(parts) > 5 and "^" in parts[5]:
        try:
            lon_raw, lat_raw = parts[5].split("^", 1)
            center_lon = float(lon_raw) / 1e7
            center_lat = float(lat_raw) / 1e7
        except ValueError:
            pass

    return RegionEntity(
        name=parts[0],
        spot_id=(parts[7] or parts[1] or None),
        rcode=parts[6] or None,
        center_lon=center_lon,
        center_lat=center_lat,
        coordinates=coords,
    )


def _point_in_polygon(lon: float, lat: float, coordinates: Iterable[tuple[float, float]]) -> bool:
    pts = list(coordinates)
    if len(pts) < 3:
        return False
    inside = False
    j = len(pts) - 1
    for i, (xi, yi) in enumerate(pts):
        xj, yj = pts[j]
        if _point_on_segment(lon, lat, xj, yj, xi, yi):
            return True
        if (yi > lat) != (yj > lat):
            x_intersect = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lon < x_intersect:
                inside = not inside
        j = i
    return inside


def _point_on_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> bool:
    cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax)
    if abs(cross) > 1e-10:
        return False
    dot = (px - ax) * (px - bx) + (py - ay) * (py - by)
    return dot <= 1e-12


def _project_km(lon: float, lat: float, lon0: float, lat0: float) -> tuple[float, float]:
    x = (lon - lon0) * 111.320 * cos(radians(lat0))
    y = (lat - lat0) * 110.574
    return x, y


def _segment_distance(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    denom = dx * dx + dy * dy
    if denom <= 1e-18:
        return sqrt((px - ax) ** 2 + (py - ay) ** 2)
    t = ((px - ax) * dx + (py - ay) * dy) / denom
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * dx, ay + t * dy
    return sqrt((px - cx) ** 2 + (py - cy) ** 2)


def outside_distance_km(region: RegionEntity, lon: float, lat: float) -> float:
    """Approximate distance to the region boundary, zero when inside."""
    lon, lat = float(lon), float(lat)
    if _point_in_polygon(lon, lat, region.coordinates):
        return 0.0
    pts = list(region.coordinates)
    if len(pts) < 2:
        return 0.0
    lon0 = region.center_lon if region.center_lon is not None else sum(p[0] for p in pts) / len(pts)
    lat0 = region.center_lat if region.center_lat is not None else sum(p[1] for p in pts) / len(pts)
    px, py = _project_km(lon, lat, lon0, lat0)
    projected = [_project_km(x, y, lon0, lat0) for x, y in pts]
    distances = []
    for i, (ax, ay) in enumerate(projected):
        bx, by = projected[(i + 1) % len(projected)]
        distances.append(_segment_distance(px, py, ax, ay, bx, by))
    return float(min(distances)) if distances else 0.0
