# Design refresh plan (web)

**Status:** Draft, 2026-10-15. Nothing implemented yet.
**Source:** Impeccable critique of `apps/web`, 2026-10-15. It scored 20/40, which counts as "acceptable" (significant work needed). The full report is in `.impeccable/critique/2026-10-16T03-00-39Z__apps-web.md` (untracked).

## Goal

The app works, but using it feels clunky. The black/blue palette is generic, and buttons are misaligned, crowd each other or float over content.

The goal is to make it feel like a **calm, precise instrument** for the one job that matters most: logging the next set, one-handed, between sets.

The redesign keeps everything the app does, its data and its copy. It replaces the look, and on the workout screen it also changes how logging works.

## Principles

- **The current set comes first.** On the workout screen, the next thing to do is the most prominent thing on screen.
- **Color means something.** One accent for "do this next", one color used only for PRs, and muted warm-ups. Nothing is colored just for decoration.
- **Numbers are the content.** Weight × reps and PR deltas get the largest, steadiest type, with figures that line up in columns.
- **Space groups things, boxes don't.** Use alignment and spacing before adding an outline.
- **Keep the ergonomics we have:** 44px tap targets, thumb-zone actions, `tokens.css` as the only place design values are written (`assert:css-tokens`), and the existing resilience states.

## Stages

Each stage is its own branch and PR. Stages 1, 2, 4 and 5 are visual and layout work on existing behavior. Stage 3 changes behavior, so it gets a spec first, following the repo's spec-driven rule.

### Stage 1: Layout fixes

**Status:** implemented 2026-10-16 on `fix/web-layout` (commit 7aa65af), not yet reviewed or pushed. It also adds a shared bottom `ActionBar` (now used by the start screen too) and fixes the start screen's spread-out spacing.

**Scope:** fix structure on the current look. No new colors or fonts.

- **Sticky Add exercise / Finish bar** (`features/workouts/ActiveSession.module.css:37-46`):
  - It parks about 16px above the nav because `<main>` has `padding-bottom` (`app/AppShell.module.css:61`). Logged sets scroll visibly through that gap.
  - It has no `z-index`, so the superset bracket can paint over it.
  - Fix: no gap under the bar, a full-bleed background, and the bar layered above the cards.
- **Routine editor rows** (`features/routines/RoutineEditor.module.css:37-57`):
  - Options is vertically centered beside variable-height cards.
  - Section, item card and "Superset with next" each start at a different left edge.
  - Fix: put Options inside the card's top-right corner, as `ExerciseCard` does, and use one left edge plus a fixed gutter for the superset bracket.
- **Section name** (`features/routines/Sections.module.css:30-42`): it's a bordered button that looks like the Options chip next to it. It should read as a heading with an edit affordance.
- **Ragged right edges:** the note panel (`RoutineNotePanel.module.css:3`) and the exercise card (`ExerciseCard.module.css:5`) use different padding. Fix: one padding token for every card.
- **Entry row** (`SetFields.module.css:18`): the Reps input stops at two-thirds width. Fix: an even weight | reps grid.
- **Expanded exercise Options** (`ExerciseCard.module.css:32-36`): they wrap into two uneven rows.
- **Editor Cancel/Save** (`RoutineEditor.module.css:2-11`): a sticky header at the top, out of thumb reach. Fix: move it to a bottom bar.
- **Disabled primary button** (`ui/Button.module.css:18`): 55% opacity reads as broken and fails contrast. Fix: a distinct disabled style.

**Out of scope:** colors, fonts, and any change to how the workout screen behaves.
**Done when:**
- Phone and desktop screenshots show no control overlapping content or another control.
- Each card and row lines up on one left edge and one right edge.
- Existing tests pass, plus a phone check on a real device.

### Stage 2: New visual identity ("calm and precise")

**Scope:** replace the palette, the type and how surfaces are styled.

**Process:**
1. Run `/impeccable init` to record product truth in `PRODUCT.md`.
2. Pick from 2–3 concrete directions, with real screens in each.
3. Apply the chosen direction through `tokens.css`.
4. Add a visual-design section to `docs/DESIGN.md`, which stays the source of truth.

