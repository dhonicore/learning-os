"""Learning OS — Phase 1 FastAPI shell (E1–E5).

A thin HTTP wrapper over the existing, unmodified Python modules. It owns
no business logic: correctness, hint levels and reference-answer disclosure
stay in `checker.py` / `hint_policy.py` / `tutor.py`.

Contracts: `MIGRATION_PLAN.md` §6 (endpoints E1–E5). Endpoint and field
names match that document exactly.

`app.py` is neither imported nor modified — importing it would execute the
whole Streamlit script. The presentation constants it owns (SCHEMA_*,
_REASON_LABELS, PRACTICE_IDS/HELD_IDS) and the learner-safe error strings
inside `_friendly_error` / `_run_turn` are read from its *source* with `ast`
at import time, so `app.py` remains the single source of truth and stays
byte-for-byte untouched. If that structure ever changes, loading raises
loudly instead of silently serving stale or duplicated values.
"""

from __future__ import annotations

import ast
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from questions import QUESTIONS

load_dotenv()

REPO_ROOT = Path(__file__).resolve().parent
APP_PY = REPO_ROOT / "app.py"

_LITERAL_CONSTANTS = ("SCHEMA_TABLES", "SCHEMA_FOREIGN_KEYS", "SCHEMA_HINT", "_REASON_LABELS")
_DERIVED_CONSTANTS = ("PRACTICE_IDS", "HELD_IDS")


