
from decimal import Decimal
from collections import Counter
from datetime import date, datetime
import re

import psycopg

from database import get_connection
from questions import QUESTIONS


# --- Execution guard (B1-1) -------------------------------------------------
# Safety boundary for EVERY SQL execution performed by this module.
# Each execution (learner and reference independently) runs in its own
# READ ONLY transaction with a transaction-local statement timeout.
# Transaction-local (`SET LOCAL`) settings cannot leak into any other
# transaction. This value is a backend constant — never accept it from
# the client.
STATEMENT_TIMEOUT_SECONDS = 5

# --- Error/reason contract (B1-3) --------------------------------------------
# SQLSTATE raised when PostgreSQL cancels a statement — under our bounded
# read-only transactions that means the statement_timeout fired. Detected by
# SQLSTATE, never by parsing message text (driver wording is version-dependent).
QUERY_TIMEOUT_SQLSTATE = "57014"

# Learner/api-facing error strings are static and backend-owned: raw driver or
# PostgreSQL text NEVER enters a result dict. Consumers of this module (the
# API, the hint policy, the Streamlit app) must be able to trust that nothing
# in a result can leak infrastructure detail.
_ERROR_LEARNER_SQL = "The query could not be run."
_ERROR_LEARNER_TIMEOUT = (
    f"The query was stopped after the {STATEMENT_TIMEOUT_SECONDS}-second limit."
)
_ERROR_REFERENCE = "The reference query failed."


# --- Input/result bounds (B1-2) ------------------------------------------------
# Backend-owned limits. Never accept these values from the client.
#
# MAX_SQL_CHARS counts Python characters (len), not UTF-8 bytes: deterministic
# and directly testable. A pathological all-multibyte payload stays small on
# the wire relative to timeouts/row caps, so char-vs-byte ambiguity is safe.
MAX_SQL_CHARS = 10 * 1024

# Maximum result rows compared for correctness. Execution fetches one extra
# row (MAX_ROWS + 1) solely to detect overflow; overflow is never silently
# truncated and compared — it becomes its own outcome (see check_sql).
MAX_ROWS = 500


# --- SQL safety ---------------------------------------------------------

_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do)\b",
    re.IGNORECASE,
)


def _is_read_only(sql: str) -> tuple[bool, str]:
    stripped = sql.strip().rstrip(";").strip()

    if ";" in stripped:
        return False, "Only a single statement is allowed."

    first_word = stripped.split(None, 1)[0].lower() if stripped else ""

    if first_word not in ("select", "with"):
        return False, "Only SELECT queries are allowed."

    if _FORBIDDEN.search(stripped):
        return False, "Only read-only queries are allowed."

    return True, ""


# --- Normalisation ------------------------------------------------------

def _normalise(value):
    if isinstance(value, Decimal):
        return float(value)

    if isinstance(value, float):
        return round(value, 6)

    if isinstance(value, (date, datetime)):
        return value.isoformat()

    return value


def _normalise_rows(rows):
    return Counter(
        tuple(_normalise(value) for value in row)
        for row in rows
    )


def _serialise_rows(rows):
    return [
        [_normalise(value) for value in row]
        for row in rows
    ]


# --- Execution ----------------------------------------------------------

def _start_read_only_transaction(conn) -> None:
    """Begin an isolated READ ONLY transaction with a local timeout.

    Must be called once per SQL execution, before the SQL itself, inside
    that execution's own connection/transaction. Uses `SET LOCAL` so the
    timeout cannot leak into any other transaction.
    """
    with conn.cursor() as cur:
        cur.execute("START TRANSACTION READ ONLY")
        cur.execute(
            f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT_SECONDS}s'"
        )


def _run(conn, sql: str):
    """Execute one payload statement and fetch a bounded result.

    Fetches at most MAX_ROWS + 1 rows: the extra row exists only so the
    caller can detect overflow. Never silently truncates.
    """
    with conn.cursor() as cur:
        cur.execute(sql)

        if cur.description is None:
            return []

        return cur.fetchmany(MAX_ROWS + 1)


def _rollback_quietly(conn) -> None:
    """Rollback on an error path without masking the original failure.

    The transaction is already doomed; a rollback that itself fails (e.g. on
    a dead connection) must never replace the original exception or change
    how it is classified.
    """
    try:
        conn.rollback()
    except Exception:
        pass


