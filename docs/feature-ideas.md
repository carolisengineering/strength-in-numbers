# Feature ideas — potential new features

Candidate features that are not on the roadmap yet. Nothing here is designed or
committed to; an idea graduates by getting a spec number in `docs/specs/README.md`
(and DESIGN.md if it changes scope). Bugs and rough edges go in `docs/backlog.md`
(BL-*) instead; security items in `docs/security-backlog.md` (SB-*).

Numbering is append-only — never renumber an existing FI.

| ID | Idea | Area | Source | Added | Status |
|----|------|------|--------|-------|--------|
| [FI-1](#fi-1) | Target weight on routine items (planned sets) | Routines | Phone check | 2026-10-11 | Implemented (09.1 #73, 10.2 #74) |
| [FI-2](#fi-2) | Routine sections, each with its own note (warm-up / main / accessory) | Routines | Phone check | 2026-10-11 | Implemented (09.2 #76, 10.3 #77; workout sections 09.4 #143, 10.6 #145/#146) |
| [FI-3](#fi-3) | Default exercises from existing custom exercises | Catalog | Phone check | 2026-10-11 | Idea — GitHub #117 |
| [FI-4](#fi-4) | Export to Hevy | Import / export | Phone check | 2026-10-11 | Idea — GitHub #92 |
| [FI-5](#fi-5) | Import from Hevy | Import / export | Phone check | 2026-10-11 | Idea — GitHub #87 |
| [FI-6](#fi-6) | Create a routine from a screenshot of a workout in another app | Routines / import | Owner | 2026-10-11 | Implemented (10.4 #132–#134, round 2 #148; GitHub #88) |
| [FI-7](#fi-7) | Show the routine's notes in history for a workout started from it | Routines / History | Owner | 2026-10-11 | Implemented (09.2 `routine_notes_snapshot`, 10.3: History and the summary show it) |
| [FI-8](#fi-8) | Whole-app design review with the `impeccable` skill | UI / design | Owner | 2026-10-11 | Done — the design refresh (Specs 17.0–17.3, #83–#100) |
| [FI-9](#fi-9) | Archive routines | Routines | Owner | 2026-10-11 | Idea |
| [FI-10](#fi-10) | Routine folders | Routines | Owner | 2026-10-11 | Idea |
| [FI-11](#fi-11) | Planned duration/distance for timed and distance exercises | Routines | Planned-sets design | 2026-10-11 | Idea |

## FI-1

**Target weight on routine items.** "Routines should have the ability to pre-program
weights and reps."

What exists: routine items already carry target sets, a rep range, RPE and rest
(Spec 09); there is no target weight. Reps are covered, so this may also be a
discoverability question on the phone.

**Specced 2026-10-11 as Spec 09.1 (API: planned-set rows per routine item, snapshotted
onto started workouts) and Spec 10.2 (UI: weight in the quick line, "Plan each set",
session prefill and "Set k of N").** Owner decisions are in the brief
(`docs/superpowers/specs/2026-10-11-planned-sets-design-brief.md`, kept locally) and
DESIGN Q20. Not covered (deferred by that design): planned duration/distance (FI-11),
per-set RPE, automatic progression.

## FI-2

**Routine sections with their own notes.** "I want to be able to add more than one
note per routine (i.e. a warmup section, a workout section, an accessory section,
each with its own note separate from the exercise)."

What exists: one routine-level `notes` and per-item notes (Spec 09, copied into the
workout on start by D22). No grouping of items into named sections.

## FI-3

**Default exercises from existing custom exercises.** "We need to expand the exercise
list — can we read from the existing custom exercises and add those as defaults?"

What exists: the global catalog comes from the append-only seed
(`apps/api/prisma/catalog/exercises.json`, Spec 03.1). Open question when designed:
what happens to the existing custom copies once a matching global row exists.

## FI-4

**Export to Hevy.** Needs Hevy's actual import format and an exercise-name mapping.
Related: Spec 11's account export (our own JSON format).

## FI-5

**Import from Hevy.** Needs Hevy's export format, an exercise-name mapping (and what
to do with unmatched names), and a decision on duplicates when importing twice.

## FI-6

**Routine from a screenshot.** "Screenshot a workout written in another app and
automatically input it into strength-in-numbers as a routine, with the correct reps
and sets listed."

What exists: routines and their targets (sets, rep range, RPE, rest — Spec 09) and the
routine editor (Spec 10.0), which could show the result as an unsaved draft to check
before saving.

Open questions when designed:
- How the screenshot is read: a vision model (for example Claude) or on-device OCR.
  Sending a screenshot of someone's training to an outside service touches DESIGN §8.2
  ("do not share training data with third parties"), so that needs a decision.
- Matching the screenshot's exercise names to the catalog, and what to do with names
  that don't match. Shared with FI-5.
- Weights in the screenshot need somewhere to go. Depends on FI-1.

## FI-7

**Routine notes in history.** "When I have routine notes and I log a workout from that
routine, I want to be able to see the routine notes in my exercise history for that day."

What exists (checked 2026-10-11):
- **Per-exercise notes already reach history.** Starting from a routine copies each
  item's notes into the workout (Spec 09 D22), and the finished-workout screen in History
  shows them under the exercise name (Spec 10.1). Workouts started before 2026-10-11 have
  none (no backfill).
- **The routine's own notes do not.** The start copies only the routine's name
  (`routine_name_snapshot`), not `routine.notes`, so there's nothing to show later.
- The Progress screen's per-exercise session list shows no notes of either kind.

Open questions when designed:
- Where "exercise history for that day" means: the workout in the History tab, the
  Progress screen's sessions list for one exercise, or both.
- How to keep the routine's notes: a new snapshot column on `workout` (like
  `routine_name_snapshot`, so later edits to the routine don't change past workouts),
  or copied into the workout's own session notes (simpler, but mixes two kinds of note).
- Probably interacts with FI-2 (routine sections, each with its own note).

## FI-8

**Impeccable design review.** Run the `impeccable` skill's critique / audit over the web
app as a whole: visual hierarchy, typography, spacing, color, empty and error states,
accessibility, and how it holds up one-handed on a phone at 320–390 px.

Not now. A natural fit for M4's "empty + error states, accessibility pass" (DESIGN §9),
ideally after the phone week so real-use findings feed it. Output is a findings list;
fixes then go through specs as usual, and any change to design values happens only in
`apps/web/src/ui/tokens.css`.

## FI-9

**Archive routines.** Hide a routine from the list without deleting it, and bring it
back later.

What exists: routines are hard-delete only. **Spec 09 D4 deliberately dropped
`archived_at`** (owner decision, 2026-10-08): past workouts don't need the routine
(they keep a name snapshot), and archive was rejected as "a list that never shrinks,
plus un-archive UX, for a template with no history of its own". Adding it means
revisiting D4 and DESIGN §4.3 / §4.9 / Q18.

Open questions when designed:
- What changed since D4: is it about clutter (then FI-10 folders might cover it) or
  about keeping old programs to reuse later?
- Do archived routines count toward the 50-routine limit?
- Can you start a workout from an archived routine, or only un-archive it?

## FI-10

**Routine folders.** Group routines into named folders (for example by program or
training block) on the routines list.

What exists: one flat list per user, in the server's order (Spec 10.0), capped at 50
routines.

Open questions when designed:
- One level of folders, or nested?
- Can a routine be in more than one folder (folders) or exactly one (more like tags)?
- What happens to a folder's routines when the folder is deleted?
- Overlaps FI-9: an "Archive" folder could be the archive, which would avoid a second
  mechanism.

## FI-11

**Planned duration/distance for timed and distance exercises.** A routine item for a
plank or a run could say "3 × 60 s" or "5 km in 30 min", and the session would prefill
the duration or distance the way Spec 10.2 prefills weight and reps.

What exists: planned sets (Spec 09.1, FI-1) carry a set type, a rep range and a weight
only. For `duration` and `distance_duration` exercises a planned row carries a set type
and nothing else, so a timed item reads "3 sets" with no target time (09.1 D8).

Open questions when designed:
- Columns on `routine_item_set` / `workout_planned_set` (`duration_s`, `distance` +
  `distance_unit`): additive migration plus additive fields on `PlannedSet`, per
  modality (`duration` plans time; `distance_duration` plans distance and/or time).
- Prefill into the session's minutes/seconds and distance inputs, and the target line
  ("3 × 1:00", "5 km").
- Whether legacy reps stored on timed exercises (tolerated by Spec 09.1 D5) should be
  cleaned up by then.
