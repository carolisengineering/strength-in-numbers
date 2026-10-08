import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";
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

import { makePersonalRecord, makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => {
  observability.track.mockReset();
  cleanupApp();
});

const finished = () =>
  makeWorkoutDetail({
    startedAt: "2026-10-02T18:02:00.000Z",
    endedAt: "2026-10-02T19:00:00.000Z",
    exercises: [
      {
        modality: "weight_reps",
        name: "Barbell bench press",
        sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 }), makeSet({ setNumber: 2, weight: 62.5, reps: 6, rpe: 8 })],
      },
      {
        modality: "bodyweight_reps",
        name: "Pull-up",
        sets: [makeSet({ setNumber: 1, weight: null, weightUnit: null, reps: 12 })],
      },
    ],
  });

function setup(path?: string, options: { active?: ReturnType<typeof makeWorkoutDetail> | null } = {}) {
  const workout = finished();
  const fake = createWorkoutFake({ finished: [workout], active: options.active ?? null });
  prepareApp({ auth, fake });
  const app = renderApp(path ?? `/app/workouts/${workout.id}`);
  return { fake, workout, ...app };
}

describe("AC30 — finished workout summary", () => {
  it("shows the date, duration and every exercise's sets, formatted", async () => {
    setup();

    expect(await screen.findByRole("heading", { name: "Workout summary" })).toBeInTheDocument();
    expect(screen.getByText(/Fri 2 Oct · 58 min/)).toBeInTheDocument();
    const bench = screen.getByRole("region", { name: "Barbell bench press" });
    expect(within(bench).getByText("60 kg × 8")).toBeInTheDocument();
    expect(within(bench).getByText("62.5 kg × 6 @8")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Pull-up" })).getByText("12 reps")).toBeInTheDocument();
  });

  it("is read-only: no input, select or textarea, and no edit affordance", async () => {
    setup();
    await screen.findByRole("heading", { name: "Workout summary" });

    const main = screen.getByRole("main");
    expect(main.querySelector("input, select, textarea")).toBeNull();
    expect(within(main).queryByRole("button", { name: /edit|log set|finish|add exercise/i })).not.toBeInTheDocument();
    // The sets are plain text, not tappable rows.
    expect(within(screen.getByRole("region", { name: "Barbell bench press" })).queryByRole("button")).toBeNull();
  });

  it("Back to Workouts goes to /app/workouts", async () => {
    const { user, router } = setup();
    await screen.findByRole("heading", { name: "Workout summary" });

    await user.click(screen.getByRole("link", { name: "Back to Workouts" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts"));
  });

  it("Delete workout asks first, then deletes and returns to Workouts", async () => {
    const { fake, user, router } = setup();
    await screen.findByRole("heading", { name: "Workout summary" });

    await user.click(screen.getByRole("button", { name: "Delete workout" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this workout?" });
    expect(dialog).toHaveTextContent("3 logged sets");
    expect(fake.requests.filter((r) => r.method === "DELETE")).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts"));
    expect(fake.requests.filter((r) => r.method === "DELETE")).toHaveLength(1);
    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
    expect(observability.track).toHaveBeenCalledWith("workout_discarded", { phase: "finished", setCount: 3 });
  });

  it("a delete that answers 404 also returns to Workouts", async () => {
    const { fake, user, router } = setup();
    fake.failNext({ method: "DELETE", path: /\/v1\/workouts\// }, () => problemResponse(404, "not-found"));
    await screen.findByRole("heading", { name: "Workout summary" });

    await user.click(screen.getByRole("button", { name: "Delete workout" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts"));
  });

  it("Cancel keeps the workout", async () => {
    const { fake, user } = setup();
    await screen.findByRole("heading", { name: "Workout summary" });
    await user.click(screen.getByRole("button", { name: "Delete workout" }));

    await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Delete this workout?" })).not.toBeInTheDocument();
    expect(fake.requests.filter((r) => r.method === "DELETE")).toHaveLength(0);
  });

  it("a network failure on delete shows a retryable error and stays on the summary", async () => {
    const { fake, user, router } = setup();
    fake.failNext({ method: "DELETE", path: /\/v1\/workouts\// }, () => HttpResponse.error());
    await screen.findByRole("heading", { name: "Workout summary" });
    await user.click(screen.getByRole("button", { name: "Delete workout" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't delete the workout — try again");
    expect(router.state.location.pathname).toMatch(/^\/app\/workouts\/.+/);
    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts"));
  });

  it("an in-progress workout's id redirects to /app/workouts", async () => {
    const active = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "X" }] });
    const { router } = setup(`/app/workouts/${active.id}`, { active });

    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts"));
    expect(await screen.findByRole("heading", { name: "Workout" })).toBeInTheDocument();
  });

  it("a fetch failure shows the in-shell notice with a working retry", async () => {
    const { fake, workout, user } = setup();
    fake.failNext({ method: "GET", path: new RegExp(`/v1/workouts/${workout.id}$`) }, () => problemResponse(500, "about:blank"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Couldn't load this workout/);
    expect(alert).toHaveTextContent(/Request ID: /);
    expect(screen.getByTestId("app-shell")).toContainElement(alert);
    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Workout summary" })).toBeInTheDocument();
  });

  it("a 404 renders NotFound inside the shell (AC14)", async () => {
    setup("/app/workouts/00000000-0000-4000-8000-0000000000aa");

    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
    expect(screen.getByTestId("app-shell")).toContainElement(screen.getByTestId("not-found"));
  });
});

describe("08.0 AC19 — the summary never waits on records", () => {
  it("renders the exercises while records are pending, and keeps everything usable when they fail", async () => {
    const workout = finished();
    const fake = createWorkoutFake({ finished: [workout] });
    fake.failNext({ method: "GET", path: /^\/v1\/personal-records$/ }, () => problemResponse(500, "internal"));
    prepareApp({ auth, fake });
    renderApp(`/app/workouts/${workout.id}`);

    expect(await screen.findByRole("region", { name: "Barbell bench press" })).toBeInTheDocument();
    const block = await screen.findByRole("region", { name: "Personal records" });
    expect(within(block).getByRole("alert")).toHaveTextContent("Couldn't load records");
    expect(screen.getByRole("button", { name: "Delete workout" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Back to Workouts" })).toHaveAttribute("href", "/app/workouts");
  });

  it("shows the records the workout holds, in the profile's unit", async () => {
    const workout = finished();
    const fake = createWorkoutFake({
      finished: [workout],
      records: [makePersonalRecord({ workoutId: workout.id, exerciseName: "Barbell bench press" })],
    });
    prepareApp({ auth, fake, unitPreference: "lb" });
    renderApp(`/app/workouts/${workout.id}`);

    const block = await screen.findByRole("region", { name: "Personal records" });
    expect(within(block).getByText("Barbell bench press — Heaviest weight 226 lb (was 220.5 lb)")).toBeInTheDocument();
    // Set rows keep the unit they were entered in (Review Focus 5).
    expect(within(screen.getByRole("region", { name: "Barbell bench press" })).getByText("60 kg × 8")).toBeInTheDocument();
  });
});

describe("08.0 AC20 — the section prop", () => {
  it("from History: Back to History, and a delete lands on History", async () => {
    const { fake, workout, user, router } = setup();
    await screen.findByRole("heading", { name: "Workout summary" });
    await router.navigate(`/app/history/${workout.id}`);

    const back = await screen.findByRole("link", { name: "Back to History" });
    expect(back).toHaveAttribute("href", "/app/history");
    await user.click(screen.getByRole("button", { name: "Delete workout" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/app/history"));
    expect(fake.state.finished.has(workout.id)).toBe(false);
  });

  it("from Workouts: Back to Workouts, and a delete lands on Workouts (unchanged)", async () => {
    const { user, router } = setup();
    expect(await screen.findByRole("link", { name: "Back to Workouts" })).toHaveAttribute("href", "/app/workouts");
    await user.click(screen.getByRole("button", { name: "Delete workout" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts"));
  });
});
