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


def _normalize_slot(row: dict[str, Any]) -> dict[str, Any]:
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
        request = Request(
            f"{self.url}/rest/v1/rank_slots?{urlencode(params)}",
            method="GET",
            headers=_supabase_headers(self.service_role_key),
        )
        with self.opener(request, timeout=self.timeout) as response:
            raw = response.read()
        rows = json.loads(raw.decode("utf-8")) if raw else []
        if not isinstance(rows, list):
            raise RuntimeError("Supabase rank slot response must be a list")
        return [_normalize_slot(row) for row in rows if isinstance(row, dict)]


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
