import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// AC1 needs a navigation that never happens, so the gap between "finish succeeded" and "route
// changed" can be held open. Off by default: every other test navigates for real.
const nav = vi.hoisted(() => ({ noop: false, calls: [] as unknown[] }));
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useNavigate: () => {
      const real = actual.useNavigate();
      return nav.noop ? (...args: unknown[]) => void nav.calls.push(args) : real;
    },
  };
});

import userEvent from "@testing-library/user-event";
import { QueryClientProvider, focusManager } from "@tanstack/react-query";
import { useState } from "react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import type { Exercise, WorkoutDetail } from "@sin/core";
import { http, HttpResponse } from "msw";
import { routes } from "../../app/router";
import { API_BASE_URL } from "../../test/catalogHarness";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { server } from "../../test/msw/server";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, deferred, makeQueryClient, prepareApp, renderApp } from "../../test/workoutHarness";
import { WORKOUT_KEYS } from "./queries";
import { WorkoutsScreen } from "./WorkoutsScreen";

const scrolled: Element[] = [];
const scrollIntoView = vi.fn(function (this: Element) {
  scrolled.push(this);
});

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  nav.noop = false;
  nav.calls.length = 0;
  observability.track.mockReset();
  scrollIntoView.mockClear();
  scrolled.length = 0;
  cleanupApp();
});

async function setup(exercises: ExerciseSpec[]) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

const finishButton = () => screen.getByRole("button", { name: "Finish" });
const finishDialog = () => screen.getByRole("dialog", { name: "Finish workout?" });
const incompleteSet = (setNumber: number) =>
  makeSet({ setNumber, weight: null, weightUnit: null, reps: 8, isComplete: false });

// ---- AC1 ----------------------------------------------------------------------------------------

/**
 * The real route table with `/app/workouts` rendered through a host the test can re-render. A route
 * element is created once, so nothing above it re-renders `WorkoutsScreen` in a test; in the app,
 * anything that does (its own state, a future parent) reopens the gap AC1 closes.
 */
const host = { bump: () => {} };
function Host() {
  const [, setN] = useState(0);
  host.bump = () => setN((n) => n + 1);
  return <WorkoutsScreen />;
}
const withHost = (list: RouteObject[]): RouteObject[] =>
  list.map((route) =>
    route.path === "workouts"
      ? { ...route, element: <Host /> }
      : ({ ...route, ...(route.children ? { children: withHost(route.children) } : {}) } as RouteObject),
  );

async function setupHosted(exercises: ExerciseSpec[]) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }) });
  prepareApp({ auth, fake });
  const queryClient = makeQueryClient();
  const router = createMemoryRouter(withHost(routes), { initialEntries: ["/app/workouts"] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, router, queryClient, user: userEvent.setup() };
}

const ACTIVE_URL = `${API_BASE_URL}/v1/workouts/active`;
const activeReads = (fake: ReturnType<typeof createWorkoutFake>) =>
  fake.requests.filter((r) => r.method === "GET" && r.path === "/v1/workouts/active").length;

const oneSet: ExerciseSpec[] = [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1 })] }];

