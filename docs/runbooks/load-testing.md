# Load testing (Spec 16)

How to run the Spec 16 load test against `local`, `staging` and `prod`, set up what it needs, and read what it finds.
The tool is `tools/loadtest` (`@sin/loadtest`): a Node CLI that fetches tokens, seeds and cleans the test accounts,
and runs k6 with simulated lifters at real gym pace. Spec: `docs/specs/16-load-testing.md`.

Every command below runs from the repository root. `…` stands for `pnpm --filter @sin/loadtest run loadtest`.

## 1. What a run does

1. **Estimate.** It prints the requests, the minutes and the steps. `--dry-run` stops here; every target supports it.
2. **Guards.**
   - `prod` needs `--confirm-prod`, and a push run on prod also needs `--confirm-prod-push`.
   - A run estimated above `PROD_MAX_REQUESTS` (60,000) is refused on prod.
   - A push run needs a passing gym run first (§6).
3. **Tokens.** One per account, held in memory only. `local` gets them from dev-idp. `staging` and `prod` use Auth0's
   password-realm grant, 2 a second, so 150 accounts take about 75 s. A token that would expire before the run ends
   refuses the run (§7).
4. **Seed.** Each account gets its one routine if it doesn't have it yet.
5. **k6** runs the steps, sending its metrics to Grafana Cloud (`staging`, `prod`) or local Prometheus (`local`). On
   `staging` and `prod` a Grafana annotation marks the run.
6. **Cleanup** always runs afterwards, even after Ctrl-C, and deletes every workout the accounts hold.
7. **Result.** A per-step table, one sentence, and a result file in `tools/loadtest/results/` (gitignored).

What fails a step (X): set-save p95 above 2 s, more than 1% of requests answered 5xx, or any 429. N is the highest step
that passed.

All lifters come from one IP (your laptop), like a gym's Wi-Fi, so the API's per-IP limits apply to the whole run.

## 2. One-time setup

### 2.1 k6

```bash
brew install k6     # Spec 16 was built against k6 2.3.0
k6 version
```

### 2.2 Auth0: the test connection and the load-test application (by hand, Spec 16 D16)

In the Auth0 dashboard of tenant `dev-gncuqvfir0wv0t4l` (shared by staging and prod):

1. **Authentication → Database → Create DB Connection.**
   - Name: `loadtest`.
   - Turn on **Disable Sign Ups**, so nobody can add themselves.
2. **Applications → Applications → Create Application.**
   - Name: `si-loadtest`, type **Regular Web Application**.
   - **Settings → Advanced Settings → Grant Types:** turn on **Password** only. Turn off Authorization Code, Implicit,
     Refresh Token and Client Credentials.
   - **Connections tab:** turn on `loadtest` and turn off every other connection.
3. **Authentication → Database → `loadtest` → Applications:** `si-loadtest` is the only application on, and the SPA
   is off. This is what keeps the test accounts out of the real app and real users out of the password grant (AC18).
4. **Applications → APIs → the API with audience `https://api.strengthinnumbers.app` → Settings.** Note **Token
   Expiration (Seconds)**. The default is 86400 (24 h), which covers the longest run. This setting also governs the
   real app's tokens, so leave it alone unless §7 says otherwise.
5. **Actions → Triggers → post-login.** The action that adds the namespaced `email` and `email_verified` claims must
   be in the flow and must not filter by application, so that it runs for `si-loadtest` too (AC20).
6. **The Management application, used only by `setup-accounts`.**
   - Go to **Applications → APIs → Auth0 Management API → Machine to Machine Applications**.
   - Create and authorize a new application, `si-loadtest-setup`.
   - Grant it **only** `read:users` and `create:users`. The tool has no update or delete code at all, and this keeps
     the credentials as narrow as the code.
7. **Security → Attack Protection.** Check these settings, and record what you find in §9 (O2):
   - **Brute-force Protection.** It counts failed logins per account and IP. The tool's logins succeed, so it shouldn't
     trip, but a wrong password in the env file will trip it after 10 tries. Unblock under User Management.
   - **Suspicious IP Throttling.** It counts logins from one IP across many accounts. If a token fetch aborts with
     `HTTP 429`, add your laptop's public IP to this feature's **Allowed IP addresses** for the run, then remove it
     afterwards. Don't turn the protection off.
   - **Breached Password Detection.** Use a long random password for the test accounts.

