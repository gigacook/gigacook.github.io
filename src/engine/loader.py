# -*- coding: utf-8 -*-
from __future__ import annotations
import html
import json
from pathlib import Path
from .models import Question, ExamQuestion, MatrixEntity
from .parser import parse_matrix_file

_ROOT = Path(__file__).parent.parent.parent  # Engine/

SPECIALTIES = [
    "01_anestesi",
    "02_kirurgi",
    "03_ortopedi",
    "04_endokrinkirurgi",
    "05_handkirurgi",
    "06_kärlkirurgi",
    "07_onkologi",
    "08_plastikkirurgi",
    "09_urologi",
    "10_akutmed_trauma_smart",
]

# Each field has two variants: proper Swedish Unicode and ASCII-stripped fallback.
# Some question banks contain a mix of both in the same file.
_FIELDS = {
    "subject":    ("huvudområde", "huvudomrade"),
    "difficulty": ("svårighetsgrad", "svarighetsgrad"),
    "question":   ("fråga", "fraga"),
    "correct":    ("rätt_svar", "ratt_svar"),
    "explanation":("kort_förklaring", "kort_forklaring"),
    "distractors":("varför_övriga_fel", "varfor_ovriga_fel"),
    "source":     ("källa", "kalla"),
}


def _get(item: dict, *keys: str) -> str:
    for k in keys:
        if k in item:
            return item[k]
    raise KeyError(keys[0])


def _load_questions(specialty: str) -> list[Question]:
    files = sorted((_ROOT / specialty).glob("02_question_bank_*.json"))
    if not files:
        return []
    raw: list[dict] = json.loads(files[0].read_text(encoding="utf-8"))
    f = _FIELDS
    return [
        Question(
            id=item["id"],
            subject=_get(item, *f["subject"]),
            subtopic=item["subtopic"],
            typ=item["typ"],
            difficulty=_get(item, *f["difficulty"]),
            question=_get(item, *f["question"]),
            options=item["alternativ"],
            correct=_get(item, *f["correct"]),
            explanation=_get(item, *f["explanation"]),
            distractors=_get(item, *f["distractors"]),
            source=html.unescape(_get(item, *f["source"])),
            needs_review=item["needs_review"] == "ja",
            specialty=specialty,
        )
        for item in raw
    ]


def _load_matrix(specialty: str) -> list[MatrixEntity]:
    files = sorted((_ROOT / specialty).glob("04_matrix_*.md"))
    if not files:
        return []
    return parse_matrix_file(files[0].read_text(encoding="utf-8"), specialty)


def load_exam_questions() -> list[ExamQuestion]:
    path = _ROOT / "11_exams" / "normalized_exam_question_bank.json"
    raw: list[dict] = json.loads(path.read_text(encoding="utf-8"))
    return [
        ExamQuestion(
            id=item["id"],
            question=item["question"],
            options=item["options"],
            correct=item["correct"],
            confidence=item["confidence"],
            subject=item["subject"],
        )
        for item in raw
    ]


def load_curriculum() -> dict[str, list[str]]:
    path = _ROOT / "12_curriculum" / "01_curriculum.json"
    text = path.read_text(encoding="utf-8").strip()
    # Strip markdown code fence if present
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        text = text.rsplit("```", 1)[0]
    raw: dict = json.loads(text)
    return {s["name"]: s["requirements"] for s in raw["subjects"]}


def load_all() -> dict:
    questions: list[Question] = []
    matrix: list[MatrixEntity] = []
    for spec in SPECIALTIES:
        questions.extend(_load_questions(spec))
        matrix.extend(_load_matrix(spec))
    return {
        "questions": questions,
        "matrix": matrix,
        "exam_questions": load_exam_questions(),
        "curriculum": load_curriculum(),
    }
