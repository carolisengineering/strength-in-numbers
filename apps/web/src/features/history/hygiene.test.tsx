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

import { makePersonalRecord, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => {
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

const ALLOWED = [
  { source: "workouts", op: "load-history" },
  { source: "workouts", op: "load-records" },
  { source: "history", op: "stale-cursor" },
];

describe("08.0 AC25 — observability carries static tags only; no new events", () => {
  it("every reportError call from history and records failures is a static tag pair", async () => {
    const workout = makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z" });
    const secretName = "Secret Lift Name";
    const fake = createWorkoutFake({
      finished: [workout],
      records: [makePersonalRecord({ workoutId: workout.id, exerciseName: secretName })],
    });
    fake.failNext({ method: "GET", path: /^\/v1\/workouts$/ }, () => problemResponse(418, "teapot"));
    fake.failNext({ method: "GET", path: /^\/v1\/personal-records$/ }, () => problemResponse(418, "teapot"));
    prepareApp({ auth, fake });
    const { router } = renderApp("/app/history");
    await screen.findByRole("alert");
    await router.navigate(`/app/history/${workout.id}`);
    await screen.findByText("Couldn't load records");

    await waitFor(() => expect(observability.reportError).toHaveBeenCalledTimes(2));
    for (const [, tags] of observability.reportError.mock.calls) {
      expect(ALLOWED).toContainEqual(tags);
      expect(JSON.stringify(tags)).not.toContain(workout.id);
      expect(JSON.stringify(tags)).not.toContain(secretName);
    }
    expect(observability.track).not.toHaveBeenCalled();
  });
});