### 2.3 Grafana Cloud: two tokens

1. **Metrics (write only).**
   - In the grafana.com portal, go to **Security → Access Policies → Create access policy**, named
     `si-loadtest-metrics`, with scope **metrics: write**. Then **Add token**.
   - The Prometheus remote-write URL and username come from the stack's **Prometheus** card, under **Details**: the
     "Remote Write Endpoint" (ending `/api/prom/push`) and the numeric username.
   - That username is the Prometheus instance ID, not the OTLP instance ID in `observability.md`.
2. **Annotations.**
   - In the stack's Grafana, go to **Administration → Users and access → Service accounts → Add service account**,
     named `si-loadtest-annotations`.
   - Give it the narrowest role that can write annotations. Prefer the fixed role **Annotation writer** if the stack
     offers it, otherwise **Editor**.
   - **Add service account token.**
3. Import `ops/grafana/dashboards/load-test.json`, and re-import `api-overview.json` and `usage.json`
   (`observability.md` §4). All three show the "Load test runs" annotations.

### 2.4 The env file

```bash
cp tools/loadtest/.env.example tools/loadtest/.env.loadtest
chmod 600 tools/loadtest/.env.loadtest
```

Fill it in. The file is gitignored, and a test fails if it isn't. The tool reads only this file, never your shell's
environment. A missing or empty variable stops the command, naming the variable and never a value.

| Variable | Value |
|---|---|
| `AUTH0_DOMAIN` | `dev-gncuqvfir0wv0t4l.us.auth0.com` |
| `AUTH0_AUDIENCE` | `https://api.strengthinnumbers.app` |
| `LOADTEST_AUTH0_CLIENT_ID`, `LOADTEST_AUTH0_CLIENT_SECRET` | `si-loadtest`'s credentials |
| `LOADTEST_AUTH0_CONNECTION` | `loadtest` |
| `LOADTEST_ACCOUNT_PASSWORD` | a long random password, shared by every test account |
| `AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET` | `si-loadtest-setup`'s credentials |
| `GRAFANA_PROM_RW_URL`, `GRAFANA_PROM_RW_USER`, `GRAFANA_PROM_RW_TOKEN` | §2.3 step 1 |
| `GRAFANA_URL`, `GRAFANA_ANNOTATION_TOKEN` | `https://<stack>.grafana.net` and §2.3 step 2 |

The secret values are the two client secrets, the password and the two Grafana tokens. They never appear in argv, the
log, a result file or an error. A leak of the password lets someone get tokens for the test accounts, which can only
create and read empty test data (Spec 16 §7). If you ever share the file, rotate the password anyway (§8).

### 2.5 The accounts

```bash
… setup-accounts --dry-run     # "would create 150"
… setup-accounts               # "created 150, existing 0"; a rerun says "created 0, existing 150"
… seed --target staging        # one routine per account; a rerun creates nothing
```

`setup-accounts` creates `loadtest+001@example.test` … `loadtest+150@example.test` on the `loadtest` connection,
verified, with the shared password. `example.test` is a reserved domain, so nobody real has these addresses. The
command only creates, and it skips accounts that already exist.

### 2.6 The two manual checks

- **AC18, isolation.**
  - Open the real web app and try to sign in as `loadtest+001@example.test`. It must fail, because the SPA has no
    `loadtest` connection.
  - In Auth0, go to **Applications → `si-loadtest` → Connections** and confirm that `loadtest` is the only connection.
    A real user's password can't be used with the password grant, because no real user exists on that connection.
- **AC20, the tokens.**
  - Run `… seed --target staging --lifters 1`.
  - It succeeding proves the API accepted a test account's token: right audience and issuer, and the namespaced
    `email` and `email_verified` claims that `/v1` requires to provision the user.

Record both in §9.

## 3. Running

```bash
… run gym   --target local                      # local: dev-idp on :9999 and the API on :8080 running
… run gym   --target staging --dry-run          # always first: the estimate, nothing touched
caffeinate -i pnpm --filter @sin/loadtest run loadtest run gym --target staging
… run burst --target staging
… run push  --target staging --push 2           # only after a passing gym run (§6)
… cleanup   --target staging                    # only if a run's cleanup failed (it says so)
```

