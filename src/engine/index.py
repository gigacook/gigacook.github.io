from __future__ import annotations
from collections import defaultdict
from dataclasses import dataclass, field
from .models import Question, ExamQuestion, MatrixEntity


@dataclass
class SubtopicNode:
    subject: str
    subtopic: str
    questions: list[Question] = field(default_factory=list)
    matrix_entities: list[MatrixEntity] = field(default_factory=list)


@dataclass
class TopicIndex:
    questions: dict[str, Question]            # id → Question
    exam_questions: dict[int, ExamQuestion]   # id → ExamQuestion
    curriculum: dict[str, list[str]]          # subject → [requirement]
    tree: dict[str, dict[str, SubtopicNode]]  # subject → subtopic → node
    matrix_by_key: dict[str, MatrixEntity]    # "area::entity" → entity

    def subjects(self) -> list[str]:
        return list(self.tree)

    def subtopics(self, subject: str) -> list[str]:
        return list(self.tree.get(subject, {}))

    def node(self, subject: str, subtopic: str) -> SubtopicNode | None:
        return self.tree.get(subject, {}).get(subtopic)

    def chain(self, question_id: str) -> tuple[Question, SubtopicNode | None, list[MatrixEntity]] | None:
        """Resolve question → subject/subtopic node → linked matrix entities."""
        q = self.questions.get(question_id)
        if q is None:
            return None
        n = self.node(q.subject, q.subtopic)
        return q, n, (n.matrix_entities if n else [])


def build_index(
    questions: list[Question],
    exam_questions: list[ExamQuestion],
    matrix_entities: list[MatrixEntity],
    curriculum: dict[str, list[str]],
) -> TopicIndex:
    q_map = {q.id: q for q in questions}
    eq_map = {eq.id: eq for eq in exam_questions}

    # Build tree: subject → subtopic → SubtopicNode
    tree: dict[str, dict[str, SubtopicNode]] = defaultdict(dict)
    for q in questions:
        if q.subtopic not in tree[q.subject]:
            tree[q.subject][q.subtopic] = SubtopicNode(q.subject, q.subtopic)
        tree[q.subject][q.subtopic].questions.append(q)

    # Index matrix entities by entity name (lowercase)
    matrix_by_key: dict[str, MatrixEntity] = {}
    by_entity: dict[str, list[MatrixEntity]] = defaultdict(list)
    for m in matrix_entities:
        matrix_by_key[f"{m.area}::{m.entity}"] = m
        by_entity[m.entity.lower()].append(m)

    # Link subtopics → matrix entities
    for subj_nodes in tree.values():
        for subtopic, node in subj_nodes.items():
            sl = subtopic.lower()
            seen: set[str] = set()

            def _add(m: MatrixEntity) -> None:
                k = f"{m.area}::{m.entity}"
                if k not in seen:
                    node.matrix_entities.append(m)
                    seen.add(k)

            # 1. exact match
            for m in by_entity.get(sl, []):
                _add(m)

            # 2. partial match fallback
            if not node.matrix_entities:
                for entity_name, entities in by_entity.items():
                    if sl in entity_name or entity_name in sl:
                        for m in entities:
                            _add(m)

    return TopicIndex(
        questions=q_map,
        exam_questions=eq_map,
        curriculum=curriculum,
        tree=dict(tree),
        matrix_by_key=matrix_by_key,
    )
