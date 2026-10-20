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

import { makeRoutine, makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";

afterEach(() => cleanupApp());

const finished = () =>
  makeWorkoutDetail({
    endedAt: "2026-10-02T11:00:00.000Z",
    exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet({ setNumber: 1 })] }],
  });

const detailGets = (fake: ReturnType<typeof createWorkoutFake>, id: string) =>
  fake.requests.filter((r) => r.method === "GET" && r.path === `/v1/workouts/${id}`).length;

describe("18.0 AC2 — routes", () => {
  it.each(["workouts", "history"])("/app/%s/:id/edit renders the edit screen", async (section) => {
    const workout = finished();
    const fake = createWorkoutFake({ finished: [workout] });
    prepareApp({ auth, fake });
    renderApp(`/app/${section}/${workout.id}/edit`);
    expect(await screen.findByRole("heading", { level: 1, name: "Edit workout" })).toBeInTheDocument();
  });

  it("a live workout's id redirects (replace) to /app/workouts", async () => {
    const live = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "X" }] });
    const fake = createWorkoutFake({ active: live });
    prepareApp({ auth, fake });
    const { router } = renderApp(`/app/history/${live.id}/edit`);
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts"));
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("an unknown id renders NotFound", async () => {
    const fake = createWorkoutFake();
    prepareApp({ auth, fake });
    renderApp("/app/history/40000000-0000-4000-8000-0000000000ff/edit");
    expect(await screen.findByRole("heading", { name: /not found/i })).toBeInTheDocument();
  });

  it("a 500 with nothing cached shows Couldn't load this workout. with Try again", async () => {
    const workout = finished();
    const fake = createWorkoutFake({ finished: [workout] });
    fake.failNext({ method: "GET", path: /^\/v1\/workouts\/[^/]+$/ }, () => problemResponse(500, "internal"));
    prepareApp({ auth, fake });
    const { user } = renderApp(`/app/history/${workout.id}/edit`);
    expect(await screen.findByText("Couldn't load this workout.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Edit workout" })).toBeInTheDocument();
  });

  it("opening the edit route after the summary cached the detail still re-reads it", async () => {
    const workout = finished();
    const fake = createWorkoutFake({ finished: [workout] });
    prepareApp({ auth, fake });
    const { user } = renderApp(`/app/history/${workout.id}`);
    await screen.findByRole("heading", { name: "Workout summary" });
    expect(detailGets(fake, workout.id)).toBe(1);
    await user.click(screen.getByRole("button", { name: "Edit workout" }));
    await screen.findByRole("heading", { level: 1, name: "Edit workout" });
    await waitFor(() => expect(detailGets(fake, workout.id)).toBe(2));
  });

  it("the routine routes still resolve", async () => {
    const routine = makeRoutine({ name: "Push Day" });
    const fake = createWorkoutFake({ routines: [routine] });
    prepareApp({ auth, fake });
    const { router } = renderApp("/app/workouts/routines/new");
    expect(await screen.findByRole("heading", { name: "New routine" })).toBeInTheDocument();
    await router.navigate(`/app/workouts/routines/${routine.id}`);
    expect(await screen.findByRole("heading", { name: "Push Day" })).toBeInTheDocument();
    await router.navigate(`/app/workouts/routines/${routine.id}/edit`);
    expect(await screen.findByRole("heading", { name: "Edit routine" })).toBeInTheDocument();
  });
});
