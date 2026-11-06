# Spec 16 — Load testing (k6, simulated lifters against local, staging and prod)

**Status:** Phase A implemented on `feat/spec-16a-load-test-tool` (2026-11-06; build notes at the end of §12). Phase B not started. Draft v0.1 (2026-11-05). Owner-approved design: `docs/superpowers/specs/2026-11-05-load-testing-design.md` (approved by Carol 2026-11-05; a gitignored working file, so this spec carries everything a builder needs). Every "(my call)" item in that design was accepted by the owner and is recorded as a ✅ decision in §12. Replaces the 2026-09-26 draft of this number ("Dev scenario tooling"), which is dropped (§1).
**Last updated:** 2026-11-05
**Kind:** dev tooling + ops (a workspace package, a dashboard, a runbook; no API change and no migration)
**Depends on:** **Spec 13.3** (CPU and DB-connection metrics, deployed to staging first; a hard dependency, §3), Spec 13.0 (the telemetry layer, `ops/grafana/`, the local stack, the Grafana Cloud stack), Spec 15 (the production target, its limits and its Auth0 sharing), Spec 05.2 (rate limits that the run must respect), Spec 02 (`@sin/core` Zod schemas the payload tests check against), Spec 01 (`dev-idp` for the local target).
**Consumed by:** nothing. The runbook it produces is read by the owner before pre-launch at the gym.
**Design refs:** DESIGN.md §8.1 (observability), §3.3 (environments), §7 (CD / Secrets). Spec 05.2 §6 (`RATE_LIMITS`: 600 requests/minute/IP, write groups, in-flight cap 4), Spec 15 §12 D7 and AC30 (one Auth0 tenant shared by staging and prod). CLAUDE.md "Infrastructure", "Rate limits".

---

## 1. Purpose, scope & non-goals

100 people at the owner's gym are about to start using the app. The question this spec answers, in one sentence per run:

> **"Staging handles N lifters mid-workout at the same time before X goes wrong."**

so the hosting limits are known before they are discovered by real lifters. The same tests run against Render staging now and against production (Cloud Run + Neon free) once it is live, so the two answers can be compared.

*(The 2026-09-26 draft of this spec — a scenario runner replaying typed fixtures, a `.http` request collection, and moving the React-free API client into `@sin/core/http` — is **dropped from this work** (owner, 2026-11-05). It is not rejected on merit and may return as its own spec under a later number.)*

> **First-principles note — "what k6 is".** k6 is Grafana's load-testing tool: a single program (installed with Homebrew) that runs a script of JavaScript or TypeScript, many copies of it at once. Each copy is a *virtual user* (VU) that makes HTTP requests and sleeps, like one person using the app. k6 times every request, checks thresholds you write ("p95 must stay under 2000 ms"), prints a summary, and can push its metrics to a Prometheus-compatible store. The scripts do not run in Node: k6 has its own small runtime, so a k6 script can import plain TypeScript modules (pure functions) but not Node libraries. That is why the logic worth testing lives in plain modules and the k6 entry files stay thin (D4).

> **First-principles note — "p95, and why an average would lie".** p95 is the response time that 95 of every 100 requests beat. If a set save takes 200 ms for 94 lifters and 6 seconds for six, the average (about 550 ms) looks fine while one save in twenty feels broken. The owner's tolerance is a set save slower than about 2 seconds, so the threshold is on p95, never the mean (§6.1).

> **First-principles note — "one IP address, and why it matters here".** The API limits each IP address to 600 requests a minute (`RATE_LIMITS.ip`). At a gym every phone shares the gym Wi-Fi, so they all arrive from **one** IP. A load test run from the owner's laptop is the same shape on purpose: if that one IP becomes the binding limit, that is a true finding for a one-gym app, not a test artifact.

### In scope

- A new workspace package **`tools/loadtest`** (`@sin/loadtest`): plain TypeScript modules (session builder, think-time schedule, payload builders, thresholds, step/ramp generators, result reporter, target and env config, token fetcher, cleanup, annotation client), their Vitest tests, and thin k6 entry scripts.
- Three **targets**: `local` (local API + `dev-idp` tokens + the local observability stack), `staging`, `prod`.
- Three **run types**: **gym** (stepped ramp of real-pace lifters), **push** (shortened rests), **burst** (many lifters open the app within about a minute).
- Auth0 **test accounts** (about 150) in their own database connection and a separate load-test application, a setup script that creates/validates the accounts, paced token fetching with the password-realm grant.
- A one-routine seed per account; **cleanup** of every workout the accounts created after each run (and on demand).
- k6 metrics to Grafana Cloud (staging/prod) or the local Prometheus (local), a **run annotation**, and a new **"Load test" dashboard** `ops/grafana/dashboards/load-test.json`.
- The runbook **`docs/runbooks/load-testing.md`** as a **deliverable of this spec's Phase B** (not written by this drafting step).
- CLAUDE.md command lines for the new scripts; `.gitignore` for the secrets file.

### Non-goals

- A CI job, or a run on every merge. The owner runs it by hand.
- Multi-IP or hosted load generation (Grafana Cloud k6 load zones and the like).
- Seeded months of history per lifter: every run starts with empty history (§9). A "seasoned history" seed is a possible follow-up.
- Load testing the web front end (static hosting) or Auth0 itself.
- **Any change to the API's rate limits, auth or request handling to make testing easier.** The only API change associated with this work is Spec 13.3's two metric families, which every environment gets. No second token issuer, no bypass header, no load-test mode (anti-goal below).
- Production telemetry (Spec 15 set none). A prod run still yields N and X from k6's side, but the "what broke" view needs prod telemetry, separate work.
- The BL-28 allow-list (production open to anyone); this spec only notes its interaction (§9).

