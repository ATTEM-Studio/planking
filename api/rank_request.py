from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler
from typing import Any
from urllib.request import Request, urlopen

MAX_BODY_BYTES = 2_000_000


def _required_text(payload: dict[str, Any], key: str) -> str:
    value = str(payload.get(key) or "").strip()
    if not value:
        raise ValueError(f"{key} is required")
    return value


def process_payload(payload: dict[str, Any], client: Any) -> dict[str, str]:
    if not isinstance(payload, dict):
        raise ValueError("request body must be a JSON object")
    keyword = _required_text(payload, "keyword")
    target_mid = _required_text(payload, "targetPlaceId")
    raw_place_name = payload.get("placeName")
    place_name = str(raw_place_name).strip() if raw_place_name is not None else None
    if place_name == "":
        place_name = None
    result = client.enqueue_rank_request(keyword, target_mid, place_name)
    return {
        "slotId": str(result["slotId"]),
        "jobId": str(result["jobId"]),
        "status": "PENDING",
    }


class SupabaseRankRequestClient:
    def __init__(self, *, url: str, service_role_key: str, opener=urlopen, timeout: int = 15):
        self.url = str(url or "").strip().rstrip("/")
        self.service_role_key = str(service_role_key or "").strip()
        if not self.url:
            raise ValueError("SUPABASE_URL is required")
        if not self.service_role_key:
            raise ValueError("SUPABASE_SERVICE_ROLE_KEY is required")
        self.opener = opener
        self.timeout = timeout

    def _post(self, path: str, payload: dict[str, Any], *, prefer: str) -> Any:
        request = Request(
            f"{self.url}{path}",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={
                "apikey": self.service_role_key,
                "Authorization": f"Bearer {self.service_role_key}",
                "Content-Type": "application/json",
                "Prefer": prefer,
            },
        )
        with self.opener(request, timeout=self.timeout) as response:
            raw = response.read()
        return json.loads(raw.decode("utf-8")) if raw else None

    def enqueue_rank_request(self, keyword: str, target_mid: str, place_name: str | None) -> dict[str, str]:
        slot_payload: dict[str, Any] = {
            "keyword": keyword,
            "target_mid": target_mid,
        }
        if place_name is not None:
            slot_payload["place_name"] = place_name
        slot_rows = self._post(
            "/rest/v1/rank_slots?on_conflict=keyword,target_mid&select=id",
            slot_payload,
            prefer="resolution=merge-duplicates,return=representation",
        )
        if not isinstance(slot_rows, list) or not slot_rows or not slot_rows[0].get("id"):
            raise RuntimeError("Supabase did not return rank slot id")
        slot_id = str(slot_rows[0]["id"])

        job_rows = self._post(
            "/rest/v1/rank_jobs?select=id",
            {"slot_id": slot_id, "status": "PENDING"},
            prefer="return=representation",
        )
        if not isinstance(job_rows, list) or not job_rows or not job_rows[0].get("id"):
            raise RuntimeError("Supabase did not return rank job id")
        return {"slotId": slot_id, "jobId": str(job_rows[0]["id"]), "status": "PENDING"}


def _client_from_env() -> SupabaseRankRequestClient:
    return SupabaseRankRequestClient(
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
            result = process_payload(payload, _client_from_env())
            self._send_json(202, result)
        except (ValueError, json.JSONDecodeError) as exc:
            self._send_json(400, {"error": str(exc)})
        except Exception:
            self._send_json(500, {"error": "rank request failed"})