| Run | What it answers | Length on staging |
|---|---|---|
| `gym` | How many lifters mid-workout at once before something breaks (N), and what broke (X) | about 344 min |
| `burst` | Whether K lifters opening the app within a minute is handled | a few minutes per step |
| `push --push F` | The same ladder with F× the request rate, to find the break past N | depends on F |

`--lifters N` runs one step of N lifters. Use it for checks only: it can't unlock a push (§6). `--steps` and
`--hold-scale` are for local checks only. `--no-metrics-output` turns off k6's metrics.

### Long runs

A full gym run holds each step long enough to collect 200 set saves at real pace, which comes to about 344 minutes.
`--dry-run` prints the figure.

- Run it under `caffeinate -i` with the laptop on power and the lid open, on a network you trust to stay up.
- A sleeping laptop or a dropped network shows up as an incomplete run, not as an API failure.
- Ctrl-C stops k6, still cleans up, and writes the result as incomplete.

## 4. Production

Today `infra/prod.tfvars` still holds `REPLACE_ME_*` values, so every prod command refuses with a pointer to
`first-deploy.md` Part F. Once production exists:

- Run at a quiet hour for real lifters, and only the gym run or a burst.
- A push run on prod needs `--confirm-prod-push` as well as `--confirm-prod`, and only when the owner asks.
- Read the free-tier section (§5) first, and dry-run first: `… run gym --target prod --dry-run --confirm-prod` prints
  the estimate and `prod guards: pass (https://…run.app)`.
- Production has no server telemetry yet (Spec 15 sets no `OTEL_*`), so a prod run gives N and X from k6's side only.
- Test traffic counts as usage: `sin_workouts_*` and `sin_sets_logged` go up, and cleanup doesn't undo counters
  already sent. Read the usage panels around the annotation (§6.8 of the spec).
- **BL-28 (O1).** If production is ever limited to an allow-list of accounts, the test accounts must be on it too, or
  prod runs stop working. The allow-list's own spec must name them.

## 5. Free-tier allowances (check before the first prod run)

The numbers below are as of 2026-11-14. Re-check each pricing page before relying on them.

| Service | Free allowance | One run uses | Page |
|---|---|---|---|
| Cloud Run (prod) | 2 million requests, 180,000 vCPU-seconds and 360,000 GiB-seconds a month | up to 60,000 requests (`PROD_MAX_REQUESTS`). A 344-minute gym run keeps one instance busy for about 20,600 s, which is about 11% of the vCPU-seconds | cloud.google.com/run/pricing |
| Neon (staging, prod) | a monthly compute-hours allowance per project | the compute stays awake for the whole run: about 6 h for a gym run, at the smallest size unless autoscaling raises it | neon.com/pricing |
| Grafana Cloud | 10k active series, 14-day retention | k6 adds series per request name × step × status × metric (§9 records the count); budget for one run: **under 5,000** | grafana.com/pricing |
| Auth0 | the tenant's plan limits on the Authentication API | 150 token requests a run, paced at 2 a second | the tenant's Settings → Plan |

`PROD_MAX_REQUESTS` is 60,000. That is about 4.7× the default gym run's 12,785 requests, enough for a gym run and a
few bursts in one sitting, and 3% of Cloud Run's monthly requests. A push run at full scale would exceed it, which is
the point.

## 6. Reading a result

1. Read **the sentence**, for example `staging handles 75 lifters mid-workout at the same time; at 100 the set save
   p95 went over 2 s`. Then read the per-step table.
2. Open **si-api — load test** in Grafana at the run's annotation window.
   - The top row is k6's view: lifters, requests per second, set-save p95 against the 2 s line, 5xx share and 429s.
   - The rows below are the API's own view.
3. **At the first failing step, look at what moved.** That is the first thing that breaks:
   - **CPU cores in use** reaching the `cpu_limit` line (0.1 on Render free, 1 on Cloud Run).
   - **DB connections in use** reaching the limit of 8, with **queries waiting** and **pool wait** rising.
   - **Event-loop delay** climbing.
   - **Nothing busy** while k6's p95 rises: the network or the host in front of the API.
4. The pool gauges are one sample a minute on staging, so read the wait counters for spikes.

