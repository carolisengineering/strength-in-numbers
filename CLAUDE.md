# strength-in-numbers

Workout-logging + progress-tracking web app. Responsive web only for v1 (mobile-first, usable one-handed in a gym); native mobile is post-v1 but the API/domain layer is kept ready for it. Solo-developer project — keep process proportional, and cover frontend / JS-ecosystem concepts from first principles rather than assuming familiarity.

## Layout (pnpm workspaces, Node 22)

The root `.npmrc` pins `use-node-version=22.23.4`: every `pnpm` command in this repo runs on that
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
DATABASE_URL='<url>' pnpm --filter @sin/api run account:purge [--confirm] [--user <id>] [--skip-grace]  # Spec 11; dry run by default; operator task (runbook), NOT a release step
pnpm --filter @sin/api run bench:finish         # Spec 07.0 AC27 finish-latency benchmark (Docker; dev tool, not CI)
pnpm --filter @sin/api run bench:history        # Spec 07.1 AC20 history-page latency benchmark (Docker; dev tool, not CI)
pnpm --filter @sin/api run bench:progress       # Spec 07.2 AC19 progress-series latency benchmark (Docker; dev tool, not CI)
pnpm --filter @sin/api run bench:exercise-usage # Spec 03.4 AC32 usage-read latency benchmark (Docker; dev tool, not CI)
pnpm --filter @sin/api run bench:hevy-import    # Spec 19.1 AC33 import batch + finish latency benchmark (Docker; dev tool, not CI)
pnpm --filter @sin/web run screens              # Spec 17.0 design-review screenshots (fake auth + fake API, light+dark, 390/1280 px) -> apps/web/.screens/ (gitignored); dev tool, not CI
pnpm --filter @sin/web run test:coverage        # web unit tests + the src/api / src/auth >=90% gates
pnpm --filter @sin/web run e2e                  # Spec 06.3 browser smoke vs staging; needs E2E_BASE_URL + E2E_AUTH0_* (docs/runbooks/m1-browser-smoke.md)
pnpm --filter @sin/web run assert:css-tokens    # AC1 tripwire: only tokens.css may hard-code colours / px
docker compose -f docker-compose.observability.yml up -d   # local Prometheus :9090, Tempo :4318, Grafana :3001 (Spec 13.0; runbook docs/runbooks/observability.md)
terraform -chdir=infra fmt -recursive && terraform -chdir=infra validate   # Spec 15; Terraform 1.17.0 exactly (CI's infra job); apply only by hand (runbook Part F)
pnpm --filter @sin/api exec tsx scripts/check-prod-ids.ts --strict   # Spec 15 go-live: refuses REPLACE_ME placeholders in infra/prod.tfvars
```

Local ports: compose Postgres `5433` (native PG owns 5432), API `8080`, dev-idp `9999`, API metrics `9464` (telemetry on), Prometheus `9090`, Tempo `4318`/`3200`, Grafana `3001`.

## How work is structured

- **Spec-driven.** Every component gets a `docs/specs/NN-slug.md` following the **12-section template** in `docs/specs/README.md`. Feature work splits into an API spec and a UI spec,
  API-first. Keep each spec to one work session.
- **`docs/DESIGN.md` is the source of truth.** If a spec or the code disagrees with it, update DESIGN.md so they stay consistent — don't let them drift.
- **TDD.** Every behavioral acceptance criterion has ≥1 test that names its number (`describe("AC7 — …")`). Infra/pipeline criteria are verified by CI, not unit tests. `apps/api/src/plugins/auth` and `apps/api/src/repositories/user` stay ≥90% line coverage.
- **Before a PR:** run `/security-review`, `/code-review`, and the `change-auditor` agent.

## Conventions & gotchas

Repo-wide gotchas are below. Package-specific conventions load only when working in that package: `apps/web/CLAUDE.md` (web UI), `apps/api/CLAUDE.md` (API), `packages/core/CLAUDE.md` (routine-from-text reader).

- **Validation messages are static** (#57): every Zod issue message in `@sin/core` is fixed text or a module constant — never the parsed value, no `params`, no `reportInput` — because a `custom` message is returned verbatim in the 422 body. `packages/core/test/static-issue-messages.test.ts` probes every exported schema's message functions and scans every `message:` in `src/`. The API `err` serializer (`apps/api/src/logging.ts`) stubs Prisma, Zod and request-validation errors and masks path segments that aren't identifiers or indexes.
- **Prisma migrations** run as a release step, never on app boot. Additive / expand-only — never drop or rename a column in the same release as the code that stops using it.
- **Docker**: the runtime stage generates the Prisma client explicitly (`@prisma/client` postinstall can't find the schema in a pnpm monorepo); base stage installs `openssl` + `ca-certificates` (`node:22-slim` omits them). Don't remove those lines.
- **Image + action pins** (#9): `Dockerfile`, `docker-compose.yml` and `apps/api/test/integration/postgres-image.ts` pin images as `name:patch-tag@sha256:…` (multi-arch *index* digest — never a per-platform one); `ci.yml` pins actions to commit SHAs. Bump via the Dependabot PR, or `docker buildx imagetools inspect <ref>` by hand; keep `postgres-image.ts` identical to compose (the `image-pins` unit test enforces it).
- `describe.skipIf(cond)` still runs `beforeAll` when `cond` is wrong — guard setup too.
- Never use the word "dummy" (code, comments, config, docs) — use placeholder / test / fake / stub.
- **Production deploy** (Spec 15): `GET /healthz` returns `{ status, commit }` (`resolveCommit`: `SIN_COMMIT` baked in by the image's `GIT_COMMIT` build arg, else `RENDER_GIT_COMMIT`, else `"dev"`). The staging `smoke` job's step names `Wait for staging to serve this commit` and `Staging API smoke (commit verified)`, and the job name `post-deploy smoke (staging)`, are read by the release gate (`apps/api/scripts/lib/release-gate.ts`) — rename them together. `infra/prod.tfvars` is the one source of production identifiers and origins (`prod-origins.test.ts`); Terraform owns everything except the Cloud Run image (`ignore_changes`); never `terraform apply` from CI. `apps/web/firebase.json` must send the same headers and CSP as `render.yaml`'s si-web-staging block, with the production API origin (`assert-firebase-json.mjs` in the CI `web` job). `deploy-prod` checks `prisma migrate status` (read-only) after approval and never migrates; the database URL is scrubbed from its output (`scrubDatabaseUrl`).

## Infrastructure

- **Staging:** API at `https://si-api-ft2f.onrender.com` (Render free plan — cold starts after idle), Neon free Postgres. Auth0 tenant `dev-gncuqvfir0wv0t4l`, API audience `https://api.strengthinnumbers.app`.
- **CI** (`.github/workflows/ci.yml`): lint/typecheck/unit/purity + integration + docker build on every PR; a `post-deploy smoke` job runs `apps/api/scripts/smoke.ts` and `apps/web/scripts/smoke.mjs` against staging on push to `main`, then the `e2e` job (Spec 06.3 Playwright smoke; waits for the deployed `<meta name="sin-commit">` to equal the SHA; skipped with a notice until the `E2E_AUTH0_*` secrets exist). Merge to `main` auto-deploys staging (Render `autoDeploy`).
- **Prod** (Spec 15): Google Cloud — Cloud Run `si-api` in `us-central1` (scale to zero, max 1), Firebase Hosting, a separate Neon free project; Terraform in `infra/` (applied by hand, never from CI); released only by the `deploy-prod` workflow (owner-approved, by image digest). Runbook `docs/runbooks/first-deploy.md` Part F. Until the owner runs Part F, `infra/prod.tfvars` holds `REPLACE_ME_*` placeholders, the CI `publish` job skips and `deploy-prod` refuses.
- Runbook for the whole deploy: `docs/runbooks/first-deploy.md`.

## docs/ map

- `docs/DESIGN.md` — overall design, resolved decisions (Q1–Q12)
- `docs/specs/` — component specs + `README.md` (roadmap, 12-section template, ownership)
- `docs/runbooks/` — operational runbooks (`first-deploy.md`)
- `docs/security-backlog.md` — deferred security items (SB-1..7)
- `docs/backlog.md` — deferred non-security fixes / known issues (BL-1..)

## Subagents (`.claude/agents/`)

The harness lists each agent's purpose. Keep their baked-in conventions in sync with these CLAUDE.md files.
