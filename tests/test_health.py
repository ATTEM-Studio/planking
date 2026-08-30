from api.health import check_supabase


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return b"[]"


def test_check_supabase_queries_rank_slots_with_service_role():
    seen = {}

    def opener(request, timeout=0):
        seen["url"] = request.full_url
        seen["authorization"] = request.headers.get("Authorization")
        seen["apikey"] = request.headers.get("Apikey")
        seen["timeout"] = timeout
        return FakeResponse()

    result = check_supabase(
        url="https://example.supabase.co",
        service_role_key="secret-key",
        opener=opener,
        timeout=4,
    )

    assert result == {"ok": True, "database": "connected"}
    assert seen["url"].endswith("/rest/v1/rank_slots?select=id&limit=1")
    assert seen["authorization"] == "Bearer secret-key"
    assert seen["apikey"] == "secret-key"
    assert seen["timeout"] == 4


def test_check_supabase_rejects_missing_configuration():
    try:
        check_supabase(url="", service_role_key="", opener=lambda *_args, **_kwargs: None)
    except ValueError as exc:
        assert "SUPABASE" in str(exc)
    else:
        raise AssertionError("expected missing Supabase configuration to fail")
