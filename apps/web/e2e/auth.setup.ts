import { expect, test as setup } from "@playwright/test";

import { AUTH_STATE, E2E } from "./env";
import { NAMES, warmApi } from "./helpers";

/**
 * Spec 06.3 §6.1 — drive the real Universal Login once per run and save the
 * Auth0 session cookie + hint cookie. Tokens stay memory-only in the page.
 * Handles both the single-page and the identifier-first login prompts.
 */
setup("log in through Auth0 Universal Login", async ({ page, request }) => {
  // §6.2 — the login lands on a screen that calls the API: wake it first.
  await warmApi(request, E2E.apiUrl);
  const workouts = `${E2E.baseUrl}/app/workouts`;
  await page.goto(workouts);
  await page.getByRole("button", { name: NAMES.logIn }).or(page.getByRole("link", { name: NAMES.logIn })).click();
  await page.waitForURL(/\.auth0\.com\//);

  await page.locator('input[name="username"], input[name="email"]').first().fill(E2E.username);
  const password = page.locator('input[name="password"]');
  if (!(await password.isVisible())) {
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await password.fill(E2E.password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Bad credentials leave Universal Login showing an error: fail with it, not a 60 s timeout.
  const loginError = page.getByText(/wrong (email|username) or password|blocked|too many/i);
  const outcome = await Promise.race([
    page.waitForURL(workouts, { timeout: 60_000 }).then(() => "in" as const),
    loginError.waitFor({ timeout: 60_000 }).then(() => "rejected" as const),
  ]);
  if (outcome === "rejected") {
    throw new Error(`e2e: Auth0 rejected the test user: ${await loginError.first().innerText()}`);
  }
  await expect(
    page.getByRole("button", { name: NAMES.startWorkout }).or(page.getByRole("button", { name: NAMES.addExercise })),
  ).toBeVisible();
  await page.context().storageState({ path: AUTH_STATE });
});
