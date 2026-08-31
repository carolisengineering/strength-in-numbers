# Spec 01 — Foundation & Auth

**Status:** Draft v0.4 — §12 questions Q1–Q10 resolved; pre-implementation review pass
**Last updated:** 2026-08-31
**Design refs:** DESIGN.md §3 (architecture), §4.1 (`user`), §5.1 (auth), §6 (API), §7 (infra), §8.2 (security), §9 (M0)

---

## 1. Purpose, scope & non-goals

Stand up the deployable API service and prove, on Render staging, that it
validates real Auth0 access tokens and provisions a `user` row on first
authenticated request. This is the M0 backend skeleton; every later API spec
builds inside it.

### In scope

- Monorepo layout (pnpm workspaces): `apps/api`, `packages/core` (stub), reserved `apps/web`.
- Fastify app: bootstrap, plugin structure, graceful shutdown, request-id propagation.
- App hardening: `@fastify/cors` (per-env origin allowlist), `@fastify/helmet`, explicit JSON body-size limit.
- Typed config: env → Zod-validated object, fail-fast at boot.
- PostgreSQL via Prisma: connection, pool, migration harness.
- First migration: `user` table (DESIGN §4.1).
- Auth: JWKS-based RS256 JWT verification (issuer + audience + expiry), `sub` → `user` provisioning, soft-delete handling.
- Auth0 **Action** (post-login) that adds namespaced `email` + `email_verified` claims to the access token, deployed to the staging and prod tenants.
- Repository layer + `assertOwned` helper — the choke point where later visibility checks land (DESIGN §5.1 / R8).
- Error contract: RFC 9457 `application/problem+json`, central error→response mapper.
- Health endpoints: `GET /healthz` (liveness), `GET /readyz` (readiness incl. DB).
- Proof endpoints: `GET /v1/me`, `PATCH /v1/me`, `GET /v1/_authcheck`.
- Structured request logging (pino); OpenTelemetry SDK wired (exporter optional/no-op).
- `render.yaml` blueprint: API web service + managed Postgres + env groups; staging + production.
- CI: lint, typecheck, unit tests, `packages/core` purity check, migration dry-run; post-deploy smoke against staging.
- Local dev: `docker-compose` with Postgres.

### Non-goals

- Any domain feature — workouts, exercises, routines, progress. (Specs 03+.)
- The SPA and the **browser** Auth0 login / PKCE flow, refresh-token handling in a browser. (Spec 04.) *Note: the CORS policy the browser client needs is configured here (§5.5, §8) — Spec 04 only supplies its origin.*
- R2 / object storage. (Spec 11.)
- Rate limiting, per-user write quotas. (Spec 05.)
- Standing up an OTel backend, Sentry, PostHog. (Spec 13 — SDK is wired here, no exporter.)
- Account-linking across Auth0 connections; multi-region; autoscaling.

---

## 2. Acceptance criteria