describe("06.4 AC1 — finish success does not depend on the parent's render timing", () => {
  it("a re-render of WorkoutsScreen before navigation shows no spinner, no Start screen and fetches nothing", async () => {
    const { fake, user, queryClient } = await setupHosted(oneSet);
    const id = fake.state.active!.id;
    nav.noop = true;

    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(nav.calls).toEqual([[`/app/workouts/${id}`]]));
    const reads = activeReads(fake);

    act(() => host.bump());

    expect(screen.queryByText("Loading your workout…")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Start a workout" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Workout" })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(activeReads(fake)).toBe(reads);
    // The summary's cache is seeded by the hook; the active entry is the destination's to clear.
    expect(queryClient.getQueryData<{ endedAt: string | null }>(WORKOUT_KEYS.detail(id))?.endedAt).not.toBeNull();
    expect(observability.track).toHaveBeenCalledWith("workout_finished", expect.objectContaining({ setCount: 1 }));
  });

  it("the same holds on the 409 workout-finished ⇒ success path", async () => {
    const { fake, user, queryClient } = await setupHosted(oneSet);
    const id = fake.state.active!.id;
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () => problemResponse(409, "workout-finished"));
    fake.state.finished.set(id, { ...fake.state.active!, endedAt: new Date().toISOString() });
    fake.state.active = null;
    nav.noop = true;

    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(nav.calls).toEqual([[`/app/workouts/${id}`]]));
    const reads = activeReads(fake);

    act(() => host.bump());

    expect(screen.queryByText("Loading your workout…")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Workout" })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(activeReads(fake)).toBe(reads);
    expect(queryClient.getQueryData<{ endedAt: string | null }>(WORKOUT_KEYS.detail(id))?.endedAt).not.toBeNull();
  });

  it("once the summary mounts, the active entry for that workout is gone and /app/workouts shows Start", async () => {
    const { fake, user, router, queryClient } = await setupHosted(oneSet);
    const id = fake.state.active!.id;

    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { name: "Workout summary" });

    expect(router.state.location.pathname).toBe(`/app/workouts/${id}`);
    // The summary clears the entry from a passive effect, which can run after the heading is painted.
    await waitFor(() => expect(queryClient.getQueryData(WORKOUT_KEYS.active)).toBeUndefined());
    await act(() => router.navigate("/app/workouts"));
    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
  });

  it("a finish that lands after the lifter left the screen still clears the active entry", async () => {
    const { fake, user, router, queryClient } = await setupHosted(oneSet);
    const active = fake.state.active!;
    const gate = deferred<void>();
    server.use(
      http.patch(
        `${API_BASE_URL}/v1/workouts/${active.id}`,
        async () => {
          await gate.promise;
          const finished = { ...active, endedAt: new Date().toISOString() };
          fake.state.finished.set(active.id, finished);
          fake.state.active = null;
          // The client's schema drops `exercises`; `newRecords` is on every PATCH response (Spec 07.0 D12).
          return HttpResponse.json({ ...finished, newRecords: [] });
        },
        { once: true },
      ),
    );

    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));
    await act(() => router.navigate("/app/profile")); // switch tab mid-request
    gate.resolve();

    await waitFor(() => expect(queryClient.getQueryData(WORKOUT_KEYS.active)).toBeUndefined());
    expect(router.state.location.pathname).toBe("/app/profile"); // no yank back across screens
    await act(() => router.navigate("/app/workouts"));
    expect(screen.queryByRole("heading", { name: "Workout" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
  });
});

// ---- AC7 ----------------------------------------------------------------------------------------

