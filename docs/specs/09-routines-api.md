# Spec 09 — Routines & Supersets (API)

**Status:** Implemented (2026-10-09, branch `feat/spec-09-routines-api`). Design approved by the owner in a brainstorm on 2026-10-08 (§12 D1–D17; O1–O4 resolved the same day as D18–D21).
**Last updated:** 2026-10-09
**Design refs:** DESIGN.md §4.3 (routines — rewritten by this spec: hard delete, name snapshot, limits), §4.4 (`workout` / `workout_exercise` — gain the routine and superset columns), §4.9 (deletion matrix — `routine` row), §2 item 3 and item 8 (routines, supersets Tier B), §6 (idempotency, `/v1` conventions, conditional GET), §10 Q5 (supersets — unchanged) and Q18 (this spec's log entry), M3 roadmap row.
Spec 05.0 (`workout` / `workout_exercise`, the idempotent start, D36 whose deferred columns this spec adds, D41 dense positions, D39 replay ignores the body), Spec 05.1 (set shapes — untouched), Spec 03.2 (`exercise-retired`, `is_active`), Spec 03.1 (the catalog's `strongEtag` / conditional-GET pattern), Spec 05.2 (write groups), Spec 07.1 (history row shape gains `routineName`), Spec 07.0 (the PR engine, which must stay indifferent to routines).

---

## 1. Purpose, scope & non-goals

A lifter builds a reusable, ordered list of exercises with targets **once** — "Push A: bench 4×6–8 @ RPE 8, 90 s rest …" — and then starts a gym session from it in one tap. **Supersets** (Tier B, DESIGN Q5) mark two or more exercises as performed together, in a routine and live in a session.

This spec ships the API only: five routine routes, the optional `routineId` on the existing start route, a `supersetGroup` field on the existing exercise-within-workout PATCH, the additive read fields, and migration `0009`. It closes **Spec 05.0 D36** (the deferred `routine_id` / `superset_group` columns). Spec 10 is the UI.

### In scope

- Migration `0009_create_routines`: tables `routine`, `routine_item`; columns `workout.routine_id`, `workout.routine_name_snapshot`, `workout_exercise.superset_group` + five target-snapshot columns. Additive / expand-only.
- `GET /v1/routines`, `GET /v1/routines/{id}` (strong `ETag`, `304`), `POST /v1/routines`, `PUT /v1/routines/{id}` (whole replace), `DELETE /v1/routines/{id}` (hard).
- `POST /v1/workouts` gains optional `routineId` (start from routine, same transaction, same idempotency).
- `PATCH /v1/workout-exercises/{id}` gains nullable `supersetGroup`.
- Additive reads: `routineName` on every `WorkoutSchema`-based shape (detail, active, history row, start/finish responses); six new fields on each workout exercise.
- `@sin/core`: `dto/routine.ts`, ids, a pure `routines.ts` (`normalizeSupersetGroups`, RPE tenths helpers).
- Errors `routine-name-taken`, `routine-limit`; the new `routines` rate-limit group.

### Non-goals

- **UI** (Spec 10): routine editor, "start from routine" on the Start screen, target placeholders on 06.1's entry row, bracketed superset display.
- **Rest timer** — M4. `rest_seconds` is stored and snapshotted now; nothing in the API counts time.
- **Sharing, a template library, routine folders, duplicate/clone-routine** (a client can `GET` then `POST`).
- **Item-level routine endpoints**, **archive/undelete**, **`If-Match` concurrency** (§12 D2, D4, D8 — each with its upgrade path).
- **Writing targets into sets.** Targets are placeholders the UI reads; no `set_entry` is ever pre-created from a routine (D3).
- **Re-pointing a past workout at a different routine**, or syncing a past workout to routine edits (the snapshot is the point, D1).
- **Superset-aware PR/volume maths.** Supersets are presentation and rest-timer grouping only.

---

## 2. Acceptance criteria

Every behavioral criterion gets ≥1 test naming its number (`describe("AC7 — …")`). Infra/pipeline criteria are verified by CI.

**Routine reads**

1. **Contract & auth.** `GET /v1/routines`, `GET /v1/routines/{id}`, `POST /v1/routines`, `PUT /v1/routines/{id}`, `DELETE /v1/routines/{id}` are published in `/openapi.json` (`config.published: true`, with `problems`), answer `401` with no/invalid token, and use the shapes in §5.
2. **List.** `GET /v1/routines` returns `{ routines: Routine[] }`: the caller's routines only, ordered by `lower(name)` then `id`, each with its `items` inlined ordered by `position`. No pagination parameters exist (cap 50, D6). A caller with none gets `{ routines: [] }`.
3. **Get one.** `GET /v1/routines/{id}` returns the routine; `404 not-found` for an absent id, a malformed id, and **another user's** routine (indistinguishable).
4. **Conditional GET.** Both reads send a strong `ETag` and `Cache-Control: private, no-cache` (`config.httpCache: "revalidate"`); a matching `If-None-Match` (weak or strong form) answers `304` with no body; any write that changes the response bytes changes the `ETag`; the list and a single routine never share a validator (namespace sentinel). Every write route and every error answers `no-store`.

**Routine writes**

5. **Create.** `POST /v1/routines` with a valid body answers `201` + `Location: /v1/routines/{id}` and the stored `Routine`. `position` is the array index (dense `0 … n-1`, never sent); item ids are server-generated.
6. **Name rules.** `name` is trimmed, 1–80 characters, no control characters. Names are unique **per user, case-insensitively**: a second routine named `push a` beside `Push A` → `409 routine-name-taken`; another user may use the same name; `PUT` that keeps the routine's own name is not a conflict; a race between two creates of the same name yields exactly one `201` (the unique index decides, never a `500`).
7. **Limits.** A user's 51st routine → `409 routine-limit`, including under concurrent creates (never more than 50 rows); deleting one frees a slot. More than 30 items → `422` on `items`. More than 8 members in one superset group → `422` (AC12). A routine must have **at least one item** (`[]` → `422` on `items`, D18) and may list the **same exercise more than once**.
8. **Item exercise validation.** Each `items[i].exerciseId` must be visible to the caller (global, or the caller's own custom): an absent id or another user's custom exercise → `422` on `items.<i>.exerciseId`; a visible exercise with `is_active = false` → `409 exercise-retired` whose problem body carries `errors[]` pointing at `items.<i>.exerciseId` (03.2's error, reused, first offending index). The routine is not created/changed.
9. **Target validation matrix.** `targetSets` int 1–20; `targetRepsLow` / `targetRepsHigh` int 1–100, **both present or both absent**, `low ≤ high` (equal allowed); `targetRpe` a number 6–10 in steps of 0.5; `restSeconds` int 0–900; `notes` 1–500 chars; routine `notes` 1–2000; every target `null` or omitted means "no target". Anything else → `422` on that item's field. Unknown keys → `422` (strict bodies).
10. **RPE tenths round-trip.** `targetRpe` travels as a decimal (`8.5`) and is stored as tenths `85`; `6`, `8.5`, `10` round-trip exactly; `5.5`, `8.3`, `10.5`, `8.25` → `422`. Reads never expose the tenths integer.
11. **Positions are the array order.** A body that sends `position` on an item → `422` (unknown key). The response echoes `position: 0 … n-1`.
12. **Superset groups on a routine.** A non-null `supersetGroup` is an int 1–99 as sent; each distinct value must have **2 to 8 members** (a group of one → `422` on that item's `supersetGroup`; a ninth member → `422` on the ninth). The server **renumbers groups 1, 2, 3 … by first appearance in item order** before storing, so `[7, null, 3, 7, 3]` is stored and returned as `[1, null, 2, 1, 2]`; clients never see gaps. Members need not be adjacent.
13. **Whole replace.** `PUT /v1/routines/{id}` with the full body replaces name, notes and the **entire ordered item list** in one transaction (delete items, reinsert) and answers `200` with the new `Routine`. `routine.id` and `created_at` are stable; `updated_at` advances; **item ids are not stable** across edits. A `PUT` that fails (any `422`/`409`) leaves the routine exactly as it was. `404` for an absent / foreign / malformed id; `409 routine-name-taken` if it collides with another of the caller's routines.
14. **Last write wins.** Two `PUT`s in either order both succeed and the later commit's document is what a `GET` returns; no `If-Match` is read or required (D8). A concurrent `PUT` and `PUT` never produce a mixed item list (the replace is atomic per routine).
15. **Delete.** `DELETE /v1/routines/{id}` → `204` and the routine and its items are gone; repeat → `404`; another user's → `404`. Workouts started from it keep `routine_name_snapshot`; their `routine_id` becomes `NULL` (FK `ON DELETE SET NULL`); `GET /v1/workouts/{id}` still reports the `routineName`.

**Start from a routine**

16. **Start copies the routine.** `POST /v1/workouts { clientGeneratedId, startedAt, routineId }` creates the workout and, in the same transaction, one `workout_exercise` per routine item in `position` order: `position`, `exercise_name_snapshot` / `modality_snapshot` taken from the exercise row **as 05.0 does**, the five targets and `superset_group` copied verbatim; `workout.routine_id` and `routine_name_snapshot` are set. No `set_entry` is created. `201` + `Location` as today.
17. **Start failures are atomic.** A `routineId` that matches no routine, or is **another user's** → `404 not-found`; an item whose exercise is now `is_active = false` → `409 exercise-retired` with `errors[]` on `routineId` naming the item position, never silently skipped. In both cases **no `workout` row exists afterwards** (the insert rolled back). A non-UUID `routineId` is `422` on `routineId`.
18. **Start is idempotent.** A replay with the same `clientGeneratedId` returns `200` and the stored workout whatever `routineId` the replay carries (05.0 D39), copies nothing twice, and does **not** re-validate or re-read the routine — so replaying a start whose routine was since deleted or whose exercise was since retired still answers `200`.
19. **One active workout still wins.** With an in-progress workout, a start with `routineId` and a different `clientGeneratedId` → `409 workout-in-progress-exists`, exactly as 05.0, and nothing is copied; two concurrent starts (with and without `routineId`) produce one `201` and one `409`, never two active workouts and never a half-copied one.
20. **No `routineId`, no change.** Every existing 05.0 / 05.1 / 06.x / 07.x / 08.x test passes with no edit except the shape assertions that AC24 amends.
21. **The workout is self-contained.** After a start, editing, replacing or deleting the routine changes nothing in the workout: its exercises, targets, groups and `routineName` read back identically. Repeating an exercise: a routine listing the same exercise twice starts a workout with two `workout_exercise` rows at distinct positions (05.0 AC10 / §6.6 already allow duplicates in a workout — this spec relies on it and changes nothing there, §6.5).
22. **The PR engine is indifferent.** For a routine-started fixture (including a repeated exercise), `records:rebuild` and the live finish path produce the same `personal_record` rows as the equivalent manually built workout; records key on lineage root across all sets of the workout (07.0).

**Live supersets and read shapes**

23. **`supersetGroup` on a workout exercise.** `PATCH /v1/workout-exercises/{id} { supersetGroup: n | null }` sets or clears the group; `n` is an int 1–99; **any** value is accepted (no density, no adjacency rule, a group of one is allowed); `position` and the other fields are unaffected; combining it with `position` / `notes` in one body works; `404` for an absent / foreign id; `409 workout-finished` on a finished workout; `422` on `0`, `100`, `2.5`, `"1"`; an empty body stays whatever 05.0 defines. Setting it never reorders rows (06.1's Move up/down stays valid mid-grouping).
24. **Additive read fields.** Every `WorkoutExercise` (inside `GET /v1/workouts/{id}`, `/active`, and in the add/patch responses) gains `targetSets`, `targetRepsLow`, `targetRepsHigh`, `targetRpe` (decimal), `restSeconds`, `supersetGroup` — all `null` for a manually added exercise; every `Workout`-based shape (detail, active, start, patch, history row) gains `routineName: string | null`. No field is removed or renamed, so Spec 08.0 / 08.1 screens keep working untouched.

**Cross-cutting**

25. **Rate limit group.** Every write route (`POST`/`PUT`/`DELETE` routines) declares `config.writeGroup: "routines"`; `RATE_LIMITS.groups.routines` is 30 per window (the one place limits live); the 31st write in a window → `429 rate-limited`; reads get L1 only; the new routes' bodies are within the existing body limit. `POST /v1/workouts` and `PATCH /v1/workout-exercises/{id}` keep `workouts`. App assembly fails for a routine write without `writeGroup`.
26. **Error contract & OpenAPI.** `routine-name-taken`, `routine-limit` are `AppError` subclasses registered like the rest on **both** the root and `/v1` scopes (problem+json, `type` `…/problems/<slug>`); each new route's `problems` list is emitted in `/openapi.json`; the OpenAPI drift check, `contract-pipeline` path set and `openapi-problem-matrix` rows are updated.
27. **Migration `0009`.** Additive only; applies cleanly over `0001–0008` with existing workouts untouched (new columns `NULL`); the DB itself rejects (raw SQL insert) a rep-range with one bound, `low > high`, an off-step or out-of-range RPE, a negative rest, a `superset_group` outside 1–99, a duplicate `(routine_id, position)` and a duplicate `(user_id, lower(name))`; `prisma migrate diff` shows no drift against `schema.prisma`.
28. **Authorization boundary.** User B can never read, replace, delete, list, or start from user A's routine (`404` / absent from the list), and cannot use A's custom exercise in an item (`422`).
29. **Account purge.** Deleting a user row (hard purge) cascades their routines and items in one statement without an FK-ordering failure, including when an item references that user's own custom exercise (§4, D13).
30. **Logging hygiene.** `routine_created` / `routine_updated` / `routine_deleted` / `workout_started_from_routine` lines carry ids and counts only — never `name`, `notes`, or item notes — and no token appears in any captured line.
31. **Docs consistent.** DESIGN.md §4.3, §4.4, §4.9, Q18 and the README row/paragraph match this spec (§11 list), and 05.0's D36 and §6.6 carry a one-line "closed / relied on by Spec 09" note.

---

## 3. Dependencies & exposed interface

### Needs

- **Spec 05.0:** `workout`, `workout_exercise`, the idempotent start (D38–D40), dense positions (D41), `NotFoundError`, `WorkoutFinishedError`, the `PATCH /workout-exercises` route.
- **Spec 05.1:** only that `set_entry` is untouched; workout detail shape (`exercises[].sets`).
- **Spec 03.2:** `ExerciseRetiredError`, `exerciseRepository.findVisibleById`, `exercise.is_active`.
- **Spec 03.1:** `strongEtag` / `ifNoneMatchHits` (`routes/http-cache.ts`) and the conditional-GET shape.
- **Spec 05.2:** `WriteGroup`, `RATE_LIMITS`, the app-assembly `writeGroup` check.
- **Spec 07.1:** `WorkoutSummary` extends `WorkoutSchema`, so `routineName` flows into history rows; `workout-history.prisma.ts` selects the new column.
- **Spec 07.0:** unchanged — AC22 is its regression guard.

### Provides — stable surface (Spec 10 consumes it; changes are breaking)

- The `Routine` / `RoutineItem` / `RoutineWrite` DTOs in `@sin/core` (§5) and the five routes.
- Routine semantics: array order = position; superset groups dense from 1 on a routine; item ids unstable across `PUT`; `routine_name_snapshot` survives deletion.
- `normalizeSupersetGroups` (pure, `@sin/core`) so the editor can preview the server's renumbering.
- The six workout-exercise fields and `routineName`; the `supersetGroup` PATCH semantics (any 1–99, may be a group of one).
- The error slugs `routine-name-taken`, `routine-limit`.
- Routine routes are **live** documents: the `ETag` is the supported way to avoid refetching; an `If-Match` precondition is the reserved upgrade (D8).

---

## 4. Data model

Migration `apps/api/prisma/migrations/0009_create_routines/migration.sql`, hand-authored like `0005` (CHECKs, the expression unique index and `ON DELETE SET NULL` carry the contract; `schema.prisma` models the client shape — `Routine`, `RoutineItem`, new `Workout` / `WorkoutExercise` fields, back-relations on `User` and `Exercise` — with the CI `prisma migrate diff` drift check as the guard). Additive / expand-only: no existing column is dropped, renamed or retyped, and no existing row is rewritten.

```sql
-- Spec 09 §4 — 0009_create_routines. Additive, expand-only.
-- Down = ALTER TABLE ... DROP COLUMN ...; DROP TABLE "routine_item", "routine";
-- (dev/test teardown only — production undo is `git revert` + a forward migration.)

CREATE TABLE "routine" (
    "id"          UUID           NOT NULL,
    "user_id"     UUID           NOT NULL,
    "name"        TEXT           NOT NULL,
    "notes"       TEXT,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "routine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "routine_name_check" CHECK (char_length("name") BETWEEN 1 AND 80 AND "name" = btrim("name")),
    CONSTRAINT "routine_notes_check" CHECK ("notes" IS NULL OR char_length("notes") BETWEEN 1 AND 2000),
    CONSTRAINT "routine_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Per-user case-insensitive name uniqueness (also the lookup index for "my routines").
CREATE UNIQUE INDEX "routine_user_name_key" ON "routine" ("user_id", lower("name"));

CREATE TABLE "routine_item" (
    "id"               UUID           NOT NULL,
    "routine_id"       UUID           NOT NULL,
    "position"         SMALLINT       NOT NULL,
    "exercise_id"      UUID           NOT NULL,
    "target_sets"      SMALLINT,
    "target_reps_low"  SMALLINT,
    "target_reps_high" SMALLINT,
    "target_rpe"       SMALLINT,          -- tenths: 60..100, multiples of 5 (D5)
    "rest_seconds"     SMALLINT,
    "superset_group"   SMALLINT,
    "notes"            TEXT,
    "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "routine_item_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "routine_item_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routine"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "routine_item_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "routine_item_position_check" CHECK ("position" >= 0),
    CONSTRAINT "routine_item_targets_check" CHECK (
        ("target_sets" IS NULL OR "target_sets" BETWEEN 1 AND 20)
        AND (("target_reps_low" IS NULL) = ("target_reps_high" IS NULL))
        AND ("target_reps_low" IS NULL OR ("target_reps_low" BETWEEN 1 AND 100
                                           AND "target_reps_high" BETWEEN 1 AND 100
                                           AND "target_reps_low" <= "target_reps_high"))
        AND ("target_rpe" IS NULL OR ("target_rpe" BETWEEN 60 AND 100 AND "target_rpe" % 5 = 0))
        AND ("rest_seconds" IS NULL OR "rest_seconds" BETWEEN 0 AND 900)
        AND ("superset_group" IS NULL OR "superset_group" BETWEEN 1 AND 99)),
    CONSTRAINT "routine_item_notes_check" CHECK ("notes" IS NULL OR char_length("notes") BETWEEN 1 AND 500)
);
-- Not deferrable: PUT deletes a routine's items before reinserting (§6.3), so no
-- transient duplicate exists. (05.0 D41 needed DEFERRABLE only for in-place shifts.)
CREATE UNIQUE INDEX "routine_item_routine_position_key" ON "routine_item" ("routine_id", "position");
CREATE INDEX "routine_item_exercise_idx" ON "routine_item" ("exercise_id");

ALTER TABLE "workout"
    ADD COLUMN "routine_id" UUID,
    ADD COLUMN "routine_name_snapshot" TEXT,
    ADD CONSTRAINT "workout_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "workout_routine_idx" ON "workout" ("routine_id") WHERE "routine_id" IS NOT NULL;

ALTER TABLE "workout_exercise"
    ADD COLUMN "superset_group"   SMALLINT,
    ADD COLUMN "target_sets"      SMALLINT,
    ADD COLUMN "target_reps_low"  SMALLINT,
    ADD COLUMN "target_reps_high" SMALLINT,
    ADD COLUMN "target_rpe"       SMALLINT,
    ADD COLUMN "rest_seconds"     SMALLINT,
    ADD CONSTRAINT "workout_exercise_targets_check" CHECK (
        ("target_sets" IS NULL OR "target_sets" BETWEEN 1 AND 20)
        AND (("target_reps_low" IS NULL) = ("target_reps_high" IS NULL))
        AND ("target_reps_low" IS NULL OR ("target_reps_low" BETWEEN 1 AND 100
                                           AND "target_reps_high" BETWEEN 1 AND 100
                                           AND "target_reps_low" <= "target_reps_high"))
        AND ("target_rpe" IS NULL OR ("target_rpe" BETWEEN 60 AND 100 AND "target_rpe" % 5 = 0))
        AND ("rest_seconds" IS NULL OR "rest_seconds" BETWEEN 0 AND 900)),
    ADD CONSTRAINT "workout_exercise_superset_group_check"
        CHECK ("superset_group" IS NULL OR "superset_group" BETWEEN 1 AND 99);
```

Notes:

- **`workout_routine_idx`** is a partial index so the `ON DELETE SET NULL` cascade (which must find a deleted routine's workouts) is index-served without a bloated all-NULL index; workouts are hot-path rows and most have no routine.
- **`routine_item.exercise_id` is `ON DELETE CASCADE`, not `RESTRICT`** (D13): the design deletes an exercise row only in an account purge, and a `RESTRICT` check fires *immediately* mid-cascade, so purging a user with a custom exercise used in their own routine would fail depending on delete order. `CASCADE` matches `workout_exercise.exercise_id` (05.0 D37, DESIGN §4.9: "no purge-ordering step is needed"). Custom exercises are soft-deleted (`is_active = false`) on user action, so this never silently drops routine items in normal use.
- **Name `CHECK`** (`name = btrim(name)`) is belt-and-braces for the handler's trim; `lower()` is the database default-collation lowercase, which for non-ASCII is as good as Postgres gives without ICU — acceptable for a per-user name list, documented in D6.
- **Target `CHECK`s are duplicated** on `routine_item` and `workout_exercise` (the snapshot must satisfy the same rules for the verbatim copy to be safe); the copy is `INSERT … SELECT`, so a violation could only be a bug.
- **No backfill.** Existing workouts have `routine_id` / `routine_name_snapshot` / targets `NULL`.
- **Hard purge:** `routine` is covered by `user.id ON DELETE CASCADE`; `workout.routine_id` is `SET NULL` and the workout cascades from the same user in the same statement.
- **Updating `schema.prisma`** adds `Routine` / `RoutineItem` and the nullable fields; every repository write is raw SQL (as in 05.0), so the Prisma models are client shape only.

---

## 5. API surface

All routes are under `/v1`, require the bearer token, publish with `config: { published: true, problems: [...] }`, and answer problem+json. Zod request bodies are `z.strictObject`; responses are `z.object` allowlists (03.0). Paths in `errors[]` use the existing dotted form (`items.2.exerciseId`).

### `@sin/core` additions (`packages/core/src/dto/routine.ts`, `ids.ts`, `routines.ts`)

```ts
export const ROUTINE_NAME_MAX = 80;
export const ROUTINE_NOTES_MAX = 2000;
export const ROUTINE_ITEM_NOTES_MAX = 500;
export const ROUTINES_PER_USER_MAX = 50;
export const ROUTINE_ITEMS_MAX = 30;
export const SUPERSET_GROUP_MEMBERS_MAX = 8;
export const SUPERSET_GROUP_VALUE_MAX = 99;

// ids.ts: RoutineIdSchema / RoutineItemIdSchema (branded, same idiom as WorkoutIdSchema)

// ---- shared target fields (request shape; every one nullable + optional) ----
const TargetFields = {
  targetSets: z.number().int().min(1).max(20).nullable().optional(),
  targetRepsLow: z.number().int().min(1).max(100).nullable().optional(),
  targetRepsHigh: z.number().int().min(1).max(100).nullable().optional(),
  targetRpe: z.number().min(6).max(10).multipleOf(0.5).nullable().optional(),
  restSeconds: z.number().int().min(0).max(900).nullable().optional(),
  supersetGroup: z.number().int().min(1).max(99).nullable().optional(),
};

/** One item in a POST/PUT body. Position is the array index; never sent. */
export const RoutineItemInputSchema = z.strictObject({
  exerciseId: ExerciseIdSchema,
  ...TargetFields,
  notes: z.string().min(1).max(500).refine(noControlCharsExceptWhitespace).nullable().optional(),
});

/** POST /v1/routines and PUT /v1/routines/{id} body (identical: whole document). */
export const RoutineWriteSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80).refine(noControlChars),
    notes: z.string().min(1).max(2000).refine(noControlCharsExceptWhitespace).nullable().optional(),
    items: z.array(RoutineItemInputSchema).min(1).max(30),
  })
  .superRefine(/* cross-item rules, §6.2: reps both-or-neither + low<=high per item,
                   superset group sizes 2..8 — issues carry path ["items", i, field] */);

// ---- responses ----
export const RoutineItemSchema = z.object({
  id: RoutineItemIdSchema,
  position: z.number().int().min(0),
  exerciseId: ExerciseIdSchema,
  targetSets: z.number().int().nullable(),
  targetRepsLow: z.number().int().nullable(),
  targetRepsHigh: z.number().int().nullable(),
  targetRpe: z.number().nullable(),      // 8.5 — plain number in a response (cf. SetEntry.rpe)
  restSeconds: z.number().int().nullable(),
  supersetGroup: z.number().int().nullable(),   // dense 1,2,3… on a routine
  notes: z.string().nullable(),
});
export const RoutineSchema = z.object({
  id: RoutineIdSchema,
  name: z.string(),
  notes: z.string().nullable(),
  items: z.array(RoutineItemSchema),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export const RoutineListResponseSchema = z.object({ routines: z.array(RoutineSchema) });
```

`routines.ts` (pure, no I/O): `normalizeSupersetGroups(groups: (number|null)[]): (number|null)[]` (renumber by first appearance), `rpeToTenths(x: number): number` / `tenthsToRpe(n: number): number` (`Math.round(x * 10)` / `n / 10`; the only conversion site).

Changes to existing DTOs (`dto/workout.ts`):

```ts
export const WorkoutSchema = z.object({ …existing…, routineName: z.string().nullable() });
export const WorkoutExerciseSchema = z.object({ …existing…,
  targetSets: z.number().int().nullable(),
  targetRepsLow: z.number().int().nullable(),
  targetRepsHigh: z.number().int().nullable(),
  targetRpe: z.number().nullable(),
  restSeconds: z.number().int().nullable(),
  supersetGroup: z.number().int().nullable(),
});
export const CreateWorkoutSchema = z.strictObject({ …existing…, routineId: RoutineIdSchema.optional() });
export const UpdateWorkoutExerciseSchema = z.strictObject({ …existing…,
  supersetGroup: z.number().int().min(1).max(99).nullable().optional() });
```

`WorkoutSummarySchema` and `WorkoutDetailSchema` extend these, so they inherit the fields. (`routineId` is deliberately **not** exposed on `Workout`: the lifter-facing fact is the name; the id nulls on delete and has no consumer — D20.)

### Routes

| Route | Success | Errors (`problems`) | Notes |
|---|---|---|---|
| `GET /v1/routines` | `200 RoutineListResponse`; `ETag`; `304` | — | `httpCache: "revalidate"`; L1 only. |
| `GET /v1/routines/{id}` | `200 Routine`; `ETag`; `304` | `404 not-found` | `httpCache: "revalidate"`. |
| `POST /v1/routines` | `201 Routine` + `Location: /v1/routines/{id}` | `409 routine-name-taken`, `409 routine-limit`, `409 exercise-retired`, `422 validation-error` | `writeGroup: "routines"`. |
| `PUT /v1/routines/{id}` | `200 Routine` | `404 not-found`, `409 routine-name-taken`, `409 exercise-retired`, `422 validation-error` | `writeGroup: "routines"`. Whole replace. |
| `DELETE /v1/routines/{id}` | `204` | `404 not-found` | `writeGroup: "routines"`. |
| `POST /v1/workouts` | `201` / replay `200` `Workout` (unchanged) | + `404 not-found`, `409 exercise-retired` | `writeGroup: "workouts"` (unchanged). |
| `PATCH /v1/workout-exercises/{id}` | `200 WorkoutExercise` (now with `supersetGroup`) | unchanged | `writeGroup: "workouts"` (unchanged). |

Example `PUT` body and response (the `7,3,7,3` input renumbers to `1,2,1,2`):

```json
{ "name": "Push A", "notes": null,
  "items": [
    { "exerciseId": "…bench…", "targetSets": 4, "targetRepsLow": 6, "targetRepsHigh": 8, "targetRpe": 8.5, "restSeconds": 120, "supersetGroup": 7 },
    { "exerciseId": "…row…",   "targetSets": 4, "targetRepsLow": 8, "targetRepsHigh": 10, "supersetGroup": 7 },
    { "exerciseId": "…dips…",  "targetSets": 3, "supersetGroup": 3 },
    { "exerciseId": "…curl…",  "targetSets": 3, "supersetGroup": 3 } ] }
```

**Error table**

| Condition | Status | Slug | Where |
|---|---|---|---|
| Missing/invalid token | 401 | `unauthenticated` / `invalid-token` | auth plugin |
| Bad shape, range, unknown key, reps pair, group size, item count | 422 | `validation-error` | `errors[]` on `items.<i>.<field>` / `name` / `routineId` |
| `items.<i>.exerciseId` absent or not visible | 422 | `validation-error` | `items.<i>.exerciseId` |
| Item exercise retired (write) | 409 | `exercise-retired` | `errors[]`: `items.<i>.exerciseId` |
| Item exercise retired (start) | 409 | `exercise-retired` | `errors[]`: `routineId` |
| Name already used by the caller (case-insensitive) | 409 | `routine-name-taken` | |
| 51st routine | 409 | `routine-limit` | |
| Routine absent / foreign / malformed id | 404 | `not-found` | write and read routes, and `POST /workouts` |
| Exercise's workout finished | 409 | `workout-finished` | `PATCH /workout-exercises` |
| In-progress workout exists | 409 | `workout-in-progress-exists` | `POST /workouts` (unchanged) |
| Write group exceeded | 429 | `rate-limited` | 05.2 |

`ExerciseRetiredError` gains an optional `fieldErrors` constructor option (the base class and `toProblem` already render `errors[]` for any `AppError`); its generic `publicDetail` is unchanged.

---

## 6. Behavior & logic

### 6.1 The repository

A new `RoutineRepository` (`repositories/routine.ts` interface, `routine.prisma.ts`, an in-memory fake for route unit tests) with `list`, `getById`, `create`, `replace`, `delete`. `WorkoutRepository.createWorkout` gains `routineId?`. Raw SQL throughout (the 05.0 idiom). Cross-item validation that needs no database lives in the Zod `superRefine`; validation that does (visibility, retired) lives in the repository inside the write transaction.

### 6.2 Validation order (POST/PUT)

1. Zod: shape, ranges, strict keys, `1 ≤ items.length ≤ 30` (`422`).
2. Zod `superRefine`, per item: reps both-or-neither and `low ≤ high`; then across items: every distinct `supersetGroup` has 2 to 8 members. All issues are collected (so an editor can show every problem), each at `items.<i>.<field>`; a group of one is reported on its only member, an over-size group on the first member past the eighth.
3. Repository transaction: resolve all `items[*].exerciseId` in **one** query (`WHERE id = ANY($1) AND (owner_user_id IS NULL OR owner_user_id = $user)`); any id missing → `422` for the first missing index; any `is_active = false` → `409 exercise-retired` for the first retired index. Missing is reported before retired. (A single query, not a per-item `findVisibleById`, keeps a 30-item write to a constant number of statements; the visibility predicate is the one `findVisibleById` uses — the test asserts equivalence.)
4. Normalise groups (`normalizeSupersetGroups`), convert `targetRpe` to tenths, write.

Validating shape **before** touching the database means a rejected body never takes a lock.

### 6.3 Create, replace, delete

**Create** (one transaction): `pg_advisory_xact_lock(hashtext('routine:' || user_id))` first (the 03.2 cap idiom — without it two concurrent creates both read 49 and both insert); count the caller's routines, `≥ 50` → `409 routine-limit`; `INSERT routine`; a `23505` on `routine_user_name_key` → `409 routine-name-taken` (parsed from the driver message exactly as 05.0 does for `workout_user_active_key`; any other constraint name is a bug → `500`); validate exercises (6.2 step 3); bulk `INSERT routine_item … FROM unnest(…)` with `position` = array index. Name collision is decided by the index, never by a read-then-write, so concurrent same-name creates produce one `201` and one `409`.

**Replace** (one transaction): `SELECT … FROM routine WHERE id = $1 AND user_id = $2 FOR UPDATE` (serialises concurrent `PUT`s on one routine and gives the `404`); validate exercises; `UPDATE routine SET name, notes, updated_at = now()` (`23505` → `409 routine-name-taken`); `DELETE FROM routine_item WHERE routine_id = $1`; bulk reinsert with **new item ids**. `created_at` is unchanged. Last commit wins; there is no precondition (D8).

**Delete**: `DELETE FROM routine WHERE id = $1 AND user_id = $2 RETURNING id` — zero rows is `404`. The FK cascades items and nulls `workout.routine_id`. Workouts keep `routine_name_snapshot` (taken at start, never updated, so a later *rename* also does not retitle history — consistent with `exercise_name_snapshot`).

### 6.4 Reads and the ETag

`list` is one query joining items, ordered `lower(name), id` then `position`, assembled in memory. `ETag = strongEtag("routines", <wire JSON>)` for the list and `strongEtag("routine:" + id, <wire JSON>)` for one (the sentinel keeps validators from colliding across the two routes — the 03.1 rule). The hash is over the serialized response, so any visible change (including the id churn of a `PUT`) changes it; `updated_at` is deliberately not the validator. `304` is sent exactly as `routes/exercises.ts` does. The handler never sets `Cache-Control`; the `/v1` policy applies `private, no-cache` from `config.httpCache: "revalidate"` and `no-store` everywhere else.

### 6.5 Start from a routine (extends 05.0 §6.2)

With no `routineId` the code path is **byte-for-byte today's** (AC20). With one, the repository runs the existing three-outcome insert inside a `prisma.$transaction` and extends only the `inserted` outcome:

1. `INSERT workout … ON CONFLICT (user_id, client_generated_id) DO NOTHING RETURNING …` — routine columns still `NULL`.
   - `23505` on `workout_user_active_key` → the one-active check fired. The transaction aborts (Postgres poisons it); the error propagates out of the `$transaction` callback, the transaction rolls back, and the **outer** code re-reads by `clientGeneratedId` (found → replay `200`; not found → `409 workout-in-progress-exists`) exactly as 05.0 §6.2/D40 specifies. The retry-once rule for the delete race is unchanged.
   - No row (idempotency key exists) → replay: return the stored row, **do nothing else** — no routine lookup (AC18).
2. Inserted: `SELECT id, name FROM routine WHERE id = $routineId AND user_id = $user FOR SHARE` (also stops a concurrent routine `DELETE`/`PUT` from tearing the copy; it blocks until this transaction ends). No row → `404 not-found` (rollback removes the workout).
3. Load the routine's items joined to `exercise` (`position`, `exercise_id`, `name`, `modality`, `is_active`, targets, `superset_group`) ordered by `position`. Any `is_active = false` → `409 exercise-retired`, `errors[{ path: "routineId", message: "item at position N refers to a retired exercise" }]`, first offender; rollback.
4. `INSERT INTO workout_exercise … SELECT` the items (new uuidv7 ids generated in the statement from `unnest`ed ids, positions copied — already dense), snapshots from the joined exercise row, the five targets and `superset_group` verbatim.
5. `UPDATE workout SET routine_id = $routineId, routine_name_snapshot = $name` and return the row.

The ordering matches the brief: the one-active check (step 1) decides before any routine work, so a user with an active workout gets `409 workout-in-progress-exists` regardless of the routine, and two concurrent starts cannot both reach step 2. Every routine has at least one item (D18), so a routine-started workout always has at least one exercise.

The response is the existing `Workout` (now with `routineName`), **not** the detail shape (D19): `POST /workouts` returns `WorkoutSchema` today and changing a response's shape by its input would be an API smell — the client reads `GET /v1/workouts/{id}`, as 06.1 already does after start.

### 6.6 Duplicate exercises: nothing to amend in 05.0

The design brief assumed 05.0 forbids the same exercise twice in a workout and asked this spec to lift that rule. **It does not forbid it**: 05.0 AC10 ("Adding the same `exerciseId` twice to one workout is allowed and creates a second row"), §6.6 (the same sentence with its rationale), and the test `workout-add-exercise.integration.test.ts` ("adding the same exerciseId twice creates a second row at a distinct position") already assert the opposite; the DB unique is `(workout_id, position)` only. So this spec lifts nothing and amends no criterion or test; AC21 and AC22 rely on and extend it (a routine-started workout may repeat an exercise; the PR engine, keyed on lineage root across all the workout's sets, is indifferent). 05.0 gets a one-line note (§11).

### 6.7 `PATCH /v1/workout-exercises/{id}` with `supersetGroup`

The existing handler runs under the 05.0 position transaction (advisory lock, `FOR SHARE` on the workout's `ended_at`); `supersetGroup` is an `UPDATE workout_exercise SET superset_group = $n` in that same transaction when present (key present with `null` clears). It does not touch positions, so it never takes a reorder shift. A key-present-only-`supersetGroup` body does not require `position`. No server-side density, adjacency or group-size rule on a workout (D10): the UI creates a group with one tap (a group of one) and completes it with the second, and Move up/down (06.1 D16) may transiently separate members. Display of a group of one is Spec 10's.

### 6.8 Edge cases

- Whitespace-only `name` → trims to empty → `422 name`.
- `items` of `[]` on `POST` or `PUT` → `422` on `items` (D18); a routine is never empty. To "clear" a routine the client deletes it.
- A `PUT` with an unchanged body still rewrites item ids and advances `updated_at`; the response (hence the `ETag`) changes only by those ids.
- `restSeconds: 0` is a valid target ("no rest"), distinct from `null` ("no target").
- Targets are never coerced from `0`/empty strings; a `null` target is "none".
- `routineId` for a routine another request deletes mid-start: the `FOR SHARE` makes the start win or lose cleanly — start wins (the delete waits, workout keeps the snapshot, `routine_id` then nulls when the delete runs) or `404`.

---

## 7. Security & privacy

- **Authorization boundary.** Every routine query is `WHERE user_id = $acting` (reads, replace, delete, the start's lookup). A foreign id is `404`, never `403` (no existence oracle, the 05.0 rule). Item `exerciseId`s resolve through the same visibility predicate as `findVisibleById`, so a user cannot reference another user's custom exercise (and thereby learn it exists: `422` is identical for absent and foreign).
- **Mass-assignment.** Strict bodies; ids, `position`, `created_at` are never accepted.
- **Abuse bounds.** ≤50 routines × ≤30 items, bodies small (30 items ≈ a few KB, under the global body limit), notes length-capped, control characters rejected, group sizes capped; `routines` write group at 30/min plus the in-flight cap. No unbounded list, so no paging attack surface.
- **PII.** Routine names/notes are user prose; they are never logged (§9), and they persist in `workout.routine_name_snapshot` until the workout/user is purged. `ON DELETE CASCADE` from `user` removes routines and items in the account purge (Spec 11 needs no extra step); the snapshot dies with its workout.
- **Cache.** The per-user ETag'd reads are `private, no-cache` (never a shared cache); error responses `no-store`.
- **No new secret, no new egress.**

---

## 8. Config & secrets

None. The limits are code constants in `@sin/core` (`ROUTINES_PER_USER_MAX` etc.) so API and a future editor share them; the rate limit lives in `RATE_LIMITS.groups.routines` (`apps/api/src/plugins/rate-limit.ts` — `WriteGroup` and `WRITE_GROUPS` gain `"routines"`, value 30, between `exercises` 20 and `workouts` 60). No env vars.

---

## 9. Observability

Structured log lines (ids and counts only; the test for AC30 captures them):

- `routine_created { routine_id, user_id, item_count }`, `routine_updated { routine_id, user_id, item_count }`, `routine_deleted { routine_id, user_id }`.
- `workout_started_from_routine { workout_id, routine_id, user_id, item_count }` beside the existing `workout_started`.
- `routine_limit_hit { user_id }` at `info` when `409 routine-limit` fires (a product signal, not an alert).

Never `name`, `notes` or item notes; `client_ip` is already on every request line (05.2). No new metrics or traces — that stack is Spec 13's; route latency comes from the existing request log.

---

## 10. Testing

Test-first per criterion, Vitest. Order of attack: core `routines.ts` + schemas (AC9–12) → migration + `prisma migrate diff` (AC27) → repository integration (AC5–8, 13–19, 21, 22, 28–29) → route unit/OpenAPI/rate-limit wiring (AC1–4, 20, 23–26, 30) → the shape updates in existing suites (AC24).

| Criterion | Verified by |
|---|---|
| AC1 | Route unit (`inject` + fakes): shapes, `401` no/invalid token; OpenAPI emit assertion: five paths published with `problems`; `contract-pipeline.test.ts` path set updated |
| AC2 | Integration: two users, mixed-case names (`apple`, `Banana`, `cherry` order), caller-only, items by position; empty list |
| AC3 | Integration + route unit: own `200`; absent, non-UUID, foreign → `404` with identical problem bodies |
| AC4 | Route unit: `etag` present, `cache-control: private, no-cache`; `If-None-Match` strong + `W/` + `*` → `304` empty; changed body → new ETag; list vs single validators differ; write responses and a `404`/`422` are `no-store` |
| AC5 | Integration: `201`, `Location`, dense positions from a shuffled-ids body, items by position on re-read |
| AC6 | Core unit on `name` (trim, 0/1/80/81, control chars); integration: case variant → `409`; second user same name `201`; `PUT` same name `200`; **16 concurrent creates of one name → 1×`201`, 15×`409`** |
| AC7 | Integration: 50 routines then 51st → `409 routine-limit`; 20 concurrent creates from 45 → total exactly 50; delete frees a slot; 31 items → `422 items`; 30 ok; `[]` → `422 items`; same exercise ×2 ok |
| AC8 | Integration: absent id, another user's custom id → `422 items.<i>.exerciseId`; retired → `409` with `errors[0].path = items.<i>.exerciseId`; first-index rule; nothing persisted |
| AC9 | Core unit: table-driven matrix over every field's boundaries (0/1/20/21; 1/100/101; low>high, low==high, one-sided; rest −1/0/900/901; notes 0/1/500/501) and unknown key |
| AC10 | Core unit: `rpeToTenths`/`tenthsToRpe` round-trip over every half step 6…10; `5.5`, `8.3`, `10.5`, `8.25` rejected; integration: stored value is `85` (raw `SELECT`), read is `8.5` |
| AC11 | Route unit: `position` key → `422`; integration echo `0…n-1` |
| AC12 | Core unit on `normalizeSupersetGroups` (`[7,null,3,7,3]`→`[1,null,2,1,2]`, already-dense unchanged, all-null, non-adjacent); schema unit: group of one, 8 ok, 9 → `422` at the right index; integration: stored rows hold the normalised values |
| AC13 | Integration: replace 5 items with 3 reordered + one new; `id`/`created_at` stable, `updated_at` advanced, item ids all new, positions dense; a failing `PUT` (retired item) leaves the old document byte-identical; foreign → `404`; clash with another routine's name → `409` |
| AC14 | Integration: two `PUT`s raced via `Promise.all` with distinct item lists → the result equals exactly one of them (no mix), no `500`; sequential order → later wins; a request with `If-Match` is accepted and ignored |
| AC15 | Integration: start a workout, delete the routine → `204`, `workout.routine_id IS NULL`, `routine_name_snapshot` kept, `GET /workouts/{id}` `routineName`; repeat → `404`; foreign → `404`; items gone |
| AC16 | Integration: routine with 4 items (targets, a group, a repeated exercise, a custom exercise) → workout rows equal expected field-by-field incl. snapshots from the exercise rows; no `set_entry` rows; `201` + `Location` |
| AC17 | Integration: unknown/foreign routine → `404`; retire an item's exercise → `409` with `errors[0].path = routineId`; `SELECT count(*) FROM workout` unchanged after each; non-UUID → `422` |
| AC18 | Integration: replay with the same key and (a) the same routine, (b) a different routine, (c) none, (d) after the routine was deleted, (e) after an exercise was retired → `200`, one workout, one set of exercise rows |
| AC19 | Integration: active workout + start with routine → `409`, no exercise rows from the attempt; `Promise.all` of two starts → exactly one `201`, one `409`, one active workout; `FOR SHARE` vs concurrent routine `DELETE` → either outcome is internally consistent |
| AC20 | CI-pipeline / existing suites: `routes-workouts*.test.ts`, 05.0/05.1/07.x integration suites pass; diff review shows only the AC24 shape assertions touched |
| AC21 | Integration: edit/replace/delete the routine after a start → workout detail identical to the pre-edit read; duplicate-exercise routine → two rows at distinct positions |
| AC22 | Integration: routine-started fixture with a repeated lifted exercise; finish → `personal_record` rows; run `records:rebuild` → identical set; equals the manually built twin |
| AC23 | Integration: set, clear, set `0`/`100`/`2.5` (`422`), group of one ok, non-adjacent ok, `position` unaffected, combined body, finished workout → `409 workout-finished`, foreign → `404`; route unit for the schema |
| AC24 | Core unit (schemas), route unit (fakes), `openapi-workouts*.test.ts` updated, 08.0/08.1 web suites green with no edit; integration: a manual add yields all-`null` fields and `routineName: null` |
| AC25 | Unit (`rate-limit` suites): `RATE_LIMITS.groups.routines === 30`, `WRITE_GROUPS` includes it; 31st write → `429`; a route-assembly test registering a routine write without `writeGroup` throws; `GENEROUS_LIMITS` / `limitsWith` updated for the new group |
| AC26 | `openapi-problem-matrix.test.ts` + `openapi-problem-responses.test.ts` rows; unit that both scopes render `routine-name-taken` / `routine-limit` as problem+json; CI drift check |
| AC27 | Integration (Testcontainers over `migrate deploy`): raw-SQL violations for each CHECK/unique listed; existing-row sanity; CI `prisma migrate diff` drift step |
| AC28 | Integration: user B against A's routine on all five routes + start → `404`/absent; A's custom exercise in B's item → `422` |
| AC29 | Integration: user with a custom exercise used in own routine and a routine-started workout → `DELETE FROM "user"` succeeds, no routine/item/workout rows remain |
| AC30 | Unit, log-capture pattern (07.0 AC24): create/replace/delete/start with distinctive name/notes strings; none appears in any captured line; no token |
| AC31 | Review of the DESIGN.md / README / 05.0 diff against §11's list |

**Coverage.** `routine.prisma.ts`, the start-from-routine branch of `workout.prisma.ts`, and `@sin/core` `routines.ts` near 100% line coverage (a wrong target or group on the entry row is a visible wrong number); the existing `plugins/auth` / `repositories/user` ≥90% gates untouched.

**Fixtures.** A `routineFixture()` builder (items from catalog seed exercises) shared by integration tests and, later, Spec 10 / 16 scenarios.

**CI.** No new job; integration joins `RUN_INTEGRATION`; the OpenAPI drift step already exists.

---

## 11. Deployment & rollback

`0009` is additive and expand-only: two new tables and nullable columns on `workout` / `workout_exercise`. The `ALTER TABLE` statements take brief `ACCESS EXCLUSIVE` locks on two hot tables (metadata-only adds, no rewrite) — sub-second on the staging data volume.

**Release ordering** (extends 07.0 §11):

1. `DATABASE_URL='<neon direct url>' pnpm run db:migrate:deploy` applies `0009` **before** the code goes live (manual step, never on boot). Required ordering, not optional: the new `workout` reads select `routine_name_snapshot`, so code live ahead of the column would `500` every workout read. Old code ignores the new nullable columns, so the migration can safely precede the code.
2. Merge to `main` → Render auto-deploys; routes appear in `/openapi.json`; CI drift check guards it.
3. **No seed, no rebuild, no backfill, no runbook step beyond (1).**
4. Verify with `db:migrate:status` on Neon (the 2026-10-04 staging-migrations incident: do not assume).

**No feature flag** — "off" is the absence of a UI consumer until Spec 10; the read fields are additive.

**Rollback:** revert the code commit. The tables/columns stay, inert; production undo is a forward migration, never a down script. After a revert, routines created in the interim are unreachable but harmless; the `routine_id` FK is `SET NULL`, so nothing blocks later deletion.

### DESIGN.md / doc edits

Applied with this spec (verified by AC31):

- **DESIGN §4.3** — `routine` loses `archived_at`; hard delete + `workout.routine_name_snapshot`; per-user name uniqueness; limits (50 / 30 / 8); a routine may repeat an exercise; whole-replace edit model with unstable item ids; `superset_group` normalised dense on a routine; cross-reference to Spec 09.
- **DESIGN §4.4** — `routine_id` and `routine_name_snapshot` on `workout`; `superset_group` and the five target snapshot columns on `workout_exercise` (the "omitted until Spec 09" sentences replaced); a line that a workout may repeat an exercise (05.0 AC10 — already so).
- **DESIGN §4.9** — `routine` row: hard delete (cascade) / hard purge.
- **DESIGN §10** — new **Q18 — Routines & supersets API** (✅, rationale D1–D5); header line/Status updated to Q1–Q18; Q5 unchanged.
- **DESIGN §6** — the representative-endpoints list gains the routine routes.
- **`docs/specs/README.md`** — row 09 → Drafted with link; dependency paragraph.
- **`docs/specs/05.0-workout-session-lifecycle.md`** — D36: "closed by Spec 09"; §6.6 gets "Spec 09 relies on this rule; unchanged".
- **Not edited here:** Q5, §4.5, the M3 milestone row (it does not name archive).

---

## 12. Decisions & open questions

- ✅ **D1 — targets are snapshotted onto `workout_exercise` (five nullable columns) (owner decision, 2026-10-08).** Rejected: **read live from the routine** — editing or deleting a routine would rewrite what a past workout appears to have planned, and the entry row's placeholders could vanish mid-session; **a JSON blob snapshot** — a second shape to validate with no per-column CHECKs and no join. **Rationale:** the workout is self-contained forever, exactly like `exercise_name_snapshot`; the routine is only a source at start time. Cost: six near-duplicate columns on a hot table, bounded and nullable.
- ✅ **D2 — edits are a whole-routine replace: `PUT /v1/routines/{id}` with the full ordered item list (owner decision).** Rejected: **item-level endpoints** (add/patch/move/delete item) — five more routes, five more rate-limit and 404 surfaces, and a reorder is a multi-request half-applied state; **both** — a surface nothing in Spec 10 needs. **Rationale:** routine planning is done in batches in an editor; one transaction validates positions, group sizes and the name together. Consequence: **item ids are not stable across edits** (documented in §3); nothing references an item id, because a started workout copies, not links.
- ✅ **D3 — start copies targets as placeholders; no `set_entry` is pre-created.** Targets stay nullable with no defaults. **Rationale:** a pre-filled set the lifter never typed would be a lie in the data (it would count in volume and PRs); a placeholder on the entry row is a UI affordance only.
- ✅ **D4 — hard delete only; `archived_at` is dropped (owner decision).** Rejected: **archive-only** — a list that never shrinks, plus un-archive UX, for a template with no history of its own; **both** — two ways to remove. **Rationale:** past workouts are self-contained (D1), so a deleted routine harms nothing; the one thing history needs from a routine is its *name*, hence `workout.routine_name_snapshot` and `routine_id ON DELETE SET NULL`. DESIGN §4.3 and §4.9 change.
- ✅ **D5 — `target_rpe` is stored as tenths in a `smallint` (60–100, multiples of 5) and travels as a decimal; half steps only.** **Rationale:** integer storage avoids numeric/float surprises and makes the CHECK trivial; the wire stays human (`8.5`); half-point RPE is how lifters actually rate effort, narrower than `set_entry.rpe`'s one decimal on purpose (a target of 8.3 is meaningless). The tenths integer never leaves the repository (`rpeToTenths` is the one conversion).
- ✅ **D6 — limits and names.** ≤50 routines per user (`409 routine-limit`), ≤30 items per routine, ≤8 members per superset group, names 1–80 trimmed and unique per user case-insensitively (unique index on `(user_id, lower(name))`; `409 routine-name-taken`); a routine MAY list the same exercise twice. **Rationale:** bounds make the unpaged list safe (one query, ≤~1,500 item rows) and the cap abuse-proof; the unique name stops the confusing "two Push As" list and the index, not a read-then-write, decides races. `lower()` is the DB's default folding — good enough for a per-user list. Rejected: a global name uniqueness (cross-user leak); no uniqueness (unusable picker).
- ✅ **D7 — the routine list is unpaged and fully inlined, with a strong `ETag`.** **Rationale:** the 50-routine cap bounds the response; Spec 10's picker and editor both need items, so a second call per routine would be pure latency; the `ETag`/`304` pattern is the catalog's, already supported client-side. Rejected: cursor paging (07.1's pattern is for unbounded lists; here it would be ceremony); summary-only list + detail fetch.
- ✅ **D8 — concurrency on `PUT` is last-write-wins, no `If-Match` (owner decision).** **Rationale:** a single-user private document, edited from one device at a time in practice; the replace transaction takes a row lock so a racing pair never interleaves. Upgrade path (reserved, additive): honour `If-Match` against the same `ETag` the `GET` already serves — mismatch `412`, absent-when-required `428` — behind a client opt-in, no schema change.
- ✅ **D9 — routine supersets are normalised dense (1, 2, 3 … by first appearance) and sized 2–8; members need not be adjacent.** **Rationale:** the editor can send any labels (it may hold group 7 after deleting 1–6); the server returns one canonical form so clients never see or maintain gaps, and a group of one in a *template* is always an error (nothing to be "with"). The cap of 8 is a circuit ceiling that keeps the bracket UI and the future rest timer sane. `normalizeSupersetGroups` lives in `@sin/core` so the editor previews the same renumbering.
- ✅ **D10 — live supersets use the existing `PATCH /v1/workout-exercises/{id}` with a nullable `supersetGroup` (owner decision).** Any int 1–99, `null` ungroups, **no adjacency-in-position rule**, a group of one allowed, no dense normalisation on workouts. Rejected: **a dedicated `PUT /v1/workouts/{id}/supersets`** (a second whole-document shape for a one-tap action, and an atomic-regroup guarantee nobody needs); **routines-only grouping** (the lifter who improvises a superset on the gym floor is the common case). **Rationale:** an adjacency rule would reject 06.1's Move up/down (D16) mid-reorder and force ordering of client calls; a group of one is the legitimate state between the first and second tap. The cost — the server cannot guarantee a well-formed group in a workout — is paid by the UI, which treats a group of one as ungrouped for display.
- ✅ **D11 — `routineId` is an optional field on `POST /v1/workouts`, not `POST /v1/routines/{id}/start` (owner decision; 05.0 D36 anticipated it).** **Rationale:** keeps `clientGeneratedId` idempotency, the one-active-workout `409` and 06.2's queue shape (one start request, one replay rule); a second start route would need all three re-specified. Consequence: replay ignores `routineId` along with the rest of the body (05.0 D39), so a replay never re-reads a possibly-deleted routine.
- ✅ **D12 — the copy runs in the start transaction after the one-active check, with the routine row `FOR SHARE`.** **Rationale:** the partial unique index already decides "is there an active workout", so ordering the copy after the insert needs no extra check and makes the race impossible; `FOR SHARE` stops a concurrent `PUT`/`DELETE` tearing the copy. A retired exercise fails the *whole* start (`409`), never drops the item — a silently shorter workout is worse than a refusal the lifter can fix by editing the routine.
- ✅ **D13 — `routine_item.exercise_id` is `ON DELETE CASCADE`, not the brief's `RESTRICT`.** **Rationale:** DESIGN §4.9 / 05.0 D37 promise "no purge-ordering step"; a `RESTRICT` FK is checked immediately, so purging a user whose custom exercise is used in their own routine would fail depending on cascade order. Exercises are only ever hard-deleted by the purge (user action is a soft delete), so the cascade never fires in normal use. Rejected: `RESTRICT`; `NO ACTION` (deferred check works but is a third idiom for no gain).
- ✅ **D14 — new `routines` write group at 30/min, between `exercises` 20 and `workouts` 60.** **Rationale:** a routine write is a multi-row replace (heavier than a workout PATCH) but a human saves a handful per session; 30 absorbs an editor's autosave-on-blur without letting a script churn item rows. Reads get L1 only. Start and live-superset PATCH keep `workouts` (they are workout writes).
- ✅ **D15 — shape decisions.** `routineName` goes on `WorkoutSchema` (so detail, active, start, patch and the history row all carry it with one field); the six target/group fields go on `WorkoutExerciseSchema` (so the add/patch responses are consistent with the detail); `routineId` is not exposed (D20); the list envelope is `{ routines }` not a bare array (room for a future field without a break); request/response keys are camelCase with decimals as numbers like `SetEntry.rpe`.
- ✅ **D16 — cross-item validation is a Zod `superRefine`, DB-dependent validation is in the repository.** **Rationale:** an editor wants every problem in one `422`, and shape errors must never take a lock or run a query; exercise visibility needs the database, so it runs in the write transaction in a single batched query.
- ✅ **D17 — no duplicate-exercise rule changes (brief conflict resolved).** See §6.6: 05.0 already allows repeats; nothing to lift, no 05.0 AC or test is amended.

- ✅ **D18 — a routine has at least one item (owner decision, 2026-10-08; was O2).** `items` is `min(1)`; `[]` on `POST`/`PUT` is `422`. Rejected: allowing an empty routine so an editor can save a name first. **Rationale:** a routine is a list of exercises — an empty one has nothing to start from, and letting it exist means every consumer (the Start screen, the picker, start-from-routine) must special-case it. Spec 10's editor requires one exercise before the first save.
- ✅ **D19 — `POST /v1/workouts` returns the plain `Workout` (+`routineName`) whether or not `routineId` is set (owner decision; was O1).** Rejected: returning `WorkoutDetail` only when `routineId` is present. **Rationale:** a response shape that depends on an input field is an API smell and would change 06.2's queued-start handling; 06.1 already fetches the active workout after start, so the exercises arrive on that read.
- ✅ **D20 — `routineId` is not exposed on `Workout`; only `routineName` is (owner decision; was O3).** Rejected: exposing the nullable id. **Rationale:** the lifter-facing fact is the name; the id nulls on delete, so any "start this again" affordance would have to handle `null` anyway and can instead match the live routine list by name. Adding the id later is additive.
- ✅ **D21 — a `RoutineItem` carries only `exerciseId`, never the exercise's name or modality (owner decision; was O4).** Rejected: inlining live `name` / `modality` on each item. **Rationale:** Spec 10 resolves ids through the cached catalog (06.0) exactly as the session screen does, and the catalog's `isActive` is where a retired exercise is flagged in the editor. A hard-purged custom exercise cannot occur (D13). Adding names later is additive.

### Open questions

None. O1–O4 were resolved by the owner on 2026-10-08 (D19, D18, D20, D21).