### Anti-goals (a failure even if the run "works")

- **A test-only way into the API.** Simulated lifters sign in exactly like real ones: Auth0 access tokens, verified by the same code.
- **Hurting real lifters on prod.** Prod runs are short, at a quiet hour, and must not spend Neon's free monthly compute allowance or push Cloud Run beyond its free tier.
- **Leaving junk behind.** After a run the test accounts hold no workouts; real users' data is never touched.
- **A misleading number.** N is not inflated by cold starts (warm-up is excluded), by an average that hides slow saves (p95), or by a time-compressed run reported as if it were real pace (push runs are labeled "equivalent lifters").

### Fit for one work session

Too large for one: it ships in **two phases / two PRs** (the repo's usual pattern):

- **Phase A — the tool, proven locally.** The package, all pure logic with tests, the k6 scripts, the `local` target, cleanup, thresholds and reporting. Needs no Auth0, no Grafana Cloud, and no Spec 13.3. Done = a gym run, a burst and a push run work end to end against the local API, and the accounts end clean (AC1–AC17).
- **Phase B — the real targets.** Auth0 accounts and tokens, the `staging` / `prod` targets and their guards, Grafana Cloud output and the annotation, the "Load test" dashboard, the runbook, and the first recorded staging runs. **Waits for Spec 13.3 deployed to staging** (AC18–AC30).

## 2. Acceptance criteria

"Behavioral" criteria get at least one test naming their number (`describe("AC7 — …")`) in `tools/loadtest/test/` (Vitest, no k6, no network unless stated). *(integration)* criteria run against a locally started API (`dev-idp`, Testcontainers Postgres) and need k6 installed; they are dev-tool checks, not CI (like the `bench:*` scripts). *(manual)* criteria are verified by hand and recorded in the PR or the runbook; *(CI)* are enforced by existing jobs.

### Phase A

1. **The package exists and is gated by the existing checks.** `tools/loadtest` is a workspace package (`@sin/loadtest`; `pnpm-workspace.yaml` gains `tools/*`); `pnpm run lint` and `pnpm run typecheck` cover it; none of CI needs k6 installed. *(CI)*
2. **A simulated session is a real session.** The session builder, given a seed and a routine, returns an ordered plan: the "open the app" reads, start a workout from its routine, for each planned working set a log-set step followed by a rest, finish, then History and Progress reads. The same seed gives the same plan; different seeds differ in their rest lengths.
3. **Rests are at a real gym pace.** In real-pace mode each rest is drawn from the 1½–3 minute range (90–180 s). In push mode every rest is divided by the push factor (×2, ×4, …); the factor is recorded on the plan.
4. **Every generated request body is valid.** For each request kind the session builder can emit (start workout from routine, create set, finish workout, create/replace routine), a test validates 1,000 generated bodies against the corresponding `@sin/core` Zod schema; a deliberately corrupted body is rejected by the same check (so the test proves it can fail).
5. **The seeded routine is representative.** It has 5–6 exercises with 3–4 working sets each, mostly weight-and-reps, exactly one superset, and a real-pace duration of roughly 45–60 minutes (sum of mean rests plus per-set time); it passes the routine schema; every exercise is a key in the seeded catalog (`apps/api/prisma/catalog/exercises.json`).
6. **The target decides the base URL and the token source and nothing else.** `local`, `staging` and `prod` resolve to a base URL and a token source (`dev-idp` or Auth0); an unknown target fails fast with the list of valid ones; nothing else about the scripts' behavior differs by target except the guards of AC27.
7. **Thresholds express X directly and are generated in one place.** `thresholds.ts` is the only source: set-save p95 < 2000 ms, 5xx rate < 1%, and zero `429` responses, each scoped to the step tag so every step is judged on its own. A test asserts the exact k6 threshold strings.
8. **N is reported as the owner's sentence.** Given per-step results, the reporter returns N as the highest step where all three thresholds hold, and prints "`<target>` handles N lifters mid-workout at the same time before X goes wrong", where X names the first threshold that failed at the next step (or "nothing failed up to the largest step tried"). If a lower step failed and a higher one passed the report says so ("non-monotonic") rather than hiding it.
9. **Push results are never plain N.** A push-mode result is printed and stored as "equivalent lifters at ×F pace", and the reporter refuses to render it with the gym-run sentence.
10. **Warm-up is excluded.** Before the first measured step the run wakes the target (polls `GET /healthz` until it answers `200`, bounded) and sends warm-up requests tagged `phase=warmup`; those requests are outside every threshold and every reported figure. A test over the tag logic proves a slow warm-up request cannot fail a step.
11. **Tags are bounded.** Every request is tagged with the route **template** (`name`), the `step`, `phase` and `target` — never a URL containing an id. A test pushes requests with real UUIDs in their paths through the tagging wrapper and asserts the tag values are the templates; the set of tag keys is fixed and tested.
12. **The ramp is long enough to mean something.** The gym-run stage generator, for 10 → 150 lifters, yields steps whose hold time is at least the time for expected set saves in the step to reach `MIN_SAVES_PER_STEP` (a constant chosen by the builder so p95 is meaningful) **and** long enough for finishes to land inside the step. A test computes the expected counts from the plan and asserts both; total duration is allowed to exceed 30 minutes.
13. **Every step carries the full mix.** Lifters join a session at a random point (not at its start), so each step contains set saves, finishes, History and Progress reads. A test over a generated step's lifter offsets shows each of the four request kinds present from the first step.
14. **The burst arrives within about a minute.** For a burst of K lifters, start offsets are spread (with jitter) over about 60 seconds and all K are within the window; the step list is configurable (default 10, 20, 30, 50, 100); each burst lifter does the "open the app" reads.
15. **Cleanup leaves the accounts empty.** `cleanup` removes every workout (live or finished) of each load-test account through the API, page by page, tolerating repeats and `404`s, never touching an account not in the configured list, and leaving each account's seeded routine. Run twice, the second run is a no-op. *(integration)* against the local API: after a gym run the accounts have zero workouts.
16. **Cleanup runs even when the run does not finish.** The run's teardown calls cleanup on normal exit, threshold failure and abort (`Ctrl-C`/error); `cleanup` is also a standalone command that works with no run in progress.
17. **The local target works end to end.** *(integration)* With the local API, `dev-idp`, Postgres and the local observability stack up, a small gym run (3 lifters), a small push run and a small burst each complete, produce a result file and the AC8 sentence, and end with AC15 satisfied.

### Phase B

18. **Test accounts are isolated in Auth0.** About 150 test users live in a dedicated Auth0 database connection that is enabled **only** for the load-test application; the connection is not enabled for the SPA application, and the load-test application has no other connection. *(manual, recorded in the runbook)*: signing in as a test user through the real SPA fails; a real user's password through the load-test application's token request fails.
19. **The setup script is idempotent and safe.** `setup-accounts` creates accounts that are missing (email, `email_verified: true`, the shared password), skips existing ones, never edits or deletes any user outside the load-test connection, supports `--dry-run`, and refuses to run without its Management API credentials. Unit-tested with a fake Management client. *(manual)* once against the tenant.
20. **Test-account tokens look exactly like real ones.** One fetched access token, decoded, carries the audience, the issuer and the namespaced `email` and `email_verified` claims the API's verifier requires (the post-login Action runs for these accounts). *(manual, recorded in the runbook)*; the API accepts it on `GET /v1/me`.
21. **Token fetching is paced and polite.** Tokens are fetched once at run start through the password-realm grant, at a configurable maximum rate (default chosen by the builder to stay well under Auth0's per-IP limits), with bounded retry and backoff on `429` and `5xx`, and a clear abort naming the account index (never the password) after repeated failures. Unit-tested with a fake `fetch` and fake clock: the pacing, the backoff and the abort.
22. **Secrets stay local and out of output.** All secrets (Auth0 Management API credentials, the load-test application's client id/secret, the test accounts' password, the Grafana Cloud metrics-write token, the Grafana annotation token) are read from a gitignored env file in `tools/loadtest/`; `.gitignore` covers it (a test fails if it does not) and an `.env.example` lists the variable names with no values; a missing variable fails fast naming the variable, never a value. A redaction test asserts that no secret value appears in logs, the result file or error messages produced from a run with fake secrets; tokens and passwords are never written to disk.
23. **Seeding is idempotent.** On first use each account receives its one seeded routine (found by a fixed name, created if absent) through the API; later runs reuse it. Accounts persist between runs (no recreation).
24. **Metrics reach Grafana without blowing the series budget.** k6 sends its metrics to Grafana Cloud's Prometheus endpoint (staging/prod) or the local Prometheus (local) using only the AC11 tags; the number of active series one run adds is recorded and is below the budget the runbook states for the free tier. *(manual)*
25. **Each run leaves an annotation.** At run start and end the tool posts a Grafana annotation covering the run's time window, tagged `loadtest`, with the target and run type (and N on a gym run); a failed annotation call logs a warning and never fails the run. Unit-tested with a fake `fetch`; *(manual)* visible on `api-overview` and `usage`.
26. **The "Load test" dashboard exists and is correct.** `ops/grafana/dashboards/load-test.json` shows, on one time axis: simulated lifters, requests/s, set-save p95 against a 2 s line, error and `429` counts, and next to them the server's own health from `api-overview` (latency, 5xx, event-loop delay, heap) and Spec 13.3's CPU and DB-pool panels. The existing `ops-grafana` unit test is extended so k6's metric names are allowed **only** for this file and every other query still must use `METRIC_NAMES`; the file parses. *(manual)* every panel is populated after a local run and after the first staging run.
27. **Prod has guards.** The `prod` target refuses to start without an explicit confirmation flag, refuses a push run unless a second explicit flag is also given, and refuses any plan whose estimated request count (printed by `--dry-run`, which every target supports) exceeds `PROD_MAX_REQUESTS`. Unit-tested.
28. **The runbook exists and is complete** *(manual, reviewed)*: `docs/runbooks/load-testing.md` covers Auth0 setup (connection, application, grant, attack-protection settings to check), the env file, installing k6, running each run type per target, picking a quiet hour on prod, the free-tier allowances with numbers and the pre-run check against them, reading the result and the dashboard, reading the usage panels around the annotation, cleanup, retiring the accounts (`account:purge`), and the BL-28 allow-list interaction.
29. **First staging results are recorded** *(manual)*. With Spec 13.3 deployed to staging: one gym run and one burst on staging complete; the AC8 sentence for each, its X, and the Grafana panels showing what was busy when it failed (CPU, pool, event loop) are recorded in the runbook. A push run follows if the gym run passed.
30. **Docs and commands** *(manual, reviewed)*. CLAUDE.md "Commands" lists the `@sin/loadtest` scripts; the roadmap row moves to Implemented.

## 3. Dependencies & exposed interface

### Needs

- **Spec 13.3 deployed to staging** before AC29 and before any run whose "what broke" view matters. Phase A does not need it (the local stack can show the new panels once 13.3 is merged, but the local runs only prove the tool).
- Specs 13.0 (stack, `ops/grafana/`), 15 (prod), 05.2 (limits), 02 (schemas), 01 (`dev-idp`, `/v1/me`).
- **Installed locally by the owner:** k6 via Homebrew (`brew install k6`; Phase A was built and run with k6 2.3.0); it runs TypeScript scripts natively. Not installed in CI. New `devDependencies` in `tools/loadtest`: `@types/k6` (types only), `zod` (already used by `@sin/core`), `vitest`; `@sin/core` as a workspace dependency (types and schemas only; the k6 runtime cannot import Node-only code, so the k6 entry scripts bundle through k6's own TS support and import only pure modules).
- A Grafana Cloud stack (exists since 2026-11-05, region `prod-us-east-2`), a **metrics-write token** for k6 and a **service-account token with annotation-write** (D12), both created by the owner.
- An Auth0 Management API machine-to-machine application (setup only) and the load-test application (D5).

### Provides — stable surface

- Commands (names are the builder's; the shape is fixed): `loadtest setup-accounts`, `loadtest seed`, `loadtest run <gym|push|burst> --target <local|staging|prod> [--dry-run]`, `loadtest cleanup --target …`, wired as `pnpm --filter @sin/loadtest run …`.
- A **result file** (`tools/loadtest/results/<timestamp>-<target>-<type>.json`, gitignored): target, API commit from `/healthz`, run type and push factor, the steps with their per-threshold values and pass/fail, N, X, and the time window.
- The "Load test" dashboard and the annotation convention (`loadtest` tag) that the runbook tells the reader to look for next to the usage panels.
- Nothing is imported by `apps/*` or `packages/*`; the dependency points only from the tool to `@sin/core`.

## 4. Data model

No tables, no migration, no code in `apps/api`. The tool creates **ordinary rows through the public API**: one `user` row per test account (provisioned on its first authenticated request, like any user), one seeded routine each, and workouts that cleanup deletes. On prod these are real rows in the production database; 150 users, 150 routines and transient workouts are well inside Neon's free storage, and the accounts can be retired with `account:purge` (CLAUDE.md; Spec 11).

## 5. Screens & flows

Not a UI spec; there are no screens. The user-facing flow is the command line (§6.2) and one Grafana dashboard (§6.9).

## 6. Behavior & logic

### 6.1 What "going wrong" (X) means

The owner's tolerance is a set save slower than about 2 seconds, made measurable (D1):

| Check | Passes when |
|---|---|
| Slow | p95 of **set-save** requests (`POST /v1/workout-exercises/{id}/sets`), measured at the client as round trip to the response, ≤ 2,000 ms |
| Server errors | 5xx responses ≤ 1% of requests in the step |
| Rate limit | **zero** `429` responses in the step (a rate limit a real gym would also hit) |

N is the highest step where all three hold (D1, AC8). The app's offline outbox (Spec 06.2) can hide a slow save from the lifter's screen; the tool still measures the server round trip, because that is the capacity question.

### 6.2 The simulated lifter

One VU is one lifter doing a whole session at the target pace (D2):

```
open the app   -> the reads the SPA makes at start-up (e.g. /v1/me, catalog sync, routines, active workout, personal records)
start workout  -> POST /v1/workouts { routineId }  (the seeded routine)
for each working set:  POST .../sets   then  rest 90-180 s (push mode: divided by F)
finish         -> PATCH /v1/workouts/{id}  (endedAt)
look           -> GET History list, GET a progress series
repeat         (until the step ends)
```

Which reads count as "open the app" is the builder's (§10), taken from what the SPA actually requests at start-up (the web client in `apps/web/src/api`). Each request sends a normal bearer token and the `X-Request-Id` convention; bodies come from the payload builders (AC4). A rate-limited or failed request is recorded in the thresholds; the tool never retries to hide it. Lifters never share an account: VU *i* uses test account *i*, so per-user write limits and the one-active-workout rule behave as in real life.

### 6.3 Run types

| Type | Shape | Reported as |
|---|---|---|
| **Gym** | Stepped ramp, about 10 → 150 lifters, holding at each step long enough for a meaningful p95 and for finishes to land (AC12). Lifters join part-way through a session so every step carries the full mix (AC13). Expect it to exceed 30 minutes (D3). | N: "handles N lifters mid-workout…" |
| **Push** | Only if the gym run passed (D9): rests divided by ×2, ×4, … until X fails | "equivalent lifters at ×F pace", never plain N (AC9) |
| **Burst** | K lifters open the app within about one minute (the end of a class), stepped (default 10, 20, 30, 50, 100) to find the largest K inside X (D3) | largest K inside X |

Prod runs are the gym run and the burst only; a push run on prod needs two explicit flags (AC27, D6).

### 6.4 Targets (D4)

| Target | Base URL | Token source | Metrics go to |
|---|---|---|---|
| `local` | `http://localhost:8080` | `dev-idp` `GET /token?sub=…&email=…` on `:9999` (loopback) | local Prometheus (remote-write receiver enabled in `docker-compose.observability.yml`, see §11) |
| `staging` | `https://si-api-ft2f.onrender.com` | Auth0 password-realm grant, tenant `dev-gncuqvfir0wv0t4l`, audience `https://api.strengthinnumbers.app` | Grafana Cloud |
| `prod` | the production API origin from `infra/prod.tfvars` (one source of production identifiers) | the same Auth0 grant | Grafana Cloud |

The target picks the base URL and the token source and nothing else (AC6). Every run starts with the warm-up and cold-start exclusion (AC10): staging on Render free sleeps after about 15 minutes idle, and prod on Cloud Run scales to zero.

### 6.5 Auth0 isolation and tokens (D5)

The test accounts live in their **own Auth0 database connection**, enabled only for a dedicated **load-test application** (grant type: password, enabled just for it). Result: they cannot sign in to the real SPA, and real users cannot use the password grant, because no real user exists on that connection. Tokens come from the **password-realm grant** (`grant_type=http://auth0.com/oauth/grant-type/password-realm`, `realm=<connection name>`) against the shared tenant, are fetched once at the start of a run (AC21) and held in memory only. The tenant is shared by staging and prod (Spec 15 D7), so the same accounts and tokens work against both targets. The post-login Action that adds the namespaced `email` / `email_verified` claims applies to them (AC20), so the API provisions their `user` rows by the ordinary path.

### 6.6 Cleanup and persistence (D7)

Accounts persist between runs; each keeps one seeded routine (AC23). After a run (and on demand), cleanup deletes every workout the accounts hold (AC15, AC16) via `GET /v1/workouts` pages and `DELETE /v1/workouts/{id}` (the active one via `GET /v1/workouts/active`). Cleanup uses the same API a lifter does and so respects its rate limits; at 150 accounts it paces itself and reports how many workouts it removed.

### 6.7 Secrets (D8)

All in a gitignored env file in `tools/loadtest/` (AC22); variable names are the builder's (§10). Never in the repo, CI, logs, result files or Render/GCP config.

### 6.8 Test traffic counts as usage (D10)

Runs increment `sin_workouts_started`, `sin_workouts_finished` and `sin_sets_logged` and write the usual log lines, and deleting the workouts does not undo counters already sent. Marking test accounts would need a load-test mode in the API (an anti-goal), so each run adds an annotation for its time window (AC25) and the runbook tells the reader to read the usage panels around it. This matters most on prod once prod telemetry exists.

### 6.9 Grafana Cloud and the dashboard (D11)

k6 pushes through its Prometheus remote-write output. Series are tagged by route template and step, never by URL with ids, to stay inside the free tier's series limits (AC11, AC24). The "Load test" dashboard sits beside `api-overview` and `usage` in `ops/grafana/dashboards/`, uses the same `${datasource}` variable, and reuses the Spec 13.3 queries. Panel layout is the builder's.

### 6.10 The seeded routine (D13)

A representative strength session: 5–6 exercises, 3–4 working sets each, mostly weight-and-reps, one superset, about 45–60 minutes at real pace (AC5). The owner can swap in her own routine text later through the app's routine-from-text reader; the tool then seeds from a JSON routine file instead of the built-in one (an extension point, not built here).

### 6.11 Reading the result

The run prints the AC8 sentence and a per-step table (lifters, set-save p95, 5xx %, 429 count, pass/fail), writes the result file, and the annotation marks the window. The runbook describes the next step: open the dashboard at that window and read, for the first failing step, which of CPU, the DB pool, event-loop delay or the network (nothing busy) moved. That reading is the "first thing that breaks".

## 7. Security & privacy

- **No weakening of the API.** Nothing in `apps/api` is added or relaxed for this; the load runs hit the same auth, rate limits and validation as any client (anti-goal 1). The tool is the only new code path, and it is a client.
- **Credentials.** Test-account passwords, the Management API client secret and the Grafana tokens are secrets. They live only in the gitignored env file; a redaction test covers logs, result files and errors (AC22); tokens are held in memory and never written to disk. The Management credentials are used only by `setup-accounts`; the load runs need only the load-test application's client credentials and the shared test password.
- **Blast radius.** The load-test connection contains only throwaway users; the connection is enabled for one application (AC18), so a leak of the shared password lets someone obtain tokens for test accounts, which can only create and read empty test data on the staging and prod APIs. This is an accepted exposure, called out in the runbook; rotate the password after sharing the file anywhere. The Grafana metrics-write token can only write metrics; the annotation token is scoped to annotations.
- **Real users untouched.** The tool never lists or acts on any account that is not in its configured list (AC15, AC19). It never reads real users' data.
- **Personal data.** The test accounts use a placeholder email domain the owner controls or a reserved one (builder's choice, §10); no real person's email is stored. Training data in these accounts is synthetic.
- **Third parties.** Metrics sent to Grafana Cloud are request counts, timings and tag values drawn from route templates; no user data (AC11).
- **Auth0 abuse protection.** Roughly 150 password logins from one IP may trigger Auth0's brute-force and suspicious-IP protection. Pacing (AC21) and the runbook's settings checklist address this; the tool does not try to evade protection.
- **Prod courtesy.** Guards (AC27) keep a prod run short and deliberate; nothing here lets a CI job or a merge run a load test.

## 8. Config & secrets

All tool configuration is in `tools/loadtest/` and the env file; no environment variable of the API changes.

| Item | Where | Notes |
|---|---|---|
| Target, run type, step lists, push factor | command-line flags with defaults in a config module | defaults for the stepped lists: gym 10 → 150; burst 10, 20, 30, 50, 100 |
| Auth0 tenant domain, audience, load-test application client id/secret, connection name, test-account password, email domain | env file | secrets: client secret, password |
| Auth0 Management API client id/secret | env file | `setup-accounts` only |
| Grafana Cloud remote-write URL, user, **metrics-write token** | env file | secret |
| Grafana URL and **annotation service-account token** | env file | secret (D12) |
| `PROD_MAX_REQUESTS`, `MIN_SAVES_PER_STEP` | constants in the config module | builder's values (§10) |

`.gitignore` already ignores `.env.*` except `.env.example`, so an env file named `.env.loadtest` is covered; AC22's test pins this. Names of the variables are the builder's.

## 9. Observability

The tool is a client of the observability layer, not a producer of API signals.

- **What the owner sees during a run:** the "Load test" dashboard (AC26) puts k6's load next to the server's health: request latency, 5xx, event-loop delay, heap (Spec 13.0) and **CPU use and DB-pool usage** (Spec 13.3), so the breaking point has a cause (design G2).
- **Annotations** (AC25) mark each run on `api-overview`, `usage` and the new dashboard.
- **Known limits** (design §9):
  - Prod has no server telemetry yet (Spec 15 sets no `OTEL_*`): a prod run yields N and X from k6's side only until prod telemetry exists.
  - **Render sleeps** after about 15 minutes idle; the warm-up handles it; gaps in Grafana during idle are expected (Spec 13.0 §6.8).
  - **Pool gauges are one sample per export interval** (60 s on staging; Spec 13.3 D5): hold each step for several intervals and read the wait-time counters for spikes. This is why AC12 says "long enough to mean something".
  - **Test traffic counts as usage** (§6.8).
  - **Free-tier allowances** — Neon compute hours on both projects, Cloud Run requests and vCPU-seconds, Grafana Cloud series — must be checked against a run's expected usage before the first prod run; the runbook states the numbers (AC28) and `--dry-run` prints the estimated request count (AC27).
  - **Empty history** makes reads cheaper than a real gym after six months. Accepted for v1.

## 10. Testing

| AC | Level | How |
|---|---|---|
| 1 | CI | `pnpm run lint` / `typecheck` include the package; CI has no k6 |
| 2, 3 | unit | seeded property tests over the session builder and the rest schedule |
| 4 | unit | 1,000 generated bodies per kind through the `@sin/core` schemas; a corrupted body must fail the same check |
| 5 | unit | structure/duration assertions on the routine; catalog keys read from `apps/api/prisma/catalog/exercises.json` |
| 6 | unit | table test over target resolution |
| 7 | unit | exact threshold strings |
| 8, 9 | unit | reporter over fixture step results (monotonic, non-monotonic, all pass, first-step fail, push) |
| 10, 11 | unit | tag/phase logic with request fixtures containing UUID paths |
| 12–14 | unit | stage/arrival generators over plan fixtures |
| 15, 16 | unit + integration | unit with a fake API client (paging, `404`, idempotence, account allow-list); integration against the local API |
| 17 | integration | the three small local runs; dev tool, not CI |
| 18 | manual | the two sign-in attempts, recorded in the runbook |
| 19 | unit + manual | fake Management client; one real run against the tenant |
| 20 | manual | decode one token; `GET /v1/me` succeeds |
| 21 | unit | fake `fetch` and fake clock |
| 22 | unit | `.gitignore` check, missing-variable errors, redaction over a run with fake secrets |
| 23 | unit + integration | seed twice, one routine |
| 24 | manual | series count recorded from the Grafana Cloud usage view |
| 25 | unit + manual | fake `fetch`; visible on the dashboards |
| 26 | unit + manual | `ops-grafana` test extended; populated panels recorded |
| 27 | unit | guard tests, `--dry-run` request estimate |
| 28 | manual | runbook review |
| 29 | manual | recorded runs |
| 30 | manual | doc review |

What stays the **builder's** (design §10): exact k6 stage lengths and step sizes beyond the defaults above, how per-step pass/fail is shown, which SPA start-up reads are "open the app", token-fetch pacing, dashboard panels and layout, env-file variable names, how the package is wired into workspace scripts, and the values of `MIN_SAVES_PER_STEP` and `PROD_MAX_REQUESTS`.

`describe.skipIf` guard note (CLAUDE.md): integration tests guard their setup (containers, server start) as well as their `describe`.

## 11. Deployment & rollback

Nothing deploys: it is a dev tool, a dashboard and a runbook.

- **Phase A** merges with no external setup. Because the local target needs the local Prometheus to accept k6's remote-write, Phase A also adds `--web.enable-remote-write-receiver` to the `prometheus` service `command` in `docker-compose.observability.yml` (the image pin is untouched, so the `image-pins` test is unaffected). This is the one edit to a Spec 13.0 file; Spec 16 owns it.
- **Phase B** needs the owner: install k6, create the Auth0 connection and load-test application, the Management application, the Grafana tokens, fill the env file, run `setup-accounts`, import `load-test.json` into Grafana Cloud by hand (as with the other dashboards, Spec 13.0 D8), and read the runbook's free-tier section before any prod run.
- **Order:** merge Spec 13.3 and confirm its staging check (13.3 AC16), then Phase B's first runs (AC29).
- **Rollback:** revert the PR; remove the Auth0 connection, application and users by hand (the runbook lists it); `account:purge` can retire the provisioned `user` rows on staging and prod. Nothing in the API or its data changes shape.

### DESIGN.md / doc edits (same PRs)

- Phase A: roadmap row 16 (done in this draft); CLAUDE.md "Commands" and "Layout" gain `tools/loadtest`; `.gitignore` covers the results directory.
- Phase B: DESIGN.md §8.1 gains one sentence (load testing exists; runbook); runbook `docs/runbooks/load-testing.md`.

## 12. Decisions & open questions

### Resolved

D1–D8, D10, D11, D13 and D14 are from the owner-approved design of 2026-11-05; its "(my call)" items were accepted by the owner that day. D15 and the list after this one are this spec's own.

- **D1 ✅ X is made measurable as: set-save p95 ≤ 2,000 ms, 5xx ≤ 1%, zero `429`; N is the highest step where all three hold.** The owner's tolerance is "a set save longer than about 2 seconds"; p95 is the measurable form (one save in twenty slower than 2 s), measured at the client as round trip. An average would hide slow saves (anti-goal 4). Any `429` fails because a rate limit a real gym would also hit is a finding, not noise. Changeable by the owner.
- **D2 ✅ A simulated lifter does a real session at real pace.** Open the app, start from the routine, log sets with 1½–3 minute rests, finish, look at History and Progress, repeat. Rejected: hammering single endpoints (measures routes, not a gym); time-compressed runs as the headline (push runs exist for that and are labeled separately).
- **D3 ✅ Three run types from one laptop.** Gym (stepped ramp ~10 → 150, long enough for a meaningful p95 and for finishes to land, lifters joining part-way so every step has the full mix; expect more than 30 minutes), push (rests shortened ×2, ×4, … only after a passing gym run, reported as equivalent lifters), burst (K lifters within about a minute, stepped 10, 20, 30, 50, 100). One IP is deliberate (design G4): the shared gym Wi-Fi. Rejected: multi-IP / hosted load zones (non-goal; if the per-IP limit binds, that is the answer for a one-gym app).
- **D4 ✅ Tool and code home: k6 with TypeScript, in a new workspace package `tools/loadtest` (`@sin/loadtest`), logic in plain modules.** k6 1.x runs TS natively and expresses thresholds directly; the session builder, schedule, payload builders, thresholds and reporter are plain TS unit-tested with Vitest, and a test checks every generated request body against the `@sin/core` Zod schemas so the scripts cannot drift from the API (AC4). Covered by the repo's lint and typecheck; k6 is not needed for those. Targets: `local` (local API + `dev-idp` + the local Grafana stack, so scripts are built without spending free-tier allowances), `staging`, `prod`.
- **D5 ✅ Sign-in uses real Auth0 test accounts in their own database connection, via the password-realm grant.** About 150 accounts in the existing tenant (shared by staging and prod, Spec 15), a separate load-test application fetching their tokens, the connection enabled only for that application so test users cannot sign in to the real SPA and real users cannot use the password grant (AC18). Rejected: a second token issuer, a bypass header or a load-test mode in the API (anti-goal 1: they would test something other than what real lifters hit).
- **D6 ✅ Prod runs are the gym run and the burst only, short, at a quiet hour; no push run unless the owner asks.** Anti-goal 2 (do not hurt real lifters or spend free allowances). The mechanism that gives this teeth (AC27's flags and cap) is new in this spec, see the next list.
- **D7 ✅ Accounts persist between runs; each keeps one seeded routine; only workouts are deleted.** Re-creating 150 Auth0 users per run is slow and rate-limited; the routine is seeded once; cleanup runs at the end of every run (AC15, AC16). Real users' data is never touched.
- **D8 ✅ Secrets live in a gitignored local env file in `tools/loadtest/`, never in the repo or CI.** This is a hand-run tool; there is no pipeline to provide them. Redaction is tested (AC22).
- **D10 ✅ Test traffic counts as usage; mitigation is an annotation per run, not a test mode.** Runs increment the business counters and write the usual logs; deleting workouts does not undo counters. Marking test accounts would need a load-test mode (anti-goal), so each run adds a Grafana annotation and the runbook says to read the usage panels around it (AC25). Matters most on prod once it has telemetry.
- **D11 ✅ Grafana Cloud with bounded tags, plus a third dashboard.** k6 metrics tagged by route template and step, never by URL with ids, for the free tier's series limits (AC11, AC24). "Load test" sits next to `api-overview` and `usage` in `ops/grafana/dashboards/` (AC26).
- **D13 ✅ The seeded routine** is a representative strength session (AC5); the owner can swap in her own via the routine-from-text reader later.
- **D14 ✅ Two new API metrics (Spec 13.3) come first.** Process CPU and DB connection use, so a run shows which resource ran out; that PR is deployed to staging before the first useful load run (§3, §11). See Spec 13.3 D1–D5 for sources and rationale.
- **D15 ✅ Two phases (this spec's call).** A (tool proven locally) and B (real targets, dashboard, runbook, first runs), so the first PR can land and be exercised before Auth0 and Grafana Cloud are touched.

### Decisions this spec adds that the design did not cover (owner to confirm)

- **D9 ✅ Only a gym run that passed can be pushed, and prod has guards.** The design says push happens "if the gym run passed" and what prod runs may be; the spec enforces both: a push run requires the previous passing gym result file (or an explicit override flag), and the `prod` target needs an explicit confirmation flag, a second flag for a push run, and an estimated request count under `PROD_MAX_REQUESTS` from `--dry-run` (AC27). Easy to loosen.
- **D12 ✅ A Grafana service-account token with annotation-write is a new secret.** The design asks for a Grafana annotation per run but lists only a metrics-write token; posting an annotation needs the Grafana HTTP API and its own scoped token. Annotation failures never fail a run.
- **D16 ✅ The Auth0 connection and the load-test application are created by hand (runbook); the script creates and validates only the accounts.** The design says a setup script creates the accounts; creating the connection and application by script would need broader Management API scopes for a one-time job.
- **D17 ✅ N is the highest passing step, with a "non-monotonic" note if a lower step failed.** The design's wording ("the highest step where all three hold") is kept literally; the note stops it hiding an unreliable result (AC8).
- **D18 ✅ Local target needs the local Prometheus to accept remote-write**, a one-flag change to `docker-compose.observability.yml` (§11).

### Open

- **O1** BL-28 (production open to anyone): if it is fixed with an owner-only allow-list, the test accounts must be allowed too, or prod runs stop working. The runbook says so; the allow-list's own spec must name the test accounts.
- **O2** Whether Auth0's attack-protection settings on the shared tenant react to the paced token fetch (design §9). Found out in Phase B's first run; the runbook records the settings to check and any change made.
- **O3** The Render CPU allowance and whether cgroup throttling is exposed there are Spec 13.3's open items; they change how to read the first staging result, not how to run it.
- **O4** The scale assumptions in the design (100 lifters, 15–30 at peak, ~1–3 requests a minute each, 3–5× headroom target) are the design author's estimates, not measured; the first gym run's step range (10 → 150) comes from them. Revisit the range after the first results.

### Phase A build notes (2026-11-06)

Calls made while building Phase A; none changes an acceptance criterion.

- **Cleanup runs in the CLI's `finally`**, after the k6 child exits for any reason (Ctrl-C is forwarded to k6 and awaited), not in k6's teardown. Tokens and routine ids reach k6 through one child environment variable, `LOADTEST_LIFTERS`, never argv or disk.
- **Phase A refuses `staging` and `prod`** ("… is not wired yet (Spec 16 Phase B)"); both need Auth0 tokens.
- **A burst is judged on 5xx and 429 only.** It sends no set saves, so the set-save threshold cannot apply; its sentence reads "handles K lifters opening the app within a minute".
- **The executor reads `GET /v1/workouts/active` after a start**, as the web app does: the start response has no exercises. A `409` on start adopts the live workout.
- **Module imports use `.ts` paths** (`allowImportingTsExtensions`): k6 resolves import paths literally.
- **Dev-only flags `--steps a,b,c` and `--hold-scale s`** (local only) make short checks possible; `--no-metrics-output` turns off the default remote write to local Prometheus.
- **Run length.** With `MIN_SAVES_PER_STEP` 200 and every hold at least one mean session (about 56 minutes at real pace), the default gym run (10 → 150 lifters) takes about 344 minutes (`--dry-run`: 12,785 requests). AC12 allows more than 30 minutes; this is far more, so Phase B's staging runs should plan for it.
- **Local end-to-end (AC15, AC17), 2026-11-06:** a gym run (3 lifters, steps 1–3, holds × 0.01), a burst (3 lifters) and a push run (×2) each completed against the local API and dev-idp, wrote a result file and printed the sentence (set-save p95 17–36 ms, no 5xx, no 429). Afterward every account had zero workouts and kept its routine, and a standalone `cleanup` removed nothing. Not covered: the local observability stack (ports 9090 and 3000 were held by another project's containers, so `--no-metrics-output` was used), so D18's remote write is still unverified.
- **Fixes from the final review (2026-11-06):**
  - k6 lists every threshold submetric even with zero samples (`p(95): 0`, `passes: 0, fails: 0`). A step now counts as measured only when its `server_errors` rate has samples, and its p95 only when the set-save trend has a `count` (added to `summaryTrendStats`). A run is `complete` only when every step was measured; a run stopped part-way keeps an honest N but is `incomplete`.
  - `server_errors` also counts k6's status 0 (refused, reset or timed out). §6.1's "5xx" means "5xx or no answer".
  - The CLI's own requests (seed and cleanup) share one 200 ms spacing across all accounts (300 a minute, half the per-IP limit), and a `429` waits for `Retry-After` and retries. A failed cleanup no longer loses the result: the result file says `cleanup: "failed"` and the CLI prints the `cleanup` command to finish it.
  - A live Ctrl-C during the warm-up (SIGINT sent to the CLI only) was forwarded to k6; cleanup ran; the result read "no measured step", `status: "incomplete"`, exit 1; every account ended empty.
