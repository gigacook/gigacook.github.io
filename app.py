"""
pip install flask
python app.py  ->  http://localhost:5000
"""
import sys, json, uuid, random, time, os
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory

sys.path.insert(0, str(Path(__file__).parent / "src"))
from engine import load_engine, SessionState
from engine.query import get_high_yield_topics, get_high_yield_questions

app = Flask(__name__)
ROOT = Path(__file__).parent
SESSIONS_DIR = ROOT / "sessions"
SESSIONS_DIR.mkdir(exist_ok=True)
RUNS_DIR = ROOT / "runs"
RUNS_DIR.mkdir(exist_ok=True)

print("Loading engine...")
IDX = load_engine()
print(f"Ready: {len(IDX.questions)} specialty  {len(IDX.exam_questions)} exam  {len(IDX.matrix_by_key)} matrix")

EXAM_SPECS = [
    ("01_anestesi", 15),
    ("02_kirurgi", 15),
    ("03_ortopedi", 15),
]
EXAM_REST = {
    "04_endokrinkirurgi", "05_handkirurgi", "06_kärlkirurgi",
    "07_onkologi", "08_plastikkirurgi", "09_urologi", "10_akutmed_trauma_smart",
}
_DIFF_MAP = {"latt": "lätt", "svar": "svår"}

SPECIALTY_ORDER = [
    "01_anestesi", "02_kirurgi", "03_ortopedi", "04_endokrinkirurgi",
    "05_handkirurgi", "06_kärlkirurgi", "07_onkologi",
    "08_plastikkirurgi", "09_urologi", "10_akutmed_trauma_smart",
]
SPECIALTY_DISPLAY = {
    "01_anestesi":           "Anestesi",
    "02_kirurgi":            "Kirurgi",
    "03_ortopedi":           "Ortopedi",
    "04_endokrinkirurgi":    "Endokrinkirurgi",
    "05_handkirurgi":        "Handkirurgi",
    "06_kärlkirurgi":        "Kärlkirurgi",
    "07_onkologi":           "Onkologi",
    "08_plastikkirurgi":     "Plastikkirurgi",
    "09_urologi":            "Urologi",
    "10_akutmed_trauma_smart": "Akutmedicin & Trauma",
}

# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

def _spath(sid): return SESSIONS_DIR / f"{sid}.json"
def _rpath(rid): return RUNS_DIR     / f"{rid}.json"

def _load(sid):
    p = _spath(sid)
    if not p.exists():
        return SessionState()
    d = json.loads(p.read_text(encoding="utf-8"))
    return SessionState(
        seen_questions=set(d.get("seen_questions", [])),
        correct_questions=set(d.get("correct_questions", [])),
        incorrect_questions=set(d.get("incorrect_questions", [])),
        archived_questions=set(d.get("archived_questions", [])),
    )

def _save(sid, s):
    _spath(sid).write_text(json.dumps({
        "seen_questions": sorted(s.seen_questions),
        "correct_questions": sorted(s.correct_questions),
        "incorrect_questions": sorted(s.incorrect_questions),
        "archived_questions": sorted(s.archived_questions),
    }, ensure_ascii=False, indent=2), encoding="utf-8")

def _stats(s):
    seen = len(s.seen_questions)
    correct = len(s.correct_questions)
    return {
        "seen": seen, "correct": correct,
        "incorrect": len(s.incorrect_questions),
        "archived": len(s.archived_questions),
        "accuracy": round(correct / seen * 100, 1) if seen else 0,
    }

# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------

def _q(q, reveal=True):
    d = {
        "id": q.id, "subject": q.subject, "subtopic": q.subtopic,
        "typ": q.typ, "difficulty": _DIFF_MAP.get(q.difficulty, q.difficulty),
        "question": q.question, "options": q.options,
        "specialty": q.specialty, "needs_review": q.needs_review,
    }
    if reveal:
        d.update(correct=q.correct, explanation=q.explanation,
                 distractors=q.distractors, source=q.source)
    return d

