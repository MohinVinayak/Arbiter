r"""
Arbiter backend – integration + unit tests.
Run with:  c:\EvalForge\backend\venv\Scripts\python.exe -m pytest tests/ -v
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# ---------------------------------------------------------------------------
# Override the database with an in-memory SQLite instance BEFORE importing app
# ---------------------------------------------------------------------------
import os
os.environ["DATABASE_URL"] = "sqlite:///./test.db"

from app.database import Base, get_db, engine   # noqa: E402
from app.main import app                        # noqa: E402

Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)
_TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def _override_get_db():
    db = _TestingSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_get_db

client = TestClient(app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SAMPLE_SUITE = {
    "name": "Smoke Test Suite",
    "description": "Basic sanity checks",
    "cases": [
        {
            "prompt_template": "Say hello",
            "expected_output": "Hello",
            "checks": [{"type": "min_length", "value": 1}],
        }
    ],
}


def _create_suite(payload=None) -> dict:
    payload = payload or SAMPLE_SUITE
    r = client.post("/api/suites/", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# Models endpoint
# ---------------------------------------------------------------------------

def test_models_returns_list():
    r = client.get("/api/models")
    assert r.status_code == 200
    data = r.json()
    assert "models" in data
    assert isinstance(data["models"], list)


# ---------------------------------------------------------------------------
# Suite CRUD
# ---------------------------------------------------------------------------

def test_create_suite():
    suite = _create_suite()
    assert suite["name"] == SAMPLE_SUITE["name"]
    assert suite["test_case_count"] == 1
    assert "id" in suite


def test_list_suites():
    _create_suite()
    r = client.get("/api/suites/")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1


def test_get_suite():
    suite = _create_suite()
    r = client.get(f"/api/suites/{suite['id']}")
    assert r.status_code == 200
    detail = r.json()
    assert detail["id"] == suite["id"]
    assert len(detail["test_cases"]) == 1


def test_get_suite_not_found():
    r = client.get("/api/suites/nonexistent-id")
    assert r.status_code == 404


def test_update_suite():
    suite = _create_suite()
    updated = {
        "name": "Updated Suite",
        "description": "New desc",
        "cases": [
            {"prompt_template": "What is 2+2?", "expected_output": "4"},
            {"prompt_template": "Capital of France?", "expected_output": "Paris"},
        ],
    }
    r = client.put(f"/api/suites/{suite['id']}", json=updated)
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Updated Suite"
    assert data["test_case_count"] == 2


def test_delete_suite():
    suite = _create_suite({"name": "To Delete", "cases": []})
    r = client.delete(f"/api/suites/{suite['id']}")
    assert r.status_code == 200
    # Verify it's gone
    r2 = client.get(f"/api/suites/{suite['id']}")
    assert r2.status_code == 404


def test_create_suite_skips_blank_cases():
    payload = {
        "name": "Blank Check",
        "cases": [
            {"prompt_template": "   ", "expected_output": ""},  # blank – should be skipped
            {"prompt_template": "Real prompt", "expected_output": ""},
        ],
    }
    suite = _create_suite(payload)
    assert suite["test_case_count"] == 1


# ---------------------------------------------------------------------------
# Settings CRUD
# ---------------------------------------------------------------------------

def test_get_settings_returns_server_keys():
    r = client.get("/api/settings/")
    assert r.status_code == 200
    data = r.json()
    assert "server_keys" in data
    assert isinstance(data["server_keys"], dict)


def test_settings_no_post():
    """Settings endpoint is read-only — POST should return 405."""
    r = client.post("/api/settings/", json={"gemini_api_key": "test-key-abc"})
    assert r.status_code == 405


# ---------------------------------------------------------------------------
# Runs list (no eval — avoids hitting real APIs in CI)
# ---------------------------------------------------------------------------

def test_list_runs_empty():
    r = client.get("/api/runs/")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_evaluate_missing_suite():
    r = client.post(
        "/api/runs/evaluate",
        json={"suiteId": "does-not-exist", "models": ["google/gemini-2.0-flash"]},
    )
    assert r.status_code == 404


def test_evaluate_no_test_cases():
    suite = _create_suite({"name": "Empty", "cases": []})
    r = client.post(
        "/api/runs/evaluate",
        json={"suiteId": suite["id"], "models": ["google/gemini-2.0-flash"]},
    )
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Evaluator unit tests (no LLM calls)
# ---------------------------------------------------------------------------

from app.services.evaluator import (   # noqa: E402
    run_deterministic_checks,
    compute_overall_score,
    _parse_judge_response,
)


def test_deterministic_max_length_pass():
    result = run_deterministic_checks("hi", [{"type": "max_length", "value": 10}])
    assert result["score"] == 1.0


def test_deterministic_max_length_fail():
    result = run_deterministic_checks("hello world", [{"type": "max_length", "value": 5}])
    assert result["score"] == 0.0


def test_deterministic_must_contain_pass():
    result = run_deterministic_checks("The sky is blue", [{"type": "must_contain", "value": "blue"}])
    assert result["score"] == 1.0


def test_deterministic_must_contain_fail():
    result = run_deterministic_checks("The sky is blue", [{"type": "must_contain", "value": "red"}])
    assert result["score"] == 0.0


def test_deterministic_must_not_contain():
    result = run_deterministic_checks("clean output", [{"type": "must_not_contain", "value": "badword"}])
    assert result["score"] == 1.0


def test_deterministic_starts_with():
    result = run_deterministic_checks("Hello world", [{"type": "starts_with", "value": "Hello"}])
    assert result["score"] == 1.0


def test_deterministic_is_json_pass():
    result = run_deterministic_checks('{"key": "value"}', [{"type": "is_json", "value": None}])
    assert result["score"] == 1.0


def test_deterministic_is_json_fail():
    result = run_deterministic_checks("not json", [{"type": "is_json", "value": None}])
    assert result["score"] == 0.0


def test_deterministic_regex_match():
    result = run_deterministic_checks("abc123", [{"type": "regex_match", "value": r"\d+"}])
    assert result["score"] == 1.0


def test_deterministic_no_checks():
    result = run_deterministic_checks("anything", [])
    assert result["score"] is None


def test_deterministic_no_output():
    result = run_deterministic_checks(None, [{"type": "max_length", "value": 100}])
    assert result["score"] is None


def test_deterministic_multiple_checks_partial():
    checks = [
        {"type": "must_contain", "value": "hello"},
        {"type": "max_length", "value": 3},   # will fail
    ]
    result = run_deterministic_checks("hello world", checks)
    assert result["score"] == 0.5


def test_compute_overall_all_three():
    score = compute_overall_score(1.0, 1.0, 1.0)
    assert score == 1.0


def test_compute_overall_none_inputs():
    score = compute_overall_score(None, None, None)
    assert score is None


def test_compute_overall_two_layers():
    # 0.4 weight det + 0.3 weight judge → weighted avg = (1.0*0.4 + 0.5*0.3) / 0.7
    score = compute_overall_score(1.0, None, 0.5)
    expected = round((1.0 * 0.4 + 0.5 * 0.3) / 0.7, 4)
    assert abs(score - expected) < 0.001


def test_parse_judge_response_valid():
    response = "SCORE: 0.85\nREASONING: Good overall response"
    result = _parse_judge_response(response)
    assert result["score"] == 0.85
    assert "Good" in result["reasoning"]


def test_parse_judge_response_invalid():
    result = _parse_judge_response("garbage output")
    assert result["score"] is None
    assert "parse" in result["reasoning"].lower()
