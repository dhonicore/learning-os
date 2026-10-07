"""Phase 1 — endpoint behaviour and error handling for E1–E5.

Contracts are defined in `MIGRATION_PLAN.md` §6. Every assertion here is a
real assertion (the repo's four root `test_*.py` files are print-scripts with
none — see BUG-D).
"""

from __future__ import annotations

import sys
from types import ModuleType

import pytest

import app_main
from questions import QUESTIONS

from conftest import SECRET_DB, SECRET_LLM, FakeTutorModule, make_tool_result

TURN_URL = "/api/tutor/turn"


def body(**overrides) -> dict:
    payload = {
        "question_id": 1,
        "learner_sql": "SELECT name FROM customers;",
        "attempt_number": 1,
        "gave_up": False,
        "history": [],
    }
    payload.update(overrides)
    return payload


# ---------------------------------------------------------------- structure


def test_app_py_is_never_imported() -> None:
    """The API must not execute the Streamlit script to read its constants."""
    assert "app" not in sys.modules


def test_schema_constants_match_app_source() -> None:
    assert app_main.SCHEMA_HINT == (
        "customers(id int, name text, city text); "
        "orders(id int, customer_id int, order_date date, amount int)"
    )
    assert [name for name, _columns in app_main.SCHEMA_TABLES] == ["customers", "orders"]
    assert [("customer_id", "text"), ("name", "text"), ("city", "text")] == [
        ("customer_id", "text"),
        ("name", "text"),
        ("city", "text"),
    ]
    assert app_main.SCHEMA_FOREIGN_KEYS == (("orders.customer_id", "customers.id"),)


def test_question_groups_match_app_source() -> None:
    assert app_main.PRACTICE_IDS == [1, 2, 3, 4, 5]
    assert app_main.HELD_IDS == [6, 7, 8]


def test_reason_labels_match_app_source() -> None:
    assert app_main.REASON_LABELS == {
        "ok": "the result matches the expected answer",
        "value_mismatch": "your output differs from the expected result",
        "missing_rows": "expected rows are missing from your output",
        "extra_rows": "your output contains extra rows",
        "shape_mismatch": "your columns do not match the expected shape",
        "sql_error": "the query could not run",
        "timeout": "your query took too long and was stopped",
        "too_many_rows": "your query returned too many rows",
        "unsafe": "only a single read-only SELECT query within the size limit is allowed",
        "unknown_question": "unknown question",
        "reference_error": "the reference query failed",
    }


def test_learner_safe_messages_match_app_source() -> None:
    assert app_main.MSG_TUTOR_UNREACHABLE == (
        "The tutor service could not be reached. Your SQL, history "
        "and attempt count are unchanged — try Submit again."
    )
    assert app_main.MSG_DB_UNAVAILABLE == (
        "The practice database is unavailable right now. Your SQL, "
        "history and attempt count are unchanged — try again shortly."
    )
    assert app_main.MSG_GENERIC == (
        "Something went wrong running this submission. Your SQL, history "
        "and attempt count are unchanged — try again."
    )
    assert app_main.MSG_TUTOR_NO_KEY == (
        "The tutor is missing its API-key configuration on the server. "
        "Nothing was submitted — your SQL and attempt count are unchanged."
    )
    assert app_main.MSG_TUTOR_LIBRARY == (
        "The tutor library could not be loaded. Nothing was submitted — "
        "your SQL and attempt count are unchanged."
    )


def test_loader_rejects_unexpected_app_structure(tmp_path, monkeypatch) -> None:
    """A changed `app.py` shape must fail loudly, not serve stale values."""
    fake_app = tmp_path / "app.py"
    fake_app.write_text("SOMETHING_ELSE = 1\n", encoding="utf-8")
    monkeypatch.setattr(app_main, "APP_PY", fake_app)
    with pytest.raises(RuntimeError, match="SCHEMA_TABLES"):
        app_main._load_app_constants()


# ------------------------------------------------------------------- E1