def _m(m):
    return {k: getattr(m, k) for k in (
        "area", "entity", "tags", "when_to_suspect", "discriminators",
        "investigation", "initial_management", "definitive_management",
        "complications", "pitfalls", "memory_hooks", "specialty"
    )}

def _eq_norm(q, reveal=True):
    """Normalize an ExamQuestion to the same shape as specialty questions."""
    opts = {}
    for opt in q.options:
        if opt and opt[0].isalpha() and len(opt) > 1:
            opts[opt[0]] = opt[1:].lstrip('. ').strip()
    d = {
        "id": f"exam_{q.id}",
        "subject": q.subject, "subtopic": q.subject,
        "typ": "old_exam", "difficulty": "medel",
        "question": q.question, "options": opts,
        "specialty": "old_exam", "needs_review": False,
    }
    if reveal:
        d.update(correct=q.correct,
                 explanation=f"Confidence: {q.confidence}",
                 distractors="", source="Normalized exam bank")
    return d

def _subject_specialty(subject):
    for q in IDX.questions.values():
        if q.subject == subject:
            return q.specialty
    return None

def _find_md(specialty, prefix):
    d = ROOT / specialty
    files = sorted(d.glob(f"{prefix}_*.md")) if d.exists() else []
    return files[0].read_text(encoding="utf-8") if files else ""

# ---------------------------------------------------------------------------
# Adaptive selection
# ---------------------------------------------------------------------------

def _pick(mode, session, subject=None, topic=None, tags=None):
    archived = session.archived_questions
    pool = list(IDX.questions.values())

    if mode == "weak":
        ids = session.incorrect_questions - archived
        candidates = [IDX.questions[i] for i in ids if i in IDX.questions]
    elif mode == "review_archived":
        candidates = [IDX.questions[i] for i in archived if i in IDX.questions]
    elif mode == "unseen":
        exclude = session.seen_questions | archived
        if subject: pool = [q for q in pool if q.subject == subject]
        if topic:   pool = [q for q in pool if q.subtopic == topic]
        candidates = [q for q in pool if q.id not in exclude]
    elif mode == "high_yield":
        subj = subject or next(iter(IDX.tree), None)
        if not subj: return None
        hy = get_high_yield_questions(subj, IDX)
        candidates = [q for q in hy if q.id not in archived]
        unseen = [q for q in candidates if q.id not in session.seen_questions]
        candidates = unseen if unseen else candidates
    elif mode == "tag":
        tag_set = set(t.strip() for t in (tags or "").split(",") if t.strip())
        if tag_set:
            matching = set()
            for m in IDX.matrix_by_key.values():
                if m.tags and tag_set.intersection(m.tags):
                    matching.add(m.entity)
            if subject: pool = [q for q in pool if q.subject == subject]
            pool = [q for q in pool if q.subtopic in matching]
        candidates = [q for q in pool if q.id not in archived]
    elif mode == "topic":
        if subject: pool = [q for q in pool if q.subject == subject]
        if topic:   pool = [q for q in pool if q.subtopic == topic]
        candidates = [q for q in pool if q.id not in archived]
    else:  # normal
        if subject: pool = [q for q in pool if q.subject == subject]
        candidates = [q for q in pool if q.id not in archived]

    if not candidates: return None
    q = random.choice(candidates)
    session.seen_questions.add(q.id)
    return q

# ---------------------------------------------------------------------------
# Static
# ---------------------------------------------------------------------------

@app.route("/")
def root(): return send_from_directory(ROOT, "index.html")

@app.route("/script.js")
def js(): return send_from_directory(ROOT, "script.js")

@app.route("/style.css")
def css(): return send_from_directory(ROOT, "style.css")

# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------

@app.route("/session", methods=["POST"])
def new_session():
    sid = str(uuid.uuid4())
    _save(sid, SessionState())
    return jsonify({"session_id": sid})

