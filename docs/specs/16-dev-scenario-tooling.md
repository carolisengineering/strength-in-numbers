# Spec 16 — Dev Scenario Tooling (test data + black-box API checks)

**Status:** Draft v0.1 — brainstormed 2026-09-24/26; awaiting owner review.
**Last updated:** 2026-09-26
**Design refs:** DESIGN.md §3.2 (`packages/core` is the home of the
framework-agnostic API client — this spec makes the code match that row),
§3.4 (extensibility: React-free client lifts to native later), §6 (`/v1`
conventions, problem+json). Spec 01 (dev IdP, smoke script — the two scripts
this one is modelled on). Spec 04.0 §6.4 (the React-free API client that moves
here). Spec 05.0 §6.1 (idempotent create — what makes scenarios re-runnable)
and §6.4 (the 7-day `startedAt` bound — the constraint that scopes this spec
to recent data only).

---

## 1. Purpose, scope & non-goals

Ship a **scenario runner**: a local developer tool that replays named,
hand-written fixtures against a *running* API over HTTP, seeding realistic
workout data for UI development and asserting each response on the way, so the
same fixture doubles as a black-box regression check of what is already
built. Alongside it, a hand-driven **request collection** (`.http` files) for
poking at individual endpoints.

This is developer tooling. It ships nothing to users, adds no endpoints, no
tables, and no runtime dependencies to the API image.

### In scope

- `apps/api/scripts/scenario.ts` — the runner CLI (`pnpm --filter @sin/api run
  scenario …`), with per-user token minting via the dev IdP, a static-token
  mode, a remote-URL guard, `--dry-run`, and `--all`.
- `apps/api/scripts/scenarios/` — the step model (typed step constructors, an
  executor interface), shared constants (`ids.ts`, user labels, catalog keys),
  and four starter scenarios: `empty-user`, `active-session`, `finished-week`,
  `lifecycle-checks`.
- `apps/api/http/` — REST Client format `.http` files, one per resource, plus
  a README covering token acquisition and editor support.
- **Moving the React-free HTTP core** from `apps/web/src/api/` into
  `packages/core/src/http/` with its tests, so the runner and the SPA share
  one client. Behaviour-preserving refactor; the web `api/` module becomes a
  thin wrapper that supplies Auth0 and observability callbacks.
- Unit tests for the runner's own logic (§10), a CLAUDE.md commands entry, a
  DESIGN.md one-liner.

### Non-goals

- **Deep history (months of sessions).** The API rejects `startedAt` older
  than 7 days (05.0 §6.4) and this spec does not bypass that. A Prisma-backed
  executor implementing the same step interface is the planned follow-up
  (§12, D5) once 05.1 sets and 07 history exist — before then there is nothing
  worth back-filling.
- **Set logging steps.** Spec 05.1 is not implemented; `logSet` steps are
  added to the step registry when it ships (05.1 §11 should list this).
- **Staging seeding UX.** The runner *can* target staging (§8 `SCENARIO_TOKEN`
  + `SCENARIO_ALLOW_REMOTE`) but no Auth0 device-code flow or token helper is
  built; you paste a token.
- **Randomised / volume generation.** Fixtures are deterministic by design
  (D1). A generator is deferred until hand-written fixtures become repetitive.
- **Cleanup / teardown.** There is no list-my-workouts endpoint to drive one
  from; idempotent create makes re-runs safe instead (D2). A fresh state is
  `docker compose down -v` or a new user label.
- Replacing the integration suite or the post-deploy smoke script. Both stay;
  this fills the gap between them (§12, D3).

## 2. Acceptance criteria

Behavioural criteria get ≥1 unit test naming their number
(`describe("AC3 — …")`) under `apps/api/test/unit/scenario/` with a fake
`fetch`. Criteria marked *(manual)* are verified by running the tool against
the local stack and recorded in the PR description; *(CI)* criteria are
enforced by existing pipeline jobs.

1. **Listing.** `pnpm --filter @sin/api run scenario` with no arguments prints
   every scenario's name and description, one per line, and exits 0 without
   sending any request.
