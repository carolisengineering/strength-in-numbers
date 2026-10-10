import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false,
    isAuthenticated: true,
    error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(),
    logout: vi.fn(),
    getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));
const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { routineId } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { catalog, pushA } from "../../test/routineFixtures";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

const HERE = dirname(fileURLToPath(import.meta.url));
const sources = () =>
  readdirSync(HERE)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => [f, readFileSync(join(HERE, f), "utf8")] as const);

describe("10.0 AC37 — no inline styles", () => {
  it("non-test sources under features/routines", () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(5);
    for (const [file, text] of files) expect(text, file).not.toMatch(/\bstyle\s*=|<style|dangerouslySetInnerHTML/);
  });
});

describe("10.0 AC35 — nothing in features/routines persists", () => {
  it("no browser-storage names, no persister", () => {
    for (const [file, text] of sources()) expect(text, file).not.toMatch(/localStorage|sessionStorage|Persister|persistQueryClient/);
  });
});

describe("10.0 AC38 — reports and analytics carry static tags only", () => {
  it("every routine failure path reports without ids, names or notes", async () => {
    const secret = "Secret Routine Name";
    const routine = { ...pushA, name: secret, notes: "secret note" };
    const fake = createWorkoutFake({ catalog, routines: [routine] });
    fake.failNext({ method: "GET", path: /^\/v1\/routines$/ }, () => problemResponse(418, "teapot"));
    fake.failNext({ method: "GET", path: /^\/v1\/routines\/./ }, () => problemResponse(418, "teapot"));
    fake.failNext({ method: "DELETE", path: /^\/v1\/routines\/./ }, () => problemResponse(418, "teapot"));
    prepareApp({ auth, catalog, fake });
    const { user } = renderApp(`/app/workouts/routines/${routineId(1)}`);
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    await screen.findByText("Couldn't delete this routine — try again.");
    expect(observability.reportError).toHaveBeenCalled();
    for (const [, context] of observability.reportError.mock.calls) {
      expect(Object.keys(context as object).sort()).toEqual(["op", "source"]);
      const text = JSON.stringify(context);
      expect(text).not.toContain(secret);
      expect(text).not.toContain(routineId(1));
    }
    for (const [event] of observability.track.mock.calls) expect(event).toBe("workout_started");
  });
});
