"""Shared fixtures for the Phase 1 API tests.

Tests run without network access: the LLM client is always replaced by a
recorder. Database access is required by exactly one test, which skips
itself when `DATABASE_URL` is absent.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient  # noqa: E402

import app_main  # noqa: E402

SECRET_DB = "postgresql://user:SECRET_PASSWORD@db.invalid:5432/learningos"
SECRET_LLM = "gsk-FAKE-SECRET-LLM-KEY"


class FakeMessage:
    def __init__(self, content: str) -> None:
        self.content = content


class FakeChoice:
    def __init__(self, content: str) -> None:
        self.message = FakeMessage(content)


class FakeResponse:
    def __init__(self, content: str) -> None:
        self.choices = [FakeChoice(content)]


class RecordingLLM:
    """Stand-in for the module-level `groq` client used by `tutor.py`."""

    def __init__(self, reply: str = "Here is a hint.") -> None:
        self.reply = reply
        self.calls: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, *, model: str, messages: list) -> FakeResponse:
        self.calls.append({"model": model, "messages": messages})
        return FakeResponse(self.reply)


class FakeTutorModule:
    """Records the arguments the endpoint passes to `run_tutor_turn`."""

    def __init__(self, result=None, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[dict] = []
        self.run_tutor_turn = self._run_tutor_turn

    def _run_tutor_turn(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.result


def make_tool_result(**overrides) -> dict:
    base = {
        "correct": False,
        "error": None,
        "reason": "value_mismatch",
        "row_diff": (2, 2),
        "learner_rows": [(1,), (2,)],
    }
    base.update(overrides)
    return base


@pytest.fixture
def client() -> TestClient:
    return TestClient(app_main.app)


@pytest.fixture
def fake_tutor(monkeypatch) -> FakeTutorModule:
    """Install a fake `tutor` module so no Groq/DB call is attempted."""
    import types

    module = FakeTutorModule(
        result=("Tutor reply.", [{"role": "assistant", "content": "Tutor reply."}], make_tool_result(hint_level=1))
    )
    monkeypatch.setitem(sys.modules, "tutor", types.SimpleNamespace(run_tutor_turn=module.run_tutor_turn))
    return module


@pytest.fixture
def real_tutor(monkeypatch):
    """Import the *real* `tutor.py` with a fake LLM client and fake checker.

    `tutor.py` builds its Groq client at import time, so a key must exist in
    the environment before the import; the client itself is replaced, so no
    network request is ever made.
    """
    monkeypatch.setenv("GROQ_API_KEY", os.environ.get("GROQ_API_KEY") or "test-key-not-real")
    monkeypatch.delitem(sys.modules, "tutor", raising=False)
    import tutor

    llm = RecordingLLM()
    monkeypatch.setattr(tutor, "client", llm)

    def set_tool_result(result: dict) -> None:
        monkeypatch.setattr(tutor, "execute_tool", lambda name, arguments: dict(result))

    tutor.llm = llm  # type: ignore[attr-defined]
    tutor.set_tool_result = set_tool_result  # type: ignore[attr-defined]
    return tutor


@pytest.fixture
def db_available() -> bool:
    return bool(os.environ.get("DATABASE_URL"))