import { act, screen, waitFor, within } from "@testing-library/react";
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

import { API_BASE_URL } from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";
import { card, finishButton, logButton, makeCurrent, optionsButton, restBetweenSets } from "../../test/sessionHelpers";
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
    expect(label.tagName).toBe("P");
    expect(label).not.toHaveAttribute("role");
    expect(screen.getByRole("form", { name: "Log a set of Bench" })).toBeInTheDocument();
    await user.click(logButton("Bench"));
    await waitFor(() => expect(within(card("Bench")).getByRole("status")).toHaveTextContent("Set 1 logged"));
  });
});

describe("10.2 AC22 / AC23 — the draft arrives filled; one tap logs it", () => {
  it("fills type, weight, unit and reps from the next row; there is no RPE field", async () => {
    await setup([bench()]);
    expect(field("Bench", "Set type")).toHaveValue("warmup");
    expect(field("Bench", "Weight")).toHaveValue("60");
    expect(field("Bench", "Weight unit")).toHaveValue("kg");
    expect(field("Bench", "Reps")).toHaveValue("10");
    expect(screen.queryByLabelText("RPE")).toBeNull();
  });
  it("the plan's unit wins over the profile's", async () => {
    await setup([bench({ plannedSets: [planned("working", 5, 135, "lb")] })], "kg");
    expect(field("Bench", "Weight unit")).toHaveValue("lb");
  });
  it("a single tap sends the row's values, isComplete, the attempt key and the row's type; a warm-up logs as warmup", async () => {
    const { fake, user } = await setup([bench()]);
    expect(logButton("Bench")).toBeEnabled();
    await user.click(logButton("Bench"));
    await waitFor(() => expect(setPosts(fake)).toHaveLength(1));
    expect(setPosts(fake)[0]!.body).toMatchObject({ setType: "warmup", reps: 10, weight: 60, weightUnit: "kg", isComplete: true, clientGeneratedId: expect.any(String) });
  });
  it("a row that leaves a required measure blank keeps Log set disabled, with no error until touched", async () => {
    await setup([bench({ plannedSets: [planned("working", 8, null)] })]);
    expect(logButton("Bench")).toBeDisabled();
    expect(within(card("Bench")).queryByText("Required")).toBeNull();
    expect(field("Bench", "Reps")).toHaveValue("8");
  });
});

describe("10.2 AC24 — after a log", () => {
  it("each tap logs the next row; after the last it is 'Extra set' with the last set copied", async () => {
    const { fake, user } = await setup([bench()]);
    await user.click(logButton("Bench"));
    await within(card("Bench")).findByText("Set 2 of 3");
    expect(field("Bench", "Weight")).toHaveValue("80");
    expect(field("Bench", "Reps")).toHaveValue("8");
    expect(field("Bench", "Set type")).toHaveValue("working");
    await restBetweenSets();
    await user.click(logButton("Bench"));
    await within(card("Bench")).findByText("Set 3 of 3");
    expect(field("Bench", "Weight")).toHaveValue("100");
    await restBetweenSets();
    await user.click(logButton("Bench"));
    await within(card("Bench")).findByText("Extra set");
    expect(field("Bench", "Weight")).toHaveValue("100");
    expect(field("Bench", "Reps")).toHaveValue("6");
    expect(field("Bench", "Set type")).toHaveValue("working");
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
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete set" }));
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
    await user.click(finishButton());
    await user.click(within(screen.getByRole("dialog", { name: "Finish workout?" })).getByRole("button", { name: "Finish" }));
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
    await setup([exercise]);
    expect(within(card("Bench")).getByText("Set 2")).toBeInTheDocument();
    expect(field("Bench", "Weight")).toHaveValue("60");
    expect(field("Bench", "Reps")).toHaveValue("8");
    expect(field("Bench", "Set type")).toHaveValue("working");
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
    await user.click(logButton(card(/^Bench, superset 1/).getAttribute("aria-label")!)); // the label carries the plan line
    await within(card(/^Bench, superset 1/)).findByText("Set 2 of 2");
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
