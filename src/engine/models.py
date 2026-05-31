from __future__ import annotations
from dataclasses import dataclass, field


@dataclass
class Question:
    id: str
    subject: str           # huvudområde
    subtopic: str
    typ: str
    difficulty: str        # svårighetsgrad: lätt | medel | svår
    question: str          # fråga
    options: dict[str, str]    # alternativ {A: ..., B: ..., C: ..., D: ...}
    correct: str           # rätt_svar
    explanation: str       # kort_förklaring
    distractors: str       # varför_övriga_fel
    source: str            # källa (HTML-unescaped)
    needs_review: bool
    specialty: str         # directory slug, e.g. "01_anestesi"


@dataclass
class ExamQuestion:
    id: int
    question: str
    options: list[str]     # ["A Blåscancer", "B Njursten", ...]
    correct: str           # single letter A–E
    confidence: str
    subject: str


@dataclass
class MatrixEntity:
    area: str
    entity: str
    tags: list[str]
    when_to_suspect: list[str]
    discriminators: list[str]
    investigation: list[str]
    initial_management: list[str]
    definitive_management: list[str]
    complications: list[str]
    pitfalls: list[str]
    memory_hooks: list[str]
    specialty: str
