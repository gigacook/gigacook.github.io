# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Swedish-language medical education content management system for surgical training. It maintains question banks, coverage analyses, audit reports, and clinical decision matrices aligned to an official surgical curriculum. All content is in Swedish.

## Repository Structure

Each specialty lives in a numbered directory with four consistent files:

```
NN_specialty/
├── 01_coverage_map_*.md     — topic-by-topic mapping of what's covered and what's missing
├── 02_question_bank_*.json  — curated MCQ repository for the specialty
├── 03_audit_*.md            — quality assurance: identified gaps, problem questions, recommendations
└── 04_matrix_*.md           — clinical decision-support reference organized by condition/entity
```

Special directories:
- `12_curriculum/01_curriculum.json` — master learning objectives; the ground truth all question banks must cover
- `11_exams/normalized_exam_question_bank.json` — consolidated exam-level questions (~500, drawn from all specialties)

Current specialties (01–10): Anestesi, Kirurgi, Ortopedi, Endokrinkirurgi, Handkirurgi, Kärlkirurgi, Onkologi, Plastikkirurgi, Urologi, Akutmedicin & Trauma.

## Question Bank Schema

Every question in a specialty `02_question_bank_*.json` follows this structure:

```json
{
  "id": "KIR_ANESTESI_001",
  "huvudområde": "Anestesiologi",
  "subtopic": "Fasta",
  "typ": "handläggning|statusfynd|definition|fakta|fysiologi",
  "svårighetsgrad": "lätt|medel|svår",
  "fråga": "Question text in Swedish",
  "alternativ": { "A": "...", "B": "...", "C": "...", "D": "..." },
  "rätt_svar": "C",
  "kort_förklaring": "Explanation of correct answer",
  "varför_övriga_fel": "Why the distractors are wrong",
  "källa": "Source reference",
  "needs_review": "ja|nej"
}
```

The exam bank (`11_exams/`) uses a slightly different schema: numeric `id`, `question`, `options` (A–E), `correct`, `confidence` (high/medium/low), and `subject`.

## ID Naming Convention

Question IDs use the pattern `KIR_<SPECIALTY>_NNN` where specialty abbreviations match the directory names (e.g., `ANESTESI`, `ORTOPEDI`, `UROLOGI`). IDs must be unique across the entire repository.

## Intended Workflow

1. **Curriculum-first**: New questions must map to a learning objective in `12_curriculum/01_curriculum.json`.
2. **Coverage tracking**: After adding questions, update the `01_coverage_map_*.md` for that specialty to reflect which curriculum points are now covered.
3. **Auditing**: The `03_audit_*.md` files record known quality problems and gaps — update these when issues are found or resolved.
4. **Promotion**: High-quality, clinically important questions may be promoted to `11_exams/normalized_exam_question_bank.json`.

## Content Standards

- Questions must have a single unambiguously correct answer supported by a citable source (`källa`).
- `needs_review: "ja"` marks questions that require revision before use in assessments.
- Coverage maps use priority levels (hög/medel/låg) and question type categories (teoretisk/klinisk/procedur/differentialdiagnostisk).
- Decision matrices follow the fields: `area`, `entity`, `tags`, `when_to_suspect`, `discriminators`, `investigation`, `initial_management`, `complications`, `pitfalls`.
