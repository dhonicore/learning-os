"""B1-2 — SQL input limit + bounded result fetching for `checker.py`.

Runs without network or database access: `checker.get_connection` is replaced
with a scripted fake. Row counts are exact (500 vs 501) to prove the
`fetchmany(MAX_ROWS + 1)` overflow boundary, and input sizes are exact
(MAX_SQL_CHARS vs +1) to prove pre-execution rejection.
"""

from __future__ import annotations

import inspect

import pytest

import checker
from checker import MAX_ROWS, MAX_SQL_CHARS, check_sql
from questions import QUESTIONS

START_RO = "START TRANSACTION READ ONLY"


def timeout_sql() -> str:
    return f"SET LOCAL statement_timeout = '{checker.STATEMENT_TIMEOUT_SECONDS}s'"


def rows(n: int) -> list[tuple[int]]:
    return [(i,) for i in range(n)]


# --------------------------------------------------------------------------
# Fakes (same psycopg `with`-semantics as the B1-1 suite)
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

    def fetchmany(self, size: int) -> list:
        # Like a real cursor: at most `size` rows materialised per call.
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
        self.closed = False

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)

    def rollback(self) -> None:
        self.rollbacks += 1

    def commit(self) -> None:
        pass

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
    def __init__(
        self,
        learner_rows: list | None = None,
        ref_rows: list | None = None,
    ) -> None:
        self.connections: list[FakeConnection] = []
        self.learner_rows = [(1,)] if learner_rows is None else learner_rows
        self.ref_rows = [(1,)] if ref_rows is None else ref_rows

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
            return list(self.learner_rows)
        if index == 1:
            return list(self.ref_rows)
        raise AssertionError(f"unexpected connection #{index}: {sql!r}")


def run(
    monkeypatch: pytest.MonkeyPatch,
    learner_sql: str,
    question_id: int = 1,
    **kwargs: object,
) -> tuple[dict, ScriptedDB]:
    db = ScriptedDB(**kwargs)  # type: ignore[arg-type]
    monkeypatch.setattr(checker, "get_connection", db.connect)
    return check_sql(question_id, learner_sql), db


# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------


def test_bounds_constants() -> None:
    assert MAX_SQL_CHARS == 10 * 1024
    assert MAX_ROWS == 500


# --------------------------------------------------------------------------
# Result limit: learner side (requirements 1–2, 5)
# --------------------------------------------------------------------------


def test_500_learner_rows_normal_path(monkeypatch: pytest.MonkeyPatch) -> None:
    data = rows(500)
    result, _ = run(
        monkeypatch, "SELECT 1", learner_rows=data, ref_rows=list(data)
    )
    assert result["correct"] is True
    assert result["reason"] == "ok"
    assert result["row_diff"] == (500, 500)


def test_501_learner_rows_too_many(monkeypatch: pytest.MonkeyPatch) -> None:
    result, db = run(
        monkeypatch, "SELECT 1", learner_rows=rows(501), ref_rows=rows(3)
    )
    assert result["correct"] is False
    assert result["reason"] == "too_many_rows"
    assert result["learner_rows"] == []  # oversized rows never reach evidence
    assert result["row_diff"] == (0, 0)
    assert len(db.connections) == 1  # early return: no wasted reference run


def test_learner_overflow_sends_no_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    result, _ = run(
        monkeypatch, "SELECT 1", learner_rows=rows(501), ref_rows=rows(501)
    )
    assert result["reason"] == "too_many_rows"
    assert result["learner_rows"] == []


# --------------------------------------------------------------------------
# Result limit: reference side (requirements 3–4, 6)
# --------------------------------------------------------------------------


def test_500_reference_rows_normal(monkeypatch: pytest.MonkeyPatch) -> None:
    data = rows(500)
    result, _ = run(
        monkeypatch, "SELECT 1", learner_rows=list(data), ref_rows=data
    )
    assert result["correct"] is True
    assert result["reason"] == "ok"


