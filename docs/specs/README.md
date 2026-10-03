# Component Specs

Each component of Strength in Numbers gets its own spec here, implemented and
deployed as an independent slice. Specs follow the overall design in
[`../DESIGN.md`](../DESIGN.md); where a spec and the design doc disagree, the
design doc is updated so they stay consistent.

**Feature work is split into an API spec and a UI spec.** The API spec is "done"
when it is deployed and verified by a script/integration test; its UI spec
consumes it. This matches the backend-first sequence (DESIGN R6) and keeps each
spec small enough to finish in one work session.

## Spec set (dependency order)

| # | Spec | Kind | Deploys | Depends on | Status |
|---|---|---|---|---|---|
| 01 | [Foundation & Auth](01-foundation-auth.md) | API / platform | API → Render staging + prod | — | Implemented |
| 01.1 | [Production deploy pipeline](01.1-prod-deploy-pipeline.md) | platform / CI-CD | gated `staging → prod` promotion | 01 | Draft |
| 02 | [`packages/core` foundation](02-core-foundation.md) — types, Zod setup, units conversion, purity check | library | workspace package | 01 | Implemented |
| 03.0 | [API contract pipeline](03.0-api-contract-pipeline.md) — Zod DTOs → `fastify-type-provider-zod` → OpenAPI 3.1 emit + CI drift check; `/v1/me` migrated onto it | API / platform | served `/openapi.json` + CI check | 01, 02 | Implemented |
| 03.1 | [Exercise catalog — read](03.1-exercise-catalog-api.md) — 3 tables + seed, `GET /v1/exercises` (`since`/`syncToken`/`ETag`), reference endpoints, `ExerciseId` | API | endpoints | 01, 02, 03.0 | Implemented |
| 03.2 | [Exercise catalog — writes](03.2-exercise-catalog-writes.md) (custom create + copy-on-write fork of a global row) | API | endpoints | 03.1 | Implemented |
| 03.3 | [Catalog sync token](03.3-catalog-sync-token.md) — fixes #23/BL-1: trigger-stamped `change_xid xid8` + snapshot-horizon token replaces the timestamp cursor (`?since=`/`syncToken`, `410 sync-token-expired`) | API | endpoints (breaking rename of an unconsumed contract) | 03.2 | Implemented |
| 04.0 | [SPA shell, browser auth & API client](04.0-spa-shell-auth.md) — Vite + React SPA (`@sin/web`), Auth0 PKCE (in-memory tokens, self-hosted refresh worker), React-free API client (problem+json → typed errors, `@sin/core` DTOs), router + protected routes + bootstrap gate, Render static site + strict CSP, CI web gate | UI / platform | web → Render static site | 01, 02 | Implemented |
| 04.1 | [Profile slice & UI foundation](04.1-profile-slice.md) — CSS-Modules design tokens + primitives, thumb-zone `AppShell` + bottom nav, `useSession`, error boundary, and the Profile vertical slice (`GET`/`PATCH /v1/me`: 422→field errors, cache write) | UI | web (same `@sin/web` bundle) | 04.0, 01, 02 | Implemented |
| 05.0 | [Workout session lifecycle](05.0-workout-session-lifecycle.md) — `workout` + `workout_exercise` tables; start / resume / edit / finish / delete a session; add, reorder, remove exercises; idempotent create; `local_date` derived once at write time | API | endpoints | 01, 02, 03.0, 03.1, 03.2 | Implemented |
| 05.1 | [Set logging](05.1-set-logging.md) — `set_entry`, per-modality validation, finish integrity rule | API | endpoints | 05.0 | Implemented |
| 05.2 | Rate limiting & per-user write quotas — also closes 03.2's D20 / D21 | API / platform | config + middleware | 05.0 (05.1 soft) | Not started |
| 06.0 | [Exercise picker & catalog client](06.0-exercise-picker.md) — React-free catalog store (`localStorage` sync-token cache behind a `StorageAdapter`), picker UI (recents + A–Z + filters), create-custom form; forked-origin hiding | UI | web | 03.3, 04.1 | Implemented |
| 06.1 | [Workout session screen](06.1-workout-session-screen.md) — start/resume, add/reorder/remove exercises, per-modality set rows, finish (incl. `409 incomplete-working-sets`), delete workout (the browser smoke is 06.3) | UI | web | 06.0, 05.0, 05.1 | Implemented |
| 06.2 | [Connectivity queue](06.2-connectivity-queue.md) — persisted outbox for set writes (keyed on 05.1's `clientGeneratedId`) with a pure projection, retry/backoff, per-row sync state, the queue survives a reload, Finish blocked on unsaved sets | UI | web | 06.1, 06.4 | Draft |
| 06.3 | [M1 Playwright smoke](06.3-m1-playwright-smoke.md) — one happy-path browser run against staging with a real Auth0 test user; post-deploy CI job; the 04.0 / 04.1 browser-only obligations | e2e / CI | CI job (no app change except a build-commit meta tag) | 06.1 | Draft |
| 06.4 | [Session screen hardening](06.4-session-screen-hardening.md) — 06.1's deferred review items: Finish cache-removal ordering, `hourCycle` start time, ref-based scroll, Enter-in-invalid-row feedback, id encoding, single-GET add-404, dismissible notices, missing 404 tests, the catalog-store interleaving tests (BL-12), and 06.1 doc reconciliation | UI | web | 06.1 | Implemented |
| 06.5 | Connectivity extras — persisted entry-row drafts, logout guard for unsaved sets, multi-tab co-operation (Web Locks), Playwright offline run | UI | web | 06.2 | Not started |
| 07 | History, progress & PR engine | API | endpoints | 05.1 | Not started |
| 08 | History & progress | UI | web | 06, 07 | Not started |
| 09 | Routines & supersets (Tier B) — adds `routine_id` / `superset_group` | API | endpoints | 05.0 | Not started |
| 10 | Routines & supersets | UI | web | 06, 09 | Not started |
| 11 | Account lifecycle — export, delete, purge cron, R2 bucket | API + cron | endpoints + job | 05.0, 05.1 | Not started |
| 12 | Account lifecycle | UI | web | 06, 11 | Not started |
| 13 | Observability & analytics — stand up Sentry + a trace backend + PostHog; dashboards for §1.3 metrics; alerts | ops | config + dashboards | 01, 04.0 | Not started |
| 14 | Marketing site (Next.js) | static | separate deploy | — | Not started |
| 15 | AWS migration (phase 2) — `infra/` in CDK or Terraform | infra | replaces Render | 01–13 stable | Not started |
| 16 | [Dev scenario tooling](16-dev-scenario-tooling.md) — scenario runner replaying typed fixtures against a running API (seed + assert), `.http` request collection, React-free HTTP client moved to `@sin/core/http` | dev tooling | none (local scripts) | 01, 03.1, 04.0, 05.0 | Draft |

**Ownership of cross-cutting concerns:**

- **Rate limiting + per-user write quotas** — Spec 05.2 (first write-heavy
  path). Spec 03.2's `POST /v1/exercises` landed a write path earlier; 03.2 was
  to decide whether to pull a minimal per-user create quota forward or record
  the gap. It did not pull one forward and recorded the gap (03.2 D20 / D21,
  carried forward in 05.0 §12 "Open"); 05.2 closes it.
- **`packages/core` domain math** (e1RM, volume, PR rules) — defined in the
  feature spec that uses it (05.1, 07) and added to `core` there. Spec 02 only
  lays the foundation.
- **Exercise catalog UI** (picker, create-custom) — Spec 06.0. A future
  "my exercises" management screen (edit/fork/delete) is not yet scheduled.
- **CSP + web security headers** — Spec 04.0 (Render static-site response
  headers: `Content-Security-Policy`, `X-Content-Type-Options`,
  `Referrer-Policy`). The API-side CORS `WEB_ORIGIN` allowlist stays Spec 01;
  the two are kept in sync per Spec 04.0 §8.

**Parallelism:** 03.0 needs 02 (it consumes `@sin/core` Zod DTOs); 03.1 needs
03.0; 03.2 needs 03.1; 03.3 needs 03.2 (it fixes the cursor 03.2's writes
exposed the bug in, per #23/BL-1) and must land before Spec 06.0 starts
consuming `GET /v1/exercises` (the exercise picker is the first real consumer;
Spec 05.0 resolves ids via `findVisibleById` and doesn't sync). 04.1 needs
04.0. 05.0 needs 03.1 (`findVisibleById`) and 03.2 (`ExerciseRetiredError`,
`is_active`); 05.1 needs 05.0; 05.2 can land any time after 05.0 — 05.1 is a
soft dependency, since 05.2 should cover the set-write path if it already
exists — but must precede a public beta. 06.0 needs only 03.3 and 04.1, so it
does not wait on 05.0/05.1 and can land in parallel with them; 06.1 needs
06.0, 05.0, and 05.1 (including its D14/D15 follow-up); 06.2 needs 06.1 (and,
transitively, 05.1's `clientGeneratedId`); 06.3 needs 06.1 and the Render
`si-web-staging` site, and 06.2 does **not** depend on it (the two can land in
either order; the smoke should be re-run once 06.2 lands); 06.4 needs 06.1 and
should land **before 06.2** (it carries BL-12's catalog-store interleaving tests,
which must exist before 06.2 wraps `createCustom` in a queue, and settles where
Finish's cache removal lives, which 06.2's queue assumes) — it is independent of
06.3. The API specs (05.0, 05.1, 05.2, 07, 09, 11) can run
ahead of their UIs. 16 has no downstream dependents and can land any time
after 05.0; it is most useful before 06.1 starts.

**Milestone mapping:** M0 = 01, 02, 04.0, 04.1 · M1 = 03.0, 03.1, 03.2, 03.3,
05.0, 05.1, 05.2, 06.0, 06.1, 06.2, 06.3, 06.4, 06.5 · M2 = 07, 08 · M3 = 09, 10 · M4 = 11, 12, 13 · GA = 14 ·
Phase 2 = 15. (`packages/core` (02) is a foundation both M0 clients import — an
M0 prerequisite, not M1 work.)

## Spec template

Sections, in order. Keep each tight; a section that does not apply to a
library / UI / infra spec says so in one line and points elsewhere.

1. **Purpose, scope & non-goals** — what this component does; what it explicitly does not
2. **Acceptance criteria** — a numbered list of verifiable statements; the definition of done
3. **Dependencies & exposed interface** — what it needs (specs, services, env); what it *provides* that later specs may rely on (stable surface — changes to it are breaking)
4. **Data model** — tables this spec owns: columns, indexes, constraints, the migration, any backfill
5. **API surface** — endpoints, request/response shapes, error cases, auth requirements. *UI specs replace this with **Screens & flows**.*
6. **Behavior & logic** — the rules, edge cases, and sequence diagrams for anything non-obvious
7. **Security & privacy** — leak vectors, abuse cases, the authorization boundary, PII handling
8. **Config & secrets** — every env var, and where it is set per environment
9. **Observability** — logs, traces, metrics this component emits
10. **Testing** — how each acceptance criterion is verified (unit / integration / e2e)
11. **Deployment & rollback** — how it ships, migration ordering, how to back it out
12. **Decisions & open questions** — resolved decisions (✅ with rationale, same convention as DESIGN.md) and still-open items
