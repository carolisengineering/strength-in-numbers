import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { segmentChoice } from "../../test/controls";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlannedSet } from "@sin/core";

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

import { localStorageAdapter } from "../../storage/storage";
import { API_BASE_URL } from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";
import { card, deleteSetIn, logButton, makeCurrent, openSetOptions, optionsButton, restBetweenSets } from "../../test/sessionHelpers";
import { DRAFTS_KEY } from "./drafts/draftStore";
import { findIncompleteWorkingSets } from "./incomplete";
import { WORKOUT_KEYS } from "./queries";

afterEach(() => {
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

const planned = (setType: PlannedSet["setType"], reps: number | null, weight: number | null, unit: "kg" | "lb" = "kg"): PlannedSet => ({
  setType,
  repsLow: reps,
  repsHigh: reps,
  weight,
  weightUnit: weight === null ? null : unit,
});
const PLAN = [planned("warmup", 10, 60), planned("working", 8, 80), planned("working", 6, 100)];

async function setup(exercises: ExerciseSpec[], unitPreference: "kg" | "lb" = "kg") {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }) });
  prepareApp({ auth, fake, unitPreference });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
const setPosts = (fake: ReturnType<typeof createWorkoutFake>) => fake.requests.filter((r) => r.method === "POST" && r.path.endsWith("/sets"));
const field = (name: string, label: string) => within(card(name)).getByLabelText(label);
const logged = (n: number, o: Record<string, unknown> = {}) => makeSet({ setNumber: n, ...o });
const bench = (o: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name: "Bench", plannedSets: PLAN, ...o });

describe("10.2 AC21 — the label", () => {
  it.each([
    [0, "Set 1 of 3 · Warm-up"],
    [1, "Set 2 of 3"],
    [2, "Set 3 of 3"],
    [3, "Extra set"],
    [4, "Extra set"],
  ])("%i logged → %s", async (count, label) => {
    await setup([bench({ sets: Array.from({ length: count }, (_, i) => logged(i + 1)) })]);
    expect(within(card("Bench")).getByText(label)).toBeInTheDocument();
  });
  it("with no plan it is today's 'Set {n + 1}'", async () => {
    await setup([{ modality: "weight_reps", name: "Bench", sets: [logged(1), logged(2)] }]);
    expect(within(card("Bench")).getByText("Set 3")).toBeInTheDocument();
  });
  it("is plain text; the form's accessible name and the 'Set N logged' announcement are unchanged", async () => {
    const { user } = await setup([bench()]);
    const label = within(card("Bench")).getByText("Set 1 of 3 · Warm-up");
    // Spec 17.8 AC5: the set label is a span in the set line's paragraph, beside the target.
    expect(label.closest("p")).not.toBeNull();
    expect(label).not.toHaveAttribute("role");
    expect(label.closest("p")).not.toHaveAttribute("role");
    expect(screen.getByRole("form", { name: "Log a set of Bench" })).toBeInTheDocument();
    await user.click(logButton("Bench"));
    await waitFor(() => expect(within(card("Bench")).getByRole("status")).toHaveTextContent("Set 1 logged"));
  });
});

describe("10.2 AC22 / AC23 — the draft arrives filled; one tap logs it", () => {
  it("fills type, weight, unit and reps from the next row; there is no RPE field", async () => {
    const { user } = await setup([bench()]);
    await openSetOptions(user, card("Bench"));
    expect(segmentChoice("Set type", card("Bench"))).toBe("warmup");
    expect(field("Bench", "Weight")).toHaveValue("60");
    expect(segmentChoice("Weight unit", card("Bench"))).toBe("kg");
    expect(field("Bench", "Reps")).toHaveValue("10");
    expect(screen.queryByLabelText("RPE")).toBeNull();
  });
  it("the plan's unit wins over the profile's", async () => {
    const { user } = await setup([bench({ plannedSets: [planned("working", 5, 135, "lb")] })], "kg");
    await openSetOptions(user, card("Bench"));
    expect(segmentChoice("Weight unit", card("Bench"))).toBe("lb");
  });
  it("a single tap sends the row's values, isComplete, the attempt key and the row's type; a warm-up logs as warmup", async () => {
    const { fake, user } = await setup([bench()]);
    expect(logButton("Bench")).not.toHaveAttribute("aria-disabled");
    await user.click(logButton("Bench"));
    await waitFor(() => expect(setPosts(fake)).toHaveLength(1));
    expect(setPosts(fake)[0]!.body).toMatchObject({ setType: "warmup", reps: 10, weight: 60, weightUnit: "kg", isComplete: true, clientGeneratedId: expect.any(String) });
  });
  it("a row that leaves a required measure blank keeps Log set disabled, with no error until touched", async () => {
    await setup([bench({ plannedSets: [planned("working", 8, null)] })]);
    expect(logButton("Bench")).toHaveAttribute("aria-disabled", "true");
    expect(within(card("Bench")).queryByText("Required")).toBeNull();
    expect(field("Bench", "Reps")).toHaveValue("8");
  });
});