# ---------------------------------------------------------------------------
# Questions
# ---------------------------------------------------------------------------

@app.route("/next")
def next_q():
    mode    = request.args.get("mode", "normal")
    subject = request.args.get("subject") or None
    topic   = request.args.get("topic") or None
    tags    = request.args.get("tags") or None
    sid     = request.args.get("session_id", "default")
    session = _load(sid)
    q = _pick(mode, session, subject=subject, topic=topic, tags=tags)
    if q: _save(sid, session)
    return jsonify({"question": _q(q, reveal=False) if q else None, "stats": _stats(session)})

@app.route("/answer", methods=["POST"])
def answer():
    data = request.get_json(force=True, silent=True) or {}
    qid      = data.get("question_id")
    selected = data.get("selected")        # letter the user picked
    sid      = data.get("session_id", "default")
    session  = _load(sid)
    q = IDX.questions.get(qid)
    if not q: return jsonify({"error": "not found"}), 404
    correct = (selected == q.correct)
    session.seen_questions.add(qid)
    if correct:
        session.correct_questions.add(qid)
        session.incorrect_questions.discard(qid)
    else:
        session.incorrect_questions.add(qid)
    _save(sid, session)
    return jsonify({"question": _q(q, reveal=True), "is_correct": correct, "stats": _stats(session)})

@app.route("/archive", methods=["POST"])
def archive():
    data = request.json or {}
    session = _load(data.get("session_id", "default"))
    session.archived_questions.add(data.get("question_id", ""))
    _save(data.get("session_id", "default"), session)
    return jsonify({"ok": True, "stats": _stats(session)})

@app.route("/restore", methods=["POST"])
def restore():
    data = request.json or {}
    sid = data.get("session_id", "default")
    session = _load(sid)
    session.archived_questions.discard(data.get("question_id", ""))
    _save(sid, session)
    return jsonify({"ok": True, "stats": _stats(session)})

@app.route("/quiz/batch")
def quiz_batch():
    try:
        n = min(int(request.args.get("n", "20")), 200)
    except (ValueError, TypeError):
        n = 20
    mode      = request.args.get("mode", "normal")
    subject   = request.args.get("subject")   or None
    specialty = request.args.get("specialty") or None
    topic     = request.args.get("topic")     or None
    tags      = request.args.get("tags")      or None
    sid       = request.args.get("session_id", "default")
    session   = _load(sid)
    archived  = session.archived_questions
    pool      = list(IDX.questions.values())

    if mode == "weak":
        ids  = session.incorrect_questions - archived
        pool = [IDX.questions[i] for i in ids if i in IDX.questions]
    elif mode == "review_archived":
        pool = [IDX.questions[i] for i in archived if i in IDX.questions]
    elif mode == "unseen":
        exclude = session.seen_questions | archived
        pool    = [q for q in pool if q.id not in exclude]
    elif mode == "high_yield":
        subj = subject or (
            next((q.subject for q in pool if q.specialty == specialty), None)
            if specialty else next(iter(IDX.tree), None)
        )
        if subj:
            hy   = get_high_yield_questions(subj, IDX)
            pool = [q for q in hy if q.id not in archived]
            unseen = [q for q in pool if q.id not in session.seen_questions]
            pool = unseen if unseen else pool
        else:
            pool = []
    elif mode == "tag":
        tag_set = set(t.strip() for t in (tags or "").split(",") if t.strip())
        if tag_set:
            matching = set()
            for m in IDX.matrix_by_key.values():
                if m.tags and tag_set.intersection(m.tags):
                    matching.add(m.entity)
            pool = [q for q in pool if q.subtopic in matching]
        pool = [q for q in pool if q.id not in archived]
    elif mode == "topic":
        if topic: pool = [q for q in pool if q.subtopic == topic]
        pool = [q for q in pool if q.id not in archived]
    else:  # normal
        pool = [q for q in pool if q.id not in archived]

    # Contextual filters applied after mode-specific pool building
    if specialty: pool = [q for q in pool if q.specialty == specialty]
    if subject:   pool = [q for q in pool if q.subject   == subject]
    if topic and mode == "topic": pass  # already applied above
    elif topic:   pool = [q for q in pool if q.subtopic  == topic]

    if not pool:
        return jsonify({"questions": [], "total": 0})
    selected = random.sample(pool, min(n, len(pool)))
    random.shuffle(selected)
    return jsonify({"questions": [_q(q, reveal=False) for q in selected], "total": len(selected)})

