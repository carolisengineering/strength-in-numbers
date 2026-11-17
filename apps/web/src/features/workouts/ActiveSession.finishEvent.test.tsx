import { screen, waitFor, within } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import type { PlannedSet, WorkoutDetail } from "@sin/core";
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

import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { finishButton } from "../../test/sessionHelpers";
import { localStorageAdapter } from "../../storage/storage";
import { USER_ID } from "../../test/catalogHarness";
import { __resetFinishListeners, onWorkoutFinished, type WorkoutFinishedEvent } from "./finishEvents";
import { outboxKey } from "./outbox/outbox";
import { WORKOUT_KEYS } from "./queries";

/** Spec 06.7: the finish is an outbox op; a refusal or a failed reconcile leaves it `failed` in the stored file. */
const storedFinish = () =>
  (JSON.parse(localStorageAdapter().get(outboxKey(USER_ID)) ?? '{"ops":[]}') as { ops: { kind: string; status: string }[] }).ops.find((o) => o.kind === "finish");

afterEach(() => {
  __resetFinishListeners();
  observability.track.mockReset();
  cleanupApp();
});

const oneSet: ExerciseSpec[] = [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] }];

async function setup(exercises: ExerciseSpec[] = oneSet) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

/** Records each event with what the detail cache held when the listener ran (AC24: after the caches are seeded). */
function listen(queryClient: QueryClient) {
  const seen: { event: WorkoutFinishedEvent; endedAt: string | null | undefined }[] = [];
  onWorkoutFinished((event) => {
    seen.push({ event, endedAt: queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(event.workoutId))?.endedAt });
  });
  return seen;
}

const planned: PlannedSet = { setType: "working", repsLow: 8, repsHigh: 8, weight: 60, weightUnit: "kg" };
const finishDialog = () => within(screen.getByRole("dialog", { name: "Finish workout?" }));

describe("20.2 AC24 — finishing emits once", () => {
  it("a successful Finish emits one event, after the detail cache is seeded with endedAt", async () => {
    const { fake, user, router, queryClient } = await setup();
    const seen = listen(queryClient);
    const id = fake.state.active!.id;
    await user.click(finishButton());
    await user.click(finishDialog().getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${id}`));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.event).toEqual({ workoutId: id });
    expect(seen[0]!.endedAt).toEqual(expect.any(String));
  });

  it("End workout early emits one event (it shares confirmFinish)", async () => {
    const plannedTwo: ExerciseSpec[] = [
      { modality: "weight_reps", name: "X", plannedSets: [planned, planned], sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] },
    ];
    const { fake, user, router, queryClient } = await setup(plannedTwo);
    const seen = listen(queryClient);
    const id = fake.state.active!.id;
    await user.click(screen.getByRole("button", { name: "Workout menu" }));
    await user.click(screen.getByRole("button", { name: "End workout early" }));
    await user.click(within(screen.getByRole("dialog", { name: "End workout early?" })).getByRole("button", { name: "End workout" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${id}`));
    expect(seen.map((s) => s.event)).toEqual([{ workoutId: id }]);
  });

  it("a refused finish (409 incomplete-working-sets) emits nothing", async () => {
    const { fake, user, queryClient } = await setup();
    const seen = listen(queryClient);
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () => problemResponse(409, "incomplete-working-sets"));
    await user.click(finishButton());
    await user.click(finishDialog().getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(storedFinish()?.status).toBe("failed"));
    expect(seen).toEqual([]);
  });

  it("06.7 AC3 — a lost reply replayed and reconciled as ours emits one event, after the detail cache is seeded", async () => {
    const { fake, user, router, queryClient } = await setup();
    const seen = listen(queryClient);
    const id = fake.state.active!.id;
    fake.loseNextResponse({ method: "PATCH", path: /^\/v1\/workouts\/[^/]+$/ });
    await user.click(finishButton());
    await user.click(finishDialog().getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${id}`), { timeout: 4000 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.event).toEqual({ workoutId: id });
    expect(seen[0]!.endedAt).toEqual(expect.any(String));
  });

  it("06.7 D9 — a workout finished on another device (409, a different end time) emits nothing; it is that device's to send", async () => {
    const { fake, user, router, queryClient } = await setup();
    const seen = listen(queryClient);
    const id = fake.state.active!.id;
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () => problemResponse(409, "workout-finished"));
    fake.state.finished.set(id, { ...fake.state.active!, endedAt: new Date(Date.now() - 60_000).toISOString() });
    fake.state.active = null;
    await user.click(finishButton());
    await user.click(finishDialog().getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${id}`));
    expect(observability.track).toHaveBeenCalledWith("workout_finish_elsewhere", {});
    expect(seen).toEqual([]);
  });

  it("a 409 workout-finished whose re-read shows it live fails the finish op, and emits nothing", async () => {
    const { fake, user, queryClient } = await setup();
    const seen = listen(queryClient);
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () => problemResponse(409, "workout-finished"));
    await user.click(finishButton());
    await user.click(finishDialog().getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(storedFinish()?.status).toBe("failed"));
    expect(seen).toEqual([]);
  });
});