describe("06.4 AC7 — an add-exercise 404 costs one GET /v1/workouts/active", () => {
  const bench = makeExercise({ id: exerciseId(1), name: "Bench Press", modality: "weight_reps" });

  async function setupPicker(apiCatalog: Exercise[]) {
    const fake = createWorkoutFake({ active: makeWorkoutDetail(), catalog: apiCatalog });
    prepareApp({ auth, fake, catalog: [bench] });
    const app = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    return { fake, ...app };
  }

  async function pickBench(user: ReturnType<typeof renderApp>["user"]) {
    await user.click(screen.getByRole("button", { name: "Add exercise" }));
    const dialog = await screen.findByRole("dialog", { name: "Add exercise" });
    await user.click(within(within(dialog).getByRole("region", { name: "All exercises" })).getByRole("button", { name: /Bench Press/ }));
  }

  it("workout gone → Start screen with the gone notice, after exactly one read", async () => {
    const { fake, user } = await setupPicker([bench]);
    fake.state.active = null;
    const before = activeReads(fake);

    await pickBench(user);

    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("That workout was already finished or removed.");
    await new Promise((r) => setTimeout(r, 20));
    expect(activeReads(fake) - before).toBe(1);
  });

  it("exercise unavailable → the warning, after exactly one read", async () => {
    const { fake, user } = await setupPicker([]); // the API cannot see the picked exercise
    const before = activeReads(fake);

    await pickBench(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("That exercise isn't available");
    await new Promise((r) => setTimeout(r, 20));
    expect(activeReads(fake) - before).toBe(1);
  });
});

// ---- AC8 ----------------------------------------------------------------------------------------

describe("06.4 AC8 — the carried-over one-line notices can be dismissed", () => {
  const twoExercises: ExerciseSpec[] = [
    { modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1 })] },
    { modality: "weight_reps", name: "Y" },
  ];

  it("resumed: Dismiss hides it; it stays hidden through a banner, its retry and the refetch; a later notice shows", async () => {
    const fake = createWorkoutFake();
    prepareApp({ auth, fake });
    const { user } = renderApp("/app/workouts");
    const start = await screen.findByRole("button", { name: "Start workout" });
    // Started on another device after this one loaded: the start answers 409 and we resume it.
    fake.state.active = makeWorkoutDetail({ exercises: twoExercises });
    await user.click(start);
    expect(await screen.findByText("You already had a workout in progress — resumed it.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/resumed it/)).not.toBeInTheDocument();

    // A banner appears (a failed move), then clears through its own retry, which refetches.
    fake.failNext({ method: "PATCH", path: /\/v1\/workout-exercises\// }, () => problemResponse(500, "about:blank"));
    const x = within(screen.getByRole("article", { name: "X" }));
    await user.click(x.getByRole("button", { name: "Options" }));
    await user.click(x.getByRole("button", { name: "Move down" }));
    const alert = await screen.findByRole("alert");
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.queryByText(/resumed it/)).not.toBeInTheDocument();
    // (06.2: queued set writes no longer raise the "out of date" notice; a later notice showing again is
    // covered by the gone-notice test below.)
  });

  it("the gone notice on the Start screen can be dismissed", async () => {
    const { fake, user } = await setup(oneSet);
    // Reach the gone path through Finish (06.2: a queued set write fails on its row instead).
    const active = fake.state.active!;
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () => problemResponse(409, "workout-finished"));
    fake.state.finished.set(active.id, { ...active, endedAt: null }); // getById: "not finished" ⇒ gone
    fake.state.active = null;

    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));
    expect(await screen.findByText("That workout was already finished or removed.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/already finished or removed/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
  });

  it("the refresh-failed notice has no Dismiss (it clears when a refetch succeeds)", async () => {
    const { fake } = await setup(oneSet);
    fake.failNext({ method: "GET", path: /\/v1\/workouts\/active$/ }, () => problemResponse(500, "about:blank"));

    focusManager.setFocused(false);
    focusManager.setFocused(true);

    expect(await screen.findByText(/Couldn't refresh your workout/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    focusManager.setFocused(undefined);
  });
});

// ---- AC9 ----------------------------------------------------------------------------------------

describe("06.4 AC9 — a diagnosis interrupted by the next set write is corrected by retrying Finish", () => {
  it("interim banner from the old copy, then the server's list, then a fresh diagnosis flags the real set", async () => {
    const { fake, user, queryClient } = await setup(oneSet);
    // Another client adds an incomplete working set this screen has not seen.
    const active = fake.state.active!;
    const exercise = active.exercises[0]!;
    const hidden = makeSet({
      setNumber: 2,
      workoutExerciseId: exercise.id,
      weight: null,
      weightUnit: null,
      reps: 8,
      isComplete: false,
    });
    fake.state.active = { ...active, exercises: [{ ...exercise, sets: [...exercise.sets, hidden] }] };

    // The diagnosis re-read is held open…
    const gate = deferred<void>();
    server.use(
      http.get(
        ACTIVE_URL,
        async () => {
          await gate.promise;
          return HttpResponse.json(fake.state.active);
        },
        { once: true },
      ),
    );
    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));

    // …and a set logged meanwhile cancels it (06.1 AC11).
    const x = within(screen.getByRole("article", { name: "X" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Finish workout?" })).not.toBeInTheDocument());
    await user.click(x.getByRole("button", { name: "Log set" }));

    // The banner is computed from the pre-refetch copy: no ids to flag, so the fallback.
    expect(await screen.findByRole("alert")).toHaveTextContent("Some sets are incomplete — reload and check your sets.");
    expect(screen.queryByText("Needs data")).not.toBeInTheDocument();

    // The I1 re-read after the set write lands: the list is the server's (set 1, the hidden set 2, the new set 3).
    await waitFor(() => expect(x.getAllByRole("button", { name: /^\d/ })).toHaveLength(3));
    gate.resolve();

    // Finish again: the 409 again, diagnosed from fresh data.
    await waitFor(() => expect(finishButton()).toBeEnabled());
    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));

    expect(await screen.findByText("1 working set is missing data. Fix or delete them, then finish again.")).toBeInTheDocument();
    const flagged = x.getAllByText("Needs data");
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.closest("button")).toHaveTextContent(/– × 8/);
    // No flagged row is one the cache holds as complete.
    const cached = queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.active)!;
    const flaggedSet = cached.exercises[0]!.sets.find((s) => s.id === hidden.id)!;
    expect(flaggedSet.isComplete).toBe(false);
  });
});

