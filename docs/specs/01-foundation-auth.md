# Spec 01 — Foundation & Auth

**Status:** Draft v0.2
**Last updated:** 2026-08-30
**Design refs:** DESIGN.md §3 (architecture), §4.1 (`user`), §5.1 (auth), §6 (API), §7 (infra), §9 (M0)

---

## 1. Purpose, scope & non-goals

Stand up the deployable API service and prove, on Render staging, that it
validates real Auth0 access tokens and provisions a `user` row on first
authenticated request. This is the M0 backend skeleton; every later API spec
builds inside it.

### In scope

- Monorepo layout (pnpm workspaces): `apps/api`, `packages/core` (stub), reserved `apps/web`.
- Fastify app: bootstrap, plugin structure, graceful shutdown, request-id propagation.
- Typed config: env → Zod-validated object, fail-fast at boot.
- PostgreSQL via Prisma: connection, pool, migration harness.
- First migration: `user` table (DESIGN §4.1).
- Auth: JWKS-based RS256 JWT verification (issuer + audience + expiry), `sub` → `user` provisioning, soft-delete handling.
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
- The SPA and the **browser** Auth0 login / PKCE flow, refresh-token handling in a browser. (Spec 04.)
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
12. Pushing to `main` deploys the API to Render staging; the CI post-deploy smoke obtains a real Auth0 token and gets a success response from staging.
13. `SIGTERM` causes a graceful shutdown: in-flight requests drain, the DB pool closes, the process exits 0.

---

## 3. Dependencies & exposed interface

### Needs

| Kind | Item | Notes |
|---|---|---|
| External | **Auth0 tenant(s)** | Per environment where the plan allows (Q1). Each needs: an **API** (audience = our API identifier); an **M2M application** authorized for it (smoke test only); an **Action** adding an `email` claim to the access token (Q3). |
| External | **Render account** | `staging` (auto-deploy `main`) + `production` (promote). Managed Postgres per env. |
| Internal | none | Root spec. |

### Provides (stable surface later specs build on)

- **`user` table** + Prisma `User` model.
- **Auth plugin** — populates `request.auth` (`{ authSub, email, claims }`) and, for `/v1/*`, `request.user` (the `User` row). Rejects unauthenticated/invalid/deleted before the handler runs.
- **Repository conventions** — `apps/api/src/repositories/*`; every user-scoped fn takes `actingUserId` first; `assertOwned(row, actingUserId)` throws `NotFoundError`.
- **Error contract** — `problemResponse(reply, error)` mapper + the `AppError` hierarchy (`UnauthenticatedError`, `InvalidTokenError`, `NotFoundError`, `ValidationError`, …).
- **Typed config loader** — `config` object, validated; the pattern later specs extend with their own vars.
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
- `email` comes from a custom token claim (Q3). If absent, the request is rejected
  (§6) rather than storing null.
- `updated_at` set by the application on write (no DB trigger in v1).
- UUIDv7 generated in application code (Q5).

**Migration `0001_create_user`** (Prisma Migrate): additive, expand-only; down
migration drops the table. No backfill (new table).

---

## 5. API surface

All domain routes under `/v1`. Health routes unversioned. Auth via
`Authorization: Bearer <access_token>`.

### `GET /healthz` — liveness
No auth, no DB. `200 {"status":"ok"}` whenever the process is up. Render health-check target.

### `GET /readyz` — readiness
No auth. Runs `SELECT 1`. `200 {"status":"ready"}` or `503` problem+json
(`type: .../not-ready`). Gates deploys.

### `GET /v1/_authcheck` — token validation probe
Auth required. Validates the token (§6.1) and echoes non-sensitive claim data
(`sub`, `aud`, `exp`). **Does not provision.** Exists only for the CI smoke test
so an M2M token (no `email` claim) can still prove JWKS/issuer/audience wiring
without hitting provisioning. Not for app use.

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
(`kg`|`lb`), `timezone` (valid IANA). Unknown field → `422`. Returns the updated
representation (no `isNewUser`). Present in this spec to exercise validation + the
write path + the error contract early.

### Error responses (RFC 9457 `application/problem+json`)