describe("10.2 AC24 — after a log", () => {
  it("each tap logs the next row; after the last it is 'Extra set' with the last set copied", async () => {
    const { fake, user } = await setup([bench()]);
    await user.click(logButton("Bench"));
    await within(card("Bench")).findByText("Set 2 of 3");
    await openSetOptions(user, card("Bench"));
    expect(field("Bench", "Weight")).toHaveValue("80");
    expect(field("Bench", "Reps")).toHaveValue("8");
    expect(segmentChoice("Set type", card("Bench"))).toBe("working");
    await restBetweenSets();
    await user.click(logButton("Bench"));
    await within(card("Bench")).findByText("Set 3 of 3");
    expect(field("Bench", "Weight")).toHaveValue("100");
    await restBetweenSets();
    await user.click(logButton("Bench"));
    await within(card("Bench")).findByText("Extra set");
    expect(field("Bench", "Weight")).toHaveValue("100");
    expect(field("Bench", "Reps")).toHaveValue("6");
    await openSetOptions(user, card("Bench")); // Spec 17.7: a log closes More
    expect(segmentChoice("Set type", card("Bench"))).toBe("working");
    expect(setPosts(fake)).toHaveLength(3);
  });

  it("values typed while the POST is in flight survive the response; only the label advances", async () => {
    const { fake, user } = await setup([bench({ plannedSets: [planned("working", 8, 80), planned("working", 8, 80), planned("working", 8, 80)] })]);
    const exerciseRowId = fake.state.active!.exercises[0]!.id;
    const gate = deferred<void>();
    server.use(
      http.post(`${API_BASE_URL}/v1/workout-exercises/:id/sets`, async () => {
        await gate.promise;
        return HttpResponse.json(makeSet({ workoutExerciseId: exerciseRowId, setNumber: 1, weight: 80, reps: 8 }), { status: 201 });
      }),
    );
    await user.click(logButton("Bench"));
    const weight = field("Bench", "Weight");
    await user.clear(weight);
    await user.type(weight, "82.5");
    gate.resolve();
    await within(card("Bench")).findByText("Set 2 of 3");
    expect(weight).toHaveValue("82.5");
  });
});

describe("10.2 AC25 — a count change that is not this row's own log", () => {
  const twoLogged = () => [logged(1, { setType: "warmup", reps: 10, weight: 60 }), logged(2, { reps: 8, weight: 80 })];
  const deleteSecond = async (user: ReturnType<typeof renderApp>["user"]) => {
    await user.click(within(card("Bench")).getByRole("button", { name: /80 kg × 8/ }));
    await deleteSetIn(user, await screen.findByRole("dialog"));
  };

  it("deleting a set steps the label back and reseeds an untouched draft", async () => {
    const { user } = await setup([bench({ sets: twoLogged() })]);
    expect(within(card("Bench")).getByText("Set 3 of 3")).toBeInTheDocument();
    expect(field("Bench", "Weight")).toHaveValue("100");
    await deleteSecond(user);
    await within(card("Bench")).findByText("Set 2 of 3");
    await waitFor(() => expect(field("Bench", "Weight")).toHaveValue("80"));
    expect(field("Bench", "Reps")).toHaveValue("8");
  });

  it("an edited draft keeps the lifter's values; only the label follows", async () => {
    const { user } = await setup([bench({ sets: twoLogged() })]);
    const reps = field("Bench", "Reps");
    await user.clear(reps);
    await user.type(reps, "99");
    await deleteSecond(user);
    await within(card("Bench")).findByText("Set 2 of 3");
    expect(field("Bench", "Reps")).toHaveValue("99");
  });

  // Another device logs a set: the next refetch carries one more set on the same exercise.
  const otherDeviceLogs = (fake: ReturnType<typeof createWorkoutFake>) => {
    const active = fake.state.active!;
    fake.state.active = {
      ...active,
      exercises: active.exercises.map((e) => ({ ...e, sets: [...e.sets, logged(e.sets.length + 1, { workoutExerciseId: e.id, reps: 8, weight: 80 })] })),
    };
  };

  it("another device logging (a refetch that raises the count) reseeds an untouched draft", async () => {
    const { fake, queryClient } = await setup([bench({ sets: [logged(1, { setType: "warmup", reps: 10, weight: 60 })] })]);
    expect(field("Bench", "Weight")).toHaveValue("80");
    otherDeviceLogs(fake);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
    });
    await within(card("Bench")).findByText("Set 3 of 3");
    await waitFor(() => expect(field("Bench", "Weight")).toHaveValue("100"));
  });

  it("…but an edited draft keeps its values, and a refetch that does not change the count never changes the draft", async () => {
    const { fake, queryClient, user } = await setup([bench({ sets: [logged(1, { setType: "warmup", reps: 10, weight: 60 })] })]);
    const refetch = () =>
      act(async () => {
        await queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
      });
    const reps = field("Bench", "Reps");
    await user.clear(reps);
    await user.type(reps, "7");
    await refetch(); // same count
    expect(field("Bench", "Reps")).toHaveValue("7");
    otherDeviceLogs(fake);
    await refetch(); // count up, draft edited
    await within(card("Bench")).findByText("Set 3 of 3");
    expect(field("Bench", "Reps")).toHaveValue("7");
  });
});

