import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / 'src'))

from engine import load_engine


def main() -> None:
    idx = load_engine()

    print(f"Loaded  {len(idx.questions):>5} specialty questions")
    print(f"        {len(idx.exam_questions):>5} exam questions")
    print(f"        {len(idx.curriculum):>5} curriculum subjects")
    print(f"        {len(idx.matrix_by_key):>5} matrix entities")
    print()

    for subject in sorted(idx.subjects()):
        subtopics = idx.subtopics(subject)
        q_count = sum(len(idx.node(subject, st).questions) for st in subtopics)
        linked = sum(len(idx.node(subject, st).matrix_entities) for st in subtopics)
        print(
            f"  {subject:<44} {len(subtopics):>3} subtopics  "
            f"{q_count:>4} q  {linked:>4} matrix links"
        )

    print()
    example_id = next(iter(idx.questions))
    result = idx.chain(example_id)
    if result:
        q, node, matrix = result
        print(f"Chain example - {q.id}:")
        print(f"  question  -> subject:  {q.subject!r}")
        print(f"  subject   -> subtopic: {q.subtopic!r}")
        print(f"  subtopic  -> matrix:   {[m.entity for m in matrix] or 'none'}")


if __name__ == '__main__':
    main()
