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
| 01 | [Foundation & Auth](01-foundation-auth.md) | API / platform | API → Render staging + prod | — | Draft |
| 01.1 | [Production deploy pipeline](01.1-prod-deploy-pipeline.md) | platform / CI-CD | gated `staging → prod` promotion | 01 | Draft |
| 02 | `packages/core` foundation — types, Zod setup, units conversion, purity check | library | workspace package | 01 | Not started |
| 03 | Exercise catalog | API | endpoints | 01, 02 | Not started |
| 04 | SPA shell & browser auth — Vite app, Auth0 PKCE, authed API client, app frame, styling foundation | UI / platform | web → Render | 01 | Not started |
| 05 | Workout logging | API | endpoints | 01–03 | Not started |
| 06 | Workout logging | UI (incl. exercise picker) | web | 04, 05 | Not started |
| 07 | History, progress & PR engine | API | endpoints | 05 | Not started |
| 08 | History & progress | UI | web | 06, 07 | Not started |
| 09 | Routines & supersets (Tier B) | API | endpoints | 05 | Not started |
| 10 | Routines & supersets | UI | web | 06, 09 | Not started |
| 11 | Account lifecycle — export, delete, purge cron, R2 bucket | API + cron | endpoints + job | 05 | Not started |
| 12 | Account lifecycle | UI | web | 06, 11 | Not started |
| 13 | Observability & analytics — stand up Sentry + a trace backend + PostHog; dashboards for §1.3 metrics; alerts | ops | config + dashboards | 01, 04 | Not started |
| 14 | Marketing site (Next.js) | static | separate deploy | — | Not started |
| 15 | AWS migration (phase 2) — `infra/` in CDK or Terraform | infra | replaces Render | 01–13 stable | Not started |

**Ownership of cross-cutting concerns:**

- **Rate limiting + per-user write quotas** — Spec 05 (first write-heavy path).
- **`packages/core` domain math** (e1RM, volume, PR rules) — defined in the
  feature spec that uses it (05, 07) and added to `core` there. Spec 02 only lays
  the foundation.
- **Exercise catalog UI** (picker, "my custom exercises") — folded into Spec 06.

**Parallelism:** 02, 03 can run alongside 04 once 01 lands. The API specs
(05, 07, 09, 11) can run ahead of their UIs.

**Milestone mapping:** M0 = 01 + 04 · M1 = 02, 03, 05, 06 · M2 = 07, 08 ·
M3 = 09, 10 · M4 = 11, 12, 13 · GA = 14 · Phase 2 = 15.

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
