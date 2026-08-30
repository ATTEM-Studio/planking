from __future__ import annotations

import json
import os
import uuid
from http.server import BaseHTTPRequestHandler
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen


def normalize_slot_id(value: str) -> str:
    text = str(value or "").strip()
    try:
        return str(uuid.UUID(text))
    except (ValueError, AttributeError, TypeError) as exc:
        raise ValueError("slotId must be a valid UUID") from exc


def _supabase_headers(key: str) -> dict[str, str]:
    headers = {
        "apikey": key,
        "Accept": "application/json",
    }
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


class SupabaseRankManageClient:
    def __init__(self, *, url: str, service_role_key: str, opener=urlopen, timeout: int = 15):
        self.url = str(url or "").strip().rstrip("/")
        self.service_role_key = str(service_role_key or "").strip()
        if not self.url:
            raise ValueError("SUPABASE_URL is required")
        if not self.service_role_key:
            raise ValueError("SUPABASE_SERVICE_ROLE_KEY is required")
        self.opener = opener
        self.timeout = timeout

    def _request(self, path: str, *, method: str = "GET", prefer: str | None = None) -> Any:
        headers = _supabase_headers(self.service_role_key)
        if prefer:
            headers["Prefer"] = prefer
        request = Request(f"{self.url}{path}", method=method, headers=headers)
        with self.opener(request, timeout=self.timeout) as response:
            raw = response.read()
        return json.loads(raw.decode("utf-8")) if raw else None

    def get_detail(self, slot_id: str) -> dict[str, Any]:
        slot_id = normalize_slot_id(slot_id)
        slot_query = urlencode({
            "id": f"eq.{slot_id}",
            "select": "id,keyword,target_mid,place_name,created_at",
            "limit": "1",
        })
        slot_rows = self._request(f"/rest/v1/rank_slots?{slot_query}")
        if not isinstance(slot_rows, list) or not slot_rows:
            raise LookupError("rank slot not found")

        history_query = urlencode({
            "slot_id": f"eq.{slot_id}",
            "select": "measured_date,rank,status,measured_at,pages_scanned,items_scanned",
            "order": "measured_date.desc",
        })
        history_rows = self._request(f"/rest/v1/rank_history?{history_query}")
        if not isinstance(history_rows, list):
            history_rows = []

        row = slot_rows[0]
        return {
            "id": str(row.get("id") or slot_id),
            "keyword": str(row.get("keyword") or ""),
            "targetMid": str(row.get("target_mid") or ""),
            "placeName": row.get("place_name"),
            "createdAt": row.get("created_at"),
            "history": history_rows,
        }

    def hard_delete(self, slot_id: str) -> dict[str, Any]:
        slot_id = normalize_slot_id(slot_id)
        query = urlencode({"id": f"eq.{slot_id}", "select": "id"})
        rows = self._request(
            f"/rest/v1/rank_slots?{query}",
            method="DELETE",
            prefer="return=representation",
        )
        if not isinstance(rows, list) or not rows:
            raise LookupError("rank slot not found")
        return {"deleted": True, "slotId": slot_id}


def _client_from_env() -> SupabaseRankManageClient:
    return SupabaseRankManageClient(
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

    def _slot_id(self) -> str:
        params = parse_qs(urlparse(self.path).query)
        return normalize_slot_id((params.get("slotId") or [""])[0])

    def do_GET(self) -> None:
        try:
            self._send_json(200, _client_from_env().get_detail(self._slot_id()))
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
        except LookupError as exc:
            self._send_json(404, {"error": str(exc)})
        except Exception:
            self._send_json(500, {"error": "rank detail failed"})

    def do_DELETE(self) -> None:
        try:
            self._send_json(200, _client_from_env().hard_delete(self._slot_id()))
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
        except LookupError as exc:
            self._send_json(404, {"error": str(exc)})
        except Exception:
            self._send_json(500, {"error": "rank delete failed"})