1. `pnpm install && pnpm -w build` succeeds from a clean checkout; `pnpm -w test` is green.
2. Starting the API with any required env var missing or invalid exits non-zero with a message naming the var, before binding a port.
3. `GET /healthz` returns `200 {"status":"ok"}` with no DB dependency.
4. `GET /readyz` returns `200` when Postgres is reachable and `503` problem+json when it is not.
5. A request to `GET /v1/me` with **no** bearer token returns `401` problem+json, slug `unauthenticated`.
6. A request with an expired / wrong-`aud` / wrong-`iss` / bad-signature token returns `401`, slug `invalid-token`; the client body contains no internal detail.
7. A valid token for a `sub` not seen before causes exactly one `user` row to be inserted; the response has `isNewUser: true`; a second call returns `isNewUser: false`.
8. Two concurrent first requests for the same new `sub` result in exactly one `user` row and no `500`.
9. A valid token whose `user` row has `deleted_at` set returns `403`, slug `account-deleted`.
10. `PATCH /v1/me` with a valid body updates the row and advances `updated_at`; with an unknown field or bad `unitPreference` it returns `422` with a populated `errors[]`.
11. `prisma migrate deploy` runs as a Render pre-deploy step (not on app boot); `0001_create_user` applies cleanly to an empty database.
12. Pushing to `main` deploys the API to Render staging; the CI post-deploy smoke gets `200` from `GET /v1/_authcheck` with a real M2M token **and** confirms `GET /v1/me` with that same token returns `401` (no `email` claim on an M2M token).
13. `SIGTERM` causes a graceful shutdown: in-flight requests drain, the DB pool closes, the process exits 0.
14. `docker build` produces a runnable image; the same image serves the API in local `docker-compose` and on Render.
15. A cross-origin `OPTIONS` preflight from a configured `WEB_ORIGIN` returns `204` with the expected `Access-Control-Allow-*` headers; the same preflight from an unlisted origin omits the allow-origin header. A response to a normal request carries `X-Request-Id` in `Access-Control-Expose-Headers`.
16. When the JWKS endpoint is unreachable (not merely an unknown `kid`), `GET /v1/me` returns `503` problem+json, slug `auth-unavailable` — never `401`.
17. Every response carries the `@fastify/helmet` default security headers (incl. HSTS in production); a request body over the configured limit is rejected with `413` before the handler runs.
18. Each behavioral criterion (3–10, 13, 15–17) has ≥ 1 committed automated test (unit or integration per §10) tagged with its criterion number. Infra/pipeline criteria (11, 12, 14) are verified by the CI job and post-deploy smoke instead.
19. CI runs `pnpm -w test` (plus lint, typecheck, `packages/core` purity check, migration dry-run) on every PR and **blocks merge on any failure**. Coverage is reported; the auth plugin and provisioning module (`apps/api/src/plugins/auth`, `apps/api/src/repositories/user`) are held at ≥ 90% line coverage.

---

## 3. Dependencies & exposed interface

### Needs

| Kind | Item | Notes |
|---|---|---|
| External | **Auth0 tenants** | Two: `si-staging` and `si-prod` (Q1-A). Local dev points at `si-staging`. Each tenant needs: an **API** (audience = our API identifier); an **M2M application** authorized for it (smoke test only); a post-login **Action** that sets `<namespace>email` and `<namespace>email_verified` on the access token (Q3-A). The two Actions are kept in sync by hand for now; version-controlled via the Auth0 Deploy CLI / Terraform in Spec 15. |
| External | **Render account** | `staging` (auto-deploy `main`) + `production` (promote). Managed Postgres per env. |
| Internal | none | Root spec. |

### Provides (stable surface later specs build on)

- **`user` table** + Prisma `User` model.
- **Auth plugin** — populates `request.auth` (`{ authSub, email, claims }`) and, for `/v1/*`, `request.user` (the `User` row). Rejects unauthenticated/invalid/deleted before the handler runs.
- **Repository conventions** — `apps/api/src/repositories/*`; every user-scoped fn takes `actingUserId` first; `assertOwned(row, actingUserId)` throws `NotFoundError`.
- **Error contract** — `problemResponse(reply, error)` mapper + the `AppError` hierarchy (`UnauthenticatedError`, `InvalidTokenError`, `NotFoundError`, `ValidationError`, …).
- **Typed config loader** — `config` object, validated; the pattern later specs extend with their own vars.
- **App hardening defaults** — CORS (origin allowlist from `WEB_ORIGIN`), helmet headers, JSON body-size limit, all applied app-wide; later specs inherit them and only widen the CORS origin list or body limit if they must.
- **Request context** — `request.id`, `request.log` (pino child with `request_id`, `user_id`).
- **`render.yaml`** — the blueprint later specs add services/jobs to.
- Route conventions: `/v1` prefix for domain routes; health routes unversioned.

---

## 4. Data model

Owned by this spec: **`user`** only.

```
Table: user
  id                 uuid         PK, app-generated UUIDv7
  auth_sub           text         NOT NULL, UNIQUE
  email              text         NOT NULL
  email_verified     boolean      NOT NULL DEFAULT false
  display_name       text         NULL
  unit_preference    text         NOT NULL DEFAULT 'kg'   CHECK (unit_preference IN ('kg','lb'))
  timezone           text         NOT NULL DEFAULT 'UTC'   -- IANA name
  created_at         timestamptz  NOT NULL DEFAULT now()
  updated_at         timestamptz  NOT NULL DEFAULT now()
  deleted_at         timestamptz  NULL

Indexes:
  user_auth_sub_key   UNIQUE (auth_sub)
  user_email_idx      (email)                             -- non-unique on purpose
```

