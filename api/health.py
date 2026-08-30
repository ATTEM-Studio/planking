from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler
from typing import Any
from urllib.request import Request, urlopen


def _supabase_headers(key: str) -> dict[str, str]:
    headers = {
        "apikey": key,
        "Accept": "application/json",
    }
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def check_supabase(*, url: str, service_role_key: str, opener=urlopen, timeout: int = 5) -> dict[str, Any]:
    base_url = str(url or "").strip().rstrip("/")
    key = str(service_role_key or "").strip()
    if not base_url or not key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    request = Request(
        f"{base_url}/rest/v1/rank_slots?select=id&limit=1",
        method="GET",
        headers=_supabase_headers(key),
    )
    with opener(request, timeout=timeout) as response:
        response.read()
    return {"ok": True, "database": "connected"}


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
            result = check_supabase(
                url=os.environ.get("SUPABASE_URL", ""),
                service_role_key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
            )
            self._send_json(200, result)
        except Exception:
            self._send_json(503, {"ok": False, "database": "unavailable"})
