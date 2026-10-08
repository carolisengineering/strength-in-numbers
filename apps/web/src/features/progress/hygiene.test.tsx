import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { makePersonalRecord, makeProgressPoint } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => {
  observability.reportError.mockReset();
  observability.track.mockReset();
  cleanupApp();
});

const HERE = dirname(fileURLToPath(import.meta.url));
const sources = () =>
  readdirSync(HERE)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => [f, readFileSync(join(HERE, f), "utf8")] as const);

describe("08.1 AC26 — no inline styles, no measuring, paint from CSS classes only", () => {
  it("non-test sources under features/progress", () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(0);
    for (const [file, text] of files) {
      expect(text, file).not.toMatch(/\bstyle\s*=|<style|\bfill\s*=|\bstroke\s*=|ResizeObserver|getBoundingClientRect|innerWidth/);
    }
  });
});

describe("08.1 AC27 — observability carries static tags only; no new events", () => {
  it("list, series and records failures report static tag pairs only", async () => {
    const ID = "10000000-0000-4000-8000-0000000000b1";
    const secret = "Secret Lift Name";
    const fake = createWorkoutFake({
      progress: { [ID]: [makeProgressPoint()] },
      records: [makePersonalRecord({ exerciseId: ID, exerciseName: secret })],
    });
    fake.failNext({ method: "GET", path: /^\/v1\/personal-records$/ }, () => problemResponse(418, "teapot"), 2);
    fake.failNext({ method: "GET", path: /^\/v1\/progress\/exercises\// }, () => problemResponse(418, "teapot"));
    prepareApp({ auth, fake });
    const { router } = renderApp("/app/progress");
    await screen.findByRole("alert");
    await router.navigate(`/app/progress/${ID}`);
    await screen.findByText("Couldn't load this chart");

    const allowed = [
      { source: "workouts", op: "load-progress-list" },
      { source: "workouts", op: "load-progress-series" },
      { source: "workouts", op: "load-records" },
    ];
    await waitFor(() => expect(observability.reportError.mock.calls.length).toBeGreaterThanOrEqual(3));
    for (const [, tags] of observability.reportError.mock.calls) {
      expect(allowed).toContainEqual(tags);
      expect(JSON.stringify(tags)).not.toContain(ID);
      expect(JSON.stringify(tags)).not.toContain(secret);
    }
    expect(observability.track).not.toHaveBeenCalled();
  });
});
