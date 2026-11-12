import { cleanup, screen, waitFor, within } from "@testing-library/react";
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

import { deriveTargets } from "@sin/core";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { openRow, summaryButton } from "../../test/planRowHelpers";
import { makeRoutine, makeRoutineItem, routineId } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { catalog, pushA } from "../../test/routineFixtures";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  observability.reportError.mockReset();
  cleanupApp();
});

const kg = (weight: number, o: Record<string, unknown> = {}) => ({ setType: "working", repsLow: 8, repsHigh: 8, weight, weightUnit: "kg", ...o });
const RAMP = [kg(60, { setType: "warmup", repsLow: 10, repsHigh: 10 }), kg(80), kg(100, { repsLow: 6, repsHigh: 6 })];
const UNIFORM = Array(4).fill(kg(100, { repsLow: 6, repsHigh: 8 }));

const everyShape = makeRoutine({
  id: routineId(1),
  name: "Every shape",
  items: [
    makeRoutineItem({ position: 0, exerciseId: exerciseId(1), targetSets: 4, targetRepsLow: 6, targetRepsHigh: 8, targetRpe: 8.5, restSeconds: 120, sets: UNIFORM }),
    makeRoutineItem({ position: 1, exerciseId: exerciseId(2), ...deriveTargets(RAMP as never), notes: "ramp it", sets: RAMP }),
    makeRoutineItem({ position: 2, exerciseId: exerciseId(3), targetSets: null, targetRepsLow: 8, targetRepsHigh: 10, sets: [] }),
    makeRoutineItem({ position: 3, exerciseId: exerciseId(1), sets: [] }),
  ],
});
const editPath = `/app/workouts/routines/${routineId(1)}/edit`;
const previewPath = `/app/workouts/routines/${routineId(1)}`;

describe("10.2 AC15 — the weight is in the row summary", () => {
  it("the preview shows the weighted line and carries it in the accessible name", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [everyShape] }) });
    renderApp(previewPath);
    const list = await screen.findByRole("list", { name: "Exercises" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("4 × 6–8 @ 100 kg · 2:00");
    expect(list).not.toHaveTextContent(/RPE/); // targetRpe 8.5 is stored, never shown (17.1 AC4)
    for (const li of items) expect(li).not.toHaveAccessibleName(/RPE/);
    expect(items[1]).toHaveTextContent("3 × 6–10 @ 60–100 kg");
    expect(items[1]).toHaveAccessibleName(/Barbell Row, 3 × 6–10 @ 60–100 kg/);
    expect(items[2]).toHaveTextContent("8–10 reps");
    expect(items[2]).not.toHaveTextContent("@");
  });
  it("the editor row shows the same, for a quick item with a weight and for a ramp", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [everyShape] }) });
    renderApp(editPath);
    expect(await screen.findByRole("button", { name: /Bench Press, 4 × 6–8 @ 100 kg · 2:00/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /RPE/ })).toBeNull(); // 17.1 AC4
    expect(screen.getByRole("button", { name: /Barbell Row, 3 × 6–10 @ 60–100 kg/ })).toBeInTheDocument();
  });
  it("typing a weight on the quick line updates the row line after Done", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushA] }) });
    const { user } = renderApp(`/app/workouts/routines/${pushA.id}/edit`);
    await user.click(await screen.findByRole("button", { name: /^Overhead Press/ }));
    await user.type(within(await screen.findByRole("dialog")).getByLabelText("Weight"), "42.5");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("button", { name: /Overhead Press, 3 × 8 @ 42.5 kg/ })).toBeInTheDocument();
  });
});