2. **Dry run.** `scenario <name> --dry-run` prints each step as
   `N/M <METHOD> <path> (<user>) expect <status>` with relative times resolved
   to absolute ISO timestamps, sends no request, and exits 0. An unknown name
   exits 2 with a message listing valid names.
3. **Step translation.** Each step constructor produces exactly the HTTP
   method, path, body and default expected status in the table in §5; the
   body validates against the corresponding `@sin/core` request schema
   (`CreateWorkoutSchema`, `AddWorkoutExerciseSchema`, `UpdateWorkoutSchema`,
   `UpdateWorkoutExerciseSchema`).
4. **Expected-status override and check hook.** `expecting(status)` replaces
   the default; a step whose response status differs fails the scenario. A
   step's optional `check(body)` runs on the parsed response body and a thrown
   error fails the scenario with the step index and the error message.
5. **Captured IDs.** A step declaring `capture: "<key>"` stores the response
   `id`; a later step referencing `ref("<key>")` in its path or body has it
   substituted before sending. Referencing an uncaptured key fails at
   `--dry-run` time (not mid-run).
6. **Catalog resolution.** Before the first step, the runner fetches
   `GET /v1/exercises` once per run and resolves every `catalog("<key>")`
   placeholder to the matching `catalogKey`'s `id`. An unknown key fails
   before any step is sent, naming the key.
7. **Per-user tokens.** Each user label used by a scenario is minted exactly
   one dev IdP token per run (`GET {DEV_IDP_URL}/token?sub=devidp|<label>&
   email=<label>@example.test`), cached, and sent as `Authorization: Bearer`
   on that label's steps.
8. **Static-token mode.** When `SCENARIO_TOKEN` is set the dev IdP is never
   called; every label resolves to that token. A scenario using more than one
   label refuses to run in this mode, exits 2, and names the labels.
9. **Remote guard.** A `SCENARIO_BASE_URL` whose host is not `localhost` /
   `127.0.0.1` / `[::1]` exits 2 unless `SCENARIO_ALLOW_REMOTE=1`, before any
   request (including `/readyz`) is sent.
10. **Preflight.** The runner requires `GET /readyz` → 200 before catalog
    resolution; a non-200 exits 1 with the status and body.
11. **Failure policy.** The first failed step stops the scenario; the runner
    prints the step index, request method/path/body, response status/body,
    and exits 1. Earlier steps' side effects are left in place (D2).
12. **Re-runnable.** *(manual)* Running `active-session` twice against the
    same local database yields the same workout ids (idempotent create,
    05.0 §6.1) and the second run passes every assertion.
13. **Starter scenarios pass.** *(manual)* All four starter scenarios exit 0
    against a freshly migrated + catalog-seeded local stack with dev IdP
    running. `lifecycle-checks` exercises every endpoint in §5's table and the
    409 one-in-progress conflict.
14. **Client move is behaviour-preserving.** *(CI)* After the move,
    `packages/core` purity check passes with the new `http/` module; the web
    client's existing tests pass unchanged in their new location; `@sin/web`
    typecheck, lint, and the `src/api` ≥90% coverage gate pass; the SPA's
    `api/index.ts` public exports are unchanged.
15. **Request collection.** *(manual)* Each `.http` file executes top to
    bottom in VS Code REST Client against the local stack after pasting a
    token into its `@token` variable; chained requests pick up the created
    workout id.

## 3. Dependencies & exposed interface

### Needs

- Spec 01: dev IdP (`scripts/dev-idp.ts`, `/token` query interface —
  `sub`, `email`), `/readyz`, the `.env` loading convention
  (`tsx --env-file-if-exists=.env`).
- Spec 03.1: `GET /v1/exercises` returning `catalogKey` on curated rows; the
  catalog seed applied locally.
- Spec 05.0: all workout endpoints in §5; idempotent create via
  `clientGeneratedId`; the 7-day / 5-minute `startedAt` bounds.
- Spec 04.0: the React-free client (`createApiClient`, `parseProblem`,
  `ApiError`, `newRequestId`) — moved, not rewritten.
- Node 22 (`fetch`, `crypto.randomUUID` native), `tsx`, `zod` (already
  present). No new dependencies.