- **`email` is not unique.** Auth0 is the identity authority and `auth_sub` is the
  only stable key. Two connections (Google, password) for one human are different
  `sub`s; email-uniqueness would break provisioning. Account linking is out of scope.
- `email` and `email_verified` come from namespaced access-token claims set by the
  Auth0 Action (Q3-A). If `email` is absent the request is rejected (§6) rather
  than storing null; if `email_verified` is absent it stores `false`. This column
  is informational only — nothing security-sensitive keys off it in v1.
- `email` / `email_verified` are refreshed from the token on every request that
  finds them changed (cheap `UPDATE`), so an IdP-side email change propagates.
- `updated_at` set by the application on write (no DB trigger in v1).
- UUIDv7 generated in application code via the `uuidv7` package (Q5).
- This adds `email_verified` to DESIGN §4.1's `user` — design doc updated to match.

**Migration `0001_create_user`** (Prisma Migrate): additive, expand-only; down
migration drops the table. No backfill (new table).

---

## 5. API surface

All domain routes under `/v1`. Health routes unversioned. Auth via
`Authorization: Bearer <access_token>`.

### `GET /healthz` — liveness
No auth, no DB. `200 {"status":"ok"}` whenever the process is up. Render health-check target.

### `GET /readyz` — readiness
No auth. Runs `SELECT 1`, but the probe result is **cached for 3 s** so an
unauthenticated caller cannot amplify load onto Postgres. `200 {"status":"ready"}`
or `503` problem+json (`type: .../not-ready`).

Render's platform health check targets `/healthz` (single path, §11), so `/readyz`
does not gate the platform directly. It gates deploys via the **post-deploy smoke**
(§10, §11): the pipeline fails the release if `/readyz` is not `200` after the new
image is live.

### `GET /v1/_authcheck` — token validation probe
Auth required. Validates the token (§6.1) and echoes non-sensitive claim data
(`sub`, `aud`, `exp`). **Does not provision.** Exists only for the CI smoke test
so an M2M token (no `email` claim) can prove JWKS/issuer/audience wiring without
hitting provisioning. Not for app use. The smoke also calls `GET /v1/me` with the
same M2M token and asserts `401` — proving the missing-claim rejection path on
staging.

### `GET /v1/me` — current user
Auth required. Provisions on first sight of a `sub` (§6.2). Returns:

```json
{
  "id": "018f...", "email": "a@b.com", "displayName": null,
  "unitPreference": "kg", "timezone": "UTC",
  "createdAt": "2026-08-30T12:00:00Z", "isNewUser": true
}
```

`isNewUser` is true only on the response that created the row.

### `PATCH /v1/me` — update profile
Auth required. Body (all optional): `displayName` (≤ 80), `unitPreference`
(`kg`|`lb`), `timezone`. Unknown field → `422`. Returns the updated
representation (no `isNewUser`). Present in this spec to exercise validation + the
write path + the error contract early.

`timezone` is validated against `Intl.supportedValuesOf('timeZone')` (available on
the Node 22 runtime, §11) — the Zod schema refines on membership in that set, so no
tz database dependency is added. Empty/absent leaves the stored value unchanged.

### Error responses (RFC 9457 `application/problem+json`)

| Situation | Status | slug |
|---|---|---|
| No / malformed `Authorization` | 401 | `unauthenticated` |
| Expired / bad sig / bad `iss` / bad `aud` | 401 | `invalid-token` |
| Valid token, `email` claim missing (on `/v1/me`) | 401 | `invalid-token` |
| JWKS / issuer unreachable — cannot validate the token | 503 | `auth-unavailable` |
| Valid token, user `deleted_at` set | 403 | `account-deleted` |
| Body validation failure | 422 | `validation-error` (+ `errors[]`) |
| Request body over the size limit | 413 | `payload-too-large` |
| Unknown route | 404 | `not-found` |
| Unhandled | 500 | `internal` |