describe("10.2 AC17 — save round trip: every shape survives a no-op Done and an unrelated edit", () => {
  it("each item is stored as the same rows; each travels in exactly one form", async () => {
    const fake = createWorkoutFake({ catalog, routines: [everyShape] });
    prepareApp({ auth, catalog, fake });
    const { router, user } = renderApp(editPath);
    await screen.findByRole("heading", { level: 1, name: "Edit routine" });

    // A no-op Done on every item…
    for (let i = 0; i < 4; i++) {
      const rows = await screen.findAllByRole("button", { name: /^(Bench Press|Barbell Row|Overhead Press)/ });
      await user.click(rows[i]!);
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Done" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); // an open dialog hides the page behind it
    }
    // …then an edit elsewhere, so Save is enabled.
    await user.type(screen.getByLabelText("Notes", { selector: "textarea#routine-notes" }), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(previewPath));

    const put = fake.requests.find((r) => r.method === "PUT")!;
    const items = (put.body as { items: Record<string, unknown>[] }).items;
    expect(items[0]!["sets"]).toEqual(Array(4).fill({ setType: "working", repsLow: 6, repsHigh: 8, weight: 100, weightUnit: "kg" }));
    expect(items[1]!["sets"]).toEqual(RAMP);
    expect(Object.hasOwn(items[2]!, "sets")).toBe(false);
    expect(items[2]).toMatchObject({ targetRepsLow: 8, targetRepsHigh: 10 });
    expect(items[3]!["targetRepsLow"]).toBeNull();
    for (const item of items) {
      const usesRows = Object.hasOwn(item, "sets");
      for (const key of ["targetSets"]) expect(Object.hasOwn(item, key) && usesRows, key).toBe(false);
    }

    const stored = fake.state.routines.get(routineId(1))!;
    expect(stored.items[0]!.sets).toEqual(UNIFORM);
    expect(stored.items[1]!.sets).toEqual(RAMP);
    expect(stored.items[2]).toMatchObject({ sets: [], targetSets: null, targetRepsLow: 8, targetRepsHigh: 10 });
    expect(stored.items[3]!.sets).toEqual([]);
    // Item-level fields rode along untouched.
    expect(stored.items[0]).toMatchObject({ targetRpe: 8.5, restSeconds: 120 });
    expect(stored.items[1]!.notes).toBe("ramp it");
  });
});

