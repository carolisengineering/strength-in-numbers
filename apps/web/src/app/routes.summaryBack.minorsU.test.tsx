import { act, screen, waitFor, within } from "@testing-library/react";
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

import { card, deleteSetIn, openEditFromSummary } from "../test/sessionHelpers";
import { resetDesktop, setDesktop } from "../test/desktop";
import { makeSet, makeWorkoutDetail } from "../test/workoutFixtures";
import { createWorkoutFake } from "../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../test/workoutHarness";
import { EDIT_COPY } from "../features/workouts/edit/editCopy";
import { WORKOUT_KEYS } from "../features/workouts/queries";
import { resetDeletedHereForTests } from "../features/workouts/summaryEntry";

afterEach(() => {
  cleanupApp();
  resetDeletedHereForTests();
  resetDesktop();
});

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

/** Workouts → History, then a row: the summary carries History's `fromHome` mark (minor 696). */
async function openFromHistory() {
  const fake = createWorkoutFake({ finished: [OLDER, NEWER], active: null });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await app.router.navigate("/app/history");
  await openRow(app, /Newer push/);
  return { ...app, fake };
}

async function openRow({ user }: App, name: RegExp) {
  await user.click(await screen.findByRole("link", { name }));
  await summaryShown();
}

async function deleteHere({ user }: App) {
  await user.click(await screen.findByRole("button", { name: "Workout menu" }));
  await user.click(await screen.findByRole("button", { name: "Delete workout" }));
  await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));
}

/** Edit → the only set → Delete set → "Delete this whole workout instead?" → Delete workout. */
async function deleteWholeFromEdit({ user }: App) {
  await openEditFromSummary(user);
  await screen.findByRole("heading", { level: 1, name: "Edit workout" });
  await user.click(within(card("Bench press")).getByRole("button", { name: /60 kg × 5/ }));
  await deleteSetIn(user, screen.getByRole("dialog", { name: /^Set 1/ }));
  const dialog = await screen.findByRole("dialog", { name: EDIT_COPY.lastSet.title });
  await user.click(within(dialog).getByRole("button", { name: EDIT_COPY.lastSet.confirm }));
}

/** The workout goes on the server, and the open summary re-reads it (another device deleted it). */
async function goneElsewhere(app: App & { fake: ReturnType<typeof createWorkoutFake> }, id: string) {
  app.fake.state.finished.delete(id);
  await act(() => app.queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.detail(id) }));
}

describe("minor 763 — Delete workout from an edit opened off History's summary goes Back to History", () => {
  it("History → row → Edit → delete the only set → Delete workout: on History, and one Back leaves it", async () => {
    const app = await openFromHistory();
    await deleteWholeFromEdit(app);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/history"));
    await act(() => app.router.navigate(-1));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/workouts"));
  });

  it("final review: after Delete workout from Edit, Forward twice lands on the list, not Not found", async () => {
    const app = await openFromHistory();
    await deleteWholeFromEdit(app);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/history"));
    await act(() => app.router.navigate(1)); // the summary: gone, so it goes on to its list (minors 716, 770)
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/history"));
    await act(() => app.router.navigate(1)); // the edit entry left ahead by the Back
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/history"));
    expect(screen.queryByRole("heading", { name: "Page not found" })).toBeNull();
  });

  it("Review Focus 1: Edit from a summary opened by a direct link, then Delete workout: replaces with History", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ finished: [OLDER, NEWER], active: null }) });
    const app = renderApp(`/app/history/${NEWER.id}`);
    await summaryShown();
    await deleteWholeFromEdit(app);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/history"));
    expect(app.router.state.historyAction).toBe("REPLACE");
  });
});

describe("minor 764 — Edit from History's index at desktop widths isn't marked", () => {
  it("at desktop widths, Edit from History's index, then Done, replaces with the workout's own path", async () => {
    setDesktop(true);
    prepareApp({ auth, fake: createWorkoutFake({ finished: [OLDER, NEWER], active: null }) });
    const app = renderApp("/app/workouts");
    await app.router.navigate("/app/history");
    await summaryShown();
    await openEditFromSummary(app.user);
    await screen.findByRole("heading", { level: 1, name: "Edit workout" });
    await app.user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe(`/app/history/${NEWER.id}`));
    expect(app.router.state.historyAction).toBe("REPLACE");
  });
});

describe("minor 770 — only this tab's own delete sends a summary on to its list", () => {
  it("a summary opened from its list whose workout is deleted elsewhere shows Not found", async () => {
    const app = await openFromHistory();
    await goneElsewhere(app, NEWER.id);
    expect(await screen.findByRole("heading", { name: "Page not found" }, { timeout: 5000 })).toBeInTheDocument();
    expect(app.router.state.location.pathname).toBe(`/app/history/${NEWER.id}`);
  });

  it("Review Focus 2: a workout deleted here doesn't make another one's 404 redirect", async () => {
    const fake = createWorkoutFake({ finished: [OLDER, NEWER], active: null });
    prepareApp({ auth, fake });
    const app = { ...renderApp("/app/workouts"), fake };
    await app.router.navigate("/app/history");
    await openRow(app, /Older pull/);
    await deleteHere(app);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/history"));
    await openRow(app, /Newer push/);
    await goneElsewhere(app, NEWER.id);
    expect(await screen.findByRole("heading", { name: "Page not found" }, { timeout: 5000 })).toBeInTheDocument();
  });
});
