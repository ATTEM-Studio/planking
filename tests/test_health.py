from api.health import check_supabase


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return b"[]"


def _capture_headers(key: str):
    seen = {}

    def opener(request, timeout=0):
        seen["url"] = request.full_url
        seen["authorization"] = request.headers.get("Authorization")
        seen["apikey"] = request.headers.get("Apikey")
        seen["timeout"] = timeout
        return FakeResponse()

    result = check_supabase(
        url="https://example.supabase.co",
        service_role_key=key,
        opener=opener,
        timeout=4,
    )
    return result, seen


def test_check_supabase_uses_apikey_only_for_new_secret_key():
    result, seen = _capture_headers("sb_secret_example")
    assert result == {"ok": True, "database": "connected"}
    assert seen["url"].endswith("/rest/v1/rank_slots?select=id&limit=1")
    assert seen["authorization"] is None
    assert seen["apikey"] == "sb_secret_example"
    assert seen["timeout"] == 4


def test_check_supabase_keeps_bearer_for_legacy_service_role_jwt():
    legacy = "eyJhbGciOiJIUzI1NiJ9.payload.signature"
    _result, seen = _capture_headers(legacy)
    assert seen["authorization"] == f"Bearer {legacy}"
    assert seen["apikey"] == legacy


def test_check_supabase_rejects_missing_configuration():
    try:
        check_supabase(url="", service_role_key="", opener=lambda *_args, **_kwargs: None)
    except ValueError as exc:
        assert "SUPABASE" in str(exc)
    else:
        raise AssertionError("expected missing Supabase configuration to fail")