### Provides — stable surface

- **`@sin/core/http`** — `createApiClient(options)`, `ApiClient`, `ApiError`,
  `parseProblem`, `newRequestId`, `REQUEST_ID_HEADER`, `routeTemplate`. Same
  signatures as today's `apps/web/src/api` exports, with one change:
  `CreateApiClientOptions` gains an optional `onSchemaMismatch(error, ctx)`
  callback replacing the direct `reportError` import (D4). Consumed by
  `@sin/web` now and a native client later.
- **Step interface** (`scripts/scenarios/steps.ts`): `Step` = `{ user, method,
  path, body?, expect, capture?, check?, describe }` plus the `Executor`
  interface `{ run(step, ctx): Promise<StepResult> }`. The future Prisma
  executor (D5) implements `Executor`; fixtures do not change.
- **Fixture authoring API**: `scenario(name, description, steps[])`,
  `createWorkout`, `addExercise`, `patchWorkout`, `finishWorkout`,
  `reorderExercise`, `removeExercise`, `deleteWorkout`, `getWorkout`,
  `getActive`, `expecting`, `ref`, `catalog`, `minutesAgo`, `hoursAgo`,
  `daysAgo`. Adding a step type = one constructor in `steps.ts`.

## 4. Data model

None. This spec owns no tables and no migration. It writes only through the
public API, so it can never produce a row the API would not.

## 5. API surface

No new endpoints. The runner *consumes* these (05.0 §5); the table is the
contract AC3 tests:

| Step constructor | Request | Default expect |
|---|---|---|
| `createWorkout(user, {id, startedAt, tzOffsetMinutes?, title?, notes?})` | `POST /v1/workouts` — body per `CreateWorkoutSchema`, `clientGeneratedId = id` | 201 (200 on idempotent replay — AC12 accepts either via `expecting([200, 201])`) |
| `getActive(user)` | `GET /v1/workouts/active` | 200 |
| `getWorkout(user, id)` | `GET /v1/workouts/{id}` | 200 |
| `patchWorkout(user, id, {title?, notes?})` | `PATCH /v1/workouts/{id}` | 200 |
| `finishWorkout(user, id, endedAt)` | `PATCH /v1/workouts/{id}` `{ endedAt }` | 200 |
| `deleteWorkout(user, id)` | `DELETE /v1/workouts/{id}` | 204 |
| `addExercise(user, workoutId, {exerciseId, position?, notes?})` | `POST /v1/workouts/{id}/exercises` | 201 |
| `reorderExercise(user, weId, position)` | `PATCH /v1/workout-exercises/{id}` `{ position }` | 200 |
| `removeExercise(user, weId)` | `DELETE /v1/workout-exercises/{id}` | 204 |

`id` arguments accept a literal UUID from `ids.ts` or `ref("<key>")`;
`exerciseId` accepts a UUID or `catalog("<catalogKey>")`. `user` is a label
from `users.ts` (`alice`, `bob`).

Auth side-channel: `GET {DEV_IDP_URL}/token?sub=…&email=…` (Spec 01, unchanged).

### Request collection (`apps/api/http/`)

`auth.http` (mint tokens for alice/bob), `me.http`, `exercises.http`
(list / since / custom create / fork), `workouts.http` (full lifecycle,
chained via `{{create.response.body.id}}`). Variables: `@baseUrl`, `@token`.
Not asserted, not run in CI.

## 6. Behavior & logic

```
scenario <names…> [--dry-run] [--all]
  │
  ├─ parse args → resolve scenario modules (unknown → exit 2)
  ├─ load config from env (§8) → remote guard (AC9)
  ├─ static analysis of steps: every ref() has an earlier capture (AC5),
  │   every user label is known, single-label check in static-token mode (AC8)
  ├─ --dry-run? → print steps, exit 0
  ├─ GET /readyz → 200 (AC10)
  ├─ GET /v1/exercises (as first user) → catalogKey→id map (AC6)
  ├─ for each scenario, for each step (sequential):
  │     token(user) → send via @sin/core/http client (fresh X-Request-Id)
  │     status == expect ? → check?(body) → capture?(body.id) → print "ok"
  │                        : print failure detail, exit 1 (AC11)
  └─ summary: "<n> scenarios, <m> steps, all ok", exit 0
```

