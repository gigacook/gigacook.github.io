# 02_std_current_data_structure.md

## Overview
Engine3 is a clinical knowledge compression & navigation system organized into 10 subject folders + supporting folders. All data is **JSON or Markdown only**. Structure enforces pattern recognition via entity linking, not depth memorization.

---

## Folder Layout (Engine3 BETA root)

```
Engine3/
├── 01_anestesi/
├── 02_kirurgi/
├── 03_ortopedi/
├── 04_endokrinkirurgi/
├── 05_handkirurgi/
├── 06_karlkirurgi/
├── 07_onkologi/
├── 08_plastikkirurgi/
├── 09_urologi/
├── 10_akutmed_trauma_smart/
├── 11_exams/
├── 12_curriculum/
├── 13_sim_cases/*
├── .claude/
├── .git/
├── app.py
├── main.py
├── index.html
├── script.js
├── style.css
└── [backend files]
*IN DEVELOPMENT
*Working files sit next to engine3 root
*See 03_std_current_work_simcases.md
```

---

## Per-Subject Folder Structure (01–10)

Each subject folder (e.g., `02_kirurgi/`) contains exactly **4 files**:

### 1. `01_coverage_map_{subject}.md`
- **Purpose**: Entity index & structural overview
- **Content**: 
  - List of all entities (klinik, undersökning, handläggning, differential, varning)
  - Breadcrumbs/hierarchy showing how entities relate conceptually
  - No questions; no detailed explanations
  - Human-readable reference for what knowledge this subject covers
- **Example**: `01_coverage_map_kirurgi.md`
- **Size**: ~5–15 KB

### 2. `02_question_bank_{subject}.json`
- **Purpose**: Structured Q/A tied to entities
- **Content**:
  - Array of question objects
  - Each question links to one or more entities (via `entity_id`)
  - Fields: `id`, `question`, `answer_choices`, `correct`, `explanation`, `entities[]`, `yield` (HIGH/MED/LOW)
  - No narrative; pure data
- **Example**: `02_question_bank_kirurgi.json`
- **Size**: ~50–150 KB (depends on subject density)
- **Format**:
  ```json
  {
    "subject": "kirurgi",
    "version": "2.0",
    "questions": [
      {
        "id": "kir_001",
        "question": "63-årig man med akut buksmärta...",
        "entities": ["akut_pankreatit", "amylase", "lipase"],
        "yield": "HIGH",
        "answer_choices": [...],
        "correct": 0,
        "explanation": "..."
      }
    ]
  }
  ```

### 3. `03_audit_{subject}.md`
- **Purpose**: Validation & gap analysis (low priority; can be skipped)
- **Content**: 
  - Coverage gaps (entities without questions)
  - Question quality notes
  - Discrepancies between 01 and 02
- **Example**: `03_audit_kirurgi.md`
- **Size**: ~2–5 KB

### 4. `04_matrix_{subject}.md`
- **Purpose**: Entity-to-entity relations & decision space
- **Content**:
  - Defines all entities and how they connect
  - Relations: `entity_a ↔ entity_b` (differential diagnosis, test→finding, finding→action, etc.)
  - Enables traversal: given one entity, what's next?
  - Markdown table or prose format
- **Example**: `04_matrix_kirurgi.md`
- **Size**: ~15–40 KB
- **Example format**:
  ```
  ## Entitet: akut_pankreatit
  
  **Diagnostik**:
  - amylase ↑
  - lipase ↑
  - CT abdomen → nekrös skenhet
  
  **Differentialer**:
  - kolecystit (höger arcus)
  - perforerad ulcus (fri gas)
  
  **Handläggning**:
  - NPO (näring på rör)
  - aggressive vätska
  - smärtlindring (NOT morphine)
  - ERCP vid biliär origin
  ```

---

## Supporting Folders

### 11_exams/
- Cleaned & implemented exam questions from previous courses
- Separate from simulation; reference material only
- Not part of active study pipeline (low priority)

