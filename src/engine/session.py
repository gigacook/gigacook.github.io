from __future__ import annotations
import json
from dataclasses import dataclass, field
from pathlib import Path

_SESSION_FILE = Path(__file__).parent.parent.parent / "session_state.json"


@dataclass
class SessionState:
    seen_questions: set[str] = field(default_factory=set)
    correct_questions: set[str] = field(default_factory=set)
    incorrect_questions: set[str] = field(default_factory=set)
    archived_questions: set[str] = field(default_factory=set)


def load_session() -> SessionState:
    if not _SESSION_FILE.exists():
        return SessionState()
    data = json.loads(_SESSION_FILE.read_text(encoding="utf-8"))
    return SessionState(
        seen_questions=set(data.get("seen_questions", [])),
        correct_questions=set(data.get("correct_questions", [])),
        incorrect_questions=set(data.get("incorrect_questions", [])),
        archived_questions=set(data.get("archived_questions", [])),
    )


def save_session(state: SessionState) -> None:
    _SESSION_FILE.write_text(
        json.dumps(
            {
                "seen_questions": sorted(state.seen_questions),
                "correct_questions": sorted(state.correct_questions),
                "incorrect_questions": sorted(state.incorrect_questions),
                "archived_questions": sorted(state.archived_questions),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