**Relative time** helpers resolve against `Date.now()` at *step-build* time
(when the fixture module is evaluated), not at send time, so a printed
`--dry-run` matches what the real run sends. `finished-week` places sessions
at `daysAgo(1..6)` — inside the 7-day window with a day's margin so a run late
in the evening cannot slip past the bound.

**Idempotent replay.** `createWorkout` defaults to `expecting([200, 201])`
because 05.0 returns 200 with the existing row on replay. Fixtures that want
to *prove* first-time creation (`lifecycle-checks`) use a per-run random id
via `fresh()` and `expecting(201)`.

**User labels → identity.** `sub = devidp|<label>`, `email =
<label>@example.test`. Labels are fixed strings so the same person appears
across scenarios and across runs; the API provisions the user row on first
request (Spec 01), so no setup step is needed.

**Client reuse.** The runner's `getToken` callback returns the cached label
token; `onAuthLost` throws (a 401 during a scenario is a failure, not a
refresh trigger — the client's single retry is disabled via `retryOn401:
false`, a new option in D4). `onSchemaMismatch` throws, so a response that
fails its `@sin/core` schema fails the step.

## 7. Security & privacy

- **Token minting** stays with the dev IdP, which binds to loopback and
  refuses `NODE_ENV=production` (Spec 01). The runner adds no minting.
- **Remote guard** (AC9) prevents a stale `.env` from seeding staging by
  accident; `SCENARIO_ALLOW_REMOTE=1` is an explicit per-run opt-in.
- **`SCENARIO_TOKEN`** is a real bearer token when used against staging. It
  is read from env only, never logged (the runner prints `Authorization:
  Bearer <redacted>` in failure output), and `.env` is gitignored.
- **No new attack surface**: nothing listens, nothing is deployed. The
  `.http` files carry a placeholder `@token = paste-here`, never a real one.
- **Fixture PII**: labels resolve to `@example.test` addresses (RFC 6761
  reserved), never real people.

## 8. Config & secrets

All read by the runner only; none touch the API's own config.

| Var | Purpose | Default | Where set |
|---|---|---|---|
| `SCENARIO_BASE_URL` | API root | `http://localhost:8080` | `apps/api/.env` (optional) |
| `DEV_IDP_URL` | dev IdP root for per-label tokens | `http://localhost:9999` | `.env` (optional) |
| `SCENARIO_TOKEN` | static bearer; disables dev IdP (AC8) | unset | shell, per run |
| `SCENARIO_ALLOW_REMOTE` | `1` permits a non-loopback base URL (AC9) | unset | shell, per run |

Added to `apps/api/.env.example` with comments. No CI secrets.

## 9. Observability

Console only. One line per step (`ok 3/7 POST /v1/workouts → 201 (alice)
[req 018f…]`), including the `X-Request-Id` the client generated so a failing
step can be matched to the API's pino log line. Failure output includes
method, path, request body, response status and body (token redacted).
Nothing is emitted to the API's telemetry.

## 10. Testing

| AC | Level | How |
|---|---|---|
| 1, 2 | unit | invoke `main(argv)` with a fake `fetch` that fails if called; snapshot stdout |
| 3 | unit | build each step, assert method/path/body/expect; `schema.parse(body)` succeeds |
| 4, 5, 11 | unit | fake `fetch` returning scripted statuses/bodies; assert stop-on-first-failure, exit code, substitution |
| 6 | unit | fake `/v1/exercises` payload; unknown key fails pre-send |
| 7, 8 | unit | fake dev IdP; count `/token` calls per label; multi-label refusal with `SCENARIO_TOKEN` |
| 9, 10 | unit | env permutations; assert exit 2/1 and zero requests sent |
| 12, 13, 15 | manual | run against local compose + dev IdP; paste output into the PR |
| 14 | CI | existing jobs: `core:purity`, web unit + coverage gate, typecheck, lint |

The runner is structured so `main(argv, { fetch, env, stdout, stderr })` is
injectable; the bin wrapper passes the real ones. Fixtures themselves are not
unit-tested (D6).

## 11. Deployment & rollback

Nothing deploys. The Docker build is unaffected: `tsconfig.build.json`
includes only `src`, so `scripts/` and `http/` never reach `dist/` or the
image (same as `smoke.ts` and `dev-idp.ts` today).

**Ordering of the PR:** (1) move the HTTP core to `@sin/core/http` with
tests, web wrapper updated, CI green; (2) runner + step model + unit tests;
(3) starter scenarios + `.http` collection + docs. Steps 2–3 may squash; step
1 should be its own commit so a regression in the SPA is bisectable.

**Rollback:** revert the PR. The client move is the only change with a blast
radius beyond dev tooling; if it misbehaves in the SPA, reverting commit (1)
alone restores the previous `apps/web/src/api` in place.

### DESIGN.md / doc edits

- DESIGN.md §3.2 `packages/core` row already lists "API client" — add
  "(moved from `apps/web` in Spec 16)" so the history is traceable.
- CLAUDE.md commands block: `pnpm --filter @sin/api run scenario [name…]
  # replay scenario fixtures against a running API (Spec 16)`.
- `docs/specs/README.md`: roadmap row (this PR), and a note under
  "Parallelism" that 16 has no downstream dependents and can land any time
  after 05.0.
- Spec 05.1 §11: one line — "add `logSet` step constructor to Spec 16's
  registry".

## 12. Decisions & open questions

### Resolved

- **D1 ✅ Fixtures are hand-written TypeScript, not JSON or a generator.**
  TS gives autocompletion from `@sin/core` DTOs and lets fixtures share
  constants. Determinism matters more than volume for UI development: when a
  screen breaks, "run `active-session`" reproduces the state exactly.
  Generator deferred until repetition hurts.
- **D2 ✅ No teardown; rely on idempotent create.** There is no list endpoint
  to drive a cleanup from, and adding one for tooling would be tail wagging
  dog. Fixed `clientGeneratedId`s make re-runs converge on the same rows.
  Partial state after a failed run is acceptable for the same reason.
- **D3 ✅ A separate runner, not a Vitest "live" suite.** Vitest would give
  reporters and filtering for free, but seeding reads badly as a test suite,
  `expect` failures leave half-seeded state without a clear message, and it
  muddles the unit / integration taxonomy CI relies on. The runner is ~300
  lines and its own logic is unit-tested.
- **D4 ✅ Move the HTTP client core to `@sin/core/http`; inject
  `onSchemaMismatch` and add `retryOn401`.** DESIGN §3.2 already places the
  API client in `core`; the code just had not caught up. Cross-package import
  from `apps/web` would work but inverts the dependency direction (`api`
  depending on `web`). The `reportError` import is the only non-portable line
  and becomes a callback the SPA wires to its existing reporter. `retryOn401`
  defaults `true` so the SPA's behaviour is unchanged.
- **D5 ✅ Deep history is a later Prisma executor, not an API backdoor.** A
  dev-only header that disables the 7-day bound would be one `if` in a
  production code path guarded by env — exactly the kind of switch that ends
  up on in the wrong place. Writing rows directly through Prisma keeps the
  API honest and reuses the fixtures unchanged via the `Executor` interface.
  Spec'd separately once 05.1 and 07 exist.
- **D6 ✅ Fixtures are not unit-tested.** Their correctness *is* "the API
  accepted them"; `--dry-run` catches authoring mistakes (bad refs, unknown
  users/keys) statically, and AC13 runs them for real before merge.
- **D7 ✅ `.http` files over a Bruno/Postman collection.** Plain text, diff
  friendly, no account, supported by VS Code, JetBrains and `httpyac`. The
  runner is the asserting tool; these are for poking.

### Open

- **O1** Whether `finished-week` should also create a second user (`bob`)
  with overlapping data, to make ownership bugs visible in the UI early. Cheap
  to add; decide when Spec 06 starts.
- **O2** Whether to publish the `--dry-run` output of each scenario into the
  PR description as documentation, or leave that to the fixture source.
