import { defineConfig, devices } from "@playwright/test";

import { AUTH_STATE } from "./e2e/env";

/**
 * Spec 06.3 — one post-deploy happy-path smoke against staging (D1), mobile
 * Chromium only (D3). Not a second test suite: behavior lives in Vitest.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // one Auth0 test user owns one active workout (§6.2)
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0, // §9: at most one; a pass-on-retry is reported flaky
  timeout: 6 * 60_000,
  expect: { timeout: 30_000 }, // free-plan API latency
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { ...devices["Pixel 7"] } },
    {
      name: "mobile-chromium",
      testMatch: /\.smoke\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Pixel 7"], storageState: AUTH_STATE },
    },
  ],
});