describe("10.2 AC20 — a queued set counts at once (06.2)", () => {
  it("offline, the label and the prefill advance as soon as the set is queued", async () => {
    const { fake, user } = await setup([bench()]);
    fake.setOffline(true);
    await user.click(logButton("Bench"));
    await within(card("Bench")).findByText("Set 2 of 3");
    expect(within(card("Bench")).getByText("Not saved yet")).toBeInTheDocument();
    expect(field("Bench", "Weight")).toHaveValue("80");
    expect(field("Bench", "Reps")).toHaveValue("8");
  });
});

describe("10.2 AC26 — an untouched prefill is not a set", () => {
  it("sends no request on mount and stores nothing", async () => {
    const { fake } = await setup([bench({ sets: [logged(1)] })]);
    const before = Object.keys(window.localStorage).sort();
    await new Promise((r) => setTimeout(r, 400)); // past Spec 06.5's draft debounce
    expect(setPosts(fake)).toHaveLength(0);
    // The app's own startup writes (catalog cache, …) are already in; an untouched row adds nothing to them.
    // (Spec 06.5 reverses the old "even a typed draft is never stored": an EDITED draft is now persisted.)
    expect(Object.keys(window.localStorage).sort()).toEqual(before);
  });
  it("the finish rule ignores it, and Finish succeeds without logging it", async () => {
    const exercises = [bench({ sets: [logged(1, { setType: "warmup", reps: 10, weight: 60 })] })];
    expect(findIncompleteWorkingSets(makeWorkoutDetail({ exercises }))).toEqual([]);
    const { fake, user } = await setup(exercises);
    // Spec 17.1 AC33: with planned sets left, finishing is End workout early in the Workout menu.
    await user.click(screen.getByRole("button", { name: "Workout menu" }));
    await user.click(screen.getByRole("button", { name: "End workout early" }));
    await user.click(within(screen.getByRole("dialog", { name: "End workout early?" })).getByRole("button", { name: "End workout" }));
    await waitFor(() => expect(fake.requests.some((r) => r.method === "PATCH" && /^\/v1\/workouts\//.test(r.path))).toBe(true));
    expect(setPosts(fake)).toHaveLength(0);
  });
  // Spec 06.5 reverses this test's old expectation ("re-seeds it from the list" after typing): an edited draft
  // now survives leaving the screen.
  it("navigating away and back keeps an edited draft", async () => {
    const { router, user } = await setup([bench({ sets: [logged(1)] })]);
    const reps = field("Bench", "Reps");
    await user.clear(reps);
    await user.type(reps, "77");
    await act(() => router.navigate("/app/history"));
    await act(() => router.navigate("/app/workouts"));
    await screen.findByRole("heading", { name: "Workout" });
    expect(field("Bench", "Reps")).toHaveValue("77");
  });
});

describe("10.2 AC27 — no plan, no change", () => {
  it.each([
    ["added by hand", { modality: "weight_reps", name: "Bench", sets: [logged(1, { weight: 60, reps: 8 })] } as ExerciseSpec],
    ["a rowless routine item", { modality: "weight_reps", name: "Bench", targetSets: 3, targetRepsLow: 8, targetRepsHigh: 8, sets: [logged(1, { weight: 60, reps: 8 })] } as ExerciseSpec],
  ])("%s keeps today's entry row: 'Set {n + 1}' and the copy-forward draft", async (_name, exercise) => {
    const { user } = await setup([exercise]);
    await openSetOptions(user, card("Bench"));
    expect(within(card("Bench")).getByText("Set 2")).toBeInTheDocument();
    expect(field("Bench", "Weight")).toHaveValue("60");
    expect(field("Bench", "Reps")).toHaveValue("8");
    expect(segmentChoice("Set type", card("Bench"))).toBe("working");
    expect(within(card("Bench")).queryByText(/ of /)).toBeNull();
  });
});

describe("10.2 AC28 — each card has its own plan and progress", () => {
  it("a superset pair: each card seeds from its own plan and count", async () => {
    const { user } = await setup([
      { modality: "weight_reps", name: "Bench", supersetGroup: 1, plannedSets: [planned("working", 5, 50), planned("working", 5, 55)] },
      { modality: "weight_reps", name: "Row", supersetGroup: 1, plannedSets: [planned("working", 12, 30)] },
    ]);
    // Spec 17.1 AC9: only the current card mounts its entry row, so visit each.
    const benchCard = await makeCurrent(user, /^Bench, superset 1/);
    expect(within(benchCard).getByText("Set 1 of 2")).toBeInTheDocument();
    expect(within(benchCard).getByLabelText("Weight")).toHaveValue("50");
    const rowCard = await makeCurrent(user, /^Row, superset 1/);
    expect(within(rowCard).getByText("Set 1 of 1")).toBeInTheDocument();
    expect(within(rowCard).getByLabelText("Weight")).toHaveValue("30");
    await makeCurrent(user, /^Bench, superset 1/);
    await user.click(logButton("Bench"));
    // Spec 17.1 AC15: the log alternates to Row, so reopen Bench to see its progress.
    await within(await makeCurrent(user, /^Bench, superset 1/)).findByText("Set 2 of 2");
    expect(within(await makeCurrent(user, /^Row, superset 1/)).getByText("Set 1 of 1")).toBeInTheDocument();
  });
  it("one exercise listed twice yields two cards with their own plans", async () => {
    const { user } = await setup([
      { modality: "weight_reps", name: "Bench", plannedSets: [planned("working", 5, 50)] },
      { modality: "weight_reps", name: "Bench", plannedSets: [planned("working", 12, 30)] },
    ]);
    expect(screen.getAllByRole("article", { name: "Bench" })).toHaveLength(2);
    expect(within(screen.getAllByRole("article", { name: "Bench" })[0]!).getByLabelText("Weight")).toHaveValue("50");
    // Spec 17.1 AC9: the second card is collapsed (same name, so tap its own heading button).
    await user.click(within(within(screen.getAllByRole("article", { name: "Bench" })[1]!).getByRole("heading", { level: 2 })).getByRole("button"));
    expect(within(screen.getAllByRole("article", { name: "Bench" })[1]!).getByLabelText("Weight")).toHaveValue("30");
  });
  it("Move down leaves every card's plan and progress intact", async () => {
    const { user } = await setup([
      { modality: "weight_reps", name: "Bench", plannedSets: [planned("working", 5, 50)] },
      { modality: "weight_reps", name: "Row", plannedSets: [planned("working", 12, 30), planned("working", 12, 32)] },
    ]);
    await user.click(logButton("Bench"));
    // Spec 17.1 AC9: Bench's plan is done, so current advances to Row; Bench is collapsed until tapped.
    await makeCurrent(user, "Bench");
    await within(card("Bench")).findByText("Extra set");
    await user.click(optionsButton("Bench"));
    await user.click(within(card("Bench")).getByRole("button", { name: "Move down" }));
    await waitFor(() => expect(screen.getAllByRole("article")[0]).toHaveAccessibleName("Row"));
    expect(within(card("Bench")).getByText("Extra set")).toBeInTheDocument();
    await makeCurrent(user, "Row");
    expect(within(card("Row")).getByText("Set 1 of 2")).toBeInTheDocument();
    expect(within(card("Row")).getByLabelText("Weight")).toHaveValue("30");
  });
});

describe("10.2 AC33 — nothing planned reaches analytics or error reports", () => {
  it("logging a planned set tracks only the existing set_logged properties", async () => {
    const { user } = await setup([bench({ plannedSets: [planned("working", 8, 82.5)] })]);
    await user.click(logButton("Bench"));
    await within(card("Bench")).findByText("Extra set");
    const call = observability.track.mock.calls.find(([event]) => event === "set_logged")!;
    expect(Object.keys(call[1] as object).sort()).toEqual(["edited", "modality", "msToLog", "setType"]);
    const everything = JSON.stringify([observability.track.mock.calls, observability.reportError.mock.calls]);
    expect(everything).not.toMatch(/82\.5|plannedSets|Set 1 of/);
  });
});

describe("18.1 AC12 — planned prefill for the new types", () => {
  const carryPlan = [planned("working", null, 24), planned("working", null, 32)];
  it("a carry's planned weight is prefilled; logging advances to the next planned row", async () => {
    const { fake, user } = await setup([{ modality: "weight_distance", name: "Carry", plannedSets: carryPlan }]);
    await makeCurrent(user, "Carry");
    expect(field("Carry", "Weight")).toHaveValue("24");
    expect(within(card("Carry")).getByText("Set 1 of 2")).toBeInTheDocument();
    await user.type(field("Carry", "Distance (m)"), "40");
    await user.click(logButton("Carry"));
    await waitFor(() => expect(setPosts(fake)).toHaveLength(1));
    expect(setPosts(fake)[0]!.body).toMatchObject({ weight: 24, weightUnit: "kg", distance: 40, distanceUnit: "m" });
    await waitFor(() => expect(field("Carry", "Weight")).toHaveValue("32"));
    expect(within(card("Carry")).getByText("Set 2 of 2")).toBeInTheDocument();
  });
  it("a calories planned row prefills only the set type", async () => {
    const { user } = await setup([{ modality: "calories", name: "Bike", plannedSets: [planned("warmup", null, null), planned("working", null, null)] }]);
    await makeCurrent(user, "Bike");
    expect(field("Bike", "Calories")).toHaveValue("");
    await openSetOptions(user, card("Bike"));
    expect(segmentChoice("Set type", card("Bike"))).toBe("warmup");
  });
  it("an edited carry draft is not overwritten when the count changes by another route", async () => {
    const { fake, queryClient, user } = await setup([{ modality: "weight_distance", name: "Carry", plannedSets: carryPlan }]);
    await makeCurrent(user, "Carry");
    await user.clear(field("Carry", "Weight"));
    await user.type(field("Carry", "Weight"), "30");
    // Another device logs the first carry: the refetch raises the count.
    const active = fake.state.active!;
    fake.state.active = {
      ...active,
      exercises: active.exercises.map((e) => ({
        ...e,
        sets: [logged(1, { workoutExerciseId: e.id, reps: null, weight: 24, distance: 40, distanceUnit: "m", distanceM: 40 })],
      })),
    };
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
    });
    await within(card("Carry")).findByText("Set 2 of 2");
    expect(field("Carry", "Weight")).toHaveValue("30");
  });
});

// Spec 17.7 Phase B: the Warm-up toggle, through the whole screen (the draft store, telemetry, a log).
const press = (name: string) => within(card(name)).getByRole("button", { name: `Warm-up for ${name}` });
const form = (name: string) => within(card(name)).getByRole("form", { name: `Log a set of ${name}` });
const stored = () => localStorageAdapter().get(DRAFTS_KEY);
const press1 = (o: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name: "Overhead Press", sets: [logged(1, { reps: 8, weight: 40 })], ...o });

