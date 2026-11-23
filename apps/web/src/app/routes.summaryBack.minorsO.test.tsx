import { screen, waitFor, within } from "@testing-library/react";
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

import { finishButton } from "../test/sessionHelpers";
import { makeSet, makeWorkoutDetail } from "../test/workoutFixtures";
import { createWorkoutFake } from "../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../test/workoutHarness";

afterEach(() => cleanupApp());

const finished = (n: number, title: string) =>
  makeWorkoutDetail({
    id: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    title,
    startedAt: `2026-10-${String(n).padStart(2, "0")}T18:00:00.000Z`,
    endedAt: `2026-10-${String(n).padStart(2, "0")}T19:00:00.000Z`,
    localDate: `2026-10-${String(n).padStart(2, "0")}`,
    exercises: [{ modality: "weight_reps", name: "Bench press", sets: [makeSet({ setNumber: 1, weight: 60, reps: 5 })] }],
  });
const OLDER = finished(2, "Older pull");
const NEWER = finished(5, "Newer push");

type App = ReturnType<typeof renderApp>;

async function deleteHere({ user }: App) {
  await user.click(await screen.findByRole("button", { name: "Workout menu" }));
  await user.click(await screen.findByRole("button", { name: "Delete workout" }));
  await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));
}

describe("minor 696 — a delete from a summary opened from its list goes Back to that list", () => {
  it("History: list → row → Delete leaves one /app/history entry, so one Back leaves History", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ finished: [OLDER, NEWER], active: null }) });
    const app = renderApp("/app/workouts");
    await app.router.navigate("/app/history");
    const row = await screen.findByRole("link", { name: /Newer push/ });
    await app.user.click(row);
    await deleteHere(app);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/history"));
    await app.router.navigate(-1);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/workouts"));
  });

  it("Workouts: Finish → summary → Delete leaves one /app/workouts entry, so one Back leaves Workouts", async () => {
    const fake = createWorkoutFake({
      active: makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] }] }),
    });
    prepareApp({ auth, fake });
    const app = renderApp("/app/history");
    await app.router.navigate("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    const id = fake.state.active!.id;
    await app.user.click(finishButton());
    await app.user.click(within(screen.getByRole("dialog", { name: "Finish workout?" })).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe(`/app/workouts/${id}`));
    await deleteHere(app);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/workouts"));
    await app.router.navigate(-1);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/history"));
  });

  it("Review Focus 2: a summary reached from elsewhere (a Records or Progress link) still replaces, and Back never lands on it", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ finished: [OLDER, NEWER], active: null }) });
    const app = renderApp("/app/exercises");
    await app.router.navigate(`/app/history/${NEWER.id}`);
    await deleteHere(app);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/history"));
    expect(app.router.state.historyAction).toBe("REPLACE");
    await app.router.navigate(-1);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/exercises"));
  });
});
