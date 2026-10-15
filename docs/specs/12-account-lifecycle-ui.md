# Spec 12 — Account Lifecycle (UI): download your data, delete your account

**Status:** Implemented (2026-10-15, branch `feat/spec-12-account-lifecycle-ui`; merge date added at merge). Implementation corrected three details below: Sign out calls `logoutAndClear` through `useAuth0().logout`, not `useSession()` (a `useMe` observer would refetch `/v1/me` after `removeQueries()` and get a 403); the erase-date time zone travels in the delete mutation's variables instead of being read from the `["me"]` cache; and a `401` from the export or the delete shows no notice (AC10). Draft v0.1 (2026-10-14). Design approved by the owner in a brainstorm on 2026-10-14 (brief: `docs/superpowers/specs/2026-10-14-spec-12-design-brief.md`, kept locally — `docs/superpowers/` is git-ignored; its decisions are restated in §12). This draft encodes the brief and records, in §12, where reading the code corrected or qualified it. Open: O1 (support contact). O2 (ConfirmDialog extension vs a new dialog) is resolved here from the code.
**Kind:** UI (web only) + one small addition to the React-free API client
**Depends on:** **Spec 11** (hard: `GET /v1/account/export`, `DELETE /v1/account → 202`, `Content-Disposition` in the CORS `exposedHeaders`, `ACCOUNT_PURGE_GRACE_DAYS` and `AccountDeletedResponseSchema` in `@sin/core`; merged as PR #75 and live on staging), Spec 04.0 (`createApiClient`, `ApiError`, the `ProtectedLayout` gate, `AccountDeleted`), Spec 04.1 (`ProfileScreen`, `useMe`, the UI primitives), Spec 06.1 (`ConfirmDialog`), Spec 06.0 (`logoutAndClear`, the storage rules), Spec 05.2 (`429` / `Retry-After`).
**Consumed by:** nothing downstream. Closes the user-facing half of DESIGN §2 item 1 and Spec 11's "export first" consequence (Spec 11 D2).
**Design refs:** DESIGN.md §2 item 1 (account deletion + data export), §4.9 and §6 (the deletion matrix, `/account/export`, `/account`), §8.2 (privacy), §9 M4 row, §10 Q19; Spec 11 §3 (stable surface), D2, D14, D16, O1, O2; Spec 04.0 §5 / §6.4; CLAUDE.md "Web logout + user data", "Account lifecycle".

---

## 1. Purpose, scope & non-goals

A closed-beta tester can **download all of their data and delete their account from a phone, without contacting the owner**, and a mistaken delete is hard to do by accident. Two sections are added to the existing Profile screen: **Your data** (one Download button) and, at the very bottom, **Delete account** (a two-step confirmation, then a terminal "scheduled for deletion" screen with a single Sign out). **This spec changes no API, no migration and no server behavior.**

> **First-principles note — why a download is not just a link.** The API is on a different origin from the web app and needs a bearer token in an `Authorization` header. A plain `<a href="…/export">` cannot send that header, so the browser would arrive unauthenticated. The app therefore fetches the file itself (with the token), keeps the bytes in memory as a `Blob`, and hands them to the browser as if they were a download: it makes a temporary `blob:` URL for the bytes, clicks an invisible `<a download="name.json">` pointing at it, and then discards the URL. The file name comes from the response's `Content-Disposition` header — which a cross-origin page may read only if the server lists it in `Access-Control-Expose-Headers` (Spec 11 D16 did exactly that).

> **First-principles note — "TanStack mutation" and why the delete lives above the screen.** The app keeps server data in a `QueryClient` (TanStack Query). A *mutation* is its name for a write; its result is kept in a separate cache from the read queries. After the delete succeeds, no screen may talk to `/v1` again (every call would now answer `403`), yet the Profile screen is mounted *inside* providers that do talk to `/v1` in the background (catalog sync, the offline outbox). So the "deleted" state cannot be local to the Profile screen: it has to be read by the layout above the providers, which then stops rendering them. That is the one structural decision in this spec (D3).

### In scope

- `requestBlob(path, options)` on the API client — token, request id, 401 refresh, error mapping and `Retry-After` shared with `request()` — plus a pure `Content-Disposition` filename parser (§6.1).
- `apps/web/src/features/account/`: `AccountDataSection`, `DeleteAccountSection` (+ the two-step flow on `ConfirmDialog`), `AccountDeletedConfirmation`, hooks `useExportAccount` and `useDeleteAccount`, pure `saveBlob(blob, filename)`, pure error-to-copy mapping, the erase-date formatter, and the copy module.
- `ProfileScreen` gains the two sections; `ProtectedLayout` gains the "deleted" gate (§6.5); `ConfirmDialog` gains an explicit initial focus on Cancel and a wrapping actions row (§6.4, D12).
- A manual phone check.

### Non-goals (with where they live)

| Not here | Lives in |
|---|---|
| Any API, migration, CORS or CSP change | None — Spec 11 shipped everything the UI needs (AC25) |
| Restore / undo / re-authentication / a typed confirmation | Never in the beta (Spec 11 D2, D14; brief D-confirm) |
| CSV, zip, Hevy-shaped export, import | Separate later spec on Hevy's real format (Spec 11 D4) |
| Async export, a share sheet, a scheduled export | GA (Spec 11 D1) |
| A body-weight export | `body_metric` does not exist yet (Spec 11 §1) |
| A Playwright run of the delete flow | It would destroy the e2e test account; the export is covered by the phone check (AC26) |
| The privacy policy / terms text | Not scheduled; the one-line retention statement is the Spec 11 O2 wording (D14) |
| The operator's side (purge, restore) | `docs/runbooks/first-deploy.md` "Account deletion requests" (Spec 11) |
| Analytics events | Spec 13 (D10) |

---

## 2. Acceptance criteria

Behavioral criteria each get ≥1 test whose `describe` is tagged **`"12 ACn — …"`** (the 08.x / 10.x convention). Levels are in §10. **Phase A** (AC1–AC4): the API client. **Phase B** (AC5–AC11): export. **Phase C** (AC12–AC22): delete. **Phase D** (AC23–AC27): cross-cutting, verification, docs.

### Phase A — API client

1. **`requestBlob` success.** `client.requestBlob(path, { signal?, fallbackFilename? })` sends a `GET` with `Authorization: Bearer <token>`, a fresh `X-Request-Id` and `Accept: application/json`, and resolves `{ blob, filename }` where `blob` holds the response bytes **unchanged** (byte-equal to the body — never parsed and re-serialized) and `filename` comes from `Content-Disposition` (AC2). It uses `baseUrl + path` like `request()`; `ApiClient` gains `requestBlob`.
2. **Filename parsing.** A pure `filenameFromContentDisposition(header, fallback)` returns the quoted `filename="…"` value, preferring RFC 6266 `filename*=UTF-8''…` (percent-decoded) when both are present; strips directory parts (`/`, `\`), control characters and leading dots/spaces; caps the length at 120 characters keeping the extension; and returns `fallback` (default `"download"`) for a missing header, an unparsable value, an undecodable `filename*`, or a name that is empty after sanitizing. It never throws and never returns an empty string. A table test covers each branch, including `../../etc/passwd`, `a/b.json`, `""`, and a header with no `filename`.
3. **`requestBlob` errors.** A non-2xx response becomes the same `ApiError` that `request()` throws (problem+json fields, `requestId`, `retryAfterMs` from `Retry-After`; a non-JSON error body yields the generic status error); a `fetch` rejection and a failure while reading the body (`response.blob()` rejecting) both become `ApiError.network` (`isNetworkError: true`, `status: 0`); a **2xx whose `Content-Type` is not JSON** (an HTML error page from a proxy) throws a `Malformed response` `ApiError` rather than handing back a Blob that would be saved as the export.
4. **Shared transport, no regression.** `request()` and `requestBlob()` go through one internal `send()` (token acquisition, the single 401 refresh-and-retry, `onAuthLost`, `readError`), so `requestBlob` on a `401` retries once with a fresh token and then calls `onAuthLost` and throws, exactly as `request()` does. An aborted `signal` rejects the call (§6.2 maps it). Every existing `client.test.ts` / `client.lostSession.test.ts` case passes **unmodified**.

### Phase B — export

5. **The "Your data" section.** The Profile screen shows, below the profile form, a `Your data` heading (`h2`, in a region it labels), one sentence of explanation ("A file with your profile, custom exercises, routines and every workout, including sets and notes."), and a full-width **Download my data** button. In the idle state nothing else is shown and no request has been made.
6. **One request, a visible busy state.** Tapping the button sends exactly one `GET /v1/account/export`. While it is in flight the button is disabled with `aria-busy`, its label reads "Preparing your data…", and a polite status region announces it; a second tap (or a double-tap in the same tick) sends **no** second request.
7. **Success and re-download.** On success `saveBlob` is called once with the Blob and the filename `requestBlob` returned, and the section shows `Saved {filename}` (a polite status) with a **Download again** button. **Download again** calls `saveBlob` with the **held** Blob and sends **no** request (so it does not spend the 3-per-minute budget). The Blob is held in the hook's state and dropped when the screen unmounts.
8. **`saveBlob` is pure DOM plumbing.** `saveBlob(blob, filename)` creates an object URL, appends a hidden `<a>` with `href` = that URL and `download` = `filename`, clicks it, removes it, and revokes the URL in a later task (so the browser has started reading it). It does not navigate, open a window, read or write storage, or parse the Blob. If `URL.createObjectURL` or the click throws, the error propagates (the hook shows the generic failure, AC9).
9. **Failure copy.** One pure function maps an error to the message shown in an `InlineNotice` (tone `error`) with a **Try again** action: `isNetworkError` → "You're offline. Connect and try again."; `429` → "Too many downloads. Try again in {n} seconds." with `n = ceil(retryAfterMs / 1000)` (`retryAfterMs` null → "Try again in a minute."); anything else (including `5xx`, a malformed response, a `saveBlob` throw) → "Couldn't prepare your data." with the request id shown (`InlineNotice`'s `requestId`). Messages never echo the response body. **Try again** sends a new request (a fresh state, not a stale one).
10. **Session and account errors are not this screen's to show.** A `403 account-deleted` from the export (or from the delete, AC19) shows **no** notice: it invalidates the `["me"]` query, whose refetch is a `403 account-deleted` that `ProtectedLayout` already renders as `AccountDeleted` (D7). A `401` shows no notice either: the client's `onAuthLost` has already started the logout.
11. **Leaving the screen aborts; online-only.** The export request carries an `AbortSignal` that is aborted when the section unmounts; the resulting rejection is **not** reported as an error (no notice, no `reportError`, no state update) and nothing is saved after unmount. The mutation uses `networkMode: "always"`: with the browser offline the request is attempted and fails as a network error (AC9), never paused behind a spinner, and nothing is written to the outbox or to storage.

### Phase C — delete

12. **`ConfirmDialog` extension is behavior-preserving.** `ConfirmDialog` moves initial focus to its **Cancel** button explicitly when it opens (instead of relying on DOM order, which a body containing a button would break), and its actions row wraps (`flex-wrap`). Its existing `ConfirmDialog.test.tsx` and the tests of its four current callers (`ActiveSession`, `FinishedWorkoutScreen`, `RoutinePreview`, `RoutineEditor`) pass **unmodified**; a new test places a button in `children` and asserts the active element on open is Cancel.
13. **The "Delete account" section.** The last block of the Profile screen, after the signed-in/Log out block, is a region labeled by an `h2` "Delete account" with one sentence ("Lock your account and schedule your data for erasure.") and a **Delete account…** button in the `danger` variant. It is outside the profile `<form>` (it cannot submit it), and tapping it only opens the dialog — nothing is sent.
14. **Step 1 dialog.** The dialog is titled "Delete your account?". Its body says, in the product's words: your account locks **immediately** on every device; your data is permanently erased **at least {N} days** later; you can't undo this yourself; and you can't download your data after you continue; plus one sentence that backups age out on the hosting provider's schedule (D14). `N` is `ACCOUNT_PURGE_GRACE_DAYS` imported from `@sin/core` (a source scan finds no numeric literal `30` in `features/account/`). It offers an optional **Download my data first** button (D2) and the dialog's **Cancel** and **Continue** buttons; Cancel precedes Continue in the DOM and holds the initial focus (AC12). Continue is the `primary` variant.
15. **Download first, inside the dialog.** The button in the dialog uses the **same** `useExportAccount` instance as the section (the hook is called once, in the Profile form, and passed down), so there is one export state and one request even if both buttons are tapped. While preparing, the dialog button is disabled with "Preparing your data…"; on success the dialog shows `Saved {filename}` (status); on failure the AC9 message appears in the dialog. None of these advances, closes or blocks the flow: Continue stays enabled.
16. **Step 2 and the double-tap guard.** Continue replaces the dialog's content in place (same open dialog, no request): title "Are you sure?", body "Your account will be locked right away. This can't be undone from the app.", **Cancel** and a `danger` **Delete my account**. Initial focus returns to Cancel. For `STEP_SETTLE_MS` (700 ms, one constant) after step 2 appears, **Delete my account** is disabled, so the second tap of a double-tap on Continue — which lands on the same screen position — cannot confirm a delete. No request is sent before the button is activated.
17. **Cancel sends nothing and resets.** Cancel, Escape and the Android back gesture, at either step, close the dialog, send no request, and reset the flow to step 1 for the next open; focus returns to the **Delete account…** button. (While a delete is in flight, see AC18.)
18. **In flight.** Activating **Delete my account** sends exactly one `DELETE /v1/account` (no body), both dialog buttons are disabled with the confirm button `aria-busy`, and a second activation (double-tap in the same tick) sends no second request. Escape/back during the request does not abort it: the dialog closes and the flow resets, but the request's outcome is still handled (AC19, AC20) — a failure **reopens** the dialog at step 2 with its message.
19. **Failure paths.** In the dialog at step 2, a network error shows "You're offline. Connect and try again."; a `429` the AC9 seconds message (from `Retry-After`; the `me` write group is shared with profile saves, Spec 11 AC19); any other failure "Couldn't delete your account." with the request id; each as a `role="alert"` text in the dialog body, with both buttons enabled again (the settle guard of AC16 does **not** re-apply) and the profile unchanged behind it. A `403 account-deleted` is **done** (Spec 11 §3): no message, handled as AC10. A retry sends a new request.
20. **Success: the deleted gate.** On `202`, the body is parsed with `AccountDeletedResponseSchema`, and `ProtectedLayout` stops rendering `AppShell` and every provider under it (catalog, workout/outbox, history, progress, routines) and renders `AccountDeletedConfirmation` instead (D3); the `["me"]` query is disabled; in-flight queries are canceled and the cached `/v1` data is removed once the swap has rendered. After the `202` the app makes **no** further `/v1` request — not on window focus, `online` events, timers or outbox drain (a request log over a 5-second fake-timer window plus dispatched `focus` / `online` events stays empty). The token is not touched.
21. **The confirmation screen.** It shows an `h1` "Your account is scheduled for deletion"; the text "Your account is locked. Your data won't be erased before {date}." where `{date}` is `purgeEligibleAt` formatted as a long date (e.g. "November 13, 2026") **in the user's profile time zone** (`me.timezone`; an unknown zone falls back to the device zone without throwing); "To restore your account before then, contact the app owner." (O1); and exactly one action, **Sign out**. It renders no navigation, no `AppShell`, no other link, and receives focus on its heading when it appears. A table test pins the date across a UTC/local day boundary.
22. **Sign out, reload, and the closed-account screen.** **Sign out** calls `logoutAndClear` through `useAuth0().logout` — not `useSession()`, whose `useMe` observer would refetch `/v1/me` (a `403`) after the confirmation removes the cached queries (so user-scoped storage is cleared before the Auth0 redirect; no file other than `auth/logout.ts` builds `logoutParams` — the Spec 06.0 AC20 scan passes unmodified). A reload after the delete runs `GET /v1/me` → `403 account-deleted` → the existing `AccountDeleted` screen, which still logs out on mount; its body copy changes from "contact support" to "contact the app owner" (D15) and its existing test passes unmodified.

### Phase D — cross-cutting and verification

23. **Accessibility and tokens (component level).** In `a11y.test.tsx` (`describe("12 AC23 — …")`): each section is a region named by its heading; every control has a visible label; the busy state uses `aria-busy` plus one polite status region that exists before it is filled; error text is `role="alert"` and not conveyed by color alone; the dialog is labeled by its title; disabled controls say why in text where the reason is not obvious (the settle window needs none — it is 700 ms). Every added `*.module.css` uses `var(--…)` only and `assert:css-tokens` passes; `tokens.css` is not edited. Pixel sizes, focus, Escape / back and 320 px layout need a browser (AC26).
24. **Hygiene and boundaries (source scans + spies).** The files this spec adds: do not name `localStorage` / `sessionStorage` (the Spec 04.0 AC7 scan passes unmodified); add no `USER_DATA_KEY_PREFIXES` entry; contain no `dangerouslySetInnerHTML` / `innerHTML` / `style=`; never `JSON.parse` or `JSON.stringify` the export Blob; pass no export content, filename, email or note text to `track` / `reportError` / `console` (a spy test over every path in AC6–AC11 with distinctive text; no `track` event is added, D10); and `features/account/` imports only `@sin/core`, `ui/`, `api/` types, `auth/` (`useApi`, `logoutAndClear`) and `features/me/useMe`. `src/api/` stays React- and DOM-free (the existing purity test passes unmodified).
25. **No backend or infra change; gates hold.** `git diff main --stat` shows no path under `apps/api/`, `packages/core/`, `render.yaml` (so the CSP is unchanged: no `blob:` source is added), `Dockerfile`, `.github/workflows/` or `apps/api/prisma/`. The `src/api/**` and `src/auth/**` ≥ 90 % line gates pass with `requestBlob` and the filename parser covered; the full `@sin/web` suite, lint, typecheck, build and `assert:css-tokens` are green.
26. **Manual phone check (owner, recorded in the PR description).** See §10.
27. **Docs stay consistent.** DESIGN.md, `docs/specs/README.md`, Spec 11's non-goals pointer and CLAUDE.md carry the edits listed in §11; each of AC1–AC25 has ≥1 committed test tagged with its number (a tag-scan test in the 10.3 style); AC26 is verified by the PR description, AC27 by review.

---

## 3. Dependencies & exposed interface

### Needs

| Kind | Item | Notes (verified against the code, 2026-10-14) |
|---|---|---|
| Spec 11 | `GET /v1/account/export` → `200` JSON with `Content-Disposition: attachment; filename="strength-in-numbers-export-YYYY-MM-DD.json"`, `Cache-Control: no-store`; `429 rate-limited` + `Retry-After` after 3 per window | `apps/api/src/routes/account.ts`; `exposedHeaders` includes `Content-Disposition` (`app.ts`) |
| Spec 11 | `DELETE /v1/account` → `202 { deletedAt, purgeEligibleAt }`; a repeat or a racing second delete is `403 account-deleted`; counts toward the `me` write group (10 / window) | clients treat `account-deleted` as "done" (Spec 11 §3) |
| `@sin/core` | `ACCOUNT_PURGE_GRACE_DAYS`, `AccountDeletedResponseSchema`, `Me` / `MeSchema` (`timezone`, `email`) | exported from the package index (`dto/account.ts`) |
| Spec 04.0 | `createApiClient` (`apps/web/src/api/client.ts`), `ApiError` (`isNetworkError`, `status`, `type`, `requestId`, `retryAfterMs`), `ProtectedLayout`'s `403 account-deleted` branch, `AccountDeleted` | there is no `isOffline`: offline is `isNetworkError` (a `fetch` rejection) |
| Spec 04.1 | `ProfileScreen`, `useMe` / `ME_QUERY_KEY`, `Button`, `InlineNotice`, `Screen`, `Spinner` | |
| Spec 06.1 | `ConfirmDialog` (native `<dialog>`, controlled `open`, `busy`) | extended by AC12 |
| Spec 06.0 | `logoutAndClear` (via `useAuth0().logout`) | the only Auth0 logout caller |

### Provides — stable surface

| Item | Consumers |
|---|---|
| `ApiClient.requestBlob`, `filenameFromContentDisposition` | any future file download (a Hevy export, a PDF) |
| The `ProtectedLayout` "deleted" gate | nothing else; a future "account locked on another device" notice could reuse it |
| `ConfirmDialog` with explicit Cancel focus | every confirmation dialog (gets the guarantee its docstring already claimed) |

---

## 4. Data model

No server-side tables, columns or migrations. Client state only, all in memory: the export hook's `Blob` and status, the dialog step, the delete mutation result (kept in the TanStack mutation cache with `gcTime: Infinity` so the gate survives the Profile screen unmounting, D3). **No new browser-storage key; `USER_DATA_KEY_PREFIXES` unchanged** (AC24). The downloaded file is written by the browser to the device's Downloads location, outside the app's control (§7).

---

## 5. Screens & flows

*(UI spec — replaces "API surface". No API change; the routes used are `GET /v1/account/export` and `DELETE /v1/account`.)*

### 5.1 Profile screen (additions in bold)

```
Profile
  Display name / Units / Time zone / [ Save ]            (unchanged)

**Your data**
**A file with your profile, custom exercises, routines and every
workout, including sets and notes.**
**[ Download my data ]**         idle
**[ Preparing your data… ]**     busy (disabled)
**Saved strength-in-numbers-export-2026-10-14.json   [ Download again ]**
**(error)  Couldn't prepare your data.  Request ID: …   [ Try again ]**

Signed in as you@example.com
[ Log out ]                                              (unchanged)

**Delete account**
**Lock your account and schedule your data for erasure.**
**[ Delete account… ]**   (danger)
```

### 5.2 Delete dialog

```
Step 1                                         Step 2
┌ Delete your account? ───────────────┐        ┌ Are you sure? ──────────────────────┐
│ Your account locks right away on    │        │ Your account will be locked right   │
│ every device. Your data is          │        │ away. This can't be undone from the │
│ permanently erased at least 30 days │        │ app.                                │
│ later. You can't undo this          │        │ (error, if any)                     │
│ yourself, and you can't download    │        │                                     │
│ your data after you continue.       │        │ [ Cancel ]   [ Delete my account ]  │
│ Backups age out on the hosting      │        └─────────────────────────────────────┘
│ provider's schedule.                │          Delete my account is inert for 700 ms
│ [ Download my data first ]          │          after this step appears.
│ [ Cancel ]            [ Continue ]  │
└─────────────────────────────────────┘
```

### 5.3 After the 202 (replaces the whole app shell)

```
Your account is scheduled for deletion
Your account is locked. Your data won't be erased before November 13, 2026.
To restore your account before then, contact the app owner.
[ Sign out ]
```

### 5.4 Flow summary

- **Download:** tap → one request → file saved by the browser → "Saved …" → optionally Download again from the held bytes.
- **Delete:** Delete account… → (optional download) → Continue → Delete my account → `202` → confirmation → Sign out → Auth0 logout → landing page. Signing in again later shows the closed-account screen (`403 account-deleted`) until the owner restores the account or the purge removes it (after which a login creates a fresh, empty account — Spec 11 §6.5).

### 5.5 Error handling

| Where | Condition | Shown |
|---|---|---|
| Export | offline / `fetch` rejects | "You're offline. Connect and try again." + Try again |
| Export | `429` | "Too many downloads. Try again in {n} seconds." + Try again |
| Export | `5xx`, non-JSON 2xx, save throws | "Couldn't prepare your data." + request id + Try again |
| Export / Delete | `403 account-deleted` | nothing; `["me"]` refetch → `AccountDeleted` |
| Export / Delete | `401` | nothing; the client logs out (`onAuthLost`) |
| Delete | offline / `429` / other | in the step-2 dialog, buttons re-enabled (AC19) |
| Delete | lost response (network error after the server applied it) | the user retries → `403 account-deleted` → done (the date is unknown, so they land on `AccountDeleted`; acceptable, D7) |

---

## 6. Behavior & logic

### 6.1 `requestBlob` and the filename (AC1–AC4)

`client.ts` today has one request path: `request()` builds `fetchOnce`, retries a `401` once with `ignoreCache`, maps a non-2xx through `readError`, then `response.json()`. `requestBlob` needs everything except the last step, so the shared part is extracted, not copied:

```
send(path, options, requestId) → Response      // fetchOnce → (401 → fetchOnce(ignoreCache) → 401 → readError + onAuthLost + throw) → !ok → throw readError
request(path, options)     = send → status 204? : response.json() → schema.parse        (unchanged behavior)
requestBlob(path, options) = send → content-type must include "json" → { blob: await response.blob(), filename: parse(response.headers.get("content-disposition"), fallback) }
```

`response.blob()` can reject mid-stream (a dropped connection on a 3 MB body); it is wrapped in `ApiError.network` so the UI's single `instanceof ApiError` branch holds. The `Accept: application/json` header is correct for this endpoint. The Blob is **not** validated against `AccountExportSchema`: the file is the server's bytes; parsing 3 MB on a phone to check it adds cost and a failure mode for no user benefit, and the server already validates the document on the way out (Spec 11 §6.2). The filename parser lives in `src/api/contentDisposition.ts` (pure; inside the ≥ 90 % `src/api/**` gate). The server's name carries only a UTC date (Spec 11 AC9), but the client sanitizes anyway because a header is untrusted input to `download=`.

### 6.2 The export hook (AC5–AC11)

```
useExportAccount(): { state, exportNow, saveAgain }
  state: idle | preparing | saved { filename } | error { error }
  exportNow(): if state is preparing → return;               (ref guard + disabled button)
               controller = new AbortController(); keep it in a ref
               mutate: api.requestBlob("/v1/account/export", { signal, fallbackFilename: "strength-in-numbers-export.json" })
               onSuccess: hold blob; saveBlob(blob, filename) (a throw → error); state = saved
               onError: if signal.aborted → ignore; if 403 account-deleted → invalidate ["me"]; else state = error
  saveAgain(): saveBlob(heldBlob, filename)  — no request
  cleanup on unmount: controller.abort(); drop the Blob
```

`useMutation` (not `useQuery`): the export is an explicit user action, must never refetch on focus, and `networkMode: "always"` makes offline a visible failure. **Abort is subtle:** the client wraps *every* `fetch` rejection, including an `AbortError`, in `ApiError.network`, so the hook must test `signal.aborted` itself rather than rely on the error type (AC11).

**Copy and the 429 text.** `exportFailure(error)` is a pure function returning `{ text, requestId }`. `n = Math.ceil(retryAfterMs / 1000)`; `parseRetryAfter` already caps at 5 minutes and yields `null` for a non-numeric value, in which case "Try again in a minute." (the budget window is 60 s, Spec 11 D8). There is no countdown: a ticking number would need a timer and a live region for no benefit; **Try again** is never disabled (a too-early tap simply gets another `429` that counts against the IP limiter only if it is excessive).

### 6.3 `saveBlob` and the "Saved" wording (AC7, AC8)

An anchor click on a `blob:` URL is the portable path (no File System Access API, no share sheet — brief D-export). The click happens after an `await`, outside the original tap's user-activation window on some browsers; downloads via `<a download>` are not popups and are allowed, but iOS Safari may present its own download prompt or open the JSON in a tab instead of saving silently. The code cannot observe the outcome, so "Saved {filename}" means "handed to the browser"; the held Blob and **Download again** exist precisely so a user whose first attempt went nowhere can retry without spending the rate-limit budget. The phone check (AC26) is where the wording is judged. The CSP needs no change: it has no `blob:` source and does not need one, because `default-src` / `connect-src` govern fetches and subresources, not an anchor-initiated download of a same-document `blob:` URL (verified against `render.yaml`; confirmed on a real browser by AC26).

### 6.4 The two-step flow on `ConfirmDialog` (AC12–AC19) — O2 resolved

`DeleteAccountFlow` owns `{ open, step, error }` and renders **one** `ConfirmDialog`, switching its props by step:

| Prop | Step 1 | Step 2 |
|---|---|---|
| `title` | "Delete your account?" | "Are you sure?" |
| `children` | explanation + optional Download my data first + its status | explanation + the error, if any |
| `confirmLabel` / `variant` | "Continue" / `primary` | "Delete my account" / `danger` |
| `busy` | false | the delete mutation is pending |
| `onConfirm` | `step = 2` | `mutate()` (after the settle window) |
| `onCancel` | close + reset | close + reset (a pending request continues, AC18) |

**Why this works without a new component** (the reasoning O2 asked for; see D12): `ConfirmDialog` is fully controlled — title, body, labels, variant and `busy` are props re-read on every render — so a second step is just a prop change and needs no "secondary action slot". Its `children` is rendered inside `.body`, **before** the actions row, so a "Download my data first" button there would be the first focusable element in the dialog and the browser's `showModal()` would focus it instead of Cancel, breaking the "safe action receives the initial focus" convention its docstring states (today true only because the actions are the only focusables). The fix is one explicit behavior in the shared component — focus the Cancel button after `showModal()` — which also turns an accident of DOM order into a guarantee for all callers. A new `DeleteAccountDialog` on native `<dialog>` would duplicate the controlled open/close plumbing whose two bugs are written up in `ConfirmDialog`'s comments (the parent-vs-native close race, a second Escape leaving `open` stuck true) — the subtle part is exactly what should not be written twice.

**Two hazards this introduces, and their mitigations.** (1) *In-place step change keeps the Continue button's position and DOM node*; a double-tap on **Continue** delivers its second tap to what is now **Delete my account**. Mitigation: the confirm button is disabled for `STEP_SETTLE_MS` after step 2 appears (AC16) and focus is re-set to Cancel. (2) *Escape during the request* would otherwise hide the outcome: cancel resets the flow but not the mutation, and a failure reopens the dialog at step 2 (AC18), so a stuck `open = true` with a natively closed dialog (the second-Escape race) cannot occur — the flow, not the user's last keypress, is the source of truth.

The actions row gets `flex-wrap: wrap` so "Cancel" and "Delete my account" stack rather than overflow at 320 px.

### 6.5 The deleted gate (AC20) — D3

```
useDeleteAccount():   useMutation({ mutationKey: ["account","delete"], gcTime: Infinity, networkMode: "always",
                                    mutationFn: () => api.delete("/v1/account", AccountDeletedResponseSchema),
                                    onError: 403 account-deleted → invalidate ["me"] })
useAccountDeletion(): useMutationState({ filters: { mutationKey: ["account","delete"], status: "success" },
                                         select: (m) => m.state.data })  →  AccountDeletedResponse | undefined
ProtectedLayout:      const deletion = useAccountDeletion();   const query = useMe({ enabled: !deletion });
                      if (deletion) return <AccountDeletedConfirmation response={deletion} />;   // before the me-query branches
AccountDeletedConfirmation: on mount → queryClient.cancelQueries(); queryClient.removeQueries()     // never clear(): it also empties the mutation cache and would revert this gate
```

Rendering the confirmation *instead of* `<CatalogProvider>…<AppShell/>` unmounts every provider that could call `/v1` (catalog sync, the outbox drain, the history / progress / routine clients), which is what actually stops traffic; clearing the query cache alone would not, because a mounted provider re-fetches. The confirmation reads `me.timezone` from the `["me"]` cache before it is removed (it captures it on first render). `useMe`'s `enabled` is a first-class option (`UseMeOptions`).

**Query cache and logout.** `logoutAndClear` clears `localStorage` keys and redirects to Auth0 — it does **not** touch the `QueryClient`; the in-memory cache dies because Auth0's logout is a full page navigation. The explicit `removeQueries()` above therefore matters only for the interval between the `202` and the Sign out tap (an open tab left on the confirmation screen), and for tests.

**What an unsynced outbox means here.** Sets still queued in `sin:workout:outbox` are not drained after the swap (the provider is gone) and are removed by Sign out's `clearUserData`; the account's server data is erased anyway, so nothing a user wanted is lost that was not already condemned. The step-1 copy does not mention it.

### 6.6 The erase date (AC21)

`formatEraseDate(iso, timeZone)` → `new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone }).format(new Date(iso))`, in a `try` that retries without `timeZone` on a `RangeError` (a host whose ICU lacks the stored zone — the same case `ProfileScreen` handles for its select). The wording is **"won't be erased before {date}"**: `purgeEligibleAt` is the *earliest* purge time, and the monthly operator run can be up to ~30 days later (Spec 11 O1, resolved: "at least 30 days").

### 6.7 Edge cases

- **Export while a delete races it** (another device): the export gets `403 account-deleted` → AC10.
- **Delete from two devices at once:** the loser's `403 account-deleted` is "done" (Spec 11 AC17) → AC19.
- **The export is large** (Spec 11 D15: ~3 MB per couple of years): held as one Blob; released on unmount. No size cap in the UI.
- **The user keeps the tab open on the confirmation screen:** nothing polls; the screen is inert until Sign out.
- **The user signs in again before the purge:** `ProtectedLayout`'s `GET /v1/me` → `403 account-deleted` → `AccountDeleted` (logs out again). The copy there says to contact the app owner (D15, O1).
- **Back button after the delete:** the Profile route remounts under the same gate (`deletion` is in the mutation cache), so the confirmation screen is shown again, not the app.

### 6.8 File layout

```
apps/web/src/api/                  client.ts (send, requestBlob), contentDisposition.ts (+ tests)
apps/web/src/features/account/     AccountDataSection.tsx, DeleteAccountSection.tsx, DeleteAccountFlow.tsx,
                                   AccountDeletedConfirmation.tsx, useExportAccount.ts, useDeleteAccount.ts (+ useAccountDeletion),
                                   saveBlob.ts, exportFailure.ts, formatEraseDate.ts, messages.ts, *.module.css, tests
apps/web/src/features/me/          ProfileScreen.tsx (two sections; one useExportAccount instance)
apps/web/src/app/                  ProtectedLayout.tsx (the deleted gate)
apps/web/src/ui/                   ConfirmDialog.tsx / .module.css (explicit Cancel focus, wrapping actions)
apps/web/src/screens/              AccountDeleted.tsx (copy only)
apps/web/src/test/                 a11y.test.tsx additions; msw handlers for the two routes
```

---

## 7. Security & privacy

- **Authorization is the server's** (Spec 11 §7): the UI sends no account identifier; both calls act on the token's user. The UI adds no authority.
- **The downloaded file is the user's most sensitive artifact** (email, timezone, every workout and note). It is a `no-store` response; the app holds it in memory only (never `localStorage`, `sessionStorage`, IndexedDB or the outbox), drops it on unmount, and never logs, tracks or reports its content or name (AC24). Once saved it is outside the app's control — it sits in the device's Downloads and may sync to a cloud drive. The one-line description under the button names what the file contains; no further warning is added in the beta.
- **A header is untrusted input to a filesystem name:** the filename is sanitized (AC2) before it reaches `download=` and before it is shown.
- **Delete is guarded by two taps and a time lock, not by re-authentication** (Spec 11 D14). A person holding an unlocked phone with the app open can delete; the 30-day window and the owner's manual restore are the safety net. Upgrade path unchanged: a recent `auth_time` on `DELETE /v1/account`.
- **No text from the user or the server is rendered as markup;** error copy comes from a static table and the request id.
- **Retention honesty:** the step-1 copy says "at least {N} days" (never "after 30 days") and mentions backups; the Auth0 identity survives and is removed by the owner on request (Spec 11 O2, D3, D14 here).
- **CSP:** unchanged (§6.3); `blob:` is not added to any source list.

---

## 8. Config & secrets

None. No env var, secret, flag or dependency. The grace period comes from `@sin/core`'s `ACCOUNT_PURGE_GRACE_DAYS`; the settle delay (`STEP_SETTLE_MS = 700`) and the fallback filename are constants in `features/account/`.

---

## 9. Observability

No new `track()` event or property (D10) — `track` is a no-op until Spec 13, which may add `account_export_downloaded` / `account_deleted` as product events. `reportError` is called only for an **unexpected** non-`ApiError` thrown inside the export path (for example `saveBlob`), with static tags (`source: "account-export"`), never with the Blob, filename or message text; expected failures (offline, `429`, `4xx`, `5xx`) are shown to the user, not reported. The server already logs `account_exported` (counts only) and `account_deleted` (user id only) (Spec 11 §9); the request id shown on error notices is how a tester's report is correlated.

---

## 10. Testing

**Runner:** Vitest with Testing Library + user-event and the existing msw harness; the API client is tested with a stubbed `fetch` like `client.test.ts`. Pure modules (`filenameFromContentDisposition`, `exportFailure`, `formatEraseDate`) are written test-first and table-driven. jsdom has no `<dialog>` `showModal()` focus behavior or Escape/back (the setup shim only toggles the attribute); those are AC26. New files: `api/contentDisposition.test.ts`, `api/client.blob.test.ts`, `features/account/{AccountDataSection,DeleteAccountFlow,AccountDeletedConfirmation,saveBlob,exportFailure,formatEraseDate,hygiene}.test.tsx`, `app/ProtectedLayout.deleted.test.tsx`, `acTags.12.test.ts`.

| Criterion | Level | Verified by |
|---|---|---|
| AC1 | unit | `client.blob.test.ts`: stubbed `fetch`; headers; returned Blob read back byte-equal to a body containing non-ASCII and CRLF; filename from the header; `ApiClient` exposes the method |
| AC2 | unit | `contentDisposition.test.ts` table (quoted, unquoted, `filename*`, both, traversal, control chars, empty, long, missing, bad percent-encoding) |
| AC3 | unit | `client.blob.test.ts`: 429 + `Retry-After: 12` → `retryAfterMs` 12000; problem+json; non-JSON error body; `fetch` reject; `blob()` reject; 2xx `text/html` → `Malformed response` |
| AC4 | unit | `401` → one retry with `ignoreCache` → `onAuthLost`; aborted signal rejects; the existing `client.test.ts` / `client.lostSession.test.ts` unmodified (CI) |
| AC5 | component | `AccountDataSection.test.tsx` idle render in `ProfileScreen.test.tsx`'s harness; zero requests |
| AC6 | component | request log has one `GET`; busy label / `aria-busy` / status region; `fireEvent` double click → one request |
| AC7 | component | spy on `saveBlob`: called once with the Blob and filename; "Saved …" status; Download again → `saveBlob` twice, requests still one; Blob released on unmount |
| AC8 | unit | `saveBlob.test.ts`: stub `URL.createObjectURL` / `revokeObjectURL` and `HTMLAnchorElement.click`; assert `href`, `download`, removal, deferred revoke, propagation of a throw; storage spy untouched |
| AC9 | unit + component | `exportFailure.test.ts` table incl. `retryAfterMs` 1 500 → 2, null → "a minute"; component: each message with a **Try again** that re-requests |
| AC10 | component | `ProtectedLayout.deleted.test.tsx` harness: export / delete `403 account-deleted` → no notice, `["me"]` refetched, `AccountDeleted` rendered; `401` → `onAuthLost` spy, no notice |
| AC11 | component | unmount mid-request: `signal.aborted`, no notice, no `reportError`, no `saveBlob`; offline fake → network failure copy, no pending forever; outbox and storage spies untouched |
| AC12 | unit | `ConfirmDialog.test.tsx` addition (body button, active element = Cancel); `flex-wrap` present in the module CSS; the four callers' tests unmodified (CI) |
| AC13 | component | order of regions in `ProfileScreen`; button variant; not inside the form; click opens the dialog and sends nothing |
| AC14 | component | dialog text contains `${ACCOUNT_PURGE_GRACE_DAYS} days` (value imported, not typed); scan for numeric literals in `features/account/`; DOM order and active element |
| AC15 | component | one `useExportAccount` instance (spy count); dialog button states; Continue never disabled by the export |
| AC16 | component (fake timers) | step 2 content; confirm disabled at 0 ms and 699 ms, enabled at 700 ms; no request before activation |
| AC17 | component | Cancel button / `Escape` / dialog `cancel` event at both steps → closed, request log empty, step reset on reopen, trigger focused (jsdom: the focus-return assertion only where the shim supports it, else AC26) |
| AC18 | component | one `DELETE` with no body; disabled + `aria-busy`; double click → one request; Escape mid-request → handled outcome |
| AC19 | component | network / 429 / 500 / `403 account-deleted` each; buttons re-enabled; reopen at step 2 after an Escape-closed failure; retry re-requests |
| AC20 | component + integration | `ProtectedLayout.deleted.test.tsx`: after the 202, providers unmounted (mount-spies), `useMe` disabled, queries removed, request log empty over 5 s of fake timers + `focus` / `online` events |
| AC21 | unit + component | `formatEraseDate` table (UTC day boundary, `America/Los_Angeles`, `Pacific/Auckland`, unknown zone fallback); screen text; heading focus; one button; no nav |
| AC22 | component | Sign out → `logout` spy and storage cleared (the 06.0 AC20 pattern); the logout scan test unmodified; `AccountDeleted` copy; its test unmodified |
| AC23 | component + CI | `a11y.test.tsx` additions; `assert:css-tokens` |
| AC24 | source scan + spy | `hygiene.test.tsx` in the `supersets.hygiene.test.ts` style; Spec 04.0 AC7 scan unmodified |
| AC25 | CI | `git diff main --stat` path review; `pnpm --filter @sin/web run test:coverage`; lint / typecheck / build |
| AC26 | manual | below |
| AC27 | review | the §11 diffs; `acTags.12.test.ts` |

**AC26 — manual phone check (owner; recorded in the PR description).** On an iPhone (Safari) and an Android phone (Chrome), against staging:

1. Profile → **Download my data**: the file reaches Files / Downloads under the expected name; **open it** and confirm it is valid JSON with your workouts; **Download again** works; read the "Saved …" copy and say whether it is honest on that browser.
2. Airplane mode → Download → the offline message; reconnect → **Try again** works. Tap the button four times quickly across a minute → the "Try again in N seconds" copy on the fourth.
3. With a **throwaway staging account** (never the e2e test user): Delete account… → Download my data first → Continue → **double-tap Continue** and confirm the delete does *not* fire → Cancel and confirm nothing happened; repeat and press Escape / Android back at each step.
4. Complete the delete: the confirmation shows the right local date and the app owner line; **Sign out**; sign in again → the closed-account screen; the owner restores the account with the runbook `UPDATE` (Spec 11 §11) and confirms a login works.
5. At **320 px and 390 px**: nothing scrolls sideways on Profile or in either dialog step; "Cancel" and "Delete my account" stay reachable one-handed; every control is ≥ 44 px; VoiceOver / TalkBack read the dialog title then its body, and focus starts on Cancel.

**Coverage.** `src/api/**` ≥ 90 % (existing gate) with the new code; `features/account/` is written to ≥ 90 % lines (no new CI threshold). No Playwright change (non-goal).

---

## 11. Deployment & rollback

- **Web only. No API change, no migration, no release step, no env var.** Spec 11 is already on `main` and staging. Merge to `main` → Render static-site auto-deploy → the existing post-deploy smoke and e2e jobs (unchanged; neither touches Profile's new sections).
- **Staging check after deploy:** the AC26 steps 1 and 4 against the throwaway staging account; this also closes Spec 11's owed "staging export check".
- **Rollback:** revert the PR; the previous bundle has no account sections. Accounts deleted through the UI in the meantime stay valid soft-deleted accounts (`403 account-deleted` from `resolveUser`, which predates Spec 11). The `ConfirmDialog` change is internal to that component.
- **Cross-doc updates (applied with this draft):** `docs/specs/README.md` row 12; DESIGN.md §2 item 1 and the "Last updated" line; Spec 11's UI non-goal now links here.
- **At implementation time (not by this draft):** README row 12 → Implemented; DESIGN.md §9 M4 row needs no change (it already names Spec 12); `docs/runbooks/first-deploy.md` "Account deletion requests" gains one line that testers can now request deletion themselves in the app (the operator steps are unchanged); CLAUDE.md gains the line below and the *Web logout + user data* bullet gets "the delete confirmation's Sign out is `useSession().logout`" by reference.

**CLAUDE.md line to add at implementation:**

- "**Account lifecycle UI** (Spec 12): downloads go through `ApiClient.requestBlob` (token, 401 refresh, `ApiError`, `Retry-After`, filename from `Content-Disposition`) and `saveBlob` — never a bare `fetch` or an `<a href>` to the API; the export Blob is never parsed or stored. `useExportAccount` is called once in the Profile form and shared with the delete dialog. The delete result lives in the TanStack **mutation** cache (`["account","delete"]`, `gcTime: Infinity`) and `ProtectedLayout` renders `AccountDeletedConfirmation` instead of the app when it is set — so no provider can call `/v1` again; never `queryClient.clear()` there (it empties the mutation cache and reverts the gate). A `403 account-deleted` from any account call means 'done': invalidate `["me"]` and let the layout render `AccountDeleted`. The grace days in copy come from `ACCOUNT_PURGE_GRACE_DAYS`; copy says 'at least', 'erase', never 'purge'. `ConfirmDialog` focuses Cancel explicitly."

---

## 12. Decisions & open questions

### Resolved (owner-approved 2026-10-14, from the brief)

- ✅ **D1 — Placement: sections on the existing Profile screen, not a sub-screen (brief D-placement).** "Your data" under the form, "Delete account" last. **Rationale:** two controls do not justify a route, a nav entry or a back stack; the danger section at the very bottom (after Log out) keeps it out of the thumb's natural resting zone. **Rejected:** a separate Account screen.
- ✅ **D2 — Two-step dialog, no typing, an optional (not forced) download (brief D-confirm).** Step 1 explains and offers the download; step 2 is the plain "Are you sure?". **Rationale:** a typed confirmation is hostile on a phone keyboard; a forced download would turn a sentence of advice into a flow with its own failure states (offline, rate limit) that could block a legitimate delete. The architect's additions (AC16): the 700 ms inert window and the explicit Cancel focus — **qualifications to the brief, not reversals**: the brief said "Cancel first in DOM, gets initial focus (ConfirmDialog convention)", and reading the component showed the convention holds only while the dialog has no other focusable element (D12). **Rejected:** typing the word DELETE; forcing the download; a single-step dialog.
- ✅ **D3 — After the 202 the app shows a terminal confirmation (not an auto-logout), rendered by `ProtectedLayout` (brief D-after; the mechanism is the architect's).** Reading the code corrected two assumptions: (a) nothing in the app handles a `403 account-deleted` except `ProtectedLayout`'s branch on `GET /v1/me`, and the Profile screen sits inside providers that keep calling `/v1`; "stop /v1 queries" is therefore only achievable by *not rendering those providers*; (b) the result must outlive the Profile screen, so it lives in the mutation cache (`gcTime: Infinity`) read by `useMutationState`. **Rejected:** a local `useState` in `ProfileScreen` (providers stay mounted and keep fetching); `queryClient.clear()` (also empties the mutation cache, un-setting the gate); navigating to a new route (a Back press would return to a live-looking app); an immediate auto-logout (the user never learns the erase date or that the owner can restore it).
- ✅ **D4 — Export: one button, online-only, held Blob (brief D-export).** `networkMode: "always"`, no outbox, no share sheet; the held Blob allows **Download again** without a second request. **Rationale:** the export is a user-initiated, rarely used, large read — queuing it offline makes no sense, and the 3-per-minute budget (Spec 11 D8) should not be spent by a re-save. **Cost:** up to a few MB of memory while the screen is open.
- ✅ **D5 — The client gets `requestBlob`, built on a shared `send()` (brief).** **Rationale:** a one-off `fetch` would duplicate token handling, the 401 refresh and `onAuthLost`, and escape the ≥ 90 % `src/api` gate. **Rejected:** a bare `fetch` in the hook; adding a `responseType` option to `request()` (a flag that changes the return type is worse typing than a second method).

### Resolved by reading the code (corrections and qualifications to the brief)

- ✅ **D6 — Filename parsing is a separate, sanitizing, pure function with a client-side fallback.** The server sends only a UTC date in a quoted `filename`, but the header is untrusted input to `download=`; the fallback covers a missing header when CORS exposure regresses.
- ✅ **D7 — A `403 account-deleted` from the export or the delete is handled by invalidating `["me"]`, not by "existing app handling".** The brief said such a 403 goes to "existing app handling". It does not: the 401 path is global (`onAuthLost`), but `account-deleted` is recognized in exactly one place (`ProtectedLayout`, for the `me` query), so an export or delete `403` would otherwise surface as a generic error. Invalidating `["me"]` reuses that branch (the refetch is a `403`; a query with data keeps `isError` after a failed refetch) with no new global interceptor. **Consequence:** a user whose delete succeeded but whose response was lost lands on `AccountDeleted` without seeing the erase date — acceptable for a rare path. **Rejected:** a global `account-deleted` interceptor in the client (cross-cutting for two callers; the React-free client has no way to render).
- ✅ **D8 — Copy says "at least {N} days" and "won't be erased before {date}", not "permanently erased after 30 days" (brief wording corrected by Spec 11 O1).** The owner resolved Spec 11 O1 on 2026-10-11: the purge is a monthly hand-run job, so a deletion can wait up to ~60 days; Spec 12 must say "at least 30 days". `purgeEligibleAt` is the earliest time, so the screen says "before", never "on". The word "erase" is used; "purge" never appears in copy. **Not done:** "typically within 60 days" — that is the operator's cadence, not a promise the product code can keep or a constant it owns.
- ✅ **D9 — The erase date is formatted in the profile's `timezone`, not the device's.** The brief says "user's timezone"; `Me.timezone` is that (an IANA name the user chose), consistent with how `local_date` is derived server-side. An unknown zone falls back to the device zone (the same ICU gap `ProfileScreen` already tolerates).
- ✅ **D10 — No analytics events, no new `reportError` use for expected failures.** **Rationale:** `track` is a no-op until Spec 13; an event named for deletion has no consumer yet and the properties would be tempting to over-fill. Same reasoning as 10.2 D10 / 10.3 D13.
- ✅ **D11 — Cancel during an in-flight delete resets the flow but cannot unsend; a failure reopens step 2.** The request is already on the wire; pretending Cancel stops it would be a lie, and keeping the dialog open on Escape would trap the second-Escape race (`ConfirmDialog`'s own comments). The outcome is always surfaced.
- ✅ **D12 — O2 resolved: extend `ConfirmDialog`; no new dialog and no secondary-action slot.** Reasoning from the code (§6.4): the component is controlled and re-reads every prop, so a second step is a prop change — no new API is needed for the steps. The only defect is initial focus: `children` precedes the actions in the DOM, so an in-body Download button would take focus from Cancel. The fix (focus Cancel after `showModal()`, plus a wrapping actions row for 320 px) is two small, behavior-preserving changes that strengthen a guarantee its docstring already makes. **Rejected:** (a) a `secondary` slot inside the actions row (three buttons in a row at 320 px; and still the DOM-order focus issue unless Cancel is first, which the slot would have to special-case); (b) a new `DeleteAccountDialog` (duplicates the controlled-`<dialog>` race handling — the exact part that is easy to get wrong twice); (c) `autoFocus` on the Cancel `Button` (React calls `focus()` when the element mounts, before `showModal()` has made the dialog rendered and focusable — unreliable).
- ✅ **D13 — One `useExportAccount` instance per Profile screen, shared by the section and the dialog.** Two instances would be two requests, two Blobs and two budget tokens for what the user sees as one action.
- ✅ **D14 — The retention statement (Spec 11 O2) appears once, in step 1: "Backups age out on the hosting provider's schedule."** Spec 11 O2 was resolved to a one-line statement "before anyone outside the closed beta is promised erasure"; the brief did not mention it. It is added as one sentence, removable by the owner without touching logic; the Auth0 half ("removed on request") is the runbook's and is not in the UI because the in-app contact route is O1.
- ✅ **D15 — `AccountDeleted`'s copy changes from "contact support" to "contact the app owner".** The screen (Spec 04.0) auto-logs out on mount, so the text is seen only briefly, but it should not say "support" while the confirmation says "app owner" and no support channel exists. One string, no behavior change; its stale docstring ("the account row is gone") is corrected in passing. Both strings move together when O1 resolves.
- ✅ **D16 — The export Blob is not validated or parsed on the client.** See §6.1.

### Open

- **O1 — A real support contact.** The copy says "contact the app owner" (confirmation screen and `AccountDeleted`) because no support address or channel exists in the app. When the owner supplies one (an email, a form), both strings change — one constant in `messages.ts`, plus `AccountDeleted.tsx`. *Recommendation:* a `mailto:` link the owner controls, added before the first non-friend tester; it needs no spec change beyond the strings. Not blocking: the beta's testers know the owner.
- ✅ **O2 — `ConfirmDialog` extension vs a new dialog.** *Resolved in this draft (architect), from the code: extend — see D12.*
