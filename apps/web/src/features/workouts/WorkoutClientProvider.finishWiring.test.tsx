import { waitFor } from "@testing-library/react";
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
import { localStorageAdapter } from "../../storage/storage";
import { USER_ID } from "../../test/catalogHarness";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { __resetFinishListeners, onWorkoutFinished } from "./finishEvents";
import { outboxKey } from "./outbox/outbox";
import { RECORDS_KEYS } from "../records/queries";

afterEach(() => {
  __resetFinishListeners();
  cleanupApp();
});

const ENDED = "2026-10-02T11:00:00.000Z";

/** A finish op a reload finds in storage (the lifter tapped Finish, then the tab went away). */
function seedQueuedFinish(workout: WorkoutDetail) {
  localStorageAdapter().set(
    outboxKey(USER_ID),
    JSON.stringify({
      v: 1,
      userId: USER_ID,
      idMap: {},
      ops: [
        {
          id: "finish-op",
          kind: "finish",
          workoutId: workout.id,
          userId: USER_ID,
          status: "queued",
          attempted: false,
          attempts: 0,
          nextAttemptAt: 0,
          enqueuedAt: 0,
          body: { endedAt: ENDED },
          meta: { startedAt: workout.startedAt, exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false },
        },
      ],
    }),
  );
}

describe("06.7 AC14 — the provider wires the landing effects to the outbox", () => {
  it("a stored finish lands after a reload: the summary's caches, drafts cleared, one Hevy event", async () => {
    const active = makeWorkoutDetail({
      startedAt: "2026-10-02T10:00:00.000Z",
      exercises: [{ modality: "weight_reps", name: "Bench", sets: [makeSet({ setNumber: 1 })] }],
    });
    const fake = createWorkoutFake({ active });
    prepareApp({ auth, fake });
    seedQueuedFinish(active);
    localStorageAdapter().set(
      "sin:workout:drafts",
      JSON.stringify({ v: 1, userId: USER_ID, workoutId: active.id, byExercise: {} }),
    );
    const listener = vi.fn();
    onWorkoutFinished(listener);
    const { queryClient } = renderApp("/app/history");
    await waitFor(() => expect(listener).toHaveBeenCalledOnce());
    expect(listener).toHaveBeenCalledWith({ workoutId: active.id });
    expect(fake.requests.filter((r) => r.method === "PATCH" && r.path === `/v1/workouts/${active.id}`)).toHaveLength(1);
    // The response's newRecords seed the summary's records (no read by workout id needed).
    expect(queryClient.getQueryData(RECORDS_KEYS.forWorkout(active.id))).toEqual([]);
    expect(localStorageAdapter().get("sin:workout:drafts")).toBeNull();
    expect(JSON.parse(localStorageAdapter().get(outboxKey(USER_ID)) ?? '{"ops":[]}').ops).toEqual([]);
  });
});
