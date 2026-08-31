from pathlib import Path


WORKFLOW = Path('.github/workflows/rank-worker.yml')


def test_rank_worker_has_rollout_trigger_and_staggered_schedule():
    text = WORKFLOW.read_text(encoding='utf-8')

    assert 'workflow_dispatch:' in text
    assert 'push:' in text
    assert 'branches: [main]' in text
    assert "- 'collector/**'" in text
    assert "- 'supabase/migrations/**'" in text
    assert "- '.github/workflows/rank-worker.yml'" in text
    assert "cron: '3-58/5 * * * *'" in text
    assert "cron: '*/5 * * * *'" not in text