describe("17.7 AC13 — a Warm-up tap is an ordinary edit", () => {
  it("sets the draft's type, is stored, and logs as an edited warm-up; another tap goes back to working", async () => {
    const { fake, user } = await setup([press1()]);
    expect(press("Overhead Press")).toHaveAttribute("aria-pressed", "false");
    await user.click(press("Overhead Press"));
    expect(press("Overhead Press")).toHaveAttribute("aria-pressed", "true");
    expect(form("Overhead Press")).toHaveAttribute("data-set-type", "warmup");
    expect(within(card("Overhead Press")).getByText("Set 2 · Warm-up")).toBeInTheDocument();
    await waitFor(() => expect(stored()).toContain('"setType":"warmup"'));
    await user.click(press("Overhead Press"));
    expect(form("Overhead Press")).toHaveAttribute("data-set-type", "working");
    expect(within(card("Overhead Press")).getByText("Set 2")).toBeInTheDocument();
    await user.click(press("Overhead Press"));
    await user.click(logButton("Overhead Press"));
    await waitFor(() => expect(setPosts(fake)).toHaveLength(1));
    expect(setPosts(fake)[0]!.body).toMatchObject({ setType: "warmup" });
    expect(observability.track).toHaveBeenCalledWith("set_logged", expect.objectContaining({ edited: true }));
  });
});

