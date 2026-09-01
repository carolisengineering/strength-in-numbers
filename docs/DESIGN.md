# Strength in Numbers — Design Document

**Status:** Draft v0.3 — all open questions Q1–Q9 resolved; consistency pass done
**Last updated:** 2026-08-31 (§8.2: CORS policy added, from Spec 01 review)
**Authors:** carolisengineering, + architecture review

---

## 1. Context & Goals

### 1.1 Problem

People who train with weights need a fast, reliable way to record what they did in
the gym and see whether they are progressing over time. Paper notebooks lose
history and do no math; general note apps do not understand sets, reps, or
personal records; most existing apps bury logging under coaching, social feeds,
and nutrition features the user did not ask for.

### 1.2 Goal for v1

Ship the best **workout logging and progress-tracking** experience **on the web** —
a responsive app that is genuinely usable in the gym from a phone browser, and
comfortable on a desktop for programming and review. The set-logging loop — pick
exercise, enter reps/weight, mark set done, rest, repeat — must be faster and more
pleasant than a notes app.

Native mobile apps are explicitly **out of v1 scope** but a first-class future
target: the API and the shared domain package (§3.2) are designed so a React
Native client can be added later against the same backend with no server changes.
See §3.4.

### 1.3 Success metrics

| Metric | Target |
|---|---|
| Median time to log one set (returning user, known exercise) | < 5 s |
| Workouts with all sets logged during the session (not after) | > 80% |
| D30 retention of users who logged ≥ 3 workouts in week 1 | > 40% |
| Error-free session rate (no unhandled client error) | > 99.5% |
| API p99 latency (read + write endpoints) | < 400 ms |
| Set write success rate (first attempt, excl. offline) | > 99.9% |

### 1.4 Team & context

Solo developer. Built as a **portfolio project**: alongside shipping a good app,
an explicit goal is to demonstrate and deepen Node + TypeScript experience, which
is in demand in the roles being targeted. The developer's prior backend
experience is in Go. This context informs the stack decision in §3.2 (Q1,
resolved) and Risk R6.

### 1.5 Non-goals for v1

- Guided programs, coaching, or adaptive progression.
- Social features: feed, following, sharing, challenges, leaderboards.
- Nutrition / calorie / macro tracking.
- Native mobile apps (iOS / Android / React Native). *Deferred to post-v1 as a
  nice-to-have. The architecture keeps this cheap to add later — see §3.4.*
- Native Apple Watch or Wear OS apps.
- Live wearable integration (HealthKit / Google Fit / Garmin). *We will design the
  data model so read-only import slots in later without migration — see §5.4.*
- Full offline-first operation. *v1 assumes connectivity; see §5.3 and Risk R1.*
- Installable PWA / service-worker offline caching. *Not in v1, but the web app
  will be built as an SPA that a PWA layer can wrap later without a rewrite.*

---

## 2. Product Scope (v1)

**In:**

1. **Account & profile** — sign up / sign in, units preference (kg/lb), body
   weight log (simple time series), account deletion + data export.
2. **Exercise catalog** — curated global library (name, primary/secondary muscle
   groups, equipment, modality: weight+reps / bodyweight / timed / distance) plus
   user-created custom exercises.
3. **Routines (templates)** — user builds a reusable ordered list of exercises
   with target sets/reps. Optional; you can also start an empty workout.
4. **Workout logging** — start a session (optionally from a routine), add
   exercises, log sets (reps, weight, RPE, set type: warmup/working/drop/failure),
   check them off, session notes, finish. Rest timer lands in M4 (§9).
5. **History** — chronological list of past workouts, drill into any session.
   Finished workouts are read-only in v1 (delete-whole-workout aside, §4.5).
6. **Progress** — per-exercise charts: top-set weight, estimated 1RM, total
   volume; personal-record list and PR notifications at finish.
7. **Responsive web app** — the sole v1 client. Full logging + history + progress,
   laid out to work one-handed on a phone browser in the gym and to expand on a
   desktop for planning and review.
8. **Supersets / circuits (Tier B)** — group exercises, bracketed display, one
   rest timer per group after its last exercise. Grid-style logging (no forced
   interleave). Lands in M3 alongside routines. See §4.3 and Q5.

**Explicitly deferred:** guided interleaved superset logging (Tier C — A1→B1→A2→B2
flow), editing individual sets of a finished workout, plate calculator, standalone
1RM calculators, CSV import from competitors.

---

## 3. Architecture Overview

### 3.1 Topology

```
        ┌──────────────────┐          ┌───────────────────────────┐
        │   Web app (v1)   │          │  Native mobile (post-v1)  │
        │  React SPA       │          │  React Native — same API, │
        │                  │          │  same packages/core       │
        └────────┬─────────┘          └────────────┬──────────────┘
                 │                                 │  (future)
                 └────────────────┬────────────────┘
                                  │  HTTPS / REST (JSON), OIDC bearer tokens
                         ┌────────▼─────────┐
                         │   API service    │   stateless, containerised
                         │  (single deploy) │   Node/TypeScript + Fastify
                         └───┬─────────┬────┘
                             │         │
                ┌────────────▼──┐   ┌──▼───────────┐   ┌──────────────┐
                │  PostgreSQL   │   │ Object store │   │   Auth0      │
                │  (managed)    │   │ (S3-compat): │   │   (OIDC)     │
                │               │   │ export files │   │              │
                └───────────────┘   └──────────────┘   └──────────────┘
```

