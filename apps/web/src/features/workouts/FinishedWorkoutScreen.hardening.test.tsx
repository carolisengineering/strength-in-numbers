import { screen } from "@testing-library/react";
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

import type { WorkoutDetail } from "@sin/core";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { WORKOUT_KEYS } from "./queries";

afterEach(() => cleanupApp());

const finishedWorkout = () =>
  makeWorkoutDetail({
    endedAt: "2026-10-02T11:00:00.000Z",
    exercises: [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1 })] }],
  });

describe("06.4 AC1 — the summary screen clears the active entry only for its own workout", () => {
  it("removes a cached active workout with the same id once the summary shows", async () => {
    const workout = finishedWorkout();
    const fake = createWorkoutFake({ finished: [workout] });
    prepareApp({ auth, fake });
    const { queryClient } = renderApp(`/app/workouts/${workout.id}`);
    // What the finish flow leaves behind: the pre-finish copy, still under the active key.
    queryClient.setQueryData<WorkoutDetail>(WORKOUT_KEYS.active, { ...workout, endedAt: null });

    await screen.findByRole("heading", { name: "Workout summary" });

    expect(queryClient.getQueryData(WORKOUT_KEYS.active)).toBeUndefined();
  });

  it("leaves a different in-progress workout alone (history detail, Spec 08.0)", async () => {
    const workout = finishedWorkout();
    const other = makeWorkoutDetail();
    const fake = createWorkoutFake({ finished: [workout], active: other });
    prepareApp({ auth, fake });
    const { queryClient } = renderApp(`/app/workouts/${workout.id}`);
    queryClient.setQueryData<WorkoutDetail>(WORKOUT_KEYS.active, other);

    await screen.findByRole("heading", { name: "Workout summary" });

    expect(queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.active)?.id).toBe(other.id);
  });
});
