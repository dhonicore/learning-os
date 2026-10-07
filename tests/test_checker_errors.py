"""B1-3 — safe error/reason contract for `checker.py`.

Runs without network or database access: `checker.get_connection` is replaced
with a scripted fake (same style as the B1-1/B1-2 suites). These tests pin the
boundary between internal technical failures and learner-facing outcomes:

    psycopg.Error with SQLSTATE 57014  -> "timeout" (learner) / "reference_error"
    psycopg.OperationalError           -> propagates (infrastructure, never graded)
    any other psycopg.Error            -> "sql_error" (learner) / "reference_error"
    non-psycopg exceptions             -> propagate (unexpected internal failure)

Raw driver/PostgreSQL text must never appear in a result dict, and every
checker-emittable reason must have a learner-facing label.
"""

from __future__ import annotations

import inspect
import json
import re

import pytest
import psycopg
from psycopg import errors as pg_errors

import app_main
import checker
from checker import MAX_SQL_CHARS, QUERY_TIMEOUT_SQLSTATE, check_sql

LEARNER_SQL = "SELECT 1"  # regex-clean, so any failure comes from the fake PG layer.
RAW_TOKEN = "RAWSECRETTOKEN"  # distinctive marker that must never leak into results

START_RO = "START TRANSACTION READ ONLY"

APPROVED_REASONS = {
    "ok",
    "unsafe",
    "sql_error",
    "timeout",
    "too_many_rows",
    "unknown_question",
    "reference_error",
    "shape_mismatch",
    "missing_rows",
    "extra_rows",
    "value_mismatch",
}


# --------------------------------------------------------------------------
# Fakes (same psycopg `with`-semantics as the B1-1/B1-2 suites)
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
# (a) Learner timeout: SQLSTATE 57014 -> "timeout"
# --------------------------------------------------------------------------


def test_learner_timeout_becomes_timeout_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    timeout = pg_errors.QueryCanceled("canceling statement due to statement timeout")
    assert timeout.sqlstate == QUERY_TIMEOUT_SQLSTATE
    result, db = run(monkeypatch, learner_exc=timeout)
    assert result["correct"] is False
    assert result["reason"] == "timeout"
    assert result["learner_rows"] == []
    assert result["row_diff"] == (0, 0)
    assert len(db.connections) == 1  # reference never executed
    assert db.connections[0].rollbacks >= 1  # rollback occurred


def test_learner_timeout_carries_static_safe_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    timeout = pg_errors.QueryCanceled(f"canceling statement: {RAW_TOKEN}")
    result, _ = run(monkeypatch, learner_exc=timeout)
    assert result["error"] == checker._ERROR_LEARNER_TIMEOUT
    assert RAW_TOKEN not in json.dumps(result)


# --------------------------------------------------------------------------
# (b) Learner SQL rejected by the database: SQLSTATE 42601 -> "sql_error"
# --------------------------------------------------------------------------


def test_learner_pg_error_becomes_sql_error_without_raw_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    syntax = pg_errors.SyntaxError(f'syntax error at or near "{RAW_TOKEN}"')
    assert syntax.sqlstate == "42601"
    result, db = run(monkeypatch, learner_exc=syntax)
    assert result["correct"] is False
    assert result["reason"] == "sql_error"
    assert result["error"] == checker._ERROR_LEARNER_SQL  # static, backend-owned
    serialized = json.dumps(result)
    assert RAW_TOKEN not in serialized
    assert "syntax error" not in serialized
    assert len(db.connections) == 1  # reference never executed


# --------------------------------------------------------------------------
# (c) Learner connection/transport failure (sqlstate None): propagates
# --------------------------------------------------------------------------


def test_learner_operational_error_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    dropped = psycopg.OperationalError(f"connection to server lost: {RAW_TOKEN}")
    assert dropped.sqlstate is None
    db = ScriptedDB(learner_exc=dropped)
    monkeypatch.setattr(checker, "get_connection", db.connect)
    with pytest.raises(psycopg.OperationalError):
        check_sql(1, LEARNER_SQL)
    assert len(db.connections) == 1  # reference never executed


# --------------------------------------------------------------------------
# (d) Server shutdown (57P01): an OperationalError WITH sqlstate — must still
# propagate. Proves the OperationalError branch is not swallowed by the
# sqlstate check (QueryCanceled subclasses OperationalError, so order matters).
# --------------------------------------------------------------------------