# ---------------------------------------------------------------------------
# Data browsing
# ---------------------------------------------------------------------------

@app.route("/subjects")
def subjects():
    seen, result = set(), []
    for q in IDX.questions.values():
        if q.subject not in seen:
            seen.add(q.subject)
    for subj in sorted(seen):
        sts = IDX.subtopics(subj)
        qc = sum(len(IDX.node(subj, st).questions) for st in sts if IDX.node(subj, st))
        result.append({"subject": subj, "subtopic_count": len(sts), "question_count": qc,
                        "specialty": _subject_specialty(subj)})
    return jsonify(result)

@app.route("/specialties")
def specialties():
    from collections import defaultdict
    spec_subj = defaultdict(lambda: defaultdict(int))
    for q in IDX.questions.values():
        spec_subj[q.specialty][q.subject] += 1
    result = []
    for spec in SPECIALTY_ORDER:
        subj_counts = spec_subj.get(spec, {})
        subjects = [
            {"subject": s, "question_count": c, "subtopic_count": len(IDX.subtopics(s)), "specialty": spec}
            for s, c in sorted(subj_counts.items(), key=lambda x: -x[1])
        ]
        result.append({
            "specialty": spec,
            "display_name": SPECIALTY_DISPLAY.get(spec, spec),
            "question_count": sum(subj_counts.values()),
            "subjects": subjects,
        })
    return jsonify(result)

@app.route("/topics")
def topics():
    subject = request.args.get("subject")
    if not subject: return jsonify({"error": "subject required"}), 400
    result = []
    for st in IDX.subtopics(subject):
        node = IDX.node(subject, st)
        if node:
            result.append({"subtopic": st, "question_count": len(node.questions),
                           "matrix_count": len(node.matrix_entities)})
    return jsonify(sorted(result, key=lambda x: -x["question_count"]))

@app.route("/questions")
def questions():
    subject = request.args.get("subject") or None
    topic   = request.args.get("topic") or None
    sid     = request.args.get("session_id", "default")
    session = _load(sid)
    pool = list(IDX.questions.values())
    if subject: pool = [q for q in pool if q.subject == subject]
    if topic:   pool = [q for q in pool if q.subtopic == topic]
    return jsonify([{**_q(q), "seen": q.id in session.seen_questions,
                    "is_correct": q.id in session.correct_questions,
                    "is_incorrect": q.id in session.incorrect_questions,
                    "archived": q.id in session.archived_questions} for q in pool])

@app.route("/matrix")
def matrix():
    topic   = request.args.get("topic") or None
    subject = request.args.get("subject") or None
    if topic:
        for nodes in IDX.tree.values():
            if topic in nodes:
                return jsonify([_m(m) for m in nodes[topic].matrix_entities])
        return jsonify([])
    if subject:
        seen, result = set(), []
        for st in IDX.subtopics(subject):
            node = IDX.node(subject, st)
            if node:
                for m in node.matrix_entities:
                    k = f"{m.area}::{m.entity}"
                    if k not in seen:
                        seen.add(k); result.append(_m(m))
        return jsonify(result)
    return jsonify([_m(m) for m in IDX.matrix_by_key.values()])

