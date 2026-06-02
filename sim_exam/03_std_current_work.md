# 03_std_current_work.md

## Overview
Tracks the current state of 13_sim_cases development via indexed iterations. Each state represents a major iteration or pass. Cross-referenced in 04_std_implementation_plan.md to define what needs to be built next.

See `reference.md` for how to use this file.

---

## State 00: srcfiles

**Status**: ✅ Complete (archival)

Raw source material extracted from student-reported exam experiences.

### Files
- `Simtenta_T7_HT25.docx` (47 KB) → extracted as `st_ht25.md`
  - Real exam cases reported by HT25 cohort
  - Station scenarios, patient presentations, common pitfalls
  
- `Muntasammanstallning_VT25.docx` (43 KB) → extracted as `st_munta.md`
  - Real oral exam cases (VT25 cohort)
  - Staged station flows, examiner feedback patterns
  
- `Simtenta_prep.docx` (252 KB) → extracted as `st_main.md`
  - Comprehensive prep material (student-compiled, OBS EJ FÄRDIGSTÄLLD)
  - All specialties, status techniques, differential frameworks, SBAR templates

### Purpose
Provides ground truth for what a real simtenta station actually looks like. Used to validate State 01 & State 02 against reality.

### Archived Location
`13_sim_cases/00_srcfiles/` (kept for audit trail & future reference)

---

## State 01: firstpass

**Status**: ✅ Complete (reference baseline, not in active use)

Initial Claude pass generating autismfinal engine & supporting documentation.

### Files
- `01_case_scope.md` (4 KB)
  - Initial exam structure mapping
  - Case categorization by specialty & yield
  
- `02_simulation_cases_autismfinal.json` (104 KB)
  - **Schema**: `case = opening_state + beats[]`
  - **Beat structure**: `state/question/gold/must_include/fail_triggers/followup_if_weak/followup_if_wrong/next`
  - 23 cases, 76 beats, 21 HIGH-yield
  - **Strength**: Excellent for differential diagnosis drilling & decision-making under pressure
  - **Limitation**: Missing anamnes-taking, status-demonstration, SBAR delivery, bemötande grading, patient/nurse/examiner personas
  
- `03_failure_triggers.md` (3 KB)
  - Common mistakes per specialty
  - Why each mistake costs points
  
- `04_simulation_rules_autismfinal.md` (4 KB)
  - Engine mechanics: how Claude plays the cases
  - State-transition rules
  - Scoring & feedback logic

### Verdict
Good foundation for pure clinical reasoning drilling, but doesn't match real exam flow. Kept as reference for future iteration or hybrid approach.

### Archived Location
`13_sim_cases/01_firstpass/` (kept for reference & potential future hybrid use)

---

## State 02: secondpass [CURRENT]

**Status**: ⚠️ Functional but has known problems (see State 03)

Real exam-aligned iteration. Cases grounded in State 00 sources. Playable interface. Gap analysis against real exam.

### Files

#### `00_alignment.md` (3.3 KB)
- **Gap analysis**: autismfinal vs real simtenta station flow
- **Verdict**: autismfinal captures ~50% of exam (resonance + grilling) but misses real station structure
- **Missing**: anamnes-taking, status-demonstration, SBAR delivery, bemötande grading, patient/nurse/examiner personas
- **Real flow**: ROLL → ANAMNES → STATUS → PROVER → HANDLÄGGNING → UTREDNING → PATIENTINFO → SBAR → FÖLJDFRÅGOR → FEEDBACK
- **Recommendation**: Use both tools (autismfinal for pure reasoning; State 02 for full flow)

#### `04_engine_rules_v2.md` (4.8 KB)
- 7-step discipline for running cases in real station flow
- **Key enforcements**:
  1. Fasordning (exact phase sequence per case)
  2. Per-fase spellayout (how to run each phase type)
  3. Roller & ton (patient/sköterska/examinator personas)
  4. Påtvingade ordningar (ABCDE, distalstatus-före-bedövning, etc.)
  5. Tail mechanics (escalations, continuation)
  6. Svårighet-progression (weak → medium → strong difficulty)
  7. Scoring (lightweight per-phase tracking)

#### `cases_simtenta.json` (122.7 KB, 3000 lines)
- **25 real, reported cases** (all 10 specialties)
- **HIGH-yield**: 22 cases; MED: 3 cases
- **Total phases**: 193 (average 8 per case)
- **Schema**:
  ```json
  {
    "id": "case_id",
    "subject": "Kirurgi",
    "site": "Molndal/Ostra",
    "yield": "HIGH",
    "mode": "docka/skadespelare/papper",
    "role": "Underlakare på akuten",
    "frame": "Patient presentation & context",
    "facit": "Diagnosis/primary decision",
    "phases": [
      {
        "type": "anamnes|status|prover|handlaggning|utredning|patientinfo|sbar|foljdfragor|feedback",
        "goal": "What to do in this phase",
        "reveal": ["Facit item 1"],
        "qa": [{"q": "Question", "a": "Answer"}],
        "pitfalls": ["Common error 1"]
      }
    ],
    "tail": {
      "directive": "How case continues",
      "escalations": ["Escalation scenario 1"]
    }
  }
  ```