**Chosen direction: Stone** (Carol, 2026-10-15, picked from three mockups: Stone, Graphite, Olive-gray):
- **Light-first:** the default follows the phone's light/dark setting, and dark is a deliberate matching version. The gym is a boutique gym with lots of natural light.
- **Warm stone neutrals:** a very light warm ground (about `#f3f1ec`), slightly lighter panels (about `#fbfaf7`), warm ink (about `#24211d`).
- **Signal:** deep teal (about `#1f5f5b`; dark mode about `#6fbab1`), for "next / log" only.
- **PR:** brass (about `#84651c`; dark mode about `#d8b566`), for records only.
- **Warm-up sets:** muted, marked W.
- **Type:** Instrument Sans, self-hosted (OFL).
  - Checked 2026-10-15: it has a real `tnum` feature covering all ten digits at one width, and the Google Fonts subset keeps it.
  - Its default figures are proportional, so number styles must set `font-variant-numeric: tabular-nums`.
  - It's a variable font with weight and width axes, so a slightly narrower width can help large numbers fit without a second family.
- **Surfaces:** fewer outlined boxes. Panels separate by tint, rows by spacing.
- The hex values come from the mockup and get re-checked for contrast when they go into `tokens.css`.
- The mockup page is https://claude.ai/artifact/GWhVzq1b1DVGWQAeYGemiW (private).

**Tokens to add:** semantic roles such as `--color-signal`, `--color-pr` and `--color-warmup`, alongside the existing set. The CSP stays `font-src 'self'`, so fonts are self-hosted.

**Out of scope:** structural changes to the workout screen (Stage 3).
**Done when:**
- Every screen uses the new tokens.
- Light and dark both pass contrast (4.5:1 for body text).
- `assert:css-tokens` passes.
- DESIGN.md is updated.

### Stage 3: Workout screen rebuilt around "now"

**Scope:** a new UI spec, then the implementation. It uses data the API already has, so no API change is expected; the spec will confirm.

- Only the current exercise is expanded. The rest collapse to one line, e.g. "Overhead Press · 1 of 4 · next 47.5 × 6".
- Big ± steppers for weight and reps, so the keyboard is the exception.
- The pinned button becomes the per-set action ("Log 82.5 × 5"). Add exercise moves into the list. Finish goes to the end of the list or the header.
- Auto-advance to the next set or exercise after logging.
- A rest timer that starts from the routine's stored rest.

**Decisions (Carol, 2026-10-15):**
- **Supersets:** "current" alternates automatically between the exercises in the run.
- **Steppers:** ±5 lb for both barbell and dumbbell weights; reps go ±1. The kg equivalent for kg users is still open.
- **Rest timer:** the countdown goes in the current-set panel, with a progress line across the top of the screen. See open decisions.
- **Finish:** the bottom button becomes "Finish workout" once every planned set is logged. Ending early is always possible through a separate, always-reachable action, and it warns about unlogged sets (Stage 4).
- **Workouts without a routine:** supported. "Current" is the exercise last touched; check the screen doesn't feel empty without a plan.
- **RPE:** Carol wants it removed entirely. This is a product change, not just layout, so its scope needs settling (see open decisions).
- **"Last time":** cut from Stage 3 (Carol, 2026-10-15). It's kept under Future enhancements. Stage 3 needs no API change.

**Must keep:** the outbox / offline behavior, drafts (Spec 06.5), planned-set prefill (Spec 10.2), and superset and section display (Specs 10.1 / 10.3).
**Done when:** the spec's acceptance criteria pass, plus a phone check mid-workout.

### Stage 4: Finish and PR moments

- The Finish dialog leads with what you did and flags "N planned sets not logged" before the "can't be edited" note.
- The finished-workout summary leads with duration, volume, sets and PR count.
- One PR card per exercise: a big new number and a "+2.5 kg" delta, instead of the bulleted text list.
- Round e1RM for display to 1 lb (0.5 kg for kg users). Never show "137.08 kg". Deltas are computed after rounding.