describe("17.7 AC14 — a planned warm-up is already pressed", () => {
  it("is pressed on mount, stores nothing, and logs unedited", async () => {
    const { user } = await setup([bench()]);
    expect(press("Bench")).toHaveAttribute("aria-pressed", "true");
    expect(stored()).toBeNull();
    await user.click(logButton("Bench"));
    await waitFor(() => expect(observability.track).toHaveBeenCalledWith("set_logged", expect.objectContaining({ edited: false })));
    expect(stored()).toBeNull();
  });
});

describe("17.7 AC18 — the toggle does not stick", () => {
  it("an unplanned warm-up's next draft is working again", async () => {
    const { user } = await setup([press1()]);
    await user.click(press("Overhead Press"));
    await user.click(logButton("Overhead Press"));
    await within(card("Overhead Press")).findByText("Set 3");
    expect(form("Overhead Press")).toHaveAttribute("data-set-type", "working");
    expect(press("Overhead Press")).toHaveAttribute("aria-pressed", "false");
  });

  it("a planned ramp follows the plan's next row", async () => {
    const ramp = [planned("warmup", 10, 40), planned("warmup", 5, 60), planned("working", 5, 80)];
    const { user } = await setup([bench({ plannedSets: ramp })]);
    expect(press("Bench")).toHaveAttribute("aria-pressed", "true");
    await user.click(logButton("Bench"));
    await within(card("Bench")).findByText("Set 2 of 3 · Warm-up");
    expect(press("Bench")).toHaveAttribute("aria-pressed", "true");
    await restBetweenSets();
    await user.click(logButton("Bench"));
    await within(card("Bench")).findByText("Set 3 of 3");
    expect(press("Bench")).toHaveAttribute("aria-pressed", "false");
  });

  // Review Focus 3: the plan expected a typed-during-flight log to keep the warm-up (the `rekey` path). On the live
  // screen a log is queued and resolves at once, so the next draft is seeded before any typing and the warm-up ends.
  // What must hold either way: the label and the draft's type agree, so a warm-up is never invisible.
  it("typing after a warm-up log, with the server slow, leaves a working draft whose label says so (Review Focus 3)", async () => {
    const { fake, user } = await setup([press1()]);
    const exerciseRowId = fake.state.active!.exercises[0]!.id;
    const gate = deferred<void>();
    server.use(
      http.post(`${API_BASE_URL}/v1/workout-exercises/:id/sets`, async () => {
        await gate.promise;
        return HttpResponse.json(makeSet({ workoutExerciseId: exerciseRowId, setNumber: 2, setType: "warmup", weight: 40, reps: 8 }), { status: 201 });
      }),
    );
    await user.click(press("Overhead Press"));
    await user.click(logButton("Overhead Press"));
    const reps = field("Overhead Press", "Reps");
    await user.clear(reps);
    await user.type(reps, "7");
    gate.resolve();
    await within(card("Overhead Press")).findByText("Set 3");
    expect(reps).toHaveValue("7");
    expect(form("Overhead Press")).toHaveAttribute("data-set-type", "working");
    expect(press("Overhead Press")).toHaveAttribute("aria-pressed", "false");
    await user.click(press("Overhead Press"));
    expect(within(card("Overhead Press")).getByText("Set 3 · Warm-up")).toBeInTheDocument();
    expect(reps).toHaveValue("7");
  });
});