@app.route("/chain")
def chain():
    qid = request.args.get("question_id")
    if not qid: return jsonify({"error": "question_id required"}), 400
    r = IDX.chain(qid)
    if not r: return jsonify({"error": "not found"}), 404
    q, node, mx = r
    return jsonify({
        "question": _q(q), "subject": q.subject, "subtopic": q.subtopic,
        "matrix_entities": [_m(m) for m in mx],
        "sibling_questions": [_q(sq) for sq in (node.questions if node else []) if sq.id != qid],
    })

# ---------------------------------------------------------------------------
# Document view
# ---------------------------------------------------------------------------

@app.route("/coverage")
def coverage():
    subject   = request.args.get("subject") or None
    specialty = request.args.get("specialty") or (subject and _subject_specialty(subject))
    if not specialty: return jsonify({"error": "not found"}), 404
    return jsonify({"content": _find_md(specialty, "01"), "specialty": specialty})

@app.route("/matrix_full")
def matrix_full():
    subject   = request.args.get("subject") or None
    specialty = request.args.get("specialty") or (subject and _subject_specialty(subject))
    if not specialty: return jsonify({"error": "not found"}), 404
    return jsonify({"content": _find_md(specialty, "04"), "specialty": specialty})

@app.route("/curriculum")
def curriculum():
    return jsonify({"subjects": [{"name": n, "requirements": r} for n, r in IDX.curriculum.items()]})

# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------

@app.route("/high_yield")
def high_yield():
    subject = request.args.get("subject")
    if not subject: return jsonify({"error": "subject required"}), 400
    topics  = get_high_yield_topics(subject, IDX)
    qs      = get_high_yield_questions(subject, IDX)
    return jsonify({
        "subject": subject,
        "topics": [{"subtopic": t, "count": c} for t, c in topics],
        "questions": [_q(q) for q in qs],
    })

@app.route("/stats")
def stats():
    sid = request.args.get("session_id", "default")
    session = _load(sid)
    by_subj, spec_seen, old_seen = {}, 0, 0
    for qid in session.seen_questions:
        if qid.startswith("exam_"):
            old_seen += 1; continue
        q = IDX.questions.get(qid)
        if q:
            spec_seen += 1
            s = by_subj.setdefault(q.subject, {"seen": 0, "correct": 0, "incorrect": 0})
            s["seen"] += 1
            if qid in session.correct_questions:     s["correct"] += 1
            elif qid in session.incorrect_questions: s["incorrect"] += 1
    return jsonify({
        **_stats(session), "by_subject": by_subj,
        "specialty_seen": spec_seen, "specialty_total": len(IDX.questions),
        "old_exam_seen": old_seen,   "old_exam_total":  len(IDX.exam_questions),
        "archived_list": [_q(IDX.questions[i]) for i in session.archived_questions if i in IDX.questions],
    })

# ---------------------------------------------------------------------------
# Exam
# ---------------------------------------------------------------------------

@app.route("/exam/generate", methods=["POST"])
def exam_generate():
    data   = request.get_json(force=True, silent=True) or {}
    sid    = data.get("session_id", "default")
    source = data.get("source", "specialty")  # "specialty" or "old_exam"

    if source == "old_exam":
        pool = list(IDX.exam_questions.values())
        exam = random.sample(pool, min(60, len(pool)))
        random.shuffle(exam)
        return jsonify({"questions": [_eq_norm(q, reveal=False) for q in exam],
                        "total": len(exam), "source": "old_exam"})

    # Specialty-based
    archived = _load(sid).archived_questions
    def pick(pool, n):
        avail = [q for q in pool if q.id not in archived]
        return random.sample(avail, min(n, len(avail)))
    all_q = list(IDX.questions.values())
    exam = []
    for spec, n in EXAM_SPECS:
        exam += pick([q for q in all_q if q.specialty == spec], n)
    rest = [q for q in all_q if q.specialty in EXAM_REST]
    exam += pick(rest, 15)
    random.shuffle(exam)
    return jsonify({"questions": [_q(q, reveal=False) for q in exam],
                    "total": len(exam), "source": "specialty"})

