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

   Keep `?sslmode=require` on it — Neon requires TLS — and **append
   `&sslaccept=strict`** so the server certificate and hostname are verified
   (issue #8). The app backfills `sslaccept=strict` itself, but `prisma migrate
   deploy` (B4) reads the raw URL, so it has to be on the stored value too:

   ```
   postgresql://<user>:<pass>@ep-xxxx.us-west-2.aws.neon.tech/neondb?sslmode=require&sslaccept=strict
   ```

   Do **not** use libpq's `sslmode=verify-full`: Prisma's engine doesn't know it
   and silently downgrades to `prefer` (TLS optional); the app refuses to boot on
   it. B6 checks that strict validation actually works against Neon.

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

### B3.5. Local machine prerequisites (first time running B4/B5 from a new machine)

B4 and B5 run pnpm commands from **your own terminal**, not CI. On a machine
that hasn't run this repo before, expect to hit these, roughly in this order:

1. **`zsh: command not found: pnpm`** — pnpm isn't installed. Activate it via
   corepack (bundled with Node), which reads the exact version pinned in the
   repo's `package.json` (`packageManager`):

   ```bash
   corepack enable
   corepack prepare pnpm@9.15.4 --activate
   ```

2. **`ERR_PNPM_UNSUPPORTED_ENGINE` — `Expected version: >=22 <23`** — the
   repo's `.npmrc` sets `engine-strict=true`, so pnpm refuses to run on the
   wrong Node major version. Install Node 22 via a version manager (nvm)
   rather than replacing your system/default Node:

   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   # open a new terminal, or: exec zsh
   nvm install 22
   nvm alias default 22
   ```

   If your shell rc exports another Node's `bin` onto `PATH` **after** the nvm
   block, it wins and silently keeps the old Node active even though
   `nvm alias default` succeeded. Put the nvm sourcing last, or add
   `nvm use default --silent` as the final Node-related line in the rc file.
   A Homebrew `node@22` install doesn't fix this on its own either — it's a
   keg-only formula Homebrew won't link onto `PATH` by default, so it just
   sits there unused; nvm is the one actually switching your active Node.

3. **`sh: tsx: command not found`** / **`WARN Local package.json exists, but
   node_modules missing`** — dependencies were never installed under this
   Node/pnpm. Run:

   ```bash
   pnpm install
   ```

4. **`Error [ERR_MODULE_NOT_FOUND]: Cannot find module
   '.../apps/api/node_modules/@sin/core/dist/index.js'`** — `packages/core` is
   a workspace package `apps/api` imports; its `dist/` only exists after it's
   built, and `pnpm install` does not build workspace packages. Build it once:

   ```bash
   pnpm --filter @sin/core run build
   ```

   (`pnpm run build` from the repo root builds every package in dependency
   order, if you'd rather not build `@sin/core` alone.)

Once these pass, B4/B5 behave as documented below.

### B4. Run the migration against Neon (by hand) — **required, easy to miss**

Free Render has no pre-deploy step, so apply `0001_create_user` yourself. **The
service deploys fine, `/healthz` and `/readyz` go green, and `/v1/_authcheck`
passes — all without the `user` table.** The first thing that needs it is
`/v1/me`, so a skipped migration shows up only as a **`500` on `/v1/me`** (and
the CI `smoke` failing at that exact step).

Use the **same connection string that is set as `DATABASE_URL` on the Render
service** — copy it from Render (service → **Environment**), don't hand-assemble
it. Neon has *branches*; migrating `neondb` on one branch while Render points at
another is the classic trap. B4 and B5 (and their verify commands) all need the
same value, so export it once for the shell session, from the repo root:

```bash
export DATABASE_URL='<paste the exact value from Render, the direct -pooler-free host>'
```

An exported variable takes precedence over `apps/api/.env` (Prisma and tsx's
`--env-file` both leave already-set variables alone), so this safely overrides
the local Docker URL. **`unset DATABASE_URL` when you're done** (end of B5) so a
later local command doesn't point at Neon by accident.

```bash
pnpm run db:migrate:deploy   # = pnpm --filter @sin/api exec prisma migrate deploy
```

Run it from the repo root with `pnpm`, never `npx prisma …` — `npx` fetches the
latest Prisma (a different major) instead of the repo's pinned one. The root
`.npmrc` makes pnpm use Node 22.23.4 even if your shell's `node` is another version.

Expect `N migrations found` and one `Applying migration …` line per migration
not yet on that database — on a fresh Neon branch that is every folder under
`apps/api/prisma/migrations/` (`0001_create_user`, `0002_create_exercise_catalog`,
…); on a later deploy only the new ones. Re-run anytime; it's idempotent. If it
hangs or fails `P1001` the Neon compute is probably resuming from idle — re-run.
**Repeat this one command whenever a later spec adds a migration**, before that
deploy serves traffic — i.e. before merging the PR that ships the code. **Do not
run it while `seed:catalog` (B5) is running**: a migration that touches
`exercise` (e.g. `0004`) would queue behind the seed's 60 s transaction, and the
seed's writes behind the migration. (This still honors Spec 01 §6.4 — migrations
never run on app boot.)

**Verify it landed** — any one of these:

- **CLI, no console needed** (same exported `DATABASE_URL`):

  ```bash
  pnpm run db:migrate:status
  ```

  Expect `Database schema is up to date!` and every migration folder listed as
  applied. A `Following migration have not yet been applied` message means it
  didn't take (wrong branch/DB — see the trap above).

- **Neon console → SQL Editor** (this is the source of truth Prisma itself uses):

  ```sql
  select migration_name, finished_at, rolled_back_at
  from _prisma_migrations order by finished_at;
  ```

  One row per migration folder, `finished_at` set, `rolled_back_at` null.

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
as B4: the exact value from Render, the **direct** (non-`-pooler`) host — still
exported from B4.

```bash
pnpm --filter @sin/api run seed:catalog
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

A `skipped` count > 0 or a `warn` line means a DB row has no file entry — that
is allowed (append-only), but check it was intentional.

**Verify it landed** through the running service (this is the check that proves
the seed hit the *same* database Render reads). `/v1/exercises` needs a bearer;
get one with the Auth0 CLI exactly as in
[`manual-staging-test-contract-pipeline.md` §3](manual-staging-test-contract-pipeline.md#3-get-a-token)
(`auth0 login`, then `auth0 test token -a https://api.strengthinnumbers.app
-s "openid profile email"`, log in as the **test user**; the one-time
"authorize the CLI client" dashboard step is described there). Then:

```bash
TOKEN='<access_token printed by auth0 test token>'
BASE=https://si-api-ft2f.onrender.com
curl -s $BASE/readyz                                          # {"status":"ready"} — may take 30–60s on a cold start
curl -s -H "Authorization: Bearer $TOKEN" $BASE/v1/exercises | jq '.exercises | length'        # 10
curl -s -H "Authorization: Bearer $TOKEN" $BASE/v1/exercises | jq '.exercises[].catalogKey'    # the keys from exercises.json
```

`0` / `[]` means the seed wrote to a different database than the service uses —
re-check the exported string against Render → Environment (branch included).
Equivalent DB-side check, Neon SQL editor on the same branch:
`select catalog_key, is_active from exercise order by 1;` → one row per file entry.

Keep `DATABASE_URL` exported for B6.

### B5a. Rebuild personal records (by hand, after B4 + the Spec 07.0 deploy) — Spec 07.0

`personal_record` (migration `0008`, applied by B4) is a derived cache that the
finish / delete paths keep current from the 07.0 deploy onward. **Workouts finished
before that deploy have no rows until this step runs** (staging already has some).
Like B5 it is a manual release step: run it after `migrate deploy` and after the
code is live, with the same direct-host `DATABASE_URL` still exported from B4.
Idempotent — re-run any time, and **always after a rollback window** (finishes and
deletes during a rollback don't update the table).

```bash
pnpm --filter @sin/api run records:rebuild            # every user
pnpm --filter @sin/api run records:rebuild -- --user <user-uuid>   # one account
```

Expect one `records_rebuilt` JSON line per user (`user_id`, `root_count`,
`record_count`) and a final summary. It takes the same per-user advisory lock as
the live path, so it is safe to run while the service is taking traffic. Verify
through the API: `GET $BASE/v1/personal-records` with a bearer (as in B5) returns
the test user's records, `[]` only if that user has no finished workouts with
eligible sets.

### 0010 — planned sets (Spec 09.1)

1. `DATABASE_URL='<neon direct url>' pnpm run db:migrate:deploy` **before** merging 09.1; confirm with `db:migrate:status`.
2. Merge 09.1 (Render deploys the API).
3. Consistency check — expected `0`:

   ```sql
   SELECT count(*) FROM "routine_item" ri
   WHERE ri.target_sets IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "routine_item_set" s WHERE s.routine_item_id = ri.id);
   ```

   Non-zero means an old-code routine save ran between steps 1 and 2. Re-run the guarded backfill (the `INSERT … SELECT` between `BACKFILL-BEGIN` / `BACKFILL-END` in `apps/api/prisma/migrations/0010_create_planned_sets/migration.sql`); it only fills items that have no rows.
4. Spec 10.2 (the UI) merges only after step 3 is clean.

### 0011 — routine sections (Spec 09.2)

1. `DATABASE_URL='<neon direct url>' pnpm run db:migrate:deploy` **before** merging 09.2; confirm with `DATABASE_URL='<neon direct url>' pnpm run db:migrate:status` (the 2026-10-04 incident: do not assume). Old code ignores the new tables and columns, so the migration safely precedes it.
2. Merge 09.2 (Render deploys the API; the static site redeploys in the same commit, so for a few minutes the new bundle's schemas require fields the old API does not send — accepted on staging, as in 0010).
3. Verify: `GET $BASE/v1/routines` shows `sections: []` and `sectionId: null` everywhere; `GET $BASE/v1/workouts/active` (or any `GET /v1/workouts/{id}`) shows `sections: []`, `routineNotes: null`. Consistency queries — both expected `0`:

   ```sql
   SELECT count(*) FROM "routine_item" ri JOIN "routine_section" s ON s.id = ri.section_id WHERE s.routine_id <> ri.routine_id;
   SELECT count(*) FROM "workout_exercise" we JOIN "workout_section" s ON s.id = we.section_id WHERE s.workout_id <> we.workout_id;
   ```

   There is no backfill and no rollout-window hazard: old code never writes the new columns, and no client creates sections until Spec 10.3.
4. Spec 10.3 (the UI) merges only after step 3 is clean.

### 0012 — workout planned duration (Spec 07.4 Phase B)

1. `DATABASE_URL='<neon direct url>' pnpm run db:migrate:deploy` **before** merging 07.4 Phase B; confirm with `DATABASE_URL='<neon direct url>' pnpm run db:migrate:status` (the 2026-10-04 incident: do not assume). Old code never reads or writes `planned_duration_s`, so the migration safely precedes it.
2. Merge Phase B (Render deploys the API; the static site redeploys in the same commit, so for a few minutes the new bundle's schemas require `plannedDurationSeconds`, which the old API does not send — accepted on staging, as in 0010 / 0011).
3. Verify: any `GET $BASE/v1/workouts/{id}` and the first page of `GET $BASE/v1/workouts` show `plannedDurationSeconds: null`. Consistency query — expected `0`:

   ```sql
   SELECT count(*) FROM "workout" WHERE planned_duration_s IS NOT NULL AND ended_at IS NOT NULL;
   ```

   (The `workout_planned_duration_live_only` CHECK makes this impossible; the query confirms the constraint is live.) No backfill, no `records:rebuild`.
4. Rollback: revert the code; the column stays (expand-only). **Then clear every stored plan** as soon as the revert is live:

   ```sql
   UPDATE "workout" SET planned_duration_s = NULL WHERE planned_duration_s IS NOT NULL;
   ```

   Old code's finish does not clear `planned_duration_s`, so finishing a live workout that still has a plan breaks `workout_planned_duration_live_only` (a `500`), and the one-active rule then leaves the lifter stuck on that workout until it is discarded. Clearing loses only the "took" of workouts still in progress (the lifter's finish then uses "now", as before Phase B). Re-run step 3's query afterwards (expected `0`).

### 0013 — routine one-off (Spec 09.3)

1. `DATABASE_URL='<neon direct url>' pnpm run db:migrate:deploy` **before** merging 09.3; confirm with `DATABASE_URL='<neon direct url>' pnpm run db:migrate:status` (the 2026-10-04 incident: do not assume). Old code never reads or writes `one_off_until`, so the migration safely precedes it.
2. Merge 09.3 (Render deploys the API; the static site redeploys in the same commit, so for a few minutes the new bundle's schemas require `oneOffUntil` and `routineIsOneOff`, which the old API does not send — accepted on staging, as in 0010 / 0011 / 0012).
3. Verify: `GET $BASE/v1/routines` shows `oneOffUntil: null` everywhere; `GET $BASE/v1/workouts/active` (or any workout) shows `routineIsOneOff: false`; `POST $BASE/v1/routines/{id}/keep` on an ordinary routine answers `204`. Consistency query — expected `0`:

   ```sql
   SELECT count(*) FROM "routine" WHERE one_off_until IS NOT NULL AND one_off_until <= created_at;
   ```

   (The CHECK makes this impossible; the query confirms the constraint is live.) No backfill, no `records:rebuild`.
4. Spec 10.5 (the UI) may merge only after step 3 is clean, and after Spec 10.4.
5. Rollback: revert the code; the column and CHECK stay, inert (one-offs become ordinary routines: never swept, never removed by a finish). If 10.5 is merged, revert it first. **Before reverting 10.5, convert every one-off**, so none keeps removing itself on finish with no tag and no Finish-dialog line:

   ```sql
   UPDATE "routine" SET one_off_until = NULL, updated_at = now() WHERE one_off_until IS NOT NULL;
   ```

   Then revert 10.5, then 09.3 if needed.

### 0014 — workout section origin (Spec 09.4)

1. `DATABASE_URL='<neon direct url>' pnpm run db:migrate:deploy` **before** merging 09.4; confirm with `DATABASE_URL='<neon direct url>' pnpm run db:migrate:status` (do not assume). Old code never reads or writes `added_in_workout`, so the migration safely precedes it.
2. Merge 09.4 (Render deploys the API; the static site redeploys in the same commit, so for a few minutes the new bundle's schemas require `addedInWorkout` on every section, which the old API does not send — the session and History screens would fail to parse; accepted on staging, as in 0010 / 0011 / 0012 / 0013).
3. Verify: `GET $BASE/v1/workouts/{id}` shows `addedInWorkout: false` on every section; `POST $BASE/v1/workouts/{id}/sections` on a scratch workout answers `201`; a `PATCH $BASE/v1/workout-exercises/{id}` with `sectionId` moves the exercise; `DELETE $BASE/v1/workout-sections/{id}` answers `204`. Consistency queries — expected `0` each (run the first immediately after deploy, before any test write):

   ```sql
   SELECT count(*) FROM workout_section WHERE added_in_workout;
   SELECT count(*) FROM (SELECT workout_id FROM workout_section GROUP BY workout_id HAVING max(position) + 1 <> count(*)) t;
   ```

   No backfill, no `records:rebuild`.
4. Spec 10.6 (the UI) may merge only after step 3 is clean.
5. Rollback: revert the code commit; the column stays, inert. Old code ignores it: sections added in workouts remain (ordinary rows; the old UI draws them as sections and cannot edit them). If 10.6 is merged, revert it first. Nothing to convert: no data is hidden by a rollback.

### B6. Verify DB TLS validation (by hand, after B4) — issue #8

`sslmode=require` alone encrypts the link but, in Prisma's engine, does **not**
check the server's certificate (its `sslaccept` default is `accept_invalid_certs`).
`sslaccept=strict` turns on chain + hostname verification against the OS trust
store. Neon's certificates chain to ISRG Root X1 (Let's Encrypt), which is in
every mainstream root store, so no CA bundle is needed — but prove it before
relying on it, and re-run this whenever the DB host or the image's base changes
(e.g. the Spec 15 RDS move, where `sslcert=<AWS bundle>` becomes necessary).

**Run a–c before merging any change that touches the DB URL, the Prisma
version, or the image base** — merging to `main` auto-deploys staging, and the
app backfills `sslaccept=strict` on boot, so a validation failure shows up as a
`503` from `/readyz` and a red post-deploy smoke *after* the deploy. Building
the image from the branch (step c) is what proves it ahead of time.

Same exported `DATABASE_URL` as B4/B5 (with `&sslaccept=strict` already on it,
per B1). `HOST` is the Neon direct host:

```bash
HOST=$(node -e 'console.log(new URL(process.env.DATABASE_URL).hostname)')
```

**a. Neon's chain is publicly trusted** — independent of Prisma, OpenSSL doing a
Postgres STARTTLS and verifying chain *and* hostname. Needs OpenSSL ≥ 1.1.1 for
`-starttls postgres` / `-verify_hostname` (macOS ships LibreSSL — use Homebrew's
`openssl`):

```bash
openssl s_client -starttls postgres -connect "$HOST:5432" -servername "$HOST" \
  -verify_return_error -verify_hostname "$HOST" </dev/null 2>&1 | grep -E "Verify return code|issuer="