Body: `{ type, title, status, detail, instance }`; `instance` = request id;
`errors: [{ path, message }]` on `422`. `type` is a full URL
(`https://strengthinnumbers.app/problems/<slug>`). No internal detail in
`detail` for 401/403/500.

### 5.5 CORS & app hardening

Applied app-wide in the Fastify bootstrap, ahead of routing.

- **CORS (`@fastify/cors`).** `origin` is an exact-match allowlist from
  `WEB_ORIGIN` (comma-separated; §8) — no wildcard, no regex. Allowed methods:
  `GET, POST, PATCH, DELETE, OPTIONS`. Allowed request headers: `Authorization`,
  `Content-Type`, `X-Request-Id`. `Access-Control-Expose-Headers: X-Request-Id`.
  `credentials: false` (tokens travel in the `Authorization` header, not cookies).
  Preflight `OPTIONS` short-circuits with `204` before auth/routing. An unlisted
  origin gets a normal response with **no** allow-origin header (the browser then
  blocks it) — the API does not 403 it.
- **Helmet (`@fastify/helmet`).** Defaults, plus HSTS enabled in `production`
  (`NODE_ENV`-gated; Render terminates TLS). No CSP here — the API serves only
  JSON; the SPA's CSP is Spec 04.
- **Body size.** Global `bodyLimit` of **64 KB** (all M0 payloads are tiny);
  over-limit → `413 payload-too-large` via the error mapper before the handler.

---

## 6. Behavior & logic

### 6.1 JWT validation (Fastify plugin; before all `/v1` routes)

1. Extract bearer token; absent/malformed → `401 unauthenticated`.
2. Resolve signing key from JWKS at `${AUTH0_ISSUER}.well-known/jwks.json`:
   in-memory cache by `kid`, TTL ~10 min; on unknown `kid` refetch once (rotation);
   still unknown after a successful refetch → `401 invalid-token`.
   **If the JWKS fetch itself fails** (DNS, TLS, timeout, 5xx from Auth0) and no
   usable cached key is available → `503 auth-unavailable`, *not* `401`: the token
   may be perfectly valid and the client should retry rather than discard it.
   `jose`'s remote-JWKS helper with a bounded timeout and a `cooldownDuration`
   covers this; the distinction is "key genuinely not in the set" (401) vs. "could
   not obtain the set" (503).
3. Verify with `jose`: RS256 signature, `iss === AUTH0_ISSUER`, `aud` includes
   `AUTH0_AUDIENCE`, `exp`/`nbf` within 60 s skew. Any failure → `401 invalid-token`.
4. Attach `request.auth = { authSub, email?, emailVerified?, claims }` — `email`
   from `${AUTH0_CLAIM_NAMESPACE}email`, `emailVerified` from
   `${AUTH0_CLAIM_NAMESPACE}email_verified` (both when present).

Failures logged with the specific reason; client gets only the generic title.

### 6.2 User provisioning (after 6.1, for `/v1/me` and other future `/v1/*` app routes; **not** `/v1/_authcheck`)

```
row = SELECT * FROM "user" WHERE auth_sub = :authSub
if row is null:
    require request.auth.email present  -- else 401 invalid-token ("missing claim")
    INSERT INTO "user" (id, auth_sub, email, email_verified)
        VALUES (:uuidv7, :authSub, :email, :emailVerified ?? false)
        ON CONFLICT (auth_sub) DO NOTHING
    row = SELECT * FROM "user" WHERE auth_sub = :authSub   -- re-read; wins the race
    isNewUser = (this request did the insert)
if row.deleted_at is not null:  -> 403 account-deleted
if row.email != token.email or row.email_verified != token.emailVerified:
    UPDATE "user" SET email = :email, email_verified = :ev, updated_at = now() WHERE id = row.id
request.user = row
```

Concurrent first requests for one `sub` → exactly one row (`ON CONFLICT DO NOTHING`
+ re-read). The email re-sync is a no-op on the common path.

**Prisma note.** `ON CONFLICT DO NOTHING` is not expressible through Prisma's typed
API. The provisioning repo fn issues the insert via `$executeRaw` and reads the
returned affected-row count: `1` → this request created the row (`isNewUser =
true`), `0` → a concurrent request won (`isNewUser = false`). This is the single
place raw SQL is used in M0; it lives behind `userRepository.provision(authSub,
claims)`, not in the handler.

