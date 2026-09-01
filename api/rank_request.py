from __future__ import annotations

import json
import os
import time
from http.server import BaseHTTPRequestHandler
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

MAX_BODY_BYTES = 2_000_000


def _required_text(payload: dict[str, Any], key: str) -> str:
    value = str(payload.get(key) or "").strip()
    if not value:
        raise ValueError(f"{key} is required")
    return value


def _supabase_headers(key: str) -> dict[str, str]:
    headers = {
        "apikey": key,
        "Content-Type": "application/json",
    }
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def process_payload(payload: dict[str, Any], client: Any) -> dict[str, Any]:
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
        "isNew": bool(result.get("isNew", False)),
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

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None, *, prefer: str | None = None) -> Any:
        headers = _supabase_headers(self.service_role_key)
        if prefer:
            headers["Prefer"] = prefer
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = Request(
            f"{self.url}{path}",
            data=data,
            method=method,
            headers=headers,
        )
        with self.opener(request, timeout=self.timeout) as response:
            raw = response.read()
        return json.loads(raw.decode("utf-8")) if raw else None

    def _post(self, path: str, payload: dict[str, Any], *, prefer: str) -> Any:
        return self._request("POST", path, payload, prefer=prefer)

    def _get(self, path: str) -> Any:
        return self._request("GET", path)

    def enqueue_rank_request(self, keyword: str, target_mid: str, place_name: str | None) -> dict[str, Any]:
        existing_rows = self._get(
            "/rest/v1/rank_slots"
            f"?keyword=eq.{quote(keyword, safe='')}"
            f"&target_mid=eq.{quote(target_mid, safe='')}"
            "&select=id&limit=1"
        )
        is_new = not (isinstance(existing_rows, list) and existing_rows and existing_rows[0].get("id"))

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
        return {
            "slotId": slot_id,
            "jobId": str(job_rows[0]["id"]),
            "status": "PENDING",
            "isNew": is_new,
        }


def _client_from_env() -> SupabaseRankRequestClient:
    return SupabaseRankRequestClient(
        url=os.environ.get("SUPABASE_URL", ""),
        service_role_key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
    )


def _attempt_immediate_collection(
    job_id: str,
    headers: Any,
    *,
    opener=urlopen,
    timeout: int = 55,
    attempts: int = 2,
) -> dict[str, Any] | None:
    host = str(headers.get("Host") or "").strip()
    if not host:
        return None
    forwarded_proto = str(headers.get("X-Forwarded-Proto") or "https").strip().lower()
    scheme = "http" if forwarded_proto == "http" else "https"
    url = f"{scheme}://{host}/api/rank_collect"
    body = json.dumps({"jobId": str(job_id)}, ensure_ascii=False).encode("utf-8")

    for attempt in range(max(1, attempts)):
        request = Request(
            url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with opener(request, timeout=timeout) as response:
                raw = response.read()
            result = json.loads(raw.decode("utf-8")) if raw else None
            return result if isinstance(result, dict) else None
        except HTTPError as exc:
            if exc.code < 500 or attempt + 1 >= attempts:
                return None
        except (URLError, TimeoutError, OSError):
            if attempt + 1 >= attempts:
                return None
        time.sleep(0.35)
    return None


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

            status_code = 202
            if result.get("isNew"):
                immediate = _attempt_immediate_collection(result["jobId"], self.headers)
                if immediate and immediate.get("status") == "DONE":
                    rank_result = immediate.get("result") if isinstance(immediate.get("result"), dict) else {}
                    result["status"] = "SUCCESS" if rank_result.get("status") == "FOUND" else "OUT_OF_RANGE"
                    result["immediate"] = True
                    result["rank"] = rank_result.get("rank")
                    status_code = 200
                else:
                    result["immediate"] = False

            self._send_json(status_code, result)
        except (ValueError, json.JSONDecodeError) as exc:
            self._send_json(400, {"error": str(exc)})
        except Exception:
            self._send_json(500, {"error": "rank request failed"})