| Situation | Status | slug |
|---|---|---|
| No / malformed `Authorization` | 401 | `unauthenticated` |
| Expired / bad sig / bad `iss` / bad `aud` | 401 | `invalid-token` |
| Valid token, `email` claim missing (on `/v1/me`) | 401 | `invalid-token` |
| Valid token, user `deleted_at` set | 403 | `account-deleted` |
| Body validation failure | 422 | `validation-error` (+ `errors[]`) |
| Unknown route | 404 | `not-found` |
| Unhandled | 500 | `internal` |

Body: `{ type, title, status, detail, instance }`; `instance` = request id;
`errors: [{ path, message }]` on `422`. `type` is a full URL
(`https://strengthinnumbers.app/problems/<slug>`). No internal detail in
`detail` for 401/403/500.

---

## 6. Behavior & logic

### 6.1 JWT validation (Fastify plugin; before all `/v1` routes)

1. Extract bearer token; absent/malformed → `401 unauthenticated`.
2. Resolve signing key from JWKS at `${AUTH0_ISSUER}.well-known/jwks.json`:
   in-memory cache by `kid`, TTL ~10 min; on unknown `kid` refetch once (rotation);
   still unknown → `401 invalid-token`.
3. Verify with `jose`: RS256 signature, `iss === AUTH0_ISSUER`, `aud` includes
   `AUTH0_AUDIENCE`, `exp`/`nbf` within 60 s skew. Any failure → `401 invalid-token`.
4. Attach `request.auth = { authSub, email?, claims }` (`email` read from the
   `EMAIL_CLAIM` key when present).

Failures logged with the specific reason; client gets only the generic title.

### 6.2 User provisioning (after 6.1, for `/v1/me` and other future `/v1/*` app routes; **not** `/v1/_authcheck`)

```
row = SELECT * FROM "user" WHERE auth_sub = :authSub
if row is null:
    require request.auth.email present  -- else 401 invalid-token ("missing claim")
    INSERT INTO "user" (id, auth_sub, email)
        VALUES (:uuidv7, :authSub, :email)
        ON CONFLICT (auth_sub) DO NOTHING
    row = SELECT * FROM "user" WHERE auth_sub = :authSub   -- re-read; wins the race
    isNewUser = (this request did the insert)
if row.deleted_at is not null:  -> 403 account-deleted
request.user = row
```

Concurrent first requests for one `sub` → exactly one row (`ON CONFLICT DO NOTHING`
+ re-read).

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

---

## 8. Config & secrets

Loaded and Zod-validated at boot; invalid config crashes before the port binds.

| Var | Req | Example | Notes |
|---|---|---|---|
| `NODE_ENV` | yes | `production` | |
| `PORT` | yes | `3000` | Render sets it |
| `DATABASE_URL` | yes | `postgres://…` | Render-provided |
| `AUTH0_ISSUER` | yes | `https://si-staging.us.auth0.com/` | trailing slash required |
| `AUTH0_AUDIENCE` | yes | `https://api.strengthinnumbers.app` | API identifier |
| `EMAIL_CLAIM` | yes | `https://strengthinnumbers.app/email` | namespaced claim key (Q3) |
| `LOG_LEVEL` | no | `info` | default `info` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | — | unset → tracing is a no-op |
| `SERVICE_NAME` | no | `si-api` | resource attribute |

| Value | local | staging | production | Set where |
|---|---|---|---|---|
| `DATABASE_URL` | compose Postgres | Render PG (staging) | Render PG (prod) | compose / Render |
| `AUTH0_*`, `EMAIL_CLAIM` | staging tenant (Q1) | staging tenant | prod tenant | Render env group |
| M2M client id/secret (smoke only) | — | CI secret | CI secret | GitHub Actions secrets |

`.env.example` documents every var with placeholders. No secrets in the repo.

---

## 9. Observability

- **Logs (pino JSON):** one request-summary line —
  `method, path, status, duration_ms, request_id, user_id?, auth_result`. Boot log
  lists resolved non-secret config. JWKS cache refreshes logged (`kid`, age).
- **Metrics** (log-based counters acceptable until Spec 13):
  `http_requests_total{route,status}`, `http_request_duration_ms{route}`,
  `auth_failures_total{reason}`, `user_provisioned_total`, `db_pool_in_use`.