### 6.3 Repository layer & ownership

- All data access via repository functions — **no inline queries in handlers**.
- User-scoped fns take `actingUserId` first.
- `assertOwned(row, actingUserId)` → `NotFoundError` (maps to `404`, not `403`, so
  existence does not leak) when `row.user_id !== actingUserId`.
- Barely exercised here (only `user` self-reads) but the pattern and helpers ship now.

### 6.4 Operational rules

- **Migrations** run as a Render pre-deploy step (`prisma migrate deploy`), never on boot.
- **Graceful shutdown:** `SIGTERM` → stop accepting, drain (bounded), close Prisma pool, exit 0.
- **Request id:** honor inbound `X-Request-Id` else generate; echo in response header + every log line.

---

## 7. Security & privacy

- **Token handling:** access tokens are never logged, never persisted. Only
  `sub` and (in debug logs) `aud`/`exp` may appear. `GET /v1/_authcheck` echoes
  only those three fields.
- **Generic auth errors:** 401/403 bodies never say *why* (expired vs bad
  signature vs unknown key) — that detail goes to server logs only.
- **JWKS strictness:** RS256 only; reject `alg: none` and HS* explicitly; pin
  `iss` and `aud`; bounded clock skew. JWKS fetched over TLS from the configured
  issuer only.
- **PII in telemetry:** `user_id` (our UUID) is fine in logs/metrics; `email` and
  `display_name` are not — they must not appear in log lines, metric labels, or
  span attributes.
- **Authorization boundary:** every `/v1` app route requires a valid token and a
  live (`deleted_at IS NULL`) user. `assertOwned` is the single place cross-user
  access is prevented; later specs must route through it (DESIGN R8).
- **Soft-deleted users:** get `403` on every app route; no data readable or
  writable during the grace window. Hard purge is Spec 11.
- **Secrets:** only the smoke test's M2M client secret is sensitive here; it lives
  in CI secrets, never in the repo or Render env groups.
- **Transport:** Render terminates TLS; the app assumes HTTPS and sets HSTS.
- **CORS:** an exact-match origin allowlist (`WEB_ORIGIN`), never a wildcard or
  reflected `Origin`; `credentials` off. See §5.5.
- **Unauthenticated surface:** only `/healthz`, `/readyz`, and CORS preflight are
  reachable without a token. `/readyz`'s DB probe is cached (3 s) so it cannot be
  used to amplify load onto Postgres. `/healthz` touches nothing.
- **App hardening:** `@fastify/helmet` default headers; a 64 KB JSON body limit so
  oversized payloads are dropped before parsing/handling.

---

## 8. Config & secrets

Loaded and Zod-validated at boot; invalid config crashes before the port binds.

| Var | Req | Example | Notes |
|---|---|---|---|
| `NODE_ENV` | yes | `production` | |
| `PORT` | yes | `3000` | Render sets it |
| `DATABASE_URL` | yes | `postgres://…?sslmode=require&connection_limit=8&pool_timeout=10` | Use Render's **internal** connection string; must carry `sslmode=require` and an explicit `connection_limit` (see below). |
| `AUTH0_ISSUER` | yes | `https://si-staging.us.auth0.com/` | trailing slash required |
| `AUTH0_AUDIENCE` | yes | `https://api.strengthinnumbers.app` | API identifier |
| `AUTH0_CLAIM_NAMESPACE` | yes | `https://strengthinnumbers.app/` | prefix for custom claims; API reads `${ns}email`, `${ns}email_verified` (Q3-A) |
| `WEB_ORIGIN` | yes | `http://localhost:5173` (local) · `https://si-web-staging.onrender.com` (staging) | Comma-separated exact origins for the CORS allowlist (§5.5). No wildcard. Prod gets the real app origin(s). |
| `LOG_LEVEL` | no | `info` | default `info` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | — | unset → tracing is a no-op |
| `SERVICE_NAME` | no | `si-api` | resource attribute |