// ---- AC10 ---------------------------------------------------------------------------------------

describe("06.4 AC10 — a set write answering 404 while the workout still exists", () => {
  it("update set (06.2): the sheet closes at once; a 404 fails the row, refetches once, raises no notice or conflict", async () => {
    const { fake, user } = await setup(oneSet);
    const x = within(screen.getByRole("article", { name: "X" }));
    await user.click(x.getByRole("button", { name: /60 kg × 8/ }));
    const sheet = screen.getByRole("dialog", { name: /Set 1/ });
    await user.type(within(sheet).getByLabelText("Reps"), "{Control>}a{/Control}9");
    fake.failNext({ method: "PATCH", path: /\/v1\/sets\// }, () => problemResponse(404, "not-found"));
    const before = activeReads(fake);

    await user.click(within(sheet).getByRole("button", { name: "Save" }));

    expect(screen.queryByRole("dialog", { name: /Set 1/ })).not.toBeInTheDocument();
    expect(await x.findByText("Couldn't save")).toBeInTheDocument();
    await waitFor(() => expect(activeReads(fake) - before).toBe(1));
    expect(screen.queryByText(/out of date|already finished/)).not.toBeInTheDocument();
    expect(observability.track.mock.calls.filter(([name]) => name === "workout_conflict")).toEqual([]);
    expect(observability.track).toHaveBeenCalledWith("set_sync_failed", { status: 404 });
  });

  it("delete set: sheet closes, the row goes, no notice, no /active read, set_deleted tracked", async () => {
    const { fake, user } = await setup(oneSet);
    const x = within(screen.getByRole("article", { name: "X" }));
    await user.click(x.getByRole("button", { name: /60 kg × 8/ }));
    fake.failNext({ method: "DELETE", path: /\/v1\/sets\// }, () => problemResponse(404, "not-found"));
    const before = activeReads(fake);

    await user.click(within(screen.getByRole("dialog", { name: /Set 1/ })).getByRole("button", { name: "Delete set" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Set 1/ })).not.toBeInTheDocument());
    expect(x.queryByRole("button", { name: /60 kg × 8/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/out of date|already finished/)).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(activeReads(fake)).toBe(before);
    expect(observability.track).toHaveBeenCalledWith("set_deleted", { modality: "weight_reps" });
    expect(fake.state.active).not.toBeNull(); // the workout itself is still active
  });
});

// ---- AC4 ----------------------------------------------------------------------------------------

describe("06.4 AC4 — Enter in an invalid, untouched entry row shows what is wrong", () => {
  const setPosts = (fake: ReturnType<typeof createWorkoutFake>) =>
    fake.requests.filter((r) => r.method === "POST" && r.path.endsWith("/sets"));

  it("sends nothing, reveals the field messages, and keeps Log set disabled", async () => {
    const { fake, user } = await setup([{ modality: "weight_reps", name: "X" }]);
    const row = within(screen.getByRole("article", { name: "X" }));
    expect(row.queryAllByRole("alert")).toHaveLength(0);

    await user.type(row.getByLabelText("Weight"), "{Enter}");

    expect(row.getAllByRole("alert").length).toBeGreaterThanOrEqual(2); // Weight and Reps
    expect(row.getByLabelText("Weight")).toHaveAccessibleDescription(/.+/);
    expect(row.getByLabelText("Reps")).toHaveAccessibleDescription(/.+/);
    expect(row.getByRole("button", { name: "Log set" })).toBeDisabled();
    expect(setPosts(fake)).toHaveLength(0);
  });

  it("Enter in a valid row still logs exactly one set", async () => {
    const { fake, user } = await setup([{ modality: "weight_reps", name: "X" }]);
    const row = within(screen.getByRole("article", { name: "X" }));
    await user.type(row.getByLabelText("Weight"), "60");
    await user.type(row.getByLabelText("Reps"), "8");

    await user.type(row.getByLabelText("Reps"), "{Enter}");

    expect(await row.findByRole("button", { name: /60 kg × 8/ })).toBeInTheDocument();
    expect(setPosts(fake)).toHaveLength(1);
  });
});

describe("06.4 AC3 — scroll-into-view uses a ref, on the first flagged row only", () => {
  it("scrolls once, to the first flagged row in display order, when two cards each hold one", async () => {
    const { user } = await setup([
      { modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1 }), incompleteSet(2)] },
      { modality: "weight_reps", name: "Y", sets: [incompleteSet(1)] },
    ]);

    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));
    await screen.findByRole("alert");

    expect(screen.getAllByText("Needs data")).toHaveLength(2);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const target = scrolled[0]!;
    expect(within(screen.getByRole("article", { name: "X" })).getByText("Needs data").closest("button")).toBe(target);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
  });

  it("scrolls to a flagged set this screen had not seen, which arrives with the diagnosis re-read", async () => {
    const { fake, user } = await setup(oneSet);
    // Another client adds an incomplete working set; this screen's copy has only the complete one.
    const active = fake.state.active!;
    const exercise = active.exercises[0]!;
    const hidden = { ...incompleteSet(2), workoutExerciseId: exercise.id };
    fake.state.active = { ...active, exercises: [{ ...exercise, sets: [...exercise.sets, hidden] }] };

    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));

    const row = (await screen.findByText("Needs data")).closest("button");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrolled[0]).toBe(row);
  });

  it("fixing the first flagged row does not scroll again to the next one", async () => {
    const { user } = await setup([
      { modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1 }), incompleteSet(2)] },
      { modality: "weight_reps", name: "Y", sets: [incompleteSet(1)] },
    ]);
    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));
    await screen.findByRole("alert");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    const x = within(screen.getByRole("article", { name: "X" }));
    await user.click(x.getByText("Needs data").closest("button")!);
    const sheet = screen.getByRole("dialog", { name: /Set 2/ });
    await user.click(within(sheet).getByRole("button", { name: "Delete set" }));
    await waitFor(() => expect(x.queryByText("Needs data")).not.toBeInTheDocument());

    expect(screen.getAllByText("Needs data")).toHaveLength(1); // Y's row is now the first flagged
    await new Promise((r) => setTimeout(r, 20));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
