# 04_std_implementation_plan.md

## Overview

Concrete action plan for moving from State 02 (secondpass, current) to State 03 (thirdpass, planned).

**Read**: Start here after reading 01, 02, 03 in order. This file tells you exactly what to build.

---

## Current State

- **Source iteration**: **State 02** (see `03_std_current_work.md`, State 02)
- **Status**: Functional but has 3 critical issues blocking integration
- **Files in use**:
  - `cases_simtenta.json` (25 cases, 193 phases)
  - `simtenta_spel.html` (playable interface, 3500 lines)
  - `04_engine_rules_v2.md` (7-step discipline)
  - `00_alignment.md` (gap analysis)

---

## Target State

- **Target iteration**: **State 03** (see `03_std_current_work.md`, State 03)
- **Outcome**: Clean, playable clinical flow simulation with correct reveal logic, functional escalations, and clear endpoints
- **Ready for**: Integration into `Engine3/13_sim_cases/`

---

## Problems to Fix

### Problem 1: Anamnes/Status Answers Revealed Too Early

**Issue**: In anamnes and status phases, the `reveal[]` array is displayed before the student submits their answer or clicks "Visa facit".

**Why it breaks the flow**: 
- Anamnes should be: student asks question → patient answers (from `reveal[]`)
- Currently: patient answer is visible before question is asked
- Status should be: student describes exam → findings revealed on "Visa facit" click
- Currently: findings are visible from the start

**Root cause**: Frontend doesn't distinguish between phases that should auto-reveal vs. delayed-reveal. All `reveal[]` items are displayed immediately in the phase render.