- **Traces (OTel):** HTTP-server + `pg` auto-instrumentation; spans exported only
  if `OTEL_EXPORTER_OTLP_ENDPOINT` is set (no-op otherwise). One span around the
  provisioning transaction.

---

## 10. Testing

### Unit
- Config: missing/invalid var → refuses to start.
- JWT verifier: tokens minted locally with `jose` + a test keypair — valid;
  expired; future `nbf`; wrong `aud`; wrong `iss`; bad signature; unknown `kid`;
  `alg: none`. Each → expected status/slug.
- Error mapper: each `AppError` subtype → correct problem+json body.
- `assertOwned` → throws on mismatch, passes on match.

### Integration (testcontainers Postgres, real migrations)
- First `GET /v1/me` for a new `sub` → exactly one `user`; `isNewUser` true then false.
- Two concurrent first requests → one row, no 500. *(Criterion 8)*
- `deleted_at` set → `403 account-deleted`. *(Criterion 9)*
- `PATCH /v1/me`: happy update advances `updated_at`; bad `unitPreference` /
  unknown field → `422` + `errors[]`. *(Criterion 10)*
- `/readyz` → `503` with DB stopped, `200` with DB up. *(Criterion 4)*

### Post-deploy smoke (CI, against staging)
- Script does an Auth0 client-credentials grant (M2M app) and calls
  `https://<staging>/v1/_authcheck` → expect `200` with matching `aud`. Fails the
  pipeline on non-200. *(Criterion 12)*

### Done
All acceptance criteria (§2) verified by the above; `packages/core` purity check
passes; `prisma migrate` dry-run passes; `render.yaml` deploys staging cleanly.

---

## 11. Deployment & rollback

### `render.yaml`
- `services:` one `web` service `si-api` — build, start `node dist/main.js`,
  health-check path `/healthz`, pre-deploy `pnpm prisma migrate deploy`.
- `databases:` `si-postgres` (managed, per environment).
- `envVarGroups:` `api-shared` (non-secret); secrets set in the Render dashboard.
- Staging auto-deploys from `main`; production deploys on a git tag / manual
  promote of the same build.

### Migration ordering
- `0001_create_user` is additive → any prior image stays compatible → safe rollback.
- Standing rule for later specs: never ship a column drop/rename in the same
  release as the code change that stops using it.

### Rollback
- App: Render "roll back to previous deploy".
- DB: none needed for `0001`. Future undo is a forward fix (`0002` reverts), not a
  production `migrate down`.

### First-deploy checklist
1. Auth0: create staging + prod tenants; in each, an API (audience), an M2M app, the `email` Action.
2. Render: create staging + prod envs; provision Postgres; set env groups + secrets.
3. Push `main` → staging builds, pre-deploy runs `0001`, `/healthz` green.
4. CI smoke hits staging `/v1/_authcheck` → `200`.
5. Tag → promote to production; repeat smoke.

---

## 12. Decisions & open questions

*(None resolved yet — this spec is Draft v0.2.)*

- **Q1 — Auth0 tenant count.** Free-plan tenant limit? Options: 3 tenants
  (local/staging/prod); 1 non-prod tenant with separate APIs; local points at the
  staging tenant. Leaning: **staging + prod tenants; local uses staging.**
- **Q2 — Smoke-test token.** Resolved in-spec by adding `GET /v1/_authcheck` (no
  provisioning) so an M2M client-credentials token is enough. Confirm this is
  acceptable vs. seeding a real test user (Password grant, discouraged by Auth0).
- **Q3 — `email` claim.** Confirm an Auth0 Action adds `email` to the **access
  token** under `EMAIL_CLAIM`. Default Auth0 access tokens omit it. Alternative:
  call `/userinfo` on first provisioning (extra hop, needs `openid profile email`).
- **Q4 — Build.** Docker image vs Render native Node build. Leaning: **Docker**,
  reused by the Spec 15 AWS/ECS migration.
- **Q5 — UUIDv7.** App-side lib (`uuidv7`) vs a Postgres extension (uncertain on
  Render). Leaning: **app-side.**
- **Q6 — `PATCH /v1/me` scope.** Keep it here (only thing exercising validation +
  writes + `422`) or defer. Leaning: **keep.**