def _execution_error_result(exc: psycopg.Error, *, side: str) -> dict:
    """Convert one database-rejected execution into a checker result.

    Classification order is load-bearing:

    A. SQLSTATE 57014 (statement cancelled — our timeout) comes FIRST,
       because psycopg's QueryCanceled is a subclass of OperationalError.
    B. psycopg.OperationalError (connection/transport/server-shutdown) is
       re-raised: infrastructure failures are never grading outcomes. They
       propagate to the API's dependency-failure mapping (503), unchanged.
    C. Any remaining psycopg.Error means the database rejected the SQL
       itself: a learner grading outcome (`sql_error`) or a reference
       failure (`reference_error`).

    Non-psycopg exceptions never reach here — they are not caught at the
    call site and propagate as unexpected internal failures.
    """
    # A. Timeout (QueryCanceled subclasses OperationalError — check first).
    if getattr(exc, "sqlstate", None) == QUERY_TIMEOUT_SQLSTATE:
        if side == "learner":
            return {
                "correct": False,
                "error": _ERROR_LEARNER_TIMEOUT,
                "reason": "timeout",
                "row_diff": (0, 0),
                "learner_rows": [],
            }
        return {
            "correct": False,
            "error": _ERROR_REFERENCE,
            "reason": "reference_error",
            "row_diff": (0, 0),
            "learner_rows": [],
        }

    # B. Infrastructure: never a grading outcome.
    if isinstance(exc, psycopg.OperationalError):
        raise exc

    # C. The database rejected the SQL itself.
    if side == "learner":
        return {
            "correct": False,
            "error": _ERROR_LEARNER_SQL,
            "reason": "sql_error",
            "row_diff": (0, 0),
            "learner_rows": [],
        }
    return {
        "correct": False,
        "error": _ERROR_REFERENCE,
        "reason": "reference_error",
        "row_diff": (0, 0),
        "learner_rows": [],
    }


# --- Public API ---------------------------------------------------------

def check_sql(question_id: int, learner_sql: str) -> dict:

    # 1. Validate question ID
    if question_id not in QUESTIONS:
        return {
            "correct": False,
            "error": "Unknown question id.",
            "reason": "unknown_question",
            "row_diff": (0, 0),
            "learner_rows": [],
        }

    # 2. Validate SQL input size before any database execution.
    # Reuses the pre-execution "unsafe" rejection convention: no connection
    # is opened and nothing reaches the database or the model.
    if len(learner_sql) > MAX_SQL_CHARS:
        return {
            "correct": False,
            "error": (
                f"SQL query exceeds the {MAX_SQL_CHARS}-character limit."
            ),
            "reason": "unsafe",
            "row_diff": (0, 0),
            "learner_rows": [],
        }

    # 3. Validate SQL safety
    ok, reason = _is_read_only(learner_sql)

    if not ok:
        return {
            "correct": False,
            "error": reason,
            "reason": "unsafe",
            "row_diff": (0, 0),
            "learner_rows": [],
        }

    # 4. Get reference SQL
    ref_sql = QUESTIONS[question_id]["reference_sql"]

    # 5. Execute learner SQL in its own isolated read-only transaction.
    # The reference query below starts a NEW transaction afterwards, so a
    # rollback here can never strip the safety boundary from it.
    # Only psycopg.Error is converted into a grading outcome; anything else
    # (bugs, misconfiguration) propagates as an unexpected internal failure.
    with get_connection() as conn:

        try:
            _start_read_only_transaction(conn)
            learner_rows = _run(conn, learner_sql)

        except psycopg.Error as e:
            _rollback_quietly(conn)
            return _execution_error_result(e, side="learner")

        conn.rollback()

    # 5b. Learner overflow: more than MAX_ROWS is incorrect, never compared.
    # The oversized rows are dropped (learner_rows []) so they cannot reach
    # the model evidence or the API response.
    if len(learner_rows) > MAX_ROWS:
        return {
            "correct": False,
            "error": f"Query returned more than {MAX_ROWS} rows.",
            "reason": "too_many_rows",
            "row_diff": (0, 0),
            "learner_rows": [],
        }

    # 6. Execute reference SQL in its own isolated read-only transaction.
    with get_connection() as conn:

        try:
            _start_read_only_transaction(conn)
            ref_rows = _run(conn, ref_sql)

        except psycopg.Error as e:
            _rollback_quietly(conn)
            return _execution_error_result(e, side="reference")

        conn.rollback()

    # 6b. Reference overflow: never silently compare or disclose. Loud
    # reference_error (the genuine 8-question references return a handful
    # of rows, so reaching this means the data contract changed).
    if len(ref_rows) > MAX_ROWS:
        return {
            "correct": False,
            "error": f"Reference result exceeded {MAX_ROWS} rows.",
            "reason": "reference_error",
            "row_diff": (0, 0),
            "learner_rows": [],
        }

    # 7. Check result shape
    if (
        learner_rows
        and ref_rows
        and len(learner_rows[0]) != len(ref_rows[0])
    ):
        return {
            "correct": False,
            "error": None,
            "reason": "shape_mismatch",
            "row_diff": (len(learner_rows), len(ref_rows)),
            "learner_rows": _serialise_rows(learner_rows),
        }

    # 8. Compare result rows
    lc = _normalise_rows(learner_rows)
    rc = _normalise_rows(ref_rows)

    # 9. Correct answer
    if lc == rc:
        return {
            "correct": True,
            "error": None,
            "reason": "ok",
            "row_diff": (len(learner_rows), len(ref_rows)),
            "learner_rows": _serialise_rows(learner_rows),
        }

    # 10. Identify the difference
    missing = sum((rc - lc).values())
    extra = sum((lc - rc).values())

    if missing and not extra:
        reason = "missing_rows"

    elif extra and not missing:
        reason = "extra_rows"

    else:
        reason = "value_mismatch"

    # 11. Incorrect answer
    return {
        "correct": False,
        "error": None,
        "reason": reason,
        "row_diff": (len(learner_rows), len(ref_rows)),
        "learner_rows": _serialise_rows(learner_rows),
    }
