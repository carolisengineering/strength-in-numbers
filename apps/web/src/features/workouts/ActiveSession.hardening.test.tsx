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
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { routes } from "../../app/router";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, makeQueryClient, prepareApp, renderApp } from "../../test/workoutHarness";
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
    expect(queryClient.getQueryData(WORKOUT_KEYS.active)).toBeUndefined();
    await act(() => router.navigate("/app/workouts"));
    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
  });
});

describe("06.4 AC3 —scroll-into-view uses a ref, on the first flagged row only", () => {
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
});
