from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def _supabase_headers(key: str) -> dict[str, str]:
    headers = {
        "apikey": key,
        "Accept": "application/json",
    }
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _normalize_slot(row: dict[str, Any], metrics: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    jobs = row.get("rank_jobs") if isinstance(row.get("rank_jobs"), list) else []
    history = row.get("rank_history") if isinstance(row.get("rank_history"), list) else []
    latest_job = jobs[0] if jobs else None
    return {
        "id": str(row.get("id") or ""),
        "keyword": str(row.get("keyword") or ""),
        "targetMid": str(row.get("target_mid") or ""),
        "placeName": row.get("place_name"),
        "active": bool(row.get("active", True)),
        "createdAt": row.get("created_at"),
        "latestJob": latest_job,
        "history": history,
        "placeMetrics": metrics or [],
    }


class SupabaseRankStatusClient:
    def __init__(self, *, url: str, service_role_key: str, opener=urlopen, timeout: int = 15):
        self.url = str(url or "").strip().rstrip("/")
        self.service_role_key = str(service_role_key or "").strip()
        if not self.url:
            raise ValueError("SUPABASE_URL is required")
        if not self.service_role_key:
            raise ValueError("SUPABASE_SERVICE_ROLE_KEY is required")
        self.opener = opener
        self.timeout = timeout

    def _get(self, path: str) -> Any:
        request = Request(
            f"{self.url}{path}",
            method="GET",
            headers=_supabase_headers(self.service_role_key),
        )
        with self.opener(request, timeout=self.timeout) as response:
            raw = response.read()
        return json.loads(raw.decode("utf-8")) if raw else []

    def list_slots(self) -> list[dict[str, Any]]:
        select = (
            "id,keyword,target_mid,place_name,active,created_at,"
            "rank_jobs(id,status,requested_at,started_at,finished_at,error_code,error_message),"
            "rank_history(measured_date,rank,status,measured_at)"
        )
        params = [
            ("select", select),
            ("active", "eq.true"),
            ("order", "created_at.desc"),
            ("rank_jobs.order", "requested_at.desc"),
            ("rank_jobs.limit", "1"),
            ("rank_history.order", "measured_date.desc"),
            ("rank_history.limit", "30"),
        ]
        rows = self._get(f"/rest/v1/rank_slots?{urlencode(params)}")
        if not isinstance(rows, list):
            raise RuntimeError("Supabase rank slot response must be a list")
        slot_rows = [row for row in rows if isinstance(row, dict)]
        if not slot_rows:
            return []

        mids = sorted({str(row.get("target_mid") or "").strip() for row in slot_rows if str(row.get("target_mid") or "").strip()})
        metrics_by_mid: dict[str, list[dict[str, Any]]] = {mid: [] for mid in mids}
        if mids:
            metrics_params = [
                ("select", "target_mid,measured_date,visitor_review_count,blog_review_count,save_count_raw,measured_at"),
                ("target_mid", f"in.({','.join(mids)})"),
                ("order", "measured_date.desc"),
            ]
            metric_rows = self._get(f"/rest/v1/place_metrics_history?{urlencode(metrics_params)}")
            if not isinstance(metric_rows, list):
                raise RuntimeError("Supabase place metrics response must be a list")
            for metric in metric_rows:
                if not isinstance(metric, dict):
                    continue
                mid = str(metric.get("target_mid") or "")
                if mid in metrics_by_mid and len(metrics_by_mid[mid]) < 31:
                    metrics_by_mid[mid].append(metric)

        return [
            _normalize_slot(row, metrics_by_mid.get(str(row.get("target_mid") or ""), []))
            for row in slot_rows
        ]


def _client_from_env() -> SupabaseRankStatusClient:
    return SupabaseRankStatusClient(
        url=os.environ.get("SUPABASE_URL", ""),
        service_role_key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
    )


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        try:
            self._send_json(200, {"slots": _client_from_env().list_slots()})
        except Exception:
            self._send_json(500, {"error": "rank status failed"})