**Postgres connection budget (Q9).** Render's managed Postgres plans cap total
connections low (tens on the smaller plans). Prisma's default pool
(`num_cpus * 2 + 1` per instance) can exhaust that under the smoke or first real
load, surfacing as intermittent `P2024` pool-timeout errors. Pin
`connection_limit` in `DATABASE_URL` explicitly: **`connection_limit=8`** for a
single web instance in v1 (leaves headroom for `prisma migrate deploy`, a psql
session, and the readiness probe). Revisit if the API scales past one instance.
Render also requires TLS — `sslmode=require` (or the internal URL, which implies
it).

| Value | local | staging | production | Set where |
|---|---|---|---|---|
| `DATABASE_URL` | compose Postgres | Render PG (staging) | Render PG (prod) | compose / Render |
| `AUTH0_*`, `AUTH0_CLAIM_NAMESPACE` | `si-staging` tenant | `si-staging` tenant | `si-prod` tenant | Render env group / `.env` |
| `WEB_ORIGIN` | `http://localhost:5173` | staging SPA origin | prod SPA origin(s) | Render env group / `.env` |
| M2M client id/secret (smoke only) | — | CI secret | CI secret | GitHub Actions secrets |

`.env.example` documents every var with placeholders. No secrets in the repo.

---

## 9. Observability

- **Logs (pino JSON):** one request-summary line —
  `method, path, status, duration_ms, request_id, user_id?, auth_result`. Boot log
  lists resolved non-secret config. JWKS cache refreshes logged (`kid`, age).
- **Metrics** (log-based counters acceptable until Spec 13):
  `http_requests_total{route,status}`, `http_request_duration_ms{route}`,
  `auth_failures_total{reason}` (`reason` ∈ `missing_token`, `invalid_token`,
  `missing_email_claim`, `jwks_unavailable`, `account_deleted`),
  `user_provisioned_total`, `db_pool_in_use`. `jwks_unavailable` spiking is an
  Auth0-reachability alert, not a client problem.
- **Traces (OTel):** HTTP-server + `pg` auto-instrumentation; spans exported only
  if `OTEL_EXPORTER_OTLP_ENDPOINT` is set (no-op otherwise). One span around the
  provisioning transaction.

---

## 10. Testing

### Method — test-driven

Implement each acceptance criterion test-first: write the test from §2 (it fails
against the empty implementation), then the minimum code to make it pass, then
refactor. The inventories below are that test list; each item is tagged with the
criterion it discharges. Order of attack: config loader → error mapper →
JWT verifier → app hardening (CORS/helmet/body limit) → provisioning repo →
routes. `packages/core` is a stub in this spec, so its own TDD starts in Spec 02.

Runner: **Vitest**. Integration tests use **Testcontainers** Postgres against the
real Prisma migrations. HTTP-level tests use `fastify.inject` (no live port).
Criteria 11, 12, 14 are not unit-testable — they are verified by the CI job,
`prisma migrate` dry-run, and the post-deploy smoke respectively.

### Unit
- Config: any required var missing/invalid → process refuses to start, message names the var, no port bound. Includes `WEB_ORIGIN` unset/blank. *(Criterion 2)*
- `timezone` Zod refinement accepts `America/Chicago`, rejects `Mars/Phobos` and `US/Foo`. *(Criterion 10)*
- JWT verifier: tokens minted locally with `jose` + a test keypair — valid;
  expired; future `nbf`; wrong `aud`; wrong `iss`; bad signature; unknown `kid`;
  `alg: none`. Each → expected status/slug. Also: `email` claim present without
  `email_verified` → provisions with `email_verified = false`. *(Criterion 6)*
- JWKS unavailable: mock JWKS endpoint returns a network error / 503 with a cold
  cache → verifier yields `503 auth-unavailable`, never `401`. Unknown `kid` with
  a *reachable* JWKS → `401 invalid-token`. *(Criterion 16)*
- Error mapper: each `AppError` subtype → correct problem+json body, correct
  status, no internal `detail` on 401/403/500 (incl. `auth-unavailable` → 503,
  `payload-too-large` → 413). *(Criteria 6, 17 companion)*