**The push gate (D9).** A push run needs the target's **newest** gym result to be:
- complete;
- cleaned up (`cleanup: "done"`);
- passing at least one step;
- run on the full ladder, with no `--steps`, `--hold-scale` or `--lifters`.

`--allow-unpassed-push` overrides it. An older passing result doesn't count.

**Cleanup.**
- If cleanup fails, the run still writes its result and prints the exact `… cleanup` command to finish the job.
- A failed cleanup also blocks the next push until a clean gym run.
- Accounts keep their routine between runs.

## 7. When the token-lifetime check refuses

`Auth0 tokens last 24.0 h but this run needs 30.5 h; raise the API's Token Expiration in Auth0 (runbook
load-testing.md)` means the run is longer than the tokens last. The tool fetches tokens once and never refreshes them
mid-run.

Prefer a shorter run, for example with fewer steps through `--lifters`, or a push with a smaller ladder. Raising the
API's **Token Expiration** (§2.2 step 4) also lengthens every real user's access token, so do it only knowingly, and put
it back afterwards.

## 8. Retiring the accounts, and rotating the password

- **Rotating the password.**
  - In Auth0, delete the test users. Go to **User Management → Users** and search `identities.connection:"loadtest"`,
    or delete the `loadtest` connection and recreate it with §2.2 steps 1 and 3.
  - Put the new password in the env file and run `… setup-accounts`.
  - The new users have new Auth0 ids, so the API sees new accounts, seeded on the next run. The old API accounts stay
    behind empty (no workouts after cleanup, one routine each). Remove them as below.
- **Retiring everything.**
  - Delete the `loadtest` connection, `si-loadtest` and `si-loadtest-setup` in Auth0, and the two Grafana tokens.
  - To remove the API accounts too, each one must first be scheduled for deletion (`DELETE /v1/account` with its own
    token; the tool has no command for this yet), then run `OWNER_DATABASE_URL='<owner url>' pnpm --filter @sin/api run
    account:purge --confirm --skip-grace`, following the account-lifecycle runbook rules.

## 9. The 21.1 speed gate (S0 and S8)

Spec 21.1 AC38 compares a staging gym run with row-level security off (S0) with one with it on (S8). The pass mark is
set-save p95 under 2,000 ms at 150 lifters, and N dropping by no more than one step. Both runs use the same code and
the same `sin_app` login, so the difference is what the policies cost (owner, 2026-11-14; spec §6.9).

1. `… run gym --target staging --dry-run`, and check the estimate and that the token check passes.
2. **S0 (RLS off).**
   - With `OWNER_DATABASE_URL` set: `pnpm --filter @sin/api run db:rls -- disable`.
   - Then `unset OWNER_DATABASE_URL`.
   - `caffeinate -i pnpm --filter @sin/loadtest run loadtest run gym --target staging`.
   - Then, with `OWNER_DATABASE_URL` set again: `pnpm --filter @sin/api run db:rls -- enable`, then
     `db:rls -- status`, which must show 19 tables on and no WARNING.
   - Then `unset OWNER_DATABASE_URL`.
3. **S8 (RLS on).** Run the same gym command again.
4. Fill in the table below and the S8 row of `first-deploy.md`'s RLS outcomes.
   - If the gate fails, `db:rls -- disable` is the instant way back.
   - The levers are in spec §6.11.
   - A failed gate blocks production's first real user, not staging.

While RLS is off, every staging account can read any row its grants allow, so keep the window to the one run.

## 10. Results

Record each first run here (AC18, AC20, AC24, AC29).

| Check | Date | Result | Notes |
|---|---|---|---|
| AC18 isolation (§2.6) | | | |
| AC20 token accepted (§2.6) | | | |
| O2 attack-protection settings | | | |
| AC24 active series added by one run | | | budget under 5,000 |
| AC25 annotation on api-overview, usage, load test | | | |
| AC26 every Load test panel populated | | | |

| Run | Date | Commit | Result file | Sentence | N | X at the first failing step | What was busy (CPU, pool, event loop) |
|---|---|---|---|---|---|---|---|
| S0 gym, RLS off | | | | | | | |
| S8 gym, RLS on | | | | | | | |
| burst | | | | | | | |
| push ×2 (if S8 passed) | | | | | | | |

**S8 gate:** p95 at 150 = ___ ms (S0 ___ ms); N = ___ (S0 ___). Pass / fail: ___
