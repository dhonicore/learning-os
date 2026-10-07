
from decimal import Decimal
from collections import Counter
from datetime import date, datetime
import re

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
    with get_connection() as conn:

        try:
            _start_read_only_transaction(conn)
            learner_rows = _run(conn, learner_sql)

        except Exception as e:
            conn.rollback()

            return {
                "correct": False,
                "error": str(e),
                "reason": "sql_error",
                "row_diff": (0, 0),
                "learner_rows": [],
            }

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

        except Exception as e:
            conn.rollback()

            return {
                "correct": False,
                "error": f"Reference failed: {e}",
                "reason": "reference_error",
                "row_diff": (0, 0),
                "learner_rows": [],
            }

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
