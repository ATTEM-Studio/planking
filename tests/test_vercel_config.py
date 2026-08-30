import json
from pathlib import Path


def test_vercel_uses_other_preset_with_file_based_python_functions():
    config = json.loads(Path("vercel.json").read_text(encoding="utf-8"))
    assert config["framework"] is None
    assert "api/**/*.py" in config["functions"]
    assert config["functions"]["api/**/*.py"]["excludeFiles"]
