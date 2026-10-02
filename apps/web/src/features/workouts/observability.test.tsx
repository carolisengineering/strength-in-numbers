import { MODALITY_VALUES, SET_TYPE_VALUES } from "@sin/core";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

// Distinctive on purpose, so a leak is unmistakable in a scan.
const SECRET_NAME = "Zebra Overhead Press";
const SECRET_NUMBERS = ["73.5", "11"]; // the weight and reps typed below
const bench = makeExercise({ id: exerciseId(1), name: SECRET_NAME, modality: "weight_reps" });

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
type Kind = "string" | "number" | "boolean";
/** Spec 06.1 §9, plus the 06.0 picker's own event: the only events and properties that may appear. */
const SHAPES: Record<string, Record<string, Kind>> = {
  workout_started: { resumed: "boolean" },
  exercise_added: { modality: "string" },
  exercise_moved: { direction: "string" },
  exercise_removed: { setCount: "number" },
  set_logged: { modality: "string", setType: "string", edited: "boolean", msToLog: "number" },
  set_edited: { modality: "string" },
  set_deleted: { modality: "string" },
  finish_blocked: { incompleteCount: "number" },
  workout_finished: { exerciseCount: "number", setCount: "number", durationMin: "number", viaReplay: "boolean" },
  workout_discarded: { phase: "string", setCount: "number" },
  workout_conflict: { kind: "string" },
  exercise_picked: { source: "string", msSinceOpen: "number" },
};
const ENUMS: Record<string, readonly string[]> = {
  modality: MODALITY_VALUES,
  setType: SET_TYPE_VALUES,
  direction: ["up", "down"],
  phase: ["active", "finished"],
  kind: ["gone", "finished", "retired", "unavailable", "stale-position", "clock"],
};
const OPERATIONS = [
  "add-exercise", "move-exercise", "remove-exercise", "create-set", "update-set", "delete-set", "finish", "discard", "start-workout", "load-active", "load-workout",
];

const seen = new Set<string>();

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  // Every flow's payloads are scanned after the test that drove it.
  for (const [event, props] of observability.track.mock.calls as [string, Record<string, unknown> | undefined][]) {
    seen.add(event);
    const shape = SHAPES[event];
    expect(shape, `unexpected event ${event}`).toBeDefined();
    for (const [key, value] of Object.entries(props ?? {})) {
      expect(Object.keys(shape!), `${event} has an unexpected property ${key}`).toContain(key);
      expect(typeof value, `${event}.${key}`).toBe(shape![key]);
      if (typeof value === "string") {
        expect(value).not.toMatch(UUID);
        expect(value).not.toContain(SECRET_NAME);
        for (const n of SECRET_NUMBERS) expect(value).not.toBe(n);
        if (ENUMS[key]) expect(ENUMS[key], `${event}.${key}=${value}`).toContain(value);
      }
    }
  }
  for (const call of observability.reportError.mock.calls) {
    const context = call[1] as Record<string, unknown>;
    expect(Object.keys(context).sort()).toEqual(["op", "source"]);
    expect(context["source"]).toBe("workouts");
    expect(OPERATIONS).toContain(context["op"]);
  }
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

afterAll(() => {
  // Across the flows below, every event in §9 has actually fired.
  for (const event of Object.keys(SHAPES).filter((e) => e !== "exercise_picked")) expect(seen, event).toContain(event);
});

async function setup(exercises: ExerciseSpec[] = []) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }), catalog: [bench] });
  prepareApp({ auth, fake, catalog: [bench] });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

const card = (name: string) => within(screen.getByRole("article", { name }));
const finishConfirm = () => within(screen.getByRole("dialog", { name: "Finish workout?" })).getByRole("button", { name: "Finish" });

