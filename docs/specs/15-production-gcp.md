# Spec 15 — Production on Google Cloud (free tier)

**Status:** Implemented 2026-10-24 (PR pending); go-live (AC28–AC31) pending the owner's runbook Part F, and `infra/prod.tfvars` holds `REPLACE_ME_*` placeholders until then (owner decision 2026-10-24). Draft 2026-10-23. Design approved by the owner on 2026-10-23 (brief: `docs/superpowers/specs/2026-10-23-gcp-production-deploy-design.md`, kept locally — `docs/superpowers/specs/` is git-ignored; its decisions are restated in §12).
**Kind:** infra / CI-CD (+ two small API changes: the commit marker on `/healthz` and the client-address rule for Cloud Run; plus one line of web build config, the commit stamp source — §12 D17)
**Depends on:** Spec 01 (the API image, `render.yaml`, `scripts/smoke.ts`, the staging `smoke` job), Spec 01.1 (superseded for production; its gate / approval / concurrency / digest / rollback design is reused here), Spec 04.0 (the static-site headers and CSP this spec ports; `assert-render-yaml.mjs`), Spec 05.2 (`clientAddress()`, runbook D4.d), Spec 06.3 (`<meta name="sin-commit">`, `wait-for-commit.mjs`), Spec 13.0 (telemetry stays off in production).
**Consumed by:** every later spec that ships to production (they inherit `deploy-prod` unchanged). Nothing else.
**Design refs:** DESIGN.md §3.3 (Environments), §7 (CD rows, Secrets / config, Backups), §9 (Phase 2 row); CLAUDE.md "Infrastructure", "Image + action pins", "`DATABASE_URL`", "Rate limits (Spec 05.2)", "Prisma migrations"; runbook `first-deploy.md` Part B (Neon), D4.d, Part E (replaced).

> This spec supersedes the Render-based [Spec 01.1](01.1-prod-deploy-pipeline.md) for production and replaces the README's "Spec 15 — AWS migration (phase 2)" row. Staging stays on Render exactly as it is.

---

## 1. Purpose, scope & non-goals

The owner is the only user and trains with a phone. Staging on Render's free plan sleeps when idle, and the first request after a quiet spell can take close to a minute. That is the moment the app is needed. Production must be there when opened (at worst a few seconds to wake), cost nothing per month, and run what passed staging, released by one deliberate, approved action.

> **First-principles note — "scale to zero".** Cloud Run starts a container when a request arrives and stops it a few minutes after the last one. While it is stopped it costs nothing and there is nothing to maintain; the price is a **cold start** (the container boots, Prisma connects to Neon, then the request is answered), a few seconds instead of Render's near-minute. `max-instances 1` makes the worst case a single container, so a bug or a traffic spike cannot run up a bill.

> **First-principles note — "keyless CI login" (Workload Identity Federation).** GitHub Actions can present a short-lived signed token that says "this is workflow X of repo Y, running for ref Z". Google can be told to trust tokens from that issuer for that repo and to exchange them for a short-lived access token of a named service account. No long-lived key file exists, so there is nothing to leak or rotate. The trust condition can name the branch or the GitHub Environment, which is how the approval gate also guards the cloud credentials (§6.4).

> **First-principles note — "what Terraform does here".** Terraform is a program that reads `.tf` files describing the cloud resources you want and makes the real project match them. It keeps a **state file** (its memory of what it created) in a Cloud Storage bucket. It is run by hand from the owner's machine in this spec; CI only checks that the files are well formed. The deploy workflow changes only the running *image* of the Cloud Run service, which Terraform is told to ignore after creation, so the two never fight.

### In scope

- `infra/` (Terraform): Cloud Run service, Artifact Registry repository with a cleanup policy, Secret Manager secret container, Firebase Hosting site, Workload Identity Federation with a publisher and a deployer service account, a runtime service account, a $1 budget alert, enabled APIs; state in a Cloud Storage bucket; provider and Terraform versions pinned.
- CI: a `publish` job (API image to Artifact Registry on every merge to `main`), an `infra` check job, the staging commit wait + commit-checked smoke, the Firebase header parity check.
- `.github/workflows/deploy-prod.yml`: gate, approval, migration check, deploy by digest, web rebuild and Firebase deploy, production smokes, rollback by redeploying an older commit.
- API: a `commit` field on `/healthz`; `CLIENT_IP_SOURCE` and the Cloud Run client-address rule.
- Web tooling: the commit stamp also reads `SIN_COMMIT`; `apps/web/firebase.json`; the web smoke gains a Firebase mode.
- Runbook: a production part in `docs/runbooks/first-deploy.md` (Neon project, Auth0 application, first apply, first migrate + seed + rebuild, D4.d).

### Non-goals

- Paid always-on hosting, Cloud SQL / RDS, load balancers, multi-region, VPC connectors.
- Moving staging off Render; any change to staging's behavior beyond publishing the image and the commit wait / check.
- Any app feature change beyond the commit marker and the client-address rule.
- Copying staging's data into production; production starts empty (D9).
- Blue/green, canary, automated database rollback (forward-fix only, Spec 01 §11).
- The eight deferred items (design §7): nightly backups (BL-27), owner-only production (BL-28), uptime check (BL-29), staging / production drift checklist (BL-30), free-tier term watch (BL-31), slow first launch on weak Wi-Fi (BL-32), a separate production Auth0 tenant (BL-33), a custom domain (BL-34).
- Terraform for Auth0 or Neon (hand-configured, drift tracked by BL-30); CI-run `terraform apply` (D13).

---

## 2. Acceptance criteria

Every behavioral criterion gets at least one test naming its number (`describe("15 AC12 — …")`). Infra and pipeline criteria are verified by CI or review (§10). "Production" below means the new Google project; "staging" means Render.

**Terraform and cloud resources**