### 3.2 Component choices and rationale

| Concern | Choice | Why | Alternatives considered |
|---|---|---|---|
| Web client (v1, sole client) | **React SPA** — Vite + TypeScript, client-only, deployed as static assets. Router: React Router (or TanStack Router). Data layer: TanStack Query. | Whole app is behind auth → SSR/SEO unused. Cleanest architecture (static client + typed API + shared `core`), cheapest hosting, and the knowledge + code transfer almost 1:1 to a future React Native client (§3.4). Smallest concept surface for a developer newer to frontend to learn React fundamentals cleanly. Built mobile-first responsive so a phone browser is a first-class gym client. | **Next.js** — adds a server tier and framework-specific concepts (server vs client components, SSR) that are unused behind auth and do not transfer to React Native; reserved for the marketing site (see §9 GA). **Remix / TanStack Start** — same SSR tradeoff. |
| Future mobile client (post-v1) | **React Native** (Expo) when the time comes | Reuses `packages/core` and the same REST API unchanged; closest skill transfer from React web; single codebase for iOS + Android. | Native Swift + Kotlin (2× cost); Flutter (no code-share with a React web app). Decision deferred, not made. |
| Shared code | **`packages/core`** — framework-agnostic TypeScript: DTO types, Zod schemas, API client, units + estimated-1RM + volume + PR math. **No React, no DOM, no Node-only APIs.** | One implementation of the domain rules, importable by the web app today and a React Native app later with zero changes. This purity constraint is what makes "mobile later" cheap — see §3.4. | Duplicating logic per platform (drift risk); putting logic in the API only (clients re-implement for instant feedback). |
| Backend | **Single stateless API service**, Node + TypeScript, **Fastify**, containerised. | Same language as both clients → domain math in `packages/core` is written and tested once. One toolchain for a solo developer. Fastify keeps Node fundamentals visible rather than hiding them behind framework abstractions. Also a deliberate learning/portfolio goal (§1.4). | **Go** (developer's existing language) — rejected because it forces the e1RM/PR math into a second implementation and adds a language context-switch for a solo dev. **NestJS** — more job-description keyword coverage and enforced structure, but adds DI/decorator/module concepts to learn on top of Node/TS itself; revisit only if the project sprawls. **Rails / Elixir** — no prior experience, no code-share. |
| ORM & migrations | **Prisma** | Type-safe queries, migrations in the box, widely used in target roles. Raw SQL for the progress aggregates (§4.5) where Prisma's query API gets awkward. | Kysely (lighter, less magic, no migration tooling); TypeORM (rougher DX). |
| Primary datastore | **PostgreSQL**, managed. | Data is relational (users → workouts → exercises → sets), needs transactions and aggregate queries for progress views. JSONB where schema is genuinely fluid. | DynamoDB / Mongo — aggregation and evolving query patterns are painful. |
| Object storage | **S3-compatible bucket** (Cloudflare R2 in v1) | v1 use: async data-export archives only. Reserved for post-v1 exercise images and form-check media. | Storing blobs in Postgres (don't). |
| Auth | **Auth0** (managed OIDC provider) | Health-adjacent PII; do not want to own password storage, MFA, social login, or breach surface in v1. Standards-first (OIDC / PKCE / JWKS) so the integration is transferable knowledge, and the strongest resume signal of the options (portfolio goal, §1.4). API verifies JWTs against Auth0's JWKS; a `user` row is provisioned on first login keyed by the `sub`. | **Clerk** — better React DX, faster to integrate, but more frontend lock-in and a weaker "I know OIDC" story. **Cognito** — only competitive if hosting were AWS (Q4 → not AWS). Rolling our own — wrong risk solo, on health PII. |
| Hosting (v1) | **Render** — API web service + managed Postgres (backups/PITR) + cron + static SPA site, all native primitives, described in a checked-in `render.yaml` blueprint. **Cloudflare R2** for S3-compatible object storage. | Every component maps to a native primitive; predictable low cost (~$14–21/mo, near-zero on free tier); no VPC learning curve blocking app work. `render.yaml` is itself a portfolio artifact. | **Fly.io + Tigris** (more container depth, less battle-tested managed PG); **VPS/Coolify** (trades build time for ops time); **AWS** — see phase 2. |
| Hosting (phase 2, post-M2) | **Migrate to AWS** as a deliberate, self-contained DevOps portfolio project: ECS Fargate + RDS Postgres + S3 + CloudFront + EventBridge, defined in **AWS CDK or Terraform**, deployed by a GitHub Actions pipeline. Lean setup: **no NAT Gateway** (public subnet + tight SG), **no ALB** (CloudFront → service, or API Gateway HTTP API), single-AZ RDS. | DevOps roles are a career target (§1.4); the IaC repo + CI pipeline is the artifact. The app is 12-factor / container / Postgres / S3-compatible precisely so this is a swap, not a rewrite. ~free for 6–12 months on the AWS free tier, then ~$20–30/mo. | Staying on Render (fine functionally; weaker DevOps signal). |

### 3.3 Environments

`local` (docker-compose: API + Postgres + MinIO as the S3-compatible stand-in) →
`staging` (Render, prod-like, seeded, auto-deploy from `main`) → `production`
(Render, promote by tag). Each environment has its own Render Postgres, R2 bucket,
and Auth0 tenant. The MinIO → R2 → (later) S3 progression is transparent to the
app because storage access is S3-API only.

### 3.4 Extensibility principles

v1 ships one web client, but the system is built so the likely next steps —
a native mobile app, wearable import, a social phase — are additive, not rewrites.
Concrete rules the codebase must hold to:

1. **The API is the only contract.** No client-specific endpoints, no logic that
   assumes a browser. Every client (web now, React Native later, a CLI, an
   integration) sees the same REST surface and the same OpenAPI spec.
2. **`packages/core` stays framework-free.** Pure TypeScript: types, validation,
   and domain math. It must be importable unchanged by a React Native bundle — so
   no `window`, no `fs`, no React. Enforced by a lint rule and a size/deps check
   in CI.
3. **Auth is standard OIDC.** A native app adds the platform's OIDC flow; the API
   keeps validating the same JWTs. Nothing web-specific in token handling.
4. **UI logic and view are separable in the web app.** Data fetching, caching, and
   client-side domain calls live in hooks/stores that a React Native app could
   reuse; only the presentational components are DOM-specific.
5. **Schema extension over schema change.** New capabilities add tables/columns
   (`workout.source`, a future `external_activity`, a future `follow` graph +
   per-resource visibility) rather than reshaping the v1 core. Expand-contract
   migrations only. Note: the **social phase (Q6, planned)** will also need a real
   authorization layer to replace v1's "row belongs to `user_id`" check — that is
   an accepted future cost (R8), not something v1 pre-builds.
6. **No premature abstraction.** Extensible ≠ plugin framework. We keep seams at
   the boundaries above and otherwise build the simplest thing that works for the
   web app.

---

## 4. Data Model

Core entities. `id` is UUID v7 (time-sortable) everywhere; every table carries
`created_at` and `updated_at`; user-owned rows carry `user_id`. PostgreSQL.

### 4.0 Cross-cutting conventions

- **Weights and distances are stored as the user entered them** — a value plus its
  unit — and the database *also* computes a canonical column used only for
  comparison and aggregation. The user's number is never lossily converted; the
  canonical column cannot drift because the DB owns it. See `set_entry` and §4.8.
- **Timestamps** are `timestamptz` (UTC). Anything that appears on a *calendar*
  (streaks, "this week", month view) additionally stores a `local_date DATE` and
  `tz_offset_minutes` captured at write time, so calendar queries never
  re-derive a date from UTC. See `workout`.
- **Numeric precision:** `weight NUMERIC(7,3)`, `distance NUMERIC(9,3)`,
  `reps SMALLINT`, `duration_s INT`, `rpe NUMERIC(3,1)`.
- **Deletion:** see §4.9 for the per-entity hard/soft matrix.

### 4.1 Identity & body metrics

- **user** — `id`, `auth_sub` (unique, from OIDC), `email`, `email_verified`
  (informational; from a namespaced Auth0 access-token claim — see Spec 01),
  `display_name`, `unit_preference` (`kg` | `lb` — a *display* default, not how
  data is stored), `timezone` (IANA name, e.g. `America/Chicago`), `created_at`,
  `deleted_at` (soft-delete for grace period, then hard purge job).
- **body_metric** — `user_id`, `measured_at timestamptz`, `local_date DATE`,
  `tz_offset_minutes SMALLINT`, `metric_type` (`weight` only in v1;
  `body_fat_pct`, `waist`, … reserved), `value NUMERIC`, `unit`. Same
  calendar-fields convention as `workout` (§4.0). Generalised now so future
  measurements are additive; v1 UI only ever writes `weight`. Independent of
  workouts.

### 4.2 Exercise catalog

- **exercise** — `id`, `owner_user_id` (NULL = global/curated), `name`,
  `modality` (`weight_reps` | `bodyweight_reps` | `weighted_bodyweight` |
  `duration` | `distance_duration`), `primary_muscle_id`, `secondary_muscle_ids`
  (array), `equipment_id`, `is_active`. No image in v1 (text-only picker);
  `image_key` is a reserved post-v1 addition.
- **muscle_group**, **equipment** — small reference tables driving filters.

Rules:

- **Global rows are append-only.** Their `name` / `modality` are never mutated in
  place once users can have history against them. To change the catalog you add a
  new row and set `is_active = false` on the old one (still resolvable for
  history, hidden from pickers).
- **Editing a global exercise is copy-on-write:** a user edit forks a row with
  `owner_user_id = <user>`; that user's *future* `workout_exercise`s point at the
  fork, past ones are untouched.
- A user's custom exercise is visible only to them. Custom exercises are never
  auto-merged into the global catalog (moderation cost); an internal tool can
  promote good ones later.

### 4.3 Routines (templates)

- **routine** — `user_id`, `name`, `notes`, `archived_at` (soft; keeps history of
  workouts started from it readable).
- **routine_item** — `routine_id`, `position`, `exercise_id`, `target_sets`,
  `target_reps_low`, `target_reps_high`, `target_rpe` (nullable), `rest_seconds`,
  `superset_group SMALLINT NULL` — items in the same routine sharing a non-null
  value are performed together; `position` gives order, so interleave sequence is
  derivable. Circuits (3+ exercises) are the same construct with N members. UX is
  Tier B (§2 item 8, Q5 resolved).

Starting a workout from a routine **snapshots** it: the routine's items are copied
into `workout_exercise` rows at that moment. Later edits to the routine do not
change past workouts; deleting the routine does not damage them (`workout.routine_id`
is `ON DELETE SET NULL`).

### 4.4 Workouts (performed sessions) — the hot path

- **workout** — `user_id`, `routine_id` (nullable, `ON DELETE SET NULL` — what it
  was started from), `title`, `notes`, `started_at timestamptz`,
  `ended_at timestamptz` (NULL while in progress), `local_date DATE`,
  `tz_offset_minutes SMALLINT`, `client_generated_id UUID` (client-supplied,
  unique per user — **idempotency key**, §6), `source` (`manual` in v1;
  `healthkit` / `google_fit` / … reserved for §5.4).
- **workout_exercise** — `workout_id`, `position`, `exercise_id`,
  `exercise_name_snapshot`, `modality_snapshot`, `notes`, `superset_group`
  (nullable). The snapshots make a past session render correctly forever,
  independent of later catalog changes or a deleted custom exercise.
- **set_entry** — `workout_exercise_id`, `set_number`, `set_type`
  (`warmup` | `working` | `drop` | `failure`). Nullable measure columns:
  `reps`, `weight`, `weight_unit`, `weight_kg` (**stored generated column** =
  `weight` normalised to kg), `distance`, `distance_unit`, `distance_m` (generated),
  `duration_s`, `rpe`, `is_complete BOOL`, `completed_at`.
  Which measures are required is validated per `modality` in `packages/core`, not
  by DB `CHECK`s, so an in-progress row can be half-filled. One integrity rule is
  enforced at finish: a `working` set must have at least one measure populated.

Concurrency: a set is addressed by `(workout_exercise_id, set_number)` and written
with `PUT` (§6). Two tabs editing the same in-progress workout are last-write-wins
per set; `updated_at` is returned so a client can detect it lost a race. Full
conflict resolution is out of scope while there is one (web) client.

### 4.5 Personal records (derived cache)

- **personal_record** — `user_id`, `exercise_id`, `record_type`, `value` (canonical
  units), `unit`, `source_set_entry_id`, `workout_id`, `achieved_at`,
  `local_date`. One row per `(user_id, exercise_id, record_type)`.

v1 tracks **three** record types (decided 2026-08-30):

| `record_type` | Rule (working sets only; warmup/drop/failure excluded) |
|---|---|
| `heaviest_weight` | max `weight_kg` where `reps ≥ 1`. Reps otherwise ignored. |
| `best_est_1rm` | max Epley e1RM = `weight_kg × (1 + reps/30)`, considering only sets with `1 ≤ reps ≤ 12`. |
| `best_set_volume` | max `reps × weight_kg` over a single set. |

Bodyweight-only exercises: `heaviest_weight` and volume use bodyweight if
recorded, else the record is `reps`-based (`value` = reps, `unit` = `'reps'`).
Deferred: `rep_pr_at_weight` (a set of rows, not one) — revisit post-v1.

PRs are written transactionally when a workout is finished. Invalidation is simple
because **finished workouts are immutable in v1** — the only mutations that affect
PRs are finishing a workout (recompute for that workout's exercises) and deleting
a whole workout (recompute for its exercises). Editing individual sets of a past
session is post-v1 and will need the same recompute hook. The whole table can be
rebuilt from `set_entry` by a job — it is a cache, not a source of truth. All PR
math lives in `packages/core` with exhaustive tests (Risk R4).

### 4.6 Progress views

Charts (volume over time, e1RM trend, top-set weight) are **queries**, not stored
entities, computed from `set_entry` + `weight_kg`. If aggregate latency becomes a
problem at real data sizes, add a nightly `exercise_daily_stat` rollup — not in
v1 (§1.3 scale does not need it).

### 4.7 Future-proofing for wearable import (design only — no v1 tables beyond `workout.source`)

A later `external_activity` table (`user_id`, `provider`, `provider_activity_id`
unique-per-provider, `raw JSONB`, `linked_workout_id`) gives idempotent import and
dedup without touching the v1 schema.

### 4.8 Unit handling in detail

- `set_entry.weight` + `weight_unit` = exactly what the user typed. Displayed back
  verbatim.
- `set_entry.weight_kg` = `GENERATED ALWAYS AS` (kg if unit is kg, else
  `weight × 0.45359237`) `STORED`. Every PR comparison, chart, and aggregate uses
  only `weight_kg`. Same pattern for `distance` / `distance_m`.
- `user.unit_preference` only chooses the default unit for *new* input and the
  unit for rendering aggregate/derived numbers; it never rewrites stored rows.

### 4.9 Deletion matrix

| Entity | On user action | On account deletion |
|---|---|---|
| `user` | soft (`deleted_at`), tokens revoked | hard purge after 30-day grace |
| `workout`, `workout_exercise`, `set_entry` | hard delete (cascade) | hard purge |
| `set_entry` during an in-progress session | hard delete (transient editing) | — |
| `routine` | soft (`archived_at`) | hard purge |
| custom `exercise` | soft (`is_active = false`) — history snapshots keep sessions readable | hard purge |
| `personal_record` | never user-deleted; recomputed | hard purge |
| `body_metric` | hard delete | hard purge |

Account deletion: immediate soft-delete + token revocation; a scheduled job hard-
purges all user-owned rows and bucket objects after the grace window. Data export:
async job writes a JSON/CSV archive to the bucket; user gets a time-limited signed
URL.

---

## 5. Key Subsystems

### 5.1 Auth & session

The web app runs the **Auth0** Authorization Code + PKCE flow
(`@auth0/auth0-react`), receiving a short-lived access token (JWT) plus refresh
token; a future React Native app uses `react-native-auth0` against the same
tenant. The access token carries an `audience` identifying our API. The API
validates every request's JWT against Auth0's cached JWKS (issuer + audience +
expiry checked); no server-side session store. First request for an unknown `sub`
provisions a `user` row. Authorization in v1 is simply "row belongs to `user_id`"
— enforced in a repository layer, not scattered through handlers.

Auth0 config that matters: one **API** (audience) + one **SPA application**;
email/password + Google + Apple connections; refresh-token rotation on; a login
Action that surfaces `email` in the token. Custom domain deferred to GA.

### 5.2 Exercise catalog delivery

Global catalog is small (hundreds of rows). Clients pull it on first launch and
cache locally with an `ETag` / `updated_since` endpoint for incremental refresh.
Custom exercises come down with the user's data.

### 5.3 Logging & connectivity

Decision: **online required** for v1 (per project constraint). The web app keeps
the in-progress workout in a client store and `PUT`s each set to the server as it
changes (debounced) — an idempotent upsert keyed by
`(workout_exercise_id, set_number)`, per §6. If a write fails, the set is marked
"unsynced" in the UI and retried with backoff; **Finish** is blocked only if
unsynced changes remain, with a clear retry affordance.

Recommended cheap mitigation for the gym case (Risk R1): mirror the in-progress
workout to `localStorage`/IndexedDB and drain a bounded retry queue on reconnect,
so a dropped connection or an accidental tab close does not lose the session. This
is a small amount of work in the SPA and is the same seam a future PWA
service-worker or React Native app would build on.

> Connectivity is still the weakest point in the v1 plan for a gym product.
> Flagging it here so the decision stays deliberate and visible.

### 5.4 Wearable import (post-v1, not built now)

Read-only. A per-provider connector normalises an external activity into a
`workout` with `source != manual`, keyed by `provider_activity_id` for
idempotency. No changes to the logging path. Listed so §4 stays compatible.

### 5.5 Notifications

v1: in-app rest-timer only (a visible countdown; optionally the Web Notifications
API when the tab is backgrounded and permission is granted). No push
infrastructure — APNs / FCM arrive with the native mobile app, if ever.

---

## 6. API Design

- **Style:** REST/JSON over HTTPS. Resource-oriented. **Version in the path
  (`/v1/...`)** — visible in logs and network tools, trivial to route, `/v1` and
  `/v2` can run side by side during a future migration.
- **Auth:** `Authorization: Bearer <jwt>`.
- **Errors:** RFC 9457 `application/problem+json` — `type`, `title`, `status`,
  `detail`, `errors[]` for field-level validation.
- **Pagination:** opaque cursor (`?limit=&cursor=`), `next` cursor in the body.
  No offset pagination.
- **Time:** RFC 3339 UTC, always. Client sends its own `started_at`/`completed_at`
  timestamps (device clock) plus the server records receipt time. For calendar
  fields (§4.0), the client also sends its current UTC offset; the server stores
  `tz_offset_minutes` and derives `local_date` from it, falling back to
  `user.timezone` when the offset is absent.
- **Idempotency:** workout creation uses `client_generated_id`; replaying the same
  id returns the existing resource, never a duplicate. Set writes are naturally
  idempotent (`PUT` a set by `(workout_exercise_id, set_number)`).
- **Contract:** OpenAPI 3.1 spec is the source of truth; client types in
  `packages/core` are generated from it in CI.

### Representative endpoints

All paths are under `/v1`.

```
POST   /workouts                  { client_generated_id, routine_id?, started_at }
GET    /workouts?cursor=          → history list
GET    /workouts/{id}
PATCH  /workouts/{id}             { title?, notes?, ended_at? }   # finish = set ended_at
DELETE /workouts/{id}            # whole session only; triggers PR recompute for its exercises
POST   /workouts/{id}/exercises   { exercise_id, position }
PUT    /workout-exercises/{id}/sets/{setNumber}   { set_type, reps?, weight?, ... }
DELETE /workout-exercises/{id}/sets/{setNumber}
GET    /exercises?updated_since=  → catalog (global + custom), ETag
POST   /exercises                 → custom exercise
GET    /progress/exercises/{id}?metric=est_1rm&from=&to=
GET    /personal-records
POST   /account/export            → 202, async job
DELETE /account                   → 202, soft-delete + purge scheduled
```

---

## 7. Infrastructure & Delivery

| Area | Approach |
|---|---|
| Repo | Monorepo: `apps/api`, `apps/web`, `packages/core`. pnpm workspaces. Added later without restructuring: `apps/marketing` (Next.js, at GA), `apps/mobile` (React Native), `infra/` (CDK or Terraform, phase 2). |
| CI | Lint + typecheck + unit tests on every PR; `packages/core` purity check (no React / DOM / Node-only imports); OpenAPI → client codegen check; migration dry-run against a throwaway DB. |
| CD (v1) | Render blueprint (`render.yaml`). Merge to `main` → auto-deploy `staging`; git tag → promote the same API image + web build to `production`. Web app is a Render static site (CDN-fronted). |
| CD (phase 2) | GitHub Actions: build image → push to ECR → roll the ECS service. `infra/` applied via CI. |
| Migrations | Prisma Migrate; expand-contract, never destructive in a single release; run as a release step, not on app boot. |
| Secrets / config | Render env groups in v1; SSM Parameter Store in phase 2. Nothing in the repo; per-environment. |
| Backups | Managed Postgres automated backups + PITR (Render, later RDS); periodic restore drills. |

---

## 8. Cross-Cutting Concerns

### 8.1 Observability

- **Logs:** structured JSON, one line per request, with a request id propagated
  from the client (`X-Request-Id`).
- **Traces:** OpenTelemetry; instrument HTTP + DB. Watch the finish-workout
  transaction and the progress queries specifically.
- **Metrics:** RED (rate/errors/duration) per endpoint; DB pool saturation;
  business counters (workouts started/finished, sets logged).
- **Errors:** Sentry (or equivalent) on the web app and the API, releases tagged.
- **Product analytics:** privacy-respecting (PostHog — cloud free tier or
  self-hosted); event on `set_logged` with latency, never with health values in
  properties.

### 8.2 Privacy, security, compliance

- Training logs + body weight are **sensitive personal data**. GDPR / CCPA apply:
  export and delete are product features (§4.7), not manual ops tickets.
- **Do not** use training or body-weight data for advertising, and do not share it
  with third parties. No HIPAA exposure in v1 (no covered entities, no providers).
  When the native app ships, Apple/Google health-data disclosure rules apply — a
  post-v1 concern, noted so it is not a surprise.
- TLS 1.2+ in transit; encryption at rest for DB and bucket (managed).
- Least-privilege DB credentials for the API; no shared admin creds.
- Dependency scanning + Dependabot; secret scanning on the repo.
- Rate limiting at the API (Fastify plugin), with Cloudflare in front once the
  custom domain lands; per-user quotas on write endpoints.
- CORS is an exact-match origin allowlist (the SPA origin per environment), never
  a wildcard or reflected `Origin`; tokens travel in the `Authorization` header,
  not cookies, so credentialed CORS stays off. Configured in the API from M0
  (Spec 01 §5.5).
- Signed, short-TTL URLs for all bucket access; no public objects.
- Deferred hardening items from security reviews are tracked in
  [`security-backlog.md`](security-backlog.md) (e.g. log-redaction depth, DB cert
  verification, base-image digest pinning) — none exploitable, revisited per the
  effort notes there.

### 8.3 Testing

- `packages/core`: exhaustive unit tests on units conversion, est-1RM, volume, PR
  detection — these are where silent wrongness hurts most.
- API: integration tests against a real Postgres (testcontainers), covering the
  idempotency and finish-workout paths.
- E2E: one happy-path web smoke (sign in → start → log → finish → see PR) in CI,
  Playwright.

---

## 9. Rollout Plan

Single web track, built solo, on a **bursty / unpredictable schedule** (Q9).
Planning implications:

- **Plan by milestone completion, not calendar.** No fixed dates in this doc.
- **Every milestone from M1 on is independently shippable and usable.** M1 alone
  is a working logging app; M2 adds history/progress; etc. Stopping between
  milestones always leaves something you would actually use, not a half-built
  feature.
- **Keep work-in-progress in short-lived branches** merged behind a flag if
  needed, so picking the project back up after weeks away starts from a green
  `main`, not a broken tree.
- Order is chosen so the backend / Node-TS learning happens before the React SPA
  work compounds it.
- Milestones are outcome bundles; the build units are the **component specs** in
  [`docs/specs/`](specs/README.md), each implemented and deployed independently.
  Feature work splits into an API spec and a UI spec (API-first, per R6). Mapping:
  M0 = 01 + 04 · M1 = 02, 03, 05, 06 · M2 = 07, 08 · M3 = 09, 10 · M4 = 11–13 ·
  GA = 14 · Phase 2 = 15.

| Milestone | Contents | Exit criteria |
|---|---|---|
| **M0 — Skeleton** (Spec 01) | Monorepo, `render.yaml` blueprint, CI/CD, `packages/core` purity check, Fastify API skeleton + config + DB, `user` migration, Auth0 **API-side** JWT validation + `user` provisioning, health checks. Backend only — the browser login flow is Spec 04. | API on Render staging validates a real Auth0 token and provisions a user; post-deploy smoke script gets `200 /v1/me`. |
| **M1 — Log a workout (API + web)** | Exercise catalog endpoint + seed data; start/empty workout; log sets; finish. No routines, no charts. Mobile-first responsive layout for the logging screen. | Dev logs real gym sessions from a phone browser for 1 week; no data loss. |
| **M2 — History & progress** | History list + detail; per-exercise charts (top set, est-1RM, volume); PR detection + finish-screen summary. | Progress numbers reconciled by hand for 10 sessions. |
| **M3 — Routines + supersets** | Build/edit routines; start a workout from a routine; superset/circuit grouping (Tier B) — bracketed display + one rest timer per group. | — |
| **M4 — Polish & beta** | Rest timer, body-weight log, data export/delete, empty + error states, `localStorage` write-queue (R1 mitigation), accessibility pass. | Closed beta with a handful of real users; error rate + core metrics instrumented. |
| **GA** | Public launch of the web app, custom domain, and a small **standalone Next.js marketing/landing site** (static, SEO-friendly; separate deploy from the app — a deliberate, low-stakes first use of Next.js). | Success metrics (§1.3) visible on a dashboard. |
| **Phase 2 — AWS migration** (can start once M2 is stable; independent of M3+) | `infra/` in CDK or Terraform: ECS Fargate, RDS Postgres, S3, CloudFront, EventBridge; GitHub Actions build→ECR→deploy. Lean: no NAT, no ALB, single-AZ. Cut over staging first, then production; keep Render as rollback until stable. | Both envs running on AWS from IaC; documented as a case study. |
| **Post-v1 (backlog)** | React Native app (`apps/mobile`) on the same API; PWA/offline; guided interleaved superset logging (Tier C); wearable read-only import; **social phase** (planned — follow graph, shared workouts, challenges; requires the authz layer per §3.4 / R8). | Each is additive per §3.4 — no server rewrite. |

---

## 10. Risks & Open Questions

### Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| **R1** | "Online required" in a product used in gyms with poor signal, now via a **phone browser** → lost sets, abandoned sessions. A backgrounded mobile-browser tab can also be evicted mid-session. | High — directly hits the core loop and retention metric. | Mirror the in-progress workout to `localStorage`/IndexedDB; drain a bounded retry queue on reconnect and on tab restore. Small work in the SPA, lands in M4 (earlier if it bites). Not the full offline-first layer, but removes the worst failure mode and is the seam a later PWA/RN client reuses. |
| **R2** | Deferring native mobile could turn into "never", or the API/core pick up web-only assumptions that make the eventual RN app expensive. | Medium — strategic, not immediate. | §3.4 principles + the CI purity check on `packages/core` keep the seam honest from day one, even while only the web app exists. |
| **R3** | Managed auth provider lock-in / pricing at scale. | Medium | Keep all identity data (`user` table) in our DB keyed by `sub`; provider stores only credentials. Migration path stays open. |
| **R4** | PR / progress math wrong in a way users notice and lose trust. | Medium | All formulas in `packages/core` with heavy tests; PR table is a rebuildable cache; show the underlying set on every PR. |
| **R5** | Scope creep toward coaching/social before the logging loop is truly excellent. | High for timeline | Non-goals in §1.5 are load-bearing; revisit only once the core loop is proven in real use (post-M2, ideally post-beta). |
| **R6** | Solo developer learning Node/TS + Prisma (and a React SPA) while building → slower delivery, and early architectural mistakes made before the platform is familiar. | High for timeline; medium for code quality | Dropping native mobile from v1 already removes the biggest piece of this. Within the milestones, land the API surface for a feature before its web screen so the language is bedded in first. Lean on Fastify + Prisma conventions rather than inventing structure. Keep `packages/core` small and pure — highest-value, most testable code, safest place to be learning. Treat M1 as throwaway-friendly: expect one refactor after it ships. Accept a longer timeline than a Go build would take — the learning is a stated goal, not an overrun. |
| **R7** | AWS phase 2 either never happens (portfolio value lost) or is started too early and stalls app progress; or the "lean" setup drifts into a $70+/mo bill. | Medium — career-goal and cost. | Gate it: phase 2 does not begin until M2 is stable and the app is worth showing. Keep the app 12-factor so the option stays cheap to exercise. Enforce the cost guardrails explicitly in IaC review: no NAT Gateway, no ALB, single-AZ RDS, `db.t4g.micro`, budget alarm at $25/mo. Verify AWS free-tier terms at account creation — they changed in 2025. |
| **R8** | The planned social phase (Q6) needs authorization that v1 does not have — replacing "row belongs to `user_id`" with per-resource visibility, a follow graph, blocking, and feed fan-out. Retrofitting authz into a codebase that assumed single-owner access is error-prone (privacy leaks). | Medium — future, but a privacy-leak class of bug. | Keep every data access going through the repository layer now (§5.1) so there is one place to add visibility checks later — never inline ad-hoc queries in handlers. Treat social as its own design doc and phase, after the app has real users. Do not half-build it earlier (R5). |

### Decisions log (formerly open questions)

All resolved as of v0.3. Kept here with rationale so the "why" survives.

- **Q1 — Backend language/framework.** ✅ **Resolved: Node + TypeScript + Fastify +
  Prisma.** Driven by (a) code-share of domain math with both clients for a solo
  dev, (b) an explicit portfolio/learning goal around Node/TS (§1.4). Go was the
  incumbent but loses on code-share; NestJS is the fallback if project structure
  starts to sprawl. See §3.2 and Risk R6.
- **Q2 — Managed auth vendor.** ✅ **Resolved: Auth0.** Standards-first OIDC
  (transferable knowledge + strongest resume signal for the portfolio goal),
  vendor-neutral architecture already assumed in §5.1. Clerk was the faster
  integration; Cognito only relevant if Q4 → AWS. See §3.2, §5.1.
- **Q3 — API versioning.** ✅ **Resolved: `/v1` path prefix.** See §6.
- **Q4 — Hosting.** ✅ **Resolved: Render + Cloudflare R2 for v1; migrate to AWS
  (CDK/Terraform + Fargate + RDS + S3 + CloudFront) as a phase-2 DevOps portfolio
  project after M2.** Render unblocks app work now; the AWS migration is a
  self-contained artifact and, because the app is 12-factor / S3-compatible, a
  swap not a rewrite. See §3.2, §3.3, §7, §9.
- **Q5 — Supersets.** ✅ **Resolved: schema unchanged** (`superset_group SMALLINT`
  on `routine_item` + `workout_exercise`, covers circuits too); ship **Tier B UX**
  (grouping + bracketed display + one rest timer per group, grid logging) in
  **M3**; guided interleaved logging (Tier C) to post-v1 backlog. See §2 item 8,
  §4.3.
- **Q6 — Social phase.** ✅ **Resolved: yes, a social/community phase is intended
  post-v1** (following, shared workouts, challenges — hence the name). v1 does not
  build for it, but it must not preclude it. Assessment: the data model is fine
  (per-user rows, stable IDs, nothing that blocks a follow graph or activity
  feed). The real future cost is **authorization** — v1's "row belongs to
  `user_id`" (§5.1) is deliberately minimal; social needs a genuine visibility /
  privacy / blocking layer. That is a dedicated later phase with its own design
  doc (flagged in §3.4 and R8), not a surprise. No v1 work.
- **Q7 — Client sequencing.** ✅ **Resolved: web first; native mobile is post-v1
  nice-to-have.** v1 ships one responsive web client. §3.4 keeps a later React
  Native app additive. See §1.2, §3.1, §9.
- **Q8 — Web framework.** ✅ **Resolved: Vite React SPA for the app; a separate
  Next.js marketing site at GA.** SPA keeps the architecture clean, hosting cheap,
  and knowledge/code portable to a future React Native client; it is also the
  smaller concept surface for learning React fundamentals. Next.js gets a focused,
  low-stakes outing on the landing page (the job it is best at) once React is
  solid. See §3.2, §9 GA.
- **Q9 — Timeline.** ✅ **Resolved: bursty / unpredictable.** No calendar dates;
  plan by milestone completion; every milestone from M1 on is independently
  shippable and usable so gaps between work sessions are safe. See §9.

---

## Appendix A — Glossary

- **Working set** — a set performed at target effort (excludes warmups).
- **RPE** — Rate of Perceived Exertion, 1–10.
- **Estimated 1RM (e1RM)** — predicted one-rep max from a submaximal set; Epley:
  `w * (1 + reps/30)`.
- **Volume** — `reps × weight` for a single set (`best_set_volume`); summed over
  sets for an exercise or session (progress charts, §4.6).
- **PR** — Personal Record; see `personal_record.record_type` for the tracked kinds.
