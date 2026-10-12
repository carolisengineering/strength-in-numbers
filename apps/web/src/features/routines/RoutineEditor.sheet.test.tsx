import { screen, waitFor, within } from "@testing-library/react";
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

import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { makeRoutine, makeRoutineItem, routineId } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { catalog, pushA } from "../../test/routineFixtures";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  observability.reportError.mockReset();
  cleanupApp();
});

const plank = makeExercise({ id: exerciseId(5), name: "Plank", modality: "duration" });
const sheetCatalog = [...catalog, plank];
const editPath = `/app/workouts/routines/${routineId(1)}/edit`;
const rowSets = [
  { setType: "warmup", repsLow: 10, repsHigh: 10, weight: 60, weightUnit: "kg" },
  { setType: "working", repsLow: 8, repsHigh: 8, weight: 80, weightUnit: "kg" },
  { setType: "working", repsLow: 6, repsHigh: 6, weight: 100, weightUnit: "kg" },
];
const ramp = makeRoutine({
  id: routineId(1),
  name: "Ramp day",
  items: [makeRoutineItem({ position: 0, exerciseId: exerciseId(1), targetSets: 3, targetRepsLow: 6, targetRepsHigh: 10, sets: rowSets })],
});
const open = async (user: ReturnType<typeof renderApp>["user"], name: RegExp) => {
  await user.click(await screen.findByRole("button", { name }));
  return screen.findByRole("dialog");
};

describe("10.2 AC10 — the sheet takes the profile's unit", () => {
  it("defaults the toggle to the profile unit when the item has no stored unit", async () => {
    const fake = createWorkoutFake({ catalog: sheetCatalog, routines: [pushA] });
    prepareApp({ auth, catalog: sheetCatalog, fake, unitPreference: "lb" });
    const { user } = renderApp(editPath);
    const dialog = await open(user, /^Overhead Press/);
    expect(within(dialog).getByRole("button", { name: "lb" })).toHaveAttribute("aria-pressed", "true");
  });
  it("shows the stored unit and weight of a routine saved in pounds, whatever the profile says", async () => {
    const fake = createWorkoutFake({ catalog: sheetCatalog, routines: [makeRoutine({ id: routineId(1), name: "Lb", items: [makeRoutineItem({ exerciseId: exerciseId(1), targetSets: 2, targetRepsLow: 5, targetRepsHigh: 5, sets: Array(2).fill({ setType: "working", repsLow: 5, repsHigh: 5, weight: 135, weightUnit: "lb" }) })] })] });
    prepareApp({ auth, catalog: sheetCatalog, fake, unitPreference: "kg" });
    const { user } = renderApp(editPath);
    const dialog = await open(user, /^Bench Press/);
    expect(within(dialog).getByLabelText("Weight")).toHaveValue("135");
    expect(within(dialog).getByRole("button", { name: "lb" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("10.2 AC10 / AC12 — Done on an untouched sheet does not arm the leave guard", () => {
  it.each([
    ["quick mode", pushA, /^Bench Press/],
    ["plan mode", ramp, /^Bench Press/],
  ])("%s", async (_name, routine, name) => {
    const fake = createWorkoutFake({ catalog: sheetCatalog, routines: [routine] });
    prepareApp({ auth, catalog: sheetCatalog, fake });
    const { router, user } = renderApp(editPath);
    const dialog = await open(user, name);
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).toBeNull();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/routines/${routineId(1)}`));
  });
});

describe("10.2 AC18 — opening and saving cleans stored values the exercise cannot carry", () => {
  const plankRoutine = makeRoutine({ id: routineId(1), name: "Core", items: [makeRoutineItem({ exerciseId: exerciseId(5), targetSets: 3, targetRepsLow: 8, targetRepsHigh: 10 })] });
  it("the sheet shows no Reps; the first Done is a real change (the discard dialog appears)", async () => {
    const fake = createWorkoutFake({ catalog: sheetCatalog, routines: [plankRoutine] });
    prepareApp({ auth, catalog: sheetCatalog, fake });
    const { user } = renderApp(editPath);
    const dialog = await open(user, /^Plank/);
    expect(within(dialog).queryByLabelText("Reps")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
  });
  it("a save without ever opening the sheet still omits the stored reps from the body", async () => {
    const fake = createWorkoutFake({ catalog: sheetCatalog, routines: [plankRoutine] });
    prepareApp({ auth, catalog: sheetCatalog, fake });
    const { user } = renderApp(editPath);
    await user.type(await screen.findByLabelText("Notes"), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.requests.some((r) => r.method === "PUT")).toBe(true));
    const body = fake.requests.find((r) => r.method === "PUT")!.body as { items: { sets?: unknown[] }[] };
    expect(body.items[0]!.sets).toEqual([{ setType: "working" }, { setType: "working" }, { setType: "working" }]);
  });
});
