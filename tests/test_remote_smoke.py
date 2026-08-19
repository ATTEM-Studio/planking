from pathlib import Path


def test_vercel_runtime_files_exist():
    root = Path(__file__).resolve().parents[1]
    assert (root / "index.html").exists()
    assert (root / "api" / "analyze.py").exists()
    assert (root / "artifacts" / "calibration.json").exists()