```

Expect `Verify return code: 0 (ok)` and an issuer chaining to `ISRG Root X1`.
Anything else means strict mode will fail — stop and investigate.

**b. Strict validation through Prisma, from your machine:**

```bash
echo 'SELECT 1' | pnpm --filter @sin/api exec prisma db execute --stdin --schema prisma/schema.prisma
```

The CLI reads `DATABASE_URL` from the environment via the schema's
`env("DATABASE_URL")` — deliberately not `--url`, which would put the password
on the process argv (visible to other local users via `ps`). Expect
`Script executed successfully.` (If your stored URL doesn't yet carry
`sslaccept=strict`, re-export it with `&sslaccept=strict` appended first.)

**c. Strict validation from inside the production image** — the check that
matters: Render runs the Debian image with its own `ca-certificates`, not your
laptop's trust store.

```bash
docker build -t si-api-tls-check .
echo 'SELECT 1' | docker run --rm -i -w /app/apps/api -e DATABASE_URL si-api-tls-check \
  node_modules/.bin/prisma db execute --stdin --schema prisma/schema.prisma
docker rmi si-api-tls-check
```

(`-e DATABASE_URL` with no value forwards your exported variable into the
container's environment; again nothing on argv.) Expect
`Script executed successfully.` again.

**d. Negative control** — proves strict is *validating*, not silently ignored.
Connect to the same endpoint by IP: Neon's certificate has no IP SAN, so hostname
verification must reject it.

```bash
export IP=$(dig +short A "$HOST" | grep -E '^[0-9.]+$' | head -1)
echo 'SELECT 1' | DATABASE_URL="$(node -e 'const u=new URL(process.env.DATABASE_URL);u.hostname=process.env.IP;u.searchParams.set("sslaccept","strict");console.log(u.href)')" \
  pnpm --filter @sin/api exec prisma db execute --stdin --schema prisma/schema.prisma
