import json

import pytest

from api.rank_request import SupabaseRankRequestClient, process_payload


class FakeClient:
    def __init__(self):
        self.calls = []

    def enqueue_rank_request(self, keyword, target_mid, place_name):
        self.calls.append((keyword, target_mid, place_name))
        return {"slotId": "slot-1", "jobId": "job-1", "status": "PENDING"}


def test_blank_keyword_is_rejected():
    with pytest.raises(ValueError, match="keyword is required"):
        process_payload({"keyword": "  ", "targetPlaceId": "1"}, FakeClient())


def test_blank_target_place_id_is_rejected():
    with pytest.raises(ValueError, match="targetPlaceId is required"):
        process_payload({"keyword": "x", "targetPlaceId": " "}, FakeClient())


def test_valid_payload_is_trimmed_and_enqueued():
    client = FakeClient()
    result = process_payload(
        {"keyword": " 경성대맛집 ", "targetPlaceId": " 1340244014 ", "placeName": " 태봉곱창 부경대 본점 "},
        client,
    )
    assert client.calls == [("경성대맛집", "1340244014", "태봉곱창 부경대 본점")]
    assert result == {"slotId": "slot-1", "jobId": "job-1", "status": "PENDING"}


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return self.payload


def _run_enqueue(key):
    requests = []
    responses = iter([
        FakeResponse([{"id": "slot-1"}]),
        FakeResponse([{"id": "job-1"}]),
    ])

    def opener(request, timeout):
        requests.append((request, timeout))
        return next(responses)

    client = SupabaseRankRequestClient(
        url="https://db.test",
        service_role_key=key,
        opener=opener,
    )
    result = client.enqueue_rank_request("경성대맛집", "1340244014", "태봉곱창")
    return result, requests


def test_supabase_client_uses_apikey_only_for_new_secret_key():
    result, requests = _run_enqueue("sb_secret_example")
    assert result == {"slotId": "slot-1", "jobId": "job-1", "status": "PENDING"}
    first = requests[0][0]
    assert "rank_slots?on_conflict=keyword,target_mid&select=id" in first.full_url
    assert first.get_header("Authorization") is None
    assert first.get_header("Apikey") == "sb_secret_example"
    first_body = json.loads(first.data.decode("utf-8"))
    assert first_body["target_mid"] == "1340244014"

    second = requests[1][0]
    second_body = json.loads(second.data.decode("utf-8"))
    assert second_body == {"slot_id": "slot-1", "status": "PENDING"}


def test_supabase_client_keeps_bearer_for_legacy_service_role_jwt():
    legacy = "eyJhbGciOiJIUzI1NiJ9.payload.signature"
    _result, requests = _run_enqueue(legacy)
    first = requests[0][0]
    assert first.get_header("Authorization") == f"Bearer {legacy}"
    assert first.get_header("Apikey") == legacy