describe("AC35 — observability hygiene across the flows", () => {
  it("start (fresh and resumed)", async () => {
    const fake = createWorkoutFake();
    prepareApp({ auth, fake });
    const { user } = renderApp("/app/workouts");
    await user.click(await screen.findByRole("button", { name: "Start workout" }));
    await screen.findByRole("heading", { name: "Workout" });
    expect(observability.track).toHaveBeenCalledWith("workout_started", { resumed: false });
  });

  it("start when one is already in progress", async () => {
    const fake = createWorkoutFake();
    prepareApp({ auth, fake });
    const { user } = renderApp("/app/workouts");
    const start = await screen.findByRole("button", { name: "Start workout" });
    fake.state.active = makeWorkoutDetail();
    await user.click(start);
    await screen.findByRole("heading", { name: "Workout" });
    expect(observability.track).toHaveBeenCalledWith("workout_started", { resumed: true });
  });

  it("add, log, edit, delete a set, move, remove, finish", async () => {
    const { user, router } = await setup();
    await user.click(screen.getByRole("button", { name: "Add exercise" }));
    const dialog = await screen.findByRole("dialog", { name: "Add exercise" });
    await user.click(within(within(dialog).getByRole("region", { name: "All exercises" })).getByRole("button", { name: new RegExp(SECRET_NAME) }));
    await screen.findByRole("article", { name: SECRET_NAME });

    await user.type(card(SECRET_NAME).getByLabelText("Weight"), SECRET_NUMBERS[0]!);
    await user.type(card(SECRET_NAME).getByLabelText("Reps"), SECRET_NUMBERS[1]!);
    await user.click(card(SECRET_NAME).getByRole("button", { name: "Log set" }));
    await card(SECRET_NAME).findByText(/73\.5 kg × 11/);

    await user.click(card(SECRET_NAME).getByRole("button", { name: /73\.5 kg × 11/ }));
    const sheet = screen.getByRole("dialog", { name: new RegExp(`Set 1 · ${SECRET_NAME}`) });
    await user.clear(within(sheet).getByLabelText("Reps"));
    await user.type(within(sheet).getByLabelText("Reps"), "9");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await card(SECRET_NAME).findByText(/73\.5 kg × 9/);

    await user.click(card(SECRET_NAME).getByRole("button", { name: /73\.5 kg × 9/ }));
    await user.click(within(screen.getByRole("dialog", { name: /^Set 1/ })).getByRole("button", { name: "Delete set" }));
    await waitFor(() => expect(card(SECRET_NAME).queryByText(/73\.5/)).not.toBeInTheDocument());

    await user.click(card(SECRET_NAME).getByRole("button", { name: "Options" }));
    await user.click(card(SECRET_NAME).getByRole("button", { name: "Remove exercise" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: SECRET_NAME })).not.toBeInTheDocument());
    expect(observability.track).toHaveBeenCalledWith("exercise_removed", { setCount: 0 });

    // finish needs a set: add the exercise again and log one
    await user.click(screen.getByRole("button", { name: "Add exercise" }));
    const again = await screen.findByRole("dialog", { name: "Add exercise" });
    await user.click(within(within(again).getByRole("region", { name: "All exercises" })).getByRole("button", { name: new RegExp(SECRET_NAME) }));
    await screen.findByRole("article", { name: SECRET_NAME });
    await user.type(card(SECRET_NAME).getByLabelText("Weight"), SECRET_NUMBERS[0]!);
    await user.type(card(SECRET_NAME).getByLabelText("Reps"), SECRET_NUMBERS[1]!);
    await user.click(card(SECRET_NAME).getByRole("button", { name: "Log set" }));
    await card(SECRET_NAME).findByText(/73\.5 kg × 11/);
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await user.click(finishConfirm());
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/app\/workouts\/.+/));
    expect(observability.track).toHaveBeenCalledWith("workout_finished", expect.objectContaining({ exerciseCount: 1, setCount: 1 }));
  });

  it("move", async () => {
    const { user } = await setup([
      { modality: "weight_reps", name: "A" },
      { modality: "weight_reps", name: "B" },
    ]);
    await user.click(card("B").getByRole("button", { name: "Options" }));
    await user.click(card("B").getByRole("button", { name: "Move up" }));
    await waitFor(() => expect(observability.track).toHaveBeenCalledWith("exercise_moved", { direction: "up" }));
  });

  it("finish blocked, then finished by replay", async () => {
    const { fake, user, router } = await setup([
      { modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1, weight: null, weightUnit: null, reps: 8, isComplete: false })] },
    ]);
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await user.click(finishConfirm());
    await screen.findByText("Needs data");
    expect(observability.track).toHaveBeenCalledWith("finish_blocked", { incompleteCount: 1 });

    // fix it, then have the first finish "land" with a lost response
    await user.click(screen.getByRole("button", { name: /Needs data/ }));
    await user.type(within(screen.getByRole("dialog", { name: /Set 1/ })).getByLabelText("Weight"), "60");
    await user.click(within(screen.getByRole("dialog", { name: /Set 1/ })).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByText("Needs data")).not.toBeInTheDocument());
    const id = fake.state.active!.id;
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () => problemResponse(409, "workout-finished"));
    fake.state.finished.set(id, { ...fake.state.active!, endedAt: new Date().toISOString() });
    fake.state.active = null;
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await user.click(finishConfirm());
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${id}`));
  });

  it("discard", async () => {
    const { user } = await setup([{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1 })] }]);
    await user.click(screen.getByRole("button", { name: "Discard workout" }));
    await user.click(within(screen.getByRole("dialog", { name: "Discard this workout?" })).getByRole("button", { name: "Discard" }));
    await screen.findByRole("heading", { name: "Start a workout" });
  });

  it("delete from the summary", async () => {
    const finished = makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z", exercises: [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1 })] }] });
    const fake = createWorkoutFake({ finished: [finished] });
    prepareApp({ auth, fake });
    const { user } = renderApp(`/app/workouts/${finished.id}`);
    await user.click(await screen.findByRole("button", { name: "Delete workout" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));
    await screen.findByRole("heading", { name: "Start a workout" });
  });

  it("conflicts: retired, gone, clock", async () => {
    const { fake, user } = await setup([{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1 })] }]);
    // retired
    fake.failNext({ method: "POST", path: /\/exercises$/ }, () => problemResponse(409, "exercise-retired"));
    await user.click(screen.getByRole("button", { name: "Add exercise" }));
    const dialog = await screen.findByRole("dialog", { name: "Add exercise" });
    await user.click(within(within(dialog).getByRole("region", { name: "All exercises" })).getByRole("button", { name: new RegExp(SECRET_NAME) }));
    await screen.findByText(/has been retired/);
    // clock
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () => problemResponse(422, "validation-error"));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await user.click(finishConfirm());
    await screen.findByText(/device clock looks wrong/);
    // gone
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => problemResponse(409, "workout-finished"));
    fake.state.active = null;
    await user.click(card("X").getByRole("button", { name: "Log set" }));
    await screen.findByRole("heading", { name: "Start a workout" });
    for (const kind of ["retired", "clock", "finished"]) {
      expect(observability.track).toHaveBeenCalledWith("workout_conflict", { kind });
    }
  });

  it("set_edited carries only the modality, and an unrecognised failure is reported with static tags only", async () => {
    const { fake, user } = await setup([{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] }]);
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => problemResponse(409, "something-new"));
    await user.clear(card("X").getByLabelText("Reps"));
    await user.type(card("X").getByLabelText("Reps"), "7");
    await user.click(card("X").getByRole("button", { name: "Log set" }));

    await waitFor(() => expect(observability.reportError).toHaveBeenCalledTimes(1));
    expect(observability.reportError).toHaveBeenCalledWith(expect.anything(), { source: "workouts", op: "create-set" });
  });

  it("expected failures are not reported", async () => {
    const { fake, user } = await setup([{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] }]);
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => HttpResponse.error());
    await user.click(card("X").getByRole("button", { name: "Log set" }));
    await screen.findByText("Couldn't log set — try again");
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => problemResponse(500, "about:blank"));
    await user.click(card("X").getByRole("button", { name: "Log set" }));
    await waitFor(() => expect(fake.requests.filter((r) => r.path.endsWith("/sets"))).toHaveLength(2));
    expect(observability.reportError).not.toHaveBeenCalled();
  });
});

describe("the exercise-id helper used above is a real catalog id (sanity)", () => {
  it("is a UUID, so the scan's UUID rule would catch a leaked one", () => {
    expect(bench.id).toMatch(UUID);
  });
});
