from .loader import load_all
from .index import build_index, TopicIndex, SubtopicNode
from .models import Question, ExamQuestion, MatrixEntity
from .session import SessionState, load_session, save_session
from .query import (
    get_questions_by_subject,
    get_questions_by_subtopic,
    get_exam_questions_by_subject,
    get_related_matrix_entities,
    get_high_yield_topics,
    get_high_yield_questions,
    get_next_question,
    mark_question_correct,
    mark_question_incorrect,
    archive_question,
    restore_question,
    get_archived_questions,
)


def load_engine() -> TopicIndex:
    data = load_all()
    return build_index(
        questions=data["questions"],
        exam_questions=data["exam_questions"],
        matrix_entities=data["matrix"],
        curriculum=data["curriculum"],
    )


__all__ = [
    "load_engine",
    "TopicIndex",
    "SubtopicNode",
    "Question",
    "ExamQuestion",
    "MatrixEntity",
    "SessionState",
    "load_session",
    "save_session",
    "get_questions_by_subject",
    "get_questions_by_subtopic",
    "get_exam_questions_by_subject",
    "get_related_matrix_entities",
    "get_high_yield_topics",
    "get_high_yield_questions",
    "get_next_question",
    "mark_question_correct",
    "mark_question_incorrect",
    "archive_question",
    "restore_question",
    "get_archived_questions",
]
