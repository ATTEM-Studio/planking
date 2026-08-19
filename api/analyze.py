from __future__ import annotations

import json
import sys
from functools import lru_cache
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from api.scoring_service import analyze_raw_items, build_analysis_from_scored_rows

MAX_ROWS = 70
MAX_BODY_BYTES = 2_000_000


def _require_text(payload: dict[str, Any], key: str) -> str:
    value = str(payload.get(key) or "").strip()
    if not value:
        raise ValueError(f"{key} is required")
    return value


def process_payload(payload: dict[str, Any], engine: Any | None) -> dict[str, Any]:
    query = _require_text(payload, "query")
    target_place_id = _require_text(payload, "targetPlaceId")
    competitor_limit = int(payload.get("competitorLimit") or 10)
    competitor_limit = max(1, min(20, competitor_limit))

    scored_rows = payload.get("scoredRows")
    if scored_rows is not None:
        if not isinstance(scored_rows, list) or not scored_rows:
            raise ValueError("scoredRows must be a non-empty array")
        if len(scored_rows) > MAX_ROWS:
            raise ValueError(f"scoredRows supports up to {MAX_ROWS} rows")
        rows = [dict(row) for row in scored_rows]
        for row in rows:
            row.setdefault("query", query)
        return build_analysis_from_scored_rows(
            rows,
            target_place_id=target_place_id,
            competitor_limit=competitor_limit,
        )

    items = payload.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("items or scoredRows is required")
    if len(items) > MAX_ROWS:
        raise ValueError(f"items supports up to {MAX_ROWS} rows")
    if engine is None:
        raise ValueError("engine is required to analyze raw items")
    return analyze_raw_items(
        query,
        [dict(item) for item in items],
        target_place_id=target_place_id,
        engine=engine,
        competitor_limit=competitor_limit,
    )


@lru_cache(maxsize=1)
def _get_engine():
    from adlog_n123.calibration import Calibrator
    from adlog_n123.engine import N123Engine

    artifact = ROOT / "artifacts" / "calibration.json"
    if not artifact.exists():
        raise RuntimeError("calibration artifact is missing")
    return N123Engine(Calibrator.load(artifact))


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length") or "0")
            if content_length <= 0:
                raise ValueError("request body is required")
            if content_length > MAX_BODY_BYTES:
                self._send_json(413, {"error": "request body is too large"})
                return
            raw = self.rfile.read(content_length)
            payload = json.loads(raw.decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("request body must be a JSON object")
            needs_engine = payload.get("scoredRows") is None
            result = process_payload(payload, _get_engine() if needs_engine else None)
            self._send_json(200, result)
        except (ValueError, json.JSONDecodeError) as exc:
            self._send_json(400, {"error": str(exc)})
        except Exception:
            self._send_json(500, {"error": "analysis failed"})
