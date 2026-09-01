import json
from pathlib import Path


def test_first_registration_api_completes_immediate_collection_server_side():
    request_api = Path("api/rank_request.py").read_text(encoding="utf-8")
    package = Path("package.json").read_text(encoding="utf-8")
    vercel = Path("vercel.json").read_text(encoding="utf-8")

    assert "isNew" in request_api
    assert "_attempt_immediate_collection" in request_api
    assert "/api/rank_collect" in request_api
    assert Path("api/rank_collect.mjs").exists()
    assert Path("api/chromium-runtime.mjs").exists()
    assert "@sparticuz/chromium" in package
    assert "playwright-core" in package
    assert '"api/rank_collect.mjs"' in vercel


def test_immediate_rank_collector_runs_in_seoul_region():
    config = json.loads(Path("vercel.json").read_text(encoding="utf-8"))
    rank_collect = config["functions"]["api/rank_collect.mjs"]

    assert rank_collect["regions"] == ["icn1"]


def test_existing_keyword_recheck_remains_queue_only():
    request_api = Path("api/rank_request.py").read_text(encoding="utf-8")

    # Only a newly-created slot is synchronously collected. Existing tracked
    # keywords continue to use the durable queue worker path.
    assert 'if result.get("isNew")' in request_api