- `assertOwned` → throws `NotFoundError` on owner mismatch, passes on match. *(repo seam, DESIGN R8)*
- Routes via `fastify.inject`: `GET /healthz` → `200 {"status":"ok"}` with no DB wired *(Criterion 3)*; `GET /v1/me` with no/malformed `Authorization` → `401 unauthenticated` *(Criterion 5)*.
- App hardening via `fastify.inject`: preflight `OPTIONS` from a listed origin →
  `204` + `Access-Control-Allow-Origin` echoing it + `Access-Control-Expose-Headers: X-Request-Id`; from an unlisted origin → no allow-origin header. Every
  response carries helmet headers; a > 64 KB body → `413`. *(Criteria 15, 17)*

### Integration (Testcontainers Postgres, real migrations)
- First `GET /v1/me` for a new `sub` → exactly one `user` row; `isNewUser: true`, then `false` on the second call. *(Criterion 7)*
- Two concurrent first requests for one new `sub` → one row, no `500`. *(Criterion 8)*
- Provisioning repo exercises the raw `ON CONFLICT DO NOTHING` path directly: affected-row count `1` on the creating call (`isNewUser: true`), `0` on a replay (`isNewUser: false`). *(Criterion 7/8 unit-level companion)*
- `deleted_at` set → every `/v1/*` app route returns `403 account-deleted`. *(Criterion 9)*
- `PATCH /v1/me`: happy update advances `updated_at`; bad `unitPreference` /
  unknown field → `422` + populated `errors[]`. *(Criterion 10)*
- `/readyz` → `503` problem+json with DB stopped, `200` with DB up; a burst of calls with the
  DB up issues at most one `SELECT 1` per 3 s window (probe cache). *(Criterion 4)*
- `SIGTERM` → server stops accepting, drains an in-flight request, closes the Prisma pool, exits 0. *(Criterion 13)*

### Post-deploy smoke (CI, against staging)
- Script does an Auth0 client-credentials grant against the `si-staging` M2M app,
  then: (a) `GET /healthz` → `200`; (b) `GET /readyz` → `200` (fails the release
  otherwise — this is how `/readyz` gates deploys, §5); (c) `GET /v1/_authcheck` →
  `200`, `aud` matches; (d) `GET /v1/me` with the same token → `401`
  (`invalid-token`, missing `email` claim). Non-conforming result fails the
  pipeline. *(Criteria 12, and `/readyz` gate)*

### Done
Every criterion in §2 is discharged by a test above or by the pipeline (per
Criterion 18); `pnpm -w test` is green and CI blocks merge on red (Criterion 19);
auth-plugin + user-repo coverage ≥ 90%; `packages/core` purity check passes;
`prisma migrate` dry-run passes; `render.yaml` deploys staging cleanly.

---

## 11. Deployment & rollback

### Build
- **Multi-stage `Dockerfile`** (Q4-A): stage 1 installs all deps + builds
  (`pnpm build`); stage 2 is a slim runtime (`node:22-slim` or distroless) with
  prod deps + `dist/` only. Non-root user. Same image runs in local
  `docker-compose` and on Render, and is the artifact Spec 15 deploys to ECS.

### `render.yaml`
- `services:` one `web` service `si-api`, `runtime: image` built from the
  `Dockerfile`; health-check path `/healthz`; pre-deploy
  `pnpm prisma migrate deploy`.
- `databases:` `si-postgres` (managed, per environment). The service's
  `DATABASE_URL` is the Render **internal** URL with `?sslmode=require&connection_limit=8`
  appended (§8, Q9), not the raw `fromDatabase` value.
- `envVarGroups:` `api-shared` (non-secret — incl. `WEB_ORIGIN`, `AUTH0_*`,
  `AUTH0_CLAIM_NAMESPACE`); secrets set in the Render dashboard.
- Staging auto-deploys from `main`; production deploys on a git tag / manual
  promote of the same image.

### Migration ordering
- `0001_create_user` is additive → any prior image stays compatible → safe rollback.
- Standing rule for later specs: never ship a column drop/rename in the same
  release as the code change that stops using it.

### Rollback
- App: Render "roll back to previous deploy".
- DB: none needed for `0001`. Future undo is a forward fix (`0002` reverts), not a
  production `migrate down`.

