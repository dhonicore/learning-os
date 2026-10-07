"""B1-1 — read-only + statement-timeout execution boundary for `checker.py`.

Every test here runs without network or database access: `checker.get_connection`
is replaced with a scripted fake that records the exact sequence of database
operations. The point is to assert the *sequence* (BEGIN READ ONLY + SET LOCAL
before every payload, per-execution isolation, rollback on every path), not
merely the returned `correct` flag — so that a future change back to one
shared transaction fails loudly.
"""

from __future__ import annotations

import pytest
from psycopg import errors as pg_errors

import checker
from checker import STATEMENT_TIMEOUT_SECONDS, check_sql
from questions import QUESTIONS

LEARNER_SQL = "SELECT 1"  # regex-clean, so any failure comes from the fake PG layer.
REF_SQL = QUESTIONS[1]["reference_sql"]

START_RO = "START TRANSACTION READ ONLY"


def expected_timeout_sql() -> str:
    return f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT_SECONDS}s'"


# --------------------------------------------------------------------------
# Fakes (mirror psycopg3 `with conn:` semantics: commit on clean exit,
# rollback on exception, always closed)
# --------------------------------------------------------------------------


class FakeCursor:
    def __init__(self, conn: FakeConnection) -> None:
        self._conn = conn
        self._rows: list = []

    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *exc_info: object) -> bool:
        return False

    def execute(self, sql: str) -> None:
        self._conn.statements.append(sql)
        self._rows = self._conn.db.decide(self._conn.index, sql)

    def fetchall(self) -> list:  # pragma: no cover - legacy path, kept for parity
        return list(self._rows)

    def fetchmany(self, size: int) -> list:
        return list(self._rows[:size])

    @property
    def description(self) -> tuple:
        return (("col",),)


class FakeConnection:
    def __init__(self, db: ScriptedDB, index: int) -> None:
        self.db = db
        self.index = index
        self.statements: list[str] = []
        self.rollbacks = 0
        self.commits = 0
        self.closed = False

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)

    def rollback(self) -> None:
        self.rollbacks += 1

    def commit(self) -> None:
        self.commits += 1

    def __enter__(self) -> FakeConnection:
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> bool:
        if exc_type is not None:
            self.rollback()
        else:
            self.commit()
        self.closed = True
        return False


class ScriptedDB:
    """Routes payload SQL by connection index: 0 = learner, 1 = reference."""

    def __init__(
        self,
        learner_rows: list | None = None,
        ref_rows: list | None = None,
        learner_exc: Exception | None = None,
        ref_exc: Exception | None = None,
    ) -> None:
        self.connections: list[FakeConnection] = []
        self.learner_rows = [(1,)] if learner_rows is None else learner_rows
        self.ref_rows = [(1,)] if ref_rows is None else ref_rows
        self.learner_exc = learner_exc
        self.ref_exc = ref_exc

    def connect(self) -> FakeConnection:
        conn = FakeConnection(self, len(self.connections))
        self.connections.append(conn)
        return conn

    def decide(self, index: int, sql: str) -> list:
        if sql == START_RO:
            return []
        if sql.startswith("SET LOCAL statement_timeout"):
            return []
        if index == 0:
            if self.learner_exc is not None:
                raise self.learner_exc
            return list(self.learner_rows)
        if index == 1:
            if self.ref_exc is not None:
                raise self.ref_exc
            return list(self.ref_rows)
        raise AssertionError(f"unexpected third connection, SQL: {sql!r}")


def run(monkeypatch: pytest.MonkeyPatch, **kwargs: object) -> tuple[dict, ScriptedDB]:
    db = ScriptedDB(**kwargs)  # type: ignore[arg-type]
    monkeypatch.setattr(checker, "get_connection", db.connect)
    return check_sql(1, LEARNER_SQL), db


# --------------------------------------------------------------------------
# Constant
# --------------------------------------------------------------------------


def test_timeout_constant_is_five_seconds() -> None:
    # Changing the timeout later is allowed, but it must be a conscious
    # update of this test — never a silent drift.
    assert STATEMENT_TIMEOUT_SECONDS == 5


# --------------------------------------------------------------------------
# Guard sequences (requirements 1–4)
# --------------------------------------------------------------------------


def test_learner_starts_read_only_transaction(monkeypatch: pytest.MonkeyPatch) -> None:
    _, db = run(monkeypatch)
    assert db.connections[0].statements[0] == START_RO


def test_learner_receives_statement_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    _, db = run(monkeypatch)
    assert db.connections[0].statements[1] == expected_timeout_sql()