**Solution**:
1. **No JSON changes** — keep `reveal[]` intact (it's the source of truth)
2. **Frontend logic fix** (`simtenta_spel.html`):
   - For `anamnes` phase: show goal + textarea (no reveal until "Visa facit" clicked)
   - For `status` phase: show goal + textarea (no reveal until "Visa facit" clicked)
   - For all other phases: current behavior (reveal on "Visa facit")
3. **Patient role clarification**: In anamnes, when student asks a question, respond by pulling the relevant item from `reveal[]` (simulated patient answering)

**Code location**: `simtenta_spel.html`, function `revealPhase()` (~line 250–280)

**Test case**: 
- Open case `anestesi_postop_abcde`
- Phase: anamnes
- Verify: no answer items visible until "Visa facit" is clicked
- Ask a question (e.g., "vitalparametrar?") → verify patient responds from `reveal[]`

---

### Problem 2: Tail/Escalation Mechanics Non-Functional

**Issue**: Escalation buttons in the tail section don't advance through the `escalations[]` array. State doesn't update; buttons click but nothing happens.

**Why it breaks the flow**:
- After feedback, user should see first escalation scenario
- Click "Nästa eskalering →" → should show next escalation
- Currently: click does nothing or throws JS error

**Root cause**: `renderTail()` function in JavaScript has incomplete event wiring. State variable `S.tail` exists but isn't properly incremented, and the DOM update doesn't trigger.

**Solution**:
1. Fix `renderTail()` to:
   - Increment `S.tail++` on button click
   - Call `renderTail()` recursively with updated index
   - Handle edge case: when `S.tail >= escs.length`, show "Fallet är slut" message
2. Wire textarea input (user's response to escalation) — currently captured but not used
3. Clear state between escalations (don't carry textarea content forward)

**Code location**: `simtenta_spel.html`, function `renderTail()` (~line 350–380)

**Test case**:
- Open case with escalations (e.g., `kir_nedre_gi`)
- Progress through all phases to feedback
- Verify: first escalation displays correctly
- Click "Nästa eskalering →" button → escalation counter increments, new scenario displays
- Continue until final escalation, then show "Fallet är slut"

---

### Problem 3: Neverending Loop (SCRAPPING)

**Issue**: Original design tried to extend cases indefinitely if "relevant continuation found". Vague scope, no real endpoint.

**Why it's dumb**:
- Real exams don't have infinite escalations; examinators stop, give feedback, move on
- Trying to auto-link escalations to entity patterns = future crosslink project, not MVP
- Current code has dead code / incomplete logic for this

**Decision**: Scrap the "neverending" concept entirely.

**New behavior**:
- Each case in `cases_simtenta.json` has exactly 1–3 escalations (hardcoded)
- After final escalation, show: `"Fallet är slut. Nästa fall? [Slumpa HIGH-yield] [Alla fall]"`
- No attempt to auto-generate new content
- Crosslinking escalations to entity patterns = separate future project (post-MVP)

**Solution**:
1. In `cases_simtenta.json`: verify all 25 cases have `tail.escalations[]` array (1–3 items each)
   - If missing, set to empty `[]` or single generic escalation
2. In `simtenta_spel.html`, function `renderTail()`:
   - When `S.tail >= escs.length`, render end-of-case buttons (not neverending loop)
3. Remove any code references to "auto-generate escalation" or "find next entity"
4. Update `04_engine_rules_v2.md`: remove "neverending" language; clarify "bounded escalations"

**Test case**:
- Play case with 2 escalations
- After 2nd escalation, verify "Fallet är slut" message appears
- Buttons: `[⚡ Nästa HIGH-yield] [Alla fall]`
- No further escalations auto-generated

---

## Files to Modify

### 1. `simtenta_spel.html` (PRIMARY)

**Changes**:
- Fix `revealPhase()`: anamnes/status don't auto-reveal
- Fix `renderTail()`: escalations advance correctly, end at final escalation
- Remove dead code related to "neverending" logic
- Ensure all event handlers wire correctly (button clicks, keyboard shortcuts still work)

**Lines affected**: ~250–280 (reveal logic), ~350–380 (tail logic), possibly others

**Estimated effort**: 2–3 hours (careful JS debugging required)

**Test thoroughly**: All 25 cases, all phases, keyboard shortcuts, mobile responsiveness

### 2. `04_engine_rules_v2.md` (SECONDARY)

**Changes**:
- Step 5 (Tail mechanics): clarify "bounded escalations" instead of "neverending"
- Add note: "Escalations are hardcoded per case; crosslinking to entities is future work"
- Update example: show how escalation array ends, not continues infinitely

**Lines affected**: Step 5, ~2–3 paragraphs

**Estimated effort**: 15 min

### 3. `cases_simtenta.json` (VERIFICATION ONLY)

**Changes**: NONE (data stays the same)

**Verification**:
- Check all 25 cases have `tail.escalations` defined (not null)
- Count escalations per case; note any with 0 escalations
- If any case missing escalations, add 1 default escalation or keep empty `[]`

**Estimated effort**: 30 min (script check, not manual edits)

---

## Success Criteria

**Must pass all of these before moving to integration:**

### Functionality
- ✅ Anamnes/status phases: answers hidden until "Visa facit" clicked
- ✅ Patient role in anamnes: responds to questions pulled from `reveal[]`
- ✅ Tail escalations: advance through `escalations[]` array on button click
- ✅ Final escalation: followed by "Fallet är slut" message (not infinite loop)
- ✅ End-of-case buttons: "Slumpa HIGH-yield" and "Alla fall" clickable

### Robustness
- ✅ No JS console errors on any of 25 cases
- ✅ All 25 cases play to completion without breaking
- ✅ Keyboard shortcuts (1/2/3 for scoring, Enter for "Visa facit") still work
- ✅ Follow-up questions (foljdfragor): per-question reveal unchanged
- ✅ Feedback phase: per-phase score chips display correctly

### User Experience
- ✅ Phase rail updates correctly (shows progress)
- ✅ State persists across phase changes (textarea content, scores)
- ✅ Mobile responsiveness maintained (test on iOS Safari, Android Chrome)
- ✅ Calm clinical UI intact (no visual regressions)

### Testing
- ✅ Test on Chrome (desktop), Firefox (desktop), Safari (mobile)
- ✅ Manual play-through: at least 3 full cases (1 HIGH, 1 MED, 1 diverse specialty)
- ✅ Escalation flow: follow case with 3 escalations to completion
- ✅ Edge cases: case with 0 escalations, case with 1 escalation

---

## Deliverables

### Code
- `simtenta_spel.html` (fixed & tested, 3500 lines)

### Documentation
- `04_engine_rules_v2.md` (updated, ~5 KB)
- Changelog or commit message documenting fixes

### Testing Report
- List of cases tested + results
- Any edge cases discovered & how they were handled

Output final: To 03_thirdpass with the files from 02_secondpass and the modified ones updated.