describe("17.7 AC13, AC17 — a warm-up that comes back", () => {
  it("a stored warm-up draft restores pressed, with the label's suffix", async () => {
    const { user } = await setup([press1()]);
    await user.click(press("Overhead Press"));
    await waitFor(() => expect(stored()).toContain('"setType":"warmup"'));
    cleanup();
    renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    expect(press("Overhead Press")).toHaveAttribute("aria-pressed", "true");
    expect(within(card("Overhead Press")).getByText("Set 2 · Warm-up")).toBeInTheDocument();
  });

  it("a warm-up taken back by Undo restores pressed, with the label's suffix", async () => {
    const { user } = await setup([press1()]);
    await user.click(press("Overhead Press"));
    await user.click(logButton("Overhead Press"));
    const undo = await screen.findByRole("button", { name: /^Undo set 2/ });
    await user.click(undo);
    await within(card("Overhead Press")).findByText("Set 2 · Warm-up");
    expect(press("Overhead Press")).toHaveAttribute("aria-pressed", "true");
  });
});

const RANGE_PLAN: PlannedSet[] = [
  planned("warmup", 8, 40),
  { setType: "working", repsLow: 6, repsHigh: 8, weight: null, weightUnit: null },
  { setType: "working", repsLow: 6, repsHigh: 8, weight: null, weightUnit: null },
];
const benchForm = () => within(card("Bench")).getByRole("form", { name: "Log a set of Bench" });
const setLine = () => within(benchForm()).getByText(/^(Set \d|Extra set)/).closest("p")!;