describe("17.11 AC18 — opening and closing rows is view state: the body and the leave guard don't see it", () => {
  const plank = makeExercise({ id: exerciseId(5), name: "Plank", modality: "duration" });
  const shapesCatalog = [...catalog, plank];
  const MIXED = [kg(60), kg(135, { weightUnit: "lb" }), kg(80)];
  const TIMED = [{ setType: "warmup", repsLow: null, repsHigh: null, weight: null, weightUnit: null }, { setType: "working", repsLow: null, repsHigh: null, weight: null, weightUnit: null }];
  const shapes = makeRoutine({
    id: routineId(1),
    name: "Shapes",
    items: [
      makeRoutineItem({ position: 0, exerciseId: exerciseId(1), ...deriveTargets(RAMP as never), sets: RAMP }),
      makeRoutineItem({ position: 1, exerciseId: exerciseId(2), ...deriveTargets(MIXED as never), sets: MIXED }),
      makeRoutineItem({ position: 2, exerciseId: exerciseId(3), targetSets: null, targetRepsLow: 8, targetRepsHigh: 10, sets: [] }),
      makeRoutineItem({ position: 3, exerciseId: exerciseId(5), targetSets: 2, sets: TIMED as never }),
    ],
  });
  const NAMES = /^(Bench Press|Barbell Row|Overhead Press|Plank)/;

  /** Opens every item and taps Done; with `toggle`, first opens and closes rows 1 and 2 of each plan. */
  async function doneOnEveryItem(user: ReturnType<typeof renderApp>["user"], toggle: boolean) {
    for (let i = 0; i < 4; i++) {
      await user.click((await screen.findAllByRole("button", { name: NAMES }))[i]!);
      const dialog = await screen.findByRole("dialog");
      if (toggle && within(dialog).queryByRole("list", { name: "Planned sets" }) !== null) {
        await openRow(user, 1, dialog);
        await openRow(user, 2, dialog);
        await user.click(summaryButton(2, dialog));
      }
      await user.click(within(dialog).getByRole("button", { name: "Done" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
  }

  async function savedBody(toggle: boolean) {
    const fake = createWorkoutFake({ catalog: shapesCatalog, routines: [shapes] });
    prepareApp({ auth, catalog: shapesCatalog, fake });
    const { router, user } = renderApp(editPath);
    await screen.findByRole("heading", { level: 1, name: "Edit routine" });
    await doneOnEveryItem(user, toggle);
    await user.type(screen.getByLabelText("Notes", { selector: "textarea#routine-notes" }), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(previewPath));
    return fake.requests.find((r) => r.method === "PUT")!.body as { items: Record<string, unknown>[] };
  }

  it("a plan, mixed units, a quick line and a timed plan send the same body with rows opened as without", async () => {
    const untouched = await savedBody(false);
    cleanup();
    cleanupApp();
    const toggled = await savedBody(true);
    expect(JSON.stringify(toggled)).toBe(JSON.stringify(untouched));
    expect(toggled.items[0]!["sets"]).toEqual(RAMP);
    expect(toggled.items[1]!["sets"]).toEqual(MIXED);
    expect(Object.hasOwn(toggled.items[2]!, "sets")).toBe(false);
    expect(toggled.items[2]).toMatchObject({ targetRepsLow: 8, targetRepsHigh: 10 });
    expect((toggled.items[3]!["sets"] as unknown[]).length).toBe(2);
  });

  it("Done on untouched sheets, rows opened and closed, leaves the draft clean: Cancel doesn't ask", async () => {
    prepareApp({ auth, catalog: shapesCatalog, fake: createWorkoutFake({ catalog: shapesCatalog, routines: [shapes] }) });
    const { router, user } = renderApp(editPath);
    await screen.findByRole("heading", { level: 1, name: "Edit routine" });
    await doneOnEveryItem(user, true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(previewPath));
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).toBeNull();
  });
});

describe("10.2 AC8 / AC16 — a 422 on a plan row shows beside that row", () => {
  it("maps items.0.sets.1.weight onto Set 2's weight and onto the editor row", async () => {
    const ramp = makeRoutine({ id: routineId(1), name: "Ramp", items: [makeRoutineItem({ exerciseId: exerciseId(1), ...deriveTargets(RAMP as never), sets: RAMP })] });
    const fake = createWorkoutFake({ catalog, routines: [ramp] });
    fake.failNext({ method: "PUT", path: /^\/v1\/routines\// }, () => problemResponse(422, "validation-error", { errors: [{ path: "items.0.sets.1.weight", message: "server words" }] }));
    prepareApp({ auth, catalog, fake });
    const { user } = renderApp(editPath);
    await user.type(await screen.findByLabelText("Notes", { selector: "textarea#routine-notes" }), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Enter a weight like 62\.5/)).toBeInTheDocument();
    expect(screen.queryByText("server words")).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Bench Press/ }));
    await openRow(user, 2, await screen.findByRole("dialog"));
    expect(within(await screen.findByRole("dialog")).getByLabelText("Set 2 weight")).toHaveAccessibleDescription(/Enter a weight like 62\.5/);
  });
});

describe("10.2 AC19 — the editor never writes a workout", () => {
  it("saving a routine sends no request to /v1/workouts", async () => {
    const fake = createWorkoutFake({ catalog, routines: [everyShape] });
    prepareApp({ auth, catalog, fake });
    const { router, user } = renderApp(editPath);
    await user.type(await screen.findByLabelText("Notes", { selector: "textarea#routine-notes" }), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(previewPath));
    // The app shell may read the active workout; the editor must not write one.
    expect(fake.requests.filter((r) => r.path.startsWith("/v1/workouts") && r.method !== "GET")).toEqual([]);
  });
});
