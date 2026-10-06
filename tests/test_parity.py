"""Phase 1 — parity: the HTTP endpoint must be a faithful wrapper.

For the same inputs, calling `run_tutor_turn` directly and calling it
through `POST /api/tutor/turn` must produce the same `tool_result`. The LLM
is stubbed, so these tests are deterministic and need no network; the
checker is stubbed too, except in the real-database test at the end.
"""

from __future__ import annotations

import pytest

import app_main

TURN_URL = "/api/tutor/turn"


def turn(client, **overrides) -> dict:
    payload = {
        "question_id": 1,
        "learner_sql": "SELECT name FROM customers;",
        "attempt_number": 1,
        "gave_up": False,
        "history": [],
    }
    payload.update(overrides)
    response = client.post(TURN_URL, json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def direct(tutor, **kwargs):
    arguments = {
        "question_id": 1,
        "question_text": app_main.QUESTIONS[1]["question"],
        "schema_hint": app_main.SCHEMA_HINT,
        "learner_sql": "SELECT name FROM customers;",
        "history": [],
        "attempt_number": 1,
        "gave_up": False,
    }
    arguments.update(kwargs)
    return tutor.run_tutor_turn(**arguments)


def test_correct_answer_parity(client, real_tutor) -> None:
    real_tutor.set_tool_result(
        {"correct": True, "reason": "ok", "row_diff": (2, 2), "learner_rows": [(1,), (2,)]}
    )
    _reply, _history, tool_result = direct(real_tutor)
    http_tool_result = turn(client)["tool_result"]
    assert http_tool_result == {
        "correct": True,
        "reason": "ok",
        "reason_label": app_main.REASON_LABELS["ok"],
        "row_diff": [2, 2],
        "hint_level": tool_result["hint_level"],
        "gave_up": False,
        "learner_rows": [[1], [2]],
    }
    assert tool_result["hint_level"] == 0


@pytest.mark.parametrize("attempt_number", [1, 2, 3])
def test_hint_ladder_parity_for_incorrect_answers(client, real_tutor, attempt_number) -> None:
    real_tutor.set_tool_result(
        {
            "correct": False,
            "reason": "value_mismatch",
            "row_diff": (1, 2),
            "learner_rows": [(1,)],
        }
    )
    _reply, _history, tool_result = direct(real_tutor, attempt_number=attempt_number)
    http_tool_result = turn(client, attempt_number=attempt_number)["tool_result"]
    assert http_tool_result["hint_level"] == tool_result["hint_level"] == attempt_number
    assert http_tool_result["correct"] is False
    assert http_tool_result["reason"] == "value_mismatch"
    assert http_tool_result["row_diff"] == [1, 2]


def test_give_up_parity_reaches_level_four(client, real_tutor) -> None:
    real_tutor.set_tool_result(
        {
            "correct": False,
            "reason": "value_mismatch",
            "row_diff": (0, 3),
            "learner_rows": [],
        }
    )
    _reply, _history, tool_result = direct(real_tutor, gave_up=True)
    http_tool_result = turn(client, gave_up=True)["tool_result"]
    assert tool_result["hint_level"] == 4
    assert http_tool_result["hint_level"] == 4
    assert http_tool_result["gave_up"] is True


def test_unsafe_sql_parity(client, real_tutor) -> None:
    real_tutor.set_tool_result(
        {
            "correct": False,
            "reason": "unsafe",
            "row_diff": (0, 0),
            "learner_rows": [],
        }
    )
    _reply, _history, tool_result = direct(real_tutor)
    http_tool_result = turn(client)["tool_result"]
    assert http_tool_result["reason"] == "unsafe"
    assert http_tool_result["reason_label"] == app_main.REASON_LABELS["unsafe"]
    assert http_tool_result["hint_level"] == tool_result["hint_level"]


def test_reference_sql_never_sent_to_model_below_level_four(client, real_tutor) -> None:
    """The hint policy must still hide the reference answer from the model."""
    real_tutor.set_tool_result(
        {
            "correct": False,
            "reason": "value_mismatch",
            "row_diff": (1, 2),
            "learner_rows": [(1,)],
        }
    )
    reference_sql = app_main.QUESTIONS[1]["reference_sql"]

    for attempt_number in (1, 2, 3):
        real_tutor.llm.calls.clear()
        turn(client, attempt_number=attempt_number)
        sent = "\n".join(
            str(message.get("content", ""))
            for message in real_tutor.llm.calls[0]["messages"]
        )
        assert reference_sql not in sent

    real_tutor.llm.calls.clear()
    turn(client, attempt_number=4)
    sent = "\n".join(
        str(message.get("content", ""))
        for message in real_tutor.llm.calls[0]["messages"]
    )
    assert reference_sql in sent


def test_history_is_round_tripped_unchanged(client, real_tutor) -> None:
    real_tutor.set_tool_result(
        {"correct": True, "reason": "ok", "row_diff": (1, 1), "learner_rows": [(1,)]}
    )
    history = [
        {"role": "user", "content": "Question #1 ..."},
        {"role": "assistant", "content": "Earlier hint."},
    ]
    _reply, updated_history, _tool_result = direct(real_tutor, history=history)
    payload = turn(client, history=history)
    assert payload["history"][:2] == history
    assert len(payload["history"]) == len(updated_history) == 4


def test_real_database_checker_parity(client, real_tutor, db_available) -> None:
    """Same check against the real Supabase PostgreSQL checker.

    `set_tool_result` is never called here, so `tutor.execute_tool` is the
    real checker and both queries really execute. Skipped when
    `DATABASE_URL` is not configured; the LLM stays stubbed.
    """
    if not db_available:
        pytest.skip("DATABASE_URL not configured")

    reference_sql = app_main.QUESTIONS[1]["reference_sql"]
    _reply, _history, direct_result = direct(
        real_tutor, learner_sql=reference_sql, attempt_number=1
    )
    http_result = turn(client, learner_sql=reference_sql, attempt_number=1)["tool_result"]
    assert direct_result["correct"] is True
    assert http_result["correct"] is True
    assert http_result["hint_level"] == direct_result["hint_level"] == 0

    _reply, _history, direct_wrong = direct(
        real_tutor, learner_sql="SELECT 1;", attempt_number=1
    )
    http_wrong = turn(client, learner_sql="SELECT 1;", attempt_number=1)["tool_result"]
    assert direct_wrong["correct"] is False
    assert http_wrong["correct"] is False
    assert http_wrong["reason"] == direct_wrong["reason"]