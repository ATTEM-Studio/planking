from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler
from typing import Any

from api.rank_manage import SupabaseRankManageClient
from api.rank_request import _attempt_immediate_collection, _client_from_env, process_payload


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
        slot_id = None
        try:
            result = process_payload(
                {
                    "keyword": "하단역꿈카페",
                    "targetPlaceId": "1328453904",
                    "placeName": "꿈카페 하단지점",
                },
                _client_from_env(),
            )
            slot_id = result["slotId"]
            immediate = _attempt_immediate_collection(result["jobId"], self.headers)
            if not immediate or immediate.get("status") != "DONE":
                self._send_json(500, {"ok": False, "request": result, "immediate": immediate})
                return
            rank_result = immediate.get("result") if isinstance(immediate.get("result"), dict) else {}
            self._send_json(200, {
                "ok": True,
                "isNew": result.get("isNew"),
                "status": rank_result.get("status"),
                "rank": rank_result.get("rank"),
                "errorCode": rank_result.get("errorCode"),
            })
        except Exception as exc:
            self._send_json(500, {"ok": False, "error": str(exc)})
        finally:
            if slot_id:
                try:
                    SupabaseRankManageClient(
                        url=os.environ.get("SUPABASE_URL", ""),
                        service_role_key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
                    ).hard_delete(slot_id)
                except Exception:
                    pass
