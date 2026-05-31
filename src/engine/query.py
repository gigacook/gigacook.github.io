from __future__ import annotations
import random
from collections import Counter

from .index import TopicIndex
from .models import Question, ExamQuestion, MatrixEntity
from .session import SessionState, save_session

# Both Swedish and ASCII-stripped variants of difficulty values
_DIFFICULTY_RANK: dict[str, int] = {
    "svar": 3, "svår": 3,   # hard
    "medel": 2,                    # medium
    "latt": 1, "lätt": 1,    # easy
}


# ---------------------------------------------------------------------------
# Query
# ---------------------------------------------------------------------------

def get_questions_by_subject(subject: str, index: TopicIndex) -> list[Question]:
    return [q for q in index.questions.values() if q.subject == subject]


def get_questions_by_subtopic(subtopic: str, index: TopicIndex) -> list[Question]:
    return [q for q in index.questions.values() if q.subtopic == subtopic]


def get_exam_questions_by_subject(subject: str, index: TopicIndex) -> list[ExamQuestion]:
    return [q for q in index.exam_questions.values() if q.subject == subject]


def get_related_matrix_entities(subtopic: str, index: TopicIndex) -> list[MatrixEntity]:
    for subj_nodes in index.tree.values():
        if subtopic in subj_nodes:
            return subj_nodes[subtopic].matrix_entities
    return []


# ---------------------------------------------------------------------------
# High-yield
# ---------------------------------------------------------------------------

def _subtopic_counts(subject: str, index: TopicIndex) -> Counter:
    counts: Counter = Counter()
    for st in index.subtopics(subject):
        node = index.node(subject, st)
        if node:
            counts[st] = len(node.questions)
    return counts


def get_high_yield_topics(subject: str, index: TopicIndex) -> list[tuple[str, int]]:
    """(subtopic, question_count) sorted by count descending."""
    return _subtopic_counts(subject, index).most_common()


def get_high_yield_questions(subject: str, index: TopicIndex) -> list[Question]:
    """Questions sorted by subtopic frequency then difficulty (harder first)."""
    scores = _subtopic_counts(subject, index)
    return sorted(
        get_questions_by_subject(subject, index),
        key=lambda q: (-scores.get(q.subtopic, 0), -_DIFFICULTY_RANK.get(q.difficulty, 0)),
    )


# ---------------------------------------------------------------------------
# Adaptive question selection
# ---------------------------------------------------------------------------

def get_next_question(
    mode: str,
    index: TopicIndex,
    subject: str | None = None,
    session: SessionState | None = None,
) -> Question | None:
    if session is None:
        session = SessionState()

    archived = session.archived_questions

    def _active(qs: list[Question]) -> list[Question]:
        return [q for q in qs if q.id not in archived]

    if mode == "weak":
        ids = session.incorrect_questions - archived
        candidates = [index.questions[qid] for qid in ids if qid in index.questions]

    elif mode == "unseen":
        exclude = session.seen_questions | archived
        pool = list(index.questions.values())
        if subject:
            pool = [q for q in pool if q.subject == subject]
        candidates = [q for q in pool if q.id not in exclude]

    elif mode == "high_yield":
        subj = subject or next(iter(index.tree), None)
        if subj is None:
            return None
        ordered = _active(get_high_yield_questions(subj, index))
        unseen = [q for q in ordered if q.id not in session.seen_questions]
        candidates = unseen if unseen else ordered

    else:  # normal
        pool = list(index.questions.values())
        if subject:
            pool = [q for q in pool if q.subject == subject]
        candidates = _active(pool)

    if not candidates:
        return None

    q = random.choice(candidates)
    session.seen_questions.add(q.id)
    save_session(session)
    return q


# ---------------------------------------------------------------------------
# Progression tracking
# ---------------------------------------------------------------------------

def mark_question_correct(question_id: str, session: SessionState) -> None:
    session.correct_questions.add(question_id)
    session.incorrect_questions.discard(question_id)
    save_session(session)


def mark_question_incorrect(question_id: str, session: SessionState) -> None:
    session.incorrect_questions.add(question_id)
    save_session(session)


# ---------------------------------------------------------------------------
# Archive system
# ---------------------------------------------------------------------------

def archive_question(question_id: str, session: SessionState) -> None:
    session.archived_questions.add(question_id)
    save_session(session)


def restore_question(question_id: str, session: SessionState) -> None:
    session.archived_questions.discard(question_id)
    save_session(session)


def get_archived_questions(session: SessionState, index: TopicIndex) -> list[Question]:
    return [
        index.questions[qid]
        for qid in session.archived_questions
        if qid in index.questions
    ]
