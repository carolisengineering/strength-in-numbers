# Spec 11 — Account Lifecycle (API): data export, account delete, purge CLI

**Status:** Implemented (2026-10-13, branch feat/spec-11-account-lifecycle). Design approved by the owner section by section in a brainstorm on 2026-10-11 (`docs/superpowers/specs/2026-10-11-spec-11-design-brief.md`; §12 D1–D5 are the owner decisions, D6–D18 are the architect's choices where the brief left room). Implemented as specified; see the AC30 / AC32 wording amended at implementation time.
**Last updated:** 2026-10-13
**Design refs:** DESIGN.md §2 item 1 (account deletion + data export), §4.1 (`user.deleted_at`), §4.9 (deletion matrix and its closing paragraph — rewritten by this spec), §6 (`/account/export`, `/account` — rewritten), §8.2 (privacy: export and delete are product features), §3.1 / §3.2 / §3.3 (object storage, cron and the per-environment R2 bucket — deferred to GA by this spec), §9 M4 row, §10 Q19 (this spec's log entry).
Spec 01 (`resolveUser` → `403 account-deleted`, `UserRepository`, the `/v1` auth plugin), Spec 03.0 (Zod DTOs → OpenAPI, response-schema allowlist), Spec 05.0 / 05.1 / 09 / 03.2 (the read DTOs this export composes), Spec 05.2 (rate-limit mechanisms, write groups), Spec 07.0 (`lockUserRecords`, the `records:rebuild` CLI shape this spec copies), Spec 09 AC29 (a user purge cascades routines).

---

## 1. Purpose, scope & non-goals

M4's exit criterion is a closed beta with a handful of real users. A tester must be able to **download all of their data and delete their account without an ops ticket**. This spec is the API half of that (DESIGN §2 item 1, §8.2); Spec 12 is the UI. It is deliberately the **beta minimum**: a synchronous JSON export straight from the API, a soft delete that locks the account out at once, and a hand-run purge CLI. The full DESIGN version (async export to an R2 bucket, a scheduled purge job) returns at GA under its own spec number (D1).

### In scope

- `GET /v1/account/export` — one JSON document with everything the user owns (§5.1).
- `DELETE /v1/account` — soft delete: sets `user.deleted_at`, answers `202 { deletedAt, purgeEligibleAt }` (§5.2).
- `account:purge` — a CLI (`pnpm --filter @sin/api run account:purge`) that hard-deletes accounts soft-deleted more than 30 days ago; dry run by default (§6.4).
- `@sin/core` `dto/account.ts`: `AccountExportSchema`, `AccountDeletedResponseSchema`, `ACCOUNT_PURGE_GRACE_DAYS`.
- A per-user `export` rate-limit budget in `RATE_LIMITS` (D8) and `Content-Disposition` in the CORS `exposedHeaders` (D16).
- A behavior-preserving extraction of the Record→DTO mappers out of the route files so the export and the read routes share them (§6.2, D7).
- The DESIGN.md / README alignment (§11).

### Non-goals

- **UI** — the settings screen, the "Download your data first" step, the confirmation dialog, `logoutAndClear()` after the 202, and the account-deleted screen are Spec 12.
- **R2 / S3 client / async export job / signed URLs / a Render cron job** — deferred to GA (D1). No new dependency, no new service.
- **A restore endpoint or any self-service undo** during the grace window (D2). The owner rescues a mistaken delete with a hand-run `UPDATE` before the purge (runbook).
- **Touching Auth0** — no Management API, no M2M credentials (D3). The IdP identity survives the purge; a later login re-provisions a fresh, empty account.
- **CSV, zip, or any second export format** (D4). A Hevy-shaped import/export is a separate later spec built on Hevy's real format. The file is **not** an import format.
- **Export of `personal_record`** (a rebuildable cache) or **global catalog exercises** (each workout exercise already carries its name snapshot).
- **`body_metric`** — the table does not exist yet (no spec). The export will need a `bodyMetrics` collection when it lands; the purge needs nothing (AC23 enforces the cascade).
- **Re-authentication / step-up on delete**, a delete-confirmation token, email notices (D14).
- **A scheduled purge**, purge audit tables, or a deletion-request queue.

---

## 2. Acceptance criteria

Every behavioral criterion gets ≥1 test naming its number (`describe("AC7 — …")`). Infra/pipeline criteria are verified by CI.

**Export — `GET /v1/account/export`**

1. **Contract & auth.** `GET /v1/account/export` is published in `/openapi.json` (`config.published: true`, with `problems`), answers `401` with no/invalid token and `403 account-deleted` for a soft-deleted user, takes no body or parameters, and its `200` body parses with `AccountExportSchema`.
2. **Envelope & profile.** The body's keys are exactly `formatVersion`, `exportedAt`, `profile`, `exercises`, `routines`, `workouts`. `formatVersion` is the literal `1`. `exportedAt` is a UTC ISO-8601 timestamp taken from the database clock at the start of the snapshot. `profile` deep-equals the `GET /v1/me` body minus `isNewUser`.
3. **Collections.** `exercises` is every custom exercise the caller owns **including `is_active = false` rows and forks**, in the `ExerciseSchema` shape, ordered `created_at, id`. `routines` is every routine as a full `RoutineSchema` document (items inlined, ordered by `position`), ordered `lower(name), id` (the list route's order). `workouts` is **every** workout — finished **and** in-progress — as a full `WorkoutDetailSchema` document (`exercises` by `position`, `sets` by `setNumber`), **oldest first** (`started_at, id`). An account with no data returns `200` with empty arrays and a populated `profile`.
4. **Exclusions and the allowlist.** No `personal_record` rows and no global catalog exercise appear; no `authSub`, `emailVerified`, user `updatedAt`, `deletedAt`, or any DB column outside the reused DTOs appears anywhere in the document (checked by walking every object's keys against the DTO key sets).
5. **Isolation.** Another user's rows never appear, in any of the six keys: a two-user fixture where both own rows of every kind (including an identically named exercise and routine) yields, for each caller, only that caller's ids.
6. **Parity with the read routes.** For a fixture, each exported workout deep-equals `GET /v1/workouts/{id}`, each exported routine deep-equals `GET /v1/routines/{id}`, each exported exercise deep-equals its entry in `GET /v1/exercises` — so weights, units, RPE decimals (`8.5`, not tenths), timestamps and `routineName` have no second rule (D6).
7. **Consistent snapshot.** The export reads inside one `REPEATABLE READ`, read-only transaction. With a write injected **between** its first and last statements (a set added, a workout deleted, a routine replaced, all committed), the document still reflects the pre-write state in every collection and is internally consistent (every exported set's `workoutExerciseId` resolves to an exported exercise of the same workout; no workout is missing a set it had at the snapshot).
8. **No per-workout queries.** The export issues a fixed number of statements (≤ 8) regardless of data volume: the count for an account with 5 workouts equals the count for the same shape with 60.
9. **Headers.** The response carries `Content-Disposition: attachment; filename="strength-in-numbers-export-YYYY-MM-DD.json"` where the date is the UTC date of `exportedAt`; `Content-Type: application/json…`; `Cache-Control: no-store` (the `/v1` cache policy's default — the route declares no `httpCache` and sets no header by hand); and the CORS `exposedHeaders` list includes `Content-Disposition`, so a cross-origin SPA `fetch` can read the filename (D16).
10. **Per-user export budget.** `RATE_LIMITS.exportPerUser` is 3 per window (the one place the number is written). The 4th export by one user in a window → `429 rate-limited` problem+json with `Retry-After`; another user, the same user's other routes, and the write groups are unaffected; the L1 per-IP limit still applies; the limiter fails open like the others (05.2 AC10). The route does **not** declare `writeGroup` (it is a read route; app assembly rejects it).
11. **Export logging.** One `account_exported` info line per success carrying `user_id` and the counts `exercise_count`, `routine_count`, `workout_count`, `set_count` — never the body, an email, a name, or note text.
12. **Heavy-account tripwire.** A fixture of 400 workouts / ~8,000 sets / 50 routines / 500 custom exercises exports in one request in under 10 seconds on the CI runner, as a loose regression tripwire (not a benchmark). The test asserts the elapsed bound and the AC8 statement count.

**Delete — `DELETE /v1/account`**

13. **Contract, auth, group.** `DELETE /v1/account` is published (`config.published: true`, `problems`), answers `401` with no/invalid token, takes no body and no `If-Match`, and declares `config.writeGroup: "me"` (app assembly would fail without it).
14. **202 body.** A first delete answers `202` with `{ deletedAt, purgeEligibleAt }` (both UTC ISO-8601): `deletedAt` equals the `user.deleted_at` now stored, and `purgeEligibleAt` is `deletedAt + ACCOUNT_PURGE_GRACE_DAYS × 86,400 s` exactly. Parses with `AccountDeletedResponseSchema`.
15. **Effect is one column.** The only change is `user.deleted_at` for the caller's row: every other column of that row, and every row count and content of `workout`, `workout_exercise`, `set_entry`, `routine`, `routine_item`, `exercise`, `personal_record` for **every** user, is unchanged — including an in-progress workout, which is left as is. Other users are unaffected.
16. **Immediate lockout.** After the 202, the same token gets `403 account-deleted` on `GET /v1/me`, `GET /v1/workouts/active`, `GET /v1/account/export` and `DELETE /v1/account`; so does a second, different valid token for the same `sub` (another device). A different user's token is unaffected.
17. **Second and concurrent deletes.** A second `DELETE` answers `403 account-deleted` (not another `202`), and `deleted_at` is unchanged. Two concurrent first deletes (both past `resolveUser`) yield exactly one `202` and one `403 account-deleted` — never a `500`, never a changed `deleted_at`.
18. **Delete logging.** One `account_deleted` info line per success carrying only the internal `user_id`; no email, name, `sub`, token or other data. It is the only record of when the delete happened once the row is purged.
19. **Shares the `me` budget.** `DELETE /v1/account` counts toward the existing `me` write group (10 per window, shared with `PATCH /v1/me`), per user.

**Purge — `account:purge` CLI**

20. **One grace constant.** `ACCOUNT_PURGE_GRACE_DAYS = 30` is defined once in `@sin/core` and is the only source for both `purgeEligibleAt` (AC14) and the CLI's eligibility test; the CLI binds it as a query parameter in exact seconds. A source scan fails if `src/` contains a literal `30 days` / `interval '30` in SQL or a second definition of the constant.
21. **Dry run is the default.** With no `--confirm`, the CLI lists the eligible accounts (`deleted_at <= now() − grace`) with user id, `deletedAt`, workout count and set count; deletes nothing (row counts identical before and after); prints **no email or other PII**; exits `0`. Nothing eligible prints that and exits `0`.
22. **`--confirm` deletes, one transaction per account.** Each account runs in its own transaction whose **first** statement is `lockUserRecords` and whose delete is `DELETE FROM "user" WHERE id = $1 AND deleted_at IS NOT NULL AND deleted_at <= now() − make_interval(secs => $grace)` — the grace check lives **inside** the `DELETE`. A statement-recording wrapper asserts the lock precedes every other statement and the transaction timeout is raised above Prisma's 5 s default.
23. **Complete erase.** For a fixture user owning custom exercises (including a fork), routines (one item on their own custom exercise), finished and in-progress workouts, sets, and personal records: after `--confirm`, **every table reachable from `"user"` by foreign key has zero rows attributable to them**, with the table list **discovered from `pg_constraint`** (not hard-coded), the per-table attribution computed by a generated FK-path join. The test also fails if (a) a discovered table had zero victim rows before the purge (the fixture would pass vacuously), or (b) any FK edge in the discovered graph is `NO ACTION` / `RESTRICT` other than the allowlisted reference edges (`exercise → muscle_group`, `exercise → equipment`, `exercise.forked_from_exercise_id`) — so a future table without a cascade (e.g. `body_metric`) fails here.
24. **Bystanders untouched.** After purging one user, a second user's rows are identical in every discovered table (counts and a content hash), and the global catalog (`muscle_group`, `equipment`, global `exercise` rows) is unchanged.
25. **Grace boundary.** An account soft-deleted 30 days + 1 s ago is purged; one soft-deleted 30 days − 1 s ago is skipped (reported, not deleted); the comparison is exact in seconds. `deleted_at` values are set by direct `UPDATE` in the test.
26. **A live account is never purged.** For `deleted_at IS NULL`, **no** flag combination deletes the row: `--confirm`, `--confirm --user <id>`, `--confirm --user <id> --skip-grace` (parameterized test over every combination) all leave it intact; the targeted ones report a refusal and exit `1` (AC28).
27. **A restore after the dry run is respected.** Dry run lists account X; the test then clears X's `deleted_at`; `--confirm` skips X (reason `not-eligible`), its row and children intact. The same holds if the restore lands between the eligibility listing and the `DELETE` (the predicate is re-evaluated by the statement).
28. **Targeting and arguments.** `--user <id>` (or `--user=<id>`) limits the run to one account. `--skip-grace` is accepted **only** with `--user` and purges that soft-deleted account immediately (an in-grace account under `--user <id> --skip-grace --confirm` is deleted; without `--skip-grace` it is skipped). With `--user`, a target that is not purged for any reason (live, unknown, in grace) is reported and the run exits `1`; untargeted runs that skip accounts exit `0`. Any unrecognized or repeated argument, a non-UUID `--user`, `--skip-grace` without `--user`, or a missing/rejected `DATABASE_URL` exits `1` **before any query** (the `parseRebuildArgs` idiom — a mistyped flag never widens a one-account run).
29. **Failure isolation and summary.** A failure on one account (fault injected into its transaction) rolls that account back, is logged, and the CLI **continues** with the remaining accounts, then prints `purged N, skipped M, failed K` and exits `1` if `K > 0`, else `0`.
30. **No deadlock with live writers.** `Promise.all` of the purge for user U and (a) a finish of U's in-progress workout, (b) a set create on U's workout, (c) a workout delete: every HTTP result is in the serial-order outcomes (`2xx`, or `404`/`403` after the purge), none is a `500`, no `40P01` or lock-timeout occurs, the purge completes, and no U row remains.
31. **Purge logging.** One `account_purged` info line per purged account (`user_id`, `workout_count`, `set_count`, `skip_grace`), one `account_purge_skipped` (`user_id`, `reason`) per skip, then the summary; no email, name or token in any line, and the dry-run listing prints the same fields.

**Cross-cutting**

32. **Error contract & OpenAPI.** No new problem slug: both routes' `problems` lists are `[]` beyond the central groups (`account-deleted`, `rate-limited`, …). The OpenAPI drift check, the `contract-pipeline` path set and `openapi-problem-matrix` rows (`GET /v1/account/export`: `withCentral("none")`; `DELETE /v1/account`: `withCentral("body")`, like every other `DELETE`) are updated; `/openapi.json` carries `AccountExport` and `AccountDeletedResponse`.
33. **Mapper extraction is behavior-preserving.** After the Record→DTO mappers move to a shared module (§6.2), every existing route, OpenAPI and integration test passes with no edit except import paths.
34. **Core DTOs & purity.** `dto/account.ts` composes the existing schemas exactly as §5.3 specifies, exports `ACCOUNT_PURGE_GRACE_DAYS`, and `pnpm run core:purity` passes (no Node/DOM/React imports).
35. **No migration.** The change set adds no file under `apps/api/prisma/migrations/` and no change to `schema.prisma`; the existing `prisma migrate diff` no-drift check stays green. (Verified by CI and the change audit.)
36. **Docs consistent.** DESIGN.md §3.1, §3.2, §3.3, §4.1, §4.9, §6, §8.2, §9, Q19 and the README row match this spec (done with this draft). With the implementation: `CLAUDE.md` gains the line and command in §11 and `docs/runbooks/first-deploy.md` gains the "Account deletion requests" section.

---

## 3. Dependencies & exposed interface

### Needs

- **Spec 01:** `resolveUser` (`apps/api/src/auth/provisioning.ts`) already throws `AccountDeletedError` (`403 account-deleted`) when `user.deleted_at` is set, and `plugins/auth.ts` runs it for every `/v1` route except `/v1/_authcheck`. `UserRepository` (all `user` access goes through it). `user.deleted_at` exists (`schema.prisma:25`) — **no migration**.
- **Spec 03.0:** `config: { published, problems }`, the response-schema allowlist, the OpenAPI drift and problem-matrix tests.
- **Specs 05.0 / 05.1 / 09 / 03.2 / 01:** `WorkoutDetailSchema`, `RoutineSchema`, `ExerciseSchema`, `MeSchema` and the repository row mappers behind them (§5.3, §6.2).
- **Spec 05.2:** `RATE_LIMITS`, the `ipBudget` hook pattern (extended with a per-user sibling, D8), the `me` write group, `enforce`.
- **Spec 07.0:** `lockUserRecords` (`repositories/personal-record.prisma.ts`) — every PR writer takes it first; the purge deletes `personal_record` rows. The `records:rebuild` CLI is the template.
- **Spec 09 AC29 / 05.0 D37:** the cascade graph (`exercise.owner_user_id`, `workout.user_id`, `routine.user_id`, `personal_record.user_id` are `ON DELETE CASCADE`; `workout.routine_id` is `SET NULL`).

### Provides — stable surface (Spec 12 consumes it; changes are breaking)

- `GET /v1/account/export` and the **document format** (`formatVersion: 1`, §5.3). Additive fields do not bump `formatVersion` (they ride on the read DTOs and follow DESIGN §6's response-field rollout convention); a removed/renamed field or changed semantics bumps it (D6).
- `DELETE /v1/account → 202 { deletedAt, purgeEligibleAt }`; **a second delete is `403 account-deleted`** and clients treat `account-deleted` as "done".
- `ACCOUNT_PURGE_GRACE_DAYS` (so the UI can say "30 days" without hard-coding it).
- The behavior contract: after the 202 every `/v1` call on every device is `403 account-deleted`; the data is gone only after a manual purge ≥ 30 days later; export is unavailable after delete, so **export first**.
- The `account:purge` operator command and its safety contract (dry run default; a live account can never be purged).

---

## 4. Data model

**No tables, columns, indexes or migration (AC35).** `user.deleted_at TIMESTAMPTZ(6) NULL` already exists (Spec 01). Two deliberate non-changes:

- **No index on `user.deleted_at`.** The only reader is the operator's purge listing (`WHERE deleted_at IS NOT NULL`), a scan of a table that is tiny during the beta; a partial index is a one-line forward migration when the user table is big enough to care (D18).
- **`updated_at` is not touched by the delete** (D9): `deleted_at` is the record of the event, and the brief's statement is a single-column update.

The purge relies on the existing FK graph. Verified against `schema.prisma` (2026-10-11):

| Table | FK to its parent | Rule |
|---|---|---|
| `exercise` | `owner_user_id → user` | CASCADE |
| `exercise` | `forked_from_exercise_id → exercise` | RESTRICT (always points at a **global** row, never at the purged user's own; forking never chains, 03.2 §6) |
| `workout` | `user_id → user` | CASCADE |
| `workout` | `routine_id → routine` | SET NULL |
| `workout_exercise` | `workout_id → workout`; `exercise_id → exercise` | CASCADE; CASCADE (05.0 D37) |
| `set_entry` | `workout_exercise_id → workout_exercise` | CASCADE |
| `routine` / `routine_item` | `user_id → user`; `routine_id → routine`; `exercise_id → exercise` | CASCADE ×3 (09 D13) |
| `personal_record` | `user_id → user`; `exercise_id → exercise`; `source_set_entry_id → set_entry`; `workout_id → workout` | CASCADE ×4 |

The brief's "every user-owned table cascades" is therefore true except for the two non-cascade edges above, both harmless to a purge (a `SET NULL` on a row that is deleted in the same statement; a `RESTRICT` pointing at an undeleted global row). AC23 pins this graph so a future table cannot silently break it.

---

## 5. API surface

Both routes are under `/v1`, require the bearer token, publish with `config: { published: true, problems: [...] }`, and answer problem+json (registered on the root **and** `/v1` scope as for every route). Neither takes a request body, path parameter or query parameter; the account acted on is always `request.user!.id`, never client input.

### 5.1 `GET /v1/account/export`

`200` `AccountExport` (§5.3), `Content-Disposition: attachment; filename="strength-in-numbers-export-YYYY-MM-DD.json"`, `Cache-Control: no-store` (cache policy default). Errors: `401`, `403 account-deleted`, `429 rate-limited` (+ `Retry-After`), `500`, `503` — all central, none declared in `problems`. No `ETag`, no `304`: the document is a one-shot download, not a revalidated resource (D4).

### 5.2 `DELETE /v1/account`

`202` `{ deletedAt: string, purgeEligibleAt: string }`. `config: { published: true, problems: [], writeGroup: "me" }`. Errors: `401`, `403 account-deleted` (including a repeat delete), `429`, `500`, `503`; and, as for every `DELETE`, the central `413 / 415 / 422` request-shape rows. `202` (not `204`) because data is not yet gone — matching DESIGN §6's `DELETE /account → 202`.

### 5.3 `@sin/core` additions (`packages/core/src/dto/account.ts`)

The export is a composition of existing read DTOs; **no field is redeclared**:

```ts
import { z } from "zod";
import { MeSchema } from "./me.js";
import { ExerciseSchema } from "./exercise.js";
import { RoutineSchema } from "./routine.js";
import { WorkoutDetailSchema } from "./workout.js";

export const ACCOUNT_EXPORT_FORMAT_VERSION = 1 as const;
/** Days between DELETE /v1/account and the earliest purge. One constant: the 202 body and the purge CLI. */
export const ACCOUNT_PURGE_GRACE_DAYS = 30;

/** `GET /v1/me` minus the provisioning-only flag. */
export const AccountExportProfileSchema = MeSchema.omit({ isNewUser: true });

export const AccountExportSchema = z.object({
  formatVersion: z.literal(ACCOUNT_EXPORT_FORMAT_VERSION),
  exportedAt: z.iso.datetime({ offset: true }),
  profile: AccountExportProfileSchema,           // GET /v1/me (MeSchema)
  exercises: z.array(ExerciseSchema),            // GET /v1/exercises entries — custom only, incl. isActive:false
  routines: z.array(RoutineSchema),              // GET /v1/routines/{id}
  workouts: z.array(WorkoutDetailSchema),        // GET /v1/workouts/{id} (WorkoutSchema + exercises[ + sets[] ])
});
export type AccountExport = z.infer<typeof AccountExportSchema>;

export const AccountDeletedResponseSchema = z.object({
  deletedAt: z.iso.datetime({ offset: true }),
  purgeEligibleAt: z.iso.datetime({ offset: true }),
});
export type AccountDeletedResponse = z.infer<typeof AccountDeletedResponseSchema>;
```

Notes on the composition:

- `MeSchema.omit({ isNewUser: true })`: `isNewUser` is a provisioning signal on the response that created the row, meaningless in a file. `email` stays — it is the user's own data.
- `ExerciseSchema` includes `ownerUserId` (equals `profile.id` for every row), `catalogKey: null`, `isActive` and `forkedFromExerciseId`. A fork's `forkedFromExerciseId` points at a **global** exercise that is not in the file; it is kept as provenance (the file reads on its own through the workout name snapshots, not through exercise ids).
- `WorkoutDetailSchema` = `WorkoutSchema.extend({ exercises: WorkoutExerciseDetailSchema[] })`, each exercise carrying its `sets: SetEntrySchema[]`. This is exactly what `GET /v1/workouts/{id}` returns, so `routineName`, the six routine-target fields, `supersetGroup`, `weightKg`/`distanceM` and `completedAt` come along unchanged.
- All are `z.object` (allowlist) schemas, so the response serializer strips any column a mapper might leak (Spec 03.0 §6.5).

### 5.4 Operator command (not an HTTP surface)

`pnpm --filter @sin/api run account:purge [--confirm] [--user <id>] [--skip-grace]` — see §6.4. In the Docker image: `node apps/api/dist/account/purge-cli.js`.

---

## 6. Behavior & logic

### 6.1 Account states

```
active ──DELETE /v1/account──▶ soft-deleted ──account:purge (≥ 30 d)──▶ purged
  ▲                              │   (every /v1 call → 403 account-deleted)     (row + all data gone;
  └──── manual UPDATE (runbook) ─┘   (export unavailable)                        next login = fresh empty account)
         valid only before the purge
```

Setting `deleted_at` is the whole of "token revocation" (DESIGN §4.9): `resolveUser` re-reads the row on every `/v1` request, so no token list or Auth0 call is needed and every device is cut off at once. Only `/v1/_authcheck` (a smoke-only probe that echoes non-sensitive claim data and reads no user data) skips provisioning; it is unaffected.

### 6.2 Export — snapshot, queries, mapping

**Transaction.** `prisma.$transaction(fn, { isolationLevel: RepeatableRead, timeout: 30_000, maxWait: 5_000 })`; the first statement is `SET TRANSACTION READ ONLY` (D7). Under `REPEATABLE READ`, every statement sees the database as of the first statement's snapshot, so a set logged mid-export is either wholly in or wholly out and a workout deleted mid-export is still exported whole. (From first principles: at the default `READ COMMITTED`, each statement takes a fresh snapshot, so reading workouts, then exercises, then sets could return a set whose workout was never listed.) The tradeoff is that the transaction holds a snapshot for its few hundred milliseconds; with a read-only transaction there are no write conflicts to retry.

**Statements** (all keyed by the acting `user_id`; at most 8, AC8):

| # | Reads | Notes |
|---|---|---|
| 1 | `SELECT clock_timestamp() AS exported_at` | the database clock, so `exportedAt` and every `created_at` come from one clock |
| 2 | the `user` row | the profile, re-read inside the snapshot (not `request.user`, which predates it) |
| 3 | `exercise WHERE owner_user_id = $1` | **no `is_active` filter**; `ORDER BY created_at, id` |
| 4 | routines with items | the existing single-statement `ROUTINE_WITH_ITEMS` form (`json_agg … ORDER BY position`), generalized to all of the user's routines |
| 5 | `workout WHERE user_id = $1` | `ORDER BY started_at, id` (oldest first; the UUIDv7 id is the unique tiebreaker) |
| 6 | `workout_exercise WHERE workout_id IN (SELECT id FROM workout WHERE user_id = $1)` | `ORDER BY workout_id, position` |
| 7 | `set_entry WHERE workout_exercise_id IN (…)` | `ORDER BY workout_exercise_id, set_number`; `SET_ENTRY_COLUMNS` (numeric → `float8`) |

Rows 5–7 are grouped in memory (`Map` by `workout_id` / `workout_exercise_id`) and assembled into `WorkoutDetailRecord`s. A heavy user (a couple of years: ~400 workouts, ~8,000 sets) is ~2–3 MB of JSON — fine as one response for the beta (D15).

**Which existing code is shared (answer to "is there a whole-workout read to reuse?").** A whole-workout detail read exists — `WorkoutRepository.getWorkoutById` → `toDetail` in `repositories/workout.prisma.ts` — but it is **per workout** (header query, `loadExercises`, `loadSetsForWorkout` = three statements each), so looping it would be exactly the N+1 the brief rules out. The export therefore shares the **mappers, not the queries**:

- **Row → Record layer** (private today, to be exported unchanged): `WorkoutDbRow` / `toRecord` and `WorkoutExerciseDbRow` / `toExerciseRecord` (`workout.prisma.ts`), `ExerciseDbRow` / `toRecord` (`exercise.prisma.ts`), `toItem` / `toRoutine` (`routine.prisma.ts`). Already exported and reused as-is: `SET_ENTRY_COLUMNS`, `SetEntryDbRow`, `toSetRecord` (`set-entry.prisma.ts`). The routine list query is generalized to take a `RawClient` so it can run inside the export's transaction (today `list` binds the root Prisma client).
- **Record → DTO layer** (private in the route files today, except `toSetEntryDto` in `routes/sets.ts`): `view` (`me.ts`), `toDto` (`exercises.ts`), `toRoutineDto` / `toItemDto` (`routines.ts`), `toWorkoutDto` / `toWorkoutExerciseDto` / `toWorkoutDetailDto` (`workouts.ts`). They move, verbatim, to **`apps/api/src/routes/mappers.ts`**; the routes import them from there (AC33). This is what makes AC6 true by construction: the file and the read routes cannot disagree on a field.

The new code lives in `repositories/account-export.ts` (interface, `AccountSnapshot` record type) and `repositories/account-export.prisma.ts` (the transaction and queries), a route module `routes/account.ts` registered from `routes/v1.ts`, and `UserRepository.markDeleted(id)` (§6.3). `buildApp` and the test fakes gain the new repository dependency.

**Response.** The handler maps the snapshot through the shared mappers, sets `Content-Disposition` (`exportedAt` truncated to its UTC date; no user data in the name), logs the counts (AC11), and returns the object; the Zod serializer validates it against `AccountExportSchema` on the way out. No compression plugin is added (D15).

### 6.3 Delete

```
resolveUser (403 if already deleted)
  → UPDATE "user" SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING deleted_at
  → 0 rows (a concurrent delete won)  → throw AccountDeletedError (403)
  → 1 row → log account_deleted → 202 { deletedAt, purgeEligibleAt = deletedAt + GRACE_DAYS × 86,400 s }
```

`UserRepository.markDeleted(id): Promise<Date | null>` (null = no row changed). One statement; no `FOR UPDATE`, no transaction, no lock (D9). A write that passed `resolveUser` a moment before the update may still commit (a set logged at that instant): harmless, the purge removes it. An in-progress workout is not finished or touched; it goes with the purge. The handler computes `purgeEligibleAt` by adding `ACCOUNT_PURGE_GRACE_DAYS × 86_400_000` ms to the returned `Date` — exact, no calendar arithmetic (D10).

### 6.4 Purge CLI

Shaped like `records:rebuild`: logic in `apps/api/src/account/purge-cli.ts` (compiles into `dist/`; `main(argv, env)` exported and unit-testable; runs when invoked directly), a thin entry `apps/api/scripts/purge-accounts.ts`, `package.json` script `"account:purge": "tsx --env-file-if-exists=.env scripts/purge-accounts.ts"`, and the core in `src/account/purge.ts` (`listEligible`, `purgeAccount`). Deliberately **not** a Prisma hook (a dev `migrate reset` must never run it).

**Arguments** (`parsePurgeArgs`, the `parseRebuildArgs` idiom — anything unrecognized is an error, never ignored): `--confirm`, `--user <id>` / `--user=<id>` (UUID, once), `--skip-grace` (requires `--user`), and the `--` pnpm may forward.

**Dry run (no `--confirm`).** One read-only query lists eligible accounts:

```sql
SELECT u.id, u.deleted_at,
       (SELECT count(*) FROM workout w WHERE w.user_id = u.id)::int AS workouts,
       (SELECT count(*) FROM set_entry s JOIN workout_exercise we ON we.id = s.workout_exercise_id
          JOIN workout w ON w.id = we.workout_id WHERE w.user_id = u.id)::int AS sets
FROM "user" u
WHERE u.deleted_at IS NOT NULL
  AND u.deleted_at <= now() - make_interval(secs => $grace_seconds)    -- $grace_seconds = GRACE_DAYS × 86400, or 0 with --skip-grace
  AND ($user::uuid IS NULL OR u.id = $user::uuid)
ORDER BY u.deleted_at, u.id
```

Output is user id, `deleted_at`, counts — **never email** (it would land in terminal history). With `--user`, a target that is absent from the result is reported with its reason (`not-found`, `not-deleted`, `in-grace`) and the run exits `1`.

**`--confirm`.** For each listed account, in order, one transaction (`{ timeout: 60_000 }`, like `records:rebuild`):

1. `lockUserRecords(tx, userId)` — the **first** statement (CLAUDE.md: every PR writer; the cascade removes `personal_record` rows, and the recompute's FK `KEY SHARE` locks on workout rows make row-lock-first deadlock, Spec 07.0 AC18).
2. Count the account's workouts and sets (for the log line).
3. `DELETE FROM "user" WHERE id = $1 AND deleted_at IS NOT NULL AND deleted_at <= now() - make_interval(secs => $grace_seconds)`.
4. `rowCount = 0` → the account was restored (or never eligible) since the listing → nothing was deleted; record **skipped** `not-eligible`. `rowCount = 1` → **purged**.

The grace test lives in the `DELETE`'s predicate, not in the listing, so an account the operator restores after the dry run is safe (AC27), and `deleted_at IS NOT NULL` makes a live account unpurgeable by construction under any flag (AC26). `--skip-grace` changes only `$grace_seconds` to `0`.

**Failure policy.** A thrown error rolls back that account, logs `account_purge_failed` (`user_id`, error class — not the message, which could echo SQL parameters), and the loop **continues** (D11). The final line `purged N, skipped M, failed K`; exit `1` if any account failed, if `--user` was given and not purged, or on argument/`DATABASE_URL` errors (`resolveDatabaseUrl`, same direct-host requirement as `records:rebuild`); else `0`.

**What the cascade does to the exercise sync stream.** A hard delete sends no tombstone (DESIGN §4.3, Spec 03.3); the deleted exercises were visible only to the purged user, so no other client holds them. Nothing to do.

### 6.5 Edge cases

- **Export while a delete races it.** The export has already passed `resolveUser`; it returns the full snapshot. Harmless — the user is entitled to the data.
- **Purge of a user with an in-progress workout.** It cascades like any other workout; the one-active partial unique index is irrelevant to a delete.
- **A user deleted, never purged, re-logs in.** Every call is `403 account-deleted` until purge (D3). Spec 12 renders that state; this spec adds no endpoint to read it.
- **After the purge,** the same Auth0 `sub` re-provisions a new `user` row with a new UUIDv7 id and no data — by `resolveUser`'s existing unknown-`sub` branch.
- **Time.** `exportedAt`, `deletedAt`, `purgeEligibleAt` are `Date.toISOString()` UTC like every other timestamp; the grace comparison is in seconds so a DST change in the session `TimeZone` cannot shift it (D10).

---

## 7. Security & privacy

- **Authorization boundary.** Neither route takes an account identifier; every query is keyed by `request.user!.id` from the verified token (the single boundary, DESIGN §5.1). There is no cross-user path to test beyond AC5 (isolation) and AC15/AC16 (delete affects only the caller).
- **What the export contains** is the user's own personal and health-adjacent data (email, timezone, every workout). It is a `no-store` response, never logged (counts only, AC11), never cached by an intermediary (`Cache-Control: no-store` from the `/v1` policy; no `Vary: Authorization` per the project convention).
- **Bearer-token holder can export and delete.** Anyone holding a valid access token can download everything and start a deletion. There is no step-up re-authentication (D14): the tokens are short-lived and held in memory (Q12), the beta has a handful of known testers, and a mistaken or malicious delete is recoverable by the owner for 30 days. Upgrade path: require a recent Auth0 `auth_time` (`max_age`) on `DELETE /v1/account`. CSRF does not apply (bearer header, not a cookie; CORS allowlist).
- **Abuse / cost.** The export is the most expensive read (several statements, a few MB). It is bounded by the per-user `export` budget (3 per minute, D8), L1 per IP, the transaction timeout (30 s), and the connection pool (`connection_limit=8`; a read-only transaction holds one connection for its duration). A flood of deletes is bounded by the `me` group (10/min), and a delete is idempotent in effect.
- **Retention honesty.** Between `DELETE` and the purge the data (and the email) remain in the database, deliberately: that window is the owner's rescue. After the purge the Postgres rows are gone, but **backups / point-in-time recovery retain them until the host's retention window ages out**, and the **Auth0 identity record is untouched** (D3). The privacy wording that describes this is settled in §12 O2 (resolved 2026-10-11); the runbook tells the operator how to remove the Auth0 user by hand for an erasure request.
- **PII in logs.** `account_exported`, `account_deleted`, `account_purged`, `account_purge_skipped`, `account_purge_failed` carry the internal `user_id` and counts only (AC11, AC18, AC31). The purge CLI's terminal output follows the same rule. `account_deleted` is the one durable record that a deletion happened once the row is purged.
- **The purge is the only hard-delete path** for a user and is operator-only (needs the production `DATABASE_URL`); there is no HTTP route that can purge. A live account cannot be purged by any flag combination (AC26).

---

## 8. Config & secrets

No new environment variable, no secret, no external service.

- **`ACCOUNT_PURGE_GRACE_DAYS = 30`** is a code constant in `@sin/core`, not env-configurable: changing the retention promise is a reviewed decision tied to the user-facing copy, not an ops knob (cf. 03.2's `MAX_CUSTOM_EXERCISES_PER_USER`).
- **`RATE_LIMITS.exportPerUser = 3`** in `apps/api/src/plugins/rate-limit.ts` — the one place limits are written; tests override via `limitsWith({ exportPerUser: n })`.
- **CORS `exposedHeaders`** (`app.ts`) gains `"Content-Disposition"` (`WEB_ORIGIN` allowlist and `methods` — which already include `DELETE` — are unchanged).
- **The purge CLI** reads `DATABASE_URL` only (the direct Neon host, as `records:rebuild` and `migrate deploy`; `resolveDatabaseUrl` applies the TLS rules) and `LOG_LEVEL`. The operator supplies it on the command line; nothing is stored in Render or CI.

---

## 9. Observability

Log lines carry ids and counts only. Existing request logging (`client_ip`, request id, status) applies to both routes.

| Event | Level | Fields |
|---|---|---|
| `account_exported` | info | `user_id`, `exercise_count`, `routine_count`, `workout_count`, `set_count` |
| `account_deleted` | info | `user_id` |
| `rate_limited` (existing) | warn | layer `user-export` (new `RateLimitLayer` value), `user_id` |
| `account_purged` | info | `user_id`, `workout_count`, `set_count`, `skip_grace` |
| `account_purge_skipped` | info | `user_id`, `reason` (`not-eligible`) |
| `account_purge_failed` | error | `user_id`, `error_class` |
| purge summary | info | `purged`, `skipped`, `failed`, `dry_run` |

Metrics/analytics: none in this spec; Spec 13 may add `account_deleted` as a product event if wanted. The export statement count and elapsed time are visible from the request log; AC12's tripwire guards the regression.

---

## 10. Testing

Test-first per criterion, Vitest. Unit tests use the fakes (`test/helpers/fakes.ts` gains a `markDeleted` on the fake user repository and a fake export repository); integration tests use Testcontainers Postgres with the real repositories (`RUN_INTEGRATION=1`). New files: `test/unit/account-dto.test.ts`, `routes-account.test.ts`, `openapi-account.test.ts`, `account-purge-args.test.ts`, `rate-limit-export.test.ts`; `test/integration/account-export.integration.test.ts`, `account-delete.integration.test.ts`, `account-purge.integration.test.ts`. Order of attack: core DTOs → mapper extraction (AC33, green before anything else) → export repository + route → delete → rate limit → purge core → CLI.

| Criterion | Verified by |
|---|---|
| AC1 | Unit (`inject`, fakes): 401 without token, 403 for a deleted fake user, response parses with `AccountExportSchema`; unit OpenAPI test: the path is published with its `problems` |
| AC2 | Integration through `inject`: exact top-level key set, `formatVersion === 1`, `exportedAt` parses as UTC and is within seconds of now, `profile` equals `GET /v1/me` body with `isNewUser` removed |
| AC3 | Integration: fixture with custom active + soft-deleted + forked exercises, two routines with items, two finished workouts and one in-progress (inserted out of order, backdated `startedAt`); assert each collection's membership and order, `sets` ordering, and the empty-account case |
| AC4 | Integration: walk every object in the body and assert key sets equal the DTO key sets; assert no `personal_record` content, no global exercise id, and no `authSub` / `deletedAt` anywhere |
| AC5 | Integration cross-user suite (the 03.1 / 05.0 field-by-field pattern): users A and B both own every kind of row, including same-named exercise and routine; each caller's body contains only its own ids |
| AC6 | Integration: compare exported items to the read routes' bodies with `toEqual` (workouts, routines, exercises); fixture includes an `lb` set, an RPE 8.5, a routine-started workout with targets and a superset group |
| AC7 | Integration with a wrapper client (the 07.0 AC17 fault-injection pattern) that commits a set insert, a workout delete and a routine `PUT` through a second connection between statements 3 and 6; assert the pre-write document and cross-collection referential consistency; a probe inside the transaction asserts `transaction_isolation = 'repeatable read'` and `transaction_read_only = 'on'` |
| AC8 | Integration: a statement-counting Prisma query event hook; count for 5 workouts equals count for 60 and is ≤ 8 |
| AC9 | Integration/`inject`: header regex for `Content-Disposition`, date equals `exportedAt`'s UTC date; `Cache-Control: no-store`; CORS: a request with `Origin` in the allowlist returns `Access-Control-Expose-Headers` containing `Content-Disposition`; unit scan: the route sets no `Cache-Control` and declares no `httpCache` |
| AC10 | Unit (`buildTestApp({ rateLimits: limitsWith({ exportPerUser: 2 }) })`, fake store): 3rd → 429 problem+json + `Retry-After`; second user fine; `PATCH /v1/me` still 200; app-assembly unit test: a read route declaring `writeGroup` throws (existing) and a `userBudget` route with no user fails open on limiter error; `RATE_LIMITS.exportPerUser === 3` |
| AC11 | Unit: captured pino lines contain exactly one `account_exported` with the four counts and no body/email/note text |
| AC12 | Integration: seed the heavy fixture (bulk `INSERT … SELECT generate_series`), one `inject` call, assert `< 10 s` and the AC8 statement count. CI tripwire — a failure means the export grew a per-row cost |
| AC13 | Unit: published + `problems`; 401; a request with a body is rejected per the existing body rules; app assembly succeeds with `writeGroup: "me"` and a unit test asserts the route config carries it |
| AC14 | Integration: 202 body; `deletedAt` equals a direct `SELECT deleted_at`; `purgeEligibleAt − deletedAt === 30 × 86,400,000 ms` exactly; parse with `AccountDeletedResponseSchema` |
| AC15 | Integration: per-table row counts and a content hash for all users before/after; the caller's `user` row differs only in `deleted_at`; in-progress workout still present |
| AC16 | Integration: after the 202, four calls with the same token and one with a second token for the same `sub` → `403 account-deleted`; a third user's token → 200 |
| AC17 | Integration: second delete → 403, `deleted_at` unchanged; `Promise.all` of two deletes → one 202 and one 403 and no 500 (repeated 20× for the race) |
| AC18 | Unit: captured lines — one `account_deleted` with `user_id` only; no email/`sub`/token substring in any line |
| AC19 | Unit (`limitsWith({ groups: { me: 2 } })`): `PATCH /v1/me` + `PATCH /v1/me` exhausts it, the `DELETE` then 429s (and the reverse), per user |
| AC20 | Unit: source scan of `apps/api/src` (the Spec 04.0 AC7 scan idiom) for a second `ACCOUNT_PURGE_GRACE_DAYS` definition or a literal `30 days` / `interval '30` / `* 30` near purge SQL; unit: `purgeEligibleAt` and the CLI both read the core constant |
| AC21 | Integration: three soft-deleted accounts (two eligible); dry run → listing of two with counts, all row counts unchanged, captured stdout/log contains no email, exit `0`; empty case → exit `0` |
| AC22 | Integration with a statement-recording wrapper client: the first recorded statement in each account's transaction is the advisory-lock `SELECT pg_advisory_xact_lock(hashtext('pr:' || …))`, the `DELETE` contains `deleted_at IS NOT NULL` and the bound grace parameter, and the transaction is opened with `timeout: 60000` |
| AC23 | **A demanding row.** Integration: `pg_constraint` → recursive FK graph from `"user"`; generated per-table FK-path counts; fixture covering every discovered table; asserts zero after, nonzero before (per table), and the delete-rule allowlist. Includes `personal_record`, a routine item on the user's own custom exercise, a fork, an in-progress workout |
| AC24 | Integration: bystander counts and a content hash per discovered table before/after; global catalog counts unchanged |
| AC25 | Integration: `UPDATE "user" SET deleted_at = now() − interval '1 second' * (grace ± 1)` and run `--confirm` |
| AC26 | Integration: parameterized over `{--confirm, --confirm --user, --confirm --user --skip-grace, --user --skip-grace (dry run)}` on a live account: row intact, exit `1` for targeted forms |
| AC27 | Integration: dry run, clear `deleted_at`, `--confirm` → skipped, row and children intact; a variant with the clear injected between listing and `DELETE` via the recording wrapper |
| AC28 | Unit (`parsePurgeArgs` table: valid forms, repeated, unknown, bad uuid, `--skip-grace` alone, `--` forwarding → exit `1` with a spy proving no `PrismaClient` was constructed); integration: `--user --skip-grace --confirm` on an in-grace account purges it, without `--skip-grace` skips it, unknown / live target exits `1`, untargeted skip exits `0` |
| AC29 | Integration with a fault injected into the second of three accounts' transactions: first and third purged, second intact, summary `purged 2, skipped 0, failed 1`, exit `1` |
| AC30 | Integration, real concurrency (the 07.0 AC18 pattern): `Promise.all` of purge + the repository writers (finish, set create, workout delete) — a soft-deleted user's HTTP calls stop at `resolveUser` and never reach a lock, so the race is at the repository level; assert results ∈ serial outcomes (a writer may lose with `NotFound` or `WorkoutFinished`), no `500`, no `40P01`, user gone, no `personal_record` orphan |
| AC31 | Unit: captured lines for purge, skip and failure contain only the documented fields; the dry-run listing is the same field set |
| AC32 | Unit: `openapi-problem-matrix` rows; both paths' inline `200` / `202` response schemas in `/openapi.json` (the document has no named schema components except `Problem`); `contract-pipeline` path-set test; OpenAPI drift check (CI) |
| AC33 | The whole existing suite, unmodified except import paths (CI) |
| AC34 | Unit: `AccountExportSchema` accepts a hand-built document, rejects a wrong `formatVersion`, strips an extra key; `isNewUser` absent from the profile shape; `pnpm run core:purity` (CI) |
| AC35 | CI: the `prisma migrate diff` no-drift check; change audit: no migration/`schema.prisma` hunk |
| AC36 | Review checklist (§11) at PR time; DESIGN / README edits verified in this draft's diff |

---

## 11. Deployment & rollback

**No migration; no release step.** Code ships on merge to `main` (staging auto-deploys). Unlike 07.0 / 09 there is nothing to run before or after the deploy. The purge is an **ongoing ops task**, not a release step.

**Rollout order within the PR** (each commit green): (1) `@sin/core` `dto/account.ts`; (2) the mapper extraction (AC33); (3) rate-limit `userBudget` + CORS header; (4) `UserRepository.markDeleted` + `DELETE /v1/account`; (5) export repository + route; (6) purge core + CLI; (7) docs. The post-deploy smoke needs no change; a manual check on staging: `GET /v1/account/export` with the test user's token returns a parseable file.

**Rollback:** revert the commit. Nothing persists except `deleted_at` values set by users in the meantime, which remain valid soft-deleted accounts (an older build would still return `403 account-deleted` from `resolveUser`, which predates this spec). No data is destroyed by the code itself; only an operator running `--confirm` destroys data.

### Operator docs (land with the implementation, not this draft)

- **`CLAUDE.md`** — add to Commands: `DATABASE_URL='<url>' pnpm --filter @sin/api run account:purge [--confirm] [--user <id>] [--skip-grace]  # Spec 11; dry run by default; operator task (runbook), NOT a release step`; and one convention line: *"**Account lifecycle** (Spec 11): `DELETE /v1/account` only sets `deleted_at` (every `/v1` call then 403s via `resolveUser`); data is removed only by `account:purge --confirm` after ≥ `ACCOUNT_PURGE_GRACE_DAYS` (`@sin/core`), which takes `lockUserRecords` first and keeps the grace check inside the `DELETE`. A new user-owned table must cascade from `user` — the purge test discovers tables from `pg_constraint` and fails otherwise. The export composes the read DTOs through `routes/mappers.ts`; when a read DTO gains a field the export gains it for free, so never hand-map in the export."*
- **`docs/runbooks/first-deploy.md`** — new section **"Account deletion requests"** (after Part D, before Part E): when a tester asks to delete, or monthly, run the dry run then `--confirm` with the direct-host `DATABASE_URL` (same export as B4); for an immediate-erase request use `--user <id> --skip-grace`; the manual restore `UPDATE "user" SET deleted_at = NULL WHERE id = '<id>'` (valid only before the purge — afterwards the data is gone); a note that the Auth0 identity is not removed and, for a full erasure request, the operator deletes the user in the Auth0 dashboard by hand; and a troubleshooting row ("tester's login shows account-deleted → it is within the grace window; restore or wait").

### DESIGN.md / README edits (applied with this draft)

DESIGN.md: header (date, "Q1–Q19"); §3.1 diagram box + note; §3.2 object-storage and hosting rows; §3.3 environments; §4.1 `deleted_at` line; §4.9 `user` row and closing paragraph; §6 `GET /account/export` and `DELETE /account` lines; §8.2 stale `(§4.7)` cross-reference; §9 M4 row; §10 Q4 parenthetical and new **Q19**. `docs/specs/README.md`: the row 11 text, link and status. (Verified by AC36.)

---

## 12. Decisions & open questions

- ✅ **D1 — Beta minimum, not the full DESIGN version (owner decision, 2026-10-11).** Synchronous JSON export from the API; the purge is a CLI the owner runs by hand. **No R2 bucket, no Render cron job, no S3 client.** **Rationale:** M4's exit is a handful of known testers; async export plus a scheduled job is infrastructure (a bucket, signed URLs, a cron service, an IAM-ish credential) whose only beneficiary is a population that does not exist yet. The data volume (~2–3 MB) fits one response. They return at GA under their own spec number, when there are strangers' accounts to look after.
- ✅ **D2 — No self-service undo during the grace window (owner decision).** Delete is final from the user's side; the blanket `403 account-deleted` stays. The owner clears `deleted_at` by hand before the purge (runbook). **Rationale:** a restore endpoint needs a state the whole app does not model (a half-deleted account that can authenticate) and a second code path through `resolveUser`; the beta's support channel is a person. **Consequence:** export is unavailable after delete, so the UI must offer "Download your data first" (Spec 12).
- ✅ **D3 — Auth0 is left alone (owner decision).** No Management API, no M2M credentials. During the grace window signing in shows the account-deleted state; after the purge the same login re-provisions a fresh, empty account via `resolveUser`. **Rationale:** a Management API credential is a standing high-privilege secret to protect for a beta; the IdP record holds only the email the user gave. **Consequence:** the identity record persists (see O2); for an erasure request the runbook has the operator remove it by hand in the Auth0 dashboard.
- ✅ **D4 — Export format: one JSON document (owner decision).** No CSV, no zip, no `ETag`/`304`. A Hevy-shaped import/export is a later spec on Hevy's real format. **Rationale:** JSON round-trips the nested workout → exercise → set structure without flattening decisions; CSV would force several files (hence a zip) and a column design that a real format spec will redo.
- ✅ **D5 — Approach: `GET /v1/account/export` + `DELETE /v1/account` + `account:purge` CLI (owner decision).** **Rejected:** an SPA-assembled export (N+1 requests on a phone, no consistent snapshot, a native client would redo it); a raw-SQL purge snippet in the runbook (no dry run, no grace check, no test).
- ✅ **D6 — The export is a composition of the existing read DTOs; no field is redeclared.** `profile = MeSchema.omit({ isNewUser })`, `exercises = ExerciseSchema[]`, `routines = RoutineSchema[]`, `workouts = WorkoutDetailSchema[]` (§5.3). **Rationale:** one definition of a wire shape means the export cannot drift from the read routes (units, RPE decimals, `routineName`, new fields) and the response-schema allowlist keeps internal columns out for free. `formatVersion` bumps only for a removal, rename or semantic change; additive fields do not (DESIGN §6's response-field rollout convention already tells clients to tolerate unknown fields). **Rejected:** a bespoke export schema in storage-native shape (a second set of unit/format rules to keep in sync); embedding global catalog exercises (bloats the file; name snapshots already make workouts self-describing); including `personal_record` (a rebuildable cache — exporting it would imply it is user data of record).
- ✅ **D7 — Snapshot via one `REPEATABLE READ`, read-only transaction and a fixed set of bulk queries; share the mappers, not the per-workout read.** Seven statements keyed by `user_id`, assembled in memory (§6.2). The mappers are exported/extracted (`routes/mappers.ts` plus the private row mappers) instead of looping `getWorkoutById`. **Rationale:** the user needs one consistent file, not a mixed-time one, and 400 workouts × 3 statements would be ~1,200 round trips on a free-tier network hop. `SET TRANSACTION READ ONLY` makes the intent enforceable. *Verify at implementation:* Prisma issues its own `SET TRANSACTION ISOLATION LEVEL` right after `BEGIN`; the read-only `SET` must still precede the first data statement — if Prisma's sequence prevents it, drop the `READ ONLY` statement (nothing in the code path writes) and keep the AC7 isolation probe. **Rejected:** `READ COMMITTED` (torn reads across statements); a per-workout `getWorkoutById` loop (N+1); streaming/NDJSON or a server-side cursor (the output is one JSON document and ~3 MB — streaming adds a second code path and loses Zod validation of the whole); a materialized/cached export (stale, a second copy of personal data).
- ✅ **D8 — Per-user export budget via a new `config.userBudget: "export"` hook, 3 per 60 s window, keyed by `request.user!.id`.** `RATE_LIMITS.exportPerUser = 3`; a per-user sibling of `ipBudget: "docs"`: the limiter is created next to the group limiters, attached in the `/v1` `onRoute` hook as a `preParsing` step after auth (so `request.user` exists and a limited request does no work), enforced with the existing `enforce`, new layer `"user-export"`. **Rationale:** the budget must be per user (L1 is per IP and shared by NATs/gyms; `docs` is per IP by design); 3 per minute allows a retry or two after a failed download but caps the heaviest read at a few MB/min/user. **Rejected:** (a) a write group — the assembly check *throws* for a read route that declares `writeGroup`, and it would also count against L3 in-flight slots; (b) reusing `ipBudget` — wrong key, punishes shared egress; (c) an in-process semaphore/queue — does not bound per-user rate, state is lost on restart/scale-out; (d) caching the last export for N seconds — a stale copy of personal data and cache-key complexity for a rarely used route; (e) no extra budget (L1 alone permits ~600 exports/min/IP).
- ✅ **D9 — Delete is one `UPDATE … WHERE deleted_at IS NULL RETURNING deleted_at`; a repeat or racing delete is `403 account-deleted`.** No transaction, no lock, no `If-Match`, no body; `202` with the body; `updated_at` untouched. The loser of a concurrent double-delete matches zero rows and throws `AccountDeletedError`. **Rationale:** `resolveUser` already blocks every non-racing repeat with the same 403, so the racing case must give the same answer or the client sees two contracts; the single-statement guard is atomic without a lock. **Rejected:** idempotent `202` on repeat (contradicts the 403 every other route returns and the brief); `SELECT … FOR UPDATE` first (a lock for no benefit).
- ✅ **D10 — One grace constant in `@sin/core`, compared in exact seconds.** `ACCOUNT_PURGE_GRACE_DAYS = 30` lives in `@sin/core` (the UI can display it; the API and CLI both need it); `purgeEligibleAt` adds `30 × 86,400,000` ms in JS and the CLI binds `30 × 86400` seconds to `now() - make_interval(secs => $1)`. **Rationale:** `interval '30 days'` on a `timestamptz` is calendar arithmetic in the session `TimeZone`, so across a DST change it differs from the API's 30 × 24 h by an hour — the 202's promised date and the purge's actual eligibility would disagree. A parameter also makes `--skip-grace` just `0`. (Refines the brief's literal `interval '30 days'`; same behavior, no owner decision reopened.)
- ✅ **D11 — Purge CLI behavior beyond the brief.** `--skip-grace` requires `--user` (immediate erase is never a bulk operation); with `--user`, a target that is not purged exits `1` (the operator asked for something specific; silent success would be wrong), while untargeted runs that skip accounts exit `0` (skips are normal — the restore race); a failure on one account rolls back that account, is logged, and the loop continues, ending `exit 1` with a count. **Rationale:** matches the `records:rebuild` safety idiom (a mistyped flag never widens the run) and gives the operator a usable exit code in both modes. **Rejected:** fail-fast on first error (one poisoned account would block every other erasure request); per-account output of email to identify accounts (PII in terminal history — the id plus `deletedAt` and counts suffice, and the operator maps id → tester from their own records).
- ✅ **D12 — The completeness test discovers tables from `pg_constraint`, requires the fixture to cover each, and allowlists the non-cascade FK edges (AC23).** **Rationale:** the failure mode this spec must guard is a *future* table (the body-weight log) added with `RESTRICT`/`NO ACTION` or no FK path — the purge would then fail or leave data behind, and nobody would run the purge test by hand. Auto-discovery makes that a red build; the vacuous-pass guard keeps the discovery honest. **Rejected:** a hard-coded table list (silently stale); asserting only `DELETE FROM "user"` succeeds (passes while leaving orphans via `SET NULL` edges).
- ✅ **D13 — The purge takes `lockUserRecords` first, per account, in its own transaction (CLAUDE.md convention, Spec 07.0 D9).** One transaction per account keeps each lock short and bounds a failure's blast radius. **Rationale:** the cascade deletes `personal_record` rows, making the purge a PR writer; a concurrent finish holding a workout row lock while waiting for the PR lock deadlocks otherwise (07.0 AC18). AC30 exercises it.
- ✅ **D14 — No step-up re-authentication, confirmation token, or email notice on delete.** Confirmation is the UI's job (Spec 12), as with deleting a workout or a routine; the 30-day grace plus the owner's manual restore is the safety net. **Rationale:** a handful of testers, short-lived in-memory tokens (Q12), and recoverability make a step-up flow disproportionate. **Upgrade path:** require a recent `auth_time` claim (Auth0 `max_age`) on `DELETE /v1/account`.
- ✅ **D15 — No cap on export size and no compression plugin.** The export is bounded by what one user can log (custom exercises ≤ 500, routines ≤ 50 × 30 items; workouts unbounded but ~3 MB per couple of years). The counts are logged so growth is visible. No `@fastify/compress` is added (CPU on the free tier; the browser path may be compressed at the edge). **Revisit** when a real account's export exceeds ~10 MB or AC12's tripwire trips — the next step is GA's async-to-bucket design (D1).
- ✅ **D16 — `Content-Disposition` is added to the CORS `exposedHeaders`.** Only `X-Request-Id` and `Retry-After` are exposed today; without this a cross-origin SPA `fetch` cannot read the filename the server chose (Spec 12 saves the file from the page). One line in `app.ts`, owned here because nothing else needs it. The header carries no user data (a UTC date).
- ✅ **D17 — Logging is counts and ids only, and `account_deleted` is the durable record.** After the purge the `user` row is gone; the log line (internal UUID, no email) is the only evidence of when the delete happened. **Rationale:** DESIGN §8.2 / Spec 01 §7 (no PII in logs) and the need to answer "when did X ask to be deleted" without keeping the PII we are erasing.
- ✅ **D18 — No schema work: no migration, no index on `deleted_at`, no purge-audit table (AC35).** **Rationale:** `deleted_at` exists; the only reader is a monthly operator listing over a small table; an audit table would be a second place holding data about an erased user. Add a partial index (`WHERE deleted_at IS NOT NULL`) by forward migration if the table grows.

### Open questions for the owner

- ✅ **O1 — Purge cadence versus the promise.** *Resolved 2026-10-11 (owner): keep the monthly purge; Spec 12 says "at least 30 days".* The runbook says run the purge monthly, and eligibility is "≥ 30 days after delete", so a deletion can wait up to ~60 days. Spec 12's dialog (and any privacy text) should therefore say **"at least 30 days"** / "typically within 60", not "permanently deleted after 30 days". *Recommendation:* keep monthly and use that wording; or run it fortnightly and say "within 45 days". Needed before Spec 12's copy is written.
- ✅ **O2 — Backups and the Auth0 identity versus an erasure request.** *Resolved 2026-10-11 (owner): accept the recommendation — the one-line statement plus the runbook's manual Auth0 step; no code change.* After a purge the rows are gone from Postgres, but the database host's backup/PITR window (Neon free-plan retention — not verified here) still holds them until it ages out, and the Auth0 user record remains (D3). If a privacy policy will promise erasure, its wording must say both. *Recommendation:* a one-line statement ("backups age out within the host's retention window; the sign-in provider record is removed on request") plus the runbook's manual Auth0 step; no code change. Needed before anyone outside the closed beta is promised erasure.