describe("17.8 AC5 — the panel label", () => {
  it("leads with the exercise's name, hidden from a screen reader; the form keeps its accessible name", async () => {
    await setup([bench({ plannedSets: RANGE_PLAN, sets: [logged(1)] })]);
    const name = within(benchForm()).getByText("Bench");
    expect(name.closest("[aria-hidden='true']")).not.toBeNull();
    expect(screen.getByRole("form", { name: "Log a set of Bench" })).toBe(benchForm());
  });

  it("the set line reads 'Set 2 of 3 · target 6–8'", async () => {
    await setup([bench({ plannedSets: RANGE_PLAN, sets: [logged(1)] })]);
    expect(setLine()).toHaveTextContent(/^Set 2 of 3 · target 6–8$/);
  });

  it("a warm-up row reads 'Set 1 of 3 · Warm-up · target 8 @ 40 kg'", async () => {
    await setup([bench({ plannedSets: RANGE_PLAN })]);
    expect(setLine()).toHaveTextContent(/^Set 1 of 3 · Warm-up · target 8 @ 40 kg$/);
  });

  it("minor 454 — the weight and its unit can't part at a line break; the target as a whole still can wrap", async () => {
    await setup([bench({ plannedSets: RANGE_PLAN })]);
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "EntryRow.module.css"), "utf8");
    // No whole-span nowrap (it couldn't wrap at 200% text, WCAG 1.4.4): the no-break spaces do the job.
    expect(css).not.toMatch(/\.target\s*\{/);
    expect(setLine().textContent).toContain("· target 8 @\u00a040\u00a0kg");
  });

  it("the name is bold signal teal and both lines are at least --font-size-md, the target line in --color-text", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "EntryRow.module.css"), "utf8");
    const rule = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf("}", css.indexOf(`${selector} {`)));
    expect(rule(".exerciseName")).toMatch(/font-size:\s*var\(--font-size-md\)/);
    expect(rule(".exerciseName")).toMatch(/font-weight:\s*700/);
    expect(rule(".exerciseName")).toMatch(/color:\s*var\(--color-signal\)/);
    expect(rule(".setLine")).toMatch(/font-size:\s*var\(--font-size-md\)/);
    expect(rule(".setLine")).toMatch(/color:\s*var\(--color-text\)/);
  });
});

describe("17.8 AC6 — no target", () => {
  it.each<[string, ExerciseSpec]>([
    ["an extra set", bench({ plannedSets: RANGE_PLAN, sets: [logged(1), logged(2), logged(3)] })],
    ["no plan", { modality: "weight_reps", name: "Bench", sets: [logged(1)] }],
    ["an empty planned row", bench({ plannedSets: [{ setType: "working", repsLow: null, repsHigh: null, weight: null, weightUnit: null }] })],
    ["a stale plan on a duration exercise", { modality: "duration", name: "Bench", plannedSets: [planned("working", 8, 60)] }],
  ])("%s shows no target and no trailing ' · '", async (_case, spec) => {
    await setup([spec]);
    expect(setLine().textContent).not.toMatch(/target/);
    expect(setLine().textContent).not.toMatch(/·\s*$/);
  });
});
