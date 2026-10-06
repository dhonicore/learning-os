
from decimal import Decimal
from collections import Counter
from datetime import date, datetime
import re

from database import get_connection
from questions import QUESTIONS


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

def _run(conn, sql: str):
    with conn.cursor() as cur:
        cur.execute(sql)

        if cur.description is None:
            return []

        return cur.fetchall()


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

    # 2. Validate SQL safety
    ok, reason = _is_read_only(learner_sql)

    if not ok:
        return {
            "correct": False,
            "error": reason,
            "reason": "unsafe",
            "row_diff": (0, 0),
            "learner_rows": [],
        }

    # 3. Get reference SQL
    ref_sql = QUESTIONS[question_id]["reference_sql"]

    # 4. Execute learner SQL and reference SQL
    with get_connection() as conn:

        try:
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

        try:
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

    # 5. Check result shape
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

    # 6. Compare result rows
    lc = _normalise_rows(learner_rows)
    rc = _normalise_rows(ref_rows)

    # 7. Correct answer
    if lc == rc:
        return {
            "correct": True,
            "error": None,
            "reason": "ok",
            "row_diff": (len(learner_rows), len(ref_rows)),
            "learner_rows": _serialise_rows(learner_rows),
        }

    # 8. Identify the difference
    missing = sum((rc - lc).values())
    extra = sum((lc - rc).values())

    if missing and not extra:
        reason = "missing_rows"

    elif extra and not missing:
        reason = "extra_rows"

    else:
        reason = "value_mismatch"

    # 9. Incorrect answer
    return {
        "correct": False,
        "error": None,
        "reason": reason,
        "row_diff": (len(learner_rows), len(ref_rows)),
        "learner_rows": _serialise_rows(learner_rows),
    }
