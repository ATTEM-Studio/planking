import json

from api.rank_manage import SupabaseRankManageClient, normalize_slot_id


class FakeResponse:
    def __init__(self, payload=None):
        self.payload = json.dumps(payload if payload is not None else []).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return self.payload


def test_normalize_slot_id_requires_uuid():
    assert normalize_slot_id("5bf0b253-133e-4054-9c93-17f88383d8f8") == "5bf0b253-133e-4054-9c93-17f88383d8f8"
    try:
        normalize_slot_id("not-a-uuid")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_get_detail_returns_slot_and_full_history_ordered_desc():
    seen = []
    responses = iter([
        FakeResponse([{
            "id": "5bf0b253-133e-4054-9c93-17f88383d8f8",
            "keyword": "하단카페",
            "target_mid": "1328453904",
            "place_name": "꿈카페 하단지점",
            "created_at": "2026-08-01T00:00:00Z",
        }]),
        FakeResponse([
            {"measured_date": "2026-08-30", "rank": 19, "status": "FOUND", "measured_at": "2026-08-30T11:06:44Z"},
            {"measured_date": "2026-08-29", "rank": 20, "status": "FOUND", "measured_at": "2026-08-29T11:06:44Z"},
        ]),
    ])

    def opener(request, timeout=0):
        seen.append((request.get_method(), request.full_url, request.headers.get("Apikey")))
        return next(responses)

    client = SupabaseRankManageClient(
        url="https://example.supabase.co",
        service_role_key="sb_secret_example",
        opener=opener,
    )
    result = client.get_detail("5bf0b253-133e-4054-9c93-17f88383d8f8")

    assert result["keyword"] == "하단카페"
    assert [row["rank"] for row in result["history"]] == [19, 20]
    assert seen[0][0] == "GET"
    assert "rank_slots" in seen[0][1]
    assert seen[1][0] == "GET"
    assert "rank_history" in seen[1][1]
    assert "order=measured_date.desc" in seen[1][1]
    assert seen[0][2] == "sb_secret_example"


def test_hard_delete_deletes_slot_and_relies_on_fk_cascade():
    seen = {}

    def opener(request, timeout=0):
        seen["method"] = request.get_method()
        seen["url"] = request.full_url
        seen["prefer"] = request.headers.get("Prefer")
        return FakeResponse([{"id": "5bf0b253-133e-4054-9c93-17f88383d8f8"}])

    client = SupabaseRankManageClient(
        url="https://example.supabase.co",
        service_role_key="sb_secret_example",
        opener=opener,
    )
    result = client.hard_delete("5bf0b253-133e-4054-9c93-17f88383d8f8")

    assert result == {"deleted": True, "slotId": "5bf0b253-133e-4054-9c93-17f88383d8f8"}
    assert seen["method"] == "DELETE"
    assert "rank_slots?id=eq.5bf0b253-133e-4054-9c93-17f88383d8f8" in seen["url"]
    assert seen["prefer"] == "return=representation"