```

(`export` matters: the inline `node -e` reads `IP` from the environment. The
rewritten URL is passed as an env var, not `--url`, so it never lands on argv.)

Expect **a TLS / certificate / hostname verification error** (`P1011`,
"certificate", "hostname") — that is the only conclusive pass. Read anything
else as a failure of the check:
- **"Endpoint ID is not specified"** means Neon answered at the Postgres
  protocol level — which it can only do *after* a completed TLS handshake. With
  strict validation the handshake against a bare IP (no IP SAN on Neon's cert)
  must fail first, so this error means TLS succeeded without validation.
  **Strict is not working: stop, do not deploy.**
- **success** — same conclusion, stop.
- a DNS / `undefined` host error means `IP` was empty — check the `export` line.

Finally, drop the Neon string from your shell:

```bash
unset DATABASE_URL HOST IP
```

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
| `E2E_AUTH0_USERNAME` | **Secret** | the browser-smoke test user's email — see [`m1-browser-smoke.md`](m1-browser-smoke.md) |
| `E2E_AUTH0_PASSWORD` | **Secret** | that user's password — same runbook |
| `STAGING_WEB_BASE_URL` | Variable (optional) | overrides `https://si-web-staging.onrender.com` for the web smoke and the browser smoke |

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
   hand in B4. (On a later spec that adds a migration, run B4's command **before
   you merge**: a merge to `main` auto-deploys the code, and if that code reads a
   column the migration adds — as Spec 03.3's `change_xid` catalog read does —
   it will `500` until the migration lands. Additive migrations are safe for the
   still-running old image, so migrating first costs nothing.)
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
the Render service (the Neon **direct** string, `?sslmode=require&sslaccept=strict`)
and that the Neon project isn't paused. A `503` that appeared right after adding
`sslaccept=strict` is a certificate/hostname rejection — re-run B6 and check the
service log for `P1011`.

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