**Decisions (Carol, 2026-10-15),** from the mockup at https://claude.ai/artifact/NKGaeFg3iE4FYEhhRvFJpE:
- One card per exercise. The lead record is big, with a brass "+N" gain and "was …" underneath. The exercise's other records show as **name-only chips**.
- **Set-volume records are hidden** on the summary. They're still visible in Progress.
- **e1RM rounds to 1 lb.**
- The **header includes total volume**: duration · exercises · sets · volume.
- **Quiet celebration:** no reveal animation; the brass color and the layout carry it.
- The Finish dialog and History treatments follow the mockup: it leads with duration, exercises and sets, spells out unlogged planned sets when ending early, and shows the brass trophy plus count only on workouts with records.
- History shows a trophy only on sessions that set a PR. The critique saw one on every row; check whether that comes from the fake data or the logic.

### Stage 5: Landing page

`screens/Landing.tsx` is still unstyled; its comment points to Spec 04.1.

**Decision (Carol, 2026-10-15):** a calm front door for Carol and invited friends, not a product page.
- The page has the app name set in Instrument Sans, one plain line on what it does and a big Log in button in the thumb zone, on the Stone background. Nothing else.
- A product page waits for the production launch.

**Details (Carol accepted the defaults, 2026-10-15):**
- One-liner: "Log your lifts, follow your plan, see your progress."
- No mark: the name is set in Instrument Sans.
- The button says "Log in".
- Whether strangers can sign up is an Auth0 setting to check separately, not a design decision.

### Final pass: `/impeccable polish`, then a fresh critique

- Accessible names: the bare "Options" (10× on one screen), "Log set" and "More" should name their exercise.
- The header title duplicates the page heading on every tab.
- A metric toggle with only one option still renders as a selected chip.
- Inconsistent dates ("Sept" vs "Sep").
- The Units setting is styled like Time zone even though it changes every number.
- The desktop bottom nav stretches across the full width.
- Rerun `/impeccable critique` and compare with 20/40.

## Order and why

1 → 2 → 3 → 4 → 5, then polish.

- Layout goes first: it's quick, fixes the daily annoyances and survives the restyle.
- Identity goes before the workout screen, so the new screen is built once in the new style instead of being restyled.
- The counterargument: the workout screen is the clunkiest part, and doing it first would help sooner. That's open (see below).

## Open decisions

- [x] Stage 2 (new look) before Stage 3 (workout screen) (2026-10-15).
- [x] Stepper increments: ±5 lb for barbell and dumbbell, ±2.5 kg for kg users (2026-10-15).
- [x] Rest timer (2026-10-15):
  - The countdown sits in the current-set panel (option A), plus a thin signal-colored progress line across the top of the screen (from option B).
  - The corner clock keeps showing elapsed workout time.
  - The bottom button stays "Log …" throughout.
  - Mockups: https://claude.ai/artifact/K8QiKXTJLkU8AnMshHVP9T
- [x] RPE: removed from everything the lifter sees (logging, routine editor, target lines). The data stays in the database and the API keeps accepting it, with no migration. Record it as a resolved question in DESIGN.md (2026-10-15).
- [x] Ending early: "End workout early" sits in a small menu at the top of the workout, next to Discard, and shows the unlogged planned sets before confirming (2026-10-15).
- [x] Light or dark as the default: light-first, following the phone's setting (2026-10-15).
- [x] Visual direction: Stone (2026-10-15).
- [x] Where Finish lives: the bottom button once every planned set is logged, plus an always-available "end early" (2026-10-15).

## Future enhancements

- **"Last time" on the exercise card** (e.g. "Last time 180 × 5"). Cut from Stage 3 on 2026-10-15.
  - The API has no previous-performance field. `GET /v1/progress/exercises/{id}` returns one point per finished workout (`topSetWeight`, `bestE1rm`, `totalVolume`, `maxReps`) but not the reps of the top set or the sets themselves, so building it client-side would take two requests per exercise.
  - If picked up: write a small API spec first. For example, the active workout's exercises could carry `lastPerformance` (the sets from the most recent finished workout of the same lineage root), following DESIGN §6's API-first rollout convention. Then add it to the card.

## Tools

- **Screenshots without Auth0:** a throwaway harness (Vite with a fake Auth0 module and Playwright serving fake API data) captured all 23 screens at 390px and 1280px. It lived in a session scratchpad and has to be rebuilt to use again. It might be worth committing it as a dev tool.
- **Impeccable commands per stage:** `layout` (1); `init`, `colorize`, `typeset` (2); `distill`, `layout` (3); `delight`, `clarify` (4); `onboard` (5); `polish` (final).
