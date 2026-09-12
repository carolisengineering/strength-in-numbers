# strength-in-numbers

Workout-logging + progress-tracking web app. Responsive web only for v1 (mobile-first,
usable one-handed in a gym); native mobile is post-v1 but the API/domain layer is kept
ready for it. Solo-developer project — keep process proportional, and cover frontend /
JS-ecosystem concepts from first principles rather than assuming familiarity.

## Layout (pnpm workspaces, Node 22)

- `apps/api` — Fastify + Prisma + TypeScript backend (`@sin/api`)
- `packages/core` — framework-agnostic domain code (`@sin/core`); CI purity check forbids
  React / DOM / Node-only imports
- `apps/web` — Vite + React SPA (`@sin/web`): Auth0 PKCE, React-free API client, CSS-Modules
  design tokens (`src/ui/tokens.css` is the only place design values are written)
- `docs/` — see below

## Commands

```bash
pnpm install                                   # frozen lockfile in CI
pnpm run build                                 # pnpm -r build
pnpm run lint                                  # NEVER bare `pnpm lint` — it misbehaves
pnpm run typecheck
pnpm run core:purity
pnpm --filter @sin/api run test:unit           # apps/api/test/unit
RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration   # Testcontainers Postgres
pnpm --filter @sin/api run dev                 # local API on :8080, loads apps/api/.env
pnpm --filter @sin/api run dev:idp             # local JWKS + token minter on :9999 (loopback only)
pnpm --filter @sin/api run seed:catalog [dir]  # idempotent catalog seed (Spec 03.1); manual release step after migrate deploy
pnpm --filter @sin/web run test:coverage        # web unit tests + the src/api / src/auth >=90% gates
pnpm --filter @sin/web run assert:css-tokens    # AC1 tripwire: only tokens.css may hard-code colours / px
```

Local ports: compose Postgres `5433` (native PG owns 5432), API `8080`, dev-idp `9999`.

## How work is structured

- **Spec-driven.** Every component gets a `docs/specs/NN-slug.md` following the **12-section
  template** in `docs/specs/README.md`. Feature work splits into an API spec and a UI spec,
  API-first. Keep each spec to one work session.
- **`docs/DESIGN.md` is the source of truth.** If a spec or the code disagrees with it,
  update DESIGN.md so they stay consistent — don't let them drift.
- **TDD.** Every behavioral acceptance criterion has ≥1 test that names its number
  (`describe("AC7 — …")`). Infra/pipeline criteria are verified by CI, not unit tests.
  `apps/api/src/plugins/auth` and `apps/api/src/repositories/user` stay ≥90% line coverage.
- **Before a PR:** run `/security-review`, `/code-review`, and the `change-auditor` agent.

## Conventions & gotchas

- **Error contract** (RFC 9457 problem+json) must be registered on BOTH the root scope and
  the `/v1` child scope.
- **Catalog seed** (`apps/api/prisma/seed.ts` → `src/seed/`) is a manual release step after
  `migrate deploy`, NOT Prisma's `prisma.seed` hook. Append-only: never edit a live row's
  `name`/`modality` in `prisma/catalog/exercises.json` — retire the key and add a new one.
- **Prisma migrations** run as a release step, never on app boot. Additive / expand-only —
  never drop or rename a column in the same release as the code that stops using it.
- **`DATABASE_URL`**: `resolveDatabaseUrl` backfills `sslmode=require` + `connection_limit=8`
  at runtime. For Neon, use the **direct** host (not `-pooler`) for `prisma migrate deploy`.
- **Docker**: the runtime stage generates the Prisma client explicitly (`@prisma/client`
  postinstall can't find the schema in a pnpm monorepo); base stage installs `openssl` +
  `ca-certificates` (`node:22-slim` omits them). Don't remove those lines.
- **Fastify v5** wants `loggerInstance` (not `logger`) for a prebuilt pino; `buildApp`
  branches on the arg type.
- `describe.skipIf(cond)` still runs `beforeAll` when `cond` is wrong — guard setup too.
- Never use the word "dummy" (code, comments, config, docs) — use placeholder / test / fake / stub.

## Infrastructure

- **Staging:** API at `https://si-api-ft2f.onrender.com` (Render free plan — cold starts
  after idle), Neon free Postgres. Auth0 tenant `dev-gncuqvfir0wv0t4l`, API audience
  `https://api.strengthinnumbers.app`.
- **CI** (`.github/workflows/ci.yml`): lint/typecheck/unit/purity + integration + docker
  build on every PR; a `post-deploy smoke` job runs `apps/api/scripts/smoke.ts` against
  staging on push to `main`. Merge to `main` auto-deploys staging (Render `autoDeploy`).
- **Prod** is not set up — the gated staging→prod pipeline is drafted in
  `docs/specs/01.1-prod-deploy-pipeline.md`.
- Runbook for the whole deploy: `docs/runbooks/first-deploy.md`.
- Phase 2 (post-M2): migrate off Render to AWS (CDK/Terraform + Fargate + RDS), tracked as
  Spec 15.

## docs/ map

- `docs/DESIGN.md` — overall design, resolved decisions (Q1–Q12)
- `docs/specs/` — component specs + `README.md` (roadmap, 12-section template, ownership)
- `docs/runbooks/` — operational runbooks (`first-deploy.md`)
- `docs/security-backlog.md` — deferred security items (SB-1..7)
- `docs/backlog.md` — deferred non-security fixes / known issues (BL-1..)

## Subagents (`.claude/agents/`)

`architect` (design/architecture decisions + DESIGN.md + draft/review specs)
`test-engineer` (test strategy, criterion-tagged tests, fixtures, coverage gaps, suite health)
`change-auditor` (read-only changeset audit — spec conformance, config wiring, migration safety)
`deploy-verify` (run smoke checks + inspect CI)
`tech-writer` (human-facing prose — PR descriptions, release notes, changelog, README sections)
Keep their baked-in conventions in sync with this file.