- **Specialty breakdown**: Anestesi (3), Kirurgi (6), Kärl (2), Ortopedi (3), Onkologi (2), Endokrin (2), Hand (3), Plastik (1), Urologi (2), Radiologi (1)

#### `simtenta_spel.html` (141.7 KB, 3500 lines)
- **Playable browser interface** (fully self-contained, no external deps except CDN fonts)
- **Features**:
  - Home: filter by subject/yield, "Slumpa HIGH-yield" button
  - Case view: role + frame + vital params
  - Phase walker: one phase at a time, textarea input, "Visa facit" button
  - Reveal: facit + pitfalls + self-score buttons (Träffade/Delvis/Missade or 1/2/3 keypress)
  - Följdfrågor: Q → reveal answer → next
  - Feedback: per-phase score chips + tail escalations
  - **No localStorage** (forbidden in artifacts); all state in-memory
- **Design**: Calm clinical dark UI (Teal + Amber accents, monospace data displays, low cognitive load)

### Known Problems (See State 03)
- ❌ Answers being displayed in anamnes/status phases before student submits
- ❌ Tail/escalation mechanics not functional (buttons don't wire correctly)
- ❌ "Neverending" escalations concept is scope creep (scrapping for now; crosslinking is future work)

### Current Location
`13_sim_cases/02_secondpass/` (active, deployed at kirurgi.xyz as `simtenta_spel.html`)

---

## State 03: thirdpass [PLANNED]

**Status**: 📋 Not yet started (see 04_std_implementation_plan.md for details)

Fix critical issues from State 02. Clean clinical flow. Clear endpoints. Prepare for integration into Engine3.

### Problems to Solve

#### 1. Anamnes/Status Phase Reveal Logic
- **Problem**: Answers/findings are displayed in `reveal` field *before* student writes answer + clicks "Visa facit"
- **Root cause**: `reveal[]` is pre-populated in JSON; frontend reveals it too early
- **Solution**: 
  - Keep `reveal[]` in JSON (for data integrity)
  - Frontend: don't display `reveal` until "Visa facit" is clicked
  - For anamnes: patient answers only when explicitly asked (hide `reveal` until asked)
  - For status: findings only revealed after student describes exam procedure (hide `reveal` until "Visa facit" clicked)

#### 2. Tail/Escalation Mechanics
- **Problem**: Escalation buttons don't wire correctly; tail loop doesn't function
- **Root cause**: JS event handlers for tail navigation incomplete; state machine broken
- **Solution**:
  - Fix `renderTail()` function in `simtenta_spel.html`
  - Wire "Nästa eskalering" buttons to advance through `escalations[]` array
  - Clear state between escalations (don't carry over answers)
  - Test full escalation sequence

#### 3. Neverending Loop (SCRAPPING)
- **Problem**: Original design was "if relevant, keep extending the case indefinitely"
- **Reality**: Stupid scope creep; real exams have bounded escalations
- **Decision**: Scrap the "neverending" concept for now
- **New behavior**: 
  - Each case has 1–3 escalations (hardcoded in JSON)
  - After final escalation, show "Fallet är slut. Nästa?"
  - Crosslinking escalations to entity patterns = separate future project (04_future_work)

### Files to Modify

| File | Changes |
|------|---------|
| `cases_simtenta.json` | No changes (data stays same; frontend logic fixed) |
| `simtenta_spel.html` | 1) Fix reveal logic for anamnes/status; 2) Fix tail navigation; 3) Remove "neverending" UI |
| `04_engine_rules_v2.md` | Update: Remove "neverending tail" language; clarify bounded escalations |

### Success Criteria

- ✅ Anamnes/status phases hide answers until "Visa facit" clicked
- ✅ Tail escalations advance correctly through `escalations[]` array
- ✅ Each case ends with "Fallet är slut" message (no infinite loop)
- ✅ Keyboard shortcuts (1/2/3) still work for scoring
- ✅ Follow-up questions remain per-question reveal (unchanged)
- ✅ All 25 cases play without JS errors
- ✅ Test on Chrome, Firefox, Safari (desktop + mobile)

### Integration Ready?
Once State 03 is complete:
- creat and move the files to `03_thirdpass`
- Update main nav to link to sim cases


## Notes & Iteration Log

- **State 00 → 01**: Built autismfinal engine (good for reasoning, missed exam flow)
- **State 01 → 02**: Reanalyzed real exams, generated 25 cases, wrote playable HTML (excellent structure, but 3 critical bugs)
- **State 02 → 03**: Fix bugs, clean flow, prepare for integration (current task)
---

## How to Use This File

- **You**: When starting new iteration, add new "State XX" section above, copy this structure, fill in status & files
- **AI Assistant**: Read this file to understand current work state. Index number in section header tells you what's implemented & what's planned
- **Reference**: Point to specific state number in 04_std_implementation_plan.md (e.g., "implement State 03")
- 
- Important: i added qbank from old theoretical exams - they have nothing to do with the practical sim exam - but some of the questions probably are related to parts of it in the practical - u can use it as needed for tasks when u decide u need it
- there is also curriculum - descreibes what we need to know exactly 