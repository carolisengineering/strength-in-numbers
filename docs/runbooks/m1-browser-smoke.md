# M1 browser smoke (Spec 06.3)

One Playwright run in mobile Chromium against the **deployed staging** web and
API, signing in through the real Auth0 Universal Login. It starts a workout,
logs a set for each of the five modalities, reloads, reorders, edits, removes,
finishes and deletes. It also checks CSP violations, console errors, the 320 px
layout and real `<dialog>` focus. See
[Spec 06.3](../specs/06.3-m1-playwright-smoke.md).

It is a smoke test, not the test suite: behavior is covered by Vitest. A red run
means the deployed main flow is broken (or the setup below is).

---

## 1. One-time setup

### 1a. Auth0 test user

Auth0 dashboard (tenant `dev-gncuqvfir0wv0t4l`) → **User Management → Users →
Create user**:

- **Connection:** `Username-Password-Authentication`.
- **Email:** a non-personal address you control. The API refuses to create a
  user whose token has no `email` claim (`apps/api/src/auth/provisioning.ts`).
  Email verification is **not** required.
- **Password:** a strong, generated one. It goes into a GitHub secret only.

The post-login Action from [first-deploy A3](first-deploy.md#a3-post-login-action-namespaced-email-claims)
runs for every user, so the token gets the namespaced `email` claims with no
extra step.

Then sign in once as the test user at `https://si-web-staging.onrender.com` in
a normal browser. Check that Profile shows kg / km. The smoke accepts either
unit, but kg keeps the failure screenshots readable.

### 1b. Auth0 SPA application

**Applications → the SPA app** (`CupLpvJZ1Uyo2ov1YPTeP2eho9w0iYDr`). The
callback list was already checked on 2026-10-04. Confirm the rest:

- **Allowed Logout URLs** and **Allowed Web Origins** include
  `https://si-web-staging.onrender.com`.
- **Refresh Token Rotation** is on (needed for the manual check in §5).

### 1c. GitHub secrets and variables

Repo → **Settings → Secrets and variables → Actions**:

| Name | Type | Value |
|---|---|---|
| `E2E_AUTH0_USERNAME` | **Secret** | the test user's email |
| `E2E_AUTH0_PASSWORD` | **Secret** | the test user's password |
| `STAGING_WEB_BASE_URL` | Variable (optional) | overrides the default `https://si-web-staging.onrender.com` (no trailing slash) |

The `e2e` job runs only when **both** secrets are set. Until then it prints a
notice and passes (Spec 06.3 D10).

---

## 2. Running it locally

```bash
pnpm --filter @sin/web exec playwright install chromium   # first time only

export E2E_BASE_URL=https://si-web-staging.onrender.com
export E2E_API_URL=https://si-api-ft2f.onrender.com      # optional: warms the API first
export E2E_AUTH0_USERNAME=…                               # the test user
export E2E_AUTH0_PASSWORD=…
pnpm --filter @sin/web run e2e
```

Useful flags (append after `run e2e --`):

- `--headed`: watch the browser.
- `--ui`: step through interactively.
- `--project=setup`: only the login step.

`pnpm --filter @sin/web exec playwright show-trace apps/web/test-results/<dir>/trace.zip`
opens a failure trace.

`apps/web/e2e/.auth/state.json` is written by the login step. It holds a **live
Auth0 session cookie**. It is gitignored; delete it whenever you like, and never
share it.

The run uses real staging data for the test user. It deletes its workout at the
end, and if a failed earlier run left one in progress, the next run discards it
first.

---

## 3. In CI

The `e2e` job in [`ci.yml`](../../.github/workflows/ci.yml) runs:

- only on pushes to `main`, after the API and web post-deploy smokes;
- one run at a time (`concurrency: e2e-staging`), because there is one test user.

Before the tests, `apps/web/scripts/wait-for-commit.mjs` polls the site until
its `<meta name="sin-commit">` equals the pushed SHA, for up to 15 minutes.
If a *later* push is already deployed, the run is superseded: it prints a
notice and skips the tests, because that push's own run tests the build.
Render stamps it from `RENDER_GIT_COMMIT` at build time. If it never matches
(Render didn't redeploy, or the stamp says `dev`), the job fails rather than
testing the old bundle.

It is **not a required check** yet (D6). Make it required in branch protection
once it has been green across several merges.

On failure the job uploads `e2e-report` (HTML report and screenshots) for 3
days. CI records **no traces**: a trace carries the Auth0 session cookie, and
a login trace the typed password. Screenshots can show the test user's email.
To debug with a trace, rerun locally (§2), where traces are kept on failure
(never for the login step).

The concurrency group keeps one running and one pending run; a third quick push
cancels the pending one, which shows as a cancelled run on `main`. That is
expected.

---

## 4. Reading a failure

Download `e2e-report` from the run and open `playwright-report/index.html`
(screenshot + error per step). For a trace, reproduce locally (§2). Common
causes:

| Symptom | Likely cause |
|---|---|
| `Auth0 rejected the test user: …` | wrong secret, a blocked user, or brute-force protection after repeated failures (unblock in the dashboard) |
| `readyz not ready after 120 s` | Render free-plan cold start that didn't finish, or the API is down |
| `wait-for-commit: FAIL` | Render didn't deploy this SHA (check the dashboard), or `RENDER_GIT_COMMIT` was missing at build time |
| a locator times out on a button | a UI rename: update `NAMES` in `apps/web/e2e/helpers.ts` in the same PR |
| `couldn't be saved` / `not saved yet` never clears | a set write failed against the real API, which is a real bug |
| tap targets under 44×44 / overflow | a real layout regression (Spec 04.1 / 06.1). Fix the UI, not the check. |

---

## 5. Manual checks this smoke does not automate (Spec 06.3 AC7)

Do these on real devices before calling M1 done, and after any auth or layout
change:

1. **Silent refresh-token rotation** (Spec 04.0 §10 item 3). Stay signed in
   with the tab open past the access-token lifetime, then act. The app refreshes
   silently: no redirect, no login screen.
2. **Soft keyboard vs the sticky bar** on iPhone Safari and Android Chrome. With
   a set field focused, the Log set / Finish bar stays usable and isn't hidden
   behind the keyboard.
3. **`env(safe-area-inset-bottom)`** on a phone with a home indicator. The
   bottom nav and sticky bar clear it.
4. **Airplane mode** (Spec 06.2 §10). Log sets offline, reload, reconnect, and
   check that every set syncs with no duplicates.
