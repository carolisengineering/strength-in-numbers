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

import { openEditFromSummary } from "../test/sessionHelpers";
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

const summaryShown = () => screen.findByRole("heading", { level: 1, name: "Workout summary" }, { timeout: 5000 });

/** Workouts → History → the newer workout's row: the summary carries History's `fromHome` mark (minor 696). */
async function openFromHistory() {
  prepareApp({ auth, fake: createWorkoutFake({ finished: [OLDER, NEWER], active: null }) });
  const app = renderApp("/app/workouts");
  await app.router.navigate("/app/history");
  await app.user.click(await screen.findByRole("link", { name: /Newer push/ }));
  await summaryShown();
  return app;
}

async function editThenDone({ user }: App) {
  await openEditFromSummary(user);
  await screen.findByRole("heading", { level: 1, name: "Edit workout" });
  await user.click(screen.getByRole("button", { name: "Done" }));
  await summaryShown();
}

async function deleteHere({ user }: App) {
  await user.click(await screen.findByRole("button", { name: "Workout menu" }));
  await user.click(await screen.findByRole("button", { name: "Delete workout" }));
  await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));
}

describe("minor 715 — Done goes Back to the summary Edit came from", () => {
  it("History → row → Edit → Done → Delete, then one Back leaves History", async () => {
    const app = await openFromHistory();
    await editThenDone(app);
    await deleteHere(app);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/history"));
    await app.router.navigate(-1);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/workouts"));
  });

  it("Back after Edit → Done goes where Back from the summary went", async () => {
    const app = await openFromHistory();
    await editThenDone(app);
    expect(app.router.state.location.pathname).toBe(`/app/history/${NEWER.id}`);
    await app.router.navigate(-1);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/history"));
  });

  it("Review Focus 4: Done on an edit screen opened by a direct link replaces, and stays in the app", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ finished: [OLDER, NEWER], active: null }) });
    const app = renderApp(`/app/history/${OLDER.id}/edit`);
    await screen.findByRole("heading", { level: 1, name: "Edit workout" });
    await app.user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe(`/app/history/${OLDER.id}`));
    expect(app.router.state.historyAction).toBe("REPLACE");
  });
});

describe("minor 716 — Forward after a delete lands on the list, not Not found", () => {
  it("a delete that went Back, then Forward: History's list, no 'Page not found'", async () => {
    const app = await openFromHistory();
    await deleteHere(app);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/history"));
    await app.router.navigate(1);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/history"));
    expect(screen.queryByRole("heading", { name: "Page not found" })).toBeNull();
  });

  it("Review Focus 3: a direct link to a deleted workout still shows Not found", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ finished: [OLDER], active: null }) });
    renderApp(`/app/history/${NEWER.id}`);
    expect(await screen.findByRole("heading", { name: "Page not found" }, { timeout: 5000 })).toBeInTheDocument();
  });
});