### 12_curriculum/
- Official course requirements & learning outcomes
- Reference for what *should* be known
- Used to validate coverage in 01–10

### 13_sim_cases/ (See 03_std_current_work_simcases.md)
- Currently separate folder being developed
- Will integrate into Engine3 as folder 13 once finalized
- Contains simulation cases, engine rules, and playable interfaces

---

## Data Flow & Linking

```
01_coverage_map_{subject}
    ↓ (defines entities)
04_matrix_{subject}
    ↓ (shows entity relations)
02_question_bank_{subject}
    ↓ (questions tied to entities)
Frontend (traversal via entity clicking, decision flow)
```

**Key principle**: Questions are not standalone Q/A; they are **entry points to entity networks**. Answering a question reveals patterns across related entities.

---

## Naming Conventions

- **Files**: `NN_descriptive_name_{subject}.format`
  - `NN` = sequence number (01–04 per subject, 11–12 supporting)
  - `descriptive_name` = `coverage_map`, `question_bank`, `audit`, `matrix`
  - `subject` = kebab-case subject name (`kirurgi`, `ortopedi`, etc.)
  - `format` = `.md` or `.json`

- **Entity IDs** (in JSON & matrix): `lowercase_underscore_format`
  - Example: `akut_pankreatit`, `abcde_primary_survey`, `thompson_test`

- **Question IDs**: `{subject_abbrev}_{number}`
  - Example: `kir_001`, `ort_042`, `anest_128`

---

## Frontend Consumption

The Python backend (`app.py`, `main.py`) and frontend (`index.html`, `script.js`) consume:
- **02_question_bank_*.json** — loads Q/A directly
- **04_matrix_*.json** (future) — enables entity-linked navigation
- Displays via `kirurgi.xyz`
- Uses GitHub for repo, Render for backend deployment
- Future: Firebase for user logins, leaderboards, saves

---

## Rules for New Content

1. **Always validate against existing structure**: If adding to subject folder, update all 4 files (`01`–`04`), not just one.
2. **Entity consistency**: Entity ID in `02_question_bank` must exist in `04_matrix`.
3. **No redundancy**: If information exists in `04_matrix`, don't duplicate it in `02`.
4. **JSON-first for data, Markdown for relations**: Questions go in JSON; entity definitions & flows go in Markdown.
5. **Versioning**: Each file should have a `version` field (e.g., `"version": "2.0"`).

---

## Example File Sizes & Structure

| File | Typical Size | Lines | Format |
|------|------------|-------|--------|
| `01_coverage_map_kirurgi.md` | 12 KB | 150–250 | Markdown |
| `02_question_bank_kirurgi.json` | 120 KB | 2000–3000 | JSON (minified or formatted) |
| `03_audit_kirurgi.md` | 3 KB | 50–100 | Markdown |
| `04_matrix_kirurgi.md` | 30 KB | 300–500 | Markdown |

---

## Current State
- **10 subjects** (01–10): Populated with coverage maps, question banks, matrices
- **11_exams**: Reference material (low priority)
- **12_curriculum**: Course requirements (reference only)
- **13_sim_cases**: In active development, see  (see `03_std_current_work_simcases.md`)
- **Backend**: Python (Render-deployed), frontend via kirurgi.xyz
- **Repo**: GitHub-hosted at `gigacook/gigacook.github.io`

---

## Instructions for AI Assistant

When working with this structure:
1. **Respect existing naming**: Use `NN_descriptive_{subject}` format; don't invent new file names
2. **Update all 4 per subject**: If modifying one subject, ensure `01`–`04` remain in sync
3. **Entity linking first**: Define entities in `04_matrix` before creating questions in `02`
4. **JSON for traversal data**: Use JSON for anything the frontend will navigate/filter
5. **Markdown for rules/narrative**: Use Markdown for documentation, rules, and conceptual flows
6. **Test in browser**: Validate that new content renders and links correctly on frontend before finalizing
