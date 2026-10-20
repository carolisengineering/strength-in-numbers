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

function setup(path?: string | ((id: string) => string), options: { active?: ReturnType<typeof makeWorkoutDetail> | null } = {}) {
  const workout = finished();
  const fake = createWorkoutFake({ finished: [workout], active: options.active ?? null });
  prepareApp({ auth, fake });
  const app = renderApp(typeof path === "function" ? path(workout.id) : (path ?? `/app/workouts/${workout.id}`));
  return { fake, workout, ...app };
}

type User = ReturnType<typeof setup>["user"];

/** #107: Delete workout lives in the Workout menu at the top; open it and return the revealed button. */
async function revealDelete(user: User) {
  await user.click(screen.getByRole("button", { name: "Workout menu" }));
  return screen.getByRole("button", { name: "Delete workout" });
}

describe("#107 — Back and the Workout menu lead the summary", () => {
  it("Back to History and the Workout menu come before the heading", async () => {
    setup((id) => `/app/history/${id}`);
    const heading = await screen.findByRole("heading", { name: "Workout summary" });
    const back = screen.getByRole("link", { name: "Back to History" });
    const menu = screen.getByRole("button", { name: "Workout menu" });
    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(menu.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Delete workout shows only while the menu is open", async () => {
    const { user } = setup();
    await screen.findByRole("heading", { name: "Workout summary" });
    const menu = screen.getByRole("button", { name: "Workout menu" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Delete workout" })).toBeNull();

    await user.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    const del = screen.getByRole("button", { name: "Delete workout" });
    expect(menu.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(del.compareDocumentPosition(screen.getByRole("heading", { name: "Workout summary" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Delete workout" })).toBeNull();
  });

  it("nothing follows the last exercise: no back link or delete at the bottom", async () => {
    const { user } = setup();
    await screen.findByRole("heading", { name: "Workout summary" });
    await user.click(screen.getByRole("button", { name: "Workout menu" }));
    const last = screen.getByRole("region", { name: "Pull-up" });
    const controls = within(screen.getByRole("main")).queryAllByRole("link").concat(within(screen.getByRole("main")).queryAllByRole("button"));
    const after = controls.filter((el) => !last.contains(el) && last.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after).toEqual([]);
  });

  it("a failed delete's notice survives closing the menu, and Delete works again after reopening", async () => {
    const { fake, user, router } = setup();
    fake.failNext({ method: "DELETE", path: /\/v1\/workouts\// }, () => HttpResponse.error());
    await screen.findByRole("heading", { name: "Workout summary" });
    await user.click(await revealDelete(user));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete the workout — try again");

    await user.click(screen.getByRole("button", { name: "Workout menu" })); // close
    expect(screen.queryByRole("button", { name: "Delete workout" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't delete the workout — try again");

    await user.click(await revealDelete(user));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts"));
  });

  it("the load-failure screen also leads with the back link", async () => {
    const { fake, workout } = setup((id) => `/app/history/${id}`);
    fake.failNext({ method: "GET", path: new RegExp(`/v1/workouts/${workout.id}$`) }, () => problemResponse(500, "about:blank"));
    await screen.findByText(/Couldn't load this workout/);
    expect(screen.getByRole("link", { name: "Back to History" })).toHaveAttribute("href", "/app/history");
  });
});

describe("AC30 — finished workout summary", () => {
  it("shows the date, duration and every exercise's sets, formatted", async () => {
    setup();

    expect(await screen.findByRole("heading", { name: "Workout summary" })).toBeInTheDocument();
    expect(screen.getByText("Fri 2 Oct")).toBeInTheDocument(); // 17.2 AC8: the minutes moved to the stats row
    expect(screen.getByText("duration").previousElementSibling).toHaveTextContent("58 min");
    const bench = screen.getByRole("region", { name: "Barbell bench press" });
    expect(within(bench).getByText("60 kg × 8")).toBeInTheDocument();
    expect(within(bench).getByText("62.5 kg × 6")).toBeInTheDocument(); // the fixture set has rpe 8: stored, never shown (17.1 AC3)
    expect(within(bench).queryByText(/@\s?8|RPE/)).toBeNull();
    expect(within(screen.getByRole("region", { name: "Pull-up" })).getByText("12 reps")).toBeInTheDocument();
  });

  it("is read-only: no input, select or textarea, and no edit affordance (amended by 18.0 AC1: its one edit control is Edit workout, a link to the edit screen)", async () => {
    setup();
    await screen.findByRole("heading", { name: "Workout summary" });

    const main = screen.getByRole("main");
    expect(main.querySelector("input, select, textarea")).toBeNull();
    expect(within(main).getAllByRole("button", { name: /edit/i }).map((b) => b.textContent)).toEqual(["Edit workout"]);
    expect(within(main).queryByRole("button", { name: /log set|finish|add exercise/i })).not.toBeInTheDocument();
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

    await user.click(await revealDelete(user));
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

    await user.click(await revealDelete(user));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts"));
  });

  it("Cancel keeps the workout", async () => {
    const { fake, user } = setup();
    await screen.findByRole("heading", { name: "Workout summary" });
    await user.click(await revealDelete(user));

    await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Delete this workout?" })).not.toBeInTheDocument();
    expect(fake.requests.filter((r) => r.method === "DELETE")).toHaveLength(0);
  });

  it("a network failure on delete shows a retryable error and stays on the summary", async () => {
    const { fake, user, router } = setup();
    fake.failNext({ method: "DELETE", path: /\/v1\/workouts\// }, () => HttpResponse.error());
    await screen.findByRole("heading", { name: "Workout summary" });
    await user.click(await revealDelete(user));
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
    const { user } = renderApp(`/app/workouts/${workout.id}`);

    expect(await screen.findByRole("region", { name: "Barbell bench press" })).toBeInTheDocument();
    const block = await screen.findByRole("region", { name: "Personal records" });
    expect(within(block).getByRole("alert")).toHaveTextContent("Couldn't load records");
    expect(await revealDelete(user)).toBeEnabled();
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
    expect(within(block).getByRole("heading", { level: 3, name: "Barbell bench press" })).toBeInTheDocument(); // 17.2 AC15: a card
    expect(within(block).getByText("226 lb")).toBeInTheDocument();
    expect(within(block).getByText("was 220.5 lb")).toBeInTheDocument();
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
    await user.click(await revealDelete(user));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/app/history"));
    expect(fake.state.finished.has(workout.id)).toBe(false);
    // Review Focus 3: History refetches, so the deleted workout's row is gone.
    expect(await screen.findByText("No finished workouts yet")).toBeInTheDocument();
  });

  it("from Workouts: Back to Workouts, and a delete lands on Workouts (unchanged)", async () => {
    const { user, router } = setup();
    expect(await screen.findByRole("link", { name: "Back to Workouts" })).toHaveAttribute("href", "/app/workouts");
    await user.click(await revealDelete(user));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts"));
  });
});

const routineWorkout = (routineName: string | null) =>
  makeWorkoutDetail({
    startedAt: "2026-10-02T18:02:00.000Z",
    endedAt: "2026-10-02T19:00:00.000Z",
    routineName,
    exercises: [
      { modality: "weight_reps", name: "Bench", supersetGroup: 4, targetSets: 4, targetRepsLow: 6, targetRepsHigh: 8, notes: "Pause the last rep", sets: [makeSet({ setNumber: 1 })] },
      { modality: "weight_reps", name: "Row", supersetGroup: 4, sets: [makeSet({ setNumber: 1 })] },
      { modality: "weight_reps", name: "Curl", supersetGroup: 9, sets: [makeSet({ setNumber: 1 })] },
    ],
  });

function setupWith(workout: ReturnType<typeof makeWorkoutDetail>, path: string) {
  const fake = createWorkoutFake({ finished: [workout] });
  prepareApp({ auth, fake });
  return renderApp(path.replace(":id", workout.id));
}

describe("10.1 AC24 — finished workout and History detail", () => {
  it.each(["/app/workouts/:id", "/app/history/:id"])("%s: target line, notes, bracket, names and From routine", async (path) => {
    setupWith(routineWorkout("Push A"), path);
    await screen.findByRole("heading", { name: "Workout summary" });
    expect(screen.getByText("From routine: Push A")).toBeInTheDocument();
    const bench = screen.getByRole("region", { name: "Bench, superset 1, 4 × 6–8" });
    expect(within(bench).getByText("4 × 6–8")).toBeInTheDocument();
    expect(within(bench).getByText("Pause the last rep")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Row, superset 1" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Curl" })).toBeInTheDocument();
    expect(Array.from(document.querySelectorAll("[data-bracket]")).map((e) => e.getAttribute("data-bracket"))).toEqual(["first", "middle", "last"]);
    expect(screen.queryByRole("button", { name: /^Superset / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Move (up|down)/ })).not.toBeInTheDocument();
  });
  it("no From routine line when routineName is null", async () => {
    setupWith(routineWorkout(null), "/app/workouts/:id");
    await screen.findByRole("heading", { name: "Workout summary" });
    expect(screen.queryByText(/From routine/)).not.toBeInTheDocument();
  });
  it("a deleted routine still shows: the name is the snapshot", async () => {
    // The fake holds no routine at all; the workout's routineName is all there is.
    setupWith(routineWorkout("Deleted routine"), "/app/history/:id");
    expect(await screen.findByText("From routine: Deleted routine")).toBeInTheDocument();
  });
});

describe("10.1 AC18 — tolerant shapes on the finished screen", () => {
  it("a group of one and two stretches sharing a number draw no stray bracket", async () => {
    const w = makeWorkoutDetail({
      startedAt: "2026-10-02T18:02:00.000Z",
      endedAt: "2026-10-02T19:00:00.000Z",
      exercises: [
        { modality: "weight_reps", name: "A", supersetGroup: 5 },
        { modality: "weight_reps", name: "B", supersetGroup: 3 },
        { modality: "weight_reps", name: "C", supersetGroup: 3 },
        { modality: "weight_reps", name: "D" },
        { modality: "weight_reps", name: "E", supersetGroup: 3 },
        { modality: "weight_reps", name: "F", supersetGroup: 3 },
      ],
    });
    setupWith(w, "/app/workouts/:id");
    await screen.findByRole("heading", { name: "Workout summary" });
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label") ?? r.textContent?.split("\n")[0])).toEqual(
      expect.arrayContaining(["B, superset 1", "C, superset 1", "E, superset 2", "F, superset 2"]),
    );
    expect(screen.getByRole("region", { name: "A" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "D" })).toBeInTheDocument();
    expect(Array.from(document.querySelectorAll("[data-bracket]")).map((e) => e.getAttribute("data-bracket"))).toEqual([
      "first", "middle", "last", "first", "middle", "last",
    ]);
  });
});

describe("17.0 AC8 — warm-up sets are marked on the summary too", () => {
  it("marks a warm-up row with data-set-type and a hidden W; working rows get an empty slot", async () => {
    const workout = makeWorkoutDetail({
      startedAt: "2026-10-02T18:02:00.000Z",
      endedAt: "2026-10-02T19:00:00.000Z",
      exercises: [
        {
          modality: "weight_reps",
          name: "Back squat",
          sets: [makeSet({ setNumber: 1, weight: 60, reps: 5, setType: "warmup" }), makeSet({ setNumber: 2, weight: 100, reps: 5 })],
        },
      ],
    });
    prepareApp({ auth, fake: createWorkoutFake({ finished: [workout], active: null }) });
    renderApp(`/app/history/${workout.id}`);

    const squat = await screen.findByRole("region", { name: "Back squat" });
    const [warm, working] = within(squat).getAllByRole("listitem");
    expect(warm).toHaveAttribute("data-set-type", "warmup");
    expect(warm!.querySelector('[aria-hidden="true"]')?.textContent).toBe("W");
    expect(warm).toHaveTextContent("(Warm-up)");
    expect(working).toHaveAttribute("data-set-type", "working");
    expect(working!.querySelector('[aria-hidden="true"]')?.textContent).toBe("");
  });
});

describe("18.0 AC1 — Edit workout on the summary", () => {
  it.each(["workouts", "history"] as const)("on /app/%s/:id: a secondary button after the stats, before the records; it navigates with no request", async (section) => {
    const { fake, workout, user, router } = setup((id) => `/app/${section}/${id}`);
    fake.state.records.push(makePersonalRecord({ workoutId: workout.id }));
    const button = await screen.findByRole("button", { name: "Edit workout" });
    expect(button.className).toMatch(/_secondary_/);
    const stats = screen.getByText("duration");
    const records = await screen.findByRole("region", { name: "Personal records" });
    expect(stats.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(records) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const writes = () => fake.requests.filter((r) => r.method !== "GET").length;
    const before = writes();
    await user.click(button);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/${section}/${workout.id}/edit`));
    expect(writes()).toBe(before);
  });

  it("is absent while the workout is loading and on the load-failed state", async () => {
    const workout = finished();
    const fake = createWorkoutFake({ finished: [workout] });
    fake.failNext({ method: "GET", path: /^\/v1\/workouts\/[^/]+$/ }, () => problemResponse(500, "internal"));
    prepareApp({ auth, fake });
    renderApp(`/app/history/${workout.id}`);
    expect(screen.queryByRole("button", { name: "Edit workout" })).toBeNull();
    await screen.findByText("Couldn't load this workout.");
    expect(screen.queryByRole("button", { name: "Edit workout" })).toBeNull();
  });
});