**d. Client IP behind Render + Cloudflare (Spec 05.2 §11).** The per-IP rate
limit keys on `clientAddress()` (`apps/api/src/plugins/rate-limit.ts`):
Cloudflare's `CF-Connecting-IP` when the socket is private/loopback (Render's own
infrastructure), else the socket. Check it after any deploy that touches it and
after any hosting change:

```bash
curl -s -H 'X-Forwarded-For: 203.0.113.9' -H 'CF-Connecting-IP: 203.0.113.10' $BASE/healthz   # {"status":"ok"}
```

In Render **Logs**, the matching `request completed` line's **`client_ip`** must
be **your real public IP**: not `203.0.113.9` or `203.0.113.10` (a forged header
was trusted), not a `10.x` / `100.64.x` / `127.x` address, and not a Cloudflare
address (every user would share one bucket). (Fastify's own `remoteAddress` on
the `incoming request` line is the socket — a proxy — by design; note what it
is.) A `trust_proxy_suspect` warning means the Cloudflare assumption broke; its
`reason` says how:

- `no-cf-connecting-ip` — Render stopped forwarding the header.
- `unknown-proxy` with a Cloudflare `socket` (e.g. `104.x` / `172.64–71.x`) —
  Render hands us the Cloudflare edge directly, so `client_ip` is the edge and
  users behind one edge share a bucket. That is safe (unspoofable) but coarse;
  deciding whether to trust that socket is a deliberate design change (Spec
  05.2 D12: Cloudflare's ranges also carry WARP/Worker end users), not a quick
  fix.

**On Cloud Run (production, `CLIENT_IP_SOURCE=cloud-run`)** the rule is different (the right-most
`X-Forwarded-For` entry behind a non-public socket; `CF-Connecting-IP` is never read): check it with
Part F11 instead.

*History:* the first check (2026-10-04) logged the Cloudflare edge `104.22.64.33`
— the original "private socket + one hop" `trustProxy` was a hop short, and
walking `X-Forwarded-For` through Cloudflare's ranges proved spoofable from
WARP/Workers. Fixed by keying on `CF-Connecting-IP` behind a private socket
only (Spec 05.2 D12).

---

## Account deletion requests (Spec 11)

An ongoing operator task, not a release step. `DELETE /v1/account` only marks an
account deleted; its data stays until you purge it, at least 30 days later.
Testers can now download their data and request deletion themselves in the app
(Profile → Your data / Delete account, Spec 12); the operator steps below are unchanged.

**Monthly, or when a tester asks:**

1. Export the direct-host `DATABASE_URL` (same as B4).
2. Dry run — lists eligible accounts (user id, deleted date, workout and set counts; never email):
   `pnpm --filter @sin/api run account:purge`
3. If the list is right: `pnpm --filter @sin/api run account:purge --confirm`
4. The last line reads `purged N, skipped M, failed K`. Exit code 1 means something failed or a `--user` target was not purged — read the `account_purge_*` lines.

**Immediate erase** (a tester asks for it now, after deleting in the app):
`pnpm --filter @sin/api run account:purge --user <id> --skip-grace --confirm`.
A live (not deleted) account can never be purged by any flag.

**Restore a mistaken delete** (only before the purge — afterwards the data is gone):

```sql
UPDATE "user" SET deleted_at = NULL WHERE id = '<id>';
```

**Full erasure request:** the purge doesn't touch Auth0. Delete the user in the
Auth0 dashboard (User Management → Users) by hand. Database backups age out on
the host's retention window.

## Part F — Production on Google Cloud (Spec 15)

Production is a separate Google Cloud project on the free tier: the API on **Cloud Run** (`si-api`,
`us-central1`, scale 0 → 1), the web app on **Firebase Hosting**, its own **Neon** project, and a
**$1 budget alert**. Staging stays on Render (Parts B–D). Everything below is done once, by hand, from your
Mac, in this order; after that a release is one approved click (F11). Nothing in Google Cloud exists until
you do F2–F5, and the CI `publish` job and `deploy-prod` skip or refuse until then.

### F1. Tools

- **gcloud CLI:** `brew install --cask google-cloud-sdk`, then `gcloud auth login` and
  `gcloud auth application-default login` (Terraform uses the second).
- **Terraform 1.17.0** — the exact version in `infra/versions.tf`. Download
  `terraform_1.17.0_darwin_arm64.zip` and `terraform_1.17.0_SHA256SUMS` from releases.hashicorp.com, check
  `grep darwin_arm64.zip terraform_1.17.0_SHA256SUMS | shasum -a 256 -c -`, unzip, and put it on your PATH.
- **firebase-tools** is a pinned dev dependency of `@sin/web`: always `pnpm --filter @sin/web exec firebase …`.

### F2. Project and billing (console or gcloud)

```bash
gcloud projects create <project-id>                       # e.g. sin-prod-<something unique>
gcloud billing accounts list                              # note the ACCOUNT_ID
gcloud billing projects link <project-id> --billing-account=<ACCOUNT_ID>
gcloud projects describe <project-id> --format='value(projectNumber)'   # the project number
```

### F3. Fill `infra/prod.tfvars` (a small PR) — the placeholders end here

Replace every `REPLACE_ME_*` in `infra/prod.tfvars`: `project_id`, `project_number`, `hosting_site_id` (the
web address becomes `https://<site id>.web.app`; the project id is a fine choice) and `billing_account_id`.
In the same PR, put the same values in `apps/web/firebase.json`: `hosting.site`, and the API origin in the
CSP's `connect-src` (`https://si-api-<project number>.us-central1.run.app`). Then:

```bash
pnpm --filter @sin/api exec tsx scripts/check-prod-ids.ts --strict   # must print "no placeholders"
node apps/web/scripts/assert-firebase-json.mjs                        # PASS
pnpm --filter @sin/api exec vitest run test/unit/prod-origins.test.ts
```

Merge it. `deploy-prod` refuses to run while any placeholder is left.

### F4. Terraform state bucket (by hand, once)

```bash
gcloud storage buckets create gs://<project-id>-tfstate --project=<project-id> --location=us-central1 \
  --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://<project-id>-tfstate --versioning
```

### F5. First apply

```bash
terraform -chdir=infra init -backend-config="bucket=<project-id>-tfstate"
terraform -chdir=infra apply -var-file=prod.tfvars
terraform -chdir=infra output
```

Check (AC5): `api_origin` is in `api_urls`, and `web_origin` is `https://<site id>.web.app`; both must equal
what `prod.tfvars` gives. Cloud Run starts on Google's sample image until the first `deploy-prod`.
Terraform never deploys an image after that (`ignore_changes`). **Never run `apply` from CI.**

### F6. Production database (Neon) and its secret

1. Create a **new** Neon free project (the B1 steps, its own project — not staging's). Take the **direct**
   (not `-pooler`) connection string and append `sslmode=require&sslaccept=strict` (B1).
2. Store it as the runtime secret — from stdin, so it never lands in your shell history:

```bash
pbpaste | gcloud secrets versions add si-database-url --project=<project-id> --data-file=-
```

3. **AC29 — the empty database, by hand, with the same URL** (B4, B5, B5a, B6 against production):

```bash
DATABASE_URL='<prod direct url>' pnpm run db:migrate:deploy
DATABASE_URL='<prod direct url>' pnpm run db:migrate:status          # up to date
DATABASE_URL='<prod direct url>' pnpm --filter @sin/api run seed:catalog   # inserted > 0; again → unchanged
DATABASE_URL='<prod direct url>' pnpm --filter @sin/api run records:rebuild  # a no-op on an empty database
```

and B6 (certificate and hostname verification) against the production URL.

### F7. Auth0 production applications (AC30)

In the existing tenant (D7):
- **SPA application** "Strength in Numbers (production)": allowed callback, logout and web-origin URLs =
  the `web_origin` output; refresh-token rotation as staging's SPA app.
- **M2M application** "si production smoke", authorized for the existing API
  (`https://api.strengthinnumbers.app`). Its secret goes only into the GitHub Environment (F8).

### F8. GitHub variables, Environment and secrets (spec §8)

**Repository variables** (Settings → Secrets and variables → Actions → Variables):

| Name | Value |
|---|---|
| `GCP_WIF_PROVIDER` | `terraform -chdir=infra output -raw wif_provider` |
| `GCP_PUBLISHER_SA` | `terraform -chdir=infra output -raw publisher_sa` |
| `GCP_PROJECT_ID` | the project id |
| `GCP_REGION` | `us-central1` |
| `AR_IMAGE` | `terraform -chdir=infra output -raw ar_repository` + `/api` |

**Environment `production`** (Settings → Environments → New environment): required reviewer = you;
deployment branches = `main` only. Its variables and secrets:

| Name | Kind | Value |
|---|---|---|
| `GCP_DEPLOYER_SA` | var | `terraform -chdir=infra output -raw deployer_sa` |
| `PROD_API_BASE_URL` | var | `terraform -chdir=infra output -raw api_origin` |
| `PROD_WEB_BASE_URL` | var | `terraform -chdir=infra output -raw web_origin` |
| `FIREBASE_SITE_ID` | var | the `hosting_site_id` from `prod.tfvars` |
| `VITE_API_BASE_URL` | var | `terraform -chdir=infra output -raw api_origin` |
| `VITE_AUTH0_DOMAIN` | var | `dev-gncuqvfir0wv0t4l.us.auth0.com` |
| `VITE_AUTH0_CLIENT_ID` | var | the production SPA application's client id (F7) |
| `VITE_AUTH0_AUDIENCE` | var | `https://api.strengthinnumbers.app` |
| `AUTH0_PROD_TOKEN_URL` | var | `https://dev-gncuqvfir0wv0t4l.us.auth0.com/oauth/token` |
| `AUTH0_PROD_M2M_CLIENT_ID` | secret | the production M2M application's client id (F7) |
| `AUTH0_PROD_M2M_CLIENT_SECRET` | secret | its client secret |
| `DATABASE_URL_PROD` | secret | the F6 direct URL (read-only use: `migrate status`) |

(`VITE_APP_ENV=production` is fixed in the workflow.)

### F9. First image

Push any commit to `main` (or re-run the latest `CI` run): the `publish` job now pushes
`<AR_IMAGE>:<sha>`. Check the run summary shows a digest, and the staging `smoke` job shows the steps
`Wait for staging to serve this commit` and `Staging API smoke (commit verified)` passing. Record the
repository size (Artifact Registry → `si`) and the free allowance you checked it against (AC3).

### F10. First release, rollback and roll-forward (AC31)

1. Actions → **deploy-prod** → Run workflow (no `sha`). The gate names the commit and digest, then the run
   waits for your approval. Approve.
2. Watch: migration check → API deploy (by digest) → revision check → web build → Firebase deploy → API
   smoke (commit + CORS) → web smoke (Firebase headers + commit). The summary is the release record.
3. Run it again with `sha` = the previous release: both go back. Then again with the newer one.
4. If a step fails, the failure table in Spec 15 §6.4 says what is live and what to do.

### F11. D4.d on Cloud Run — the go-live gate (AC28)

Production is not used until this holds. Send a request with forged headers:

```bash
curl -s -H 'X-Forwarded-For: 203.0.113.9' -H 'CF-Connecting-IP: 203.0.113.10' "$(terraform -chdir=infra output -raw api_origin)/healthz"
```

In Cloud Logging (Cloud Run → `si-api` → Logs), the matching `request completed` line's `client_ip` must be
**your real public IP**: not `203.0.113.9` or `203.0.113.10`, not a `10.x` / `169.254.x` / Google address.
Write the observed socket (`remoteAddress` on `incoming request`) and the `X-Forwarded-For` shape here:

| Observed | Then |
|---|---|
| A private / link-local socket, and the last `X-Forwarded-For` entry is your IP | `CLOUD_RUN_XFF_HOPS = 1` stands (the default) |
| The last two entries are your IP then a Google address | change `CLOUD_RUN_XFF_HOPS` to 2 and its test table, in a PR |
| No entry is reliably yours | the Spec 15 §6.2 fallback: key on the socket (coarse, unforgeable), in a PR |
| A public socket that is you | the rule already keys on the socket; nothing to change |

A `trust_proxy_suspect` warning with `reason: no-xff` or `unknown-proxy` means the assumption broke.

*Recorded at go-live:* (date, socket, header shape, decision)

### F12. Phone check and cold starts

Sign in on your phone at the `web_origin` and log a workout. Then, three times after at least 15 minutes
idle, time the first `curl -s -o /dev/null -w '%{time_total}\n' <api_origin>/healthz`. The target is under
10 seconds; record the three times and the peak memory from Cloud Run → Metrics here (BL-32 owns anything
slower).

*Recorded at go-live:* (three times, peak memory)

### F13. Break-glass (Actions unavailable)

- **API:** Cloud Run console → `si-api` → Edit & deploy new revision → an older image **by digest** from
  Artifact Registry.
- **Web:** `pnpm --filter @sin/web exec firebase hosting:rollback --project <project-id>`.

Record what you did; the next `deploy-prod` puts both back on the pipeline.

---

## Done when

- The Render service is live and B4's `prisma migrate deploy` applied every migration folder to Neon (`prisma migrate status` → up to date).
- B5's `seed:catalog` reported `inserted` > 0 on first run and `unchanged` on a re-run.
- B6 a–c succeeded and d failed: the DB connection verifies Neon's certificate and hostname.
- The CI `smoke` job passes end to end against your Auth0 tenant.
- `render.yaml` is the source of truth — no manual service config drift.

Production is Part F (Spec 15).

Metrics and traces (Spec 13.0) are off on a first deploy. Turning them on, the local Grafana stack and Grafana
Cloud are in [`observability.md`](observability.md).

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Service won't boot, log says `Invalid configuration: AUTH0_ISSUER: must be https in production` | `NODE_ENV=production` + an `http://` issuer, or a missing trailing slash. |
| Boot fails on `WEB_ORIGIN` | Empty, `http://` in prod, has a path, or a wildcard. Use a bare `https://host[:port]`. |
| B4 `prisma migrate deploy` hangs or `P1001 can't reach database` | Used the Neon **pooled** host (`-pooler`) — switch to the direct host. Or the Neon compute is resuming from idle; re-run. |
| B4 fails `P1011`/TLS | `?sslmode=require` missing from the URL you passed. If it *is* there and you also have `sslaccept=strict`, the server certificate or hostname failed verification — run B6a to see the chain OpenSSL sees. |
| Boot fails: `DATABASE_URL: sslmode=verify-full is not supported by Prisma's engine` | You used libpq's mode. Prisma would silently downgrade it to `prefer`, so the app refuses it. Use `sslmode=require&sslaccept=strict` (B1). |
| B6 `openssl s_client` prints `Verify return code` ≠ 0 | Neon's chain isn't trusted by your local root store — usually a stale OS or a corporate TLS proxy. Try B6c (the image's own `ca-certificates`) before assuming Neon changed CAs. |
| B6d (negative control) *succeeds*, or fails with `Endpoint ID is not specified` | Strict mode is not validating (the endpoint-ID error is Neon replying at the Postgres protocol level, which only happens after a TLS handshake that should have been rejected). Check the URL actually carries `sslaccept=strict` (not `sslmode=strict`), and whether Prisma was upgraded since this was verified (6.19.x) — a major bump could change the `sslaccept` semantics. Do not deploy. |
| `GET /v1/personal-records` is empty on staging for a user who has finished workouts | B5a was skipped (rows exist only for workouts finished after the 07.0 deploy, plus exercises later touched). Run `records:rebuild`. |
| B5 `seed aborted: … changed an identifying field` | A live `catalog_key`'s `name`/`modality` was edited in `exercises.json`. Append-only: restore the old entry, mark it `"retired": true`, and add the new one under a new key. |
| B5 `seed aborted: … unknown primaryMuscleId` (or equipment) | The code isn't in `muscle-groups.json` / `equipment.json`. Add it there first. Codes are immutable once shipped. |
| `GET /v1/exercises` returns `[]` on staging | B5 was skipped — run the seed. |
| B5 seed fails: `relation "X" does not exist` (`code: 42P01`) | B4 was skipped, or `DATABASE_URL` points at a different Neon branch than the one B4 was run against. Run `prisma migrate status` first to confirm, then B4. |
| `prisma migrate status` / `migrate deploy` prints a `Datasource` host containing `-pooler` | You exported the **pooled** connection string. `migrate status` will still report correctly, but `migrate deploy` needs the **direct** host — pooled connections (PgBouncer transaction mode) don't support the advisory locks Prisma migrate uses. Drop `-pooler` from the host, or toggle pooling off in Neon's Connection Details, and re-export `DATABASE_URL`. |
| Boot crash: `@prisma/client did not initialize yet. Please run "prisma generate"` | The runtime image has no generated client. Fixed in `Dockerfile` — the runtime stage runs `pnpm --filter @sin/api exec prisma generate` explicitly (`@prisma/client`'s postinstall can't find the schema in a pnpm monorepo). Don't remove that line. |
| Boot/query: `libssl`/`libquery_engine` load error, or `prisma:warn Prisma failed to detect the libssl/openssl version` | `node:22-slim` ships without `openssl`. Fixed in `Dockerfile` base stage (`apt-get install openssl ca-certificates`). |
| Render rollout stuck / unhealthy | `/healthz` isn't 200 — check the image actually started (`CMD` runs `node apps/api/dist/main.js`) and `PORT` is being read. |
| Smoke: `/readyz` → 503 | DB unreachable from the running service. Check `DATABASE_URL` on the service = the Neon string, and that the Neon project isn't disabled. A cold Neon compute can 503 the very first hit then recover. |
| Smoke: `/v1/_authcheck` → 401 instead of 200 | Wrong `AUTH0_AUDIENCE`/`AUTH0_ISSUER` on the service vs the tenant, or the M2M app isn't authorized for the API. |
| Smoke: `/v1/me` → **500** (first three checks pass) | The `user` table doesn't exist — **B4 migration not applied**, or applied to a different Neon branch/database than Render's `DATABASE_URL`. Re-run B4 with the exact string from Render's Environment. |
| Smoke: `/v1/me` → 200 instead of 401 | The Action is putting `email` on **M2M** tokens too (it should only run on the Login flow, not client-credentials), or the namespace differs between the Action and `AUTH0_CLAIM_NAMESPACE`. |
| Smoke: grant returns 401 `Unauthorized` | Bad/stale `AUTH0_STAGING_M2M_CLIENT_ID`/`SECRET` (e.g. from an old Test App after recreating the API). |
| Smoke: grant returns 403 `access_denied: Service not enabled within domain: <aud>` | No API in the tenant has that exact Identifier — typo, trailing slash, or wrong subdomain. The Identifier is immutable; recreate the API to match `AUTH0_AUDIENCE`. |
| Smoke: grant returns 403 `Client is not authorized to access …` | The M2M app isn't authorized for the API — API → **Application Access** tab, toggle the app on. |
| A tester's login shows "account deleted" | The account is inside the grace window. Restore it (the `UPDATE` above) or wait for the purge, after which the same login starts a fresh account. |