@app.route("/exam/submit", methods=["POST"])
def exam_submit():
    data    = request.get_json(force=True, silent=True) or {}
    sid     = data.get("session_id", "default")
    answers = data.get("answers", {})
    session = _load(sid)
    results, score = [], 0
    for qid, selected in answers.items():
        if qid.startswith("exam_"):
            # Old exam question
            try: num = int(qid[5:])
            except ValueError: continue
            qe = IDX.exam_questions.get(num)
            if not qe: continue
            ok = selected == qe.correct
            question_text, subj, subtopic, expl = qe.question, qe.subject, qe.subject, f"Confidence: {qe.confidence}"
        else:
            q = IDX.questions.get(qid)
            if not q: continue
            ok = selected == q.correct
            question_text, subj, subtopic, expl = q.question, q.subject, q.subtopic, q.explanation
        if ok:
            score += 1
            session.correct_questions.add(qid)
            session.incorrect_questions.discard(qid)
        else:
            session.incorrect_questions.add(qid)
        session.seen_questions.add(qid)
        results.append({"question_id": qid, "question": question_text,
                        "selected": selected, "correct": (qe.correct if qid.startswith("exam_") else q.correct),
                        "is_correct": ok, "explanation": expl,
                        "subject": subj, "subtopic": subtopic})
    _save(sid, session)
    total = len(results)
    return jsonify({"score": score, "total": total,
                    "percentage": round(score / total * 100, 1) if total else 0,
                    "results": results, "stats": _stats(session)})

# ---------------------------------------------------------------------------
# Quiz run persistence
# ---------------------------------------------------------------------------

@app.route("/runs/save", methods=["POST"])
def runs_save():
    data   = request.get_json(force=True, silent=True) or {}
    sid    = data.get("session_id", "default")
    run_id = data.get("run_id")
    if not run_id:
        return jsonify({"error": "run_id required"}), 400
    payload = {
        "run_id":       run_id,
        "session_id":   sid,
        "updated_at":   time.time(),
        "mode":         data.get("mode", "normal"),
        "subject":      data.get("subject", ""),
        "specialty":    data.get("specialty", ""),
        "timer_mode":   data.get("timer_mode", ""),
        "question_ids": data.get("question_ids", []),
        "position":     data.get("position", 0),
        "results":      data.get("results", []),
        "done":         bool(data.get("done", False)),
        "n":            data.get("n", 20),
    }
    _rpath(run_id).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return jsonify({"ok": True})

@app.route("/runs/recent")
def runs_recent():
    sid = request.args.get("session_id", "default")
    runs = []
    for p in RUNS_DIR.glob("*.json"):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            if d.get("session_id") == sid:
                runs.append(d)
        except Exception:
            pass
    runs.sort(key=lambda r: r.get("updated_at", 0), reverse=True)
    return jsonify(runs[:5])

@app.route("/runs/load/<run_id>")
def runs_load(run_id):
    sid = request.args.get("session_id", "default")
    p = _rpath(run_id)
    if not p.exists():
        return jsonify({"error": "not found"}), 404
    d = json.loads(p.read_text(encoding="utf-8"))
    if d.get("session_id") != sid:
        return jsonify({"error": "forbidden"}), 403
    return jsonify(d)

@app.route("/questions/hydrate", methods=["POST"])
def questions_hydrate():
    data = request.get_json(force=True, silent=True) or {}
    ids  = data.get("ids", [])
    out  = []
    for qid in ids:
        if qid.startswith("exam_"):
            try:
                qe = IDX.exam_questions.get(int(qid[5:]))
                if qe: out.append(_eq_norm(qe, reveal=False))
            except (ValueError, TypeError):
                pass
        else:
            q = IDX.questions.get(qid)
            if q: out.append(_q(q, reveal=False))
    return jsonify(out)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 10000)))

