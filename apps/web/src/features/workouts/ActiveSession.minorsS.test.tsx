import type { PlannedSet } from "@sin/core";
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

import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { card, logButton } from "../../test/sessionHelpers";
import { makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

const bench = makeExercise({ id: exerciseId(1), name: "Bench Press", modality: "weight_reps" });
const planned = (n: number): PlannedSet[] => Array.from({ length: n }, () => ({ setType: "working", repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" }));
const ex = (name: string, o: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name, ...o });

const scroll = vi.fn();
beforeEach(() => {
  Element.prototype.scrollIntoView = scroll;
  scroll.mockReset();
});
afterEach(() => cleanupApp());

const panel = (name: string | RegExp) => within(card(name)).getByRole("form");
const scrolled = () => scroll.mock.contexts as unknown[];

async function setup(exercises: ExerciseSpec[]) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }), catalog: [bench] });
  prepareApp({ auth, fake, catalog: [bench] });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  await waitFor(() => expect(scroll).toHaveBeenCalled()); // the screen's one reveal on open (17.1 AC9)
  scroll.mockClear();
  return { fake, ...app };
}

describe("minor 713 — an Undo's reveal belongs to the lifter's last choice", () => {
  it("Undo selects its card and then reveals it: the reveal isn't dropped by Undo's own choice", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(3) }), ex("B", { plannedSets: planned(3) })]);
    await user.click(logButton("A"));
    const undo = await screen.findByRole("button", { name: /^Undo set 1/ });
    scroll.mockClear();
    await user.click(undo);
    await waitFor(() => expect(scrolled()).toContain(panel(/^A/)));
  });
});
