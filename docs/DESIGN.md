# Strength in Numbers — Design Document

**Status:** Draft v0.5 — decisions Q1–Q35 resolved; consistency pass done
**Last updated:** 2026-11-01 (§2 item 3 / §5 outbox paragraph / §9 M3 row and milestone mapping / Q35 from Spec 10.7 — timed sections UI: the Timer group on the section sheet in routines and workouts, a digits-from-the-right clock field, Log result per format with two new offline outbox ops (`round`, `result`), the change-format confirm, the score on the summary and History, a core `groupRange` rule that fills grouping in only where a timed section has no superset (a timed section may hold several), and routine from text reading Set Timer, AMRAP and Time Cap from the gym app's timing lines when the section's score is a time (or rounds + reps for an AMRAP); no API change, four PRs; GitHub #112, draft). Earlier: 2026-11-01 (§2 item 3 / §4.3 / §4.4 / §4.9 / §6 / §9 M3 row and milestone mapping / Q35 from Spec 09.5 — timed sections: a section, in a routine and in a workout, can be a Set Timer, an AMRAP or a Time Cap with a plan, and a workout's section records its result as numbers through replay-safe keyed writes; History gets a score line, the Hevy export sends a timed section as the "Workout" placeholder with a duration and the fingerprint hashes timed data only for timed sections; migration `0018`; GitHub #112, draft, design approved 2026-11-01). Earlier: 2026-10-26 (Q34 amended from the Hevy build plans; earlier: 2026-10-25 §2 deferred line / §4.3 / §4.7 / §5.4 / §6 / §8.2 / §9 milestone mapping / Q34 from Specs 19.0, 19.1, 20.0, 20.1, 20.2 — the Hevy integration, owner-only: a one-time import of Hevy's custom exercises, chosen routines and workout history through Hevy's API, a stored exercise and section mapping, links to Hevy copies, and Send / Update / auto-push to a private Hevy copy; the Hevy key stays on the device, the browser calls Hevy directly (CSP `connect-src` gains `https://api.hevyapp.com`); migration `0016`, `workout.source` gains `'hevy'`; five drafts, design approved 2026-10-25). Earlier same day: (§9 milestone mapping / Q17 / Q33 pointers from Spec 18.2 — the Progress tab becomes Exercises: All exercises + Records views, the exercise page, Edit, make your own copy and Delete; web only, no API change; GitHub #104 piece 2 UI, draft). Earlier same day: (§4.2 / §5 / Q33 from Spec 03.4 — exercise management: the type-change rule (free while the lineage has no logged sets, afterwards only between types that need the same numbers), which routines use an exercise, last logged per exercise; no migration; GitHub #104 piece 2, draft). Earlier same day: (§4.0 / §4.1 / §4.8 / Q32 from Spec 05.3 owner ruling O4 — `ft` is a fourth distance unit and `0015` rebuilds the generated `distance_m`; 18.1 owner questions answered). Earlier same day: (§2 item 2 / §4.2 / §4.4 / §4.5 / §4.6 / §9 milestone mapping / glossary / Q32 from Spec 05.3 — three new exercise types, Calories, Weight + distance and Weight + duration: a `calories` set column, three new record types, `heaviest_weight` widened to the weighted types, migration `0015`; GitHub #104 piece 1, draft). Earlier: 2026-10-24 (§3.3 / §7 / §9 / Q31 from Spec 15 — production on Google Cloud, free tier: Cloud Run + Firebase Hosting + Neon, Terraform in `infra/`, the gated `deploy-prod`). Earlier: 2026-10-24 (Q28 from Spec 10.4 round 2 — routine from text reads sections from the gym app's score badges and survives status-bar icons and look-alike misreads). Earlier: 2026-10-24 (Q30 from Spec 10.6 Phase B — the same section controls on the edit screen for a finished workout, pessimistic writes that refresh History, Progress and records). Earlier: 2026-10-24 (Q30 from Spec 10.6 Phase A — workout sections UI on the live screen: Edit on section headings, Add section, the "New exercises go into" line, the Section select in Options; no API change). Earlier: 2026-10-23 (§2 items 3 / 4 / §4.4 / §4.9 / §6 / §9 M3 row and milestone mapping / Q21 clause / Q30 from Spec 09.4 — workout sections API: a workout's sections become the workout's own after the start copy, added, renamed, re-noted, removed and filled during or after the workout; migration `0014`). Earlier: 2026-10-22 (§2 item 3 / §9 M3 row / Q29 from Spec 10.5 — one-off routines UI: the tag and expiry on the list, the preview note and Keep, the Finish-dialog line and checkbox; no API change). Earlier same day: 2026-10-22 (§2 item 3 / §4.3 / §4.4 / §4.5 / §4.9 / §6 / §9 M3 row and milestone mapping / Q29 from Spec 09.3 — one-off routines: a routine that removes itself when a workout started from it is finished, kept on request, swept lazily after 14 days; owner approved 2026-10-19). Earlier: 2026-10-21 (Spec 10.4 Phase C — routine from text is reachable: **New from text** on the Routines list, the import opens in the ordinary editor, Save creates the new exercises then the routine). Earlier same day: (§6 from Spec 10.4 Phase B — a bulk create checks the synced list for an existing name first). Earlier: 2026-10-19 (§2 item 3 / §4.2 / §9 M3 row / Q28 from Spec 10.4 — a routine from pasted text: a pure on-device reader, a name check, nothing created before Save; owner approved 2026-10-19). Earlier: 2026-10-18 (§2 item 4 / §5.3 / Q27 from Spec 18.0 — the UI for editing finished workouts and Change Time: a workout title and notes shown on the summary and the title on the History row, edit writes pessimistic and online-only, the outbox keeps unsent ops on the gone path; owner approved 2026-10-18. Earlier same day: §2 items 4–5 / §4.4 / §4.5 / §4.9 / §5.3 / §6 / §9 / Q27 from Spec 07.4 — finished workouts become editable and workout times fixable: set and exercise writes open on a finished workout with in-transaction record recomputes, Change Time on `PATCH /v1/workouts/{id}`, a stored live "took"; draft, owner decisions 2026-10-18. Earlier: 2026-10-17 (Q26 from Spec 17.3 — the front door: the landing and resuming screens as one title card, "Strength in Numbers", a double-tap guard on Log in. Earlier same day: Q25 from Spec 17.2 Phase B — record cards, e1RM display rounding, the History count badge. Earlier same day: Q25 from Phase A — the Finish dialogs and summary header. Earlier same day: §4.5 from Spec 07.3 — History recordCount excludes set volume. Earlier same day: §2 items 1 and 8 / §9 M3 and M4 rows / Q5 / Q24 from Spec 17.1 Phase C — the rest timer, pulled forward from M4). Earlier: 2026-10-16 (§2 item 8 / Q24 from Spec 17.1 Phase B — the "now" workout screen: one current exercise, ± steppers by the set's unit, the per-set bottom bar, End workout early. Earlier same day: §2 item 4 / §4.3 / §4.4 / Q23 from Spec 17.1 Phase A — RPE hidden in the UI, kept in the data. Earlier: 2026-10-16 (§3.2 / §9 / Q22 from Spec 17.0 — visual identity "Stone": light-first palette with a Light/Dark/System switch, color roles, self-hosted type; no API or CSP change. Earlier: 2026-10-14 (§2 item 1 from Spec 12 — account lifecycle UI drafted: Profile-screen download and two-step delete, a terminal "scheduled for deletion" screen, no API change. Earlier: 2026-10-13 (§2 item 3 / §4.3 / §4.4 / §4.9 / §6 / §9 M3 row / Q21 from Specs 09.2 and 10.3 — routine sections and notes: named, noted groups of exercises in a routine, snapshotted with the routine's own note onto started workouts and shown in the session and History; session exercise notes queued through the offline outbox. Earlier: 2026-10-11 (§2 item 3 / §4.3 / §4.4 / §4.8 / §4.9 / §6 / §9 M3 row / Q20 from Specs 09.1 and 10.2 — planned sets: per-set routine plans (type, reps, weight), snapshotted onto started workouts, prefilled in the session; reverses Spec 10.1 D3. Earlier same day: §3.1 / §3.2 / §3.3 / §4.1 / §4.9 / §6 / §8.2 / §9 M4 row / Q4 / Q19 from Spec 11 — account lifecycle API: beta-minimum synchronous export + manual purge CLI, R2 and cron deferred to GA. Earlier same day: §2 item 8 / Q5 "grid logging" = bracket + per-card logging, §6 response-field rollout convention, §9 M3 row from Spec 10.1 — routines session side. Earlier: 2026-10-10, §2 items 3 / 8, §9 M3 row, Q5 wording from Spec 10.0 — routines UI; the rest timer is M4, not M3; Spec 10 split into 10.0 / 10.1. Earlier: 2026-10-08, §4.3 / §4.4 / §4.9 / §6 / Q18 from Spec 09 — routines and supersets API. Earlier same day: §2 item 6 / §4.6 / §9 / Q17 from Spec 08.1 — progress screen and chart approach. Earlier same day: §2 items 5–6 / §8.3 / §9 / Q16 from Spec 08.0 — history screen + PR display; Spec 08 split into 08.0 / 08.1. Earlier: 2026-10-07, §6 progress endpoint / §4.6 / Q15 from Spec 07.2 — progress series; §6 cursor contract / §4.6 / Q14 / glossary from Spec 07.1 — history list. Earlier: 2026-10-06, §4.5 / §6 / §9 / Q13 / glossary from Spec 07.0 — PR engine; Spec 07 split into 07.0 / 07.1 / 07.2; and 2026-09-05, Q10–Q12 from Spec 04.0/04.1)))
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
   weight log (simple time series), account deletion + data export. (API: Spec 11; UI: Spec 12
   — "Your data" download and a two-step "Delete account" on the Profile screen.)
2. **Exercise catalog** — curated global library (name, primary/secondary muscle
   groups, equipment, modality: weight+reps / bodyweight / weighted bodyweight / timed /
   distance + time / calories / weight + distance / weight + duration) plus
   user-created custom exercises. (The last three: Spec 05.3, Q32.)
3. **Routines (templates)** — user builds a reusable ordered list of exercises
   with target sets/reps. Optional; you can also start an empty workout.
   (UI: Spec 10.0 — routines live inside the **Workouts** tab, not a fifth tab: the
   Start screen lists them, a tap opens a **preview** with Start / Edit / Delete — never a
   one-tap start — and the editor is a routed screen under `/app/workouts/routines/…`.
   Session-side display of targets and supersets: Spec 10.1. A routine item can also plan
   each set — type, rep range, weight — and the session prefills from it: Specs 09.1 / 10.2.
   A routine can also be split into named **sections** (warm-up, main, …), each with a note, and
   the session shows them with the routine's own note and a per-exercise note the lifter can edit
   during the workout: Specs 09.2 / 10.3. A routine can also be created from pasted text (the Live Text
   of gym-app screenshots), read on the device with no external service: Spec 10.4, Q28 (its timing lines become a section's timer: Spec 10.7). A routine can be a
   **one-off** that removes itself when a workout started from it is finished: Spec 09.3, Q29. The UI (Spec 10.5) tags it "One-off" with its expiry on the Routines list, adds a note and **Keep as a routine** to its preview, and puts a line plus an unchecked **Keep it in my routines** checkbox in the Finish dialogs. A workout's sections are its own after the start copy: they can be added, renamed, re-noted, removed and filled during or after the workout (Spec 09.4 API, Spec 10.6 UI, Q30). A section can also carry a **timer** — Set Timer, AMRAP or Time Cap — whose result the lifter records on a workout's section as numbers, with a score shown on the summary and in History (Spec 09.5 API, Spec 10.7 UI, Q35). The timer is chosen on the same section sheet as the name and note, in a routine and in a workout; the result is typed from a **Log result** control on the section's heading and queued offline like a set; routine from text fills the timer in from the gym app's timing lines when the section's score is a time (Spec 10.7).)
4. **Workout logging** — start a session (optionally from a routine), add
   exercises, log sets (reps, weight, RPE, set type: warmup/working/drop/failure),
   check them off, a workout title and notes (shown on the summary and, for the title, on the History row; edited from the edit screen, Spec 18.0), finish, and — afterwards — edit a finished workout or fix its start time and duration (Spec 07.4), and add, rename, remove and fill its sections (Spec 09.4 / 10.6). (RPE is stored and accepted by the API but not shown
   or entered in the UI: Q23.) The rest timer is Spec 17.1 Phase C (Q24).
5. **History** — chronological list of past workouts, drill into any session.
   A finished workout can be corrected afterwards — change a set, add or remove sets and
   exercises, fix the start time and duration — and records, History and Progress follow
   (Spec 07.4, Q27; introduced by Spec 07.4, replacing "finished workouts are read-only in v1").
   (UI: Spec 08.0 — the History tab and `/app/history/:id`.)
6. **Progress** — per-exercise charts: top-set weight, estimated 1RM, total
   volume; personal-record list and PR notifications at finish. (PR engine and
   list: Spec 07.0; history list: 07.1; the chart series: 07.2. UI: PR notifications
   on the workout summary — Spec 08.0; charts (hand-written SVG, no chart library —
   Q17) and the per-exercise records list — Spec 08.1.)
7. **Responsive web app** — the sole v1 client. Full logging + history + progress,
   laid out to work one-handed on a phone browser in the gym and to expand on a
   desktop for planning and review.
8. **Supersets / circuits (Tier B)** — group exercises, bracketed display, grid-style
   logging (no forced interleave). Grouping, bracketed display and grid logging land in
   M3 alongside routines (Specs 09, 10.0, 10.1); "grid logging" means the grouped cards
   are joined by one bracket; since Spec 17.1 the session shows **one current exercise that alternates through the run, logged from the single bottom bar** (Spec 10.1 D3's "each keeps its own Log set row" is superseded, and its "no set prefill / no progress count" half Spec 10.2 reverses, Q20, Q24); the **one rest timer per group** runs after
   its last exercise (Spec 17.1 Phase C, Q24). See §4.3 and Q5.

**Explicitly deferred:** guided interleaved superset logging (Tier C — A1→B1→A2→B2
flow) (Spec 17.1's auto-advance suggests the next member of a run but forces nothing, since a tap picks any exercise; a strict guided flow stays deferred, Q24), plate calculator, standalone
1RM calculators, CSV import from competitors. *(Hevy's public API is the exception: an owner-only one-time import and an export to a private Hevy copy, Q34; Hevy's CSV export as a source stays deferred.)*

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
                │               │   │ GA: exports  │   │              │
                └───────────────┘   └──────────────┘   └──────────────┘
```

*Beta (M4): there is no object store yet. Data export is a synchronous JSON response from the
API and the account purge is a manually run CLI (Spec 11, Q19); the bucket and async export
return at GA.*

### 3.2 Component choices and rationale

| Concern | Choice | Why | Alternatives considered |
|---|---|---|---|
| Web client (v1, sole client) | **React SPA** — Vite + TypeScript, client-only, deployed as static assets. Router: React Router (library mode). Data layer: TanStack Query. Styling: CSS Modules + CSS custom-property design tokens, no CSS framework (Q11). Visual system: "Stone" — light-first, teal = interactive, brass = records only, self-hosted Instrument Sans (Q22; details in `apps/web/DESIGN.md`). Browser access/refresh tokens are held in memory only (Q12). | Whole app is behind auth → SSR/SEO unused. Cleanest architecture (static client + typed API + shared `core`), cheapest hosting, and the knowledge + code transfer almost 1:1 to a future React Native client (§3.4). Smallest concept surface for a developer newer to frontend to learn React fundamentals cleanly. Built mobile-first responsive so a phone browser is a first-class gym client. | **Next.js** — adds a server tier and framework-specific concepts (server vs client components, SSR) that are unused behind auth and do not transfer to React Native; reserved for the marketing site (see §9 GA). **Remix / TanStack Start** — same SSR tradeoff. |
| Future mobile client (post-v1) | **React Native** (Expo) when the time comes | Reuses `packages/core` and the same REST API unchanged; closest skill transfer from React web; single codebase for iOS + Android. | Native Swift + Kotlin (2× cost); Flutter (no code-share with a React web app). Decision deferred, not made. |
| Shared code | **`packages/core`** — framework-agnostic TypeScript: DTO types, Zod schemas, API client, units + estimated-1RM + volume + PR math. **No React, no DOM, no Node-only APIs.** | One implementation of the domain rules, importable by the web app today and a React Native app later with zero changes. This purity constraint is what makes "mobile later" cheap — see §3.4. | Duplicating logic per platform (drift risk); putting logic in the API only (clients re-implement for instant feedback). |
| Backend | **Single stateless API service**, Node + TypeScript, **Fastify**, containerised. | Same language as both clients → domain math in `packages/core` is written and tested once. One toolchain for a solo developer. Fastify keeps Node fundamentals visible rather than hiding them behind framework abstractions. Also a deliberate learning/portfolio goal (§1.4). | **Go** (developer's existing language) — rejected because it forces the e1RM/PR math into a second implementation and adds a language context-switch for a solo dev. **NestJS** — more job-description keyword coverage and enforced structure, but adds DI/decorator/module concepts to learn on top of Node/TS itself; revisit only if the project sprawls. **Rails / Elixir** — no prior experience, no code-share. |
| ORM & migrations | **Prisma** | Type-safe queries, migrations in the box, widely used in target roles. Raw SQL for the progress aggregates (§4.5) where Prisma's query API gets awkward. | Kysely (lighter, less magic, no migration tooling); TypeORM (rougher DX). |
| Primary datastore | **PostgreSQL**, managed. | Data is relational (users → workouts → exercises → sets), needs transactions and aggregate queries for progress views. JSONB where schema is genuinely fluid. | DynamoDB / Mongo — aggregation and evolving query patterns are painful. |
| Object storage | **S3-compatible bucket** (Cloudflare R2) — **deferred to GA** | Not used in the beta: export is a synchronous JSON response and the purge is a manual CLI (Spec 11, Q19). When added at GA: async data-export archives; reserved for post-v1 exercise images and form-check media. | Storing blobs in Postgres (don't). |
| Auth | **Auth0** (managed OIDC provider) | Health-adjacent PII; do not want to own password storage, MFA, social login, or breach surface in v1. Standards-first (OIDC / PKCE / JWKS) so the integration is transferable knowledge, and the strongest resume signal of the options (portfolio goal, §1.4). API verifies JWTs against Auth0's JWKS; a `user` row is provisioned on first login keyed by the `sub`. | **Clerk** — better React DX, faster to integrate, but more frontend lock-in and a weaker "I know OIDC" story. **Cognito** — only competitive if hosting were AWS (Q4 → not AWS). Rolling our own — wrong risk solo, on health PII. |
| Hosting (v1) | **Render** — API web service + managed Postgres (backups/PITR) + static SPA site, all native primitives, described in a checked-in `render.yaml` blueprint. A Render cron job (scheduled account purge) and **Cloudflare R2** (S3-compatible object storage, async export) join at GA — the beta needs neither (Spec 11, Q19). *(Production: Google Cloud, Spec 15 / Q31; Render stays staging.)* | Every component maps to a native primitive; predictable low cost (~$14–21/mo, near-zero on free tier); no VPC learning curve blocking app work. `render.yaml` is itself a portfolio artifact. | **Fly.io + Tigris** (more container depth, less battle-tested managed PG); **VPS/Coolify** (trades build time for ops time); **AWS** — see phase 2. |
| Observability | **OpenTelemetry → Grafana Cloud** (staging), local Prometheus + Tempo + Grafana (dev) | Push fits a free instance that sleeps; one instrumentation layer re-pointable at AWS (AMP/ADOT) in Spec 15; real PromQL/Grafana skills. | `prom-client` scraped by Grafana Cloud (needs a public, token-protected `/metrics` and keeps the instance awake); self-hosted Prometheus/Grafana VM (ops burden, moves again at Spec 15). |
| Hosting (phase 2, post-M2) | **Migrate to AWS** as a deliberate, self-contained DevOps portfolio project: ECS Fargate + RDS Postgres + S3 + CloudFront + EventBridge, defined in **AWS CDK or Terraform**, deployed by a GitHub Actions pipeline. Lean setup: **no NAT Gateway** (public subnet + tight SG), **no ALB** (CloudFront → service, or API Gateway HTTP API), single-AZ RDS. *(Superseded by Spec 15 / Q31, 2026-10-24: production runs on Google Cloud — Cloud Run, Firebase Hosting, Neon — and the AWS migration is dropped, not scheduled.)* | DevOps roles are a career target (§1.4); the IaC repo + CI pipeline is the artifact. The app is 12-factor / container / Postgres / S3-compatible precisely so this is a swap, not a rewrite. ~free for 6–12 months on the AWS free tier, then ~$20–30/mo. | Staying on Render (fine functionally; weaker DevOps signal). |

### 3.3 Environments

`local` (docker-compose: API + Postgres; a MinIO S3 stand-in joins when GA's async export needs it) →
`staging` (Render, prod-like, seeded, auto-deploy from `main`) → `production`
(Google Cloud, Spec 15: Cloud Run + Firebase Hosting + a separate Neon project, promoted from staging by the
owner-approved `deploy-prod` workflow; staging stays on Render). *(Amended by Spec 15, 2026-10-24: production
was Render, promote by tag; the paragraph below describes the original plan.)* Each environment has its own Render Postgres and Auth0 tenant (and, from GA, its own
R2 bucket — none in the beta, Spec 11). The MinIO → R2 → (later) S3 progression is
transparent to the app because storage access will be S3-API only.

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
- **Allowed units:** `weight_unit ∈ {kg, lb}`, `distance_unit ∈ {m, km, mi, ft}` (`ft` added by Spec 05.3, migration `0015`);
  canonical units are **kg** and **meters**. Vocabularies and conversion factors
  live in one place — §4.8 (and `packages/core`, Spec 02).
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
  `deleted_at` (soft-delete for the 30-day grace period, then a hard purge — a manual operator CLI in the beta, a scheduled job at GA; Spec 11).
- **body_metric** — `user_id`, `measured_at timestamptz`, `local_date DATE`,
  `tz_offset_minutes SMALLINT`, `metric_type` (`weight` only in v1;
  `body_fat_pct`, `waist`, … reserved), `value NUMERIC`, `unit`. Same
  calendar-fields convention as `workout` (§4.0). Generalised now so future
  measurements are additive; v1 UI only ever writes `weight`. Independent of
  workouts.

### 4.2 Exercise catalog

- **exercise** — `id`, `catalog_key` (kebab-case stable identifier for curated
  rows; `UNIQUE` where `owner_user_id IS NULL`, `NULL` for custom — Spec 03.1),
  `owner_user_id` (NULL = global/curated; `ON DELETE CASCADE`), `name`,
  `modality` (`weight_reps` | `bodyweight_reps` | `weighted_bodyweight` |
  `duration` | `distance_duration` | `calories` | `weight_distance` |
  `weight_duration` — the last three from Spec 05.3), `primary_muscle_id`, `secondary_muscle_ids`
  (array), `equipment_id`, `is_active`, `forked_from_exercise_id` (`uuid NULL
  REFERENCES exercise(id) ON DELETE RESTRICT` — Spec 03.2, resolves D9: kept
  for provenance, but suppressing a forked row's global origin from a catalog
  view is a **client-side** rule in Spec 06.0, not a server-side visibility
  filter: the origin is one row shared by every caller, so a per-caller "hidden"
  state has no row change for a delta to carry, and touching the origin per-fork
  would re-stamp it (its `change_xid`, below) and re-send it to every other
  caller), `change_xid` (`xid8 NOT NULL DEFAULT pg_current_xact_id()` — the
  sync-token stamp, Spec 03.3; see below). No image in v1 (text-only picker);
  `image_key` is a reserved post-v1 addition.
- **muscle_group**, **equipment** — small reference tables driving filters.
  `TEXT` natural-code primary keys (`chest`, `barbell`) so they read directly in
  API payloads (Spec 03.1). These codes are **immutable once shipped** — never
  removed or renamed in place (no `is_active` column here, and `exercise` rows
  reference them by value); retiring one is a deliberate data migration
  (add the new code, migrate referencing rows, drop the old).

Rules:

- **Global rows are append-only.** Their `name` / `modality` / `catalog_key` are
  never mutated in place once users can have history against them. To change the
  catalog you add a new row and set `is_active = false` on the old one (still
  resolvable for history, hidden from pickers). Curated (`owner_user_id IS NULL`)
  rows are never deleted; custom rows go on account purge via `ON DELETE CASCADE`.
- **`change_xid` is the catalog's sync stamp, set by a trigger** (Spec 03.3,
  migration `0004_exercise_change_xid`). A `BEFORE INSERT OR UPDATE` row trigger
  sets `change_xid := pg_current_xact_id()` on every write, so no write path
  (API create/fork/patch/soft-delete, the seed's raw SQL, a future path, an ad
  hoc fixture) can forget to stamp it; a supporting index serves the delta's
  `change_xid >= since` predicate (§5.2). One transaction is one xid, so all
  writes of one seed revision share a single `change_xid` — that, not a shared
  `updated_at`, is what keeps a revision from being split across deltas.
  `updated_at` stays application-stamped and display-only; the trigger is a
  deliberate, narrow exception to "the app stamps its own timestamps, no DB
  triggers" because sync correctness needs *every* write stamped. The trigger
  does not fire on `DELETE`/`TRUNCATE` or under `session_replication_role =
  replica`, which is why the next rule exists.
- **Application code never hard-deletes an `exercise` row.** Global rows are
  retired (`is_active = false`), custom rows are soft-deleted, and the only hard
  delete is the account-purge `ON DELETE CASCADE`, which removes rows visible
  only to the purged user. A hard delete sends no tombstone, so a delta could
  never tell other callers the row is gone — any future code that hard-deletes a
  row other users can see must first give it a tombstone (Spec 03.3 §4).
- **Editing a global exercise is copy-on-write:** a user edit forks a row with
  `owner_user_id = <user>`; that user's *future* `workout_exercise`s point at the
  fork, past ones are untouched.
- **Changing an exercise's type** (Spec 03.4, Q33): `PATCH /v1/exercises/{id}` (and the
  `/fork` overlay) may change `modality` freely while the exercise's **lineage** has no
  logged set; once it has one, only to a type with the same required and forbidden
  measures (today only `weight_reps` ↔ `weighted_bodyweight`), else `409
  exercise-type-locked`. "Logged" means any `set_entry` of the caller's, any set type,
  live or finished, under the lineage root or the caller's forks of it. The change writes
  only the `exercise` row: workout cards keep their `modality_snapshot`, records are
  untouched, routines are not checked.
- A user's custom exercise is visible only to them. The API allows duplicate
  custom-exercise names (a client that must avoid one checks first, Spec 10.4). Custom exercises are never
  auto-merged into the global catalog (moderation cost); an internal tool can
  promote good ones later.

### 4.3 Routines (templates)

- **routine** — `user_id`, `name` (1–80, trimmed, unique per user
  case-insensitively), `notes`, `created_at`, `updated_at`. **Hard delete only**
  (Spec 09 D4): past workouts are self-contained, and `workout.routine_name_snapshot`
  keeps History able to name a deleted routine. Limits: ≤50 routines per user,
  ≤30 items per routine, ≤8 members per superset group. Routines are private to
  their user.
- **routine_item** — `routine_id`, `position`, `exercise_id`, `target_sets`,
  `target_reps_low`, `target_reps_high` (both or neither, low ≤ high), `target_rpe`
  (nullable; stored as tenths, half steps; kept but not shown in the UI, Q23), `rest_seconds`, `notes`,
  `superset_group SMALLINT NULL` — items in the same routine sharing a non-null
  value are performed together; `position` gives order, so interleave sequence is
  derivable. Circuits (3+ exercises) are the same construct with N members. UX is
  Tier B (§2 item 8, Q5 resolved). A routine has at least one item and may list the
  same exercise more than once. Groups are normalised by the server to a dense 1, 2, 3 … by first
  appearance and each has 2–8 members. A routine is edited by **whole replace**
  (`PUT` with the full ordered item list); item ids are not stable across edits.
  `target_sets`, `target_reps_low` and `target_reps_high` are **derived by the server**
  from the item's planned sets on every write (below) — the one exception is an item with
  no planned sets, which keeps a rep range exactly as a legacy-form write sent it
  (Spec 09.1 §6.2, O1).
- **routine_item_set** — *planned sets* (Spec 09.1): `routine_item_id` (cascade),
  `position` (0–19, unique per item), `set_type` (`warmup` | `working` | `drop` |
  `failure`, default `working`), `reps_low` / `reps_high` (both or neither, 1–100,
  low ≤ high), `weight NUMERIC(7,3)` + `weight_unit` (`kg` | `lb`, present together;
  stored as typed, §4.8; never converted when the profile unit changes). ≤ 20 rows per
  item. **Rows are the single source of truth**: `routine_item.target_sets` = the row
  count, `target_reps_low` / `high` = the lowest / highest rep bound across the rows.
  By exercise type: weight+reps and weighted-bodyweight rows plan reps and weight;
  bodyweight rows plan reps only (weight is a `422`); duration and distance rows carry a
  set type only in v1 (planned duration / distance is FI-11). No per-set RPE — the item's
  `target_rpe` stays. A routine write sends either `sets` (rows) or the legacy
  quick-line fields, which the server expands into N identical `working` rows, so a client
  that predates planned sets keeps working. Migration `0010` backfills existing items.
- **routine_section** — *sections* (Spec 09.2): `routine_id` (cascade), `position` (0–7,
  unique per routine), `name` (1–40 characters, trimmed, free text, duplicates allowed — the
  UI's one-tap starters are Warm-up, Main, Accessory, Finisher, Cooldown but the stored value
  is plain text), `notes` (1–2 000, nullable). ≤ 8 per routine. `routine_item.section_id`
  (nullable, `ON DELETE SET NULL`) places an item in a section. **Optional everywhere**: a
  routine may have no sections, an item may be loose, a section may be empty. **Invariants**
  (enforced on every routine write, shared with the editor in `@sin/core` `sections.ts`): loose
  items come first, then each section as one contiguous run in section order; a superset group
  never spans a section boundary. Sections travel inside the whole-document `PUT` with
  request-local keys (items reference a section by `sectionKey`; keys are never stored), so a
  body with no `sections` has none. Migration `0011`. A section may also have a **timer** (Spec 09.5, Q35, migration `0018`): `timer_format` (`set_timer` | `amrap` | `time_cap`, NULL = untimed) with the plan columns `timer_round_s` + `timer_rounds` (Set Timer), or `timer_cap_s` (AMRAP; Time Cap, NULL = "For Time"), policed by one CHECK; it travels as `sections.<j>.timer` in the whole-document `PUT` and as a nested discriminated `timer` object in the DTO.

Starting a workout from a routine **snapshots** it: the routine's items are copied
into `workout_exercise` rows at that moment — including the five targets,
`superset_group`, the item's notes (Spec 09 D22, amended 2026-10-11), its planned
sets (`workout_planned_set`, Spec 09.1) and its section (`workout_section` / `section_id`,
Spec 09.2) — and `workout.routine_id` / `routine_name_snapshot` / `routine_notes_snapshot`
(the routine's own note, kept apart from the lifter's `workout.notes`) are set. Later
edits to the routine do not change past workouts; deleting the routine does not
damage them (`workout.routine_id` is `ON DELETE SET NULL`; the name snapshot
survives). See Spec 09.

A routine may be a **one-off** (Spec 09.3, Q29): `routine.one_off_until timestamptz NULL` is both the
mark and the expiry (NULL = ordinary; created + 14 days; set only at create, cleared by Keep or a finish
with `keepRoutine`, never edited or extended). `GET /routines` serves one-offs first, newest created
first, then by `lower(name)`, `id`; one-offs count toward the 50.

### 4.4 Workouts (performed sessions) — the hot path

- **workout** — `user_id`, `title`, `notes`, `started_at timestamptz`,
  `ended_at timestamptz` (NULL while in progress), `local_date DATE`,
  `tz_offset_minutes SMALLINT`, `client_generated_id UUID` (client-supplied,
  unique per user — **idempotency key**, §6), `source` (the shipped `CHECK`
  admits `'manual'` and, since Spec 19.0's `0016`, `'hevy'` — `healthkit` /
  `google_fit` / … reserved values are added by the migration that adds their
  importer, since widening a `CHECK` literal list is additive while shipping
  values nothing can write is not; `'hevy'` ships a release before its writer,
  Spec 19.1, for the response-field rollout, Q34). `routine_id uuid NULL REFERENCES routine(id) ON DELETE SET NULL` and
  `routine_name_snapshot text NULL` are set when the workout is started from a
  routine (Spec 09; closes Spec 05.0 D36); `routine_notes_snapshot text NULL` (1–2 000)
  holds the routine's own note at that moment (Spec 09.2). `WorkoutDetail.routineIsOneOff` (Spec 09.3) is derived from the live routine row (true while the routine exists and carries the mark), not stored. `planned_duration_s integer NULL` (0–86 400) is a live workout's "took": set by Change Time, consumed by the client's Finish (`endedAt = started_at + took`), cleared by the finish itself and forbidden on a finished row by a CHECK (Spec 07.4, migration `0012`). `local_date` / `tz_offset_minutes` are derived at write time and re-derived **only when `started_at` is changed** (Change Time, Spec 07.4); a finished workout's set `completed_at` values always lie within `[started_at, ended_at]`.
- **At most one in-progress workout per user** is a database invariant: a
  partial unique index on `user_id WHERE ended_at IS NULL` (Spec 05.0 D38).
- **workout_exercise** — `workout_id`, `position`, `exercise_id`,
  `exercise_name_snapshot`, `modality_snapshot`, `notes`. The snapshots make a
  past session render correctly forever, independent of later catalog changes
  or a deleted custom exercise. Spec 09 adds `superset_group SMALLINT NULL`
  (any 1–99; a group of one is allowed on a workout) and the routine-target
  snapshots `target_sets`, `target_reps_low`, `target_reps_high`, `target_rpe`
  (tenths), `rest_seconds` — all NULL for a manually added exercise. The same
  exercise may appear more than once in a workout (already so: Spec 05.0 AC10).
  Spec 09.2 adds `section_id uuid NULL` (`ON DELETE SET NULL`), the exercise's snapshotted
  section. `notes` is the **session note**: copied from the routine item at start (Spec 09
  D22) and editable during the workout through `PATCH /workout-exercises/{id}` (Spec 10.3,
  queued in the offline outbox); an edit stays in that workout and never writes back to the
  routine.
- **workout_section** — a workout's sections (Spec 09.2, made writable by Spec 09.4): `workout_id`
  (cascade), `position`, `name`, `notes`, the same columns and CHECKs as `routine_section`, plus
  `added_in_workout boolean NOT NULL DEFAULT false` (the origin: copied = false; migration `0014`).
  Written by the start copy (empty sections included — a section note such as
  "5 min rower" is an instruction without an exercise); none for a manual workout or one
  started before migration `0011`. Returned as `sections` on the workout detail, with
  `routineNotes` and `sectionId` per exercise. Exercises added during the workout are loose and
  appended at the end unless the workout has a section added in it (Spec 09.4: then a plain add joins the last section). Spec 09.4 adds `POST /workouts/{id}/sections`, `PATCH`/`DELETE /workout-sections/{id}` and `sectionId` on `PATCH /workout-exercises/{id}` (the only way to change `section_id`; the server places the exercise and drops it from its superset). The workout side is stored
  **as sent** — the contiguity and superset-in-a-section invariants are the routine editor's
  and routine write API's, not workout-side constraints — so every consumer tolerates a loose
  tail and groups by maximal runs. Spec 09.5 adds the same four `timer_*` columns (copied from the routine's section by the start, then the workout's own), the **result** (`result_rounds`, `result_reps`, `result_finish_s`, `result_capped`: an AMRAP's rounds + reps, a Time Cap's finish time or, when the cap was hit, how far she got) and the child table **`workout_section_round`** (`workout_section_id` cascade, `round_no` 1–100, `seconds`, primary key `(section, round_no)`): a Set Timer's per-round durations, or an AMRAP / Time Cap's clock readings at each round's end. Round times and the result are written by keyed `PUT`/`DELETE` routes ("set round 3", never "append"), so the offline outbox can replay them; the score is derived by one pure `@sin/core` function, never stored. Exercises still log their own sets; records read `set_entry` only.
- **workout_planned_set** — the snapshot of a routine item's planned sets (Spec 09.1):
  `workout_exercise_id` (cascade), `position`, `set_type`, `reps_low` / `reps_high`,
  `weight` + `weight_unit`, the same columns and CHECKs as `routine_item_set`. Written
  **only** by the start copy, never edited (later routine edits never change a past
  workout); none for a manually added exercise or a workout started before migration
  `0010`. Returned as `plannedSets` on each `WorkoutExercise`. It is a plan, not data:
  no `set_entry` is created from it, the finish rule and the PR engine never read it,
  and in the session (Spec 10.2) the n-th logged set simply consumes the n-th row — the
  entry-row draft is prefilled from it ("Set 3 of 4"), and only a lifter's Log tap makes
  a set.
- **A workout's exercise `position`s are the dense zero-based sequence
  `0 … n-1`**, unique per workout (Spec 05.0 D41).
- **set_entry** — `workout_exercise_id`, `set_number`, `set_type`
  (`warmup` | `working` | `drop` | `failure`). Nullable measure columns:
  `reps`, `weight`, `weight_unit`, `weight_kg` (**stored generated column** =
  `weight` normalised to kg), `distance`, `distance_unit`, `distance_m` (generated),
  `duration_s`, `calories` (`SMALLINT`, whole numbers, no unit — Spec 05.3, migration `0015`), `rpe` (kept but not shown or entered in the UI, Q23), `is_complete BOOL`, `completed_at`, and a nullable
  `client_generated_id UUID` (optional create idempotency key, unique per
  `workout_exercise_id` — Spec 05.1 D15).
  Which measures are required is validated per `modality` in `packages/core`, not
  by DB `CHECK`s, so an in-progress row can be half-filled. A set of any type can
  be marked `is_complete` only once it has each measure its modality requires
  (the per-modality table is Spec 05.1 §6.1, extended by Spec 05.3 §6.1 with the
  `calories`, `weight_distance` and `weight_duration` rows and a `calories` measure that
  every other modality forbids; a failed attempt is `reps: 0` plus
  the weight — Spec 05.1 D14). One integrity rule is enforced at finish: every
  `working` set must have each of those measures; `warmup`/`drop`/`failure`
  sets are exempt. A set is addressed by its own `SetEntryId` (`POST` to create,
  `PATCH`/`DELETE` by id — Spec 05.1 D1); `(workout_exercise_id, set_number)` is an
  internal, append-only ordinal, not a client-facing address.

Concurrency: two tabs editing the same in-progress **or finished** workout are last-write-wins
per row (per set once `set_entry` exists); `updated_at` is returned so a client
can detect it lost a race. Writes to a finished workout additionally serialize per user on the PR
advisory lock (Spec 07.4). Full conflict resolution is out of scope while there
is one (web) client.

### 4.5 Personal records (derived cache)

- **personal_record** — `id`, `user_id`, `exercise_id` (the **lineage root**, below),
  `record_type`, `value numeric(14,3)` (canonical units; widened from `(12,3)` by Spec 05.3 for second-valued records), `unit`,
  `previous_value numeric(14,3) NULL` (the best of that type from strictly-earlier
  workouts), `source_set_entry_id`, `workout_id`, `achieved_at` (= the workout's
  `started_at`), `local_date`, `created_at`. One row per
  `(user_id, exercise_id, record_type)`. All four FKs are `ON DELETE CASCADE`.
  Spec 07.0 §4 owns the table (migration `0008`).

v1 tracks **seven** record types, decided per modality (the first four: Spec 07.0 D2, 2026-10-06,
supersedes the three-type decision of 2026-08-30; the last three: Spec 05.3, 2026-10-25). A set qualifies if it is a
`working` set in a **finished** workout; warmup/drop/failure are excluded, and
`is_complete` is **ignored** (finish integrity already guarantees the required
measures, and many users never tick the box). Eligibility uses the set's own
`workout_exercise.modality_snapshot`:

| `record_type` (`unit`) | Rule | Modalities |
|---|---|---|
| `heaviest_weight` (`kg`) | max `weight_kg` where `reps ≥ 1`; for the weighted carry / hold, where `distance_m > 0` / `duration_s ≥ 1` | `weight_reps`, `weighted_bodyweight`, `weight_distance`, `weight_duration` |
| `best_est_1rm` (`kg`) | max Epley e1RM = `weight_kg × (30 + reps) / 30`, rounded half-up to 0.001 kg, only sets with `1 ≤ reps ≤ 12` | `weight_reps`, `weighted_bodyweight` |
| `best_set_volume` (`kg_reps`) | max `reps × weight_kg` over a single set | same |
| `max_reps` (`reps`) | max `reps` where `reps ≥ 1` | `bodyweight_reps` |
| `max_calories` (`cal`) | max `calories` where `calories ≥ 1` | `calories` |
| `max_distance` (`m`) | max `distance_m` (canonical meters) where `> 0`, whatever the load | `weight_distance` |
| `max_duration` (`s`) | max `duration_s` where `≥ 1`, whatever the load (the longest hold) | `weight_duration` |

`duration` and `distance_duration` exercises have no PRs in v1 (Spec 05.3 adds records only for the three new types). For
`weighted_bodyweight` the weight is the **added load only** — a
body-weight-inclusive total waits for the `body_metric` table. For `weight_distance` and `weight_duration` the weight is the **total carried or held**; volume and e1RM need reps, so they stay on the two rep-load types. A weight-based type
also needs `weight_kg > 0`; a value of 0 is never a record. Deferred:
`rep_pr_at_weight` (a set of rows, not one) — revisit post-v1.
History's `recordCount` counts the records a workout holds now other than `best_set_volume` (Spec 07.3), matching the finish summary, which does not list set-volume records (Spec 17.2).

**Rules.** *Exact arithmetic:* weights are compared as integer thousandths of a kg,
never floats. *Ties:* the earliest set with the best value keeps the record —
equalling is not a new PR. *Chronology:* the workout's `started_at` (then workout
id, `workout_exercise.position`, `set_number`), **not** `ended_at`, so a backdated
session takes its real place in history and can take a record from a later
workout. *Fork lineage:* a set's lineage root is
`COALESCE(exercise.forked_from_exercise_id, exercise.id)` — forking never chains
(Spec 03.2), and a user may fork a global row more than once, so the origin and all
of the user's forks share one root; a from-scratch custom exercise is its own root.
`exercise_id` holds the root; the API also returns the source set's own exercise id
and name snapshot.

**Write path.** PRs are written transactionally, by recomputing the **touched
lineages from their full qualifying history** — one function used for all three
triggers (Spec 07.0 D8, Q13): finishing a workout (inside Spec 05.0's finish
transaction, after the `ended_at` write and 05.1's integrity check), deleting a
finished workout (same transaction as the delete; deleting an in-progress workout
touches nothing), and the `records:rebuild` release step (like the catalog seed, run
after `migrate deploy`; idempotent; `--user` for one account). A per-user advisory
lock serializes the writers; a recompute failure rolls the finish back. Lock order, everywhere: PR lock → one-off routine row → workout row → child rows (Spec 09.3: the finish of a workout from a one-off takes the routine row before the workout row, as the routine `DELETE` does through `SET NULL`). **Finished
workouts are editable (Spec 07.4, Q27 — this replaces "finished workouts are immutable in
v1")**, and every edit that can change a record calls the same recompute in the edit's own
transaction, PR lock first: a set created, changed (`setType`, `reps`, weight) or deleted
(only a `working` set matters), an exercise removed, exercises reordered (only roots
occurring twice in the workout, because position is a tie-break), and a change of the
workout's `started_at` (all its roots — `achieved_at`, `local_date` and every
`previous_value` depend on it). A duration-only change, a note, a superset group, a title
and an added exercise recompute nothing. The table is a cache,
not a source of truth — rebuildable from `set_entry` at any time. All PR math lives
in `packages/core` with exhaustive tests (Risk R4).

### 4.6 Progress views

Charts (volume over time, e1RM trend, top-set weight) are **queries**, not stored
entities, computed from `set_entry` + `weight_kg`. If aggregate latency becomes a
problem at real data sizes, add a nightly `exercise_daily_stat` rollup — not in
v1 (§1.3 scale does not need it). **Volume** in every view — the history row's
`totalVolume` (Spec 07.1), the progress series, `best_set_volume` — means `set_type =
'working'` sets of the rep-load modalities (`weight_reps`, `weighted_bodyweight`; the three Spec 05.3 types have no volume) with
`best_set_volume`'s eligibility (reps ≥ 1, `weight_kg > 0`), one function in
`@sin/core` (`setVolumeMilli`). A **progress series** has one point per finished workout
(Spec 07.2); over a lineage's full history the series maximum of `topSetWeight`,
`bestE1rm`, `maxReps` and (Spec 05.3) `maxCalories`, `maxDistance`, `maxDuration` equals the PR of `heaviest_weight`, `best_est_1rm`,
`max_reps`, `max_calories`, `max_distance` and `max_duration` (both go through one per-type eligibility function, `setRecordValueMilli`).
`totalVolume` is a **session sum**, not `best_set_volume` (a single-set best), so that
guarantee does not cover it. The UI draws these series client-side (Spec 08.1, Q17): any
metric may be `null` at a point and is then **skipped, never plotted as zero**, and the
client never recomputes an e1RM, top set or volume — it plots the served numbers (the
only client arithmetic is the kg → lb display conversion).

### 4.7 Future-proofing for wearable import (design only — no v1 tables beyond `workout.source`)

A later `external_activity` table (`user_id`, `provider`, `provider_activity_id`
unique-per-provider, `raw JSONB`, `linked_workout_id`) gives idempotent import and
dedup without touching the v1 schema. *(The first importer, Hevy (Spec 19.0, Q34), did not wait for this table: `hevy_link` records the Hevy workout id of each SIN workout that has a Hevy copy, whichever way it got one, plus a claim for exports and a tombstone for deleted workouts.)*

### 4.8 Unit handling in detail

- `set_entry.weight` + `weight_unit` = exactly what the user typed. Displayed back
  verbatim.
- `set_entry.weight_kg` = `GENERATED ALWAYS AS` (kg if unit is kg, else
  `weight × 0.45359237`) `STORED`. Every PR comparison, chart, and aggregate uses
  only `weight_kg`. Same pattern for `distance` / `distance_m`: meters if unit is
  `m`, `distance × 1000` for `km`, `distance × 1609.344` for `mi`, `distance × 0.3048` for `ft`
  (every unit named explicitly in the expression, no catch-all arm; the column was rebuilt by `0015`, Spec 05.3 D18).
- **Allowed units:** `weight_unit ∈ {kg, lb}`, `distance_unit ∈ {m, km, mi, ft}`.
  Canonical units are **kg** and **meters**. The conversion factors above are
  defined once in `packages/core` (Spec 02); the `weight_kg` / `distance_m`
  generated columns (Spec 05.1) must use the identical constants — drift between
  them silently corrupts PRs and charts (R4).
- A **planned** weight (`routine_item_set`, `workout_planned_set`) is stored the same way —
  value plus unit, as typed, with no generated canonical column (nothing compares or
  aggregates plans; PRs and volume read `set_entry` only).
- `user.unit_preference` only chooses the default unit for *new* input and the
  unit for rendering aggregate/derived numbers; it never rewrites stored rows.

### 4.9 Deletion matrix

| Entity | On user action | On account deletion |
|---|---|---|
| `user` | soft (`deleted_at`), tokens revoked (every `/v1` call → `403 account-deleted`) | hard purge after 30-day grace (manual `account:purge` CLI in the beta) |
| `workout`, `workout_exercise`, `set_entry` | hard delete (cascade) | hard purge |
| `set_entry` during an in-progress session | hard delete (transient editing) | — |
| `set_entry` / `workout_exercise` of a **finished** workout | hard delete (Spec 07.4); refused with `409 workout-would-be-empty` if it would leave the workout with no sets — delete the whole workout instead | hard purge |
| `routine` (+ `routine_item`, `routine_item_set`) | hard delete (cascade); `workout.routine_id` nulls, name snapshot kept — Spec 09 / 09.1 | hard purge |
| `routine` of a one-off (Spec 09.3) | removed in the same transaction as the finish of a workout started from it (after the records recompute), unless `keepRoutine`; removed by the lazy expiry sweep after 14 days (never while a live workout was started from it); Keep clears the mark | hard purge |
| `workout_planned_set` | follows its `workout_exercise` / `workout` (cascade); never user-edited | hard purge |
| `routine_section` | follows its `routine` (cascade); replaced by the routine `PUT`; deleting one leaves its items (`section_id` → NULL) — Spec 09.2 | hard purge |
| `workout_section` | follows its `workout` (cascade); user-removed by `DELETE /workout-sections/{id}` (Spec 09.4): its exercises are kept, `section_id` NULL, later sections renumbered | hard purge |
| `workout_section_round` | follows its `workout_section` (cascade); cleared by `DELETE …/round-times/{round}` (idempotent) or discarded with a format change (Spec 09.5) | hard purge |
| custom `exercise` | soft (`is_active = false`) — history snapshots keep sessions readable | hard purge (`exercise.owner_user_id` is `ON DELETE CASCADE`; `workout_exercise.exercise_id` is also `ON DELETE CASCADE` — Spec 05.0 D37 — so no purge-ordering step is needed) |
| `personal_record` | never user-deleted; recomputed (finish, delete, and every Spec 07.4 edit that can change a record) | hard purge |
| `body_metric` | hard delete | hard purge |

Account deletion (Spec 11, Q19): `DELETE /v1/account` immediately sets
`user.deleted_at`, which is the whole of "token revocation" — `resolveUser` then
answers `403 account-deleted` on every `/v1` call from every device, and the response is
`202 { deletedAt, purgeEligibleAt }`. There is no self-service undo; the owner can clear
`deleted_at` by hand before the purge. For the beta the hard purge is a **manual CLI**
(`account:purge`, dry run by default, run by the operator; `--confirm` deletes accounts
soft-deleted more than 30 days ago in one transaction each, taking the per-user PR lock
first): one `DELETE FROM "user"` cascades every user-owned row. There are no bucket
objects yet. The scheduled purge job (a Render cron) and bucket cleanup return at GA.
Data export: `GET /v1/account/export` returns **one synchronous JSON document** (profile,
custom exercises including soft-deleted, routines, and every workout with its sets — the
same shapes the read routes return, from one consistent database snapshot; not
`personal_record`, which is a rebuildable cache, and not the global catalog). Because a
deleted account is locked out, the UI offers the download before the delete. The async
archive to a bucket with a signed URL, and a CSV format, are deferred to GA.

---

## 5. Key Subsystems

### 5.1 Auth & session

The web app runs the **Auth0** Authorization Code + PKCE flow
(`@auth0/auth0-react`), receiving a short-lived access token (JWT) plus refresh
token — both held **in memory only** in the browser (`cacheLocation: 'memory'`,
refresh-token rotation on), never in `localStorage` / `sessionStorage` / a
readable cookie; a cold page load re-establishes the session with a silent
redirect against the still-valid Auth0 session cookie (Spec 04.0 §7, Q12). A
future React Native app uses `react-native-auth0` against the same tenant. The
access token carries an `audience` identifying our API. The API
validates every request's JWT against Auth0's cached JWKS (issuer + audience +
expiry checked); no server-side session store. First request for an unknown `sub`
provisions a `user` row. Authorization in v1 is simply "row belongs to `user_id`"
— enforced in a repository layer, not scattered through handlers.

Auth0 config that matters: one **API** (audience) + one **SPA application**;
email/password + Google + Apple connections; refresh-token rotation on; a login
Action that surfaces `email` in the token. Custom domain deferred to GA.

### 5.2 Exercise catalog delivery

Global catalog is small (hundreds of rows). The client pulls the whole
caller-visible set — global rows **plus that user's custom rows** — from a single
`GET /v1/exercises` on first launch and caches it locally, keyed by `id`. Later
refreshes are incremental (Specs 03.1 / 03.3):

- `If-None-Match` with the stored strong `ETag` (computed over the serialized
  catalog content **and the `since` cursor** — the token value, or a fixed
  `"full"` sentinel on a full pull — so a delta can't collide with an earlier
  full pull; the response's own `syncToken` is *not* in the hash, so an
  unchanged catalog still gets a `304`) → `304` when nothing changed;
- `?since=<syncToken>` → only rows changed since, **including** rows retired
  since (flagged `is_active = false`) so the client drops them;
- every `200` carries a `syncToken`, which the client stores and sends as the
  next `since`. It is a **commit-ordered sync token**, not a timestamp: the
  Postgres snapshot horizon `pg_snapshot_xmin(pg_current_snapshot())` (the
  oldest transaction id still in flight; every transaction below it has
  already committed or aborted), formatted as the opaque string `"1.<xid>"`.
  Every `exercise` row carries a trigger-stamped `change_xid` (§4.2), and a
  delta returns the visible rows with `change_xid >= since`. Because a
  transaction is assigned its xid only when it first writes, a writer that is
  still uncommitted — or blocked before its first write — can only ever land
  at or above the token, so no row is permanently skipped; rows may be
  re-sent while a long-running writer holds the horizon back (extra payload,
  never a gap), and clients de-duplicate by `id`. The token **must** be
  computed in the same SQL statement that scans the rows (a second, later
  query would take a later snapshot and reopen the gap), and sync reads must
  run on the primary, not a lagging replica. The design and its correctness
  argument are Spec 03.3 (D24–D33), which replaced a `MAX(updated_at)`
  timestamp cursor that could skip a row under concurrent writers (BL-1,
  issue #23);
- **`410 sync-token-expired`:** a `since` whose xid is ahead of the server's
  current snapshot can never be a legitimate token — it is crafted, or it
  predates a database restore/cluster move (xids reset backwards while the
  client's stored token does not). The server answers `410` (problem+json,
  `Cache-Control: no-store`, logged at `warn`) instead of clamping, because a
  clamp would silently skip every write made after the restore. A `since` that
  fails the wire format (`^1\.(0|[1-9]\d{0,18})$`) is a `422 validation-error`.
  Restore-epoch hardening (a restore that has caught the xid counter back up
  to a stale token) is deliberately deferred, with a hard deadline before the
  Spec 15 cutover (Spec 03.3 D27);
- **Consumer rules.** The token is opaque — store it and replay it verbatim;
  never parse or compare it. Always overwrite the stored token with the one
  from the latest good `200` (never `max`); a `304` has no body, so the client
  keeps its stored token (safe: the next delta re-sends rows, never skips
  them). On a `410`, discard the cached catalog and do a full pull that
  **bypasses the HTTP cache** (e.g. `fetch(url, { cache: "reload" })`) —
  otherwise the browser revalidates, gets a `304` (the `ETag` excludes
  `syncToken`, and after a restore the bytes are often identical) and hands
  back its cached `200` body carrying the same stale token that caused the
  `410`, looping forever;
- the first real consumer, the exercise picker (Spec 06.0), goes further and
  sends `cache: "no-store"` on **every** catalog sync, and does not use the
  exercise endpoint's `ETag` at all: its store owns the sync state and
  persists it, the sync token is the only change detector it needs, and the
  API's CORS policy does not expose `ETag` to a cross-origin client. The
  `410` rule above is therefore satisfied by construction;
- `updated_at` is **no longer a sync input**. It stays application-stamped and
  in the `Exercise` DTO and the `ETag` hash, but only for display ("last
  edited"), history, and cache validation; nothing derives a cursor from it.

The reference tables (`muscle_group`, `equipment`) are served by their own
`ETag`d endpoints; their natural-code IDs are immutable once shipped. Curated
catalog data is authored as checked-in JSON and loaded by an idempotent,
append-only seed run as a release step — a **manual** step for M1/staging (Render
free has no pre-deploy hook), automated with the paid plan.

### 5.3 Logging & connectivity

Decision: **online required** for v1 (per project constraint). The web app keeps
the in-progress workout in a client cache (the server's copy, refetched on mount
and window focus). A set row is created **when the lifter taps "Log set"**: the
entry row is a local draft, and the `POST` carries a complete set
(`isComplete: true`, every measure its modality requires) and a client-minted
`clientGeneratedId`. Later edits are an explicit save and `PATCH /sets/{id}`,
which is idempotent (Spec 05.1 §5). There is no debounced autosave of half-filled
rows: planned targets are UI placeholders, never server rows. Because the create
carries a key, a create whose outcome is unknown can be replayed safely: the
server returns the stored set instead of adding a second one (§6 "Idempotency").
Spec 06.1 shipped this loop with pessimistic writes; Spec 06.2 queues set
writes (create / edit / delete) in a persisted outbox, shows them at once with a
"Not saved yet" state, sends them in order with backoff, and blocks **Finish**
while any remain. Exercise-structure writes, start and finish stay pessimistic
(workout-exercise create has no idempotency key) and say "You're offline" when
the network is down. Spec 10.7 adds two more queued kinds, a section's round time and its
result (final values keyed by round or section, safe to replay by Spec 09.5's routes); a
section's timer, name and note stay pessimistic, and Finish waits for these too. Spec 06.5 adds persisted entry-row drafts and a logout
warning for unsaved sets; Spec 06.6 adds multi-tab co-operation (Web Locks) and
a Playwright offline run.

**Editing a finished workout and Change Time are online-only (Spec 07.4, Q27).** They
go through the same set / exercise / workout routes but not the outbox: the outcome depends
on the server (records recompute, the empty-workout guard, time bounds), so a failed write is
shown as failed rather than queued and rejected later. Every such request is retry-safe. A queued live write that reaches a workout finished on another device is applied, and its caches refreshed; the gone path keeps unsent writes (Spec 18.0).

The gym-case mitigation (Risk R1) is implemented for set writes by Specs 06.2 /
06.5 / 06.6: the outbox lives in `localStorage` (behind `StorageAdapter`), so a dropped
connection or a closed tab does not lose a logged set. With memory-only tokens
(Q12) a reloaded tab cannot sign in offline, so the queue drains after the next
sign-in. The outbox and its pure projection are the seam a future PWA
service-worker or React Native app would build on.

> Connectivity is still the weakest point in the v1 plan for a gym product.
> Flagging it here so the decision stays deliberate and visible.

### 5.4 Wearable import (post-v1, not built now)

Read-only. A per-provider connector normalises an external activity into a
`workout` with `source != manual`, keyed by `provider_activity_id` for
idempotency. No changes to the logging path. Listed so §4 stays compatible. *(Hevy, owner-only, is built: a browser-driven import through bulk finished-workout writes, Specs 19.1 / 20.1, Q34.)*

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
- **Pagination:** opaque cursor (`?limit=&cursor=`), `next` cursor in the body
  (`null` on the last page). No offset pagination. **Cursor contract** (reference
  pattern, Spec 07.1 §6.2): a `v1.`-prefixed base64url token carrying the last row's
  sort-key tuple — keyset on a total order such as `(started_at, id)`, never an offset;
  timestamps travel as Postgres text, never through a JS `Date` (microsecond
  `timestamptz` vs millisecond `Date` can skip or repeat a row at a page boundary); a
  malformed cursor is `422 validation-error`; the cursor only positions within the
  caller's own rows, so it is unsigned. First user: `GET /v1/workouts`. **Exception:** `GET /v1/exercises` returns the whole
  caller-visible catalog un-paginated — it is bounded (low hundreds of rows) and
  pulled whole into a local cache; `since` (a sync token) bounds every later
  transfer (§5.2, Specs 03.1 / 03.3). **Second exception:** `GET /v1/personal-records`
  returns every matching record un-paginated — at most 4 rows per lineage root
  (Spec 07.0 §5). **Third exception:** `GET /v1/progress/exercises/{id}` returns the
  whole requested range un-paginated — one point per workout, bounded by training
  frequency (~100 points per year per exercise; Spec 07.2 D6).
- **Time:** RFC 3339 UTC, always. Client sends its own `started_at`/`completed_at`
  timestamps (device clock) plus the server records receipt time. For calendar
  fields (§4.0), the client also sends its current UTC offset; the server stores
  `tz_offset_minutes` and derives `local_date` from it, falling back to
  `user.timezone` when the offset is absent. A client-supplied `started_at`
  more than 5 minutes ahead of, or more than 7 days behind, the server clock
  is rejected (`422`); `ended_at` on finish is bound by the same 5-minute
  future window (Spec 05.0 §6.4, D47).
- **Idempotency:** workout creation uses `client_generated_id`; replaying the same
  id returns the existing resource, never a duplicate. Set creation takes an
  optional `clientGeneratedId`, unique per workout-exercise: replaying it
  returns the stored set (`200`), never a second row (Spec 05.1 D15). A
  `POST …/sets` that sends no key is not idempotent — a double submit creates
  two rows, the same accepted behavior as 05.0's add-exercise.
  `PATCH /sets/{id}` is idempotent (Spec 05.1 D1).
- **Contract:** DTOs are authored **once** as Zod schemas in `packages/core`;
  `fastify-type-provider-zod` wires them into Fastify route validation and
  handler typing, and `@fastify/swagger` **emits** an OpenAPI 3.1 document from
  them. The document is published (unauthenticated) at `/openapi.json` as the
  external contract — **public `/v1` surface only**, by **opt-in**: a route
  appears only with `config.published: true` (issue #10; everything else,
  including probe/health routes, is hidden by default), no internal host names —
  and is **drift-checked in CI** (re-emit + `git diff`). No client codegen — 
  consumer types come from `z.infer` on the shared schemas. The pipeline + the 
  `/v1/me` migration onto it is Spec 03.0; Spec 02' `MeSchema` is the first such 
  DTO and the pattern the rest copy. Error responses are documented too (issue #28): 
  every `/v1` operation lists each problem+json status it can return, `$ref`ing a shared
  `components.schemas.Problem`, with `type` narrowed to the exact problem URLs
  that status carries on that operation. Routes declare their domain errors in
  `config.problems` (documentation-only; `[]` when none); auth (401 / 403
  `account-deleted` / 503), 500, and the request-shape errors (422 for
  params / querystring; 413 / 415 / 422 for any method Fastify parses a body
  on — POST, PUT, PATCH, DELETE — whether or not the route declares one) are
  added centrally by `src/openapi/problem-responses.ts`. A published route with
  no `config.problems` fails boot, as does a published route outside `/v1/`.
- **Response schemas are field allowlists:** the Zod serializer strips unknown
  keys, so a handler cannot leak an unlisted column onto the wire (Spec 03.0).
  The allowlist is over **keys**, not value formats: a response schema asserts
  which fields appear and their type, not strict formats (`z.email()`, regexes,
  `Intl` checks) on values the server persisted from a trusted source. Format
  enforcement lives at ingress (Spec 03.0 P7).
- **HTTP caching (`/v1`)** — one policy, set by a `/v1`-scope `onSend` hook
  (`plugins/cache-policy.ts`), never by hand in a handler (issues #17, #18):
  every `/v1` response is `Cache-Control: no-store`, except a `GET` that serves
  a strong `ETag` and declares `config.httpCache: "revalidate"` (`/v1/exercises`
  and the reference tables), which gets `private, no-cache`; any status ≥ 400 is
  `no-store` regardless. `private` is what keeps per-caller content out of every
  shared cache; there is **no** `Vary: Authorization` — under `no-cache` the
  browser reuses a stored body only after a `304` to *this* caller's
  `If-None-Match`, i.e. when the bytes are exactly this caller's response, and
  `Vary` only cost a full re-download every time the in-memory token rotated —
  live for the SPA's reference-table queries, which use the browser HTTP cache.
  (The SPA's catalog bypasses the HTTP cache: its own store + `since` /
  `syncToken`, fetched `no-store` — Spec 06.0 AC15, §5.2.)
- **Response-field rollout:** a **new response field ships in the API one release
  before any client that reads it; rolling the API back past such a field also rolls
  the client back.** Response schemas stay strict (required-nullable, no
  `.default(null)` / `.catch` shim on the client or in `@sin/core`): a tolerant default
  would hide a contract break behind a target-less, ungrouped-looking workout, and the
  deploy order — API first, static web second, rolled back together — is what we
  control (Spec 10.1 D4; first users: `routineName` and the six `WorkoutExercise`
  routine fields from Spec 09; then `RoutineItem.sets` and `WorkoutExercise.plannedSets`
  from Spec 09.1, whose UI, Spec 10.2, merges only after the API is deployed and
  verified; then `Routine.sections`, `RoutineItem.sectionId`, `WorkoutDetail.sections` /
  `routineNotes` and `WorkoutExercise.sectionId` from Spec 09.2, whose UI, Spec 10.3, follows
  the same rule; then `Workout.plannedDurationSeconds` from Spec 07.4 Phase B, whose UI follows the same rule; then `Routine.oneOffUntil` and `WorkoutDetail.routineIsOneOff` from Spec 09.3, whose UI, Spec 10.5, follows the same rule; then `WorkoutSection.addedInWorkout` from Spec 09.4, whose UI, Spec 10.6, follows the same rule; then `RoutineSection.timer`, `WorkoutSection.timer` / `result` / `roundTimes` and `WorkoutSummary.timedSections` from Spec 09.5, whose UI, Spec 10.7, follows the same rule).
- **JSON casing:** wire DTOs are `camelCase` (`displayName`, `unitPreference`,
  `createdAt`); DB columns stay `snake_case`; the DTO layer maps between them.
  Established by Spec 01's `/v1/me`, pinned here.

### Representative endpoints

All paths are under `/v1`.

```
POST   /workouts                  { clientGeneratedId, startedAt, tzOffsetMinutes?, title?, notes?, routineId? }   # routineId copies the routine into the workout (Spec 09)
                                   → 201 + Location, or 200 on an idempotent replay
GET    /workouts/active           → the caller's one in-progress workout, or 404
GET    /workouts?limit=&cursor=   → { items: WorkoutSummary[], next } history list (Spec 07.1)
GET    /workouts/{id}            # exercises[] carry plannedSets[] (Spec 09.1; [] for a manual add / pre-0010 workout) and sectionId; the detail carries sections[] and routineNotes (Spec 09.2; [] / null for a manual or pre-0011 workout)
PATCH  /workouts/{id}             { title?, notes?, endedAt?, startedAt?, tzOffsetMinutes?, durationSeconds?, keepRoutine? }   # finish = set endedAt; → Workout + newRecords[] (Spec 07.0; [] unless a finish)
                                   # Spec 07.4 "Change Time": startedAt (+ tzOffsetMinutes) / durationSeconds on a live or finished workout; live durationSeconds is stored as the "took"; 409 workout-finished = re-finish only
                                   # Spec 09.3: a finish of a workout from a one-off removes the routine in the same transaction; keepRoutine: true (finish only, else 422) keeps it and clears the mark
DELETE /workouts/{id}            # whole session only, allowed finished or not
POST   /workouts/{id}/exercises   { exerciseId, position? }   # no position: joins the last section iff it was added in the workout, else the end (Spec 09.4)
POST   /workouts/{id}/sections    { name, notes? }   → 201, appended last, ≤ 8 (Spec 09.4; live or finished)
PATCH  /workout-sections/{id}     { name?, notes?, timer?, discardResult? }   # Spec 09.4; timer (Spec 09.5): { format: set_timer|amrap|time_cap, … } | null; a timer change that would not keep recorded data (a different format, removal, numbers that no longer contain it) needs discardResult: true, else 409 section-result-exists
DELETE /workout-sections/{id}     # 204; its exercises are kept, loose; later sections renumbered (Spec 09.4)
PUT    /workout-sections/{id}/round-times/{round}   { seconds }   → 200 WorkoutSection   # Spec 09.5: idempotent "set round N"; Set Timer = that round's duration, AMRAP / Time Cap = the clock when it ended; 409 section-timer-mismatch if the section's timer doesn't take it
DELETE /workout-sections/{id}/round-times/{round}   # 204, idempotent
PUT    /workout-sections/{id}/result   { rounds?, reps?, finishSeconds?, capped? }   → 200 WorkoutSection   # Spec 09.5: AMRAP rounds + reps; Time Cap finish time, or capped + how far she got
DELETE /workout-sections/{id}/result   # 204, idempotent
PATCH  /workout-exercises/{id}    { position?, notes?, supersetGroup?, sectionId? }   # sectionId (Spec 09.4): uuid | null, the server places it, never with position, drops it from its superset;   # supersetGroup: 1–99 | null (Spec 09); notes = the session note, key presence decides, null clears (pinned by Spec 09.2, used by 10.3)
DELETE /workout-exercises/{id}       # sets / exercises are writable on a finished workout too (Spec 07.4); 409 workout-would-be-empty if it would leave a finished workout with no sets
POST   /workout-exercises/{id}/sets   { clientGeneratedId?, setType?, reps?, weight?, weightUnit?, ... }
PATCH  /sets/{id}                     { same fields minus clientGeneratedId, all optional }
DELETE /sets/{id}                    # 409 workout-would-be-empty as above (finished workout, last set)
GET    /exercises?since=          → catalog (global + custom), ETag
POST   /exercises                 → custom exercise   # names are not unique server-side: a client creating
                                   # exercises in bulk checks the synced list first (Spec 10.4 AC27)
PATCH  /exercises/{id}            { name?, modality?, primaryMuscleId?, secondaryMuscleIds?, equipmentId? }   # own rows only; 409 exercise-immutable-use-fork on a built-in; 409 exercise-type-locked (Spec 03.4)
POST   /exercises/{id}/fork       { same fields, optional }   → 201 + Location   # "make your own copy" of a built-in; shares the origin's lineage; counts against the 500 cap
DELETE /exercises/{id}            # soft delete (is_active = false), 204, idempotent; built-in 403; never edits a routine
GET    /exercises/{id}/routines   → { routines: [{ id, name, oneOffUntil }] }   # the caller's routines whose items use exactly this exercise; no-store (Spec 03.4)
GET    /exercises/usage           → { exercises: [{ rootId, lastLoggedOn }] }   # last logged per lineage root, newest first; ETag (Spec 03.4)
GET    /progress/exercises/{id}?from=&to=   → { exerciseId, points[] }, un-paginated (Spec 07.2)
                                   # one point per finished workout: topSetWeight, bestE1rm, totalVolume, maxReps (each nullable);
                                   # {id} resolves through fork lineage (exerciseId = root); 404 if not visible; from/to inclusive on local_date
GET    /personal-records?exerciseId=&workoutId=   → { records[] }, un-paginated (Spec 07.0)
GET    /routines                  → { routines[] } with items inlined (each item with its planned `sets[]`, Spec 09.1), ETag (Spec 09)
GET    /routines/{id}             → Routine, ETag
POST   /routines                  { name, notes?, items[] }   → 201 + Location   # item = { exerciseId, sets[] | legacy targetSets/targetReps*, targetRpe?, restSeconds?, supersetGroup?, notes?, sectionKey? } (Spec 09.1); body also takes sections[] = { key, name, notes? } (Spec 09.2; none = no sections); oneOff?: true (Spec 09.3) marks it a one-off (PUT rejects the key)
POST   /routines/{id}/keep        # Spec 09.3: clears the one-off mark; idempotent, 204, no body, never checks the cap
PUT    /routines/{id}             { name, notes?, items[] }   # whole replace, last write wins
DELETE /routines/{id}             # hard delete; workouts keep routineName
GET    /account/export            → 200, one synchronous JSON document (Spec 11; Content-Disposition attachment; async bucket export deferred to GA)
DELETE /account                   → 202 { deletedAt, purgeEligibleAt }, soft-delete; purge is a manual CLI ≥ 30 days later (Spec 11)

# Hevy integration — owner-only (Q34): gated by HEVY_ENABLED_USER_IDS, 404 for everyone else, unpublished (an onRequest hook in a child scope, so the 404 comes before body parsing and rate limits)
GET    /hevy/status               → { enabled, pairCount, linkCount, recordsStale }   # the web's capability probe (404 = hide everything)
GET    /hevy/mapping              → { pairs[], sectionRules[] }, ETag
PUT    /hevy/mapping              { pairs[], sectionRules[] }   # whole replace (loading the mapping file)
PATCH  /hevy/mapping              { upsert?, remove? }   # on-screen pairing
GET    /workouts/{id}/hevy-link   → { state: none|sending|sent|changed, hevyWorkoutId, origin, syncedAt }
POST   /workouts/{id}/hevy-link   { relink? } → { mode: create|update, hevyWorkoutId, staleClaim, fingerprint }   # begin a send: the claim
PUT    /workouts/{id}/hevy-link   { hevyWorkoutId, fingerprint }   # complete
DELETE /workouts/{id}/hevy-link   # release a claim
POST   /hevy/import/workouts      { dryRun, workouts[≤25] } → { results[] }   # idempotent per Hevy workout id; source 'hevy'
POST   /hevy/import/finish        → { recomputed, rootCount }   # the one records rebuild
```

---

## 7. Infrastructure & Delivery

| Area | Approach |
|---|---|
| Repo | Monorepo: `apps/api`, `apps/web`, `packages/core`. pnpm workspaces. Added later without restructuring: `apps/marketing` (Next.js, at GA), `apps/mobile` (React Native), `infra/` (Terraform, Spec 15). |
| CI | Lint + typecheck + unit tests on every PR; `packages/core` purity check (no React / DOM / Node-only imports); OpenAPI 3.1 document re-emitted from the `packages/core` Zod DTOs and drift-checked (`git diff --exit-code`, no codegen — Spec 03.0); web app (`@sin/web`) lint + typecheck + Vitest/RTL unit + production `vite build` + a `render.yaml` CSP/header assertion (Spec 04.0); migration dry-run against a throwaway DB. |
| CD (v1) | Render blueprint (`render.yaml`). Merge to `main` → auto-deploy `staging`; git tag → promote the same API image + web build to `production`. Web app is a Render static site (CDN-fronted, Node 22 build) with a SPA fallback (`/* → /index.html`) and a CSP + security headers set in `render.yaml` (Spec 04.0 §11). |
| CD (production) | Spec 15: the CI `publish` job pushes one image per `main` commit to Artifact Registry; `deploy-prod` (owner-approved, by digest) deploys it to Cloud Run and the same commit's web build to Firebase Hosting. `infra/` is applied by hand, never from CI. (Replaces the phase-2 "build → ECR → ECS" plan.) |
| Migrations | Prisma Migrate; expand-contract, never destructive in a single release; run as a release step, not on app boot. |
| Secrets / config | Render env groups (staging); Secret Manager (production runtime) and the GitHub Environment `production` (CI), Spec 15. Nothing in the repo; per-environment. |
| Backups | Managed Postgres automated backups + PITR (Render, later RDS); periodic restore drills. Production (Spec 15, Neon free) has no backups yet: BL-27. |

---

## 8. Cross-Cutting Concerns

### 8.1 Observability

- **Logs:** structured JSON, one line per request, with a request id propagated
  from the client (`X-Request-Id`).
- **Metrics + traces:** OpenTelemetry SDK in the API (Spec 13.0). Staging pushes
  both over OTLP to Grafana Cloud (free tier); locally Prometheus pulls
  `:9464/metrics` and traces go to a local Tempo, with Grafana over both
  (`docker-compose.observability.yml`). RED per route
  (`http_server_request_duration_seconds`), Node runtime (event-loop p99, heap,
  GC), business counters (workouts started/finished, sets logged by modality),
  Prisma query spans under each request span. Span and metric attributes are an
  **allowlist** (no IPs, user agents, ids, paths, bodies — §8.2). Off unless
  configured. No uptime check on staging (Render free sleeps; Spec 01.1 adds it
  for prod). DB pool gauges wait for a Prisma driver adapter (BL-25).
- **Errors:** Sentry (or equivalent) on the web app and the API, releases tagged.
- **Product analytics:** privacy-respecting (PostHog — cloud free tier or
  self-hosted); event on `set_logged` with latency, never with health values in
  properties.

### 8.2 Privacy, security, compliance

- Training logs + body weight are **sensitive personal data**. GDPR / CCPA apply:
  export and delete are product features (§4.9, Spec 11), not manual ops tickets.
- **Do not** use training or body-weight data for advertising, and do not share it
  with third parties. No HIPAA exposure in v1 (no covered entities, no providers).
  When the native app ships, Apple/Google health-data disclosure rules apply — a
  post-v1 concern, noted so it is not a surprise.
- TLS 1.2+ in transit; encryption at rest for DB and bucket (managed).
- Least-privilege DB credentials for the API; no shared admin creds.
- Dependency scanning + Dependabot; secret scanning on the repo.
- Rate limiting at the API — Spec 05.2: a per-IP limit before auth, per-user
  write-rate groups and a per-user in-flight write cap (`429 rate-limited` +
  `Retry-After`), all in process memory on the single Render instance (Spec 15
  swaps in a shared store for multiple instances); Cloudflare-level limiting
  once the custom domain lands.
- CORS is an exact-match origin allowlist (the SPA origin per environment), never
  a wildcard or reflected `Origin`; tokens travel in the `Authorization` header,
  not cookies, so credentialed CORS stays off. Configured in the API from M0
  (Spec 01 §5.5). The allowed methods are one list (`CORS_METHODS`), and app
  assembly fails if any route uses a method outside it.
- The SPA is served with a strict `Content-Security-Policy` (`default-src 'self'`;
  `script-src 'self'` with no `unsafe-eval` / `unsafe-inline` / `blob:`;
  `connect-src` limited to the API and Auth0 origins and, since Spec 20.0, `https://api.hevyapp.com` (the browser calls Hevy directly with a key that never reaches SIN's server, Q34); `frame-src` the Auth0 origin;
  `base-uri 'none'`; `object-src 'none'`; `frame-ancestors 'none'`) plus
  `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` — Spec 04.0
  §7. Keeping `script-src` at `'self'` needs two build choices: the module-preload
  polyfill is disabled (`build.modulePreload.polyfill = false`, so Vite emits no
  inline script), and Auth0's in-memory refresh-token Web Worker is **self-hosted**
  as a same-origin file (`workerUrl` → a copied `auth0-spa-js.worker.production.js`)
  instead of its default `blob:` worker.
  CSP is the primary XSS control; the in-memory-token choice (Q12) is defence in
  depth behind it. **CSP + web security headers are owned by Spec 04.0.**
- Signed, short-TTL URLs for all bucket access; no public objects.

### 8.3 Testing

- `packages/core`: exhaustive unit tests on units conversion, est-1RM, volume, PR
  detection — these are where silent wrongness hurts most.
- API: integration tests against a real Postgres (testcontainers), covering the
  idempotency and finish-workout paths.
- E2E: one happy-path web smoke in CI, Playwright (Spec 06.3): sign in → start →
  pick → log → reload (resume) → finish → summary → delete. The "see PR" step
  joins when a clean test account makes it assertable (Spec 08.0 D12); the smoke
  gains a History step in Spec 08.0 (open the finished workout from History, delete
  from there), and Spec 08.1 has it open the Progress chart for the bench press
  before that — still asserting no values.

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
  M0 = 01, 02, 04.0, 04.1 · M1 = 03.0, 03.1, 03.2, 03.3, 05.0, 05.1, 05.2, 06.0, 06.1, 06.2, 06.3, 06.4, 06.5, 06.6 · M2 = 07.0, 07.1, 07.2, 08.0, 08.1 ·
  M3 = 09, 09.1, 09.2, 10.0, 10.1, 10.2, 10.3, 10.4, 09.3, 10.5, 09.4, 10.6, 09.5, 10.7 · M4 = 11–13 · GA = 14 · Production on Google Cloud = 15 · Post-M4 improvements = 07.4 (edit finished workouts, fix workout times; issues #89 / #90), 05.3 (three new exercise types, API; issue #104 piece 1), 18.1 (its UI spec), 03.4 (exercise management, API; piece 2) and 18.2 (the Exercises tab, exercise page, edit, copy and delete UI) · Hevy integration (owner-only; after the #104 work) = 19.0 (foundation API), 19.1 (import API), 20.0 (setup UI), 20.1 (import UI), 20.2 (export UI) · Design refresh = 17.0–17.3 (outside M1–M4; after M3: visual identity "Stone" 17.0, workout screen "now" 17.1, finish and PR moments 17.2, landing page 17.3; see Q22). (`packages/core` (02) is a
  foundation both M0 clients import — it is an M0 prerequisite, not M1 work.)

| Milestone | Contents | Exit criteria |
|---|---|---|
| **M0 — Skeleton** (Specs 01, 02, 04.0, 04.1) | Monorepo, `render.yaml` blueprint, CI/CD, `packages/core` purity check (Spec 02), Fastify API skeleton + config + DB, `user` migration, Auth0 **API-side** JWT validation + `user` provisioning, health checks (Spec 01). **Spec 04.0:** Vite React SPA shell, browser Auth0 PKCE login (in-memory tokens, self-hosted refresh-token worker), React-free authed API client (problem+json → typed errors), router + protected routes + bootstrap gate, Render static-site deploy with SPA fallback + strict CSP, CI web gate. **Spec 04.1:** CSS-Modules design-token system + primitives, `useSession`/`useMe`, the Profile screen (`GET`/`PATCH /v1/me`), error boundary. | API on Render staging validates a real Auth0 token and provisions a user; post-deploy smoke script gets `200 /v1/me`. A user completes Auth0 Universal Login in a mobile browser and the SPA renders their profile from `GET /v1/me`; the static site is deployed to Render with the SPA rewrite and a strict CSP, and CI gates the web build. |
| **M1 — Log a workout (API + web)** | Zod→OpenAPI contract pipeline (Spec 03.0); exercise catalog read endpoints + seed data (03.1), custom exercises (03.2); start/empty workout; log sets; finish. No routines, no charts. Mobile-first responsive layout for the logging screen. | Dev logs real gym sessions from a phone browser for 1 week; no data loss. |
| **M2 — History & progress** (Specs 07.0 PR engine, 07.1 history list, 07.2 progress series, 08.0 history screen + PR display, 08.1 progress screen) | History list + detail (08.0); PR detection + finish-screen summary (07.0 + 08.0); per-exercise charts (est-1RM, top set, volume, reps — hand-written SVG, Q17) and the per-exercise records list (08.1). | Progress numbers reconciled by hand for 10 sessions (records and history: 08.0 AC27; charts: 08.1 AC29). |
| **M3 — Routines + supersets** (Specs 09 routines API, 09.1 planned sets API, 09.2 routine sections API, 10.0 routines UI, 10.1 session side, 10.2 planned sets UI, 10.3 routine sections UI, 10.4 routine from pasted text, 09.3 one-off routines API, 09.4 workout sections API: a workout's sections become its own, added, renamed, removed and filled during or after the workout, 10.6 workout sections UI, 10.5 one-off routines UI: tag and expiry on the list, a preview note with Keep as a routine, a Finish-dialog line and Keep it in my routines checkbox, 09.5 timed sections API: Set Timer / AMRAP / Time Cap on a section with a recorded score, replay-safe for the offline outbox, 10.7 timed sections UI: the Timer group on the section sheet, Log result with offline outbox ops, the score on the summary and History, routine from text reads the timer) | Build/edit routines; start a workout from a routine; superset/circuit grouping (Tier B) — grouping in the editor; in the session (10.1) target lines and notes on the exercise cards, the bracket, live link/unlink via the editor's rules, and `routineName` on History; "grid logging" = bracket + per-card logging; **planned sets** (09.1 / 10.2) — a routine item can program each set (type, reps, weight), the editor offers a weight field and "Plan each set", and in the session the entry-row draft arrives prefilled and labeled "Set 3 of 4" / "Extra set"; **sections and notes** (09.2 / 10.3) — a routine can be split into named sections with a note each, the session shows them under headings with the routine's own note at the top and a per-exercise **Note** action (queued offline), and History shows the same structure. The rest timer, including the per-group timer, is Spec 17.1 Phase C (design refresh). | — |
| **M4 — Polish & beta** | Body-weight log (the rest timer moved to Spec 17.1 Phase C), data export/delete (Spec 11 API + Spec 12 UI — beta minimum: synchronous JSON export and a manual purge CLI; R2 bucket, async export and the scheduled purge job are GA), empty + error states, `localStorage` write-queue (R1 mitigation), accessibility pass. | Closed beta with a handful of real users; error rate + core metrics instrumented. |
| **GA** | Public launch of the web app, custom domain, and a small **standalone Next.js marketing/landing site** (static, SEO-friendly; separate deploy from the app — a deliberate, low-stakes first use of Next.js). | Success metrics (§1.3) visible on a dashboard. |
| **Production on Google Cloud** (Spec 15; the AWS migration is dropped, not scheduled) | Terraform in `infra/`: Cloud Run (scale to zero, max 1), Artifact Registry, Secret Manager, Firebase Hosting, keyless CI identity, a $1 budget; a separate Neon free project; the gated `deploy-prod` workflow. Staging stays on Render. | The owner's runbook Part F: the first `deploy-prod`, a rollback and roll-forward, D4.d on Cloud Run and the phone check (Spec 15 AC28–AC31). |
| **Post-v1 (backlog)** | React Native app (`apps/mobile`) on the same API; PWA/offline; guided interleaved superset logging (Tier C); wearable read-only import; **social phase** (planned — follow graph, shared workouts, challenges; requires the authz layer per §3.4 / R8). | Each is additive per §3.4 — no server rewrite. |

---

## 10. Risks & Open Questions

### Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| **R1** | "Online required" in a product used in gyms with poor signal, now via a **phone browser** → lost sets, abandoned sessions. A backgrounded mobile-browser tab can also be evicted mid-session. | High — directly hits the core loop and retention metric. | Persist set writes in a `localStorage` outbox and drain it with backoff on reconnect and on tab restore. Lands in M1 as Specs 06.2 (queue), 06.5 (drafts, logout guard) and 06.6 (multi-tab, offline e2e). Not the full offline-first layer, but removes the worst failure mode and is the seam a later PWA/RN client reuses. |
| **R2** | Deferring native mobile could turn into "never", or the API/core pick up web-only assumptions that make the eventual RN app expensive. | Medium — strategic, not immediate. | §3.4 principles + the CI purity check on `packages/core` keep the seam honest from day one, even while only the web app exists. |
| **R3** | Managed auth provider lock-in / pricing at scale. | Medium | Keep all identity data (`user` table) in our DB keyed by `sub`; provider stores only credentials. Migration path stays open. |
| **R4** | PR / progress math wrong in a way users notice and lose trust. | Medium | All formulas in `packages/core` with heavy tests; PR table is a rebuildable cache; show the underlying set on every PR. |
| **R5** | Scope creep toward coaching/social before the logging loop is truly excellent. | High for timeline | Non-goals in §1.5 are load-bearing; revisit only once the core loop is proven in real use (post-M2, ideally post-beta). |
| **R6** | Solo developer learning Node/TS + Prisma (and a React SPA) while building → slower delivery, and early architectural mistakes made before the platform is familiar. | High for timeline; medium for code quality | Dropping native mobile from v1 already removes the biggest piece of this. Within the milestones, land the API surface for a feature before its web screen so the language is bedded in first. Lean on Fastify + Prisma conventions rather than inventing structure. Keep `packages/core` small and pure — highest-value, most testable code, safest place to be learning. Treat M1 as throwaway-friendly: expect one refactor after it ships. Accept a longer timeline than a Go build would take — the learning is a stated goal, not an overrun. |
| **R7** | AWS phase 2 either never happens (portfolio value lost) or is started too early and stalls app progress; or the "lean" setup drifts into a $70+/mo bill. *(Retired 2026-10-24: Spec 15 / Q31 dropped the AWS phase 2.)* | Medium — career-goal and cost. | Gate it: phase 2 does not begin until M2 is stable and the app is worth showing. Keep the app 12-factor so the option stays cheap to exercise. Enforce the cost guardrails explicitly in IaC review: no NAT Gateway, no ALB, single-AZ RDS, `db.t4g.micro`, budget alarm at $25/mo. Verify AWS free-tier terms at account creation — they changed in 2025. |
| **R8** | The planned social phase (Q6) needs authorization that v1 does not have — replacing "row belongs to `user_id`" with per-resource visibility, a follow graph, blocking, and feed fan-out. Retrofitting authz into a codebase that assumed single-owner access is error-prone (privacy leaks). | Medium — future, but a privacy-leak class of bug. | Keep every data access going through the repository layer now (§5.1) so there is one place to add visibility checks later — never inline ad-hoc queries in handlers. Treat social as its own design doc and phase, after the app has real users. Do not half-build it earlier (R5). |

### Decisions log (formerly open questions)

All resolved as of v0.5 (Q1–Q9 at v0.3; Q10–Q12 added from Specs 04.0/04.1; Q13 from Spec 07.0; Q14 from Spec 07.1; Q15 from Spec 07.2; Q16 from Spec 08.0; Q17 from Spec 08.1; Q18–Q20 from Specs 09, 11 and 09.1/10.2; Q21 from Specs 09.2/10.3; Q22 from Spec 17.0; Q23–Q24 from Spec 17.1; Q25 from Spec 17.2; Q26 from Spec 17.3; Q27 from Spec 07.4; Q28 from Spec 10.4; Q29 from Spec 09.3; Q30 from Spec 09.4; Q33 from Spec 03.4; Q34 from Specs 19.0–20.2; Q35 from Spec 09.5). Kept here
with rationale so the "why" survives.

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
- **Q4 — Hosting.** ✅ **Resolved: Render + Cloudflare R2 for v1 (R2 arrives at GA — Q19); migrate to AWS
  (CDK/Terraform + Fargate + RDS + S3 + CloudFront) as a phase-2 DevOps portfolio
  project after M2.** Render unblocks app work now; the AWS migration is a
  self-contained artifact and, because the app is 12-factor / S3-compatible, a
  swap not a rewrite. See §3.2, §3.3, §7, §9. *(Production part superseded by Q31, 2026-10-24: production is Google Cloud, Spec 15; Render stays staging and the AWS migration is dropped.)*
- **Q5 — Supersets.** ✅ **Resolved: schema unchanged** (`superset_group SMALLINT`
  on `routine_item` + `workout_exercise`, covers circuits too); ship **Tier B UX**
  (grouping + bracketed display + grid logging — bracket + per-card logging, no combined
  superset card) in **M3**, with the
  per-group rest timer shipped with the rest timer in **Spec 17.1 Phase C**; guided interleaved logging (Tier C) to post-v1 backlog. See §2 item 8,
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
- **Q10 — SPA router & data layer.** ✅ **Resolved: React Router v7 in library
  mode (`createBrowserRouter`) + TanStack Query.** Firms up §3.2's "React Router
  (or TanStack Router)" hedge. React Router is the most widely used option
  (community, docs, job-market signal) and library mode is a small API surface
  for a developer learning React; TanStack Router's codegen'd typed routes add
  tooling for little v1 payoff. TanStack Query for server-state caching is
  unchanged from §3.2. See Spec 04.0 §6, §12 Q10.
- **Q11 — SPA styling.** ✅ **Resolved: CSS Modules + CSS custom-property design
  tokens; no CSS framework in v1.** A `tokens.css` on `:root` is the design
  system; `*.module.css` gives locally-scoped styles with zero runtime and no
  naming convention to maintain, and the "styles are data" model ports to a
  future React Native `StyleSheet`. Tailwind (productivity + market signal) was
  the main alternative but is a second styling language layered on CSS, and the
  same "smallest concept surface for learning" logic that chose Fastify over Nest
  and SPA over Next applies. Revisit only if styling velocity is a measured
  bottleneck. See Spec 04.1 §6, §12 Q11.
- **Q12 — Browser token storage.** ✅ **Resolved: in memory only**
  (`@auth0/auth0-spa-js` `cacheLocation: 'memory'` + refresh-token rotation);
  no tokens in `localStorage` / `sessionStorage` / a readable cookie. Rationale:
  training + body-weight data is sensitive PII (§8.2) and a persisted refresh
  token is the highest-value target for an XSS bug — memory-only means there is
  no long-lived credential to exfiltrate and closing the tab ends the exposure.
  Cost: a full-page redirect to re-establish a session on a cold load / hard
  reload — silent when the Auth0 session cookie is still valid (no credential
  re-entry, ~1s). CSP is the primary XSS control (§8.2); this is defence in depth.
  How the cold load degrades is settled in Spec 04.0 §12:
  **`useRefreshTokensFallback: false`** (one deterministic redirect path — the
  hidden-iframe fallback cannot succeed on the mobile-majority Safari/Firefox
  anyway); a **session-resume bridge** on public routes (an `is.authenticated`
  hint cookie → a "Resuming your session…" screen + immediate redirect, instead
  of a `Landing` bounce); and an **accepted known limitation** — an OS-evicted
  background tab still costs a cold-load redirect mid-session, with local session
  persistence (the R1 offline mitigation, M4) as the full fix. Revisit the storage
  choice itself only if that cost proves frequent in real use, and then only
  paired with a tightened CSP. See Spec 04.0 §6.8 / §7 / §12.
- **Q13 — PR engine design.** ✅ **Resolved (Spec 07.0, 2026-10-06): recompute the
  touched fork-lineages from their full qualifying history, through one function
  used by finish, delete-of-a-finished-workout and the `records:rebuild` release
  step; exact integer math in `@sin/core`; `personal_record` stays a rebuildable
  cache.** Rationale: R4 (PR math wrong ⇒ lost trust) is a "two implementations
  drift" risk, so the design minimises implementations — one recompute path makes
  "rebuild equals live" true by construction, and keeps Epley, the tie rule and the
  eligibility table in one tested TypeScript module the web and a future mobile
  client can also import. Rejected: incremental-at-finish (separate algorithms for
  delete, backdated finish and rebuild) and SQL-side aggregation (a second
  implementation of the math in SQL). Cost: O(touched lineages' history) per finish,
  watched against §1.3's 400 ms p99 (07.0 AC27). Chronology is `started_at`, ties go
  to the earliest set, and `max_reps` replaces the old reps-in-`value` overload.
  See Spec 07.0 §12 (D1–D22).
- **Q14 — History list & cursor pagination pattern.** ✅ **Resolved (Spec 07.1,
  2026-10-07): `GET /v1/workouts?limit=&cursor=` returns the caller's finished
  workouts newest-first, each with a summary computed at read time (a keyset page
  query with correlated subqueries, plus volume summed in `@sin/core`); cursors are
  opaque `v1.` tokens over `(started_at, id)` with the timestamp carried as Postgres
  text.** Rationale: the summary is derived data, and storing it (a migration plus
  maintenance in every finish/delete) or computing volume in SQL (a second
  implementation of the volume rule) would reintroduce the drift Q13 avoids — so
  volume is one `@sin/core` function shared with `best_set_volume`. Keyset (not
  offset) paging is stable under concurrent finishes and deletes, and the
  Postgres-text timestamp avoids the microsecond-vs-`Date` boundary error. Rejected:
  all-in-SQL volume; stored summary columns. Cost: two indexed statements per page,
  measured in 07.1 AC20. See Spec 07.1 §12 (D1–D16).
- **Q15 — Progress series shape.** ✅ **Resolved (Spec 07.2, 2026-10-07; replaces the
  `?metric=est_1rm` sketch): `GET /v1/progress/exercises/{id}?from=&to=` returns one
  point per finished workout carrying all four metrics (`topSetWeight`, `bestE1rm`,
  `totalVolume`, `maxReps`, each nullable), computed in `@sin/core` from the same
  fork-lineage working sets Spec 07.0 loads; `404` for an exercise not visible to the
  caller, `200` with `points: []` for a visible exercise with no sessions.** Rationale:
  the series is derived data whose numbers must agree with the PR list (R4), so the
  per-set eligibility function `computeRecords` uses is exported and reused — the
  series maximum of three metrics equals the PR by construction — rather than
  re-implemented in SQL (a second implementation of the math, DESIGN §3.2) or stored in
  a rollup (§4.6 defers it). All metrics per point lets the UI switch charts without a
  refetch and leaves no `metric` enum to grow. Rejected: SQL `GROUP BY` aggregation;
  daily rollup table; a `?metric=` parameter. Cost: one lineage's working sets loaded
  per request, un-paginated (a documented exception to §6), measured in 07.2 AC19.
  See Spec 07.2 §12 (D1–D14).
- **Q16 — History screen & PR display (UI).** ✅ **Resolved (Spec 08.0, 2026-10-08):
  Spec 08 is split — 08.0 ships a History tab and the "Personal records" block on the
  workout summary, 08.1 the Progress tab with charts. History is a keyset list with an
  explicit "Load more" button whose rows show date, exercise names, working sets ·
  volume and a record badge (no notes); a workout opened from it reuses the existing
  summary under `/app/history/:id` via a `section` prop. The finish response's
  `newRecords` is parsed (the web client had been stripping it) and cached under
  `["records", { workoutId }]`, with `GET /v1/personal-records?workoutId=` as the
  fallback; finish, delete and the "already finished" recovery path all update the
  caches through one shared helper. Units are converted on the client by pure
  functions (kg as stored, lb at one decimal).** Rationale: nothing on the server
  changes — the APIs of Q13–Q15 already serve everything shown — so the UI's job is to
  show those numbers without a second implementation of any math (R4) and without a
  spinner on the screen the lifter sees right after Finish. Reusing the summary under a
  second route is one line and keeps the nav highlight honest (`navItemFor` matches by
  pathname). A button instead of infinite scroll suits one-handed gym use and a cold
  Render API, with no scroll-observer lifecycle to test. Nothing is persisted: both
  lists are cheap server-derived reads that could be wrong if replayed from disk, and it
  adds no `localStorage` key for logout to clear. Rejected: a `?from=` parameter or
  router state for the back target; infinite scroll; persisting history offline; a
  server-side unit conversion. Cost: an invalidated infinite query re-walks its loaded
  pages (~35 ms each server-side, 07.1 O1); a workout finished on another device appears
  within the 30 s default `staleTime`. Settles 07.1 O2 (rows show no notes; the API
  shape is unchanged). See Spec 08.0 §12 (D1–D14).
- **Q17 — Progress charts: hand-written SVG, nulls skipped client-side.** ✅ **Resolved
  (Spec 08.1, 2026-10-08; the tab was renamed Exercises by Spec 18.2, its list became the Records view and the per-exercise screen the body of the exercise page, `/app/progress…` redirecting to `/app/exercises/records` and `/app/exercises/:id`): the Progress tab lists the exercises the lifter holds records
  for (one unfiltered `GET /v1/personal-records`, grouped by lineage root) and opens a
  per-exercise screen that draws one metric of `GET /v1/progress/exercises/{id}` (est.
  1RM, top set, volume, reps) as a small hand-written SVG line chart — no chart library —
  over a 3M / 1Y / All range (the range becomes the API's `from`, computed on the device
  from its local date), with tap-to-select points, an `aria-live` readout that links to
  the session, a sessions list as the keyboard / screen-reader path, and the exercise's
  records list. A metric that is `null` at a point is skipped, never plotted as zero —
  which is also the resolution of Spec 07.2 O2: the API keeps all-`null` points
  (07.2 D7) and the client decides what is chartable.** Rationale: the chart is one
  series, a few hundred points, no animation — a few hundred lines of pure, exhaustively
  testable geometry — whereas a library would bring its own styling path (inline `style`
  or injected `<style>`, against the CSP and the "design values only in `tokens.css`"
  rule), a resize observer and a bundle cost, and would put the plotted numbers through
  code we did not write (R4). The series' per-point `null`s are per metric (a session
  with one 15-rep set has a top set but no e1RM), so dropping all-`null` points in the
  API would not remove the need to skip nulls in the client; keeping the API unchanged
  also keeps 07.2's contract and tests. The client never re-derives a number (e1RM
  included — it plots the served `bestE1rm`, which the API computes through `@sin/core`),
  and the displayed string comes from the same `formatRecordValue` as History and the
  records block. Each range is its own cache entry; finish and delete (08.0's helper
  pair) invalidate `["progress"]`. Rejected: Recharts / visx / uPlot / Chart.js; a
  canvas chart (no accessible structure); dropping all-`null` points server-side;
  focusable dots (a keyboard trap — a sessions list gives the same action). Cost: no
  zoom, pan or animation; dense windows degrade to precise tapping and the list. Open:
  the catalog retire-and-replace seam (07.0 O2 / 07.2 O5) stays the owner's call. See
  Spec 08.1 §12 (D1–D13).

- **Q18 — Routines & supersets API.** ✅ **Resolved (Spec 09, 2026-10-08): routines are
  private, hard-deleted, whole-replaced documents; starting a workout copies them.**
  `routine` + `routine_item` (targets nullable, RPE stored as tenths) are edited by
  `PUT` with the full ordered item list in one transaction (item ids unstable, last
  write wins, `If-Match` reserved as the upgrade); `POST /v1/workouts` gains an
  optional `routineId` and, in the existing idempotent start transaction after the
  one-active check, copies each item into `workout_exercise` with its five target
  snapshots, `superset_group` and item notes, setting `workout.routine_id` +
  `routine_name_snapshot`; live supersets are a nullable `supersetGroup` on the
  existing `PATCH /workout-exercises/{id}` (no adjacency rule). Rationale: the
  workout must stay self-contained forever (as with `exercise_name_snapshot`), so
  nothing reads a routine after the start; that also makes archive unnecessary — a
  name snapshot is all History needs after a delete (`archived_at` dropped). Rejected:
  live-read targets, a JSON snapshot, item-level routine routes, a separate start
  route, a dedicated supersets endpoint, archive. Limits: 50 routines / 30 items / 8
  per group. Q5 is unchanged. See Spec 09 §12 (D1–D21).
- **Q19 — Account lifecycle: beta-minimum export, soft delete, manual purge.**
  ✅ **Resolved (Spec 11, 2026-10-11): synchronous JSON export, soft delete with no
  self-service undo, and a hand-run purge CLI; R2, async export and the purge cron are
  deferred to GA.** `GET /v1/account/export` returns one JSON document composed of the
  existing read DTOs (profile, custom exercises incl. soft-deleted, routines, workouts
  with sets) from one `REPEATABLE READ` read-only transaction and a fixed handful of bulk
  queries, rate-limited per user (3/min); `DELETE /v1/account` sets `deleted_at` and
  returns `202 { deletedAt, purgeEligibleAt }` (a repeat is `403 account-deleted`, like
  every other call, so the client treats that as done); `account:purge` (shaped like
  `records:rebuild`) lists by default, `--confirm` deletes accounts past the 30-day grace
  in one transaction each (PR lock first, grace check inside the `DELETE`), and a live
  account can never be purged. Auth0 is untouched (no Management API credential); a
  later login after the purge re-provisions an empty account. Rationale: the beta is a
  handful of known testers — a bucket, signed URLs and a scheduled job are infrastructure
  for a population that does not exist yet, while an SPA-assembled export would be N+1
  requests with no consistent snapshot and a raw-SQL purge would have no dry run, grace
  check or test. No migration (`user.deleted_at` exists). Open: purge cadence vs. the
  user-facing promise and backup/Auth0 retention wording (Spec 11 O1/O2). See Spec 11 §12
  (D1–D18).
- **Q20 — Planned sets: per-set routine plans, rows as the source of truth, prefilled in the
  session.** ✅ **Resolved (Specs 09.1 / 10.2, 2026-10-11): a routine item owns an ordered
  list of planned sets (`routine_item_set`: type, rep range, weight + unit); starting a
  workout snapshots them to `workout_planned_set`; the session prefills its draft from the
  next one.** The rows are the single source of truth and the item's `target_sets` /
  `target_reps_*` become columns the server derives on every write (kept, not dropped,
  because expand-only migrations forbid dropping in the release that stops writing them and
  Spec 10.1's target line and every started workout's snapshot read them); a routine write
  sends `sets` or the legacy quick-line fields, which the server expands into identical
  working rows, so today's client keeps working and the API ships a release ahead of the
  UI. In the session the n-th logged set consumes the n-th planned row (progress is
  positional, never matched by value), the draft arrives filled with the row's type, reps
  (low bound), weight and unit, the label reads "Set k of N" then "Extra set", and nothing
  is stored until the lifter taps Log — the entry row is a draft, not a server row (Spec
  06.1 D13). This **reverses both halves of Spec 10.1 D3** ("no set prefill, no '2 of 4'
  count"). Rationale: in the gym the lifter wants the screen to say what to lift and when to
  stop, including ramps and warm-ups; a planned warm-up must log as a warm-up so personal
  records and volume stay correct. Rejected: a `jsonb` column on the item (no
  database-enforced rules; contradicts Q18's rejection of a JSON snapshot); a quick-line-only
  target weight (no ramps); display-only plans (a second tap-and-type per set); matching
  logged sets to rows by type or value; per-set RPE and planned duration / distance (FI-11)
  for v1. Owner rulings 2026-10-11: a rep range with no set count keeps no rows and its
  range as sent (Spec 09.1 O1); the planned weight shows on the finished-workout and History
  target line too (Spec 10.2 O2, D8). See Spec 09.1 §12 (D1–D14) and Spec 10.2 §12 (D1–D12).

- **Q21 — Routine sections and notes: section rows, a routine-note snapshot, session notes
  through the outbox.** ✅ **Resolved (Specs 09.2 / 10.3, 2026-10-13): a routine owns up to
  eight named, noted sections its items can belong to; starting a workout snapshots them, each
  exercise's section and the routine's own note; the session and History show them, and the
  lifter can edit each exercise's note during the workout.** `routine_section` rows (name 1–40
  free text, note ≤ 2 000) and a nullable `section_id` on items are written by the whole-document
  routine `PUT` (sections carry request-local keys that items reference; a body with no
  `sections` has none); the server rejects an item list that is not loose-first with each
  section one contiguous run, and a superset spanning sections. The start copy (inside the
  existing `FOR SHARE` transaction, `INSERT … SELECT`) writes `workout_section`, sets each
  exercise's `section_id` and stores the routine's note in `workout.routine_notes_snapshot` —
  never in `workout.notes` — so later routine edits never change a past workout; the workout
  side is stored as sent (added exercises are loose and appended; the workout's sections are a snapshot at the start, then the workout's own (Q30))
  and every consumer groups by maximal runs. The session note is the existing
  `PATCH /workout-exercises/{id}` `notes` key (already accepted; Spec 09.2 pins it), queued in
  the offline outbox as a new `note` op that coalesces and that Finish waits for; it never
  writes back to the routine. Rationale: a note belongs next to the exercises it applies to,
  must be readable mid-set and reappear afterwards, and a workout must stay self-contained
  forever (as with `exercise_name_snapshot`, Q18). Sections are rows because they are
  queryable, constrained by the database and flow through the shared read DTOs to the export.
  Rejected: heading pseudo-rows in the item list (every consumer would filter by row kind); a
  JSON column (not queryable, no CHECKs; Q18 rejected a JSON snapshot); copying the routine
  note into `workout.notes` (mixes the routine's text with the lifter's); an advisory lock for
  the section cap (the cap is a property of one whole-document write that already holds the
  routine row lock); online-only session notes (owner ruled for the outbox, 2026-10-13). Section-note
  length is 2 000, the routine note's (owner ruling, 2026-10-13). Decided at implementation: one spec
  (Spec 10.3 O2) and no per-section Add exercise in v1 (Spec 10.3 O3). See Spec 09.2 §12 (D1–D15) and Spec 10.3 §12 (D1–D14).
- **Q22 — Visual identity: "Stone", light-first, color roles, self-hosted type.** ✅
  **Resolved (Spec 17.0, 2026-10-15/16): the web app is repainted as a calm, warm-neutral,
  light-first system in which each color means one thing; no layout, API, migration or CSP
  change.** Light is the base `:root`; dark is a `prefers-color-scheme: dark` override, and a
  Light / Dark / System switch on Profile sets `data-theme` on `<html>` (an attribute is the only
  thing that can outrank the OS media query; System removes it). The choice is a per-device
  preference stored as `sin:pref:theme` and applied by `applyStoredTheme()` as the first
  statement of `bootstrap()` (the CSP forbids an inline head script, so a one-frame flash on a
  device whose override differs from the OS is accepted). `sin:pref:` is deliberately not in
  `USER_DATA_KEY_PREFIXES`: a theme identifies no one and logout must not flip it. Roles: teal
  is the interactive/brand color (nav, links, chart, selection, superset bracket); brass marks
  records only; warm-up is muted with a "W" mark; danger (brick) covers destructive and failed
  states, warning is a separate burnt orange so it never reads as a record; state is never by
  color alone. `--color-accent` is removed with no alias, so a missed use fails loudly;
  `--color-border` is the 3:1 control boundary and `--color-line` the decorative hairline. Type is
  Instrument Sans, one self-hosted latin woff2, preloaded, with tabular figures on `body`. A
  contrast test covers both themes (WCAG 2.2 AA). Rationale: the owner trains in natural light
  and designed light first; per-device storage is the right scope for a cosmetic setting and
  needs no API; named role tokens let teal's several jobs diverge later without a sweep. Rejected:
  dark-default; an alias for `--color-accent` (hides misclassified uses); a server-side theme
  preference (API and migration for a cosmetic setting, wrong semantics across devices); a
  build-time inline script (CSP); Google Fonts or a `data:` font (third-party origin, CSP);
  keeping signal exclusive to "do this next" (the owner chose coherence, D4). The visual system
  (tokens, roles, type, rules) is documented in `apps/web/DESIGN.md`; `docs/DESIGN.md` stays the
  product/architecture record. See Spec 17.0 §12 (D1–D17).

- **Q23 — RPE: hidden in the UI, kept in the data.** ✅ **Resolved (Spec 17.1 Phase A,
  2026-10-16; owner decision 2026-10-15): the lifter never sees or enters RPE — not in the entry
  row or the set edit sheet, not in set rows (" @8"), not in target lines ("RPE 8") or the
  accessible names built from them, not in the routine item sheet — while `set_entry.rpe` and
  `routine_item.target_rpe` stay, the API keeps accepting and returning them, and the export
  still carries them.** Hiding is presentation only: the draft keeps `rpe`, `parseDraft` still
  reads it (an unparsable value is dropped rather than raised, since nothing on screen could fix
  it), `diffForPatch` still compares it, and a sheet that cannot show a value passes the stored
  one through, so an edit never clears it. Rationale: RPE was optional friction on the logging
  path (PRODUCT.md: logging, nothing else); keeping the columns costs nothing and makes reversal a
  UI change. Rejected: dropping the columns (a migration and an API break for no gain); hiding
  only the entry field (finished views and target lines would show a value the lifter can no
  longer enter). Known consequences: a stored target RPE cannot be cleared from the UI (remove and
  re-add the item), and an edit never sends RPE at all, so a set's stored value is untouchable
  from the app; a stored target the schema would refuse is dropped on save rather than blocking
  it. See Spec 17.1 §6.11, D15.
- **Q24 — Workout screen "now": one current exercise, steppers by the set's unit, the per-set bar.** ✅ **Resolved
  (Spec 17.1 Phase B, 2026-10-16; owner decisions 2026-10-15/16): one exercise is current and expanded and the others
  collapse to a one-line summary; current is computed from the workout (`chooseCurrent` / `advanceAfterLog`) with the
  lifter's tap on top, moves on after a planned set that finished its exercise, and alternates through a superset run
  (a tap still picks any exercise); weight and reps get ± steppers that step by the draft's own unit (5 lb / 2.5 kg) in
  integer milli-units, as ordinary edits; the bottom bar is the per-set "Log 185 × 5", becomes "Finish workout" once
  every planned set is logged, and is the screen's one primary button; "Add exercise" moves to the end of the list; a
  Workout menu holds End workout early (listing the planned sets it skips, on the same finish path as Finish) and
  Discard; the top row shows the elapsed time.** Rationale: the next set comes first (PRODUCT principle 1); one current
  exercise makes "Log" unambiguous; computed state cannot drift across reloads or devices. Rejected: several open cards
  (the page stays long); storing current in `localStorage` (drift, a new key, logout handling); per-card Log buttons;
  a portal or form-associated bar button (remounts on advance and drops focus); steppers by the profile's unit (wrong
  step on a plan stored in the other unit). `workout_finished` gains `endedEarly` and `unloggedPlannedSets`. The rest
  timer is timestamp-based: `{ startedAt, durationS }` is stored under `sin:workout:rest` and every render derives what is
  left from the clock, so a locked phone or a reload cannot drift it. A non-warm-up log on an exercise with a stored rest
  starts it while planned sets remain (in a superset, at the end of a round); every log replaces or clears it. There is
  no default rest (D9). The readout sits in the panel and a 3 px line crosses the top of the screen; no sound, vibration
  or notification (D10). See Spec 17.1 §6, D2–D14.
- **Q25 — Finish & PR moments: what the finish screens say.** ✅ **Resolved (Spec 17.2 Phase A, 2026-10-17; owner decisions
  2026-10-17): both Finish dialogs and the finished summary lead with what the lifter did: duration, exercises and
  *working* sets (and, on the summary only, volume), from one pure module (`finishStats.ts`) so they cannot disagree; the
  End-early dialog then flags "N planned sets not logged", lists them and ends with the note; the celebration is quiet
  (no animation, no live region).** "Sets" counts working sets only, matching History's `workingSetCount`; this changes
  the old Finish dialog, which counted every logged set including warm-ups, while the Finish enabling rule and
  `workout_finished.setCount` keep counting every set. Volume is `sumVolumeMilli` over working sets, the same function as
  History's `totalVolume`; no volume row when nothing qualifies. The dialog duration is read once when the dialog opens.
  **Phase B (2026-10-17):** the summary shows one record card per exercise (a big lead record: heaviest weight, else est.
  1RM, else max reps; a brass gain, or "First record" for a first-ever value, with a muted "was"; the exercise's other records
  as name-only chips); set-volume records are not shown there and are not counted in "N new"; an est. 1RM is rounded for
  display only (the nearest 1 lb or 0.5 kg, gains computed from the rounded values, a zero rounded gain demotes it from the
  lead) in the cards, the Progress records list and the chart readout, and nothing in `@sin/core` changes; History's badge
  is a brass trophy with "N PRs", only when the workout holds records, using Spec 07.3's `recordCount` as served so the row
  and the summary agree. First records still count (D13). See Spec 17.2 §6, D1–D17.
- **Q26 — Front door: what a signed-out visitor sees.** ✅ **Resolved (Spec 17.3, 2026-10-17; owner decisions
  2026-10-15 and 2026-10-17): the landing and the "Resuming your session…" screen are one centered title card
  (`screens/FrontDoor.tsx`): the name "Strength in Numbers", condensed, in the space above a hairline; then one line
  ("Log your lifts." / "Count your progress." on the landing, the status on the resuming screen); then one bottom
  control in the thumb zone (the landing's block primary Log in button, the resuming screen's "Go to sign in" link).**
  From 48rem the column is capped and centered. The behavior is today's, plus one guard: Log in goes busy after the
  first tap (a second `loginWithRedirect` would overwrite the first PKCE state) and a back/forward-cache restore clears
  it. The product name "Strength in Numbers" replaces the repo slug wherever a person reads it (the landing, `<title>`,
  the in-app header's fallback, the setup-error screen); export filenames keep the slug. No mark, no product page until
  launch (Spec 14), no request-access or waitlist (BL-19), and sign-up policy is an Auth0 tenant setting, not a page
  decision. `AuthError` joined the front door in BL-20 (PR #113): its `h1` is the error, the name is decorative. The
  "no mark" is about the front door: the Home Screen icon (#97) is a cream dumbbell on a slant, on teal, and the
  installed app opens full screen (manifest `display: standalone`). See Spec 17.3 §6, D1–D18.
- **Q27 — Editing finished workouts and fixing workout times.** ✅ **Resolved (Spec 07.4, 2026-10-18; owner decisions in the
  approved design brief, builder choices D1–D19): finished workouts are editable, reusing the existing set, exercise and
  workout routes (no edit routes); every finished-mode write is one transaction that takes the per-user PR lock first and
  recomputes the touched lineages through the existing `recomputeRecordsForRoots`; the server refuses to leave a finished
  workout with no sets (`409 workout-would-be-empty`); Change Time is `startedAt` / `durationSeconds` on `PATCH /v1/workouts/{id}`
  for live and finished workouts, a live "took" is stored server-side (`planned_duration_s`) and the client sends the
  resulting `endedAt` at Finish; a changed start is bounded to 5 minutes ahead and a fixed 2000-01-01 floor (no rolling window); `local_date` is re-derived
  with the start; a finished re-time shifts set `completed_at` by the start delta and keeps every set inside the workout's
  span; finished edits and Change Time are online-only.** Rationale: the PR engine was built so that "editing a finished
  workout will call the same recompute" (Q13), so the work is the envelope around it — lock order, a mode flip when a finish
  lands mid-write, and a guard against an empty workout — not new record math, and reuse of the live routes keeps "the same
  screen as logging" one contract. A stored "took" survives a reload or a second device without a new `localStorage` key, and
  leaving Finish's `endedAt` explicit keeps its recovery path and Spec 17.2's duration dialog honest. Online-only is the
  safer reading of "never lose an edit silently": a queued delete the guard later refuses would be exactly that. Rejected:
  dedicated edit routes; a whole-workout `PUT`; an `edited` marker (the owner wants edited workouts indistinguishable);
  rejecting overlapping workouts; shifting sets on a live start change; queueing finished edits in the outbox. Cost: one
  recompute per record-relevant finished-mode set write (benchmarked against the 400 ms p99, Spec 07.4 AC33); a queued live op
  from a second device now lands on a finished workout instead of `409`. UI: Spec 18.0 — edit writes are pessimistic and online-only on a plain REST client, and `409 workout-would-be-empty` opens "Delete this whole workout instead?" with no client pre-check. See Spec 07.4 §12 (D1–D19).

- **Q28 — Routine from pasted text.** ✅ **Resolved (Spec 10.4, 2026-10-19; owner decisions D1–D7): the owner pastes the
  Live Text of gym-app screenshots and a pure `@sin/core` reader turns it into a routine plan on the device — no paid or
  external service, no data leaves the phone (D1); screen furniture is dropped only by exact whole-line match, so "For Time:"
  and "Push Press" survive (D2); headings become sections, a Warmup is note-only, set lines, rep schemes and "3 Sets" lists
  become exercises and supersets, and everything else is note text (D3, D7); a name check gives the owner the final say on
  every exercise (D4); nothing is created before Save, and custom exercises left by a failed routine write are accepted
  (D5); the import always opens in the ordinary editor, unsaved (D6).** Rationale: zero cost per import and a reader testable
  with the real example; a wrong silent match is worse than one extra tap; an all-or-nothing endpoint would be an API spec
  for a rare case. Rejected: the Anthropic API (cost); on-device OCR for now (about 10 MB and a CSP change for WebAssembly).
  Cost: the reader knows one gym's layout; a new gym or badge is a one-line constant change. See Spec 10.4 §12. Round 2 (2026-10-24, Spec 10.4 AC42–AC54): a section header is the line above the gym app's score badge when the paste has badges (the header's bold does not survive Live Text); screenshot boundaries tolerate a status-bar icon after the clock, icon-only lines are dropped, and the overlap match ignores look-alike misreads.

- **Q29 — One-off routines.** ✅ **Resolved (Spec 09.3, 2026-10-19; owner decisions D1–D5): a routine created with `oneOff: true` removes itself when a workout started from it is finished (D1), server-side inside the finish transaction (D2); it expires 14 days after creation, swept lazily on the routines list and create, and an edit or a start does not extend it (D3); Keep clears the mark forever, by a Keep route or `keepRoutine` on the finish (D4); one column, `one_off_until`, is both mark and expiry (D5).** Rationale: a class done once should not leave a dead routine behind, and the workout is already in History through its snapshots; doing it in the finish transaction makes it the same on every device and atomic with the finish. The lock order PR lock → one-off routine row → workout row keeps the finish from deadlocking with the routine `DELETE`. Rejected: removal on start, a client-issued `DELETE` after the finish, soft delete, a boolean plus `created_at` arithmetic. Cost: a stale expiry can only be fixed by pasting again; the cap count ignores expired rows. See Spec 09.3 §12 (D1–D15). **UI decisions are Spec 10.5 D1–D4 (owner, 2026-10-19): warn three times — the list tag with its expiry, the preview note, the Finish-dialog line (D1); Keep in two places, never required — Keep as a routine on the preview, an unchecked Keep it in my routines in the Finish dialog (D2); discard and start remove nothing, End workout early is a finish and carries the same line and checkbox (D3); the six copy strings (D4). Its designer's calls D5–D12 are in Spec 10.5 §12.**

- **Q30 — Workout sections are the workout's own.** ✅ **Resolved (Spec 09.4, 2026-10-22; owner decisions D1–D2, designer's calls D3–D6): after the start copy a workout's sections can be added, renamed, re-noted and removed, and exercises moved between them, on a live or a finished workout, including one started from a routine (D1); a plain add joins the last section only when that section was added in the workout, so a copied plan's extra exercise keeps landing in "Other exercises" (D2); `workout_section.added_in_workout` records the origin, which cannot be derived, and travels on the DTO (D3, migration `0014`); the server places a moved exercise and drops it from its superset, and `sectionId` with `position` is a `422` (D4); a section remove renumbers one row at a time because the position index is not deferrable (D5); the existing per-workout structure lock serializes it all, no new advisory key (D6).** Rationale: the owner types other people's plans in as they train, and a flat list loses the parts of the plan and the details that have no other home. Server-side placement leaves one fact to agree on instead of two, and gives the UI a one-request move. Rejected: a frozen snapshot with a save-as-routine round trip; an origin enum or a timestamp heuristic; the client planning position patches; an optional `sectionId` on add; leaving gaps after a remove. Cost: nothing goes back to the routine; a section remove leaves its exercises where they were, so a loose exercise can sit between sectioned runs. See Spec 09.4 §12 (D1–D13). The UI is Spec 10.6 (owner decisions D1–D4: the five screens as drawn, a confirm before Remove with Cancel focused, online-only writes like Add exercise, the finished workout editable too in Phase B): one shared set of section controls for the live and edit screens; the client never sends a position (one `{ sectionId }` request; the server places it); "New exercises go into {name}." shows only when the next plain add will land there; on the edit screen the writes are pessimistic (the edit screen's own mutation key, create and update written from the response, remove and move re-read the workout) and every success refreshes History, Progress and records (D5, D11). See Spec 10.6 §12.

- **Q31 — Production on Google Cloud, free tier.** ✅ **Resolved (Spec 15, 2026-10-23; owner decisions D1–D11): the API runs on Cloud Run with the staging image's recipe, scaling to zero (max one instance), and the web on Firebase Hosting (D1); production has its own Neon free project (D2); staging stays on Render (D3); a release is one owner-approved `deploy-prod` run of a commit that passed the commit-checked staging smoke, deployed by image digest (D4); infrastructure is Terraform in `infra/`, applied by hand (D5); a $1 budget alert and the one-instance cap guard the cost (D6); the existing Auth0 tenant gains production applications (D7); no custom domain yet (D8); production starts empty (D9); the production image is the same commit rebuilt by CI, and the gate proves "this commit ran on staging", not byte identity (D10); eight follow-ups are BL-27 – BL-34 (D11).** Rationale: production must answer within seconds from a phone and cost nothing; a scale-to-zero container delivers both with no server to keep alive. Rejected: AWS Lambda (an API rewrite to a function model), always-free VMs (a server to patch; reclaimable), the earlier Render-production and AWS-Fargate plans. Cost: a cold start on the first request after idle (BL-32), no production backups yet (BL-27). See Spec 15 §12.


- **Q32 — Three new exercise types.** ✅ **Resolved (Spec 05.3, 2026-10-25, draft; design approved by the owner 2026-10-25, GitHub #104 piece 1): `calories`, `weight_distance` and `weight_duration` join the modalities (D1); calories live in a new whole-number `set_entry.calories` column (D2) that every other type forbids (D3); weight on the weighted types is the total carried (D4); heaviest load reuses `heaviest_weight` through its own gate, so e1RM and set volume still need reps (D5, D6); three new records `max_calories` (`cal`), `max_distance` (`m`), `max_duration` (`s`) (D7), which widens `personal_record.value` to `numeric(14,3)` (D8); the progress series gains three nullable metrics (D9); the reader's `Max Cal …` and leading `20 Cal Row` lines make a Calories guess (D10); feet are a fourth distance unit shared by every distance type, so `0015` also rebuilds the generated `distance_m` with an explicit `ft` arm (D18-D20; owner, from the UI's carry-distance question); one migration, `0015`, expand-only except that rebuild, before the code.** Rationale: the types must be loggable and recordable without reinterpreting any existing column (the Echo Bike mistake) and without letting a new type reach the reps-based math. Rejected: reusing `duration_s` or `reps` for calories, a new `heaviest_load` record type, a generic measure column. No built-in exercises are added here (owner, 2026-10-25; another issue covers them). Cost: `@sin/core`'s shared unions widen, so the API PR carries a handful of behavior-free web compile edits, approved by the owner (D15); `duration` and `distance_duration` still have no records. See Spec 05.3 §12. The UI is Spec 18.1 (draft 2026-10-25): labels, a calories stepper of 5, carry distances default to meters (feet one tap away) and records show meters, record formats. Owner questions answered 2026-10-25.

- **Q33 — Exercise management: the type-change rule and the Exercises tab's reads.** ✅ **Resolved (Spec 03.4, 2026-10-25, draft; design approved by the owner 2026-10-25, GitHub #104 piece 2): a type changes freely while the exercise's lineage has no logged set, afterwards only to a type with the same required and forbidden measures (the pure `@sin/core` `modalitiesCompatible` over `MEASURE_RULES`; after Spec 05.3 only `weight_reps` ↔ `weighted_bodyweight` pair), else `409 exercise-type-locked`; "logged" is any `set_entry` of the caller's under the lineage root or the caller's forks of it; the check is a predicate on the guarded `UPDATE` (no lock key) and the `/fork` overlay obeys it; a type change writes only the `exercise` row and recomputes nothing; `GET /v1/exercises/{id}/routines` names the routines that use exactly that exercise for the delete warning; `GET /v1/exercises/usage` serves last-logged per lineage root for the Exercises tab; delete stays the soft delete and never edits a routine; no migration.** Rationale: the rule must be on the lineage because records, the chart and a fork's page are lineage-wide, so a row-only check lets a copy of a built-in with years of sets change type and mix units in one chart; deriving compatibility from the rule table keeps one source of truth; the reads are separate requests because the catalog is a delta-synced, cached list that routine writes and set logs do not touch. Owner rulings 2026-10-25: live workouts and warm-ups count as "logged" (one definition for the lock and the usage list); no server guard against a second copy of a built-in (the UI disables the button on tap; §4.5 unchanged). No question remains open. **UI: Spec 18.2** (the Exercises tab and the exercise page, Edit, make your own copy and Delete over these reads and rules; online-only like routines; the Progress tab is renamed Exercises, `/app/exercises`, with permanent redirects from `/app/progress…`). Cost: a fork's type is locked by the built-in's history; the pair `weight_reps` ↔ `weighted_bodyweight` compares bar load with added load in one lineage (design-accepted). See Spec 03.4 §12.

- **Q34 — Hevy integration (owner-only).** ✅ **Resolved (Specs 19.0, 19.1, 20.0, 20.1, 20.2, 2026-10-25, drafts; design approved by the owner 2026-10-25): Carol's account only, gated by an env allow-list of user ids (`HEVY_ENABLED_USER_IDS`) with `404` for everyone else and no OpenAPI publication; the Hevy API key lives on the device only (a `sin:hevy:` user-data key, or memory with Don't remember), the browser calls `api.hevyapp.com` directly and schema-parses every reply (CSP `connect-src` gains that origin), and the key is never sent to SIN's server or logged; a per-account mapping in the database (Hevy exercise ↔ SIN exercise pairs derived from `modalitiesCompatible`, the "(calories)" reps→calories rule and an assisted-weight rule, one export-as per SIN exercise, Warmup/workout placeholder pairs and section rules) is filled from a CSV Carol keeps, completed on screen, and downloadable as the same CSV; a one-time import of custom exercises (through the existing create), chosen routines (through the existing create) and all workouts (one bulk endpoint writing finished workouts with `source: 'hevy'`, idempotent per Hevy workout id, duplicates of SIN workouts matched by local day, a one-hour start window and equal titles or mostly the same exercises, every drop and skip reported, records rebuilt once at the end behind a resumable flag); every SIN workout with a Hevy copy (sent, imported or matched) has a `hevy_link` row, so Send to Hevy never shows on one that is already there, a claim step plus a lost-response check make a double tap or retry unable to create a second copy, a server-side fingerprint says "changed since sent" and Update in Hevy `PUT`s the whole workout, and an optional auto-push (off by default, creates only, while the app is open) sends each finished workout; Hevy workouts are created private; migration `0016`. Amended 2026-10-26 from the build plans: the gate is an `onRequest` hook in a child scope (a `preHandler` would run after body parsing and the write-group limit, letting a probe see `413`/`400`/`422`/`429`); a claim-only `hevy_link` row is deleted with its workout while a linked one becomes a tombstone; the only `/openapi.json` change is the `Workout.source` enum and the account export's new `hevy` block; the web uses structural a11y tests, not axe; a workout exercise whose template Hevy no longer lists still gets a pairing card, built from the workouts' own title.** Rationale: the user wants her Hevy history complete here and an accurate private copy there; the key never leaving the device keeps a third-party credential out of SIN's server and logs at the price of auto-push needing the app open (a server-held key is a noted future option); the mapping is data (not a file) so import, export and any later "fetch new" share it, and the file is a backup and a bulk editor; the bulk endpoint applies the finished-workout rules rather than relaxing them, and drops or skips what they refuse, loudly. Rejected: a feature flag column on `user` (a migration and a manual step per environment), publishing the routes, a server-side CSV upload (it would need the key or a stale template list), per-workout record recomputes during the import, inferring a duplicate from the date alone. Cost: five specs, one migration, one new origin in the CSP, and Hevy is beta and unversioned (every reply is schema-parsed; a changed shape fails loudly). See Specs 19.0 §12, 19.1 §12, 20.0 §12, 20.1 §12 and 20.2 §12.

- **Q35 — Timed sections.** ✅ **Resolved (Spec 09.5, 2026-11-01, draft; design approved by the owner 2026-11-01, GitHub #112; owner decisions D1–D6, designer's calls D7–D22): a section, in a routine and in a workout, can have one of three timers — Set Timer (N rounds, one every M:SS), AMRAP (a time limit), Time Cap (a cap, or none) — and a workout's section records its result as numbers: a Set Timer's per-round durations (the score is their total), an AMRAP's rounds + reps, a Time Cap's finish time or, when the cap was hit, how far she got (D1, D3); exercises keep logging their own sets and records still read sets only (D2); the plan is columns on both section tables copied by the start, the result is columns on `workout_section` and the round times a child table keyed `(section, round)` (D9, migration `0018`); round times and the result are written by absolute keyed `PUT`/`DELETE` routes that are safe to replay, so the offline outbox can carry them (D4, D11); a timer change that would not keep recorded data (a different format, removal, or numbers that no longer contain it) needs an explicit `discardResult` (D13), and the validation helpers return stable issue `code`s the screens key their wording on; the score is derived by one pure `@sin/core` function that History, the summary and the Hevy line share (D15); the superset coupling of a timed section's exercises is the UI's, not the API's (D7); Hevy: a timed section is always the "Workout" placeholder with a duration set and a timer line, the fingerprint hashes timed data only for timed sections so no already-sent workout changes state (D6, D17, D18), and the import turns a placeholder's duration into a "Time m:ss" note line (D20).** Rationale: Carol's programs run by the clock and the app had nowhere to put the times; numbers (not text) can be summed, compared and later fed by a clock; keyed idempotent writes are what make an offline replay harmless; the fingerprint change is confined to timed sections so the feature cannot disturb data already in Hevy. Rejected: a free-text score; an array or JSON column for round times; an append route; a whole-array replace of round times; a server-side superset rule; a stored total; bumping the fingerprint version. Cost: a data model with cross-row rules the handler enforces (a CHECK cannot see a section's plan from its round rows); an empty timed section is not sent to Hevy; the import never rebuilds a format. One owner question is open with a default (O1: a capped Time Cap's Hevy duration is the cap). See Spec 09.5 §12 (D1–D22, O1). **The UI is Spec 10.7 (2026-11-01, draft; four PRs, no API change; owner decisions: timers optional, the format chosen on the existing section sheet, results entered from Log result, times typed from the gym's clock, no live clock, round times and results queued offline like sets, the reader makes a section timed only when its score is a time):** the clock field holds digits only and fills from the right (`341` is 3:41) because the phone's number pad has no colon (D1); the shared pieces live in a neutral `features/sectionTimer/` (D3); Log result is a save-based sheet whose Save queues one `round` op per changed round and one `result` op, each a final value keyed by round or section, in an order in which every write is valid in turn (D4, D8); a new op replaces only the last queued op of the same section and key, so every queue prefix is a state the lifter passed through (D7); the Timer group is disabled while the section has unsent entries (D9); a timed section may hold more than one superset (owner, O2), so grouping only fills in: when the section becomes timed or changes format with none of its exercises grouped they become one superset, and an exercise added or moved into a timed section joins only when the others are exactly one superset (or one lone exercise), otherwise it stays loose — an action-time default the lifter can undo, never an invariant, never on a plain edit (D5, D21; the `groupRange` rule is pure `@sin/core`); the Set Timer's rounds do not resize planned sets (D6); on the finished-edit screen results are online-only like every edit write (D15); History rows show scored timed sections only, at most two (D16); the reader keeps the recognized timing lines in the section note and makes a section timed only by `scoreKindOf` — the score badge beats a `Score:` line, Set Timer and Time Cap need a time score, an AMRAP a rounds + reps score, and a time-scored section with no timing line stays untimed (D10–D12); the import plan keeps the gym text's own superset structure (Second Shift stays two supersets) and groups a timed section's items as one only when the text gives none (D13); Hevy needs no new UI (D20). Rejected: a `mm:ss` text input, a stepper-only time, one `timing` op kind with a union body, folding a later edit into an earlier queued op, queueing timer changes, a server grouping rule, deriving planned sets from rounds, removing the recognized lines from the note. Cost: an outbox file that older bundles cannot parse (revert Phase C only with the queue empty), a Save that can queue up to a few dozen ops, and a plan over an hour whose field shows `75:00` while read-outs show `1:15:00`. Owner answers (Carol, 2026-11-01): O1 a `Score:` line counts as time when it has the word "time" and not "rounds" (the badge wins); O2 overruled the one-superset rule as above; O3 no Finish warning for an unscored timed section. Applied to Spec 09.5 on Carol's answers: F1 the helpers' issues carry a stable `code` from a fixed list; F2 `discardResult` also covers a same-format change that does not fit; F3 the regroup rules are "extended" by 10.7's `groupRange`.
---

## Appendix A — Glossary

- **Working set** — a set performed at target effort (excludes warmups).
- **RPE** — Rate of Perceived Exertion, 1–10.
- **Estimated 1RM (e1RM)** — predicted one-rep max from a submaximal set; Epley:
  `w * (1 + reps/30)`.
- **Volume** — `reps × weight` for a single set (`best_set_volume`); summed over
  sets for an exercise or session (history `totalVolume`, progress charts, §4.6).
  Counts **working sets only**, of the load modalities, with the same eligibility as
  `best_set_volume` (reps ≥ 1, `weight_kg > 0`); `null`, not 0, when nothing qualifies.
- **PR** — Personal Record; seven kinds (`heaviest_weight`, `best_est_1rm`,
  `best_set_volume`, `max_reps`, `max_calories`, `max_distance`, `max_duration` — §4.5), tracked per **lineage root** (a global
  exercise and the user's forks of it count as one exercise).
- **Lineage root** — `COALESCE(exercise.forked_from_exercise_id, exercise.id)`; the
  exercise a PR is filed under (§4.5).
