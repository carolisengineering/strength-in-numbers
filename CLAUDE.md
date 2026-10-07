# strength-in-numbers

Workout-logging + progress-tracking web app. Responsive web only for v1 (mobile-first, usable one-handed in a gym); native mobile is post-v1 but the API/domain layer is kept ready for it. Solo-developer project — keep process proportional, and cover frontend / JS-ecosystem concepts from first principles rather than assuming familiarity.

## Layout (pnpm workspaces, Node 22)

The root `.npmrc` pins `use-node-version=22.23.3`: every `pnpm` command in this repo runs on that
Node regardless of the shell's `node` (pnpm downloads it once). Use `pnpm run …` / `pnpm exec …`,
never `npx` — `npx prisma` fetches the latest Prisma instead of the repo's pinned one.

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
DATABASE_URL='<url>' pnpm run db:migrate:status   # repo-pinned Prisma; for Neon use the exact DATABASE_URL from Render (runbook B4)
DATABASE_URL='<url>' pnpm run db:migrate:deploy   # manual release step — migrations never run on boot
pnpm --filter @sin/api run seed:catalog [dir]  # idempotent catalog seed (Spec 03.1); manual release step after migrate deploy
DATABASE_URL='<url>' pnpm --filter @sin/api run records:rebuild [--user <id>]  # Spec 07.0; manual release step after migrate deploy (runbook B5a)
pnpm --filter @sin/api run bench:finish         # Spec 07.0 AC27 finish-latency benchmark (Docker; dev tool, not CI)
pnpm --filter @sin/api run bench:history        # Spec 07.1 AC20 history-page latency benchmark (Docker; dev tool, not CI)
pnpm --filter @sin/web run test:coverage        # web unit tests + the src/api / src/auth >=90% gates
pnpm --filter @sin/web run e2e                  # Spec 06.3 browser smoke vs staging; needs E2E_BASE_URL + E2E_AUTH0_* (docs/runbooks/m1-browser-smoke.md)
pnpm --filter @sin/web run assert:css-tokens    # AC1 tripwire: only tokens.css may hard-code colours / px
```

Local ports: compose Postgres `5433` (native PG owns 5432), API `8080`, dev-idp `9999`.

## How work is structured

- **Spec-driven.** Every component gets a `docs/specs/NN-slug.md` following the **12-section template** in `docs/specs/README.md`. Feature work splits into an API spec and a UI spec,
  API-first. Keep each spec to one work session.
- **`docs/DESIGN.md` is the source of truth.** If a spec or the code disagrees with it, update DESIGN.md so they stay consistent — don't let them drift.
- **TDD.** Every behavioral acceptance criterion has ≥1 test that names its number (`describe("AC7 — …")`). Infra/pipeline criteria are verified by CI, not unit tests. `apps/api/src/plugins/auth` and `apps/api/src/repositories/user` stay ≥90% line coverage.
- **Before a PR:** run `/security-review`, `/code-review`, and the `change-auditor` agent.

## Conventions & gotchas

- **Error contract** (RFC 9457 problem+json) must be registered on BOTH the root scope and the `/v1` child scope.
- **OpenAPI publication is opt-in** (#10): a public `/v1` route needs `config: { published: true, problems: [...] }` to appear in `/openapi.json`; anything else is hidden by default. `schema: { hide: true }` is now only the infra routes' opt-out from the response-schema check. Never set `config.swaggerTransform` (app assembly fails — it bypasses the gate).
- **`/v1` caching** (#17/#18): `Cache-Control` is set only by the `/v1` cache policy (`apps/api/src/plugins/cache-policy.ts`) — `no-store` by default and on every error; a `GET` that serves an `ETag` declares `config: { httpCache: "revalidate" }` → `private, no-cache`. Never hand-set `Cache-Control` in a `/v1` handler, and no `Vary: Authorization` (`private` is the cross-user protection).
- **Catalog seed** (`apps/api/prisma/seed.ts` → `src/seed/`) is a manual release step after `migrate deploy`, NOT Prisma's `prisma.seed` hook. Append-only: never edit a live row's `name`/`modality` in `prisma/catalog/exercises.json` — retire the key and add a new one.
- **Prisma migrations** run as a release step, never on app boot. Additive / expand-only — never drop or rename a column in the same release as the code that stops using it.
- **`DATABASE_URL`**: `resolveDatabaseUrl` backfills `sslmode=require` + `sslaccept=strict` (server-cert + hostname verification) + `connection_limit=8` at runtime, and boot rejects libpq's `sslmode=verify-full` (Prisma silently downgrades it to `prefer`). The stored secret must carry `sslaccept=strict` itself because `prisma migrate deploy` reads the raw URL. For Neon, use the **direct** host (not `-pooler`) for `prisma migrate deploy`.
- **Docker**: the runtime stage generates the Prisma client explicitly (`@prisma/client` postinstall can't find the schema in a pnpm monorepo); base stage installs `openssl` + `ca-certificates` (`node:22-slim` omits them). Don't remove those lines.
- **Image + action pins** (#9): `Dockerfile`, `docker-compose.yml` and `apps/api/test/integration/postgres-image.ts` pin images as `name:patch-tag@sha256:…` (multi-arch *index* digest — never a per-platform one); `ci.yml` pins actions to commit SHAs. Bump via the Dependabot PR, or `docker buildx imagetools inspect <ref>` by hand; keep `postgres-image.ts` identical to compose (the `image-pins` unit test enforces it).
- **Fastify v5** wants `loggerInstance` (not `logger`) for a prebuilt pino; `buildApp` branches on the arg type.
- `describe.skipIf(cond)` still runs `beforeAll` when `cond` is wrong — guard setup too.
- Never use the word "dummy" (code, comments, config, docs) — use placeholder / test / fake / stub.
- **Web logout + user data** (Spec 06.0): `logoutAndClear()` (`apps/web/src/auth/logout.ts`) is the only place that calls Auth0 `logout` — a unit test fails if another source file builds `logoutParams`. Anything that persists per-user data in `localStorage` uses a `sin:<name>:` key prefix listed in `USER_DATA_KEY_PREFIXES` (`apps/web/src/storage/clearUserData.ts`) so logout clears it, and goes through the `StorageAdapter` in `apps/web/src/storage/storage.ts` — the Spec 04.0 AC7 source scan fails if any other non-test module names `localStorage` / `sessionStorage` (comments included).
- **jsdom has no `<dialog>` `showModal()`/`close()`** — `apps/web/src/test/setup.ts` shims them (attribute toggle only). Real focus/Escape behavior needs a browser test.
- **Personal records** (Spec 07.0): `personal_record` is a rebuildable cache keyed on the exercise's lineage root (`COALESCE(forked_from_exercise_id, id)`). Every write goes through `recomputeRecordsForRoots` (finish, delete, `records:rebuild`), and every PR writer takes `lockUserRecords` (per-user advisory lock) as its FIRST statement, before any workout row lock — the recompute's INSERTs take FK `KEY SHARE` locks on other workouts' rows, so row-lock-first deadlocks (AC18). PR math lives only in `@sin/core` `records.ts` on integer milli-units; Spec 07.2's e1RM chart must reuse `estimate1rm`.
- **Paginated lists** (Spec 07.1 §6.2): keyset, never offset; an opaque `v1.` cursor encoding the sort tuple with a unique tiebreaker; timestamps travel as Postgres-formatted UTC text with microseconds (`to_char(… AT TIME ZONE 'UTC', …US"Z"')`), never through a JS `Date`; a malformed cursor is a 422 on `cursor` before any query; `next: null` ends the list. Copy `apps/api/src/repositories/workout-cursor.ts`.
- **Rate limits** (Spec 05.2): every `/v1` write route declares `config: { writeGroup }` (app assembly fails without it); limits live only in `RATE_LIMITS` (`apps/api/src/plugins/rate-limit.ts`); a test that exceeds them passes `rateLimits: GENEROUS_LIMITS` / `limitsWith(...)` to `buildTestApp`. `config.skipRateLimit` is for the liveness/readiness probes only; `/openapi.json` is limited (L1 + its `ipBudget: "docs"` budget, AC17). The client address is `clientAddress()` — `CF-Connecting-IP` only when the socket is private/loopback (Render's own infrastructure), else the socket itself; Fastify has no `trustProxy` and `X-Forwarded-For` is never read. Never trust Cloudflare's IP ranges as proxies — WARP/Worker end users egress from them and could forge either header. Every request logs `client_ip`; re-run runbook D4.d after any hosting change.

## Infrastructure

- **Staging:** API at `https://si-api-ft2f.onrender.com` (Render free plan — cold starts after idle), Neon free Postgres. Auth0 tenant `dev-gncuqvfir0wv0t4l`, API audience `https://api.strengthinnumbers.app`.
- **CI** (`.github/workflows/ci.yml`): lint/typecheck/unit/purity + integration + docker build on every PR; a `post-deploy smoke` job runs `apps/api/scripts/smoke.ts` and `apps/web/scripts/smoke.mjs` against staging on push to `main`, then the `e2e` job (Spec 06.3 Playwright smoke; waits for the deployed `<meta name="sin-commit">` to equal the SHA; skipped with a notice until the `E2E_AUTH0_*` secrets exist). Merge to `main` auto-deploys staging (Render `autoDeploy`).
- **Prod** is not set up — the gated staging→prod pipeline is drafted in `docs/specs/01.1-prod-deploy-pipeline.md`.
- Runbook for the whole deploy: `docs/runbooks/first-deploy.md`.
- Phase 2 (post-M2): migrate off Render to AWS (CDK/Terraform + Fargate + RDS), tracked as Spec 15.

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