def test_reference_starts_own_read_only_transaction(monkeypatch: pytest.MonkeyPatch) -> None:
    _, db = run(monkeypatch)
    assert len(db.connections) == 2  # isolated transaction, not a shared one
    assert db.connections[1].statements[0] == START_RO
    assert db.connections[1].statements[2] == REF_SQL


def test_reference_receives_statement_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    _, db = run(monkeypatch)
    assert db.connections[1].statements[1] == expected_timeout_sql()


# --------------------------------------------------------------------------
# Failure paths (requirements 5–8)
# --------------------------------------------------------------------------


def test_learner_failure_rolls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    result, db = run(
        monkeypatch, learner_exc=Exception("learner pg error"), ref_rows=[(1,)]
    )
    assert result["reason"] == "sql_error"
    assert result["correct"] is False
    assert db.connections[0].rollbacks >= 1


def test_learner_failure_does_not_run_reference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Learner failure early-returns `sql_error`: no wasted reference round
    trip, and no reference data can leak into a learner-error result."""
    result, db = run(
        monkeypatch, learner_exc=Exception("learner pg error"), ref_rows=[(1,)]
    )
    assert result["reason"] == "sql_error"
    assert result["correct"] is False
    assert len(db.connections) == 1


def test_guard_renewed_after_prior_rollback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Core regression test for B1-1 (testing-list item 6).

    The learner execution always ends in `rollback`. The reference execution
    must still open with its own START + SET LOCAL afterwards. Would FAIL if
    learner + reference ever shared one transaction again (single START, or
    reference running after a learner rollback without its own BEGIN READ
    ONLY): the reference connection must still open guarded before its
    payload.
    """
    result, db = run(monkeypatch, learner_rows=[(1,)], ref_rows=[(1,)])
    assert result["reason"] == "ok"
    assert db.connections[0].rollbacks >= 1  # learner tx ended in rollback…
    assert len(db.connections) == 2  # …yet reference still got a fresh tx
    assert db.connections[1].statements[:2] == [START_RO, expected_timeout_sql()]
    assert db.connections[1].statements[2] == REF_SQL


def test_reference_failure_rolls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    result, db = run(monkeypatch, ref_exc=Exception("reference pg error"))
    assert result["correct"] is False
    assert result["reason"] == "reference_error"
    assert db.connections[1].rollbacks >= 1


def test_success_rolls_back_and_closes(monkeypatch: pytest.MonkeyPatch) -> None:
    result, db = run(monkeypatch, learner_rows=[(1,)], ref_rows=[(1,)])
    assert result == {
        "correct": True,
        "error": None,
        "reason": "ok",
        "row_diff": (1, 1),
        "learner_rows": [[1]],
    }
    for conn in db.connections:
        assert conn.rollbacks >= 1
        assert conn.closed is True


# --------------------------------------------------------------------------
# Error conversion (requirements 9–10)
# --------------------------------------------------------------------------


def test_timeout_error_becomes_sql_error(monkeypatch: pytest.MonkeyPatch) -> None:
    timeout = pg_errors.QueryCanceled(
        "canceling statement due to statement timeout"
    )
    assert timeout.sqlstate == "57014"
    result, db = run(monkeypatch, learner_exc=timeout)
    assert result["correct"] is False
    assert result["reason"] == "sql_error"
    assert result["row_diff"] == (0, 0)
    assert result["learner_rows"] == []
    assert db.connections[0].rollbacks >= 1


def test_read_only_error_becomes_sql_error(monkeypatch: pytest.MonkeyPatch) -> None:
    ro_error = pg_errors.ReadOnlySqlTransaction(
        "cannot execute SELECT INTO in a read-only transaction"
    )
    assert ro_error.sqlstate == "25006"
    result, db = run(monkeypatch, learner_exc=ro_error)
    assert result["correct"] is False
    assert result["reason"] == "sql_error"


def test_reference_read_only_error_stays_reference_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ro_error = pg_errors.ReadOnlySqlTransaction(
        "cannot execute SELECT INTO in a read-only transaction"
    )
    result, _ = run(monkeypatch, ref_exc=ro_error)
    assert result["correct"] is False
    assert result["reason"] == "reference_error"


# --------------------------------------------------------------------------
# Isolation (requirement 11)
# --------------------------------------------------------------------------


def test_no_config_leak_between_executions(monkeypatch: pytest.MonkeyPatch) -> None:
    _, db = run(monkeypatch, learner_rows=[(1,)], ref_rows=[(1,)])
    assert len(db.connections) == 2
    assert db.connections[0].statements == [
        START_RO,
        expected_timeout_sql(),
        LEARNER_SQL,
    ]
    assert db.connections[1].statements == [
        START_RO,
        expected_timeout_sql(),
        REF_SQL,
    ]
