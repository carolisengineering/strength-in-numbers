import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/**
 * Spec 06.3 §3 — every accessible name the smoke depends on. A spec that
 * renames one of these updates this table in the same PR.
 */
export const NAMES = {
  startWorkout: "Start workout",
  addExercise: "Add exercise",
  searchExercises: "Search exercises",
  close: "Close",
  logSet: "Log set",
  logSetForm: (exercise: string) => `Log a set of ${exercise}`,
  options: "Options",
  moveUp: "Move up",
  removeExercise: "Remove exercise",
  save: "Save",
  finish: "Finish",
  finishDialog: "Finish workout?",
  discardWorkout: "Discard workout",
  discardDialog: "Discard this workout?",
  discard: "Discard",
  removeDialog: (exercise: string) => `Remove ${exercise}?`,
  remove: "Remove",
  summaryHeading: "Workout summary",
  deleteWorkout: "Delete workout",
  deleteDialog: "Delete this workout?",
  delete: "Delete",
  history: "History",
  workouts: "Workouts",
  backToHistory: "Back to History",
  logIn: "Log in",
  notSavedYet: /not saved yet/i,
  couldNotSave: /couldn.t be saved|couldn.t save/i,
} as const;

/**
 * AC1 / D5 — one catalog exercise per modality, the values to log, and the
 * row text `formatSet` renders for them (unit-agnostic: the test user's
 * preferred units decide kg/lb and km/mi).
 */
export const EXERCISES = [
  { name: "Barbell bench press", fields: { Weight: "60", Reps: "5" }, shows: /60 (kg|lb) × 5/ },
  { name: "Pull-up", fields: { Reps: "8" }, shows: /8 reps/ },
  { name: "Weighted dip", fields: { "Added weight": "10", Reps: "6" }, shows: /\+10 (kg|lb) × 6/ },
  { name: "Plank", fields: { Minutes: "1", Seconds: "30" }, shows: /1:30/ },
  { name: "Treadmill run", fields: { Distance: "2", Minutes: "12", Seconds: "0" }, shows: /2 (km|mi) · 12:00/ },
] as const;

const OUTBOX_KEY = "sin:workout:outbox";

export function card(page: Page, exercise: string): Locator {
  return page.getByRole("article", { name: exercise, exact: true });
}

export function openDialog(page: Page, name: string | RegExp): Locator {
  return page.getByRole("dialog", { name });
}

/**
 * AC2 — the one console error that is not a defect. `GET /v1/workouts/active`
 * answers 404 when there is no workout in progress (Spec 05.0) and the client
 * reads that as "show Start" (`workoutClient.getActive`), but Chromium still
 * logs every 4xx response as "Failed to load resource". Only that exact pair —
 * a 404 on that URL — is ignored.
 */
function isExpectedNoActiveWorkout(text: string, url: string): boolean {
  return /Failed to load resource: .*status of 404\b/.test(text) && /\/v1\/workouts\/active$/.test(url);
}

export interface Guards {
  assertClean(): void;
}

/**
 * AC2 — collect CSP violations and console errors across every navigation.
 * `exposeBinding` survives reloads; the init script re-attaches the listener
 * on each document.
 */
export async function installGuards(page: Page): Promise<Guards> {
  const csp: string[] = [];
  const consoleErrors: string[] = [];
  await page.exposeBinding("__sinCspViolation", (_source, detail: string) => {
    csp.push(detail);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (window as unknown as { __sinCspViolation: (d: string) => void }).__sinCspViolation;
      report(`${event.violatedDirective} blocked ${event.blockedURI} (${event.sourceFile}:${event.lineNumber})`);
    });
  });
  page.on("console", (message) => {
    if (message.type() !== "error" || isExpectedNoActiveWorkout(message.text(), message.location().url)) return;
    consoleErrors.push(`${page.url()} — ${message.text()}`);
  });
  page.on("pageerror", (error) => consoleErrors.push(`${page.url()} — uncaught ${error.message}`));
  return {
    assertClean() {
      expect(csp, "CSP violations").toEqual([]);
      expect(consoleErrors, "console errors").toEqual([]);
    },
  };
}

