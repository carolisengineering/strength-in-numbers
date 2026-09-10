# First deploy — API to Render staging (Spec 01 §11)

One-time setup to get `apps/api` running on Render staging with a real Auth0
tenant, and to make the CI post-deploy smoke pass. After this, deploys are just
pushes to `main`.

Do everything in **one Auth0 tenant** (Parts A–D), prove the pipeline end to end.
Production is deferred to **Part E** and needs its own tenant — decide the Auth0
plan then, not now.

**Prerequisites:** an Auth0 account, a Render account, admin on the GitHub repo.
`main` merged (PR #1).

### Tenant naming & plan (read once)

- **Use the tenant Auth0 auto-created at signup** (name like
  `dev-xxxxxxxxxxxx`). You **cannot rename** it, and its name forms the issuer
  URL. That is fine — local dev and staging are meant to share one tenant
  (Spec 01 §12 Q1).
- Set **Settings → General → Friendly Name** to `SiN staging` — a dashboard label
  only; it does not change the tenant domain.
- The tenant's environment tag will be **Development** — leave it.
- **Do not upgrade to a paid plan.** A separate Production tenant is a Part E
  concern; on the free plan that is a second free tenant (create it then) or a
  plan upgrade — evaluate when you get there.
- Below, **`<tenant>.us.auth0.com`** means your real tenant domain, shown in the
  dashboard's top-left tenant switcher — e.g. `dev-gncuqvfir0wv0t4l.us.auth0.com`.

---

## Part A — Auth0 (your one tenant)

In the tenant from signup (Friendly Name `SiN staging`, US region), create three
things: an **API** (A1), a **Machine-to-Machine app** (A2), and a **post-login
Action** (A3).

### A1. API (the token audience)

Left nav → **Applications → APIs** → **Create API**. Fill the three fields, leave
everything else default:

| Field | Value |
|---|---|
| Name | `strength-in-numbers API` |
| Identifier | `https://api.strengthinnumbers.app` |
| JSON Web Token (JWT) Signing Algorithm | **RS256** |

- **Identifier** becomes `AUTH0_AUDIENCE`. It is a logical id, **not** a URL that
  has to resolve — type it exactly, don't let the browser "fix" it. Keep it
  identical across tenants forever.
- After creating, you land on the API's page. You do **not** need to touch its
  Settings, Permissions, or Machine to Machine Applications tabs here — A2 grants
  access from the app side.
- **Issuer** is `https://<tenant>.us.auth0.com/` — your exact tenant domain,
  **with `https://` and the trailing slash**. For the auto-created tenant that is
  e.g. `https://dev-gncuqvfir0wv0t4l.us.auth0.com/`. This is `AUTH0_ISSUER`; the
  config loader rejects it without the slash, and in production without `https`.
- Leave **Token Expiration** at the default (86400 s).

**Record now** (you'll paste these into Render in Part B and GitHub in Part C):

| Note it as | Value |
|---|---|
| `AUTH0_AUDIENCE` | `https://api.strengthinnumbers.app` |
| `AUTH0_ISSUER` | `https://<tenant>.us.auth0.com/` |

### A2. Machine-to-Machine application (CI smoke only)

This is the identity the CI smoke test uses to get a real token. It is **not**
how end users log in (that's Spec 04).

**Auth0 already made one for you.** Creating an API (A1) auto-creates a
**`strength-in-numbers API (Test Application)`** M2M app, already authorized for
that API. Use it — no need to create a second one:

1. Left nav → **Applications → Applications** → open
   **`strength-in-numbers API (Test Application)`**.
2. **Settings** tab → **Advanced Settings → Grant Types**: confirm **Client
   Credentials** is checked (default for M2M apps — it is).
3. Copy two values from Settings:
   - **Client ID**
   - **Client Secret** (click to reveal)

(If you'd rather have a dedicated, distinctly-named app for hygiene later —
**Create Application** → *Machine to Machine* → authorize for the API with no
scopes checked — that works identically. Not necessary now.)

A `client_credentials` grant with this app returns an access token with the
right `aud`/`iss` but **no `email` claim** (the A3 Action only runs on
interactive logins) — exactly what the smoke needs: `/v1/_authcheck` accepts it
(200), `/v1/me` rejects it (401).

**Record now** (these go into **GitHub**, not Render — Part C):

| Note it as | Value |
|---|---|
| `AUTH0_STAGING_M2M_CLIENT_ID` | the Client ID |
| `AUTH0_STAGING_M2M_CLIENT_SECRET` | the Client Secret |

### A3. Post-login Action (namespaced email claims)

This puts the user's email on the access token so the API can store it. Not
exercised by the smoke, but required before Spec 04, and cheap to do now.

1. Left nav → **Actions → Library** → **Create Action** → **Build from scratch**.
2. Name: `add-email-claims`. Trigger: **Login / Post Login**. Runtime: leave the
   default Node version. **Create**.
3. Replace the editor contents with exactly this:

   ```js
   exports.onExecutePostLogin = async (event, api) => {
     const ns = "https://strengthinnumbers.app/"; // == AUTH0_CLAIM_NAMESPACE
     api.accessToken.setCustomClaim(ns + "email", event.user.email);
     api.accessToken.setCustomClaim(
       ns + "email_verified",
       event.user.email_verified === true,
     );
   };
   ```

4. Click **Deploy** (top right).
5. Left nav → **Actions → Triggers** (older UI: **Flows**) → **post-login**
   (**Login**). Drag **add-email-claims** from the right-hand list into the flow
   between Start and Complete. Click **Apply**.

- Claims go on the **access token** (`api.accessToken`), not the ID token — the
  API never sees ID tokens.
- It runs only on interactive logins, so M2M tokens (A2) legitimately have no
  `email` — that's what the `/v1/me` → 401 smoke check proves.
- The namespace **must** equal `AUTH0_CLAIM_NAMESPACE` below, trailing slash and
  all, and must be a domain Auth0 doesn't own (not `*.auth0.com`).

**Record now:** `AUTH0_CLAIM_NAMESPACE` = `https://strengthinnumbers.app/`

### A4. Connections (optional now, needed for Spec 04)

**Skip for this deploy** — the smoke uses no interactive login. Before Spec 04,
come back to **Authentication → Database** (a `Username-Password-Authentication`
connection exists by default) and **Authentication → Social** for Google/Apple.

---

## Part B — Render (staging) + Neon Postgres

> **Cost: ~$0/mo.** Render's **free** web plan + **Neon**'s free Postgres. The
> trade: the web service spins down after ~15 min idle (~30–60 s cold start on
> the next request — the CI smoke polls `/healthz`, so it copes), and migrations
> are run **by hand** (B4) because free Render has no pre-deploy step. Upgrade
> path is in [`render.yaml`](../../render.yaml)'s header comment.

### B1. Neon Postgres (do this first — Render needs its URL)

1. Sign up at [neon.tech](https://neon.tech) (GitHub SSO is fine).
2. **Create project:** name `strength-in-numbers`, Postgres **16**, region
   **AWS us-west-2 (Oregon)** to sit near Render's Oregon. Default database name
   (`neondb`) is fine.
3. On the project dashboard → **Connection Details**. Copy the connection string.
   Use the **direct** connection (the one **without** `-pooler` in the host) —
   `prisma migrate deploy` needs a direct connection. It looks like:

   ```
   postgresql://<user>:<pass>@ep-xxxx.us-west-2.aws.neon.tech/neondb?sslmode=require
   ```

   Keep `?sslmode=require` on it — Neon requires TLS.

**Record:** `DATABASE_URL` = that full string (it's a secret — GitHub/Render
only, never commit it).

### B2. Create the Render service from the blueprint

Do **not** click "New Web Service" and fill the form by hand — that's the wall of
settings you don't want. The blueprint reads [`render.yaml`](../../render.yaml)
and sets almost everything.

1. Render dashboard → **New +** (top right) → **Blueprint**. (Or left nav
   **Blueprints → New Blueprint Instance**.)
2. **Connect GitHub** → authorize Render → pick
   **`carolisengineering/strength-in-numbers`**.
3. Branch: **`main`**. Render finds `render.yaml` at the repo root and previews:
   - web service **`si-api`** — runtime **image** (from `./Dockerfile`), **Free**
     plan, health check `/healthz`, auto-deploy on push.
   - env var group **`api-shared`** — 5 keys, values already set (incl. your
     `AUTH0_ISSUER`; committed in `render.yaml`).
   - **No database** — you're using Neon.
4. It will prompt for the one **`sync: false`** var: **`DATABASE_URL`**. Paste
   the Neon string from B1.
5. **Blueprint Name:** `strength-in-numbers`. **Apply** / **Create Resources**.
6. Render starts the **first build**. It'll go live on `/healthz` (that endpoint
   has no DB dependency) even before migrations exist — that's fine, B4 handles
   the schema.

### B3. Check `api-shared` values

Left nav → **Env Groups → `api-shared`**. These came from `render.yaml`; just
confirm:

| Key | Expected |
|---|---|
| `AUTH0_ISSUER` | `https://dev-gncuqvfir0wv0t4l.us.auth0.com/` — your tenant, trailing slash |
| `AUTH0_AUDIENCE` | `https://api.strengthinnumbers.app` |
| `AUTH0_CLAIM_NAMESPACE` | `https://strengthinnumbers.app/` |
| `WEB_ORIGIN` | `https://si-web-staging.onrender.com` — placeholder https origin until Spec 04. Must be non-empty, `https://`, host only (no path / trailing slash / `*`) or the service won't boot. |
| `LOG_LEVEL` | `info` |

`NODE_ENV=production` is on the service; `DATABASE_URL` is the service secret from
B2; `PORT` is injected by Render. Don't touch those.

### B4. Run the migration against Neon (by hand) — **required, easy to miss**

Free Render has no pre-deploy step, so apply `0001_create_user` yourself. **The
service deploys fine, `/healthz` and `/readyz` go green, and `/v1/_authcheck`
passes — all without the `user` table.** The first thing that needs it is
`/v1/me`, so a skipped migration shows up only as a **`500` on `/v1/me`** (and
the CI `smoke` failing at that exact step).

Use the **same connection string that is set as `DATABASE_URL` on the Render
service** — copy it from Render (service → **Environment**), don't hand-assemble
it. Neon has *branches*; migrating `neondb` on one branch while Render points at
another is the classic trap. Then, from the repo root:

```bash
DATABASE_URL='<paste the exact value from Render, the direct -pooler-free host>' \
  pnpm --filter @sin/api exec prisma migrate deploy
```

Expect `1 migration found … Applying migration 0001_create_user … done`. Re-run
anytime; it's idempotent. **Repeat this one command whenever a later spec adds a
migration**, before that deploy serves traffic. (This still honors Spec 01 §6.4 —
migrations never run on app boot.)

**Verify it landed** — any one of these:

- **CLI, no console needed** (same `DATABASE_URL` as above):

  ```bash
  DATABASE_URL='<same value>' pnpm --filter @sin/api exec prisma migrate status
  ```

  Expect `Database schema is up to date!` and `0001_create_user` listed as
  applied. A `Following migration have not yet been applied` message means it
  didn't take (wrong branch/DB — see the trap above).

- **Neon console → SQL Editor** (this is the source of truth Prisma itself uses):

  ```sql
  select migration_name, finished_at, rolled_back_at
  from _prisma_migrations order by finished_at;
  ```

  One row: `0001_create_user`, `finished_at` set, `rolled_back_at` null.

  ```sql
  select * from "user";   -- 0 rows, and crucially NOT "relation does not exist"
  ```

- **Neon console → Tables** (left nav): `user` and `_prisma_migrations` appear in
  the `public` schema, and `user` has the `unit_preference` / `timezone` columns.

Confirm you're inspecting the **same Neon branch** whose connection string is on
the Render service — the branch selector is at the top of the Neon console.

### B5. Seed the exercise catalog (by hand, after B4) — Spec 03.1

Same reason as B4: no pre-deploy hook on the free plan, so the catalog seed is a
**manual release step** (Spec 03.1 §8 / §11, D12). It is idempotent — re-run it
on every deploy that touches `apps/api/prisma/catalog/*.json` (or just always;
an unchanged catalog reports everything `unchanged`). Same `DATABASE_URL` rule
as B4: the exact value from Render, the **direct** (non-`-pooler`) host.

```bash
DATABASE_URL='<same value as B4>' pnpm --filter @sin/api run seed:catalog
```

Expect two JSON log lines: `catalog files validated` (counts of muscle groups /
equipment / exercises) and `catalog seed complete` with a summary like
`{"inserted":10,"updated":0,"retired":0,"unchanged":0,"skipped":0,…}`. A
second run shows `"unchanged":10`.

**If it exits 1** nothing was written: validation runs before the transaction,
and the transaction rolls back. The message names the offending `catalog_key`.
The two rules the seed enforces (Spec 03.1 §6.3): a live row's `name` /
`modality` never changes in place (retire the old key, add a new one), and
nothing is ever deleted (`retired: true` in the file; never drop the entry).

**Verify it landed:** with the service up, `GET /v1/exercises` (any valid
bearer) returns the 10 fixture rows, or in the Neon SQL editor
`select catalog_key, is_active from exercise order by 1;`.

A `skipped` count > 0 or a `warn` line means a DB row has no file entry — that
is allowed (append-only), but check it was intentional.

---

## Part C — GitHub Actions secrets & vars

Repo → **Settings** (top nav of the repo, not your profile) → **Secrets and
variables → Actions**. Two tabs: **Secrets** and **Variables**. Add each row
below to the tab named in its Type column with **New repository secret** /
**New repository variable**:

| Name | Type | Value |
|---|---|---|
| `STAGING_BASE_URL` | **Variable** | your `si-api` URL from Render (Part B), e.g. `https://si-api.onrender.com` — **no trailing slash** |
| `AUTH0_STAGING_TOKEN_URL` | **Variable** | `https://<tenant>.us.auth0.com/oauth/token` — your tenant |
| `AUTH0_STAGING_M2M_CLIENT_ID` | **Secret** | Client ID from A2 |
| `AUTH0_STAGING_M2M_CLIENT_SECRET` | **Secret** | Client Secret from A2 |

The `smoke` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
maps these onto the env vars `scripts/smoke.ts` expects (`SMOKE_BASE_URL`,
`AUTH0_TOKEN_URL`, …). `AUTH0_M2M_AUDIENCE` is already a literal in the workflow
(`https://api.strengthinnumbers.app`) — don't add it.

> The `si-api` URL doesn't exist until B2 finishes provisioning. Do Part B, grab
> the URL from the service's page header (`https://si-api-xxxx.onrender.com` on
> the free plan), then come back and add these.

---

## Part D — Deploy and verify

### D1. Trigger

Push to `main` (or hit **Manual Deploy → Deploy latest commit** on the Render
service). On a push to `main`:

1. CI `check` / `integration` / `docker` jobs run.
2. Render builds the image, starts the service, gates the rollout on
   `GET /healthz` → 200. **Migrations are not run here** — you applied `0001` by
   hand in B4. (On a later spec that adds a migration, run B4's command before or
   right after the deploy, before real traffic hits the new schema.)
3. CI `smoke` job (`if: github.ref == 'refs/heads/main'`, `needs: [check,
   integration, docker]`) runs `scripts/smoke.ts` against `STAGING_BASE_URL`.
   First run may sit in the `/healthz` poll for ~1 min while the free web
   instance cold-starts — expected.

### D2. What the smoke asserts (`scripts/smoke.ts`)

| Step | Expect |
|---|---|
| poll `GET /healthz` (≤ 30 × 10 s) | `200` — waits out the Render deploy |
| `GET /readyz` | `200` — **this is how `/readyz` deploy-gates on DB reachability** (Render only checks `/healthz`) |
| `client_credentials` grant at `AUTH0_TOKEN_URL` | `200` with `access_token` |
| `GET /v1/_authcheck` with that token | `200`, `aud` includes `https://api.strengthinnumbers.app` |
| `GET /v1/me` with that token | `401`, problem `type` ends `/invalid-token` (no `email` claim on an M2M token) |

Any deviation exits non-zero and fails the pipeline.

### D3. Timing seam

The `smoke` job and Render's deploy race, so `smoke.ts` polls `/healthz` with
retries rather than assuming the pushed SHA is already live. Fine for a solo
repo. A stricter version would call the Render API / a deploy hook to wait for
the specific deploy id.

### D4. Verify the live deploy by hand

Do this once after the first deploy (and any time the smoke fails and you want to
localise the problem). It's the same five assertions `scripts/smoke.ts` makes,
run manually.

**a. The deploy actually went live.** Render dashboard → `si-api` → **Events**
shows `Deploy live`; **Logs** shows `{"msg":"api listening",...}` and **no**
`Fatal startup error`. If you see a Prisma `did not initialize` / `libssl` crash,
the built image predates the Dockerfile fixes (openssl + explicit
`prisma generate`) — **Manual Deploy → Deploy latest commit**.

**b. Liveness + readiness.** Set `BASE` to your service URL (no trailing slash):

```bash
BASE=https://si-api-xxxx.onrender.com

curl -s  $BASE/healthz          # {"status":"ok"}     — process is up
curl -s  $BASE/readyz           # {"status":"ready"}  — Prisma reached Neon over TLS
curl -si $BASE/v1/me | head -1  # HTTP/2 401          — unauthenticated request rejected
```

The first call can take 30–60 s while a cold free instance spins up. A `503` from
`/readyz` means the DB isn't reachable from the service — check `DATABASE_URL` on
the Render service (the Neon **direct** string, `?sslmode=require`) and that the
Neon project isn't paused.

**c. Real Auth0 token — the auth path.** Mirrors the smoke's token steps. Uses
the Test Application creds (A2) and your tenant (A1):

```bash
BASE=https://si-api-xxxx.onrender.com
TENANT=dev-gncuqvfir0wv0t4l          # your Auth0 tenant
CLIENT_ID=xxxxxxxx                   # A2 Test Application
CLIENT_SECRET=xxxxxxxx               # A2 Test Application

TOKEN=$(curl -s "https://$TENANT.us.auth0.com/oauth/token" \
  -H 'content-type: application/json' \
  -d "{\"grant_type\":\"client_credentials\",\"client_id\":\"$CLIENT_ID\",\"client_secret\":\"$CLIENT_SECRET\",\"audience\":\"https://api.strengthinnumbers.app\"}" \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

test -n "$TOKEN" && echo "got token"                                              # got token

curl -s -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $TOKEN" $BASE/v1/_authcheck   # 200
curl -s -w '\n%{http_code}\n'            -H "authorization: Bearer $TOKEN" $BASE/v1/me            # …/invalid-token then 401
```

- `/v1/_authcheck` → **200**: the token's `iss`/`aud` match the service config.
  A `401` here = `AUTH0_ISSUER`/`AUTH0_AUDIENCE` on the service don't match the
  tenant, or the Test App isn't authorised for the API.
- `/v1/me` → **401** with problem `type` ending `/invalid-token`: correct — an
  M2M token has no `email` claim (the A3 Action only runs on interactive logins).
  A `200` here means the A3 Action is attached to the wrong flow, or its
  namespace ≠ `AUTH0_CLAIM_NAMESPACE`.

Once b and c pass by hand, wiring Part C's GitHub secrets and pushing to `main`
should make the CI `smoke` job go green for the same reasons.

---

## Part E — Production (deferred)

Not part of this deploy. The full gated staging→prod pipeline is
[Spec 01.1](../specs/01.1-prod-deploy-pipeline.md); do it when you
actually need a prod environment, not now.

- **Auth0:** prod needs its **own** tenant (never share with staging). On the
  free plan that's a second free tenant if Auth0 lets you create one, otherwise
  the paid tier for a Production-tagged environment — evaluate then. In it,
  repeat Part A: same API Identifier, same namespace, its own M2M app, its own
  copy of the A3 Action bound to the Login flow.
- **Render:** a second service from the same `render.yaml`
  (`si-api-prod`, `autoDeploy: false`) + its own Postgres + a
  `api-shared-prod` group with the prod tenant's `AUTH0_ISSUER` and the real
  `WEB_ORIGIN`. Promoted with the exact image that passed staging.
- **CI:** add `PROD_BASE_URL` / `AUTH0_PROD_*` and the `deploy-prod` workflow
  per Spec 01.1.

---

## Done when

- The Render service is live and B4's `prisma migrate deploy` applied `0001` to Neon.
- B5's `seed:catalog` reported `inserted` > 0 on first run and `unchanged` on a re-run.
- The CI `smoke` job passes end to end against your Auth0 tenant.
- `render.yaml` is the source of truth — no manual service config drift.

Production comes later, via Spec 01.1.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Service won't boot, log says `Invalid configuration: AUTH0_ISSUER: must be https in production` | `NODE_ENV=production` + an `http://` issuer, or a missing trailing slash. |
| Boot fails on `WEB_ORIGIN` | Empty, `http://` in prod, has a path, or a wildcard. Use a bare `https://host[:port]`. |
| B4 `prisma migrate deploy` hangs or `P1001 can't reach database` | Used the Neon **pooled** host (`-pooler`) — switch to the direct host. Or the Neon compute is resuming from idle; re-run. |
| B4 fails `P1011`/TLS | `?sslmode=require` missing from the URL you passed. |
| B5 `seed aborted: … changed an identifying field` | A live `catalog_key`'s `name`/`modality` was edited in `exercises.json`. Append-only: restore the old entry, mark it `"retired": true`, and add the new one under a new key. |
| B5 `seed aborted: … unknown primaryMuscleId` (or equipment) | The code isn't in `muscle-groups.json` / `equipment.json`. Add it there first. Codes are immutable once shipped. |
| `GET /v1/exercises` returns `[]` on staging | B5 was skipped — run the seed. |
| Boot crash: `@prisma/client did not initialize yet. Please run "prisma generate"` | The runtime image has no generated client. Fixed in `Dockerfile` — the runtime stage runs `pnpm --filter @sin/api exec prisma generate` explicitly (`@prisma/client`'s postinstall can't find the schema in a pnpm monorepo). Don't remove that line. |
| Boot/query: `libssl`/`libquery_engine` load error, or `prisma:warn Prisma failed to detect the libssl/openssl version` | `node:22-slim` ships without `openssl`. Fixed in `Dockerfile` base stage (`apt-get install openssl ca-certificates`). |
| Render rollout stuck / unhealthy | `/healthz` isn't 200 — check the image actually started (`CMD` runs `node apps/api/dist/server.js`) and `PORT` is being read. |
| Smoke: `/readyz` → 503 | DB unreachable from the running service. Check `DATABASE_URL` on the service = the Neon string, and that the Neon project isn't disabled. A cold Neon compute can 503 the very first hit then recover. |
| Smoke: `/v1/_authcheck` → 401 instead of 200 | Wrong `AUTH0_AUDIENCE`/`AUTH0_ISSUER` on the service vs the tenant, or the M2M app isn't authorized for the API. |
| Smoke: `/v1/me` → **500** (first three checks pass) | The `user` table doesn't exist — **B4 migration not applied**, or applied to a different Neon branch/database than Render's `DATABASE_URL`. Re-run B4 with the exact string from Render's Environment. |
| Smoke: `/v1/me` → 200 instead of 401 | The Action is putting `email` on **M2M** tokens too (it should only run on the Login flow, not client-credentials), or the namespace differs between the Action and `AUTH0_CLAIM_NAMESPACE`. |
| Smoke: grant returns 401 `Unauthorized` | Bad/stale `AUTH0_STAGING_M2M_CLIENT_ID`/`SECRET` (e.g. from an old Test App after recreating the API). |
| Smoke: grant returns 403 `access_denied: Service not enabled within domain: <aud>` | No API in the tenant has that exact Identifier — typo, trailing slash, or wrong subdomain. The Identifier is immutable; recreate the API to match `AUTH0_AUDIENCE`. |
| Smoke: grant returns 403 `Client is not authorized to access …` | The M2M app isn't authorized for the API — API → **Application Access** tab, toggle the app on. |
