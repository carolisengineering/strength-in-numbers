import { expect, test } from "@playwright/test";

import { E2E } from "./env";
import {
  atNarrowViewport,
  card,
  EXERCISES,
  expectFocusContained,
  expectNoHorizontalOverflow,
  expectTapTargets,
  installGuards,
  logBar,
  makeCurrent,
  NAMES,
  openDialog,
  pendingOutboxOps,
  waitSynced,
  warmApi,
} from "./helpers";

/**
 * Spec 06.3 — the M1 happy path against deployed staging, as one ordered run:
 * the steps share one workout, so they are `test.step`s of a single test.
 */
// The setup project warms the API before it logs in; this covers a run with
// a reused login (`--no-deps`) or a long gap since setup.
test.beforeAll(async ({ request }) => {
  await warmApi(request, E2E.apiUrl);
});

test("M1 happy path on staging (Spec 06.3 AC1–AC4)", async ({ page }) => {
  const guards = await installGuards(page);
  const workouts = `${E2E.baseUrl}/app/workouts`;
  const finishButton = page.getByRole("button", { name: NAMES.finish, exact: true });

  await test.step("AC4 — cold load resumes through /authorize with no credential form", async () => {
    const authorize = page.waitForRequest((r) => r.isNavigationRequest() && /\.auth0\.com\/authorize/.test(r.url()));
    await page.goto(workouts);
    await authorize;
    await page.waitForURL(workouts);
    await expect(page.locator('input[name="password"]')).toHaveCount(0);
  });

  await test.step("clean slate — discard a leftover workout from a failed earlier run", async () => {
    const start = page.getByRole("button", { name: NAMES.startWorkout });
    const menu = page.getByRole("button", { name: NAMES.workoutMenu });
    await expect(start.or(menu)).toBeVisible();
    if (await menu.isVisible()) {
      await menu.click();
      await page.getByRole("button", { name: NAMES.discardWorkout }).click();
      await openDialog(page, NAMES.discardDialog).getByRole("button", { name: NAMES.discard, exact: true }).click();
      await expect(start).toBeVisible();
    }
  });

  await test.step("AC3 — Start screen at 320 px", async () => {
    await atNarrowViewport(page, async () => {
      await expectNoHorizontalOverflow(page);
      await expectTapTargets(page);
    });
  });

  await test.step("start a workout", async () => {
    await page.getByRole("button", { name: NAMES.startWorkout }).click();
    await expect(page.getByRole("button", { name: NAMES.addExercise })).toBeVisible();
  });

  for (const [index, exercise] of EXERCISES.entries()) {
    await test.step(`add ${exercise.name} and log one synced set`, async () => {
      const add = page.getByRole("button", { name: NAMES.addExercise });
      await add.click();
      const search = page.getByRole("searchbox", { name: NAMES.searchExercises });
      const picker = page.getByRole("dialog").filter({ has: search });
      if (index === 0) {
        // AC4 — focus lands on Close, not the search field; Escape closes and returns focus.
        await expect(picker.getByRole("button", { name: NAMES.close })).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(picker).toBeHidden();
        await expect(add).toBeFocused();
        await add.click();
      }
      await search.fill(exercise.name);
      await picker.getByRole("button", { name: new RegExp(`^${exercise.name}\\b`) }).first().click();
      const exerciseCard = card(page, exercise.name);
      await expect(exerciseCard).toBeVisible();

      const form = exerciseCard.getByRole("form", { name: NAMES.logSetForm(exercise.name) });
      for (const [label, value] of Object.entries(exercise.fields)) {
        await form.getByLabel(label, { exact: true }).fill(value);
      }
      await logBar(page).click(); // a just-added exercise is current (Spec 17.1 AC13)
      await waitSynced(page, exerciseCard, 1);
      await expect(exerciseCard.getByRole("listitem").first()).toContainText(exercise.shows);
    });
  }

  await test.step("AC3 — session screen at 320 px", async () => {
    await atNarrowViewport(page, async () => {
      await expectNoHorizontalOverflow(page);
      await expectTapTargets(page);
    });
  });

  await test.step("AC1 — with the outbox empty, a reload restores everything from the server", async () => {
    await expect(finishButton).toBeEnabled();
    expect(await pendingOutboxOps(page)).toBe(0);
    await page.reload();
    await page.waitForURL(workouts);
    for (const exercise of EXERCISES) {
      const exerciseCard = await makeCurrent(page, exercise.name);
      await expect(exerciseCard.getByRole("listitem")).toHaveCount(1);
      await expect(exerciseCard.getByRole("listitem").first()).toContainText(exercise.shows);
    }
  });

  await test.step("reorder: Options → Move up survives a reload", async () => {
    const pullUp = await makeCurrent(page, EXERCISES[1].name);
    await pullUp.getByRole("button", { name: NAMES.options(EXERCISES[1].name) }).click();
    await pullUp.getByRole("button", { name: NAMES.moveUp }).click();
    const articles = page.getByRole("article");
    await expect(articles.first()).toHaveAccessibleName(EXERCISES[1].name);
    await expect(finishButton).toBeEnabled();
    await page.reload();
    await page.waitForURL(workouts);
    await expect(articles.first()).toHaveAccessibleName(EXERCISES[1].name);
    await expect(articles.nth(1)).toHaveAccessibleName(EXERCISES[0].name);
  });

  await test.step("edit a set in the sheet and wait for it to sync", async () => {
    const bench = await makeCurrent(page, EXERCISES[0].name);
    await bench.getByRole("listitem").first().getByRole("button").click();
    const sheet = openDialog(page, `Set 1 · ${EXERCISES[0].name}`);
    await sheet.getByLabel("Reps", { exact: true }).fill("6");
    await sheet.getByRole("button", { name: NAMES.save }).click();
    await expect(sheet).toBeHidden();
    await waitSynced(page, bench, 1);
    await expect(bench.getByRole("listitem").first()).toContainText(/60 (kg|lb) × 6/);
  });

  await test.step("remove an exercise; the confirm dialog traps focus and Escape cancels (AC4)", async () => {
    const run = await makeCurrent(page, EXERCISES[4].name);
    const removeButton = run.getByRole("button", { name: NAMES.removeExercise });
    await run.getByRole("button", { name: NAMES.options(EXERCISES[4].name) }).click();
    await removeButton.click();
    const confirm = openDialog(page, NAMES.removeDialog(EXERCISES[4].name));
    await expect(confirm).toBeVisible();
    await expectFocusContained(page, confirm);
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    await expect(run).toBeVisible();

    if (!(await removeButton.isVisible())) {
      await run.getByRole("button", { name: NAMES.options(EXERCISES[4].name) }).click();
    }
    await removeButton.click();
    await confirm.getByRole("button", { name: NAMES.remove, exact: true }).click();
    await expect(run).toHaveCount(0);
  });

  let workoutId = "";
  await test.step("finish through the confirm dialog and read the summary", async () => {
    await finishButton.click();
    await openDialog(page, NAMES.finishDialog).getByRole("button", { name: NAMES.finishConfirm, exact: true }).click();
    await expect(page.getByRole("heading", { name: NAMES.summaryHeading })).toBeVisible();
    workoutId = new URL(page.url()).pathname.split("/").pop() ?? "";
    for (const exercise of EXERCISES.slice(0, 4)) {
      await expect(page.getByText(exercise.name, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText(EXERCISES[4].name, { exact: true })).toHaveCount(0);
  });

  // Spec 08.1 AC28 — no value is asserted (08.0 D12): the row exists whenever any finished workout trained the lift.
  // Spec 18.2 AC28: the tab is Exercises (All exercises by default); the old Progress path still redirects.
  await test.step("Spec 08.1 / 18.2 — Exercises lists the bench press and opens its chart", async () => {
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: NAMES.exercises }).click();
    const row = page.getByRole("link", { name: NAMES.benchRow });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByRole("img", { name: NAMES.chartSummary })).toBeVisible();
    await expect(page.getByRole("group", { name: NAMES.metricGroup })).toBeVisible();
    // A full load: it may go through the Auth0 round trip (memory-only tokens) before the redirect.
    await page.goto("/app/progress");
    await expect(page).toHaveURL(/\/app\/exercises\/records$/, { timeout: 15_000 });
    await expect(page.getByRole("navigation", { name: "Exercise views" })).toBeVisible();
  });

  await test.step("Spec 20.0 AC1 — the test user sees no Hevy", async () => {
    await page.getByRole("link", { name: NAMES.profileLink }).click();
    await expect(page.getByRole("heading", { level: 1, name: NAMES.profile })).toBeVisible();
    // The status read settles to the 404 for anyone not on HEVY_ENABLED_USER_IDS; nothing Hevy is drawn either way.
    await expect(page.getByText(/hevy/i)).toHaveCount(0);
  });

  // Spec 08.0 AC26 — no PR content is asserted: whether a run sets a record depends on the account's history (D12).
  await test.step("Spec 08.0 — the finished workout is in History and opens from there", async () => {
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: NAMES.history }).click();
    const row = page.locator(`a[href="/app/history/${workoutId}"]`);
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByRole("heading", { name: NAMES.summaryHeading })).toBeVisible();
    await expect(page.getByRole("link", { name: NAMES.backToHistory })).toBeVisible();
  });

  await test.step("delete the workout from the History summary, land on History, then Start", async () => {
    await page.getByRole("button", { name: NAMES.workoutMenu }).click(); // #107: Delete lives in the Workout menu
    await page.getByRole("button", { name: NAMES.deleteWorkout }).click();
    await openDialog(page, NAMES.deleteDialog).getByRole("button", { name: NAMES.delete, exact: true }).click();
    await expect(page).toHaveURL(/\/app\/history$/);
    await expect(page.locator(`a[href="/app/history/${workoutId}"]`)).toHaveCount(0);
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: NAMES.workouts }).click();
    await expect(page.getByRole("button", { name: NAMES.startWorkout })).toBeVisible();
  });

  await test.step("AC2 — no CSP violations or console errors across the whole run", async () => {
    guards.assertClean();
  });
});