def test_501_reference_rows_reference_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result, _ = run(
        monkeypatch, "SELECT 1", learner_rows=rows(3), ref_rows=rows(501)
    )
    assert result["correct"] is False  # never a false-correct result
    assert result["reason"] == "reference_error"
    assert result["learner_rows"] == []


def test_reference_overflow_never_correct(monkeypatch: pytest.MonkeyPatch) -> None:
    # Even when the learner result matches the reference prefix, overflow
    # must not compare and must not report correct.
    result, _ = run(
        monkeypatch, "SELECT 1", learner_rows=rows(500), ref_rows=rows(501)
    )
    assert result["correct"] is False
    assert result["reason"] == "reference_error"


# --------------------------------------------------------------------------
# Execution path uses bounded fetching only (requirement 7)
# --------------------------------------------------------------------------


def test_no_fetchall_in_execution_path() -> None:
    source = inspect.getsource(checker)
    assert "fetchall" not in source
    assert "fetchmany" in inspect.getsource(checker._run)


# --------------------------------------------------------------------------
# SQL input limit (requirements 8–9 + empty/whitespace/normal semantics)
# --------------------------------------------------------------------------


def at_limit_sql() -> str:
    base = "SELECT 1"
    return base + " " * (MAX_SQL_CHARS - len(base))


def test_sql_exactly_at_limit_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    sql = at_limit_sql()
    assert len(sql) == MAX_SQL_CHARS
    result, db = run(monkeypatch, sql, learner_rows=[(1,)], ref_rows=[(1,)])
    assert result["reason"] == "ok"  # reached the DB and compared
    assert len(db.connections) == 2


def test_sql_over_limit_rejected_before_db(monkeypatch: pytest.MonkeyPatch) -> None:
    sql = at_limit_sql() + " "
    assert len(sql) == MAX_SQL_CHARS + 1
    result, db = run(monkeypatch, sql)
    assert result["correct"] is False
    assert result["reason"] == "unsafe"  # existing pre-execution convention
    assert db.connections == []  # no connection opened, nothing executed


def test_empty_sql_keeps_existing_semantics(monkeypatch: pytest.MonkeyPatch) -> None:
    result, db = run(monkeypatch, "")
    assert result["correct"] is False
    assert result["reason"] == "unsafe"
    assert db.connections == []


def test_whitespace_sql_keeps_existing_semantics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result, db = run(monkeypatch, "   \n  ")
    assert result["correct"] is False
    assert result["reason"] == "unsafe"
    assert db.connections == []


def test_normal_legitimate_sql(monkeypatch: pytest.MonkeyPatch) -> None:
    sql = "SELECT * FROM customers WHERE city = 'Bengaluru'"
    result, db = run(monkeypatch, sql, learner_rows=[(1,)], ref_rows=[(1,)])
    assert result["correct"] is True
    assert result["reason"] == "ok"
    assert db.connections[0].statements[2] == sql


# --------------------------------------------------------------------------
# Genuine reference queries fit comfortably (requirement 10)
# --------------------------------------------------------------------------


def test_all_eight_reference_queries_within_bounds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Every genuine reference SQL passes the size gate, the regex gate and
    # both guarded executions. Row counts mirror production scale (a handful
    # of rows; measured prod max is 14, cap is 500).
    assert len(QUESTIONS) == 8
    for qid, question in QUESTIONS.items():
        ref_sql = question["reference_sql"]
        assert len(ref_sql) < MAX_SQL_CHARS
        sample = [(i,) for i in range(3)]
        result, db = run(
            monkeypatch,
            ref_sql,
            question_id=qid,
            learner_rows=list(sample),
            ref_rows=list(sample),
        )
        assert result["correct"] is True, f"Q{qid} failed"
        assert result["reason"] == "ok", f"Q{qid} failed"
        assert db.connections[0].statements[2] == ref_sql
        assert db.connections[1].statements[2] == ref_sql
