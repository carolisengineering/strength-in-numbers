# Screenshot harness (Spec 17.0 §6.10)

```
pnpm --filter @sin/web run screens
```

This renders every logged-in screen with a fake Auth0 module and fake API data, plus the logged-out front door (Spec 17.3: the landing, its focused button, `Resuming your session…` via the Auth0 hint cookie, a 320 x 568 landing under `mobile-320/`, and the landing under the Dark override). The front door's layout measurements go to `_report.json` under `frontDoor`, and any violation fails the run. It captures each screen in light and dark, at 390 px (phone, 2×) and 1280 px, into `apps/web/.screens/<theme>/<device>/`, which is gitignored. Each screen gets a viewport PNG, a full-scroll `-full.png` and a `.layout.json`. The JSON lists every control's box, small tap targets, overlapping controls, and what the sticky bars cover. `_report.json` collects unmatched API calls and console errors. The run takes a few minutes.

**Options**
- `SCREENS_THEMES=light` captures one theme; `SCREENS_DEVICES=mobile` captures one viewport.
- `SCREENS_KEEP_SERVER=1` leaves the server running afterward, so you can browse the fake app at http://localhost:5287.
- `SCREENS_PORT` changes the port.

**Checks that fail the run (Spec 17.13 Phase C)**
- **Tap targets.** Every enabled, visible control on every screen is at least 44 × 44 px. A radio or checkbox counts its label's box. An input whose value is wider than its field is reported separately as `clippedInputs`, and fails the run only on the session screens, because the 80-character name fixture is meant to overflow its field.
- **Zoom.** `zoomPass` captures nine screens (active workout, picker, edit sheet, routine item sheet, History, exercise page, summary, routine editor, Profile) in the light theme at 320 × 568 (`mobile-320-reflow/`) and at 390 × 844 with the root font size at 200% (`mobile-200pct/`). A screen fails on sideways scroll of the page, `<main>` or an open sheet's body, on an overlap, or on a primary action outside the viewport after scrolling it into view. A small target, a clipped input or a sheet-row problem on a zoom shot is a zoom finding too, and the run-wide checks skip those shots. A finding that isn't fixed gets a `docs/backlog.md` entry and a `ZOOM_KNOWN` row (`{ shot, item, bl }`, matched exactly). Results go to `_report.json` under `zoom`; an empty `zoom` on a mobile run fails too.
- **Keypad frame.** In `01k-workout-keyboard-up` the header has no box, `<main>` ends at or above the frame's bottom, and it scrolls (`keyboardFrame`).

**How it works**
- `run.mjs` starts Vite with `vite.config.mjs`. That config aliases `@auth0/auth0-react` to `fake-auth0-react.js`, which reports a signed-in user. `capture.mjs` then drives Playwright's Chromium.
- Playwright intercepts `/v1/*` and serves `data.mjs`. Before capturing anything, the script checks every payload against the real `@sin/core` schemas, so the app's strict local parsing accepts them.

**Safety:** the fake auth module would bypass login if it ever shipped, so three things keep it out of the production app:
- It's reachable only through this directory's Vite config. The app's `vite.config.ts` and `src/**` never reference `scripts/screens/`, and a unit test checks this.
- `assert:build-output` fails if its marker string appears in `dist/`.
- The data is clearly fake example data.

It's a dev tool, like the `bench:*` scripts, and isn't run in CI.
