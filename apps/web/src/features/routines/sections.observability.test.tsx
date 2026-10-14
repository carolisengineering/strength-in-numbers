import { screen, within } from "@testing-library/react";
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

import { exerciseId } from "../../test/catalogFixtures";
import { addFromPicker } from "../../test/routineHarness";
import { catalog } from "../../test/routineFixtures";
import { makeRoutine, makeRoutineItem, makeRoutineSection, makeWorkoutDetail, routineId, sectionId } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

const NAME = "UNIQUE-section-name-4410";
const NOTE = "UNIQUE-section-note-4410";
const ROUTINE_NOTE = "UNIQUE-routine-note-4410";

describe("10.3 AC35 — sections report and track nothing, and leak no text", () => {
  it("building, saving and starting a sectioned routine: no track, no reportError, no console argument carries a section or routine note", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m));
    const fake = createWorkoutFake({ catalog, routines: [] });
    prepareApp({ auth, catalog, fake });
    const { user } = renderApp("/app/workouts/routines/new");
    await user.type(await screen.findByLabelText("Name"), "Leak check");
    await user.type(screen.getByLabelText("Notes"), ROUTINE_NOTE);
    await user.click(screen.getByRole("button", { name: "Add section" }));
    const add = await screen.findByRole("dialog", { name: "Add section" });
    await user.type(within(add).getByLabelText("Name"), NAME);
    await user.click(within(add).getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: `Edit section ${NAME}` }));
    const sheet = await screen.findByRole("dialog", { name: "Edit section" });
    await user.type(within(sheet).getByLabelText("Note"), NOTE);
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await addFromPicker(user, /Bench Press/);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { level: 1, name: "Leak check" });
    await user.click(await screen.findByRole("button", { name: "Start this routine" }));
    await screen.findByRole("heading", { name: "Workout" });
    // Only events that already existed before Spec 10.3 may fire (the picker and the start); sections add none.
    expect(observability.track.mock.calls.map(([name]) => name).filter((n) => n !== "workout_started" && n !== "exercise_picked")).toEqual([]);
    expect(observability.reportError).not.toHaveBeenCalled();
    const seen = JSON.stringify([observability.track.mock.calls, observability.reportError.mock.calls, spies.map((s) => s.mock.calls)]);
    for (const text of [NAME, NOTE, ROUTINE_NOTE]) expect(seen).not.toContain(text);
    for (const spy of spies) spy.mockRestore();
  });
});

describe("10.3 AC36 — markup in a name or note is text", () => {
  const HOSTILE = "<img src=x onerror=alert(1)>";
  it("editor, preview, session and summary render it as text and create no element", async () => {
    const routine = makeRoutine({
      id: routineId(7),
      name: "Hostile",
      notes: HOSTILE,
      sections: [makeRoutineSection({ id: sectionId(7), position: 0, name: HOSTILE, notes: HOSTILE })],
      items: [makeRoutineItem({ position: 0, exerciseId: exerciseId(1), sectionId: sectionId(7) })],
    });
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [routine] }) });
    const { user } = renderApp(`/app/workouts/routines/${routineId(7)}`);
    expect((await screen.findAllByText(HOSTILE)).length).toBeGreaterThanOrEqual(2); // preview: routine note, section name, section note
    expect(document.querySelector("img")).toBeNull();
    await user.click(screen.getByRole("link", { name: "Edit" }));
    expect((await screen.findAllByText(HOSTILE)).length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector("img")).toBeNull();
  });
  it("the session and the summary do too", async () => {
    const detail = makeWorkoutDetail({ routineName: "Hostile", routineNotes: HOSTILE, sections: [{ name: HOSTILE, notes: HOSTILE }], exercises: [{ modality: "weight_reps", name: "A", sectionIndex: 0, notes: HOSTILE }] });
    prepareApp({ auth, fake: createWorkoutFake({ active: detail }) });
    renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    expect((await screen.findAllByText(HOSTILE)).length).toBeGreaterThanOrEqual(4);
    expect(document.querySelector("img")).toBeNull();
  });
});