def _module_assignments(path: Path) -> dict[str, ast.expr]:
    """Module-level `NAME = <expr>` assignments from a Python source file."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found: dict[str, ast.expr] = {}
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
        ):
            found[node.targets[0].id] = node.value
    return found


def _function_node(path: Path, name: str) -> ast.FunctionDef:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise RuntimeError(f"{path.name}: function {name!r} not found — re-verify app.py")


def _load_app_constants() -> tuple[dict[str, Any], list[str], list[str]]:
    """Return (literal constants, derived id lists, learner-safe messages).

    Literal constants are read with `ast.literal_eval`. The two derived id
    lists are `app.py`'s own list comprehensions over `QUESTIONS`; they are
    evaluated with only `QUESTIONS` in scope and builtins removed, so the
    API cannot diverge from the Streamlit app's grouping.

    The messages are the exact strings a learner sees today: three returned
    by `_friendly_error` and the two `last_error` assignments in the tutor
    import guard of `_run_turn`, both in source order.
    """
    assignments = _module_assignments(APP_PY)

    literals: dict[str, Any] = {}
    for name in _LITERAL_CONSTANTS:
        if name not in assignments:
            raise RuntimeError(f"app.py: constant {name!r} not found — re-verify app.py")
        literals[name] = ast.literal_eval(assignments[name])

    derived: list[list[int]] = []
    for name in _DERIVED_CONSTANTS:
        if name not in assignments:
            raise RuntimeError(f"app.py: constant {name!r} not found — re-verify app.py")
        expression = ast.Expression(body=assignments[name])
        ast.fix_missing_locations(expression)
        compiled = compile(expression, filename=str(APP_PY), mode="eval")
        derived.append(
            eval(compiled, {"__builtins__": {}}, {"QUESTIONS": QUESTIONS})  # noqa: S307
        )

    friendly = [
        node.value.value
        for node in sorted(
            (
                node
                for node in ast.walk(_function_node(APP_PY, "_friendly_error"))
                if isinstance(node, ast.Return)
                and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)
            ),
            key=lambda node: node.lineno,
        )
    ]
    if len(friendly) != 3:
        raise RuntimeError(
            "app.py: _friendly_error no longer returns exactly 3 messages "
            f"(found {len(friendly)}) — re-verify app.py"
        )

    config_messages = [
        node.value.value
        for node in sorted(
            (
                node
                for node in ast.walk(_function_node(APP_PY, "_run_turn"))
                if isinstance(node, ast.Assign)
                and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)
                and isinstance(node.targets[0], ast.Subscript)
                and isinstance(node.targets[0].slice, ast.Constant)
                and node.targets[0].slice.value == "last_error"
            ),
            key=lambda node: node.lineno,
        )
    ]
    if len(config_messages) != 2:
        raise RuntimeError(
            "app.py: _run_turn no longer assigns exactly 2 configuration "
            f"messages (found {len(config_messages)}) — re-verify app.py"
        )

    return literals, derived[0], derived[1], friendly, config_messages  # type: ignore[return-value]


(
    _CONSTANTS,
    PRACTICE_IDS,
    HELD_IDS,
    _FRIENDLY_MESSAGES,
    _CONFIG_MESSAGES,
) = _load_app_constants()

SCHEMA_TABLES = _CONSTANTS["SCHEMA_TABLES"]
SCHEMA_FOREIGN_KEYS = _CONSTANTS["SCHEMA_FOREIGN_KEYS"]
SCHEMA_HINT = _CONSTANTS["SCHEMA_HINT"]
REASON_LABELS = _CONSTANTS["_REASON_LABELS"]

MSG_TUTOR_UNREACHABLE, MSG_DB_UNAVAILABLE, MSG_GENERIC = _FRIENDLY_MESSAGES
MSG_TUTOR_NO_KEY, MSG_TUTOR_LIBRARY = _CONFIG_MESSAGES


class HealthOut(BaseModel):
    status: str
    db_configured: bool
    llm_configured: bool


class QuestionOut(BaseModel):
    id: int
    purpose: str
    question: str


class MetaOut(BaseModel):
    questions: list[QuestionOut]
    practice_ids: list[int]
    held_ids: list[int]
    reason_labels: dict[str, str]


class SchemaOut(BaseModel):
    tables: list[Any]
    foreign_keys: list[Any]
    hint: str


class TutorTurnRequest(BaseModel):
    question_id: int
    learner_sql: str
    attempt_number: int = Field(ge=1)
    gave_up: bool = False
    history: list[dict[str, Any]] = Field(default_factory=list)
    submission_token: str | None = None


class ToolResultOut(BaseModel):
    correct: bool
    reason: str
    reason_label: str
    row_diff: tuple[int, int]
    hint_level: int
    gave_up: bool
    learner_rows: list[Any] = Field(default_factory=list)


class TutorTurnOut(BaseModel):
    reply: str
    history: list[Any]
    attempt: int
    tool_result: ToolResultOut


app = FastAPI(
    title="Learning OS API",
    version="1.0.0",
    description=(
        "Thin HTTP shell over the verified Python tutor/checker. "
        "Python decides correctness, hint level and reference disclosure."
    ),
)


def _classify_turn_error(exc: Exception) -> tuple[int, str]:
    """Map a turn failure to (HTTP status, learner-safe message).

    Same classification as the Streamlit app's `_friendly_error`, which
    decides by the raising module's name. Never returns `str(exc)`.
    """
    module = type(exc).__module__ or ""
    if "groq" in module:
        return 502, MSG_TUTOR_UNREACHABLE
    if module.startswith("psycopg"):
        return 503, MSG_DB_UNAVAILABLE
    return 500, MSG_GENERIC


@app.get("/api/health", response_model=HealthOut)
def health() -> HealthOut:
    """Liveness/readiness. Checks secret *presence* only, never values."""
    return HealthOut(
        status="ok",
        db_configured=bool(os.environ.get("DATABASE_URL")),
        llm_configured=bool(os.environ.get("GROQ_API_KEY")),
    )


@app.get("/api/ready")
def ready() -> dict[str, str]:
    """Readiness probe — verifies meta endpoint works (no DB needed)."""
    return {"status": "ready"}


@app.get("/api/meta", response_model=MetaOut)
def meta() -> MetaOut:
    """Question metadata for navigation, Progress denominators and Settings.

    `reference_sql` is never included — it is only ever disclosed to the
    learner by the hint policy at level 4.
    """
    return MetaOut(
        questions=[
            QuestionOut(id=qid, purpose=question["purpose"], question=question["question"])
            for qid, question in QUESTIONS.items()
        ],
        practice_ids=list(PRACTICE_IDS),
        held_ids=list(HELD_IDS),
        reason_labels=dict(REASON_LABELS),
    )


@app.get("/api/questions/{question_id}", response_model=QuestionOut)
def question(question_id: int) -> QuestionOut:
    """One question's header text and purpose (mirrors `check_sql`'s
    `unknown_question` gate with a 404)."""
    if question_id not in QUESTIONS:
        raise HTTPException(status_code=404, detail=f"Unknown question id: {question_id}")
    found = QUESTIONS[question_id]
    return QuestionOut(
        id=question_id, purpose=found["purpose"], question=found["question"]
    )


@app.get("/api/schema", response_model=SchemaOut)
def schema() -> SchemaOut:
    """Schema panel data and the `schema_hint` handed to the tutor backend."""
    return SchemaOut(
        tables=[list(table) for table in SCHEMA_TABLES],
        foreign_keys=[list(pair) for pair in SCHEMA_FOREIGN_KEYS],
        hint=SCHEMA_HINT,
    )


@app.post("/api/tutor/turn", response_model=TutorTurnOut)
def tutor_turn(body: TutorTurnRequest) -> TutorTurnOut:
    """One deliberate turn: Submit SQL or Give Up, exactly like the
    Streamlit app's `_run_turn`.

    The tutor import is lazy, exactly as in `app.py`, so an unconfigured or
    broken tutor cannot take down `/api/health`, `/api/meta` or `/api/schema`.
    The server keeps no per-learner state; `attempt_number` and `history`
    come from the client, mirroring current session-only semantics.

    `tool_result["error"]` is deliberately not returned: the checker puts
    raw database text there (`str(e)`), which would leak connection details.
    The UI shows `reason_label`, which is what the learner sees today.
    """
    if body.question_id not in QUESTIONS:
        raise HTTPException(status_code=404, detail=f"Unknown question id: {body.question_id}")

    try:
        from tutor import run_tutor_turn
    except KeyError as exc:
        raise HTTPException(status_code=503, detail=MSG_TUTOR_NO_KEY) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=MSG_TUTOR_LIBRARY) from exc

    try:
        reply, updated_history, tool_result = run_tutor_turn(
            question_id=body.question_id,
            question_text=QUESTIONS[body.question_id]["question"],
            schema_hint=SCHEMA_HINT,
            learner_sql=body.learner_sql,
            history=body.history,
            attempt_number=body.attempt_number,
            gave_up=body.gave_up,
        )
    except Exception as exc:
        status_code, message = _classify_turn_error(exc)
        raise HTTPException(status_code=status_code, detail=message) from exc

    return TutorTurnOut(
        reply=reply,
        history=list(updated_history),
        attempt=body.attempt_number,
        tool_result=ToolResultOut(
            correct=bool(tool_result.get("correct", False)),
            reason=str(tool_result.get("reason", "unknown")),
            reason_label=REASON_LABELS.get(
                str(tool_result.get("reason", "")), str(tool_result.get("reason", ""))
            ),
            row_diff=tuple(tool_result.get("row_diff") or (0, 0)),  # type: ignore[arg-type]
            hint_level=int(tool_result.get("hint_level", 0)),
            gave_up=body.gave_up,
            learner_rows=list(tool_result.get("learner_rows") or []),
        ),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)