### First-deploy checklist
1. Auth0: create `si-staging` + `si-prod` tenants. In **each**: an API (set the
   audience); an M2M app authorized for that API; a post-login Action setting
   `${namespace}email` + `${namespace}email_verified`, deployed and bound to the
   Login flow. Record issuer, audience, M2M client id/secret.
2. Render: create staging + prod envs; provision `si-postgres`; set `api-shared`
   env group + secrets (`DATABASE_URL` auto, `AUTH0_*`, `AUTH0_CLAIM_NAMESPACE`).
3. Push `main` → staging builds the image, pre-deploy runs `0001`, `/healthz` green.
4. CI smoke: `/healthz` + `/readyz` → `200`; `/v1/_authcheck` → `200`; `/v1/me` →
   `401` with the M2M token.
5. Tag → promote the image to production; repeat the smoke.

---

## 12. Decisions & open questions

### Resolved (2026-08-30)

- **Q1 — Auth0 tenant count.** ✅ **Two tenants: `si-staging` + `si-prod`; local
  dev points at `si-staging`.** Fewest to keep in sync for a solo dev; the staging
  user pool is disposable. Splitting local out later is trivial.
- **Q2 — Smoke-test token.** ✅ **`GET /v1/_authcheck` (no provisioning) + an M2M
  client-credentials token.** Standard pattern for CI smoke against an
  Auth0-protected API. The smoke also asserts `GET /v1/me` → `401` with that
  token. Full provisioning stays covered by integration tests. Rejected: seeding a
  real user via the Password grant (Auth0 discourages it; a security smell).
- **Q3 — `email` claim.** ✅ **Auth0 post-login Action sets namespaced `email` +
  `email_verified` on the access token.** Keeps provisioning a pure, offline-
  testable DB operation with no network dependency on the first-login path.
  Rejected: `/userinfo` call at provisioning (adds a failure mode + latency to the
  first authenticated request). Action is per-tenant config now; version-
  controlled via Auth0 Deploy CLI / Terraform in Spec 15.
- **Q4 — Build.** ✅ **Multi-stage `Dockerfile`.** The identical image runs
  locally, on Render, and on ECS Fargate in Spec 15 — portability is the point of
  the phase-2 story. Docker learning is on the DevOps track.
- **Q5 — UUIDv7.** ✅ **App-side `uuidv7` npm package**, value set in the
  repository layer. Render's managed Postgres has no v7 extension and Prisma has
  no native v7 default.
- **Q6 — `PATCH /v1/me` scope.** ✅ **Keep it.** Only endpoint in this spec
  exercising body validation + a write + `422`/`errors[]`; de-risks the error
  contract early; profile editing is needed by Spec 04 regardless.

### Resolved (2026-08-31, pre-implementation review pass)

- **Q7 — CORS ownership.** ✅ **Configured in this spec, not Spec 04.** The policy
  lives in the Fastify bootstrap regardless of which spec adds the browser client;
  making Spec 04 reach back into the API to enable itself is worse. Exact-match
  `WEB_ORIGIN` allowlist, `credentials: false`, `X-Request-Id` exposed. See §5.5,
  §7, §8.
- **Q8 — IdP-unreachable status.** ✅ **`503 auth-unavailable`, distinct from
  `401 invalid-token`.** A valid token must not be discarded because our JWKS
  fetch failed; `503` tells the client to retry. `jose` remote-JWKS with a bounded
  timeout + cooldown implements the split. See §6.1, Criterion 16.
- **Q9 — Prisma pool vs. Render Postgres cap.** ✅ **Pin `connection_limit=8` in
  `DATABASE_URL` for a single instance; require `sslmode=require`.** Render's
  smaller PG plans cap connections in the tens; Prisma's default pool can exhaust
  that and throw `P2024` under load. Revisit when the API runs more than one
  instance. See §8, §11.
- **Q10 — `/readyz` deploy gating.** ✅ **Enforced by the CI post-deploy smoke,
  not the Render platform check** (Render targets the single path `/healthz`). The
  DB probe result is cached 3 s so the unauthenticated endpoint can't amplify load
  onto Postgres. See §5, §7, §10.

### Open

*(none)*