def test_learner_admin_shutdown_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    shutdown = pg_errors.AdminShutdown(f"terminating connection: {RAW_TOKEN}")
    assert shutdown.sqlstate == "57P01"
    assert isinstance(shutdown, psycopg.OperationalError)
    db = ScriptedDB(learner_exc=shutdown)
    monkeypatch.setattr(checker, "get_connection", db.connect)
    with pytest.raises(pg_errors.AdminShutdown):
        check_sql(1, LEARNER_SQL)
    assert len(db.connections) == 1  # reference never executed


# --------------------------------------------------------------------------
# (e) Reference timeout: SQLSTATE 57014 -> "reference_error", no raw text
# --------------------------------------------------------------------------


def test_reference_timeout_becomes_reference_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    timeout = pg_errors.QueryCanceled(f"canceling statement: {RAW_TOKEN}")
    result, db = run(monkeypatch, learner_rows=[(1,)], ref_exc=timeout)
    assert result["correct"] is False
    assert result["reason"] == "reference_error"
    assert result["error"] == checker._ERROR_REFERENCE
    assert RAW_TOKEN not in json.dumps(result)
    assert len(db.connections) == 2  # learner ran first, then reference


# --------------------------------------------------------------------------
# (f) Reference connection/transport failure: propagates
# --------------------------------------------------------------------------


def test_reference_operational_error_propagates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dropped = psycopg.OperationalError(f"connection to server lost: {RAW_TOKEN}")
    db = ScriptedDB(learner_rows=[(1,)], ref_exc=dropped)
    monkeypatch.setattr(checker, "get_connection", db.connect)
    with pytest.raises(psycopg.OperationalError):
        check_sql(1, LEARNER_SQL)


# --------------------------------------------------------------------------
# (g) Reference SQL rejected by the database: -> "reference_error", no raw text
# --------------------------------------------------------------------------


def test_reference_pg_error_becomes_reference_error_without_raw_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    missing = pg_errors.UndefinedTable(f'relation "{RAW_TOKEN}" does not exist')
    assert missing.sqlstate == "42P01"
    result, _ = run(monkeypatch, learner_rows=[(1,)], ref_exc=missing)
    assert result["correct"] is False
    assert result["reason"] == "reference_error"
    assert result["error"] == checker._ERROR_REFERENCE
    serialized = json.dumps(result)
    assert RAW_TOKEN not in serialized
    assert "does not exist" not in serialized


# --------------------------------------------------------------------------
# (h) Reason/label invariant: every checker-emittable reason has a label,
# and the label set contains nothing else. Guards against raw reason codes
# reaching the UI through the label fallbacks.
# --------------------------------------------------------------------------


def checker_emitted_reasons() -> set[str]:
    source = inspect.getsource(checker)
    literal = set(re.findall(r'"reason":\s*"([a-z_]+)"', source))
    assigned = set(re.findall(r"\breason\s*=\s*\"([a-z_]+)\"", source))
    return literal | assigned


def test_reason_label_invariant() -> None:
    assert checker_emitted_reasons() == APPROVED_REASONS
    assert set(app_main.REASON_LABELS) == APPROVED_REASONS


# --------------------------------------------------------------------------
# (i) B1-2 oversize behaviour unchanged: pre-DB reject, reason "unsafe"
# --------------------------------------------------------------------------


def test_oversize_sql_still_rejected_before_db(monkeypatch: pytest.MonkeyPatch) -> None:
    sql = "SELECT 1" + " " * (MAX_SQL_CHARS + 1 - len("SELECT 1"))
    assert len(sql) == MAX_SQL_CHARS + 1
    db = ScriptedDB()
    monkeypatch.setattr(checker, "get_connection", db.connect)
    result = check_sql(1, sql)
    assert result["correct"] is False
    assert result["reason"] == "unsafe"
    assert db.connections == []  # zero DB connections


# --------------------------------------------------------------------------
# Non-psycopg failures are never converted into learner SQL errors
# --------------------------------------------------------------------------


def test_non_psycopg_bug_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    bug = RuntimeError(f"programming bug: {RAW_TOKEN}")
    db = ScriptedDB(learner_exc=bug)
    monkeypatch.setattr(checker, "get_connection", db.connect)
    with pytest.raises(RuntimeError):
        check_sql(1, LEARNER_SQL)
    assert len(db.connections) == 1
