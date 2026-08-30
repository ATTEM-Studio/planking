import json

from api.rank_status import SupabaseRankStatusClient


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return self.payload


def test_list_slots_returns_latest_job_rank_history_and_place_metrics():
    slot_payload = [
        {
            "id": "slot-1",
            "keyword": "경성대맛집",
            "target_mid": "1340244014",
            "place_name": "태봉곱창 부경대 본점",
            "active": True,
            "created_at": "2026-08-30T10:00:00Z",
            "rank_jobs": [
                {"id": "job-1", "status": "SUCCESS", "requested_at": "2026-08-30T10:05:00Z", "finished_at": "2026-08-30T10:06:00Z", "error_code": None, "error_message": None}
            ],
            "rank_history": [
                {"measured_date": "2026-08-30", "rank": 19, "status": "FOUND", "measured_at": "2026-08-30T10:06:00Z"},
                {"measured_date": "2026-08-29", "rank": 20, "status": "FOUND", "measured_at": "2026-08-29T10:06:00Z"},
            ],
        }
    ]
    metrics_payload = [
        {
            "target_mid": "1340244014",
            "measured_date": "2026-08-30",
            "visitor_review_count": 2082,
            "blog_review_count": 590,
            "save_count_raw": "900",
            "measured_at": "2026-08-30T10:06:00Z",
        },
        {
            "target_mid": "1340244014",
            "measured_date": "2026-08-29",
            "visitor_review_count": 2070,
            "blog_review_count": 586,
            "save_count_raw": "890",
            "measured_at": "2026-08-29T10:06:00Z",
        },
    ]
    seen = []
    responses = iter([FakeResponse(slot_payload), FakeResponse(metrics_payload)])

    def opener(request, timeout=0):
        seen.append({
            "url": request.full_url,
            "authorization": request.headers.get("Authorization"),
            "apikey": request.headers.get("Apikey"),
            "timeout": timeout,
        })
        return next(responses)

    client = SupabaseRankStatusClient(
        url="https://example.supabase.co",
        service_role_key="sb_secret_example",
        opener=opener,
        timeout=7,
    )
    result = client.list_slots()

    assert result[0]["id"] == "slot-1"
    assert result[0]["latestJob"]["status"] == "SUCCESS"
    assert result[0]["history"][0]["rank"] == 19
    assert result[0]["history"][1]["rank"] == 20
    assert result[0]["placeMetrics"][0]["visitor_review_count"] == 2082
    assert result[0]["placeMetrics"][1]["save_count_raw"] == "890"
    assert "rank_jobs" in seen[0]["url"]
    assert "rank_history" in seen[0]["url"]
    assert "place_metrics_history" in seen[1]["url"]
    assert "target_mid" in seen[1]["url"]
    assert seen[0]["authorization"] is None
    assert seen[0]["apikey"] == "sb_secret_example"
    assert seen[0]["timeout"] == 7


def test_empty_slot_list_skips_metrics_query():
    calls = 0

    def opener(request, timeout=0):
        nonlocal calls
        calls += 1
        return FakeResponse([])

    client = SupabaseRankStatusClient(
        url="https://example.supabase.co",
        service_role_key="sb_secret_example",
        opener=opener,
    )
    assert client.list_slots() == []
    assert calls == 1


def test_legacy_service_role_keeps_bearer_auth():
    legacy = "eyJhbGciOiJIUzI1NiJ9.payload.signature"

    def opener(request, timeout=0):
        assert request.headers.get("Authorization") == f"Bearer {legacy}"
        assert request.headers.get("Apikey") == legacy
        return FakeResponse([])

    client = SupabaseRankStatusClient(
        url="https://example.supabase.co",
        service_role_key=legacy,
        opener=opener,
    )
    assert client.list_slots() == []