/** AC3 — no horizontal overflow. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `page ${page.url()} overflows horizontally`).toBeLessThanOrEqual(clientWidth);
}

/** AC3 — every visible interactive element is at least 44 × 44 CSS px. */
export async function expectTapTargets(page: Page): Promise<void> {
  const tooSmall = await page.evaluate(() => {
    const selector = "button, a[href], input:not([type=hidden]), select, textarea, [role=button], summary";
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.height > 0 &&
          getComputedStyle(el).visibility !== "hidden" &&
          !el.closest("[inert], dialog:not([open])")
        );
      })
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width < 44 || r.height < 44)
      .map(({ el, r }) => {
        const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40);
        return `${el.tagName.toLowerCase()} "${label}" ${Math.round(r.width)}×${Math.round(r.height)}`;
      });
  });
  expect(tooSmall, `tap targets under 44×44 on ${page.url()}`).toEqual([]);
}

/**
 * AC4 — a modal `<dialog>` keeps focus off the page behind it. Chromium does
 * not cycle Tab inside the dialog: past its last control focus moves to the
 * browser UI (`activeElement` becomes `body`). So the check is that focus is
 * never on an element *outside* the dialog, in either direction.
 */
export async function expectFocusContained(page: Page, dialog: Locator): Promise<void> {
  const handle = await dialog.elementHandle();
  for (const key of ["Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    const escaped = await page.evaluate((d) => {
      const active = document.activeElement;
      return active && active !== document.body && !d?.contains(active) ? active.outerHTML.slice(0, 80) : null;
    }, handle);
    expect(escaped, `focus left the dialog after ${key}`).toBeNull();
  }
}

/** AC3 — run checks at a 320 px wide viewport, then restore the device size. */
export async function atNarrowViewport(page: Page, check: () => Promise<void>): Promise<void> {
  const original = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 720 });
  try {
    await check();
  } finally {
    if (original) await page.setViewportSize(original);
  }
}

/**
 * Spec 06.3 §6.5 — a logged set is "synced" once its row exists and no
 * unsaved marker remains anywhere on the page. Row first: "no unsaved text"
 * is also true the instant before the row renders. A failed write is a smoke
 * failure, reported as such rather than as a timeout.
 */
export async function waitSynced(page: Page, exerciseCard: Locator, expectedSets: number): Promise<void> {
  await expect(exerciseCard.getByRole("listitem")).toHaveCount(expectedSets);
  const couldNotSave = page.getByText(NAMES.couldNotSave);
  try {
    await expect(page.getByText(NAMES.notSavedYet).or(couldNotSave)).toHaveCount(0);
  } catch (error) {
    // The bar hint counts failed sets too, so name the real cause.
    if ((await couldNotSave.count()) > 0) {
      throw new Error(`e2e: a set write failed against staging: "${await couldNotSave.first().innerText()}"`);
    }
    throw error;
  }
}

/**
 * Spec 06.3 §6.5 — the one place e2e reads browser storage: how many writes
 * the 06.2 outbox still holds. The key itself outlives a full sync (it keeps
 * the id map of the workout's synced sets), so count the ops, not the key.
 */
export async function pendingOutboxOps(page: Page): Promise<number> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw === null ? 0 : (JSON.parse(raw) as { ops: unknown[] }).ops.length;
  }, OUTBOX_KEY);
}

/**
 * Universal Login either lands back on the app ("in") or shows an error
 * ("rejected"). The losing wait keeps running until its timeout or until the
 * page closes, then rejects; it is handled here so that rejection is never
 * left unhandled. If both time out, the race rejects with the first error.
 */
export async function raceLoginOutcome(
  page: Page,
  url: string | RegExp,
  loginError: Locator,
  timeout: number,
): Promise<"in" | "rejected"> {
  const landed = page.waitForURL(url, { timeout }).then(() => "in" as const);
  const refused = loginError.waitFor({ timeout }).then(() => "rejected" as const);
  landed.catch(() => {});
  refused.catch(() => {});
  return Promise.race([landed, refused]);
}

/** Spec 06.3 §6.2 — wake the free-plan API before the first UI action. */
export async function warmApi(request: APIRequestContext, apiUrl: string | undefined): Promise<void> {
  if (!apiUrl) {
    console.warn("e2e: E2E_API_URL is not set — skipping the API warm-up; a cold API may time out the first step");
    return;
  }
  const deadline = Date.now() + 120_000;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await request.get(`${apiUrl}/readyz`, { timeout: 30_000 });
      if (res.ok()) return;
      last = `HTTP ${res.status()}`;
    } catch (error) {
      last = (error as Error).message;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`e2e: API ${apiUrl}/readyz not ready after 120 s (${last})`);
}