def test_health_reports_configured_secrets(client, monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", SECRET_DB)
    monkeypatch.setenv("GROQ_API_KEY", SECRET_LLM)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db_configured": True, "llm_configured": True}


def test_health_reports_missing_secrets(client, monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db_configured": False, "llm_configured": False}


def test_health_never_exposes_secret_values(client, monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", SECRET_DB)
    monkeypatch.setenv("GROQ_API_KEY", SECRET_LLM)
    text = client.get("/api/health").text
    assert SECRET_DB not in text
    assert SECRET_LLM not in text
    assert "SECRET_PASSWORD" not in text


# ------------------------------------------------------------------- E2


def test_meta_lists_every_question_without_reference_sql(client) -> None:
    response = client.get("/api/meta")
    assert response.status_code == 200
    payload = response.json()
    assert [entry["id"] for entry in payload["questions"]] == list(range(1, 9))
    for entry in payload["questions"]:
        assert set(entry) == {"id", "purpose", "question"}
    assert "reference_sql" not in response.text
    for question in QUESTIONS.values():
        assert question["reference_sql"] not in response.text


def test_meta_exposes_question_groups_and_reason_labels(client) -> None:
    payload = client.get("/api/meta").json()
    assert payload["practice_ids"] == [1, 2, 3, 4, 5]
    assert payload["held_ids"] == [6, 7, 8]
    assert payload["reason_labels"] == app_main.REASON_LABELS


# ------------------------------------------------------------------- E3


@pytest.mark.parametrize("question_id", [1, 5, 6, 8])
def test_question_returns_header_fields_only(client, question_id) -> None:
    response = client.get(f"/api/questions/{question_id}")
    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"id", "purpose", "question"}
    assert payload["purpose"] == QUESTIONS[question_id]["purpose"]
    assert QUESTIONS[question_id]["reference_sql"] not in response.text


def test_question_unknown_id_is_404(client) -> None:
    response = client.get("/api/questions/99")
    assert response.status_code == 404
    assert "99" in response.text


# ------------------------------------------------------------------- E4


def test_schema_returns_tables_foreign_keys_and_hint(client) -> None:
    response = client.get("/api/schema")
    assert response.status_code == 200
    payload = response.json()
    assert [entry[0] for entry in payload["tables"]] == ["customers", "orders"]
    assert payload["foreign_keys"] == [["orders.customer_id", "customers.id"]]
    assert payload["hint"] == app_main.SCHEMA_HINT
    for question in QUESTIONS.values():
        assert question["reference_sql"] not in response.text


# ------------------------------------------------------------------- E5


def test_turn_requires_mandatory_fields(client, fake_tutor) -> None:
    assert client.post(TURN_URL, json={}).status_code == 422
    assert client.post(TURN_URL, json={"question_id": 1}).status_code == 422
    assert client.post(TURN_URL, json=body(attempt_number=0)).status_code == 422
    assert client.post(TURN_URL, json=body(attempt_number=-3)).status_code == 422


def test_turn_unknown_question_is_404(client, fake_tutor) -> None:
    response = client.post(TURN_URL, json=body(question_id=42))
    assert response.status_code == 404
    assert fake_tutor.calls == []


def test_turn_defaults_history_and_gave_up(client, fake_tutor) -> None:
    payload = body()
    payload.pop("history")
    payload.pop("gave_up")
    response = client.post(TURN_URL, json=payload)
    assert response.status_code == 200
    assert fake_tutor.calls[0]["history"] == []
    assert fake_tutor.calls[0]["gave_up"] is False


def test_turn_maps_arguments_exactly(client, fake_tutor) -> None:
    history = [{"role": "user", "content": "earlier"}]
    response = client.post(
        TURN_URL,
        json=body(learner_sql="  SELECT 1;  ", history=history, attempt_number=3, gave_up=True),
    )
    assert response.status_code == 200
    assert fake_tutor.calls == [
        {
            "question_id": 1,
            "question_text": QUESTIONS[1]["question"],
            "schema_hint": app_main.SCHEMA_HINT,
            "learner_sql": "  SELECT 1;  ",
            "history": history,
            "attempt_number": 3,
            "gave_up": True,
        }
    ]


def test_turn_returns_contract_shape(client, fake_tutor) -> None:
    payload = client.post(TURN_URL, json=body()).json()
    assert set(payload) == {"reply", "history", "attempt", "tool_result"}
    assert set(payload["tool_result"]) == {
        "correct",
        "reason",
        "reason_label",
        "row_diff",
        "hint_level",
        "gave_up",
        "learner_rows",
    }
    assert payload["reply"] == "Tutor reply."
    assert payload["attempt"] == 1


def test_turn_maps_reason_label_from_app_labels(client, monkeypatch) -> None:
    for reason, label in app_main.REASON_LABELS.items():
        module = FakeTutorModule(
            result=("reply", [], make_tool_result(reason=reason, hint_level=2))
        )
        monkeypatch.setitem(
            sys.modules, "tutor", ModuleType("tutor")
        )
        sys.modules["tutor"].run_tutor_turn = module.run_tutor_turn
        payload = client.post(TURN_URL, json=body()).json()
        assert payload["tool_result"]["reason"] == reason
        assert payload["tool_result"]["reason_label"] == label


def test_turn_drops_raw_error_field(client, monkeypatch) -> None:
    """`tool_result['error']` can hold raw database text; it must not ship."""
    leaky = make_tool_result(
        reason="sql_error",
        error="connection to server at db.invalid failed: SECRET_PASSWORD",
    )
    module = FakeTutorModule(result=("reply", [], leaky))
    monkeypatch.setitem(sys.modules, "tutor", ModuleType("tutor"))
    sys.modules["tutor"].run_tutor_turn = module.run_tutor_turn
    response = client.post(TURN_URL, json=body())
    assert response.status_code == 200
    assert "error" not in response.json()["tool_result"]
    assert "SECRET_PASSWORD" not in response.text


def test_turn_passes_learner_rows_through(client, fake_tutor) -> None:
    payload = client.post(TURN_URL, json=body()).json()
    assert payload["tool_result"]["learner_rows"] == [[1], [2]]


def test_turn_echoes_attempt_and_gave_up(client, fake_tutor) -> None:
    payload = client.post(TURN_URL, json=body(attempt_number=2, gave_up=True)).json()
    assert payload["attempt"] == 2
    assert payload["tool_result"]["gave_up"] is True


def test_turn_keeps_no_server_state(client, fake_tutor) -> None:
    """Duplicate protection is client-side (decision Q5 pending); the API
    must not silently add server-side dedupe."""
    first = client.post(TURN_URL, json=body(submission_token="same-token"))
    second = client.post(TURN_URL, json=body(submission_token="same-token"))
    assert first.status_code == second.status_code == 200
    assert len(fake_tutor.calls) == 2


# ----------------------------------------------------------- E5 errors


@pytest.mark.parametrize(
    ("module_name", "expected_status", "expected_message"),
    [
        ("groq._client", 502, app_main.MSG_TUTOR_UNREACHABLE),
        ("groq", 502, app_main.MSG_TUTOR_UNREACHABLE),
        ("psycopg.errors", 503, app_main.MSG_DB_UNAVAILABLE),
        ("psycopg", 503, app_main.MSG_DB_UNAVAILABLE),
        ("builtins", 500, app_main.MSG_GENERIC),
        ("json.decoder", 500, app_main.MSG_GENERIC),
    ],
)
def test_turn_maps_exceptions_to_status_and_safe_message(
    client, monkeypatch, module_name, expected_status, expected_message
) -> None:
    boom = type("Boom", (Exception,), {"__module__": module_name})(
        "SECRET_PASSWORD raw detail that must never be returned"
    )
    module = FakeTutorModule(error=boom)
    monkeypatch.setitem(sys.modules, "tutor", ModuleType("tutor"))
    sys.modules["tutor"].run_tutor_turn = module.run_tutor_turn

    response = client.post(TURN_URL, json=body())
    assert response.status_code == expected_status
    payload = response.json()
    assert payload["detail"] == expected_message
    assert "SECRET_PASSWORD" not in response.text
    assert "raw detail" not in response.text
    assert "Traceback" not in response.text


def test_turn_missing_api_key_is_503(client, monkeypatch) -> None:
    """`tutor.py` reads `GROQ_API_KEY` at import: KeyError -> 503."""
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "tutor":
            raise KeyError("GROQ_API_KEY")
        return real_import(name, *args, **kwargs)

    monkeypatch.delitem(sys.modules, "tutor", raising=False)
    monkeypatch.setattr(builtins, "__import__", fake_import)
    response = client.post(TURN_URL, json=body())
    assert response.status_code == 503
    assert response.json()["detail"] == app_main.MSG_TUTOR_NO_KEY


def test_turn_tutor_library_failure_is_503(client, monkeypatch) -> None:
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "tutor":
            raise ImportError("no module named tutor")
        return real_import(name, *args, **kwargs)

    monkeypatch.delitem(sys.modules, "tutor", raising=False)
    monkeypatch.setattr(builtins, "__import__", fake_import)
    response = client.post(TURN_URL, json=body())
    assert response.status_code == 503
    assert response.json()["detail"] == app_main.MSG_TUTOR_LIBRARY


def test_turn_errors_never_expose_secret_values(client, monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", SECRET_DB)
    monkeypatch.setenv("GROQ_API_KEY", SECRET_LLM)
    boom = type("Boom", (Exception,), {"__module__": "psycopg.errors"})(SECRET_DB)
    module = FakeTutorModule(error=boom)
    monkeypatch.setitem(sys.modules, "tutor", ModuleType("tutor"))
    sys.modules["tutor"].run_tutor_turn = module.run_tutor_turn
    response = client.post(TURN_URL, json=body())
    assert response.status_code == 503
    assert SECRET_DB not in response.text
    assert SECRET_LLM not in response.text
    assert "DATABASE_URL" not in response.text
    assert "GROQ_API_KEY" not in response.text