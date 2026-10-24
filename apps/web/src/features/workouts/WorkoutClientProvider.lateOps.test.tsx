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

import { onlineManager } from "@tanstack/react-query";
import { localStorageAdapter } from "../../storage/storage";
import { USER_ID } from "../../test/catalogHarness";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { OUTBOX_KEY } from "./outbox/outbox";

let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);

afterEach(() => {
  online = true;
  onlineManager.setOnline(true);
  cleanupApp();
});

type Fake = ReturnType<typeof createWorkoutFake>;

/** A queued, never-sent set create for `workoutExerciseId`, as a reloaded tab would find it. */
function seedQueuedCreate(workoutId: string, workoutExerciseId: string) {
  localStorageAdapter().set(
    OUTBOX_KEY,
    JSON.stringify({
      v: 1,
      userId: USER_ID,
      idMap: {},
      ops: [
        {
          id: "late-op",
          kind: "create",
          workoutId,
          workoutExerciseId,
          userId: USER_ID,
          status: "queued",
          attempted: false,
          attempts: 0,
          nextAttemptAt: 0,
          enqueuedAt: 0,
          target: { clientGeneratedId: "30000000-0000-4000-8000-0000000000f1" },
          body: { clientGeneratedId: "30000000-0000-4000-8000-0000000000f1", reps: 5, weight: 60, weightUnit: "kg", isComplete: true },
        },
      ],
    }),
  );
}

const gets = (fake: Fake, path: string, search = "") =>
  fake.requests.filter((r) => r.method === "GET" && r.path === path && r.search === search).length;

describe("18.0 AC24 — a late op on a workout that is not active refreshes its caches", () => {
  it("an op landing on a finished workout re-reads its detail and its records", async () => {
    const finished = makeWorkoutDetail({
      endedAt: "2026-10-02T11:00:00.000Z",
      exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet({ setNumber: 1 })] }],
    });
    const fake = createWorkoutFake({ finished: [finished] });
    prepareApp({ auth, fake });
    seedQueuedCreate(finished.id, finished.exercises[0]!.id);
    // The browser reports offline (the fake stays reachable), so the outbox waits until the summary has loaded.
    online = false;
    renderApp(`/app/history/${finished.id}`);
    await screen.findByRole("heading", { name: "Workout summary" });
    await waitFor(() => expect(gets(fake, "/v1/personal-records", `?workoutId=${finished.id}`)).toBe(1));
    expect(gets(fake, `/v1/workouts/${finished.id}`)).toBe(1);
    online = true;
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(JSON.parse(localStorageAdapter().get(OUTBOX_KEY) ?? '{"ops":[]}').ops).toEqual([]));
    await waitFor(() => expect(gets(fake, `/v1/workouts/${finished.id}`)).toBe(2));
    await waitFor(() => expect(gets(fake, "/v1/personal-records", `?workoutId=${finished.id}`)).toBe(2));
    expect(fake.state.finished.get(finished.id)!.exercises[0]!.sets).toHaveLength(2);
  });

  it("control: an op for the active workout causes no detail read", async () => {
    const active = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1 })] }] });
    const fake = createWorkoutFake({ active });
    prepareApp({ auth, fake });
    seedQueuedCreate(active.id, active.exercises[0]!.id);
    renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    // The active workout keeps its id-map entry, so the file stays; its op list empties.
    await waitFor(() => expect(JSON.parse(localStorageAdapter().get(OUTBOX_KEY) ?? '{"ops":[]}').ops).toEqual([]));
    expect(fake.state.active!.exercises[0]!.sets).toHaveLength(2);
    expect(fake.requests.some((r) => r.method === "GET" && r.path === `/v1/workouts/${active.id}`)).toBe(false);
  });

  it("deferred minor 1: an op for the live workout drained on History (active not cached) leaves History alone", async () => {
    const active = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1 })] }] });
    const fake = createWorkoutFake({ active });
    prepareApp({ auth, fake });
    seedQueuedCreate(active.id, active.exercises[0]!.id);
    online = false;
    renderApp("/app/history");
    await screen.findByRole("heading", { name: "History" });
    const listReads = () => fake.requests.filter((r) => r.method === "GET" && r.path === "/v1/workouts").length;
    await waitFor(() => expect(listReads()).toBe(1));
    online = true;
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(JSON.parse(localStorageAdapter().get(OUTBOX_KEY) ?? '{"ops":[]}').ops).toEqual([]));
    expect(fake.state.active!.exercises[0]!.sets).toHaveLength(2);
    expect(listReads()).toBe(1);
    expect(fake.requests.some((r) => r.method === "GET" && r.path === `/v1/workouts/${active.id}`)).toBe(false);
  });
});