1. **Terraform layout and pins.** `infra/` is one Terraform root with the backend `gcs` (a versioned, uniform-access, public-access-prevented bucket created by hand per the runbook). `required_version` and every provider version are exact (no `~>`, `>=`, ranges); `.terraform.lock.hcl` is committed; `.terraform/`, `*.tfstate*` and `*.tfplan` are git-ignored. A CI job `infra` runs `terraform fmt -check -recursive`, `terraform init -backend=false` and `terraform validate` on every PR that touches `infra/**`, with Terraform installed by a SHA-pinned action at the exact version.
2. **Cloud Run service.** `google_cloud_run_v2_service` `si-api` in `us-central1`: `min_instance_count = 0`, `max_instance_count = 1`, request-based CPU billing with startup CPU boost, a startup probe and a liveness probe on `/healthz`, ingress open to the internet, `allUsers` as invoker (the API is public and authenticates with Auth0 JWTs), no VPC connector, no load balancer, its own runtime service account. Env: `NODE_ENV=production`, `AUTH0_ISSUER`, `AUTH0_AUDIENCE`, `AUTH0_CLAIM_NAMESPACE`, `WEB_ORIGIN` (the Firebase origin), `LOG_LEVEL=info`, `CLIENT_IP_SOURCE=cloud-run`, `DATABASE_URL` from Secret Manager; **no `OTEL_*`** (telemetry off, Spec 13.0). CPU, memory, concurrency and timeout are those of §6.1. `lifecycle.ignore_changes` covers the container image, so the deploy workflow owns the image and `terraform plan` shows no image diff after a release. The initial image is Google's sample container pinned by digest.
3. **Artifact Registry.** One Docker repository in `us-central1` with a cleanup policy that keeps the 5 most recent tagged versions and deletes untagged versions older than 7 days. The runbook records the repository size after the first publish and states the free allowance it was checked against.
4. **Secrets.** Terraform creates the Secret Manager secret `si-database-url` as an empty container; its value is added by hand (`gcloud secrets versions add`), so no secret value is ever in a `.tf` file, a variable file or the state. The runtime service account has `secretmanager.secretAccessor` on that secret only. No `google_service_account_key` resource exists.
5. **Firebase Hosting.** A Firebase Hosting site in the same project, with a fixed site id, so its origin `https://<site>.web.app` is known before the first deploy. `infra/prod.tfvars` (committed, no secrets) holds every identifier that appears in more than one place: project id and number, region, service name, site id, Auth0 domain. The Cloud Run deterministic origin and the Hosting origin derived from it equal what `terraform output` reports after the first apply.
6. **Keyless CI identity.** One Workload Identity pool and GitHub OIDC provider whose attribute condition accepts only this repository, by name and by numeric `repository_id` (`github_repository_id` in `infra/prod.tfvars`, public; re-check it if the repository is ever transferred or re-created) (#165). Two service accounts: **publisher** (`artifactregistry.writer`; impersonable only by workflows running for `refs/heads/main`) and **deployer** (`run.developer` on the service, `iam.serviceAccountUser` on the runtime account, `artifactregistry.reader`, the Firebase Hosting deploy role; impersonable only by jobs in the GitHub Environment `production`). No service-account keys, no stored Google credentials in GitHub.
7. **Budget.** A Cloud Billing budget of $1 per month on the project's billing account with email alerts at 50 %, 90 % and 100 % of actual spend to the billing admins.
8. **Free tier only.** A unit test over `infra/**/*.tf` allows only an explicit list of resource types; any `google_compute_*`, `google_sql_*`, `google_vpc_access_*`, load-balancer, or other type outside the list fails it, as does any `min_instance_count` other than 0 or `max_instance_count` other than 1.
9. **Hygiene scan.** A unit test fails on: a workflow `uses:` not pinned to a 40-hex commit SHA (all workflows); `npx` anywhere in `.github/`, `infra/`, `apps/*/scripts`, `docs/runbooks`; a tracked `*.tfstate*`, `*.tfplan`, `*.tfvars` other than `infra/prod.tfvars`, `*.pem`, or a service-account key (`"private_key"`); `infra/prod.tfvars` containing a key whose name matches `secret|password|token|key`; any workflow trigger other than `push`, `pull_request` and `workflow_dispatch` (`pull_request_target`, `workflow_run`, `issue_comment` and the other repository-event triggers run with main's ref, which the publisher binding trusts, while someone outside can start them — #166).

**Image publish and the commit marker**

10. **Publish on merge.** On a push to `main`, after `check`, `web`, `integration` and `docker` pass, a `publish` job (permissions `contents: read`, `id-token: write`) authenticates as the publisher and pushes the image built from the existing `Dockerfile` to Artifact Registry tagged with the full 40-character commit SHA, passing `--build-arg GIT_COMMIT=<sha>`. It writes the image digest to the run summary. It does not run on pull requests (the `docker` job still builds there, unchanged). The `smoke` and `e2e` jobs and Render's deploy are unchanged.
11. **API commit marker.** `GET /healthz` answers `200 {"status":"ok","commit":"<value>"}`. The value is `SIN_COMMIT` (the build arg baked into the image as an env var), else `RENDER_GIT_COMMIT`, else `"dev"`; any value that is not 40 lowercase hex characters is reported as `"dev"`. The route stays unauthenticated, makes no DB call, keeps `skipRateLimit` and stays unpublished in `/openapi.json`. No other response changes.
12. **Staging smoke checks the marker.** The `smoke` job gains, before the API smoke, a step named `Wait for staging to serve this commit` (a new script, `apps/api/scripts/wait-for-api-commit.ts`) that polls staging's `/healthz` until `commit` equals the pushed SHA, bounded at 15 minutes (failure after that). If staging already serves a descendant of the SHA (a later push deployed first) it exits 0 with `superseded=true`. The API smoke step, named `Staging API smoke (commit verified)`, runs only when not superseded. A staging deploy that never serves the commit therefore turns `main` red.

**The release gate**

13. **Trigger and ref.** `deploy-prod` runs only on `workflow_dispatch` with an optional `sha` input, and only when the workflow itself is the one on `refs/heads/main`. With no input it resolves to the newest commit (from the last 30 completed `CI` push runs on `main`) that satisfies AC14; with an input it checks that commit.
14. **Gate conditions.** A resolved commit passes only if all hold: (a) its image exists in Artifact Registry and its digest resolves; (b) its `CI` run's job `post-deploy smoke (staging)` has the step `Staging API smoke (commit verified)` with conclusion `success` (a skipped step, i.e. superseded, does not count); (c) it is reachable from `main`. Otherwise the run fails in the gate job naming the unmet condition, before any approval prompt. The decision logic is a pure function with unit tests (`apps/api/scripts/release-gate.ts`).
15. **No unapplied migrations.** After approval and before anything is deployed, the first step of the `deploy` job checks out the target commit and runs the repo-pinned `prisma migrate status` against production (the `DATABASE_URL_PROD` Environment secret, the Neon direct URL, read-only). The run fails there if the repository at that commit holds a migration the production database has not applied, if a migration is failed, or if the database cannot be reached. A database that is *ahead* of the commit (extra applied migrations, as in a rollback) passes. The parsing of the status output is a pure function with unit tests over captured output for: up to date, pending, failed, database ahead. The workflow never runs a migration.
16. **Approval.** The deploy job is bound to the GitHub Environment `production`: the owner is the required reviewer; deployments are restricted to `main`; the Environment holds every production variable and secret (§8). Nothing outside the gate's read-only steps touches Google Cloud or the production database before approval.
17. **One at a time.** The workflow has `concurrency: { group: deploy-prod, cancel-in-progress: false }`.

**Deploy and verify**

18. **API by digest.** The deployer deploys the exact image **digest** the gate resolved to the Cloud Run service (never a tag). After the deploy, the service's latest ready revision serves 100 % of traffic and its image digest equals the gate's; a revision that fails its startup probe never receives traffic, so the previous revision keeps serving and the run fails.
19. **Web from the same commit.** The deploy job builds `@sin/core` and `@sin/web` from the same checkout with the production `VITE_*` values from the Environment (`VITE_API_BASE_URL`, `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`, `VITE_APP_ENV=production`) and `SIN_COMMIT=<sha>`; runs `assert-build-output.mjs`; fails if the `dist` contains `onrender.com`; then deploys it to Firebase Hosting with the pinned `firebase-tools` run through `pnpm exec` (a dev dependency of `@sin/web`), authenticated by the deployer. The API deploy runs first (API one release ahead, DESIGN §6).
20. **Production verify.** After both deploys: `apps/api/scripts/smoke.ts` runs against the production API with the production M2M client and `EXPECT_COMMIT=<sha>`; `apps/web/scripts/smoke.mjs` runs against the Hosting origin in Firebase mode with the same expected commit. Both fail if the reported commit is not the deployed one. The API smoke also sends a CORS preflight with `Origin` set to the web origin and fails unless the response allows exactly that origin. Any failure turns the run red; the run summary records the SHA, digest, revision name, approver and result.
21. **Rollback.** Dispatching `deploy-prod` with an older `sha` goes through the same gate and approval and redeploys both the API and the web to that commit. A commit whose image the cleanup policy has deleted fails the gate with a message that says so (D8); the `deploy` job re-checks the digest right after approval, so an image removed during the wait fails there with the same reason, before the API deploy (#164).

**Hosting parity**

22. **Firebase config parity.** `apps/web/firebase.json` serves `dist`, rewrites `**` to `/index.html`, and sets the same response headers as the `si-web-staging` block of `render.yaml` (Content-Security-Policy, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, immutable caching on `/assets/**`), plus revalidation on everything else (D10). A check in the CI `web` job (`apps/web/scripts/assert-firebase-json.mjs`) parses both files and fails unless: the header names, paths and values match; the CSPs are identical directive by directive once the staging API origin is replaced by the production API origin from `infra/prod.tfvars` (the Auth0 domain is the same); the production CSP's `connect-src` names exactly `'self'`, that API origin and the Auth0 domain; and no `unsafe-inline`, `unsafe-eval` or `blob:` appears. The existing `assert-render-yaml.mjs` stays and passes unchanged.
23. **Live headers.** The web smoke in Firebase mode checks the live Hosting site: `GET /` carries the CSP from `firebase.json` (normalized like today), `nosniff`, `no-referrer`, and a revalidating `Cache-Control` (not a max-age); an `/assets/…` file carries the immutable `Cache-Control`; `GET /app` is `text/html` with `<div id="root">` (SPA rewrite); `/manifest.webmanifest` is the manifest, not the rewrite; and `<meta name="sin-commit">` equals `WEB_SMOKE_EXPECT_COMMIT` when given.
24. **Origins agree.** The API's `WEB_ORIGIN` (Terraform), the CSP `connect-src` (`firebase.json`), `VITE_API_BASE_URL` and `PROD_API_BASE_URL` (Environment variables) and the Auth0 production application's callback, logout and web-origin URLs all derive from `infra/prod.tfvars`; a unit test over `infra/`, `firebase.json` and the runbook's variable table fails if one of them names another origin. (The Auth0 console itself is checked by hand, AC30.)

**Client address**

25. **Config switch.** `CLIENT_IP_SOURCE` is `render` (default) or `cloud-run`; any other value fails boot with a `ConfigError`. With `render` (or unset) `clientAddress()` behaves byte-for-byte as before: the existing `rate-limit-*` unit tests pass unmodified. `render.yaml` is not edited.
26. **Cloud Run rule.** With `cloud-run`, `clientAddress()` returns the socket address when the socket is not private / loopback / link-local; otherwise the right-most valid IP in `X-Forwarded-For` counted by the named constant `CLOUD_RUN_XFF_HOPS` (§6.2); `CF-Connecting-IP` is never read; an absent, empty or unparseable list falls back to the socket. A table test pins: a forged left-hand `X-Forwarded-For` entry is ignored; a forged `CF-Connecting-IP` is ignored; a public socket is itself; IPv6 and IPv4-mapped forms are normalized as today.
27. **Tripwire.** In `cloud-run` mode, `trust_proxy_suspect` is warned once per process when a request from a private socket has no usable `X-Forwarded-For` (`reason: no-xff`) or from a public socket carries one (`reason: unknown-proxy`); health probes never spend the warning (no header, no count). The Render-mode tripwire tests pass unmodified.
28. **Production measurement (go-live gate).** Runbook D4.d is re-run against production with forged `X-Forwarded-For` and `CF-Connecting-IP` headers before the first real use: the `request completed` line's `client_ip` is the caller's real public IP, none of the forged values, and not a Google or link-local address. The observed socket and header shape are written into the runbook and justify the value of `CLOUD_RUN_XFF_HOPS`. If they do not support the rule, production does not go live until §6.2's fallback is applied.

**Production data and identity**

29. **Production starts empty.** No data is copied from staging. Before the first `deploy-prod`, by hand per the runbook with the Neon direct URL: `pnpm run db:migrate:deploy` (then `db:migrate:status` reports up to date), `pnpm --filter @sin/api run seed:catalog` (reports `inserted` > 0, a re-run `unchanged`), `pnpm --filter @sin/api run records:rebuild` (a no-op on an empty database, run so the step is rehearsed). The stored production `DATABASE_URL` carries `sslmode=require` and `sslaccept=strict`; runbook B6 (certificate and hostname verification) passes against the production database.
30. **Auth0.** The existing tenant gets a new production SPA application (callback, logout and web-origin URLs = the Hosting origin; refresh-token rotation as staging's) and a new production M2M application for the smoke, authorized for the existing API (audience `https://api.strengthinnumbers.app`, unchanged). The runtime issuer / audience / namespace are the staging values. The M2M secret exists only in the GitHub Environment.
31. **First release rehearsal.** The first `deploy-prod` run is observed end to end: gate passes, the run waits for approval, the migration check passes, deploy and both smokes pass, then a second run with the previous commit rolls back and passes (AC21), and a third rolls forward. A phone sign-in on the Hosting origin works and a workout can be logged; three cold starts (production idle for at least 15 minutes) are timed and recorded in the runbook with the target "first `/healthz` under 10 seconds" (BL-32 owns anything slower).

**Cross-cutting**

32. **Staging unchanged.** The diff touches `render.yaml` not at all and changes staging only through: the `publish` job's existence, the `/healthz` field, the wait step and the commit-checked smoke step. The existing staging `smoke`, `e2e` and Render deploy pass as before.
33. **Docs.** DESIGN.md, `docs/specs/README.md`, CLAUDE.md, the runbook and the amended specs carry the edits of §11; the release order (§11) is stated in the PR description.

---

## 3. Dependencies & exposed interface

### Needs

- **Spec 01 / 04.0 / 06.3:** the Dockerfile, `scripts/smoke.ts`, `scripts/smoke.mjs`, `assert-build-output.mjs`, `assert-render-yaml.mjs`, the `sin-commit` meta and `wait-for-commit.mjs` (whose superseded rule the new API wait copies).
- **Spec 05.2:** `clientAddress()`, `trustProxyTripwire()`, `isPrivateAddress()`, runbook D4.d.
- **External:** a Google Cloud project with billing linked (created by hand), the Firebase product enabled on it (Terraform), a Neon free project (hand-made, runbook), the Auth0 tenant `dev-gncuqvfir0wv0t4l`, a GitHub Environment `production`.
- **Tools (all pinned):** Terraform (exact version in `required_version` and in the `infra` job), `google-github-actions/auth` and `setup-gcloud`, `docker/login-action` and `docker/build-push-action` (all SHA-pinned), `firebase-tools` (a pinned dev dependency of `@sin/web`, run through `pnpm exec`; never `npx`).

### Provides — stable surface

- **`deploy-prod`** (`workflow_dispatch`, optional `sha`): the one way production ships. Later specs inherit it. A spec that adds a Cloud Run setting adds it to `infra/` and applies it by hand.
- **The image convention:** one image per `main` commit in Artifact Registry, tagged with the full SHA, digest recorded; the production deploy is by digest.
- **`GET /healthz` → `{status, commit}`:** the commit marker. The staging wait, the gate and the production verify all rely on it; renaming `commit` is breaking.
- **`CLIENT_IP_SOURCE`** (`render` | `cloud-run`) and the rule it selects (§6.2).
- **`apps/api/scripts/release-gate.ts`** (pure decision functions) and `wait-for-api-commit.ts`.
- **`infra/prod.tfvars`:** the single committed source of the production identifiers and origins.
- **The GitHub Environment `production` variable / secret names** (§8): the contract the runbook and any future production check (BL-29) use.

---

## 4. Data model

No tables and no migration. Behavior only:

- **Migrations stay a manual release step** (CLAUDE.md): `DATABASE_URL='<prod neon direct url>' pnpm run db:migrate:deploy` before the release that needs it. The workflow reads (`migrate status`, AC15) and never writes. Expand-only (CLAUDE.md) means the previous commit still works against a database that has the next migration, so a rollback needs no schema change.
- Production starts with an empty database (D9): the first three commands are AC29.

---

## 5. API surface

One response change and no new route.

- `GET /healthz` — `200 { "status": "ok", "commit": "<40 hex | dev>" }` (was `{ "status": "ok" }`). Unauthenticated, no DB, `skipRateLimit`, not in `/openapi.json`. `/readyz` is unchanged.
- No request, no other response and no problem type changes. `CORS_METHODS` is unchanged. The OpenAPI document does not change (the CI drift step stays green without a regenerated file).

---

## 6. Behavior & logic

### 6.1 Cloud Run settings (builder calls, §12 D12)

| Setting | Value | Why |
|---|---|---|
| CPU / memory | 1 vCPU / 512 MiB | Node 22 + Prisma's query engine do not reliably boot in 256 MiB; 512 MiB is the smallest size we expect to be safe. Confirmed at the first deploy (peak memory from the Cloud Run metrics, recorded in the runbook); lowered only with evidence. |
| Concurrency | 20 | One user; a request is short. Prisma's pool is `connection_limit=8` (CLAUDE.md), so more than ~20 simultaneous requests would queue on the pool anyway. |
| Request timeout | 60 s | The slowest route (export) finishes in seconds; a hung request must not hold the instance. |
| CPU allocation | request-based, startup CPU boost on | Free tier counts request time only; boost shortens the cold start. |
| Probes | startup: `GET /healthz`, period 2 s, failure threshold 15; liveness: `GET /healthz`, period 30 s | `/healthz` needs no DB, so a Neon wake-up cannot fail the startup probe. |
| Scaling | min 0, max 1 | Decision 6 and decision 1. |
| `PORT` | injected by Cloud Run; not set in Terraform | The API reads `PORT` and binds `0.0.0.0` already. |

Cold-start sequence: request → container start (boot, config parse, Prisma client load) → the first query wakes Neon if it autosuspended (adds under a second) → response. Auth0 is a separate hop on the browser's side and is BL-32.

### 6.2 Client address on Cloud Run

`clientAddress()` today (Render): the socket when it is public, else `CF-Connecting-IP` when valid, else the socket; `X-Forwarded-For` is never read. On Cloud Run the socket peer is Google's front end, which we expect to be a private / link-local address (so Render's rule would take `CF-Connecting-IP` from the client, which nobody sets for us: any client could forge it and choose its rate-limit key and its logged `client_ip`).

Rule for `CLIENT_IP_SOURCE=cloud-run`, applied in this order:

1. Socket not private / loopback / link-local: it is the client (as today).
2. Otherwise, parse `X-Forwarded-For` as a comma list; the Google front end **appends** the address that connected to it, so the entries to its left are client-controlled and the entry it added is on the right. Take the entry `CLOUD_RUN_XFF_HOPS` positions from the right (value 1 = the right-most) if it is a valid IP.
3. Otherwise the socket.

`CF-Connecting-IP` is not read in this mode. `X-Forwarded-For` is read only in this mode and only behind a non-public socket.

`CLOUD_RUN_XFF_HOPS = 1` is the working assumption for a request that reaches a `*.run.app` URL directly (no load balancer in front, by decision 1). **It is an assumption until AC28 measures it**; if Cloud Run appends two entries, the constant becomes 2 and the unit table changes with it. **Fallback if the measurement shows no entry can be trusted:** key on the socket, which is coarse (every user shares one bucket, 600/min, which is one owner) but cannot be forged. The runbook records which case held.

### 6.3 The commit marker, end to end

```
CI (merge to main, commit X)
  ├─ publish: docker build --build-arg GIT_COMMIT=X  →  AR  api:X  (digest D)
  └─ Render builds X (RENDER_GIT_COMMIT=X)  →  staging /healthz {commit: X}
smoke job: wait-for-api-commit(X) ── ok ──► "Staging API smoke (commit verified)" ✔
   (a descendant of X already live → superseded, step skipped)

deploy-prod(X): gate ─ image X exists? ─ that step ✔? ─ on main?
   └─ approval ─ migration check ─ deploy api@D ─ build web(X) → Firebase
        └─ verify: prod /healthz commit == X ; prod <meta sin-commit> == X
```

The Dockerfile takes `ARG GIT_COMMIT` in the runtime stage's last layer and sets `ENV SIN_COMMIT=$GIT_COMMIT`, so the argument does not invalidate earlier layers. Render's own build passes no argument; there the value comes from `RENDER_GIT_COMMIT` at runtime (confirmed on staging at implementation). The marker is a property of the image: a production rollback to an older digest reports the older commit with no environment edit.

### 6.4 The workflow

```
on: workflow_dispatch (input: sha, optional)
concurrency: deploy-prod, no cancel
jobs:
  gate     (no environment; contents: read, actions: read, id-token: write)
    - refuse unless ref is main
    - resolve sha (input, or newest verified of the last 30 CI push runs on main)
    - auth as publisher (WIF) ; image exists → digest ; staging step check ; on main
    - outputs: sha, digest
  deploy   (needs gate; environment: production  ← pauses for the reviewer)
    - checkout sha ; pnpm install --frozen-lockfile
    - migration check (prisma migrate status vs DATABASE_URL_PROD)
    - auth as deployer (WIF; subject = this Environment)
    - gcloud run deploy si-api --image <repo>/api@<digest> ; assert revision + digest
    - build core + web (production VITE_*, SIN_COMMIT=sha) ; assert-build-output ; no "onrender.com"
    - pnpm --filter @sin/web exec firebase deploy --only hosting --project <id>
    - API smoke (EXPECT_COMMIT, CORS preflight) ; web smoke (Firebase mode, commit)
    - run summary
```

Failure table:

| Failure | State | Action |
|---|---|---|
| Gate refuses | Nothing touched | Read the named condition; fix on staging or pick another commit. |
| Reviewer rejects | Nothing touched | None. |
| Migration check fails | Nothing deployed | Run the migration by hand (runbook), re-dispatch. |
| Cloud Run revision fails startup | Previous revision still serves | Read the revision log; fix forward. |
| Firebase deploy fails after the API deploy | New API, old web (the supported order) | Re-dispatch the same SHA, or roll back. |
| A smoke fails after both deploys | New code is live and failing | Dispatch the last good SHA (AC21); forward-fix any migration cause. |

The workflow resolves the commit once in `gate`; `deploy` uses only the gate's outputs, never a re-resolved value.

### 6.5 Why the migration check sits after approval

A job can read an Environment's secrets only if it is bound to that Environment, and a bound job waits for approval. The production database URL is an Environment secret (so a pull request or an unapproved run can never read it), so the check cannot run in `gate`. It is the first step after approval, before any change: the reviewer approves a release, and a pending migration stops it at once without side effects. (D20.)

### 6.6 Firebase Hosting rules

`apps/web/firebase.json`: `hosting.public: "dist"`, `site: "<site id>"`, `rewrites: [{ source: "**", destination: "/index.html" }]`, and a `headers` list built from the `render.yaml` block. Real files win over a rewrite (Hosting serves existing files first), so `/manifest.webmanifest`, icons and `/assets/**` are served as files. Firebase's default caches non-asset files for an hour; that would keep a phone on an old `index.html` after a release, so a `**` rule sets `Cache-Control: public, max-age=0, must-revalidate` (Render's default for static files) and a more specific `/assets/**` rule sets the immutable value. Whether Hosting merges or replaces two rules for one header is verified by AC23 against the live site, not assumed; if it replaces in the wrong order the rules are reordered until the live check passes.

---

## 7. Security & privacy

- **Authorization boundary for production:** the GitHub Environment `production` (required reviewer, `main` only) plus the Workload Identity condition that lets only that Environment impersonate the deployer. A forked or unreviewed workflow cannot obtain a deploy credential or read the database URL.
- **Two service accounts, least privilege.** The publisher can write images and nothing else, and only for `main`. The deployer can update one Cloud Run service, act as the runtime account, read images and deploy Hosting; it cannot change IAM, secrets or Terraform resources. The runtime account can read one secret. Infrastructure changes need the owner's own credentials on their machine.
- **No stored cloud credentials.** No key file anywhere (AC4, AC9); GitHub holds only identifiers and the Auth0 / database secrets.
- **The API is public by design** (`allUsers` invoker) and relies on Auth0 JWT verification and the rate limits, as on Render. Cloud Run's own default URL is the only entry.
- **Client-address spoofing:** AC26–AC28 and §6.2; the rule never reads a header a client can set unless a non-public proxy sits in front, and the measurement is a go-live gate.
- **Commit SHA exposure:** `/healthz` shows a commit hash of a public repository. Not sensitive.
- **Production CSP** is the staging CSP with one origin changed; no relaxation (AC22).
- **Logs:** Cloud Run sends stdout to Cloud Logging; the existing log scrubbing (CLAUDE.md "Validation messages are static", the `err` serializer) is unchanged. The Environment secrets are masked in run logs; the scripts never echo the database URL (`migrate status` output is checked for the URL before it is printed, or its stderr is not echoed).
- **Terraform state** holds no secret value (AC4), but does hold resource ids; the bucket is private, versioned, and uniform-access.
- **Data protection:** production starts empty; no PII passes through the pipeline (the smoke uses an M2M token with no user).

---

## 8. Config & secrets

**New API env (all environments):** `CLIENT_IP_SOURCE` (`render` | `cloud-run`, default `render`), `SIN_COMMIT` (set by the image, not by an operator).

**Cloud Run runtime** (Terraform): as in AC2. `DATABASE_URL` is the Neon connection string with `sslmode=require` and `sslaccept=strict` (CLAUDE.md), in Secret Manager `si-database-url`, added by hand. `AUTH0_ISSUER`, `AUTH0_AUDIENCE` and `AUTH0_CLAIM_NAMESPACE` are public configuration (the same plain values as `render.yaml`'s `api-shared`), so they are Terraform variables, not secrets (D14).

**GitHub, repository level** (non-secret; needed by `publish` and the gate): `GCP_WIF_PROVIDER`, `GCP_PUBLISHER_SA`, `GCP_PROJECT_ID`, `GCP_REGION`, `AR_IMAGE` (the repository path).

**GitHub Environment `production`:**

| Name | Kind | Value |
|---|---|---|
| `GCP_DEPLOYER_SA` | var | deployer service account email |
| `PROD_API_BASE_URL` | var | the Cloud Run origin, no trailing slash |
| `PROD_WEB_BASE_URL` | var | the Hosting origin |
| ~~`FIREBASE_SITE_ID`~~ | — | *(dropped at implementation: no workflow reads it; the site id lives in `apps/web/firebase.json` and `infra/prod.tfvars`)* |
| `VITE_API_BASE_URL` / `VITE_AUTH0_DOMAIN` / `VITE_AUTH0_CLIENT_ID` / `VITE_AUTH0_AUDIENCE` / `VITE_APP_ENV` | vars | production values; `VITE_APP_ENV=production` |
| `AUTH0_PROD_TOKEN_URL` | var | `https://dev-gncuqvfir0wv0t4l.us.auth0.com/oauth/token` |
| `AUTH0_PROD_M2M_CLIENT_ID` / `AUTH0_PROD_M2M_CLIENT_SECRET` | secrets | the production M2M application |
| `DATABASE_URL_PROD` | secret | Neon direct (not `-pooler`) URL with `sslaccept=strict`, for `migrate status` |

`AUTH0_M2M_AUDIENCE` stays a workflow literal (`https://api.strengthinnumbers.app`). Every value that `infra/prod.tfvars` also holds must equal it (AC24).

**Where secrets live:** runtime in Secret Manager; CI in the Environment; nothing in the repository, `render.yaml`, Terraform files or state.

---

## 9. Observability

- **Release log:** the `deploy-prod` run summary (SHA, digest, revision, approver, smoke result) is the release record; GitHub's failed-run notification is the failure signal (same as 01.1; richer alerting is Spec 13).
- **API:** the existing structured logs, now in Cloud Logging. Pino's numeric levels are not mapped to Cloud Logging severity, so every line shows as default severity (readable, not filterable by level); accepted for v1. `client_ip` on `request completed` is what AC28 reads. Telemetry (Spec 13.0) is off in production (no `OTEL_*`); turning it on is a Terraform variable change plus the Spec 13.0 runbook, not in scope.
- **New log line:** `trust_proxy_suspect` gains the reasons `no-xff` and `unknown-proxy` in `cloud-run` mode. No new metric, span attribute or allowlist entry (`telemetry/allowlist.ts`, `views.ts`, `METRIC_NAMES` unchanged).
- **Cost:** the budget email (AC7) is the only cost signal; BL-31 and BL-29 cover the rest.

---

## 10. Testing

Infra spec with a few unit-testable pieces. Order of attack: the pure functions and scans first (AC8, AC9, AC11, AC14, AC15, AC22, AC24, AC25–AC27), then workflow YAML review, then the live first release.

| AC | Level | Verified by |
|---|---|---|
| 1 | CI-pipeline | the `infra` job (fmt, validate) on a PR touching `infra/`; a unit test reads `infra/**/*.tf` and `.terraform.lock.hcl` and fails on a non-exact version or a missing lock file; `git check-ignore` assertions for the ignored patterns |
| 2 | review + unit | PR review of `infra/run.tf` against the AC; unit scan for `min_instance_count`, `max_instance_count`, absence of `OTEL_`, presence of `ignore_changes` on the image; after first apply `terraform plan` shows no changes |
| 3 | review + manual | review of the cleanup policy; runbook records the size after the first publish |
| 4 | unit + review | the AC9 scan (no `google_service_account_key`, no secret values); `terraform state pull | grep` of the secret value is part of the first-apply checklist (expect nothing) |
| 5 | review + manual | `terraform output` compared with `infra/prod.tfvars` after the first apply |
| 6 | review + manual | review of the pool / provider condition and the two bindings; first `publish` run and first `deploy-prod` run succeed; a run from a branch other than `main` is refused by Google (negative check recorded once in the runbook) |
| 7 | manual | budget visible in the console with the three thresholds (screenshot or text in the runbook) |
| 8 | unit | `infra-resources.test.ts` (allowlist of resource types, scaling bounds) |
| 9 | unit | `deploy-pins.test.ts` (SHA pins in all workflows, `npx` scan, tracked-file scan, `prod.tfvars` key-name scan, workflow-trigger allow-list) |
| 10 | CI-pipeline | first merge to `main` after the change: the `publish` job's summary shows the digest; `gcloud artifacts docker images list` shows the tag; a PR run shows no `publish` job |
| 11 | unit | `routes-health` tests: env combinations (`SIN_COMMIT`, `RENDER_GIT_COMMIT`, both, neither, malformed), no DB call, `skipRateLimit`, not in `/openapi.json`; config test for the parse |
| 12 | unit + CI-pipeline | `wait-for-api-commit` unit tests over a fake fetch and a fake `git` (match, never match, superseded); the first `main` run shows the two step names; a deliberate mismatch (run once locally against a wrong SHA) exits non-zero |
| 13 | review + CI-pipeline | workflow review (trigger, ref guard); `release-gate.ts` unit tests for resolution order and the input path |
| 14 | unit | `release-gate.test.ts` table: image missing, step skipped, step failed, step success, not on main, rollback to a retained image, rollback to a deleted image, the newest-of-30 choice |
| 15 | unit + CI-pipeline | `migrate-status.test.ts` over captured outputs (up to date, pending, failed, database ahead, unreachable); the first release run shows the step green; a rehearsal against a branch with a pending migration (once, recorded) shows it red before deploy |
| 16 | review + manual | Environment settings screenshot in the runbook; the run shows "Waiting for review"; no Google call appears in the log before approval except the gate's read-only ones |
| 17 | review | `concurrency` block in the workflow; two quick dispatches, the second queues (once, recorded) |
| 18 | CI-pipeline | the deploy step's assertion output (digest equality, traffic 100 %); a forced bad image (once, recorded) leaves the old revision serving |
| 19 | CI-pipeline | the build steps' output; `assert-build-output.mjs`; the `onrender.com` grep step; the live site loads and signs in |
| 20 | CI-pipeline + unit | green `deploy-prod` run; smoke unit tests for `EXPECT_COMMIT` and the preflight check over a fake server (match, mismatch, wrong `Access-Control-Allow-Origin`) |
| 21 | CI-pipeline | the rollback rehearsal of AC31 |
| 22 | unit + CI-pipeline | `assert-firebase-json.test.ts` (fixtures: matching, a missing header, a changed directive, a wrong `connect-src`, a relaxation) and the `web` job step |
| 23 | CI-pipeline | the web smoke's Firebase mode in the release run; unit tests of its checks over a fake server |
| 24 | unit | `prod-origins.test.ts` over `infra/`, `firebase.json`, the runbook table |
| 25 | unit | `config.test.ts` (accept / reject / default) and the unmodified `rate-limit-*` suites |
| 26 | unit | `rate-limit-client-address.test.ts` table (forged XFF, forged CF header, public socket, empty list, IPv6) |
| 27 | unit | `rate-limit-proxy.test.ts` additions |
| 28 | manual | runbook D4.d production variant, output pasted in the runbook |
| 29 | manual | the three commands' output and the B6 check pasted in the runbook |
| 30 | manual | Auth0 console settings recorded in the runbook; the smoke's token grant works |
| 31 | manual | the rehearsal log in the runbook |
| 32 | review + CI-pipeline | `git diff --stat` shows no `render.yaml`; staging `smoke` / `e2e` green on the merge |
| 33 | review | the §11 edit list applied, README row, 01.1 note |

Unit tests for scripts live in `apps/api/test/unit/` (the scripts are `apps/api/scripts/*.ts`, run with `pnpm --filter @sin/api exec tsx`). Scan tests read the repository from the test file's own location, as the `image-pins` test does. `apps/web/scripts/lib/prod-ids.mjs` (typed by `prod-ids.d.mts`) is the one tfvars parser and origin derivation; the API scripts and tests import it by path (#167).

---

## 11. Deployment & rollback

### Release order

1. **Hand-made prerequisites** (runbook, no code): create the Google project and link billing; create the state bucket; create the Neon project; register the Auth0 production applications; create the GitHub Environment `production`.
2. **Merge this spec's code PR** (API commit marker and client-address rule, the Dockerfile argument, `publish` and `infra` jobs, the smoke and wait scripts, `firebase.json` and its check, `deploy-prod.yml`, `infra/`). Render redeploys staging with the new `/healthz` and `CLIENT_IP_SOURCE` default; the staging smoke now waits for and checks the commit. Verify the first `publish` run and the two step names.
3. **First `terraform apply`** from the owner's machine (runbook): the Cloud Run service starts on the sample image; add the `si-database-url` secret version; set the repository variables and the Environment's.
4. **Production database by hand:** migrate, seed, rebuild (AC29).
5. **First `deploy-prod`** (AC31), then the D4.d measurement (AC28), then the phone check. Production is not used until AC28 holds.

### Rollback

- **Of a bad release:** dispatch `deploy-prod` with the previous commit (AC21). Both the API and the web go back. Within the last 5 retained images this takes a few minutes; older ones need a forward-fix commit.
- **Of this spec itself:** staging is untouched in behavior, so reverting the PR restores today's CI; the Google project can sit idle at no cost (scale to zero, free tier), or be removed with `terraform destroy` by the owner. `CLIENT_IP_SOURCE` unset behaves as before.
- **Database:** forward-fix migration only; never `migrate down` (Spec 01 §11).
- **Break-glass if Actions is unavailable:** the Cloud Run console "Edit & deploy new revision" with an older image digest; the web via the Firebase console's Hosting release history (Roll back), or `firebase hosting:clone <site>:<version-id> <site>:live` *(corrected at implementation: firebase-tools has no `hosting:rollback`)*. Both are recorded in the runbook.

### DESIGN.md / README / CLAUDE.md / doc edits (to be applied at implementation; NOT applied by this draft; verified by AC33)

- **DESIGN §3.3 Environments:** production is Google Cloud (Cloud Run + Firebase Hosting + a separate Neon project), promoted from staging; staging stays on Render. **§7:** the CD (v1) row gains "production: `deploy-prod` (approved, by digest) to Cloud Run and Firebase Hosting, Spec 15"; the CD (phase 2) row ("build image → ECR → ECS") is replaced by a pointer to Spec 15; the Repo row's `infra/` entry reads "Terraform (Spec 15)"; Secrets / config row adds "Secret Manager (production runtime), GitHub Environment `production` (CI)"; Backups row notes production has no backups yet (BL-27). **§9:** the "Phase 2 — AWS migration" row and the milestone mapping line "Phase 2 = 15" become "Production on Google Cloud = 15" (the AWS migration is dropped, not scheduled). **§10:** a new decisions-log entry **Q31 (next free number at implementation; Q30 is reserved by Spec 09.4)** with D1–D11 of §12. Also check §1.5 / §3.2 for the Render-only wording and BL-9's "Spec 15 Neon → AWS cutover" (below).
- **`docs/specs/README.md`:** the row for 15 (done by this draft) and, at approval, a dependency-order sentence: "15 needs 01 / 01.1 (design reused), 04.0 / 06.3 (headers, commit stamp), 05.2 (`clientAddress`); it gates nothing, ships with no migration, and its `/healthz` field and `CLIENT_IP_SOURCE` default leave staging's behavior as is." The ownership list gains "**Production deploy pipeline and `infra/`** — Spec 15; **CSP + web security headers** — Spec 04.0 for `render.yaml`, Spec 15 for `firebase.json` (kept in sync by `assert-firebase-json.mjs`)."
- **CLAUDE.md** (at implementation): *Infrastructure* — add "**Prod:** Google Cloud (Cloud Run `si-api` in `us-central1`, scale to zero, max 1; Firebase Hosting; Neon free; Terraform in `infra/`, applied by hand), released by the `deploy-prod` workflow (Spec 15); runbook `docs/runbooks/first-deploy.md` Part F" and delete "Prod is not set up…" and "Phase 2 (post-M2): migrate off Render to AWS…". *Commands* — add `terraform -chdir=infra fmt|validate` and the production migrate / seed / rebuild lines are the same commands with the production URL. *Rate limits* — add "`CLIENT_IP_SOURCE=cloud-run` selects the Cloud Run rule (right-most `X-Forwarded-For` entry behind a non-public socket, `CF-Connecting-IP` ignored); `render` (the default) is the Cloudflare rule; re-run D4.d after any hosting change". Add a bullet **Production deploy** (Spec 15): `/healthz` carries `commit`; the staging smoke step names `Wait for staging to serve this commit` and `Staging API smoke (commit verified)` are read by the release gate (rename both together); `infra/prod.tfvars` is the one source of production origins; Terraform owns everything except the Cloud Run image (`ignore_changes`); never `terraform apply` from CI; headers in `apps/web/firebase.json` must stay in sync with `render.yaml` (`assert-firebase-json.mjs`). *docs/ map* — unchanged.
- **Specs to annotate:** **01.1** — the Status line (done by this draft); **01** §11 / Part E mentions of a Render production; **04.0** §8.2 — one line that production headers live in `firebase.json` (Spec 15); **05.2** §6.6 / D12 — one line pointing to Spec 15 §6.2 for the Cloud Run rule; **06.3** — the commit stamp also reads `SIN_COMMIT`; **13.0** — production telemetry is off by default (Spec 15).
- **`docs/runbooks/first-deploy.md`:** replace Part E with "Part F — Production on Google Cloud": project and billing, state bucket, `infra/prod.tfvars`, first apply (two commands), secret version, Neon (B1 pattern with its own project), Auth0 production applications, GitHub Environment table (§8), B4 / B5 / B5a / B6 against the production URL, first `deploy-prod`, D4.d production variant (AC28), rollback rehearsal, cold-start timing, break-glass. D4.d gains a "Cloud Run" paragraph.
- **`docs/backlog.md`:** BL-27 – BL-34 (added by this draft). BL-9 ("before the Spec 15 Neon → AWS cutover") loses its Spec 15 trigger: its deadline now attaches to any future move of the database (note it); BL-23 and BL-24 mention "Spec 15" / "Spec 01.1" as owners: BL-23's Terraform `grafana` provider idea now belongs to a later spec, BL-24's production half is BL-29.
- **`.github/dependabot.yml`:** add the `terraform` ecosystem for `/infra` (provider bumps arrive as reviewed PRs, still exact).

---

## 12. Decisions & open questions

Owner decisions are labeled **(owner)**; calls that are the designer's or builder's and may be refined are labeled **(mine)**.

### Resolved (owner-approved 2026-10-23, design doc §2)

- ✅ **D1 — Serverless on Google Cloud (owner).** The API runs on Cloud Run with the staging Docker image's recipe, scaling to zero; the web app on Firebase Hosting. **Rationale:** the owner needs production to answer within seconds from a phone at the gym and to cost nothing; a scale-to-zero container delivers both without a server to maintain. **Rejected:** AWS Lambda (the API would need adapting to a function model); always-free VMs (Oracle, Google e2-micro: a server to patch and keep alive, and Oracle can reclaim idle instances).
- ✅ **D2 — A new Neon free project for production (owner).** Separate from staging. **Rationale:** isolates production data and migrations; same product the runbook already covers.
- ✅ **D3 — Staging stays on Render, unchanged (owner).** Production is promoted from it. **Rationale:** staging works and costs nothing; moving it is not needed for the goal.
- ✅ **D4 — One approved button press per release, of a commit that passed staging (owner).** §6.4.
- ✅ **D5 — Infrastructure is Terraform in `infra/` (owner).** **Rationale:** the setup is reviewable, repeatable, and documents itself.
- ✅ **D6 — Cost guards in v1 (owner):** a $1 budget alert and Cloud Run capped at one instance. **Rationale:** the only way this costs money is a bug or abuse; both guards are cheap.
- ✅ **D7 — Auth0: keep the existing tenant, add a production application (owner).** A separate tenant is BL-33. **Rationale:** one tenant to operate now; the audience is unchanged so tokens and the API need no change.
- ✅ **D8 — No custom domain yet (owner).** The `*.run.app` / `*.web.app` addresses; BL-34 adds a domain.
- ✅ **D9 — Production starts empty (owner).** Staging's data stays on staging; the first deploy migrates, seeds and rebuilds on an empty database (AC29).
- ✅ **D10 — The API image is the same commit rebuilt by CI, not Render's bytes (owner).** Builds are pinned (lockfile, image digests), so a difference is unlikely, and this spec **does not claim byte identity**. The release gate proves "this commit ran on staging" through the commit marker, not "these bytes ran on staging".
- ✅ **D11 — Eight items deferred, each a backlog entry (owner):** BL-27 – BL-34 (see §1 non-goals).

### Resolved — builder calls the design left to me (design doc §8 and §2a; mine, the owner can overrule)

- ✅ **D12 (mine) — Terraform layout and Cloud Run sizing.** One root module with one file per concern (`versions.tf`, `variables.tf`, `apis.tf`, `registry.tf`, `run.tf`, `secrets.tf`, `hosting.tf`, `identity.tf`, `budget.tf`, `outputs.tf`); no child modules (one environment, one consumer). Backend `gcs`, bucket made by hand (a bootstrap config would need its own state, which is the problem it solves). The project and billing link are made by hand so Terraform needs no organization or billing-admin rights. Sizing and probes are §6.1. **Rejected:** Terraform modules, Terraform Cloud, creating the project in Terraform.
- ✅ **D13 (mine) — `terraform apply` is manual, not in CI.** CI runs only `fmt`, `init -backend=false` and `validate`. **Rationale:** a CI identity that can apply Terraform needs broad IAM rights (it can grant itself anything), which is exactly what the least-privilege deployer must not have; infrastructure changes are rare. **Rejected:** apply on merge; a plan-on-PR job with a read-only identity (more moving parts than the value for one project; revisit if infra changes become frequent).
- ✅ **D14 (mine) — Secret Manager holds the database URL only.** Terraform creates the empty container and the value is added by hand, so state never holds it. Auth0 issuer, audience and namespace are plain Terraform variables, because they are public (identical to `render.yaml`'s plain values). The design's phrase "the Auth0 values" in Secret Manager is therefore narrowed to what is actually secret: the M2M secret, which lives only in the GitHub Environment (CI uses it, the runtime does not).
- ✅ **D15 (mine) — Two CI service accounts.** A publisher bound to `main` pushes images; a deployer bound to the Environment `production` deploys. **Rationale:** the credential that can change production is only issued after approval; an image-push credential for `main` cannot deploy anything. **Rejected:** one account for both (a `main` workflow without approval could deploy).
- ✅ **D16 (mine) — Where the image publish lives and how the gate finds its commit.** The `publish` job is in `ci.yml` (it needs the same `needs:` as `smoke` and the repository's CI run is where the gate looks). The gate lists the last 30 completed `CI` push runs on `main` through the GitHub API and reads the named smoke step's conclusion; the step names are a contract (§9, CLAUDE.md edit). **Rationale:** the step conclusion is the only durable, API-readable fact that "staging ran this commit and the smoke passed"; a `superseded` skip is not a success. **Rejected:** a separate publish workflow (a second place to keep `needs:` right); recording the pass in a file or tag (new state to keep honest).
- ✅ **D17 (mine) — The commit marker is a field on `/healthz`, baked in by a build argument.** The web stamp reads `SIN_COMMIT` as well as `RENDER_GIT_COMMIT` (a one-line build-config change in `apps/web/vite.config.ts`; the stamp's behavior in the app is unchanged). **Rationale:** the marker travels with the image, so a rollback to an old digest reports the old commit without touching the environment; `/healthz` already exists, is unauthenticated, and is the polling target of every script. **Rejected:** a response header on every route (touches all responses and CORS exposure), a Cloud Run environment variable set at deploy time (can disagree with the image), a separate `/version` route (a second public route to rate-limit-exempt and test).
- ✅ **D18 (mine) — The production M2M client is a new Auth0 application.** **Rationale:** separable and revocable without touching staging's CI; costs one console form. **Rejected:** reusing staging's client (one leaked secret would reach both environments' smoke).
- ✅ **D19 (mine) — `firebase.json` lives in `apps/web/`, headers kept in sync by a parse-and-compare check.** The test parses both files rather than generating one from the other: the two hosts' file formats differ and a generated file hides review. It follows the repo's style (`assert-render-yaml.mjs`).
- ✅ **D20 (mine) — Migration status check after approval, DB ahead allowed.** See §6.5. The "database ahead" case is allowed so a rollback to an older commit passes (expand-only makes that safe).
- ✅ **D21 (mine) — Image retention is 5.** Within the free 0.5 GB (layers are shared between images; the real size is checked at the first publish, AC3) and still a useful rollback window. **Cost:** a rollback past five releases needs a forward-fix commit. Cents per month if the size is wrong, and the budget alert would say so.
- ✅ **D22 (mine) — Client address on Cloud Run:** a `CLIENT_IP_SOURCE` switch, the right-most `X-Forwarded-For` entry behind a non-public socket, socket fallback (§6.2). **Rationale:** Render's behavior must not change, so the new rule is opt-in per host; trusting the position the Google front end writes (and no position a client can write) is the same principle as D12 of Spec 05.2. **Rejected:** detecting the host from env vars such as `K_SERVICE` (implicit, untestable by config), walking `X-Forwarded-For` left to right (forgeable), trusting the first entry (the client's own).
- ✅ **D23 (mine) — First image is Google's sample container pinned by digest,** so Terraform can create the service before the first publish; the deploy workflow replaces it and Terraform ignores the image afterward.

### Open questions for the owner

- **O1 — What Cloud Run presents for the socket and `X-Forwarded-For`.** Not knowable from documentation alone; AC28 measures it and may change `CLOUD_RUN_XFF_HOPS` or force the socket fallback. Default if unanswered: the rule as written, adjusted by the measurement.
- **O2 — Cloud Run memory.** 512 MiB is a starting point (§6.1). If production is quiet on memory, 256 MiB would save nothing in the free tier; I would leave it at 512 MiB. Default: 512 MiB.
- **O3 — Free-tier numbers.** The allowances for Cloud Run, Artifact Registry, Secret Manager and Firebase Hosting must be rechecked on Google's pages at implementation (they change; BL-31). I have not copied figures into this spec for that reason.
- **O4 — The Firebase `**` versus `/assets/**` header precedence** is verified on the live site (AC23), not assumed (§6.6).
